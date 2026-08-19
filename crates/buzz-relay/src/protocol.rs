//! NIP-01 client/relay message parsing and formatting.

use nostr::{Event, Filter};
use serde_json::Value;

use crate::error::{RelayError, Result};

/// NIP-11 advertised limit: subscription IDs longer than this are rejected.
const MAX_SUB_ID_LENGTH: usize = 256;

/// NIP-11 advertised limit: REQ messages with more filters than this are rejected.
const MAX_FILTERS_PER_REQ: usize = 10;

/// Maximum exchange ids one `#exchange` sidecar may carry.
///
/// The strip counts a handful of live exchanges in one room; anything past this
/// is a scan dressed up as a filter.
const MAX_EXCHANGE_FILTER_VALUES: usize = 16;

/// The refusal a caller gets when it asks for `#exchange` on a surface that
/// cannot honor it. Shared so REQ and `POST /query`'s specialised paths say the
/// same sentence.
pub const EXCHANGE_FILTER_UNSUPPORTED: &str =
    "unsupported: #exchange is only supported on COUNT and POST /query";

/// Extract the Luca `#exchange` filter key from a filter's **raw JSON**.
///
/// `nostr` 0.44 deserializes `generic_tags` with a visitor that keeps a `#key`
/// only when the key is `#` plus exactly one character; every multi-character
/// key is silently discarded (`nostr-0.44/src/filter.rs`). So `#exchange` never
/// reaches `nostr::Filter` at all, and a handler working from the parsed filter
/// would answer as though the constraint were absent — a silent fail-**open** on
/// the exact number the exchange strip renders as `spent`.
///
/// The sidecar therefore travels beside the parsed filter, read from the raw
/// JSON that every entry point already has. It is honored on COUNT and one-shot
/// `POST /query` (both of which re-check candidate rows against the protocol's
/// turn-tag parse) and refused on live REQ, whose fan-out leg matches against
/// `nostr::Filter` alone and would over-deliver.
///
/// Returns `Ok(None)` when absent, `Err` when present but not a bounded array
/// of lowercase 64-hex ids.
pub fn extract_exchange_sidecar(filter: &Value) -> Result<Option<Vec<String>>> {
    let Some(raw) = filter.get("#exchange") else {
        return Ok(None);
    };
    let Some(values) = raw.as_array() else {
        return Err(RelayError::InvalidMessage(
            "#exchange must be an array of exchange ids".to_string(),
        ));
    };
    if values.is_empty() || values.len() > MAX_EXCHANGE_FILTER_VALUES {
        return Err(RelayError::InvalidMessage(format!(
            "#exchange must carry 1..={MAX_EXCHANGE_FILTER_VALUES} exchange ids"
        )));
    }
    let mut ids = Vec::with_capacity(values.len());
    for value in values {
        let Some(id) = value.as_str() else {
            return Err(RelayError::InvalidMessage(
                "#exchange ids must be strings".to_string(),
            ));
        };
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(RelayError::InvalidMessage(
                "#exchange ids must be 64 lowercase hex characters".to_string(),
            ));
        }
        ids.push(id.to_string());
    }
    Ok(Some(ids))
}

/// A message sent by a NIP-01 client to the relay.
#[derive(Debug, Clone)]
pub enum ClientMessage {
    /// An EVENT message submitting a signed Nostr event.
    Event(Event),
    /// A REQ message opening a subscription with one or more filters.
    Req {
        /// The client-assigned subscription identifier.
        sub_id: String,
        /// The filters that determine which events are delivered.
        filters: Vec<Filter>,
        /// Per-filter Luca `#exchange` sidecar, parallel to `filters`.
        /// See [`extract_exchange_sidecar`].
        exchange_ids: Vec<Option<Vec<String>>>,
    },
    /// A CLOSE message cancelling an active subscription.
    Close(String),
    /// A COUNT message requesting aggregate counts (NIP-45).
    Count {
        /// The client-assigned subscription identifier.
        sub_id: String,
        /// The filters to count against.
        filters: Vec<Filter>,
        /// Per-filter Luca `#exchange` sidecar, parallel to `filters`.
        /// See [`extract_exchange_sidecar`].
        exchange_ids: Vec<Option<Vec<String>>>,
    },
    /// An AUTH message responding to a NIP-42 challenge.
    Auth(Event),
}

