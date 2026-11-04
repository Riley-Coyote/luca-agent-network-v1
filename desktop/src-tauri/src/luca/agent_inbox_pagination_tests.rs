//! Synthetic HTTP relay boundary proof, not a running production relay proof.
use super::*;
use std::io::{BufRead, Read, Write};

#[tokio::test]
async fn durable_http_pages_survive_head_eviction_restart_and_timestamp_ties() {
    let directory = tempfile::tempdir().unwrap();
    let durable = directory.path().join("synthetic-canonical-events.json");
    let owner = nostr::Keys::parse(&"11".repeat(32)).unwrap();
    let owner_key = Hex64::parse(owner.public_key().to_hex()).unwrap();
    let members = vec![
        Hex64::parse("a".repeat(64)).unwrap(),
        Hex64::parse("b".repeat(64)).unwrap(),
    ];
    let mut cache = super::super::exchange_store::ExchangeStore::in_memory();
    let mut events = Vec::new();
    for index in 0..1000 {
        let record = ExchangeRecordV1::open(
            owner_key.clone(),
            members.clone(),
            luca_protocol::OpaqueId::parse("11111111-1111-4111-8111-111111111111").unwrap(),
            Hex64::parse(format!("{index:064x}")).unwrap(),
            members[0].clone(),
            None,
            100,
        )
        .unwrap();
        let event = nostr::EventBuilder::new(
            nostr::Kind::Custom(buzz_core_pkg::kind::KIND_LUCA_EXCHANGE as u16),
            record.to_content().unwrap(),
        )
        .tags(
            record
                .event_tags()
                .into_iter()
                .map(|raw| nostr::Tag::parse(raw).unwrap()),
        )
        .custom_created_at(nostr::Timestamp::from(100))
        .sign_with_keys(&owner)
        .unwrap();
        cache
            .upsert_head(verified_exchange_head(&event, &record.exchange_id, &owner_key).unwrap())
            .unwrap();
        events.push(event);
    }
    assert_eq!(
        events
            .iter()
            .filter(|event| cache
                .head(
                    &ExchangeRecordV1::from_content(&event.content)
                        .unwrap()
                        .exchange_id
                )
                .is_some())
            .count(),
        256
    );
    std::fs::write(&durable, serde_json::to_vec(&events).unwrap()).unwrap();
    drop(events);
    drop(cache);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for _ in 0..11 {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            let mut length = None;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    if name.eq_ignore_ascii_case("content-length") {
                        length = Some(value.trim().parse::<usize>().unwrap());
                    }
                }
            }
            let mut body = vec![0; length.unwrap()];
            reader.read_exact(&mut body).unwrap();
            let filters: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
            let filter = &filters[0];
            // Reload durable canonical records on every request, as after a
            // source restart. No desktop head cache participates in paging.
            let mut events: Vec<nostr::Event> =
                serde_json::from_slice(&std::fs::read(&durable).unwrap()).unwrap();
            events.sort_by(|a, b| {
                b.created_at
                    .cmp(&a.created_at)
                    .then_with(|| a.id.cmp(&b.id))
            });
            events.retain(
                |event| match (filter["until"].as_u64(), filter["before_id"].as_str()) {
                    (Some(until), Some(before)) => {
                        event.created_at.as_secs() < until
                            || (event.created_at.as_secs() == until
                                && event.id.to_hex().as_str() > before)
                    }
                    _ => true,
                },
            );
            events.truncate(filter["limit"].as_u64().unwrap() as usize);
            let response = serde_json::to_vec(&events).unwrap();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", response.len()).unwrap();
            stream.write_all(&response).unwrap();
        }
    });
    let state = crate::app_state::build_isolated_test_app_state();
    let mut cursor = None::<(u64, String)>;
    let mut found = BTreeSet::new();
    loop {
        let mut filter = serde_json::json!({"kinds":[buzz_core_pkg::kind::KIND_LUCA_EXCHANGE],"authors":[owner_key.as_str()],"limit":100});
        if let Some((until, before)) = &cursor {
            filter["until"] = serde_json::json!(until);
            filter["before_id"] = serde_json::json!(before);
        }
        let events = crate::relay::query_relay_at(&state, &endpoint, &[filter])
            .await
            .unwrap();
        if events.is_empty() {
            break;
        }
        for event in &events {
            let record = ExchangeRecordV1::from_content(&event.content).unwrap();
            assert!(verified_exchange_head(event, &record.exchange_id, &owner_key).is_ok());
            assert!(found.insert(record.exchange_id));
        }
        let last = events.last().unwrap();
        cursor = Some((last.created_at.as_secs(), last.id.to_hex()));
    }
    server.join().unwrap();
    assert_eq!(found.len(), 1000);
}
