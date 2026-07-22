# Universal Brain and Continuity Service V1

## Boundary

Mnemos remains the canonical personal knowledge system. Luca adds one narrow,
versioned service boundary so the Buzz-derived Rust/React product does not read
Mnemos tables directly. The service is local, supervised, fail-soft and unable
to author conversation messages or sign resident continuity.

## Process model

- Desktop exclusively spawns the packaged sidecar with private piped stdin and
  stdout. The service opens no listener, loopback port, browser endpoint or
  reusable bearer-capability channel.
- Frames are length-prefixed RFC 8785 canonical JSON with protocol version,
  request ID, desktop-generated session epoch, monotonic sequence and strict
  byte/deadline limits. At most four requests are in flight. A restart creates
  new pipes and epoch; old or duplicated sequence/request IDs are rejected and
  outstanding requests fail visibly.
- Requests carry opaque resident/profile/provider handles resolved through the
  desktop's epoch-bound binding table. Caller-supplied owner or agent text never
  grants authority.
- Supervisor performs spawn, health, bounded restart and clean shutdown.
- Service failure is observable but cannot block the conversation plane.

The canonical service is Python 3.10+ using Mnemos's Python boundary. Development
uses the project-pinned environment. The design-partner macOS arm64 application
bundles a PyInstaller `onedir` sidecar as a Tauri resource; build tasks must pin
the interpreter/dependencies, inventory licenses, verify codesigning, and run a
clean-machine launch without ambient Python. If that packaging proof fails, G3
fails rather than silently depending on the developer machine.

## Versioned operations

| Operation | Purpose | Durable write allowed |
|---|---|---:|
| `health.v1` | readiness and component states | No |
| `profiles.list.v1` | resolve existing Mnemos profiles | No |
| `corpus.ingest.v1` | ingest one approved folder/notes corpus | Yes, explicit |
| `profile.snapshot.refresh.v1` | build a versioned immutable Luca read snapshot from Mnemos plus current policy overlay | Yes, explicit; never on a turn |
| `context.prepare.v1` | filter, retrieve, render and receipt | **No** |
| `checkpoint.request.build.v1` | deterministic salience/clip and structured provider request inputs | No |
| `checkpoint.response.validate.v1` | validate bounded provider output into an unsigned digest/thread proposal | No Capsule write |
| `receipts.get.v1` | owner-only safe diagnostics | No |

There is no general arbitrary SQL, memory-search or model-proxy endpoint.

## Canonical access decision

```ts
type VisibilityV1 = "shared_to_agents" | "agent_private" | "owner_only";
type ProviderBoundaryV1 = "local" | "approved_remote";

interface AccessInputV1 {
  authenticated_owner_id: string;
  responding_agent_id: string;
  resident_owner_id: string;
  record_owner_id: string;
  visibility: VisibilityV1 | "missing" | "unknown";
  bound_agent_id?: string;
  local_only: boolean | "missing";
  provider_boundary: ProviderBoundaryV1;
  explicit_deny: boolean;
}
```

Evaluation order is fixed:

1. deny owner mismatch;
2. deny explicit deny;
3. deny missing/unknown visibility or missing egress policy;
4. deny `owner_only` for every agent prompt;
5. for `agent_private`, deny unless the bound resident exactly equals the
   responding resident; otherwise mark visibility eligible and continue;
6. for `shared_to_agents`, deny unless the responding resident belongs to the
   same authenticated owner; otherwise mark visibility eligible and continue;
7. deny `local_only` for `approved_remote`;
8. only after every deny predicate has been evaluated, allow an eligible record.

Implementations may not return `allow` from steps 5 or 6. The shared protocol
vectors enumerate the Cartesian product of owner match, explicit deny,
visibility/missing/unknown, bound resident, resident owner, local-only/missing
and provider boundary; Rust, Python and TypeScript must produce the same final
decision and reason code.

For V1, `shared_to_agents` means every configured resident belonging to the same
owner. Per-record recipient lists are deferred because they add another sharing
model and are not required for the collective-brain launch proof. The owner can
choose `agent_private` when only one resident should receive a record.

