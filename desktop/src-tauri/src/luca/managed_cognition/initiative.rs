//! Split bounded initiative framing from model wait and exact owned cancellation.
//! Parent must release awareness/continuity locks before `wait`; an accepted
//! write is not proof of native admission, success, spend or cancellation.

use super::*;
use luca_protocol::ResidentPrivateCognitionControlV1;

pub(super) struct PendingInitiative {
    control: ResidentPrivateCognitionControlV1,
    cancel_requested: bool,
    cancel_sent: bool,
}

/// One written private request. This owns no signer, tool or publication authority.
/// Dropping an undrained claim cancels only its own initiative and invalidates
/// only this private socket so a late reply cannot be assigned to another job.
pub(crate) struct ManagedInitiativeAdmission {
    client: Arc<ManagedCognitionClient>,
    request: ResidentPrivateCognitionRequestV1,
    control: ResidentPrivateCognitionControlV1,
    completed: bool,
}

/// Body-free exact-job cancellation handle, safe to retain outside a model wait.
#[derive(Clone)]
pub(crate) struct ManagedInitiativeCancellation {
    client: Arc<ManagedCognitionClient>,
    control: ResidentPrivateCognitionControlV1,
}
impl std::fmt::Debug for ManagedInitiativeAdmission {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ManagedInitiativeAdmission")
            .field("job_id", self.request.job_id())
            .finish_non_exhaustive()
    }
}
impl std::fmt::Debug for ManagedInitiativeCancellation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ManagedInitiativeCancellation")
            .field("control", &self.control)
            .finish_non_exhaustive()
    }
}

/// Short bounded write only. The parent may serialize its final authority checks
/// across this callback, then must release those locks before awaiting a result.
pub(crate) fn begin_initiative_planning(
    request: &InitiativePlanningRequestV1,
    epoch: SafeU53,
) -> Result<ManagedInitiativeAdmission, ManagedCognitionError> {
    if request.session_epoch != epoch {
        return Err(ManagedCognitionError::Invalid);
    }
    #[cfg(unix)]
    request
        .validate_for_transport_at(unix_time_millis())
        .map_err(|_| ManagedCognitionError::Invalid)?;
    begin(
        ResidentPrivateCognitionRequestV1::InitiativePlanning {
            request: request.clone(),
        },
        epoch,
    )
}

/// Admit one bounded tool-free authored-work frame, not a model wait or creation.
pub(crate) fn begin_initiative_pursuit(
    request: &luca_protocol::InitiativePursuitRequestV1,
    epoch: SafeU53,
) -> Result<ManagedInitiativeAdmission, ManagedCognitionError> {
    if request.session_epoch != epoch {
        return Err(ManagedCognitionError::Invalid);
    }
    #[cfg(unix)]
    request
        .validate_for_transport_at(unix_time_millis())
        .map_err(|_| ManagedCognitionError::Invalid)?;
    begin(
        ResidentPrivateCognitionRequestV1::InitiativePursuit {
            request: request.clone(),
        },
        epoch,
    )
}

/// Convenience endpoint; callers must not hold an authority/store lock across it.
pub(crate) fn request_initiative_planning(
    request: &InitiativePlanningRequestV1,
    epoch: SafeU53,
) -> Result<InitiativePlanningResultV1, ManagedCognitionError> {
    match begin_initiative_planning(request, epoch)?.wait()? {
        ResidentPrivateCognitionResultV1::InitiativePlanning { result } => Ok(result),
        _ => Err(ManagedCognitionError::Invalid),
    }
}

/// Tool-free synthesis/creative inquiry only; never web/shell research or publication.
pub(crate) fn request_initiative_pursuit(
    request: &luca_protocol::InitiativePursuitRequestV1,
    epoch: SafeU53,
) -> Result<luca_protocol::InitiativePursuitResultV1, ManagedCognitionError> {
    match begin_initiative_pursuit(request, epoch)?.wait()? {
        ResidentPrivateCognitionResultV1::InitiativePursuit { result } => Ok(result),
        _ => Err(ManagedCognitionError::Invalid),
    }
}

fn begin(
    request: ResidentPrivateCognitionRequestV1,
    epoch: SafeU53,
) -> Result<ManagedInitiativeAdmission, ManagedCognitionError> {
    request
        .validate()
        .map_err(|_| ManagedCognitionError::Invalid)?;
    let client = clients()
        .lock()
        .map_err(|_| ManagedCognitionError::Unavailable)?
        .get(request.resident_pubkey().as_str())
        .cloned()
        .ok_or(ManagedCognitionError::Unavailable)?;
    if client.session_epoch != epoch {
        return Err(ManagedCognitionError::Invalid);
    }
    client.begin_initiative(request)
}

