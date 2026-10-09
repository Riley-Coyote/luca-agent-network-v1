import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMPANION_PREVIEW_SOURCES,
  companionPreviewPresentation,
  companionPreviewState,
  reduceCompanionPreview,
} from "./companionExperienceState.ts";

test("default off and separate pause/keeping/sharing choices remain local samples", () => {
  const initial = companionPreviewState("off");
  assert.equal(companionPreviewPresentation(initial).sourceCount, 0);
  assert.equal(initial.backgroundEnabled, false);
  const observed = reduceCompanionPreview(initial, { type: "source", id: "selected-files", choice: "observe", enabled: true });
  assert.deepEqual(observed.grants["selected-files"], { observe: true, promote: false, egress: false });
  const paused = reduceCompanionPreview(observed, { type: "pause-awareness" });
  assert.equal(paused.workPaused, false);
  assert.equal(companionPreviewPresentation(paused).contextAvailable, false);
  assert.equal(paused.grants["selected-files"].observe, true);
  assert.match(companionPreviewPresentation(observed).chatContextLabel, /off.*privacy review/);
});

test("another companion does not inherit access and unverified Codex work cannot run", () => {
  const switched = reduceCompanionPreview(companionPreviewState("carried"), { type: "companion", companion: "ziggy" });
  assert.equal(companionPreviewPresentation(switched).sourceCount, 0);
  const requested = reduceCompanionPreview(switched, { type: "background", enabled: true });
  assert.equal(requested.backgroundEnabled, false);
  assert.match(companionPreviewPresentation(requested).planningLabel, /not verified/);
});

test("unsupported account feeds cannot be selected and withdrawal cannot widen grants", () => {
  const state = companionPreviewState("context");
  assert.equal(reduceCompanionPreview(state, { type: "source", id: "all-texts", choice: "observe", enabled: true }), state);
  assert.equal(COMPANION_PREVIEW_SOURCES.some((source) => /all-texts|account-feed/.test(source.id)), false);
  const withdrawn = reduceCompanionPreview(state, { type: "source", id: "claude-profile-excerpts", choice: "observe", enabled: false });
  assert.deepEqual(withdrawn.grants["claude-profile-excerpts"], { observe: false, promote: false, egress: false });
  assert.equal(companionPreviewPresentation(withdrawn).currentSources.some((source) => source.id === "claude-profile-excerpts"), false);
  assert.equal(reduceCompanionPreview(withdrawn, { type: "source", id: "claude-profile-excerpts", choice: "egress", enabled: true }), withdrawn);
  const component = readFileSync(new URL("./CompanionExperienceControls.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /@\/shared\/api|invoke\(|getResidentContinuity|AgentIdentitySpecimen/);
  assert.match(component, /sample creation/);
  assert.match(component, /Account feeds and texts are not connected/);
});

test("a declined sample history choice clears sending without changing observing or keeping", () => {
  const granted = reduceCompanionPreview(companionPreviewState("carried"), { type: "source", id: "selected-files", choice: "egress", enabled: true });
  const declined = reduceCompanionPreview(granted, { type: "history", choice: "declined" });
  assert.equal(declined.historyChoice, "declined");
  assert.deepEqual(declined.grants["selected-files"], { observe: true, promote: true, egress: false });
  assert.equal(Object.values(declined.grants).some((grant) => grant.egress), false);
});

test("metadata, native messages, browser visits, bookmarks, and page text are separate sample scopes", () => {
  const observed = reduceCompanionPreview(companionPreviewState("off"), { type: "source", id: "browser-visits", choice: "observe", enabled: true });
  assert.equal(observed.grants["browser-bookmarks"].observe, false);
  assert.equal(observed.grants["browser-excerpts"].observe, false);
  const metadata = reduceCompanionPreview(observed, { type: "source", id: "codex-profile-metadata", choice: "observe", enabled: true });
  assert.equal(metadata.grants["codex-profile-excerpts"].observe, false);
});

test("temporary pause keeps a sample note while withdrawal makes its dependent content unavailable", () => {
  const carried = companionPreviewState("carried");
  const paused = reduceCompanionPreview(carried, { type: "pause-awareness" });
  assert.equal(companionPreviewPresentation(paused).creationAvailable, true);
  const withdrawn = reduceCompanionPreview(paused, { type: "source", id: "selected-files", choice: "observe", enabled: false });
  assert.equal(companionPreviewPresentation(withdrawn).creationAvailable, false);
  const observedAgain = reduceCompanionPreview(withdrawn, { type: "source", id: "selected-files", choice: "observe", enabled: true });
  const keepingAgain = reduceCompanionPreview(observedAgain, { type: "source", id: "selected-files", choice: "promote", enabled: true });
  assert.equal(companionPreviewPresentation(keepingAgain).creationAvailable, false);
  assert.equal(companionPreviewPresentation(companionPreviewState("paused")).workLabel, "Background work paused");
});

test("passive source activity cannot reopen let-go or declined shared work", () => {
  const retired = reduceCompanionPreview(companionPreviewState("carried"), { type: "shared", disposition: "retired" });
  const sourceChange = reduceCompanionPreview(retired, { type: "source", id: "browser-visits", choice: "observe", enabled: true });
  assert.equal(sourceChange.shared, "retired");
  const declined = reduceCompanionPreview(sourceChange, { type: "own", disposition: "decline" });
  assert.equal(declined.shared, "retired");
  assert.equal(declined.own, "decline");
});
