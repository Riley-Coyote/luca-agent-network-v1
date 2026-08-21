use super::*;

// ── the exchange half ───────────────────────────────────────────────────────

/// A publication authority that places the final inside an exchange and can be
/// told to lose the race for its turn a fixed number of times.
struct ExchangeAwareAuthority {
    plan: crate::luca::exchange_plan::ExchangePlan,
    /// How many more times the relay will answer "that turn is already spoken".
    collisions: usize,
    /// Every exact event this authority was handed, in order.
    submissions: Arc<Mutex<Vec<String>>>,
    /// Turns handed back by the retune, in order.
    retunes: Arc<Mutex<Vec<u8>>>,
    /// Refuse to retune at all, so the loop must give up honestly.
    retune_exhausted: bool,
    /// Refuse every resolution after this many have been answered — the shape
    /// of a restart whose frozen decision rows were pruned beneath a final that
    /// had already published.
    deny_resolve_after: usize,
    /// How many resolutions this authority was actually asked for.
    resolves: Arc<Mutex<usize>>,
}

impl ExchangeAwareAuthority {
    fn new(exchange_id: Hex64, turn: u8, granted: Vec<Hex64>, collisions: usize) -> Self {
        Self {
            plan: crate::luca::exchange_plan::ExchangePlan {
                exchange: Some(
                    luca_protocol::ExchangeTurnTag::new(exchange_id, turn).expect("turn"),
                ),
                granted_p_tags: granted,
                replace_p_tags: false,
            },
            collisions,
            submissions: Arc::new(Mutex::new(Vec::new())),
            retunes: Arc::new(Mutex::new(Vec::new())),
            retune_exhausted: false,
            deny_resolve_after: usize::MAX,
            resolves: Arc::new(Mutex::new(0)),
        }
    }
}

impl ManagedMessagePublicationAuthority for ExchangeAwareAuthority {
    fn resolve_exchange(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _now_unix_secs: u64,
    ) -> Result<crate::luca::exchange_plan::ExchangePlan, ManagedPublicationAuthorityError> {
        let mut resolves = self.resolves.lock().expect("resolves");
        *resolves += 1;
        if *resolves > self.deny_resolve_after {
            return Err(ManagedPublicationAuthorityError::ExchangeDenied(
                "exchange_unknown",
            ));
        }
        Ok(self.plan.clone())
    }

    fn retune_exchange_turn(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        _refused_event_id: &str,
        _outbox: &mut ManagedMessageOutbox,
        _now_unix_secs: u64,
    ) -> Result<luca_protocol::ExchangeTurnTag, ManagedPublicationAuthorityError> {
        if self.retune_exhausted {
            return Err(ManagedPublicationAuthorityError::ExchangeDenied(
                "exchange_exhausted",
            ));
        }
        let current = request.exchange.as_ref().expect("a turn to move from");
        let next = luca_protocol::ExchangeTurnTag::new(
            current.exchange_id.clone(),
            current.turn.saturating_add(1).min(10),
        )
        .expect("next turn");
        self.retunes.lock().expect("retunes").push(next.turn);
        Ok(next)
    }

    fn authorize_request(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _now_unix_secs: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Ok(())
    }

