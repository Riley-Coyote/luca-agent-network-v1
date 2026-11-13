/**
 * Entry point for the standalone shell design lab.
 *
 * The desktop app cannot boot in a plain browser: every gate on the way to the
 * shell asks Tauri a question. This entry answers those questions with the
 * same mock bridge the E2E suite uses, seeds a scene, and then mounts the real
 * `<App/>` with the real provider stack — so what the lab shows is the actual
 * product UI, not a reproduction of it.
 *
 * Order matters and is the whole trick:
 *   1. localStorage — React reads it on mount, so it must be written first.
 *   2. `window.__BUZZ_E2E__` — the bridge snapshots this at install time.
 *   3. install the mock IPC bridge.
 *   4. build the scene through the bridge's own command surface.
 *   5. mount.
 *
 * Scene content lives in `labScene.ts`. This file is the machinery.
 */

import { RailStudy, RAIL_STUDY_KEY } from "@/testing/railStudy";
import { ShellStudy, SHELL_STUDY_KEY } from "@/testing/shellStudy/ShellStudy";
import {
  AgentSpaceStudy,
  AGENT_SPACE_KEY,
} from "@/testing/agentSpaceStudy/AgentSpaceStudy";
import React from "react";
import ReactDOM from "react-dom/client";
import { TemporarySurfacesStudy } from "@/testing/temporarySurfacesStudy/TemporarySurfacesStudy";
import { HarnessDashboardStudy } from "@/testing/harnessDashboardStudy/HarnessDashboardStudy";
import { HARNESS_STUDY_KEY } from "@/testing/harnessDashboardStudy/fixtures";
import { TEMPORARY_SURFACES_KEY } from "@/testing/temporarySurfacesStudy/design";
import {
  ConversationPolishStudy,
  ConversationPolishCanvas,
} from "@/testing/conversationPolishStudy/ConversationPolishStudy";
import {
  CONVERSATION_STUDY_KEY,
  CONVERSATION_TRANSCRIPT,
  LIVING_INK_ROOM,
  LIVING_INK_TRANSCRIPT,
  CONVERSATION_ROOM_TRANSCRIPTS,
  SCENES,
} from "@/testing/conversationPolishStudy/fixtures";

import { App } from "@/app/App";
import { installMnemosViewFixture } from "@/testing/mnemosViewFixture";
import { PERSONAL_HOME_TENANCY_ID } from "@/app/personalHomeTenancy";
import { CommunitiesProvider } from "@/features/communities/useCommunities";
import { CommunityOnboardingProvider } from "@/features/onboarding/communityOnboarding";
import { NostrBindConsentDialog } from "@/features/profile/ui/NostrBindConsentDialog";
import { UpdaterProvider } from "@/features/settings/hooks/UpdaterProvider";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";
import { ThemeProvider, useTheme } from "@/shared/theme/ThemeProvider";
import {
  DEFAULT_THEME_NAME,
  PAPER_THEME_NAME,
} from "@/shared/theme/theme-loader";
import { EmojiBurstProvider } from "@/shared/ui/EmojiBurstProvider";
import { PoofBurstProvider } from "@/shared/ui/PoofBurstProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { maybeInstallE2eTauriMocks } from "@/testing/e2eBridge";
import {
  CompanionExperienceLab,
  COMPANION_LAB_STORAGE_KEY,
} from "@/testing/companionLab";
import { CompanionSetupLab } from "@/testing/companionSetupLab";
import {
  CompanionControlLab,
  CONTROL_LAB_KEY,
} from "@/testing/companionControlLab";
import {
  LAB_AD_PROJECTS,
  LAB_AD_SCENE,
  LAB_AD_SESSIONS,
  LAB_DM_ID,
  LAB_DM_TRANSCRIPT,
  LAB_DM_WITH,
  LAB_EXCHANGES,
  LAB_OPEN_ROOM,
  LAB_OWNER,
  LAB_RESIDENTS,
  LAB_ROOMS,
  LAB_TRANSCRIPTS,
  type LabRoomKey,
  type LabTurn,
} from "@/testing/labScene";
import { roomProjectStorageKey } from "@/features/channels/lib/roomProjects";
import { localReadStateKey } from "@/features/channels/readState/readStateFormat";

