import * as React from "react";

import { requestOpenCreateAgent } from "@/features/agents/openCreateAgentEvent";
import {
  assignRoomProject,
  createEmptyRoomProject,
} from "@/features/channels/lib/roomProjects";
import {
  type ProjectCreationCheckpoint,
  type ProjectCreationDraft,
  type ProjectCreationOperations,
  runProjectCreationTransaction,
} from "@/features/projects/lib/projectCreationTransaction";
import { addChannelMembers } from "@/shared/api/tauri";
import type { ChannelVisibility } from "@/shared/api/types";

/** The app's own create-a-chat step (AppShell's), which the rail's + also uses. */
export type CreateProjectChat = (
  input: { name: string; description: string; visibility: ChannelVisibility },
  onCreated: (channelId: string) => void | Promise<void>,
  options?: { navigate?: boolean },
) => Promise<void>;

/** Who is creating, where, and the step that makes a chat. */
export type ProjectCreationEnvironment = {
  ownerPubkey: string | undefined;
  relayUrl: string | undefined;
  createChat: CreateProjectChat;
};

/**
 * The steps behind every project the owner makes: a device-local project
 * (never kind 30617: on a local relay that would publish a ghost git
 * repository nothing can serve), its first private chat, the chat's place in
 * the project, and its residents as members.
 */
export function roomProjectCreationOperations(
  {
    ownerPubkey,
    relayUrl,
    createChat,
  }: ProjectCreationEnvironment & {
    ownerPubkey: string;
  },
  { navigate = true }: { navigate?: boolean } = {},
): ProjectCreationOperations {
  return {
    createProject: ({ label, sourceIds }) =>
      createEmptyRoomProject(ownerPubkey, relayUrl, { label, sourceIds }),
    createRoom: (input, onCreated) =>
      createChat({ ...input, visibility: "private" }, onCreated, { navigate }),
    assignRoom: (channelId, projectId) =>
      assignRoomProject(ownerPubkey, relayUrl, channelId, projectId),
    addResidents: (channelId, pubkeys) =>
      addChannelMembers({ channelId, pubkeys, role: "bot" }),
    requestNewResident: ({ channelId, channelName }) => {
      requestOpenCreateAgent({ channelId, channelName });
    },
  };
}

const ProjectCreationContext =
  React.createContext<ProjectCreationEnvironment | null>(null);

/** Provided once by the app shell, around the rail and the conversation. */
export const ProjectCreationProvider = ProjectCreationContext.Provider;

/** The owner and relay projects are kept under, for reading the catalog. */
export function useProjectCreationScope(): {
  ownerPubkey: string | undefined;
  relayUrl: string | undefined;
} {
  const environment = React.useContext(ProjectCreationContext);
  return {
    ownerPubkey: environment?.ownerPubkey,
    relayUrl: environment?.relayUrl,
  };
}

/**
 * Create a project the one way the app does: the + dialog and a resident's
 * project card both run this. `navigate: false` keeps the owner where they
 * are (the card); the + dialog keeps opening the new chat.
 */
export function useRoomProjectCreation({
  navigate = true,
}: {
  navigate?: boolean;
} = {}) {
  const environment = React.useContext(ProjectCreationContext);
  return React.useCallback(
    (
      draft: ProjectCreationDraft,
      checkpoint: ProjectCreationCheckpoint | null,
    ): Promise<ProjectCreationCheckpoint> => {
      if (!environment)
        return Promise.reject(new Error("Projects can't be created here."));
      const { ownerPubkey } = environment;
      if (!ownerPubkey)
        return Promise.reject(new Error("Your identity is still loading."));
      return runProjectCreationTransaction(
        draft,
        checkpoint,
        roomProjectCreationOperations(
          { ...environment, ownerPubkey },
          { navigate },
        ),
      );
    },
    [environment, navigate],
  );
}