impl ManagedInitiativeAdmission {
    /// Retain only this exact job's cancellation path; no private body is copied.
    pub(crate) fn cancellation(&self) -> ManagedInitiativeCancellation {
        ManagedInitiativeCancellation {
            client: Arc::clone(&self.client),
            control: self.control.clone(),
        }
    }
    /// Await one reply under the original deadline, outside source/continuity locks.
    /// Busy is a verified pre-admission outcome; all uncertain outcomes stay charged.
    pub(crate) fn wait(
        mut self,
    ) -> Result<ResidentPrivateCognitionResultV1, ManagedCognitionError> {
        let result = self.client.await_initiative(&self.request);
        self.completed = true;
        result
    }
}
impl ManagedInitiativeCancellation {
    /// Queue a narrow CancelInitiative frame, not a claim that a model stopped.
    /// Uses the separate <=1s writer, never the long model-await socket mutex.
    pub(crate) fn cancel(&self) -> Result<bool, ManagedCognitionError> {
        self.client.cancel_initiative(&self.control)
    }
}
impl Drop for ManagedInitiativeAdmission {
    fn drop(&mut self) {
        if !self.completed {
            let _ = self.client.cancel_initiative(&self.control);
            self.client.invalidate_initiative_transport();
        }
    }
}

fn control_for(
    request: &ResidentPrivateCognitionRequestV1,
) -> Option<ResidentPrivateCognitionControlV1> {
    let epoch = match request {
        ResidentPrivateCognitionRequestV1::InitiativePlanning { request } => request.session_epoch,
        ResidentPrivateCognitionRequestV1::InitiativePursuit { request } => request.session_epoch,
        _ => return None,
    };
    Some(ResidentPrivateCognitionControlV1::CancelInitiative {
        job_id: request.job_id().clone(),
        resident_pubkey: request.resident_pubkey().clone(),
        binding_ref: request.binding_ref().clone(),
        session_epoch: epoch,
    })
}

impl ManagedCognitionClient {
    #[cfg(unix)]
    fn begin_initiative(
        self: &Arc<Self>,
        request: ResidentPrivateCognitionRequestV1,
    ) -> Result<ManagedInitiativeAdmission, ManagedCognitionError> {
        if self.invalidated.load(Ordering::Acquire) {
            return Err(ManagedCognitionError::Unavailable);
        }
        let control = control_for(&request).ok_or(ManagedCognitionError::Invalid)?;
        let ResidentPrivateCognitionControlV1::CancelInitiative { session_epoch, .. } = &control;
        if !control.matches_initiative(&request)
            || request.resident_pubkey() != &self.resident_pubkey
            || request.binding_ref() != &self.binding_ref
            || *session_epoch != self.session_epoch
        {
            return Err(ManagedCognitionError::Invalid);
        }
        let frame = request_frame(&request)?;
        let mut pending = self
            .pending_initiative
            .try_lock()
            .map_err(|_| ManagedCognitionError::Busy)?;
        if pending.is_some() {
            return Err(ManagedCognitionError::Busy);
        }
        // No public/legacy request can write in the gap between begin and wait.
        let _channel = self
            .channel
            .try_lock()
            .map_err(|_| ManagedCognitionError::Busy)?;
        let mut writer = self
            .control_writer
            .try_lock()
            .map_err(|_| ManagedCognitionError::Busy)?;
        let remaining = request
            .deadline_unix_ms()
            .get()
            .saturating_sub(unix_time_millis());
        if remaining == 0 {
            return Err(ManagedCognitionError::Timeout);
        }
        writer
            .set_write_timeout(Some(Duration::from_millis(remaining.min(1000))))
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        // The marker is published atomically with complete framing. Cancellation
        // cannot arrive ahead of its request or wait behind a model's response.
        if let Err(error) = writer.write_all(&frame).and_then(|_| writer.flush()) {
            self.invalidated.store(true, Ordering::Release);
            let _ = writer.shutdown(std::net::Shutdown::Both);
            return Err(map_io(error));
        }
        *pending = Some(PendingInitiative {
            control: control.clone(),
            cancel_requested: false,
            cancel_sent: false,
        });
        Ok(ManagedInitiativeAdmission {
            client: Arc::clone(self),
            request,
            control,
            completed: false,
        })
    }
    #[cfg(not(unix))]
    fn begin_initiative(
        self: &Arc<Self>,
        _request: ResidentPrivateCognitionRequestV1,
    ) -> Result<ManagedInitiativeAdmission, ManagedCognitionError> {
        Err(ManagedCognitionError::Unavailable)
    }