import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/fragment-mono/400.css";
import "@fontsource/doto/400.css";
import "@/shared/styles/globals.css";

const RELAY_URL = "ws://localhost:3000";
const ROOM_ORDER: LabRoomKey[] = ["fieldNotes", "polyphonic", "drafts"];
const COMPANION_STUDY =
  new URLSearchParams(window.location.search).get("experience") === "companion";
const COMPANION_SETUP_STUDY =
  new URLSearchParams(window.location.search).get("experience") ===
  "companion-setup";
const COMPANION_CONTROL_STUDY =
  new URLSearchParams(window.location.search).get("experience") ===
  "companion-control";
/** `?experience=shell`: the shell study (places, the rail, the lip and the
 *  glass) in place of the app; docs/luca/rail-system/SHELL_STUDY.md. */
const AGENT_SPACE_STUDY =
  new URLSearchParams(window.location.search).get("experience") ===
  "agent-space";
const TEMPORARY_SURFACES_STUDY =
  new URLSearchParams(window.location.search).get("experience") ===
  "temporary-surfaces";
const HARNESS_DASHBOARD_STUDY =
  new URLSearchParams(window.location.search).get("experience") ===
  "harness-dashboard";
const CONVERSATION_POLISH_STUDY =
  new URLSearchParams(window.location.search).get("experience") ===
  "conversation-polish";
const CONVERSATION_CANVAS =
  CONVERSATION_POLISH_STUDY &&
  new URLSearchParams(window.location.search).get("canvas") === "1";
const SHELL_STUDY =
  TEMPORARY_SURFACES_STUDY ||
  AGENT_SPACE_STUDY ||
  new URLSearchParams(window.location.search).get("experience") === "shell";
/** `?dm=first` opens Luca's conversation before its first message, and
 *  `?dm=open` opens it as the scene left it. Without it the lab opens a room. */
const DM_SCENE = new URLSearchParams(window.location.search).get("dm");

type MockChannelRow = { id: string; is_member?: boolean };

function invokeMock(command: string, payload?: Record<string, unknown>) {
  const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
  if (!invoke) throw new Error("shell-lab: mock bridge is not installed");
  return invoke(command, payload);
}

/**
 * Every gate between boot and the shell reads one of these. Miss one and the
 * lab renders a loading curtain or the onboarding door instead of the app —
 * that failure mode looks like a broken build, so keep this list complete.
 */
/** The mode the shell study was last left in, from its saved choice. */
function savedShellMode(saved: string | null): unknown {
  try {
    return (JSON.parse(saved ?? "{}") as { mode?: unknown } | null)?.mode;
  } catch {
    return undefined;
  }
}