impl ClientMessage {
    /// Parse a raw JSON WebSocket frame into a [`ClientMessage`].
    pub fn parse(raw: &str) -> Result<Self> {
        let value: Value = serde_json::from_str(raw)
            .map_err(|e| RelayError::InvalidMessage(format!("JSON parse error: {e}")))?;

        let arr = value
            .as_array()
            .ok_or_else(|| RelayError::InvalidMessage("expected JSON array".to_string()))?;

        if arr.is_empty() {
            return Err(RelayError::InvalidMessage("empty array".to_string()));
        }

        let msg_type = arr[0].as_str().ok_or_else(|| {
            RelayError::InvalidMessage("first element must be a string".to_string())
        })?;

        match msg_type {
            "EVENT" => {
                if arr.len() < 2 {
                    return Err(RelayError::InvalidMessage(
                        "EVENT requires event object".to_string(),
                    ));
                }
                let event: Event = serde_json::from_value(arr[1].clone())
                    .map_err(|e| RelayError::InvalidMessage(format!("invalid event: {e}")))?;
                Ok(ClientMessage::Event(event))
            }
            "REQ" => {
                if arr.len() < 2 {
                    return Err(RelayError::InvalidMessage(
                        "REQ requires sub_id".to_string(),
                    ));
                }
                let sub_id = arr[1]
                    .as_str()
                    .ok_or_else(|| {
                        RelayError::InvalidMessage("REQ sub_id must be a string".to_string())
                    })?
                    .to_string();
                if sub_id.is_empty() {
                    return Err(RelayError::InvalidMessage(
                        "REQ sub_id must not be empty".to_string(),
                    ));
                }
                // Enforce NIP-11 advertised max_subid_length: 256
                if sub_id.len() > MAX_SUB_ID_LENGTH {
                    return Err(RelayError::InvalidMessage(format!(
                        "REQ sub_id exceeds maximum length of {MAX_SUB_ID_LENGTH} bytes"
                    )));
                }
                let filter_values = &arr[2..];
                // Enforce NIP-11 advertised max_filters: 10
                if filter_values.len() > MAX_FILTERS_PER_REQ {
                    return Err(RelayError::InvalidMessage(format!(
                        "REQ contains {} filters, maximum is {MAX_FILTERS_PER_REQ}",
                        filter_values.len()
                    )));
                }
                let filters: Vec<Filter> = filter_values
                    .iter()
                    .map(|v| {
                        serde_json::from_value(v.clone())
                            .map_err(|e| RelayError::InvalidMessage(format!("invalid filter: {e}")))
                    })
                    .collect::<Result<Vec<_>>>()?;
                let exchange_ids = filter_values
                    .iter()
                    .map(extract_exchange_sidecar)
                    .collect::<Result<Vec<_>>>()?;
                Ok(ClientMessage::Req {
                    sub_id,
                    filters,
                    exchange_ids,
                })
            }
            "COUNT" => {
                if arr.len() < 2 {
                    return Err(RelayError::InvalidMessage(
                        "COUNT requires sub_id".to_string(),
                    ));
                }
                let sub_id = arr[1]
                    .as_str()
                    .ok_or_else(|| {
                        RelayError::InvalidMessage("COUNT sub_id must be a string".to_string())
                    })?
                    .to_string();
                if sub_id.is_empty() {
                    return Err(RelayError::InvalidMessage(
                        "COUNT sub_id must not be empty".to_string(),
                    ));
                }
                if sub_id.len() > MAX_SUB_ID_LENGTH {
                    return Err(RelayError::InvalidMessage(format!(
                        "COUNT sub_id exceeds maximum length of {MAX_SUB_ID_LENGTH} bytes"
                    )));
                }
                let filter_values = &arr[2..];
                if filter_values.len() > MAX_FILTERS_PER_REQ {
                    return Err(RelayError::InvalidMessage(format!(
                        "COUNT contains {} filters, maximum is {MAX_FILTERS_PER_REQ}",
                        filter_values.len()
                    )));
                }
                let filters: Vec<Filter> = filter_values
                    .iter()
                    .map(|v| {
                        serde_json::from_value(v.clone())
                            .map_err(|e| RelayError::InvalidMessage(format!("invalid filter: {e}")))
                    })
                    .collect::<Result<Vec<_>>>()?;
                let exchange_ids = filter_values
                    .iter()
                    .map(extract_exchange_sidecar)
                    .collect::<Result<Vec<_>>>()?;
                Ok(ClientMessage::Count {
                    sub_id,
                    filters,
                    exchange_ids,
                })
            }
            "CLOSE" => {
                if arr.len() < 2 {
                    return Err(RelayError::InvalidMessage(
                        "CLOSE requires sub_id".to_string(),
                    ));
                }
                let sub_id = arr[1]
                    .as_str()
                    .ok_or_else(|| {
                        RelayError::InvalidMessage("CLOSE sub_id must be a string".to_string())
                    })?
                    .to_string();
                Ok(ClientMessage::Close(sub_id))
            }
            "AUTH" => {
                if arr.len() < 2 {
                    return Err(RelayError::InvalidMessage(
                        "AUTH requires event object".to_string(),
                    ));
                }
                let event: Event = serde_json::from_value(arr[1].clone())
                    .map_err(|e| RelayError::InvalidMessage(format!("invalid auth event: {e}")))?;
                Ok(ClientMessage::Auth(event))
            }
            other => Err(RelayError::InvalidMessage(format!(
                "unknown message type: {other}"
            ))),
        }
    }
}

