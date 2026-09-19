import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationAccessPicker } from "./ConversationAccessPicker.tsx";

const PUBKEY = "aa".repeat(32);

// The popover's own content (the resident list, the AccessLevelPicker, the
// "applies…" note) lives inside Radix's PopoverContent, which — like
// AlertDialog's content — is not mounted while closed. These tests exercise
// what IS always present regardless of open state: the toolbar trigger
// button and its current-level label. The picker starts closed
// (`React.useState(false)`), matching every render here.
//
// Each seeded-data test pre-populates the tier query's cache before
// rendering and disables refetch-on-mount, so `useQuery` serves the cached
// value synchronously on the very first render — no real Tauri bridge call,
// and no need for `renderToStaticMarkup` (a single synchronous pass) to
// observe an async state transition it cannot see.
function queryClientWithSeededCache() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false },
    },
  });
}

function renderTrigger(tier) {
  const queryClient = queryClientWithSeededCache();
  queryClient.setQueryData(["resident-runtime-tier", PUBKEY], tier);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ConversationAccessPicker, {
        residents: [{ pubkey: PUBKEY, name: "Luca" }],
        selectedPubkey: PUBKEY,
        onSelectResident() {},
      }),
    ),
  );
}

test("the trigger shows Work in my project for a standard resident", () => {
  const html = renderTrigger({
    family: "claude_code",
    control: "native_mode",
    level: "standard",
  });
  assert.match(html, /Access · Work in my project/);
});

test("the trigger shows Don't ask me for a full-access resident", () => {
  const html = renderTrigger({
    family: "claude_code",
    control: "native_mode",
    level: "full",
  });
  assert.match(html, /Access · Don&#x27;t ask me/);
});

test("a legacy restricted level displays as Work in my project, not a blank label", () => {
  // Mirrors AccessLevelPicker's own displayLevel: a resident not yet
  // migrated off the retired "restricted" rung must not read as unset.
  const html = renderTrigger({
    family: "codex",
    control: "native_policy",
    level: "restricted",
  });
  assert.match(html, /Access · Work in my project/);
});

test("no resident selected renders a plain access affordance and fetches nothing", () => {
  const queryClient = queryClientWithSeededCache();
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ConversationAccessPicker, {
        residents: [],
        selectedPubkey: null,
        onSelectResident() {},
      }),
    ),
  );
  assert.match(html, /Access level settings/);
  assert.match(html, /<span>Access<\/span>/);
});