function seedStorage() {
  const store = window.localStorage;
  // This isolated study owns one stable design namespace. Preserve only that
  // namespace on this route; existing shell-lab reset keys stay unchanged.
  const companionStudy = store.getItem(COMPANION_LAB_STORAGE_KEY);
  const controlStudy = store.getItem(CONTROL_LAB_KEY);
  const railStudy = store.getItem(RAIL_STUDY_KEY);
  const railRecovery = store.getItem(`${RAIL_STUDY_KEY}.recovery`);
  const shellStudy = store.getItem(SHELL_STUDY_KEY);
  const agentStudy = store.getItem(AGENT_SPACE_KEY);
  const temporaryStudy = store.getItem(TEMPORARY_SURFACES_KEY);
  const harnessStudy = store.getItem(HARNESS_STUDY_KEY);
  const conversationStudy = store.getItem(CONVERSATION_STUDY_KEY);
  const homeStudy = store.getItem("ui-design-lab.polyphonic.home.v1");
  const oldTemporaryStudy = store.getItem(
    "ui-design-lab.polyphonic.temporary-surfaces.v1",
  );
  store.clear();
  if (conversationStudy !== null)
    store.setItem(CONVERSATION_STUDY_KEY, conversationStudy);
  if (harnessStudy !== null) store.setItem(HARNESS_STUDY_KEY, harnessStudy);
  if (homeStudy !== null)
    store.setItem("ui-design-lab.polyphonic.home.v1", homeStudy);
  if (oldTemporaryStudy !== null)
    store.setItem(
      "ui-design-lab.polyphonic.temporary-surfaces.v1",
      oldTemporaryStudy,
    );
  if (temporaryStudy !== null)
    store.setItem(TEMPORARY_SURFACES_KEY, temporaryStudy);
  if (agentStudy !== null) store.setItem(AGENT_SPACE_KEY, agentStudy);
  if (shellStudy !== null) store.setItem(SHELL_STUDY_KEY, shellStudy);
  if (railStudy !== null) store.setItem(RAIL_STUDY_KEY, railStudy);
  if (railRecovery !== null)
    store.setItem(`${RAIL_STUDY_KEY}.recovery`, railRecovery);
  if (companionStudy !== null)
    store.setItem(COMPANION_LAB_STORAGE_KEY, companionStudy);
  if (controlStudy !== null) store.setItem(CONTROL_LAB_KEY, controlStudy);

  // One build serves every palette: `?theme=graphite` (or any id from
  // SYNTAX_THEMES) picks the theme; otherwise use the application default.
  // Clearing the cache alongside it stops a stale entry from repainting the
  // boot backdrop.
  // The shell study opens in the mode it was left in (or `?mode=`), so in
  // light it starts on Paper rather than painting the dark default first.
  const params = new URLSearchParams(window.location.search);
  const requestedTheme = params.get("theme");
  const studyMode = SHELL_STUDY
    ? (params.get("mode") ?? savedShellMode(shellStudy))
    : null;
  store.setItem(
    "buzz-theme",
    requestedTheme && /^[a-z0-9-]+$/i.test(requestedTheme)
      ? requestedTheme
      : studyMode === "light"
        ? PAPER_THEME_NAME
        : DEFAULT_THEME_NAME,
  );
  store.removeItem("buzz-theme-cache");
  // The drawer width persists per session; the lab always shows the default.
  window.sessionStorage.removeItem("buzz.desktop.thread-panel-width");

  // The personal home must exist as a community AND be recorded as the home,
  // or PersonalHomeGate tries to provision one over IPC and never resolves.
  store.setItem(
    "buzz-communities",
    JSON.stringify([
      {
        addedAt: new Date().toISOString(),
        id: PERSONAL_HOME_TENANCY_ID,
        name: "Luca",
        pubkey: LAB_OWNER.pubkey,
        relayUrl: RELAY_URL,
      },
    ]),
  );
  store.setItem("buzz-active-community-id", PERSONAL_HOME_TENANCY_ID);
  store.setItem("luca-personal-home-tenancy.v1", PERSONAL_HOME_TENANCY_ID);

  // Three separate onboarding gates, three separate flags.
  store.setItem(
    `buzz-machine-onboarding-complete.v2:${LAB_OWNER.pubkey}`,
    "true",
  );
  store.setItem(`buzz-onboarding-complete.v1:${LAB_OWNER.pubkey}`, "true");
  store.setItem("luca-owner-onboarding-complete.v1", "true");
  if (CONVERSATION_POLISH_STUDY) {
    store.setItem(
      localReadStateKey(LAB_OWNER.pubkey),
      JSON.stringify(
        Object.fromEntries(
          SCENES.map((scene) => [
            scene.channel,
            new Date(Date.now() + 1000).toISOString(),
          ]),
        ),
      ),
    );
  }
  store.setItem(
    `buzz-welcome-channel-ensured.v2:${encodeURIComponent(RELAY_URL)}:${LAB_OWNER.pubkey}`,
    "true",
  );
}