/// Helpers for formatting NIP-01 relay-to-client messages as JSON strings.
pub struct RelayMessage;

impl RelayMessage {
    /// Format an AUTH challenge message.
    pub fn auth_challenge(challenge: &str) -> String {
        serde_json::json!(["AUTH", challenge]).to_string()
    }

    /// Format an EVENT message delivering an event to a subscriber.
    pub fn event(sub_id: &str, event: &Event) -> String {
        let event_json = serde_json::to_value(event)
            .expect("SAFETY: nostr::Event serialization is infallible for well-formed events");
        serde_json::json!(["EVENT", sub_id, event_json]).to_string()
    }

    /// Format a NOTICE message with a human-readable string.
    pub fn notice(message: &str) -> String {
        serde_json::json!(["NOTICE", message]).to_string()
    }

    /// Format an EOSE (End of Stored Events) message for a subscription.
    pub fn eose(sub_id: &str) -> String {
        serde_json::json!(["EOSE", sub_id]).to_string()
    }

    /// Format an OK message acknowledging an EVENT submission.
    pub fn ok(event_id: &str, accepted: bool, message: &str) -> String {
        serde_json::json!(["OK", event_id, accepted, message]).to_string()
    }

    /// Format a CLOSED message indicating a subscription was terminated by the relay.
    pub fn closed(sub_id: &str, message: &str) -> String {
        serde_json::json!(["CLOSED", sub_id, message]).to_string()
    }

    /// Format a COUNT response (NIP-45).
    pub fn count(sub_id: &str, count: u64) -> String {
        serde_json::json!(["COUNT", sub_id, {"count": count}]).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::test_helpers::make_event;
    use nostr::{EventBuilder, Keys, Kind};

    fn make_auth_event(keys: &Keys, challenge: &str, relay: &str) -> Event {
        let url: nostr::RelayUrl = relay.parse().expect("url");
        EventBuilder::auth(challenge, url)
            .sign_with_keys(keys)
            .expect("sign")
    }

    // Type alias to avoid clippy::type_complexity warning on the test case table.
    // The tuple holds: raw JSON string + a boxed checker closure.
    type ParseCase<'a> = (&'a str, Box<dyn Fn(ClientMessage)>);

