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
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { EmojiBurstProvider } from "@/shared/ui/EmojiBurstProvider";
import { PoofBurstProvider } from "@/shared/ui/PoofBurstProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { maybeInstallE2eTauriMocks } from "@/testing/e2eBridge";
import {
  LAB_DM_ID,
  LAB_DM_TRANSCRIPT,
  LAB_DM_WITH,
  LAB_EXCHANGE,
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
const ROOM_ORDER: LabRoomKey[] = ["fieldNotes", "polyphonic"];

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

  // The Luca shell only paints on the first-party `buzz` palette. Clearing the
  // cache alongside it stops a stale entry from repainting the boot backdrop.
  store.setItem("buzz-theme", "buzz");
  store.removeItem("buzz-theme-cache");

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
  store.setItem(
    `buzz-welcome-channel-ensured.v2:${encodeURIComponent(RELAY_URL)}:${LAB_OWNER.pubkey}`,
    "true",
  );
}

function configureBridge() {
  window.__BUZZ_E2E__ = {
    mock: {
      exchanges: [
        {
          bucket: LAB_EXCHANGE.bucket,
          conversationId: LAB_ROOMS[LAB_EXCHANGE.room].id,
          exchangeId: LAB_EXCHANGE.exchangeId,
          members: [...LAB_EXCHANGE.members],
          openedBy: LAB_EXCHANGE.openedBy,
          owner: LAB_OWNER.pubkey,
          rootEventId: LAB_EXCHANGE.rootEventId,
        },
      ],
      managedAgents: Object.values(LAB_RESIDENTS).map((resident) => ({
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
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelId,
      content: turn.text,
      createdAt: nowSeconds - turn.minutesAgo * 60,
      extraTags: turn.exchangeTurn
        ? [["exchange", LAB_EXCHANGE.exchangeId, String(turn.exchangeTurn)]]
        : undefined,
      pubkey: turn.from,
    });
  }
}

async function buildScene() {
  await clearStockChannels();

  for (const key of ROOM_ORDER) {
    const room = LAB_ROOMS[key];
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
        role: "bot",
      });
    }
    sayAll(room.id, LAB_TRANSCRIPTS[key]);
  }

  await withPinnedUuid(LAB_DM_ID, () =>
    invokeMock("open_dm", { pubkeys: [LAB_DM_WITH.pubkey] }),
  );
  sayAll(LAB_DM_ID, LAB_DM_TRANSCRIPT);

  const openRoomId = LAB_ROOMS[LAB_OPEN_ROOM].id;
  window.localStorage.setItem("luca:last-conversation.v1", openRoomId);
  // Hash routing, so this works unchanged from a file:// URL.
  window.location.hash = `#/channels/${openRoomId}`;
}

function renderApp() {
  document.documentElement.setAttribute("data-luca-shell", "");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <CommunitiesProvider>
        <CommunityOnboardingProvider>
          <ThemeProvider defaultTheme="buzz">
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