    fn publish_prepared(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let event = outbox
            .event_for_submission(&request.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?
            .to_owned();
        self.submissions.lock().expect("submissions").push(event);
        outbox
            .mark_submitted(&request.idempotency_key, installation_session_id, false)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
        if self.collisions > 0 {
            self.collisions -= 1;
            return Err(ManagedPublicationAuthorityError::ExchangeTurnTaken);
        }
        outbox
            .mark_accepted(
                &request.idempotency_key,
                OpaqueId::parse("publication-1").expect("valid publication receipt"),
            )
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
        Ok(())
    }
}

/// A broker wired to an exchange-aware authority, plus the runtime binding and
/// the two logs the tests read: every exact event submitted, and every turn the
/// retune handed back.
type ExchangeBrokerHarness = (
    ResidentSigningBroker,
    Hex64,
    Arc<Mutex<Vec<String>>>,
    Arc<Mutex<Vec<u8>>>,
);

fn exchange_broker(authority: ExchangeAwareAuthority) -> ExchangeBrokerHarness {
    let keys = Keys::parse(&"01".repeat(32)).expect("valid fixture key");
    let runtime = hex('c');
    let submissions = Arc::clone(&authority.submissions);
    let retunes = Arc::clone(&authority.retunes);
    let broker = ResidentSigningBroker::new_with_publication_authority(
        keys.clone(),
        LocalBrokerSessionBinding {
            owner_pubkey: hex('a'),
            resident_pubkey: Hex64::parse(keys.public_key().to_hex())
                .expect("valid resident pubkey"),
            acp_pid: 8123,
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            runtime_configuration_sha256: runtime.clone(),
            installation_session_id: OpaqueId::parse("installation-1")
                .expect("valid installation ID"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: None,
        },
        Box::new(authority),
    )
    .expect("matching broker");
    (broker, runtime, submissions, retunes)
}

fn drive_publish(
    broker: &mut ResidentSigningBroker,
    runtime: &Hex64,
) -> ManagedMessagePublishResultV1 {
    drive_publish_at(broker, runtime, 1, "publish-1")
}

fn drive_publish_at(
    broker: &mut ResidentSigningBroker,
    runtime: &Hex64,
    sequence: u64,
    request_id: &str,
) -> ManagedMessagePublishResultV1 {
    let request = publish_request(broker);
    let frame = encoded_publish_frame(broker, &request, sequence, request_id);
    let response = broker
        .handle_frame(
            &frame,
            LocalBrokerCaller {
                acp_pid: 8123,
                runtime_configuration_sha256: runtime,
            },
            1_700_000_000_000,
        )
        .expect("publish response");
    decode_length_prefixed_result_frame::<ManagedMessagePublishResultV1>(&response)
        .expect("valid response")
        .result
}

fn tags_of(event_json: &str) -> Vec<Vec<String>> {
    nostr::Event::from_json(event_json)
        .expect("valid event")
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect()
}

#[test]
fn a_final_inside_an_exchange_carries_the_turn_tag_after_its_recipients() {
    let exchange_id = hex('9');
    let (mut broker, runtime, submissions, _) = exchange_broker(ExchangeAwareAuthority::new(
        exchange_id.clone(),
        1,
        vec![hex('b')],
        0,
    ));
    assert!(matches!(
        drive_publish(&mut broker, &runtime),
        ManagedMessagePublishResultV1::Published { .. }
    ));
    let submissions = submissions.lock().expect("submissions");
    assert_eq!(submissions.len(), 1);
    assert_eq!(
        tags_of(&submissions[0]),
        vec![
            vec!["h".to_owned(), "conversation-1".to_owned()],
            vec![
                "e".to_owned(),
                hex('d').as_str().to_owned(),
                String::new(),
                "root".to_owned()
            ],
            vec![
                "e".to_owned(),
                hex('e').as_str().to_owned(),
                String::new(),
                "reply".to_owned()
            ],
            vec!["p".to_owned(), hex('a').as_str().to_owned()],
            vec!["p".to_owned(), hex('b').as_str().to_owned()],
            vec!["p".to_owned(), hex('f').as_str().to_owned()],
            vec![
                "exchange".to_owned(),
                exchange_id.as_str().to_owned(),
                "1".to_owned()
            ],
        ],
        "the sibling is addressed and the turn is claimed, in a fixed order"
    );
}

#[test]
fn losing_the_race_for_a_turn_resigns_the_identical_draft_on_the_next_one() {
    let exchange_id = hex('9');
    let (mut broker, runtime, submissions, retunes) = exchange_broker(ExchangeAwareAuthority::new(
        exchange_id.clone(),
        2,
        vec![hex('b')],
        1,
    ));
    assert!(matches!(
        drive_publish(&mut broker, &runtime),
        ManagedMessagePublishResultV1::Published { .. }
    ));
    let submissions = submissions.lock().expect("submissions");
    assert_eq!(submissions.len(), 2, "exactly one refreeze");
    let first = nostr::Event::from_json(submissions[0].as_str()).expect("first");
    let second = nostr::Event::from_json(submissions[1].as_str()).expect("second");
    assert_eq!(
        first.content, second.content,
        "nothing the resident said changed"
    );
    assert_ne!(first.id, second.id, "different bytes, therefore a new id");
    let turn_tag = |event: &nostr::Event| {
        luca_protocol::ExchangeTurnTag::find(
            &event
                .tags
                .iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect::<Vec<_>>(),
        )
        .expect("well-formed")
        .expect("a turn tag")
    };
    assert_eq!(turn_tag(&first).turn, 2);
    assert_eq!(turn_tag(&second).turn, 3);
    assert_eq!(turn_tag(&second).exchange_id, exchange_id);
    assert_eq!(*retunes.lock().expect("retunes"), vec![3]);
}

#[test]
fn the_refreeze_loop_is_bounded_by_the_ceiling_and_then_refuses_honestly() {
    let (mut broker, runtime, submissions, _) = exchange_broker(ExchangeAwareAuthority::new(
        hex('9'),
        1,
        Vec::new(),
        usize::MAX,
    ));
    let result = drive_publish(&mut broker, &runtime);
    match result {
        ManagedMessagePublishResultV1::Denied { code } => {
            assert_eq!(code.as_str(), "exchange_exhausted")
        }
        other => panic!("expected an honest refusal, got {other:?}"),
    }
    assert!(
        submissions.lock().expect("submissions").len()
            <= usize::from(luca_protocol::EXCHANGE_BUCKET_CEILING) + 1,
        "the loop never outruns the ceiling"
    );
}

#[test]
fn a_final_that_cannot_be_retuned_is_refused_rather_than_dropped() {
    let mut authority = ExchangeAwareAuthority::new(hex('9'), 1, Vec::new(), 1);
    authority.retune_exhausted = true;
    let (mut broker, runtime, submissions, _) = exchange_broker(authority);
    match drive_publish(&mut broker, &runtime) {
        ManagedMessagePublishResultV1::Denied { code } => {
            assert_eq!(code.as_str(), "exchange_exhausted")
        }
        other => panic!("expected an honest refusal, got {other:?}"),
    }
    assert_eq!(submissions.lock().expect("submissions").len(), 1);
}

/// A reply that already published is finished, and the exchange has no say
/// left. Asking it again on a restart — after the frozen decision and dispatch
/// rows have been pruned beneath it — would refuse a reply that is already in
/// the room.
#[test]
fn a_final_that_already_published_is_replayed_before_the_exchange_is_asked_again() {
    let mut authority = ExchangeAwareAuthority::new(hex('9'), 1, vec![hex('b')], 0);
    authority.deny_resolve_after = 1;
    let resolves = Arc::clone(&authority.resolves);
    let (mut broker, runtime, submissions, _) = exchange_broker(authority);
    assert!(matches!(
        drive_publish(&mut broker, &runtime),
        ManagedMessagePublishResultV1::Published { .. }
    ));

    match drive_publish_at(&mut broker, &runtime, 2, "publish-2") {
        ManagedMessagePublishResultV1::Replayed { .. } => {}
        other => panic!("expected the accepted receipt back, got {other:?}"),
    }
    assert_eq!(
        *resolves.lock().expect("resolves"),
        1,
        "the exchange is asked once — when the final was actually placed"
    );
    assert_eq!(
        submissions.lock().expect("submissions").len(),
        1,
        "a replay never publishes a second time"
    );
}

#[test]
fn a_refused_exchange_placement_never_reaches_the_outbox() {
    struct RefusingAuthority;
    impl ManagedMessagePublicationAuthority for RefusingAuthority {
        fn resolve_exchange(
            &mut self,
            _request: &ManagedMessagePublishRequestV1,
            _now_unix_secs: u64,
        ) -> Result<crate::luca::exchange_plan::ExchangePlan, ManagedPublicationAuthorityError>
        {
            Err(ManagedPublicationAuthorityError::ExchangeDenied(
                "exchange_closed",
            ))
        }

        fn authorize_request(
            &mut self,
            _request: &ManagedMessagePublishRequestV1,
            _now_unix_secs: u64,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            panic!("a refused placement must never be authorized");
        }

        fn publish_prepared(
            &mut self,
            _request: &ManagedMessagePublishRequestV1,
            _outbox: &mut ManagedMessageOutbox,
            _installation_session_id: &OpaqueId,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            panic!("a refused placement must never be published");
        }
    }
    let keys = Keys::parse(&"01".repeat(32)).expect("valid fixture key");
    let runtime = hex('c');
    let mut broker = ResidentSigningBroker::new_with_publication_authority(
        keys.clone(),
        LocalBrokerSessionBinding {
            owner_pubkey: hex('a'),
            resident_pubkey: Hex64::parse(keys.public_key().to_hex())
                .expect("valid resident pubkey"),
            acp_pid: 8123,
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            runtime_configuration_sha256: runtime.clone(),
            installation_session_id: OpaqueId::parse("installation-1")
                .expect("valid installation ID"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: None,
        },
        Box::new(RefusingAuthority),
    )
    .expect("matching broker");
    match drive_publish(&mut broker, &runtime) {
        ManagedMessagePublishResultV1::Denied { code } => {
            assert_eq!(code.as_str(), "exchange_closed")
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}