Project, person, room membership, Capsule content, source agent and model-
requested scope may narrow relevance but can never turn deny into allow. Every
responding agent gets a fresh decision, including agent-to-agent messages.

After authorization, relevance scope is one of:

- `exact`: only records with the app-resolved person/project binding;
- `prefer_then_global`: query the preferred authorized set, then an authorized
  global set only when the bounded first pass is insufficient; receipt records
  `widened=true`;
- `global`: all otherwise-authorized records in the selected profile.

Person/project identifiers are app-resolved opaque IDs, never free-form model
authority.

## Legacy classification

- New Brain Setup records receive one explicitly disclosed corpus policy as part
  of the ingestion transaction.
- Existing `private/shared/public` records are not silently treated as V1
  classes. A count-only preview asks the owner to select corpus-level visibility,
  egress and default relevance policy. Luca writes a transactionally versioned
  policy overlay in its own app database keyed by stable Mnemos record IDs; it
  does not mutate the legacy Mnemos store. Unknown, unmapped, deleted and
  archived records remain denied.
- No pre-V1 record implies remote-provider permission. `local_only` is treated
  as true until explicitly classified for egress.
- Migration reports only counts and opaque record IDs, never bodies.
- Filtering happens before ranking, reconsolidation or other mutation-capable
  code. The legacy paths that reconsolidate before final filtering are forbidden
  for turn preparation.

## `context.prepare.v1`

Request fields:

```ts
interface ContextPrepareRequestV1 {
  protocol: "luca.continuity.v1";
  request_id: string;
  authenticated_session_handle: string;
  responding_agent_handle: string;
  conversation_id: string;
  trigger_event_id: string;
  query: string;
  relevance_scope: "exact" | "prefer_then_global" | "global";
  person_handle?: string;
  project_handle?: string;
  provider_policy_handle: string; // app-issued and bound to runtime/model/policy
  limits: {
    deadline_ms: number;        // default 1200, hard max 2500
    max_records: number;        // default 8, hard max 16
    max_rendered_bytes: number; // default 16000, hard max 24000
  };
}
```

Response fields:

```ts
type ContextStateV1 =
  | "ready" | "no_context" | "denied" | "egress_denied"
  | "snapshot_stale" | "unavailable" | "locked" | "timeout" | "invalid";

interface ContextPrepareResultV1 {
  protocol: "luca.continuity.v1";
  request_id: string;
  state: ContextStateV1;
  rendered_context?: string;
  receipt: {
    receipt_id: string;
    responding_agent_id: string;
    trigger_event_id: string;
    provider_boundary: "local" | "approved_remote";
    provider_policy_revision: string;
    snapshot_id: string;
    snapshot_manifest_sha256: string;
    source_state_token: string;
    relevance_scope: "exact" | "prefer_then_global" | "global";
    person_id?: string;
    project_id?: string;
    widened: boolean;
    sources: Array<{
      source_id: string;
      safe_label: string;
      visibility: VisibilityV1;
      local_only: boolean;
    }>;
    denied_counts: Record<string, number>;
    truncated: boolean;
    duration_ms: number;
  };
  error_code?: string;
}
```

The host owns one 2,500 ms total turn-context deadline. Recommended sub-budgets
are 800 ms for fast Capsule resolution and 1,200 ms for Mnemos recall, leaving
integration margin; unused time may be shared but the total never extends.
Missing pointer/target, relay partition, poisoned clock, decrypt failure,
oversize data, corrupted cache and service timeout all produce distinct degraded
status while the agent response path continues.

This receipt is ephemeral: `context.prepare.v1` returns it in memory and makes
no durable write to Mnemos, its WAL/SHM family, the service filesystem or the
app database. After a provider request is actually dispatched, the desktop may
append a separately defined, body-free `context.dispatched.v1` audit receipt to
the app audit store. A prepared-but-never-dispatched request creates no durable
receipt.