function configureBridge() {
  window.__BUZZ_E2E__ = {
    mock: {
      exchanges: (CONVERSATION_POLISH_STUDY
        ? []
        : Object.values(LAB_EXCHANGES)
      ).map((exchange) => ({
        bucket: exchange.bucket,
        conversationId: LAB_ROOMS[exchange.room].id,
        exchangeId: exchange.exchangeId,
        members: [...exchange.members],
        openedBy: exchange.openedBy,
        owner: LAB_OWNER.pubkey,
        phase: exchange.state === "closed" ? "closed" : undefined,
        rootEventId: exchange.rootEventId,
        state: exchange.state,
      })),
      managedAgents: Object.values(LAB_RESIDENTS).map((resident) => ({
        agentCommand: CONVERSATION_POLISH_STUDY ? "claude" : resident.harness,
        name:
          CONVERSATION_POLISH_STUDY &&
          resident.pubkey === LAB_RESIDENTS.ziggy.pubkey
            ? "Anima"
            : resident.name,
        personaId:
          resident.pubkey === LAB_RESIDENTS.luca.pubkey ? "builtin:fizz" : null,
        pubkey: resident.pubkey,
        status: "running",
      })),
      // Overrides the mock identity's placeholder display name.
      searchProfiles: [
        { displayName: LAB_OWNER.name, pubkey: LAB_OWNER.pubkey },
      ],
    },
    mode: "mock",
  };
}

/**
 * `create_channel` and `open_dm` mint their ids with `crypto.randomUUID()`.
 * The lab needs to know the room id before the room exists, because the
 * exchange seed names its room at bridge-install time. Handing the next call
 * a pinned id is the smallest way to get there; the stub covers exactly one
 * call and then puts the real function back.
 */
async function withPinnedUuid<T>(uuid: string, run: () => Promise<T>) {
  const real = crypto.randomUUID.bind(crypto);
  let spent = false;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => {
      if (spent) return real();
      spent = true;
      return uuid as `${string}-${string}-${string}-${string}-${string}`;
    },
    writable: true,
  });
  try {
    return await run();
  } finally {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: real,
      writable: true,
    });
  }
}

/** The mock bridge ships a fixture community. None of it belongs in the lab. */
async function clearStockChannels() {
  const rows = (await invokeMock("get_channels")) as MockChannelRow[];
  for (const row of rows) {
    if (!row.is_member) continue;
    window.__BUZZ_E2E_MUTATE_CHANNEL__?.({
      channelId: row.id,
      removeMemberPubkey: LAB_OWNER.pubkey,
    });
  }
}

/** The ad scene renames two residents; their names inside the transcripts
 *  follow, so an opened room never contradicts its own rail. */
function sceneText(text: string) {
  return LAB_AD_SCENE
    ? text.replace(/\bziggy\b/g, "Wren").replace(/\bVektor\b/g, "Atlas")
    : text;
}

/** Named sessions with Atlas and Wren, filed under the ad scene's projects. */
async function buildAdSessions() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const session of LAB_AD_SESSIONS) {
    const resident = LAB_RESIDENTS[session.resident].pubkey;
    await withPinnedUuid(session.id, () =>
      invokeMock("create_channel", {
        channelType: "stream",
        description: "",
        name: session.name,
        visibility: "open",
      }),
    );
    await invokeMock("add_channel_members", {
      channelId: session.id,
      pubkeys: [resident],
      role: "bot",
    });
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelId: session.id,
      content: session.text,
      createdAt: nowSeconds - session.minutesAgo * 60,
      pubkey: resident,
    });
  }
  window.localStorage.setItem(
    roomProjectStorageKey(LAB_OWNER.pubkey, RELAY_URL),
    JSON.stringify({
      version: 1,
      projects: LAB_AD_PROJECTS.map((project) => ({
        ...project,
        workingContextStatus: "attached",
      })),
      assignments: Object.fromEntries(
        LAB_AD_SESSIONS.map((session) => [session.id, session.project]),
      ),
    }),
  );
  window.dispatchEvent(new Event("luca:room-projects-changed"));
}

/**
 * A real workspace is mostly read. Everything the ad scene shows is marked
 * read except the newest session, which keeps its one dot of news. Sent
 * twice because the read-state manager may still be subscribing the first
 * time.
 */
