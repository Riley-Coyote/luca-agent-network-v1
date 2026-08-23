import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import { NostrBindConsentDialog } from "@/features/profile/ui/NostrBindConsentDialog";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource/fragment-mono/400.css";
import "@fontsource/doto/400.css";
import "@/shared/styles/globals.css";
import { UpdaterProvider } from "@/features/settings/hooks/UpdaterProvider";
import { migrateLegacyCommunityStorageBeforeRender } from "@/features/communities/legacyCommunityStorage";
import { CommunitiesProvider } from "@/features/communities/useCommunities";
import { CommunityOnboardingProvider } from "@/features/onboarding/communityOnboarding";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { EmojiBurstProvider } from "@/shared/ui/EmojiBurstProvider";
import { PoofBurstProvider } from "@/shared/ui/PoofBurstProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";

type E2eWindow = Window & {
  __BUZZ_E2E__?: unknown;
};

const E2E_DEFAULT_PUBKEY = "deadbeef".repeat(8);
const E2E_IDENTITY_OVERRIDE_STORAGE_KEY = "buzz:e2e-identity-override.v1";
const E2E_COMMUNITY_ID = "e2e-default-community";
const ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX = "buzz-onboarding-complete.v1:";
const DEV_STATE_RESET_PARAM = "resetDevState";

function resetDevWebviewStateFromUrl() {
  if (!import.meta.env.DEV) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get(DEV_STATE_RESET_PARAM) !== "1") {
    return;
  }

  // WebKit groups every Buzz binary under one disk directory, but storage is
  // isolated by origin. Clearing here resets only this dev server's origin;
  // deleting the shared WebKit directory would also destroy installed-app state.
  window.localStorage.clear();
  window.sessionStorage.clear();
  url.searchParams.delete(DEV_STATE_RESET_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

function configureDevE2eBridgeFromUrl() {
  if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) {
    return;
  }

  const url = new URL(window.location.href);
  const isNativeTauriWebview = "__TAURI_INTERNALS__" in window;
  if (!isNativeTauriWebview && !url.searchParams.has("e2e")) {
    // A bare Vite URL is a browser preview, not the native desktop runtime.
    // Give it a deterministic local bridge instead of letting Tauri invoke()
    // fail during bootstrap. Native `tauri dev` remains untouched because its
    // webview exposes __TAURI_INTERNALS__ before this module runs.
    url.searchParams.set("e2e", "mock");
    url.searchParams.set("projectDemo", "1");
    window.history.replaceState(window.history.state, "", url);
  }
  if (url.searchParams.get("e2e") !== "mock") {
    return;
  }

  const e2eWindow = window as E2eWindow;
  const notebookDemo = url.searchParams.get("notebookDemo") === "1";
  e2eWindow.__BUZZ_E2E__ ??= {
    mode: "mock",
    ...(notebookDemo
      ? {
          mock: {
            managedAgents: [
              {
                channelNames: ["agents"],
                agentCommand: "hermes",
                model: "gpt-5.6-sol",
                name: "Luca",
                nativeRuntimeBinding: {
                  kind: "hermes",
                  schemaVersion: 1,
                  profileName: "default",
                  hermesHome: "/Users/demo/.hermes",
                  executablePath: "/Users/demo/.local/bin/hermes",
                  runtimeVersion: "1.9.0",
                  defaultWorkspace: "/Users/demo/Projects/luca",
                },
                pubkey: "11".repeat(32),
                status: "running",
              },
              {
                channelNames: ["general"],
                agentCommand: "openclaw",
                model: "claude-sonnet-4-6",
                name: "Mara",
                nativeRuntimeBinding: {
                  kind: "openclaw",
                  schemaVersion: 1,
                  agentId: "main",
                  executablePath: "/opt/homebrew/bin/openclaw",
                  runtimeVersion: "2026.8.1",
                  gatewayIdentity: "personal-gateway",
                  gatewayUrlRef: {
                    provider: "native_store",
                    locator: "openclaw.gateway.url",
                  },
                  defaultWorkspace: "/Users/demo/Projects/research",
                },
                pubkey: "22".repeat(32),
                status: "stopped",
              },
              {
                agentCommand: "codex",
                lastError: "Codex sign-in needs attention.",
                model: "gpt-5.6-codex",
                name: "Sol",
                pubkey: "33".repeat(32),
                status: "stopped",
              },
            ],
          },
        }
      : {}),
  };

  let activePubkey = E2E_DEFAULT_PUBKEY;
  try {
    const identityOverride = JSON.parse(
      window.localStorage.getItem(E2E_IDENTITY_OVERRIDE_STORAGE_KEY) ?? "null",
    ) as { pubkey?: unknown } | null;
    if (typeof identityOverride?.pubkey === "string") {
      activePubkey = identityOverride.pubkey;
    }
  } catch {
    // The mock bridge owns malformed identity fixture behavior. Keep its
    // deterministic fallback community aligned with the default identity.
  }

  const community = {
    addedAt: new Date().toISOString(),
    id: E2E_COMMUNITY_ID,
    name: "E2E Test",
    pubkey: activePubkey,
    relayUrl: "ws://localhost:3000",
  };
  window.localStorage.setItem("buzz-communities", JSON.stringify([community]));
  window.localStorage.setItem("buzz-active-community-id", E2E_COMMUNITY_ID);
  window.localStorage.setItem(
    `${ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX}${E2E_DEFAULT_PUBKEY}`,
    "true",
  );
}

function renderApp() {
  // The conversation-first Luca shell is permanent product structure. Theme
  // selection changes its palette, never which application shell is mounted.
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

async function installE2eBridgeIfConfigured() {
  // The mock bridge is compiled only into dev and explicit E2E builds. A
  // pre-bootstrap global alone must never activate mock IPC in production.
  if (
    !(import.meta.env.DEV || import.meta.env.MODE === "e2e") ||
    !(window as E2eWindow).__BUZZ_E2E__
  ) {
    return;
  }

  const { maybeInstallE2eTauriMocks } = await import("@/testing/e2eBridge");
  maybeInstallE2eTauriMocks();
}

async function bootstrap() {
  resetDevWebviewStateFromUrl();
  configureDevE2eBridgeFromUrl();
  await installE2eBridgeIfConfigured();
  await migrateLegacyCommunityStorageBeforeRender();
  renderApp();
}

void bootstrap();
