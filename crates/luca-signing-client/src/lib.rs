//! Managed-only client for the Luca desktop signing broker.
//!
//! The broker channel is inherited exclusively as ACP standard input. This
//! crate duplicates that channel into an owned close-on-exec Unix stream before
//! asynchronous work starts and never exposes the stream or a raw descriptor.

#![forbid(unsafe_code)]

#[cfg(unix)]
mod unix {
    use luca_protocol::{
        decode_length_prefixed_result_frame, encode_length_prefixed_frame, BrokerOperationV1,
        FrameError, Hex64, ManagedMessagePublishRequestV1, ManagedMessagePublishResultV1,
        MessagePublishError, OpaqueId, RelayAuthError, RelayAuthSignRequestV1,
        RelayAuthSignResultV1, SafeU53, SigningFrameV1, SigningResultFrameV1,
        BROKER_FRAME_MAX_BYTES, SIGNING_FRAME_PROTOCOL,
    };
    use serde::de::DeserializeOwned;
    use serde::Serialize;
    use std::io;
    use std::os::fd::AsFd;
    use std::os::unix::net::UnixStream as StdUnixStream;
    use std::sync::Arc;
    use std::time::Duration;
    use thiserror::Error;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixStream;
    use tokio::sync::Mutex;
    use tokio::time::timeout;

    const REQUEST_DEADLINE_MS: u64 = 30_000;