function markAdSceneRead() {
  const newest = [...LAB_AD_SESSIONS].sort(
    (a, b) => a.minutesAgo - b.minutesAgo,
  )[0];
  const send = () => {
    const readAt = Math.floor(Date.now() / 1000) + 1;
    const ids = [
      LAB_DM_ID,
      ...Object.values(LAB_ROOMS).map((room) => room.id),
      ...LAB_AD_SESSIONS.map((session) => session.id),
    ].filter((id) => id !== newest?.id);
    window.__BUZZ_E2E_EMIT_MOCK_READ_STATE__?.({
      clientId: "shell-lab-ad-scene",
      contexts: Object.fromEntries(ids.map((id) => [id, readAt])),
      createdAt: readAt,
      slotId: "shell-lab-ad-scene",
    });
  };
  send();
  window.setTimeout(send, 1500);
}

function sayAll(channelId: string, turns: LabTurn[]) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const turn of [...turns].sort((a, b) => b.minutesAgo - a.minutesAgo)) {
    const exchange = LAB_EXCHANGES[turn.exchange ?? "today"];
    if (turn.visit) {
      // A house note: the owner-signed system row the relay speaks when a
      // resident steps in for an exchange or back out. The UI reads the
      // payload, not the kind, so 40099 stands in for the note kind here.
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelId,
        content: JSON.stringify({
          exchange_id: exchange.exchangeId,
          resident: turn.from,
          type: turn.visit === "arrived" ? "visit_arrived" : "visit_left",
        }),
        createdAt: nowSeconds - turn.minutesAgo * 60,
        kind: KIND_SYSTEM_MESSAGE,
        pubkey: LAB_OWNER.pubkey,
      });
      continue;
    }
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelId,
      content: sceneText(turn.text),
      createdAt: nowSeconds - turn.minutesAgo * 60,
      extraTags: turn.exchangeTurn
        ? [["exchange", exchange.exchangeId, String(turn.exchangeTurn)]]
        : undefined,
      pubkey: turn.from,
    });
  }
}

async function buildScene() {
  await clearStockChannels();

  for (const key of ROOM_ORDER) {
    // The empty composer stage and the reading-notes room are design
    // fixtures; the ad scene gives Atlas named sessions instead.
    if (LAB_AD_SCENE && (key === "drafts" || key === "fieldNotes")) continue;
    const room = LAB_ROOMS[key];
    // Rooms with residents are GROUP CONVERSATIONS (channelType "dm"), the
    // way the real product creates them — this is what selects the quiet
    // direct-conversation furniture (compact hover bubble, no quick-react
    // row). Only a room with no residents falls back to a plain channel;
    // the scene ran everything as "stream" channels for a while and the lab
    // wore channel furniture the product never shows.
    if (room.residents.length > 0) {
      await withPinnedUuid(room.id, () =>
        invokeMock("open_dm", { pubkeys: room.residents }),
      );
    } else {
      await withPinnedUuid(room.id, () =>
        invokeMock("create_channel", {
          channelType: "stream",
          description: room.description,
          name: room.name,
          visibility: "open",
        }),
      );
    }
    sayAll(
      room.id,
      CONVERSATION_POLISH_STUDY
        ? CONVERSATION_ROOM_TRANSCRIPTS[key]
        : LAB_TRANSCRIPTS[key],
    );
  }

  if (LAB_AD_SCENE) await buildAdSessions();

  if (CONVERSATION_POLISH_STUDY) {
    await withPinnedUuid(LIVING_INK_ROOM, () =>
      invokeMock("open_dm", {
        pubkeys: [LAB_RESIDENTS.luca.pubkey, LAB_RESIDENTS.vektor.pubkey],
      }),
    );
    sayAll(LIVING_INK_ROOM, LIVING_INK_TRANSCRIPT);
  }

  await withPinnedUuid(LAB_DM_ID, () =>
    invokeMock("open_dm", { pubkeys: [LAB_DM_WITH.pubkey] }),
  );
  if (DM_SCENE !== "first")
    sayAll(
      LAB_DM_ID,
      CONVERSATION_POLISH_STUDY ? CONVERSATION_TRANSCRIPT : LAB_DM_TRANSCRIPT,
    );

  if (LAB_AD_SCENE) markAdSceneRead();

  const openRoomId = CONVERSATION_POLISH_STUDY
    ? (SCENES.find(
        (scene) =>
          scene.id === new URLSearchParams(location.search).get("scene"),
      )?.channel ?? LAB_DM_ID)
    : DM_SCENE
      ? LAB_DM_ID
      : LAB_ROOMS[LAB_OPEN_ROOM].id;
  window.localStorage.setItem("luca:last-conversation.v1", openRoomId);
  // Hash routing, so this works unchanged from a file:// URL.
  if (
    new URLSearchParams(window.location.search).get("experience") ===
    "mnemos-view"
  ) {
    // Hash history appends the outer lab query to the hash on a cold load.
    // Keep that suffix on a fixture-only value, not on the real page word.
    window.location.hash = `#/agents?profile=${LAB_RESIDENTS.luca.pubkey}&page=mnemos&lab=1`;
  } else {
    window.location.hash = HARNESS_DASHBOARD_STUDY
      ? "#/apps/claude"
      : `#/channels/${openRoomId}`;
  }
}

