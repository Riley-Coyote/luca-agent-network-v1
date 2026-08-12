export type ProjectResidentSelection =
  | { mode: "none" }
  | { mode: "existing"; pubkeys: string[] }
  | { mode: "new" };

export type ProjectCreationDraft = {
  label: string;
  roomName: string | null;
  sourceIds: string[];
  residents: ProjectResidentSelection;
};

export type ProjectCreationCheckpoint = {
  projectId?: string;
  channelId?: string;
  channelName?: string;
  roomAssigned?: boolean;
  pendingResidentPubkeys?: string[];
  newResidentRequested?: boolean;
};

export type ProjectCreationStage =
  | "project"
  | "room"
  | "assignment"
  | "membership"
  | "resident-request";

type CreatedProject = { id: string };

type MembershipResult = {
  added: string[];
  errors: Array<{ pubkey: string; error: string }>;
};

export type ProjectCreationOperations = {
  createProject: (input: {
    label: string;
    sourceIds: readonly string[];
  }) => CreatedProject | null;
  createRoom: (
    input: { name: string; description: string },
    onCreated: (channelId: string) => void | Promise<void>,
  ) => Promise<void>;
  assignRoom: (channelId: string, projectId: string) => boolean;
  addResidents: (
    channelId: string,
    pubkeys: string[],
  ) => Promise<MembershipResult>;
  requestNewResident: (input: {
    channelId: string;
    channelName: string;
  }) => void;
};

export class ProjectCreationFailure extends Error {
  readonly checkpoint: ProjectCreationCheckpoint;
  readonly stage: ProjectCreationStage;

  constructor(
    stage: ProjectCreationStage,
    message: string,
    checkpoint: ProjectCreationCheckpoint,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectCreationFailure";
    this.stage = stage;
    this.checkpoint = checkpoint;
  }
}

function uniquePubkeys(pubkeys: readonly string[]) {
  return [...new Set(pubkeys.map((pubkey) => pubkey.trim()).filter(Boolean))];
}

function failureMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : fallback;
}

function fail(
  stage: ProjectCreationStage,
  message: string,
  checkpoint: ProjectCreationCheckpoint,
  cause?: unknown,
): never {
  throw new ProjectCreationFailure(stage, message, checkpoint, { cause });
}

async function continueAfterRoom(
  draft: ProjectCreationDraft,
  checkpoint: ProjectCreationCheckpoint,
  operations: ProjectCreationOperations,
) {
  const channelId = checkpoint.channelId;
  const channelName = checkpoint.channelName;
  const projectId = checkpoint.projectId;
  if (!channelId || !channelName || !projectId) {
    fail(
      "room",
      "The room was created without a usable project coordinate.",
      checkpoint,
    );
  }

  if (!checkpoint.roomAssigned) {
    if (!operations.assignRoom(channelId, projectId)) {
      fail(
        "assignment",
        "The room was created, but it could not be added to the project. Retry to finish the assignment.",
        checkpoint,
      );
    }
    checkpoint.roomAssigned = true;
  }

  if (draft.residents.mode === "existing") {
    checkpoint.pendingResidentPubkeys ??= uniquePubkeys(
      draft.residents.pubkeys,
    );
    const pending = checkpoint.pendingResidentPubkeys;
    if (pending.length > 0) {
      let result: MembershipResult;
      try {
        result = await operations.addResidents(channelId, pending);
      } catch (cause) {
        fail(
          "membership",
          `${failureMessage(cause, "The selected residents could not be added.")} Retry to add residents without creating another project or room.`,
          checkpoint,
          cause,
        );
      }
      const added = new Set(result.added);
      const errors = new Map(
        result.errors.map((error) => [error.pubkey, error.error]),
      );
      checkpoint.pendingResidentPubkeys = pending.filter(
        (pubkey) => !added.has(pubkey),
      );
      if (checkpoint.pendingResidentPubkeys.length > 0) {
        const detail = checkpoint.pendingResidentPubkeys
          .map((pubkey) => errors.get(pubkey))
          .find(Boolean);
        fail(
          "membership",
          `${detail ?? "Some selected residents could not be added."} Retry to add only the remaining residents.`,
          checkpoint,
        );
      }
    }
  }

  if (draft.residents.mode === "new" && !checkpoint.newResidentRequested) {
    try {
      operations.requestNewResident({ channelId, channelName });
      checkpoint.newResidentRequested = true;
    } catch (cause) {
      fail(
        "resident-request",
        failureMessage(cause, "Resident setup could not be opened."),
        checkpoint,
        cause,
      );
    }
  }
}

export async function runProjectCreationTransaction(
  draft: ProjectCreationDraft,
  priorCheckpoint: ProjectCreationCheckpoint | null,
  operations: ProjectCreationOperations,
): Promise<ProjectCreationCheckpoint> {
  const checkpoint: ProjectCreationCheckpoint = priorCheckpoint
    ? {
        ...priorCheckpoint,
        ...(priorCheckpoint.pendingResidentPubkeys === undefined
          ? {}
          : {
              pendingResidentPubkeys: [
                ...priorCheckpoint.pendingResidentPubkeys,
              ],
            }),
      }
    : {};

  if (!checkpoint.projectId) {
    let project: CreatedProject | null;
    try {
      project = operations.createProject({
        label: draft.label,
        sourceIds: draft.sourceIds,
      });
    } catch (cause) {
      fail(
        "project",
        failureMessage(cause, "The project could not be saved."),
        checkpoint,
        cause,
      );
    }
    if (!project) {
      fail("project", "The project could not be saved.", checkpoint);
    }
    checkpoint.projectId = project.id;
  }

  if (!draft.roomName) return checkpoint;

  if (checkpoint.channelId) {
    await continueAfterRoom(draft, checkpoint, operations);
    return checkpoint;
  }

  try {
    await operations.createRoom(
      {
        name: draft.roomName,
        description: `${draft.label} project room`,
      },
      async (channelId) => {
        checkpoint.channelId = channelId;
        checkpoint.channelName = draft.roomName ?? undefined;
        await continueAfterRoom(draft, checkpoint, operations);
      },
    );
  } catch (cause) {
    if (cause instanceof ProjectCreationFailure) throw cause;
    fail(
      "room",
      `${failureMessage(cause, "The first room could not be created.")} The empty project is saved; retry to create its room.`,
      checkpoint,
      cause,
    );
  }

  if (!checkpoint.channelId) {
    fail(
      "room",
      "The first room did not return a usable coordinate. The empty project is saved; retry to create its room.",
      checkpoint,
    );
  }
  return checkpoint;
}