    #[test]
    fn parse_valid_messages() {
        let keys = Keys::generate();
        let event = make_event(Kind::TextNote);
        let auth_event = make_auth_event(&keys, "challenge", "wss://relay.example.com");
        let filter = Filter::new().kind(Kind::TextNote);

        let cases: &[ParseCase<'_>] = &[
            (
                &serde_json::json!(["EVENT", serde_json::to_value(&event).unwrap()]).to_string(),
                Box::new(move |m| match m {
                    ClientMessage::Event(e) => assert_eq!(e.id, event.id),
                    _ => panic!("expected Event"),
                }),
            ),
            (
                &serde_json::json!(["REQ", "sub1", serde_json::to_value(&filter).unwrap()])
                    .to_string(),
                Box::new(|m| match m {
                    ClientMessage::Req {
                        sub_id,
                        filters,
                        exchange_ids,
                    } => {
                        assert_eq!(sub_id, "sub1");
                        assert_eq!(filters.len(), 1);
                        assert_eq!(exchange_ids, vec![None]);
                    }
                    _ => panic!("expected Req"),
                }),
            ),
            (
                r#"["CLOSE", "sub1"]"#,
                Box::new(|m| match m {
                    ClientMessage::Close(id) => assert_eq!(id, "sub1"),
                    _ => panic!("expected Close"),
                }),
            ),
            (
                &serde_json::json!(["AUTH", serde_json::to_value(&auth_event).unwrap()])
                    .to_string(),
                Box::new(move |m| match m {
                    ClientMessage::Auth(e) => assert_eq!(e.id, auth_event.id),
                    _ => panic!("expected Auth"),
                }),
            ),
        ];

        for (raw, check) in cases {
            let msg = ClientMessage::parse(raw).expect("parse");
            check(msg);
        }
    }

    #[test]
    fn parse_req_multiple_filters() {
        let f1 = Filter::new().kind(Kind::TextNote);
        let f2 = Filter::new().kind(Kind::Metadata);
        let raw = serde_json::json!([
            "REQ",
            "sub2",
            serde_json::to_value(&f1).unwrap(),
            serde_json::to_value(&f2).unwrap()
        ])
        .to_string();
        match ClientMessage::parse(&raw).unwrap() {
            ClientMessage::Req {
                sub_id,
                filters,
                exchange_ids,
            } => {
                assert_eq!(sub_id, "sub2");
                assert_eq!(filters.len(), 2);
                assert_eq!(exchange_ids, vec![None, None]);
            }
            _ => panic!("expected Req"),
        }
    }

    /// The failure this whole sidecar exists to prevent: `nostr::Filter` throws
    /// `#exchange` away at deserialize time, so a handler reading only the
    /// parsed filter answers a *wider* question than was asked — and `spent`
    /// would read as every message in the room.
    #[test]
    fn nostr_filter_silently_drops_the_multi_char_exchange_key() {
        let raw = serde_json::json!({
            "kinds": [9],
            "#exchange": ["ab".repeat(32)],
        });
        let filter: Filter = serde_json::from_value(raw.clone()).expect("filter parses");
        assert!(
            !serde_json::to_string(&filter)
                .expect("filter re-serializes")
                .contains("exchange"),
            "if nostr ever starts keeping #exchange, the sidecar can be retired"
        );
        // The sidecar reads it from the raw JSON that parse threw away.
        assert_eq!(
            extract_exchange_sidecar(&raw).expect("sidecar parses"),
            Some(vec!["ab".repeat(32)])
        );
    }

    #[test]
    fn exchange_sidecar_is_absent_when_the_key_is_absent() {
        let raw = serde_json::json!({ "kinds": [9], "#h": ["room"] });
        assert_eq!(extract_exchange_sidecar(&raw).expect("no sidecar"), None);
    }

