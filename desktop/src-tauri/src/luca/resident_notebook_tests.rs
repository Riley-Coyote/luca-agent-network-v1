use super::*;
use luca_protocol::{CanonicalTimestamp, ResidentMemoryNoteCategoryV1};

fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).expect("fixture key")
}

fn timestamp() -> CanonicalTimestamp {
    CanonicalTimestamp::parse("2026-08-06T12:00:00Z").expect("fixture timestamp")
}

#[test]
fn metabolism_requires_every_note_to_cite_the_final() {
    let request = ResidentMetabolismCommitRequestV1 {
        owner_pubkey: hex('a'),
        resident_pubkey: hex('b'),
        source_event_id: hex('c'),
        request_id: OpaqueId::parse("request-1").expect("request"),
        handoff: None,
        memory_note_mutations: vec![ResidentMemoryNoteMutationV1::Create {
            note: ResidentMemoryNoteV1 {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                note_id: OpaqueId::parse("note-1").expect("note"),
                category: ResidentMemoryNoteCategoryV1::Decision,
                body: "Use a resident-owned notebook.".to_owned(),
                source_event_ids: vec![hex('d')],
                created_at: timestamp(),
                updated_at: timestamp(),
            },
        }],
    };
    assert!(!valid_metabolism_request(&request));
}
