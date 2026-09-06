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

import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "@/app/App";
import { PERSONAL_HOME_TENANCY_ID } from "@/app/personalHomeTenancy";
import { CommunitiesProvider } from "@/features/communities/useCommunities";
import { CommunityOnboardingProvider } from "@/features/onboarding/communityOnboarding";
import { NostrBindConsentDialog } from "@/features/profile/ui/NostrBindConsentDialog";
import { UpdaterProvider } from "@/features/settings/hooks/UpdaterProvider";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";
import { ThemeProvider, useTheme } from "@/shared/theme/ThemeProvider";
import { EmojiBurstProvider } from "@/shared/ui/EmojiBurstProvider";
import { PoofBurstProvider } from "@/shared/ui/PoofBurstProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { roomProjectStorageKey } from "@/features/channels/lib/roomProjects";
import { LAB_DMS, LAB_PROJECTS } from "@/testing/labScene";
import { maybeInstallE2eTauriMocks } from "@/testing/e2eBridge";
import {
  LAB_EXCHANGES,
  LAB_OPEN_ROOM,
  LAB_OWNER,
  LAB_RESIDENTS,
  LAB_ROOMS,
  LAB_TRANSCRIPTS,
  type LabRoomKey,
  type LabTurn,
} from "@/testing/labScene";

import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource/fragment-mono/400.css";
import "@fontsource/doto/400.css";
import "@/shared/styles/globals.css";

const RELAY_URL = "ws://localhost:3000";
const ROOM_ORDER: LabRoomKey[] = [
  "house",
  "fieldNotes",
  "polyphonic",
  "drafts",
];

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
function seedStorage() {
  const store = window.localStorage;
  store.clear();

  // One build serves every palette: `?theme=graphite` (or any id from
  // SYNTAX_THEMES) picks the theme; the default is the first-party `buzz`.
  // Clearing the cache alongside it stops a stale entry from repainting the
  // boot backdrop.
  const requestedTheme = new URLSearchParams(window.location.search).get(
    "theme",
  );
  store.setItem(
    "buzz-theme",
    requestedTheme && /^[a-z0-9-]+$/i.test(requestedTheme)
      ? requestedTheme
      : "buzz",
  );
  store.removeItem("buzz-theme-cache");
  // `?marks=rune` shows the rune identity mark (design decision 2026-08-31)
  // everywhere a resident wears a face. Off by default until the port lands.
  const requestedMarks = new URLSearchParams(window.location.search).get(
    "marks",
  );
  if (requestedMarks === "rune" || requestedMarks === "polished")
    store.setItem("luca.lab.marks", requestedMarks);
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

  // Projects are device-local: a catalog plus one-project-per-room. The rail
  // reads this store, so seeding it is what turns "Channels" into Projects.
  store.setItem(
    roomProjectStorageKey(LAB_OWNER.pubkey, RELAY_URL),
    JSON.stringify({
      assignments: Object.fromEntries(
        LAB_PROJECTS.flatMap((project) =>
          project.rooms.map((room) => [LAB_ROOMS[room].id, project.id]),
        ),
      ),
      projects: LAB_PROJECTS.map((project) => ({
        id: project.id,
        label: project.label,
        workingContextStatus: "none",
      })),
      version: 1,
    }),
  );
  store.setItem(
    `buzz-welcome-channel-ensured.v2:${encodeURIComponent(RELAY_URL)}:${LAB_OWNER.pubkey}`,
    "true",
  );
}

function configureBridge() {
  window.__BUZZ_E2E__ = {
    mock: {
      exchanges: Object.values(LAB_EXCHANGES).map((exchange) => ({
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
        agentCommand: resident.harness,
        name: resident.name,
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
      content: turn.text,
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

  const projectRooms = new Set(
    LAB_PROJECTS.flatMap((project) => project.rooms),
  );
  for (const key of ROOM_ORDER) {
    const room = LAB_ROOMS[key];
    // A conversation with residents and no project is a GROUP CONVERSATION
    // (channelType "dm"), the way the real product creates them — the quiet
    // direct-conversation furniture (compact hover bubble, no quick-react
    // row). A room that LIVES IN A PROJECT is a named place: created as a
    // channel so it keeps its name, then the residents are added to it.
    if (room.residents.length > 0 && !projectRooms.has(key)) {
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
      if (room.residents.length > 0) {
        await invokeMock("add_channel_members", {
          channelId: room.id,
          pubkeys: room.residents,
        });
      }
    }
    sayAll(room.id, LAB_TRANSCRIPTS[key]);
  }

  for (const dm of LAB_DMS) {
    await withPinnedUuid(dm.id, () =>
      invokeMock("open_dm", { pubkeys: [dm.with.pubkey] }),
    );
    sayAll(dm.id, dm.transcript);
  }

  const openRoomId = LAB_ROOMS[LAB_OPEN_ROOM].id;
  window.localStorage.setItem("luca:last-conversation.v1", openRoomId);
  // Hash routing, so this works unchanged from a file:// URL.
  window.location.hash = `#/channels/${openRoomId}`;
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
          <ThemeProvider defaultTheme="buzz">
            <LabThemeHandle />
            <TooltipProvider delayDuration={300}>
              <EmojiBurstProvider>
                <PoofBurstProvider>
                  <UpdaterProvider>
                    <App />
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
  await buildScene();
  renderApp();
}

void boot();