    #[cfg(unix)]
    fn cancel_initiative(
        &self,
        control: &ResidentPrivateCognitionControlV1,
    ) -> Result<bool, ManagedCognitionError> {
        let mut pending = self
            .pending_initiative
            .try_lock()
            .map_err(|_| ManagedCognitionError::Busy)?;
        let Some(pending) = pending.as_mut().filter(|p| &p.control == control) else {
            return Ok(false);
        };
        if self.invalidated.load(Ordering::Acquire) {
            return Err(ManagedCognitionError::Unavailable);
        }
        if pending.cancel_sent {
            return Ok(true);
        }
        pending.cancel_requested = true; // local deny wins even if transport fails
        let mut writer = self
            .control_writer
            .try_lock()
            .map_err(|_| ManagedCognitionError::Busy)?;
        writer
            .set_write_timeout(Some(Duration::from_secs(1)))
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        let mut bytes = serde_json::to_vec(control).map_err(|_| ManagedCognitionError::Invalid)?;
        if bytes.len() >= 1024 {
            return Err(ManagedCognitionError::Invalid);
        }
        bytes.push(b'\n');
        writer
            .write_all(&bytes)
            .and_then(|_| writer.flush())
            .map_err(map_io)?;
        pending.cancel_sent = true;
        Ok(true)
    }
    #[cfg(not(unix))]
    fn cancel_initiative(
        &self,
        _control: &ResidentPrivateCognitionControlV1,
    ) -> Result<bool, ManagedCognitionError> {
        Err(ManagedCognitionError::Unavailable)
    }

    #[cfg(unix)]
    fn await_initiative(
        &self,
        request: &ResidentPrivateCognitionRequestV1,
    ) -> Result<ResidentPrivateCognitionResultV1, ManagedCognitionError> {
        let control = control_for(request).ok_or(ManagedCognitionError::Invalid)?;
        let mut channel = self
            .channel
            .lock()
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        let current = self
            .pending_initiative
            .lock()
            .map_err(|_| ManagedCognitionError::Unavailable)?
            .as_ref()
            .is_some_and(|pending| pending.control == control);
        if !current || self.invalidated.load(Ordering::Acquire) {
            return Err(ManagedCognitionError::Unavailable);
        }
        let result = (|| {
            let remaining = request
                .deadline_unix_ms()
                .get()
                .saturating_sub(unix_time_millis());
            if remaining == 0 {
                self.invalidate_channel(&channel);
                return Err(ManagedCognitionError::Timeout);
            }
            if channel
                .reader
                .get_ref()
                .set_read_timeout(Some(Duration::from_millis(remaining)))
                .is_err()
            {
                self.invalidate_channel(&channel);
                return Err(ManagedCognitionError::Unavailable);
            }
            let mut response = Vec::new();
            let read = match channel
                .reader
                .by_ref()
                .take((MAX_FRAME_BYTES + 1) as u64)
                .read_until(b'\n', &mut response)
            {
                Ok(read) => read,
                Err(error) => {
                    self.invalidate_channel(&channel);
                    return Err(map_io(error));
                }
            };
            if read == 0 || response.len() > MAX_FRAME_BYTES || response.last() != Some(&b'\n') {
                self.invalidate_channel(&channel);
                return Err(ManagedCognitionError::Unavailable);
            }
            let reply = decode_reply(&response, request);
            if reply.invalidates_channel {
                self.invalidate_channel(&channel);
            }
            let result = reply.result?;
            let now = unix_time_millis();
            match (&result, request) {
                (
                    ResidentPrivateCognitionResultV1::InitiativePlanning { result },
                    ResidentPrivateCognitionRequestV1::InitiativePlanning { request },
                ) => result
                    .validate_against_at(request, now)
                    .map_err(|_| ManagedCognitionError::Invalid)?,
                (
                    ResidentPrivateCognitionResultV1::InitiativePursuit { result },
                    ResidentPrivateCognitionRequestV1::InitiativePursuit { request },
                ) => result
                    .validate_against_at(request, now)
                    .map_err(|_| ManagedCognitionError::Invalid)?,
                _ => return Err(ManagedCognitionError::Invalid),
            }
            Ok(result)
        })();
        let mut pending = self
            .pending_initiative
            .lock()
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        let denied = pending
            .as_ref()
            .is_some_and(|p| p.control == control && p.cancel_requested);
        if pending.as_ref().is_some_and(|p| p.control == control) {
            *pending = None;
        }
        if denied {
            Err(ManagedCognitionError::Unavailable)
        } else {
            result
        }
    }
    #[cfg(not(unix))]
    fn await_initiative(
        &self,
        _request: &ResidentPrivateCognitionRequestV1,
    ) -> Result<ResidentPrivateCognitionResultV1, ManagedCognitionError> {
        Err(ManagedCognitionError::Unavailable)
    }

    fn invalidate_initiative_transport(&self) {
        self.invalidated.store(true, Ordering::Release);
        #[cfg(unix)]
        if let Ok(writer) = self.control_writer.try_lock() {
            let _ = writer.shutdown(std::net::Shutdown::Both);
        }
    }
}

#[cfg(all(test, unix))]
#[path = "initiative_tests.rs"]
mod tests;