    #[test]
    fn exchange_sidecar_refuses_every_shape_that_is_not_bounded_hex64() {
        let id = "ab".repeat(32);
        let cases = [
            serde_json::json!({ "#exchange": id.clone() }), // not an array
            serde_json::json!({ "#exchange": [] }),         // empty
            serde_json::json!({ "#exchange": [1234] }),     // not a string
            serde_json::json!({ "#exchange": ["ab"] }),     // too short
            serde_json::json!({ "#exchange": [id.to_uppercase()] }), // not lowercase
            serde_json::json!({ "#exchange": ["zz".repeat(32)] }), // not hex
            serde_json::json!({ "#exchange": vec![id.clone(); MAX_EXCHANGE_FILTER_VALUES + 1] }),
        ];
        for raw in cases {
            assert!(
                extract_exchange_sidecar(&raw).is_err(),
                "should have refused: {raw}"
            );
        }
        // The boundary itself is allowed.
        let at_limit =
            serde_json::json!({ "#exchange": vec![id.clone(); MAX_EXCHANGE_FILTER_VALUES] });
        assert_eq!(
            extract_exchange_sidecar(&at_limit)
                .expect("at the limit is fine")
                .map(|ids| ids.len()),
            Some(MAX_EXCHANGE_FILTER_VALUES)
        );
    }

    #[test]
    fn req_and_count_carry_the_sidecar_parallel_to_their_filters() {
        let id = "ab".repeat(32);
        for verb in ["REQ", "COUNT"] {
            let raw = serde_json::json!([
                verb,
                "sub1",
                { "kinds": [9] },
                { "kinds": [9], "#exchange": [id.clone()] },
            ])
            .to_string();
            let (filters, exchange_ids) = match ClientMessage::parse(&raw).expect("parses") {
                ClientMessage::Req {
                    filters,
                    exchange_ids,
                    ..
                }
                | ClientMessage::Count {
                    filters,
                    exchange_ids,
                    ..
                } => (filters, exchange_ids),
                other => panic!("expected {verb}, got {other:?}"),
            };
            // Parallel and index-aligned: the connection layer and the COUNT
            // handler both index the sidecar by filter position.
            assert_eq!(filters.len(), 2, "{verb}");
            assert_eq!(exchange_ids, vec![None, Some(vec![id.clone()])], "{verb}");
        }
    }

    #[test]
    fn a_malformed_exchange_sidecar_fails_the_whole_message() {
        // Fail closed: a filter whose `#exchange` cannot be read must not be
        // answered as though it carried no constraint at all.
        for verb in ["REQ", "COUNT"] {
            let raw = serde_json::json!([verb, "sub1", { "kinds": [9], "#exchange": ["nope"] }])
                .to_string();
            assert!(
                matches!(
                    ClientMessage::parse(&raw),
                    Err(RelayError::InvalidMessage(_))
                ),
                "{verb} with a malformed #exchange must be refused"
            );
        }
    }