The model-facing form contains safe labels and opaque IDs only. Owner UI may
resolve a source ID to a local path through a separate privileged view. Local
paths are redacted from exports, telemetry and model prompts by default.

The desktop resolves `provider_policy_handle` before creating the epoch-bound
binding; the service never accepts a declaration that a provider is local. A
desktop-issued dispatch snapshot binds resident, runtime executable hash,
provider account, model, endpoint class, policy revision and request ID. The
host reauthorizes the complete semantic provider request—including Capsule,
brain context, tool payloads and adapter-added fields—at the last controllable
edge. Only transport framing and TLS may occur afterward. Adapter mutation,
endpoint/provider substitution or policy revision mismatch fails closed.
Request-bound recalled bodies are discarded after the turn and never enter
general caches, observer frames, crash artifacts or receipts.

## Retrieval implementation

### Versioned read snapshot

```ts
interface ProfileSnapshotRefreshRequestV1 {
  protocol: "luca.profile.snapshot.refresh.v1";
  request_id: string;
  authenticated_session_handle: string;
  profile_handle: string;
  policy_overlay_handle: string;
  expected_policy_revision: string;
}

interface ProfileSnapshotManifestV1 {
  schema: "luca.profile.snapshot-manifest.v1";
  canonicalization: "RFC8785";
  snapshot_id: string;
  created_at: string;
  profile_id: string;
  source_state_token: string;
  policy_overlay_revision: string;
  policy_overlay_sha256: string;
  access_contract_revision: string;
  files: Array<{ role: "records" | "fts" | "policy"; relative_path: string; byte_length: number; sha256: string }>;
  eligible_record_count: number;
  denied_record_count: number;
  manifest_sha256: string;
}

type ProfileSnapshotRefreshResultV1 =
  | { state: "activated" | "replayed"; snapshot_id: string; manifest_sha256: string; source_state_token: string; policy_overlay_revision: string }
  | { state: "conflict" | "unavailable" | "invalid"; code: string };
```

The manifest hash is over RFC 8785 bytes with `manifest_sha256` omitted.
Relative paths cannot escape the version directory. Every selected file is
opened by descriptor, size-limited and hash-verified before activation and again
before use.

`source_state_token` is a domain-separated SHA-256 over the canonical profile
identifier; SQLite schema/user versions and main-header change counter; and
device/inode, byte length and nanosecond modification time for the database,
WAL and SHM files (an absent file has an explicit marker). The sidecar samples
this tuple before and after the consistent backup and retries if it changes.
Before prepare it compares a fresh sample plus the desktop's explicit profile-
changed generation with the manifest. Any known mismatch is `snapshot_stale`.
This is detection, not a filesystem authenticity guarantee; a privileged actor
that can rewrite files and forge metadata is outside V1's claim.

The sidecar never opens a concurrently mutable Mnemos database with
`immutable=1`. Existing-profile selection and each explicit ingestion/refresh
build a versioned Luca-owned read snapshot outside the turn path:

1. Desktop provides the current app policy-overlay database/revision and the
   selected Mnemos profile through epoch-bound handles.
2. The sidecar uses SQLite's online backup/read transaction mechanisms with
   `mode=ro`/`query_only` source access to obtain a consistent Mnemos copy; it
   never writes the source DB/WAL/SHM family.
3. It joins stable Mnemos record IDs to the policy overlay. Rows without current
   owner/visibility/egress policy are retained as denied metadata or omitted;
   they can never become candidates. Archived/deleted rows are omitted.
4. It writes temporary snapshot/index files inside Luca app data, hashes them,
   records source/version/policy revision, validates queries, fsyncs files and
   directory, then atomically switches a small pointer containing snapshot ID
   and manifest hash. Interrupted builds remain inactive; startup retains the
   last verified pointer and removes only journal-proven incomplete versions.
5. `context.prepare.v1` opens only the manifest-selected copies with
   `immutable=1` and requires the request policy revision to match. A policy
   change immediately increments desktop revision/final-egress denial and makes
   the old snapshot unusable until refresh. New ingestion is not reported ready
   until overlay and snapshot activation both succeed.

