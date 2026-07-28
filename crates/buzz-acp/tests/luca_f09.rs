use buzz_acp::luca_final_publisher::{FinalChunkAccumulator, FinalPublicationError};

#[test]
fn luca_f09_final_chunk_boundary_rejects_oversized_drafts_before_broker_handoff() {
    let mut chunks = FinalChunkAccumulator::default();
    let oversized = "x".repeat(luca_protocol::MAX_FINAL_DRAFT_BYTES + 1);
    assert_eq!(
        chunks.push_agent_message_chunk(&oversized),
        Err(FinalPublicationError::TooLarge)
    );
    assert_eq!(chunks.finish(false), Err(FinalPublicationError::Empty));
}
