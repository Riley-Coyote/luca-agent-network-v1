import assert from "node:assert/strict";
import test from "node:test";

import {
  isConversationalUnreadKind,
  EXCHANGE_TAG,
  KIND_LUCA_EXCHANGE,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_STREAM_MESSAGE_DIFF,
  KIND_SYSTEM_MESSAGE,
  KIND_JOB_REQUEST,
  KIND_JOB_ACCEPTED,
  KIND_JOB_PROGRESS,
  KIND_JOB_RESULT,
  KIND_JOB_CANCEL,
  KIND_JOB_ERROR,
  KIND_HUDDLE_STARTED,
  KIND_HUDDLE_PARTICIPANT_JOINED,
  KIND_HUDDLE_PARTICIPANT_LEFT,
  KIND_HUDDLE_ENDED,
} from "./kinds.ts";

test("isConversationalUnreadKind_streamMessage_counts", () => {
  assert.equal(isConversationalUnreadKind(KIND_STREAM_MESSAGE), true);
});

test("isConversationalUnreadKind_streamMessageV2_counts", () => {
  // 40002 is a real message edit/v2 — must stay counted.
  assert.equal(isConversationalUnreadKind(KIND_STREAM_MESSAGE_V2), true);
});

test("isConversationalUnreadKind_streamMessageDiff_counts", () => {
  // 40008 is a real message diff — must stay counted.
  assert.equal(isConversationalUnreadKind(KIND_STREAM_MESSAGE_DIFF), true);
});

test("isConversationalUnreadKind_systemMessage_excluded", () => {
  // 40099 channel_created / member_joined rows must not inflate the pill.
  assert.equal(isConversationalUnreadKind(KIND_SYSTEM_MESSAGE), false);
});

test("isConversationalUnreadKind_allJobKinds_excluded", () => {
  for (const kind of [
    KIND_JOB_REQUEST,
    KIND_JOB_ACCEPTED,
    KIND_JOB_PROGRESS,
    KIND_JOB_RESULT,
    KIND_JOB_CANCEL,
    KIND_JOB_ERROR,
  ]) {
    assert.equal(isConversationalUnreadKind(kind), false, `kind ${kind}`);
  }
});

test("isConversationalUnreadKind_huddleLifecycle_excluded", () => {
  for (const kind of [
    KIND_HUDDLE_STARTED,
    KIND_HUDDLE_PARTICIPANT_JOINED,
    KIND_HUDDLE_PARTICIPANT_LEFT,
    KIND_HUDDLE_ENDED,
  ]) {
    assert.equal(isConversationalUnreadKind(kind), false, `kind ${kind}`);
  }
});

test("isConversationalUnreadKind_undefinedKind_countsAsConversational", () => {
  // Optimistic/pending rows whose kind has not populated must not be dropped.
  assert.equal(isConversationalUnreadKind(undefined), true);
});

test("isConversationalUnreadKind_unknownKind_countsAsConversational", () => {
  // An exclude-list, not an include-list: anything not explicitly excluded
  // (e.g. a future conversational kind) is kept.
  assert.equal(isConversationalUnreadKind(12345), true);
});

test("lucaExchangeKind_matchesTheFrozenContract", () => {
  // 30178 is frozen in crates/buzz-core/src/kind.rs and re-derived nowhere.
  // The relay classifies it as an owner-authored, global-only, parameterized
  // replaceable record; a drifted mirror here would address a different kind
  // entirely. `pnpm check:kind-parity` guards the whole shared set — this
  // pins the one the exchange object rides on.
  assert.equal(KIND_LUCA_EXCHANGE, 30178);
  assert.equal(EXCHANGE_TAG, "exchange");
});

test("lucaExchangeKind_isKeptOutOfTheUnreadPillByScope_notByTheExcludeList", () => {
  // Documents the real state rather than the state one might assume.
  // `isConversationalUnreadKind` is an exclude-list, and 30178 is not on it —
  // so this returns true. The record still cannot light the unread pill,
  // because the relay classifies 30178 as global-only (`is_global_only_kind`
  // in crates/buzz-relay/src/handlers/ingest.rs): it carries no `h` tag, is
  // never channel-scoped, and so never reaches a per-channel unread tally.
  //
  // The safety here is scope, not the exclude list. If a later change ever
  // channel-scopes the record, minting an exchange and every Stop/Go re-sign
  // would start lighting the pill — add 30178 to NON_CONVERSATIONAL_UNREAD_KINDS
  // at that point and flip this assertion.
  assert.equal(isConversationalUnreadKind(KIND_LUCA_EXCHANGE), true);
});