    #[test]
    fn parse_invalid_messages() {
        let cases = [
            ("not json", "JSON"),
            ("[]", "empty"),
            (r#"["UNKNOWN", "data"]"#, "unknown"),
            (r#"["EVENT"]"#, "EVENT requires"),
            (r#"["REQ"]"#, "REQ requires"),
            (r#"["REQ", ""]"#, "must not be empty"),
        ];

        for (raw, hint) in cases {
            let err = ClientMessage::parse(raw).unwrap_err();
            assert!(
                matches!(err, RelayError::InvalidMessage(_)),
                "expected InvalidMessage for {raw:?}, got {err:?}"
            );
            let _ = hint; // used for readability only
        }
    }

    #[test]
    fn parse_req_sub_id_too_long_is_rejected() {
        let long_id = "x".repeat(MAX_SUB_ID_LENGTH + 1);
        let raw = serde_json::json!(["REQ", long_id]).to_string();
        let err = ClientMessage::parse(&raw).unwrap_err();
        assert!(
            matches!(err, RelayError::InvalidMessage(_)),
            "expected InvalidMessage for oversized sub_id, got {err:?}"
        );
    }

    #[test]
    fn parse_req_too_many_filters_is_rejected() {
        let filter = Filter::new().kind(Kind::TextNote);
        let filter_val = serde_json::to_value(&filter).unwrap();
        let mut arr: Vec<serde_json::Value> = vec![
            serde_json::Value::String("REQ".to_string()),
            serde_json::Value::String("sub3".to_string()),
        ];
        for _ in 0..=MAX_FILTERS_PER_REQ {
            arr.push(filter_val.clone());
        }
        let raw = serde_json::Value::Array(arr).to_string();
        let err = ClientMessage::parse(&raw).unwrap_err();
        assert!(
            matches!(err, RelayError::InvalidMessage(_)),
            "expected InvalidMessage for too many filters, got {err:?}"
        );
    }

    #[test]
    fn parse_req_exactly_max_filters_is_accepted() {
        let filter = Filter::new().kind(Kind::TextNote);
        let filter_val = serde_json::to_value(&filter).unwrap();
        let mut arr: Vec<serde_json::Value> = vec![
            serde_json::Value::String("REQ".to_string()),
            serde_json::Value::String("sub4".to_string()),
        ];
        for _ in 0..MAX_FILTERS_PER_REQ {
            arr.push(filter_val.clone());
        }
        let raw = serde_json::Value::Array(arr).to_string();
        assert!(
            ClientMessage::parse(&raw).is_ok(),
            "exactly {MAX_FILTERS_PER_REQ} filters should be accepted"
        );
    }

    // Type alias to avoid clippy::type_complexity warning on the format test table.
    type FormatCase<'a> = (&'a str, Box<dyn Fn()>);

    #[test]
    fn format_relay_messages() {
        let event = make_event(Kind::TextNote);

        let cases: &[FormatCase<'_>] = &[
            (
                "auth_challenge",
                Box::new(|| {
                    let msg = RelayMessage::auth_challenge("abc123");
                    let v: Value = serde_json::from_str(&msg).unwrap();
                    assert_eq!(v[0], "AUTH");
                    assert_eq!(v[1], "abc123");
                }),
            ),
            (
                "event",
                Box::new({
                    let event = event.clone();
                    move || {
                        let msg = RelayMessage::event("sub1", &event);
                        let v: Value = serde_json::from_str(&msg).unwrap();
                        assert_eq!(v[0], "EVENT");
                        assert_eq!(v[1], "sub1");
                        assert_eq!(v[2]["id"], event.id.to_hex());
                    }
                }),
            ),
            (
                "notice",
                Box::new(|| {
                    let msg = RelayMessage::notice("hello");
                    let v: Value = serde_json::from_str(&msg).unwrap();
                    assert_eq!(v[0], "NOTICE");
                    assert_eq!(v[1], "hello");
                }),
            ),
            (
                "eose",
                Box::new(|| {
                    let msg = RelayMessage::eose("sub1");
                    let v: Value = serde_json::from_str(&msg).unwrap();
                    assert_eq!(v[0], "EOSE");
                    assert_eq!(v[1], "sub1");
                }),
            ),
            (
                "ok_accepted",
                Box::new(|| {
                    let msg = RelayMessage::ok("eid", true, "");
                    let v: Value = serde_json::from_str(&msg).unwrap();
                    assert_eq!(v[0], "OK");
                    assert_eq!(v[2], true);
                    assert_eq!(v[3], "");
                }),
            ),
            (
                "ok_rejected",
                Box::new(|| {
                    let msg = RelayMessage::ok("eid", false, "auth-required");
                    let v: Value = serde_json::from_str(&msg).unwrap();
                    assert_eq!(v[2], false);
                    assert_eq!(v[3], "auth-required");
                }),
            ),
            (
                "closed",
                Box::new(|| {
                    let msg = RelayMessage::closed("sub1", "auth-required: not authenticated");
                    let v: Value = serde_json::from_str(&msg).unwrap();
                    assert_eq!(v[0], "CLOSED");
                    assert_eq!(v[1], "sub1");
                    assert_eq!(v[2], "auth-required: not authenticated");
                }),
            ),
        ];

        for (name, check) in cases {
            let _ = name;
            check();
        }
    }
}