    /// A failure at the managed desktop-broker boundary.
    #[derive(Debug, Error)]
    pub enum SigningClientError {
        /// Standard input was not a usable inherited Unix socket.
        #[error("managed signing broker is not available on inherited standard input: {0}")]
        InheritedChannel(#[source] io::Error),
        /// A previously observed terminal failure permanently closed this session.
        #[error("managed signing broker session is closed")]
        SessionClosed,
        /// The request resident did not match the resident bound to this client.
        #[error("managed signing request resident does not match the bound session")]
        ResidentMismatch,
        /// Session sequencing or a JSON-safe protocol integer was exhausted.
        #[error("managed signing broker session sequence is exhausted")]
        SequenceExhausted,
        /// The broker did not answer before the request deadline.
        #[error("managed signing broker request deadline elapsed")]
        DeadlineElapsed,
        /// Transport input/output failed and the session was closed.
        #[error("managed signing broker transport failed")]
        Transport(#[source] io::Error),
        /// Canonical frame encoding or decoding failed and the session was closed.
        #[error("managed signing broker frame was invalid")]
        Frame(#[source] FrameError),
        /// A response did not echo the exact request binding.
        #[error("managed signing broker response binding did not match the request")]
        ResponseBinding,
        /// A relay-auth result did not match the exact typed request.
        #[error("managed relay-auth result did not match the request")]
        RelayAuth(#[source] RelayAuthError),
        /// A managed final-publication request violated its typed contract.
        #[error("managed message-publish request was invalid")]
        MessagePublish(#[source] MessagePublishError),
        /// An internally generated bounded request identifier was invalid.
        #[error("managed signing broker request identifier could not be generated")]
        RequestIdentifier,
    }

    /// Cloneable, session-bound handle to the managed desktop signing broker.
    ///
    /// Clones share one serialized request/response stream. Any I/O, framing,
    /// deadline, sequence, or response-binding failure permanently closes the
    /// shared session so a caller cannot continue from ambiguous state.
    #[derive(Clone)]
    pub struct ManagedSigningClient {
        session_epoch: SafeU53,
        resident_pubkey: Hex64,
        state: Arc<Mutex<ClientState>>,
    }

    struct ClientState {
        stream: UnixStream,
        next_sequence: u64,
        closed: bool,
    }

    impl ManagedSigningClient {
        /// Duplicate the Unix socket inherited as standard input into an owned,
        /// close-on-exec broker channel.
        ///
        /// `try_clone_to_owned` uses the platform's close-on-exec duplication
        /// primitive. The original standard-input descriptor is never retained
        /// by this client, and no descriptor number, path, or bearer value is
        /// returned to the caller.
        pub fn from_inherited_stdin(
            session_epoch: SafeU53,
            resident_pubkey: Hex64,
        ) -> Result<Self, SigningClientError> {
            let stdin = io::stdin();
            Self::from_inherited_source(stdin.as_fd(), session_epoch, resident_pubkey)
        }

        /// Return the desktop-issued session epoch bound to this channel.
        pub fn session_epoch(&self) -> SafeU53 {
            self.session_epoch
        }

        /// Return the resident public identity bound to this channel.
        pub fn resident_pubkey(&self) -> &Hex64 {
            &self.resident_pubkey
        }

        /// Request one policy-bound NIP-42 or NIP-98 authentication event.
        pub async fn relay_auth(
            &self,
            request: RelayAuthSignRequestV1,
            now_unix_ms: u64,
        ) -> Result<RelayAuthSignResultV1, SigningClientError> {
            if request.resident_pubkey != self.resident_pubkey {
                return Err(SigningClientError::ResidentMismatch);
            }
            request
                .validate_at(now_unix_ms / 1_000)
                .map_err(SigningClientError::RelayAuth)?;
            let result: RelayAuthSignResultV1 = self.call(request.clone(), now_unix_ms).await?;
            if let Err(error) = result.validate_against(&request, now_unix_ms / 1_000) {
                self.close().await;
                return Err(SigningClientError::RelayAuth(error));
            }
            Ok(result)
        }

        /// Request publication of one accepted, app-bound final message.
        ///
        /// F09 owns final chunk aggregation. This method represents only the
        /// typed publication handoff and cannot sign arbitrary bytes.
        pub async fn message_publish(
            &self,
            request: ManagedMessagePublishRequestV1,
            now_unix_ms: u64,
        ) -> Result<ManagedMessagePublishResultV1, SigningClientError> {
            if request.resident_pubkey != self.resident_pubkey {
                return Err(SigningClientError::ResidentMismatch);
            }
            request
                .validate()
                .map_err(SigningClientError::MessagePublish)?;
            self.call(request, now_unix_ms).await
        }

        fn from_inherited_source(
            source: std::os::fd::BorrowedFd<'_>,
            session_epoch: SafeU53,
            resident_pubkey: Hex64,
        ) -> Result<Self, SigningClientError> {
            let owned = source
                .try_clone_to_owned()
                .map_err(SigningClientError::InheritedChannel)?;
            let stream = StdUnixStream::from(owned);
            stream
                .peer_addr()
                .map_err(SigningClientError::InheritedChannel)?;
            stream
                .set_nonblocking(true)
                .map_err(SigningClientError::InheritedChannel)?;
            let stream =
                UnixStream::from_std(stream).map_err(SigningClientError::InheritedChannel)?;
            Ok(Self {
                session_epoch,
                resident_pubkey,
                state: Arc::new(Mutex::new(ClientState {
                    stream,
                    next_sequence: 1,
                    closed: false,
                })),
            })
        }

        async fn call<Request, Response>(
            &self,
            request: Request,
            now_unix_ms: u64,
        ) -> Result<Response, SigningClientError>
        where
            Request: BrokerOperationV1 + Serialize,
            Response: BrokerOperationV1 + DeserializeOwned,
        {
            let deadline_unix_ms = match now_unix_ms
                .checked_add(REQUEST_DEADLINE_MS)
                .and_then(|value| SafeU53::new(value).ok())
            {
                Some(deadline) => deadline,
                None => {
                    self.close().await;
                    return Err(SigningClientError::SequenceExhausted);
                }
            };
            self.call_with_deadline(request, now_unix_ms, deadline_unix_ms)
                .await
        }

        async fn call_with_deadline<Request, Response>(
            &self,
            request: Request,
            now_unix_ms: u64,
            deadline_unix_ms: SafeU53,
        ) -> Result<Response, SigningClientError>
        where
            Request: BrokerOperationV1 + Serialize,
            Response: BrokerOperationV1 + DeserializeOwned,
        {
            let mut state = self.state.lock().await;
            if state.closed {
                return Err(SigningClientError::SessionClosed);
            }

            let sequence_value = state.next_sequence;
            let sequence = match SafeU53::new(sequence_value) {
                Ok(sequence) => sequence,
                Err(_) => {
                    poison(&mut state).await;
                    return Err(SigningClientError::SequenceExhausted);
                }
            };
            state.next_sequence = match sequence_value.checked_add(1) {
                Some(next) => next,
                None => {
                    poison(&mut state).await;
                    return Err(SigningClientError::SequenceExhausted);
                }
            };
            let request_id = match OpaqueId::parse(format!(
                "managed:{}:{}",
                self.session_epoch.get(),
                sequence_value
            )) {
                Ok(request_id) => request_id,
                Err(_) => {
                    poison(&mut state).await;
                    return Err(SigningClientError::RequestIdentifier);
                }
            };
            let operation = Request::OPERATION;
            let frame = SigningFrameV1 {
                protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
                session_epoch: self.session_epoch,
                sequence,
                request_id: request_id.clone(),
                operation,
                payload: request,
                deadline_unix_ms,
            };
            let encoded = match encode_length_prefixed_frame(&frame, now_unix_ms) {
                Ok(encoded) => encoded,
                Err(error) => {
                    poison(&mut state).await;
                    return Err(SigningClientError::Frame(error));
                }
            };
            let timeout_ms = deadline_unix_ms.get().saturating_sub(now_unix_ms);

            // Treat the session as closed while the exchange is in flight.
            // If this future is cancelled after a write, dropping its mutex
            // guard leaves `closed` set and prevents a later call from
            // consuming an ambiguous response or reusing the session.
            state.closed = true;
            let exchange = async {
                state
                    .stream
                    .write_all(&encoded)
                    .await
                    .map_err(SigningClientError::Transport)?;
                state
                    .stream
                    .flush()
                    .await
                    .map_err(SigningClientError::Transport)?;
                let response_bytes = read_one_frame(&mut state.stream).await?;
                let response: SigningResultFrameV1<Response> =
                    decode_length_prefixed_result_frame(&response_bytes)
                        .map_err(SigningClientError::Frame)?;
                if response.session_epoch != self.session_epoch
                    || response.sequence != sequence
                    || response.request_id != request_id
                    || response.operation != operation
                {
                    return Err(SigningClientError::ResponseBinding);
                }
                Ok(response.result)
            };

            match timeout(Duration::from_millis(timeout_ms), exchange).await {
                Ok(Ok(result)) => {
                    state.closed = false;
                    Ok(result)
                }
                Ok(Err(error)) => {
                    poison(&mut state).await;
                    Err(error)
                }
                Err(_) => {
                    poison(&mut state).await;
                    Err(SigningClientError::DeadlineElapsed)
                }
            }
        }

        async fn close(&self) {
            let mut state = self.state.lock().await;
            poison(&mut state).await;
        }
    }

    async fn read_one_frame(stream: &mut UnixStream) -> Result<Vec<u8>, SigningClientError> {
        let mut prefix = [0_u8; 4];
        stream
            .read_exact(&mut prefix)
            .await
            .map_err(SigningClientError::Transport)?;
        let declared = u32::from_be_bytes(prefix) as usize;
        if declared > BROKER_FRAME_MAX_BYTES {
            return Err(SigningClientError::Frame(FrameError::LengthPrefix));
        }
        let mut body = vec![0_u8; declared];
        stream
            .read_exact(&mut body)
            .await
            .map_err(SigningClientError::Transport)?;
        let mut encoded = Vec::with_capacity(4 + declared);
        encoded.extend_from_slice(&prefix);
        encoded.extend_from_slice(&body);
        Ok(encoded)
    }

    async fn poison(state: &mut ClientState) {
        state.closed = true;
        let _ = state.stream.shutdown().await;
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use luca_protocol::{
            decode_length_prefixed_frame, derive_message_publish_idempotency_key,
            encode_length_prefixed_result_frame, ManagedMessagePublishRequestV1,
            ManagedMessagePublishResultV1, OperationV1, RelayAuthPurposeV1, RelayAuthSignRequestV1,
            RelayAuthSignResultV1, SIGNING_FRAME_PROTOCOL,
        };
        use std::os::fd::AsFd;
        use std::os::unix::net::UnixStream as StdUnixStream;

        const NOW_MS: u64 = 1_780_000_000_000;

        fn hex(value: char) -> Hex64 {
            Hex64::parse(value.to_string().repeat(64)).expect("valid fixture hex")
        }

        fn opaque(value: &str) -> OpaqueId {
            OpaqueId::parse(value).expect("valid fixture opaque ID")
        }

        fn relay_request(resident: &Hex64) -> RelayAuthSignRequestV1 {
            RelayAuthSignRequestV1 {
                protocol: luca_protocol::RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
                resident_pubkey: resident.clone(),
                purpose: RelayAuthPurposeV1::Nip42 {
                    relay_url: "wss://relay.example/".to_owned(),
                    challenge: "challenge-1".to_owned(),
                    owner_attestation: None,
                },
            }
        }

        fn fixture_client() -> (
            ManagedSigningClient,
            UnixStream,
            SafeU53,
            Hex64,
            StdUnixStream,
        ) {
            let (client_source, server_source) =
                StdUnixStream::pair().expect("create fixture socketpair");
            client_source
                .set_nonblocking(true)
                .expect("make client source nonblocking");
            server_source
                .set_nonblocking(true)
                .expect("make server source nonblocking");
            let epoch = SafeU53::new(41).expect("valid fixture epoch");
            let resident = hex('1');
            let client = ManagedSigningClient::from_inherited_source(
                client_source.as_fd(),
                epoch,
                resident.clone(),
            )
            .expect("duplicate fixture channel");
            let server = UnixStream::from_std(
                server_source
                    .try_clone()
                    .expect("clone fixture server source"),
            )
            .expect("wrap fixture server");
            (client, server, epoch, resident, client_source)
        }

        async fn read_request<T: BrokerOperationV1 + DeserializeOwned>(
            stream: &mut UnixStream,
        ) -> SigningFrameV1<T> {
            let bytes = read_one_frame(stream).await.expect("read request frame");
            decode_length_prefixed_frame(&bytes, NOW_MS).expect("decode request frame")
        }

        async fn write_response<T: BrokerOperationV1 + Serialize>(
            stream: &mut UnixStream,
            request: &SigningFrameV1<impl BrokerOperationV1>,
            result: T,
        ) {
            let frame = SigningResultFrameV1 {
                protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
                session_epoch: request.session_epoch,
                sequence: request.sequence,
                request_id: request.request_id.clone(),
                operation: T::OPERATION,
                result,
            };
            let bytes = encode_length_prefixed_result_frame(&frame).expect("encode result frame");
            stream.write_all(&bytes).await.expect("write result frame");
        }

        #[tokio::test]
        async fn signing_vectors_relay_auth_uses_owned_inherited_channel() {
            let (client, mut server, epoch, resident, original_source) = fixture_client();
            drop(original_source);
            let request = relay_request(&resident);
            let server_task = tokio::spawn(async move {
                let frame: SigningFrameV1<RelayAuthSignRequestV1> = read_request(&mut server).await;
                assert_eq!(frame.session_epoch, epoch);
                assert_eq!(frame.sequence.get(), 1);
                assert_eq!(frame.operation, OperationV1::RelayAuthSign);
                assert_eq!(frame.payload, request);
                write_response(
                    &mut server,
                    &frame,
                    RelayAuthSignResultV1::Denied {
                        code: opaque("policy-denied"),
                    },
                )
                .await;
            });

            let result = client
                .relay_auth(relay_request(&resident), NOW_MS)
                .await
                .expect("typed relay-auth exchange");
            assert!(matches!(result, RelayAuthSignResultV1::Denied { .. }));
            server_task.await.expect("server task");
        }

        #[tokio::test]
        async fn signing_vectors_owned_channel_is_close_on_exec() {
            use std::process::Stdio;

            let (client, mut server, _epoch, _resident, original_source) = fixture_client();
            // Only the client's `try_clone_to_owned` duplicate remains on the
            // broker side before the exec boundary below.
            drop(original_source);

            let mut descendant = tokio::process::Command::new("/bin/sh")
                .args([
                    "-c",
                    "/bin/sh -c 'exec sleep 3' nested-shell harmless-nested & wait",
                    "model-shell",
                    "harmless-model",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn an exec descendant while the client channel is open");

            assert!(
                descendant.try_wait().expect("inspect descendant").is_none(),
                "descriptor proof requires a live exec descendant"
            );

            // If the owned broker duplicate were inherited across exec, the
            // peer could not observe EOF until the shell tree exited.
            drop(client);
            let mut eof = [0_u8; 1];
            let read = tokio::time::timeout(Duration::from_millis(500), server.read(&mut eof))
                .await
                .expect("broker peer must close while the exec descendant is still alive")
                .expect("read broker peer");
            assert_eq!(read, 0, "the owned broker duplicate crossed exec");
            assert!(
                descendant
                    .try_wait()
                    .expect("re-inspect descendant")
                    .is_none(),
                "the exec descendant exited before the CLOEXEC assertion"
            );

            descendant.start_kill().expect("stop descriptor probe");
            let _ = descendant.wait().await;
        }

        #[tokio::test]
        async fn signing_vectors_message_publish_vectors_round_trip_is_typed() {
            let (client, mut server, epoch, resident, _source) = fixture_client();
            let dispatch = opaque("dispatch-1");
            let request = ManagedMessagePublishRequestV1 {
                protocol: luca_protocol::MESSAGE_PUBLISH_PROTOCOL.to_owned(),
                turn_id: opaque("turn-1"),
                idempotency_key: derive_message_publish_idempotency_key(&dispatch, &resident)
                    .expect("derive idempotency key"),
                owner_pubkey: hex('2'),
                resident_pubkey: resident.clone(),
                conversation_id: opaque("conversation-1"),
                thread_id: None,
                root_event_id: None,
                reply_event_id: None,
                response_surface: None,
                resolved_p_tags: Vec::new(),
                final_draft: "managed final".to_owned(),
                dispatch_receipt_id: dispatch,
                cancellation_epoch: SafeU53::new(1).expect("valid cancellation epoch"),
                exchange: None,
                bucket_hint: None,
            };
            let server_request = request.clone();
            let server_task = tokio::spawn(async move {
                let frame: SigningFrameV1<ManagedMessagePublishRequestV1> =
                    read_request(&mut server).await;
                assert_eq!(frame.session_epoch, epoch);
                assert_eq!(frame.operation, OperationV1::MessagePublish);
                assert_eq!(frame.payload, server_request);
                write_response(
                    &mut server,
                    &frame,
                    ManagedMessagePublishResultV1::Unavailable {
                        code: opaque("publisher-not-ready"),
                    },
                )
                .await;
            });

            let result = client
                .message_publish(request, NOW_MS)
                .await
                .expect("typed message-publish exchange");
            assert!(matches!(
                result,
                ManagedMessagePublishResultV1::Unavailable { .. }
            ));
            server_task.await.expect("server task");
        }

        #[tokio::test]
        async fn signing_vectors_replayed_sequence_poison_session() {
            let (client, mut server, _epoch, resident, _source) = fixture_client();
            let server_task = tokio::spawn(async move {
                let first: SigningFrameV1<RelayAuthSignRequestV1> = read_request(&mut server).await;
                write_response(
                    &mut server,
                    &first,
                    RelayAuthSignResultV1::Denied {
                        code: opaque("first"),
                    },
                )
                .await;
                let _second: SigningFrameV1<RelayAuthSignRequestV1> =
                    read_request(&mut server).await;
                write_response(
                    &mut server,
                    &first,
                    RelayAuthSignResultV1::Denied {
                        code: opaque("replayed"),
                    },
                )
                .await;
            });

            client
                .relay_auth(relay_request(&resident), NOW_MS)
                .await
                .expect("first exchange");
            let error = client
                .relay_auth(relay_request(&resident), NOW_MS)
                .await
                .expect_err("replayed sequence must fail");
            assert!(matches!(error, SigningClientError::ResponseBinding));
            let closed = client
                .relay_auth(relay_request(&resident), NOW_MS)
                .await
                .expect_err("failed session must remain closed");
            assert!(matches!(closed, SigningClientError::SessionClosed));
            server_task.await.expect("server task");
        }

        #[tokio::test]
        async fn signing_vectors_wrong_session_poison_session() {
            let (client, mut server, _epoch, resident, _source) = fixture_client();
            let server_task = tokio::spawn(async move {
                let request: SigningFrameV1<RelayAuthSignRequestV1> =
                    read_request(&mut server).await;
                let frame = SigningResultFrameV1 {
                    protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
                    session_epoch: SafeU53::new(99).expect("valid mismatched epoch"),
                    sequence: request.sequence,
                    request_id: request.request_id,
                    operation: OperationV1::RelayAuthSign,
                    result: RelayAuthSignResultV1::Denied {
                        code: opaque("wrong-session"),
                    },
                };
                let bytes = encode_length_prefixed_result_frame(&frame).expect("encode response");
                server.write_all(&bytes).await.expect("write response");
            });

            let error = client
                .relay_auth(relay_request(&resident), NOW_MS)
                .await
                .expect_err("wrong session must fail");
            assert!(matches!(error, SigningClientError::ResponseBinding));
            let closed = client
                .relay_auth(relay_request(&resident), NOW_MS)
                .await
                .expect_err("wrong-session failure must close channel");
            assert!(matches!(closed, SigningClientError::SessionClosed));
            server_task.await.expect("server task");
        }

        #[tokio::test]
        async fn signing_vectors_expired_deadline_closes_channel() {
            let (client, _server, _epoch, resident, _source) = fixture_client();
            let deadline = SafeU53::new(NOW_MS).expect("valid exact deadline");
            let error = client
                .call_with_deadline::<_, RelayAuthSignResultV1>(
                    relay_request(&resident),
                    NOW_MS,
                    deadline,
                )
                .await
                .expect_err("zero-duration deadline must fail closed");
            assert!(matches!(error, SigningClientError::DeadlineElapsed));
            let closed = client
                .relay_auth(relay_request(&resident), NOW_MS)
                .await
                .expect_err("deadline failure must close channel");
            assert!(matches!(closed, SigningClientError::SessionClosed));
        }

        #[tokio::test]
        async fn signing_vectors_resident_mismatch_never_uses_channel() {
            let (client, _server, _epoch, _resident, _source) = fixture_client();
            let other = hex('3');
            let error = client
                .relay_auth(relay_request(&other), NOW_MS)
                .await
                .expect_err("resident mismatch must fail");
            assert!(matches!(error, SigningClientError::ResidentMismatch));
        }

        #[tokio::test]
        async fn signing_vectors_cancelled_exchange_leaves_session_closed() {
            let (client, mut server, _epoch, resident, _source) = fixture_client();
            let call_client = client.clone();
            let call_resident = resident.clone();
            let call = tokio::spawn(async move {
                call_client
                    .relay_auth(relay_request(&call_resident), NOW_MS)
                    .await
            });
            let _: SigningFrameV1<RelayAuthSignRequestV1> = read_request(&mut server).await;
            call.abort();
            let _ = call.await;

            let error = client
                .relay_auth(relay_request(&resident), NOW_MS)
                .await
                .expect_err("cancelled exchange must leave ambiguous session closed");
            assert!(matches!(error, SigningClientError::SessionClosed));
        }
    }
}

#[cfg(unix)]
pub use unix::{ManagedSigningClient, SigningClientError};

#[cfg(not(unix))]
mod unsupported {
    use luca_protocol::{
        Hex64, ManagedMessagePublishRequestV1, ManagedMessagePublishResultV1,
        RelayAuthSignRequestV1, RelayAuthSignResultV1, SafeU53,
    };
    use thiserror::Error;

    /// Managed inherited-channel signing is not implemented on this platform.
    #[derive(Debug, Error)]
    #[error("managed signing broker requires a proven exclusive inherited channel")]
    pub struct SigningClientError;

    /// Unavailable managed signing client on non-Unix platforms.
    #[derive(Clone)]
    pub struct ManagedSigningClient {
        session_epoch: SafeU53,
        resident_pubkey: Hex64,
    }

    impl ManagedSigningClient {
        /// Reject construction until the platform has an equivalent exclusive,
        /// close-on-exec inherited-handle implementation and proof.
        pub fn from_inherited_stdin(
            _session_epoch: SafeU53,
            _resident_pubkey: Hex64,
        ) -> Result<Self, SigningClientError> {
            Err(SigningClientError)
        }

        /// Return the desktop-issued session epoch bound to this channel.
        pub fn session_epoch(&self) -> SafeU53 {
            self.session_epoch
        }

        /// Return the resident public identity bound to this channel.
        pub fn resident_pubkey(&self) -> &Hex64 {
            &self.resident_pubkey
        }

        /// Reject relay authentication on unsupported platforms.
        pub async fn relay_auth(
            &self,
            _request: RelayAuthSignRequestV1,
            _now_unix_ms: u64,
        ) -> Result<RelayAuthSignResultV1, SigningClientError> {
            Err(SigningClientError)
        }

        /// Reject managed publication on unsupported platforms.
        pub async fn message_publish(
            &self,
            _request: ManagedMessagePublishRequestV1,
            _now_unix_ms: u64,
        ) -> Result<ManagedMessagePublishResultV1, SigningClientError> {
            Err(SigningClientError)
        }
    }
}

#[cfg(not(unix))]
pub use unsupported::{ManagedSigningClient, SigningClientError};