Known external Mnemos changes are shown as `snapshot_stale` until an explicit
refresh; V1 does not promise continuous watching or defend against a privileged
metadata-forging local actor. This duplicates a local plaintext read
snapshot unless the platform/full-disk layer protects it, so the storage
inventory and launch copy say so.

### Turn query

V1 uses the proven immutable read seam:

1. resolve authenticated snapshot manifest/revision and allowed record set;
2. apply access/egress decision before retrieval;
3. run direct FTS or a copied rich retriever configured with
   reconsolidation disabled;
4. apply `exact`, `prefer_then_global` or `global` relevance semantics and rank
   within each already-authorized set;
5. deterministically cap records and bytes;
6. render content as quoted untrusted memory with source IDs;
7. emit a body-free receipt;
8. prove database and logical record immutability before/after.

No access-time reinforcement, last-access update, reconsolidation, embedding
write, link write or consolidation may occur.

Archived legacy rows are excluded from V1 agent recall. Current archive tables
and search paths drop owner/person/project/visibility policy and lack a safe
owner predicate. They may be re-enabled only after first-class V1 policy fields,
prefiltered authorization and the same immutability suite exist. Consolidation
logs are diagnostic evidence, never an authorization source.

Visibility, locality, deletion, person/project binding or provider-policy
changes increment a policy revision, invalidate the current snapshot for new
prepares, and invalidate affected ephemeral retrieval caches. A retrieve-then-
revoke-before-send race is denied during the final outbound reauthorization.
Deleted/revoked content cannot be retrieved again in the active profile; backup
and already-processed remote-provider limitations are disclosed separately.

## Brain Setup

V1 supports either:

- selecting an existing Mnemos profile after a read-only inventory; or
- choosing one local folder/notes corpus.

Folder ingestion:

- resolves symlinks and rejects paths outside the selected root;
- supports a documented allowlist of text/markdown formats first;
- uses stable file identity and content hashes for idempotent re-index;
- records sanitized title, relative source label, modification time, content
  hash, ingestion run and corpus policy;
- never places absolute paths in model-facing provenance;
- exposes discovered, accepted, skipped, failed and committed counters;
- uses staging plus commit so cancellation or failure does not report readiness;
- does not watch folders continuously in V1.

## Health and liveness

Health is a state vector, not a single green light:

- service process;
- IPC authentication;
- profile resolution;
- store/index readiness;
- ingestion last run and counters;
- recall attempts/success/denials/timeouts;
- checkpoint proposal attempts/success/failure;
- last successful operation timestamps.

Health is relative to the latest qualifying input. A recent success or valid
no-change after that input is healthy; an older lifetime success cannot mask a
current failure, timeout or unprocessed qualifying input.

## Required proofs

- service absent, killed, locked, malformed and slow while conversation succeeds;
- malformed, duplicate-sequence, replayed or cross-epoch frame rejected;
- zero-write byte/logical diff for every prepare path, with only the separately
  enumerated post-dispatch app audit row allowed afterward;
- wrong-project and denied records cannot mutate before exclusion;
- complete visibility/egress truth table;
- agent-to-agent reauthorization;
- `local_only` remote outbound-payload capture contains no protected body;
- retrieve-then-revoke and provider-substitution races fail closed;
- active/dormant scope excludes unsafe legacy archive rows;
- exact/prefer/global person/project semantics and widening indicator;
- safe ephemeral receipt, post-dispatch audit redaction and no-dispatch/no-write;
- folder ingestion provenance, idempotency, cancellation and partial failure;
- packaged sidecar clean-machine startup without ambient Python;
- snapshot refresh never mutates source Mnemos DB/WAL/SHM, aborts/retries safely
  under concurrent ingestion, rejects policy-revision mismatch, and never uses
  `immutable=1` against a mutable source;
- new/unmapped external records are denied; revoke-before-snapshot-refresh is
  blocked by final policy reauthorization;
- all nine context states render distinctly.