/**
 * Harness hook: lab-shots switches themes IN PAGE (not by reload) to prove
 * a departing palette leaves nothing behind on the root. Test-only export;
 * the lab is never shipped.
 */
function LabThemeHandle() {
  const { setTheme } = useTheme();
  React.useEffect(() => {
    (
      window as unknown as { __labSetTheme?: (name: string) => void }
    ).__labSetTheme = setTheme;
  }, [setTheme]);
  return null;
}

function renderApp() {
  document.documentElement.setAttribute("data-luca-shell", "");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <CommunitiesProvider>
        <CommunityOnboardingProvider>
          <ThemeProvider>
            <LabThemeHandle />
            <TooltipProvider delayDuration={300}>
              <EmojiBurstProvider>
                <PoofBurstProvider>
                  <UpdaterProvider>
                    {CONVERSATION_POLISH_STUDY && !CONVERSATION_CANVAS ? (
                      <ConversationPolishStudy />
                    ) : SHELL_STUDY ? (
                      <ShellStudy
                        conversationStudy={
                          TEMPORARY_SURFACES_STUDY ? (
                            <TemporarySurfacesStudy />
                          ) : undefined
                        }
                        agentSpace={
                          AGENT_SPACE_STUDY
                            ? (id, name, onTalk) => (
                                <AgentSpaceStudy
                                  key={id}
                                  id={id}
                                  name={name}
                                  onTalk={onTalk}
                                />
                              )
                            : undefined
                        }
                      />
                    ) : (
                      <App />
                    )}
                    {CONVERSATION_CANVAS ? <ConversationPolishCanvas /> : null}
                    {new URLSearchParams(window.location.search).get(
                      "experience",
                    ) === "inline-sessions" ? (
                      <RailStudy />
                    ) : null}
                    {COMPANION_STUDY ? <CompanionExperienceLab /> : null}
                    {COMPANION_SETUP_STUDY ? <CompanionSetupLab /> : null}
                    {COMPANION_CONTROL_STUDY ? <CompanionControlLab /> : null}
                    {HARNESS_DASHBOARD_STUDY ? <HarnessDashboardStudy /> : null}
                    <NostrBindConsentDialog />
                  </UpdaterProvider>
                  <Toaster />
                </PoofBurstProvider>
              </EmojiBurstProvider>
            </TooltipProvider>
          </ThemeProvider>
        </CommunityOnboardingProvider>
      </CommunitiesProvider>
    </React.StrictMode>,
  );
}

async function boot() {
  seedStorage();
  configureBridge();
  maybeInstallE2eTauriMocks();
  // The shell study draws its own sample conversations; it needs no scene.
  if (!SHELL_STUDY && (!CONVERSATION_POLISH_STUDY || CONVERSATION_CANVAS))
    await buildScene();
  const params = new URLSearchParams(window.location.search);
  if (params.get("experience") === "mnemos-view") {
    installMnemosViewFixture(LAB_RESIDENTS.luca.pubkey, params.get("memory"));
  }
  renderApp();
}

void boot();
