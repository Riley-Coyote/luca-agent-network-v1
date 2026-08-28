export type RoomParticipantCandidate = {
  id: string;
  name: string;
};

export type RoomParticipantFailure = RoomParticipantCandidate & {
  error: string;
};

export type RoomParticipantSetupResult = {
  addedIds: string[];
  failures: RoomParticipantFailure[];
};

/**
 * Add durable room members sequentially. Membership is a replaceable relay
 * event, so concurrent writes can lose siblings; the retry surface receives
 * only failures and never needs to recreate the room.
 */
export async function runRoomParticipantSetup<
  T extends RoomParticipantCandidate,
>(
  candidates: readonly T[],
  addParticipant: (candidate: T) => Promise<void>,
): Promise<RoomParticipantSetupResult> {
  const addedIds: string[] = [];
  const failures: RoomParticipantFailure[] = [];

  for (const candidate of candidates) {
    try {
      await addParticipant(candidate);
      addedIds.push(candidate.id);
    } catch (error) {
      failures.push({
        id: candidate.id,
        name: candidate.name,
        error: error instanceof Error ? error.message : "Could not add agent.",
      });
    }
  }

  return { addedIds, failures };
}
