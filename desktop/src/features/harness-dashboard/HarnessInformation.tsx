import { ArrowUpRight, Check, RefreshCw } from "lucide-react";

import type {
  HarnessRuntimeFamily,
  HarnessSessionUsage,
} from "@/shared/api/tauriHarnessDashboard";
import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";
import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";
import { formatHarnessDuration, harnessTaskUsage } from "./model";

export function HarnessUsage({
  tasks,
  selectedUsage,
  status,
}: {
  tasks: readonly RuntimeTaskProjection[];
  selectedUsage: HarnessSessionUsage | null;
  status: "loading" | "error" | "ready";
}) {
  const usage = harnessTaskUsage(tasks);
  const tokenValue = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value.toLocaleString()
      : "Unavailable";
  return (
    <section className="hws-information" aria-label="Observed usage">
      <div className="hws-info-head">
        <div>
          <h2>Observed usage</h2>
          <p>
            Local task receipts visible to Polyphonic · not your whole account
          </p>
        </div>
      </div>
      <section className="hws-usage-lead">
        <div>
          <strong>{status === "ready" ? usage.total : "—"}</strong>
          <p>
            {status === "ready"
              ? "Recorded tasks"
              : status === "loading"
                ? "Loading task receipts…"
                : "Task counts unavailable"}
          </p>
        </div>
        <dl>
          <div>
            <dt>Working</dt>
            <dd>{status === "ready" ? usage.working : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{status === "ready" ? usage.completed : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Recorded duration</dt>
            <dd>
              {usage.timedTasks
                ? formatHarnessDuration(usage.durationMs)
                : "Unavailable"}
            </dd>
          </div>
        </dl>
      </section>
      <div className="hws-usage-boundaries">
        <section>
          <h3>Selected session tokens</h3>
          <p>
            Input: {tokenValue(selectedUsage?.inputTokens)}
            <br />
            Output: {tokenValue(selectedUsage?.outputTokens)}
            <br />
            Total: {tokenValue(selectedUsage?.totalTokens)}
          </p>
          <p>
            Only reported native transcript metadata. Tokens are not a
            subscription allowance or a cost.
          </p>
        </section>
        <section>
          <h3>Account allowance & cost</h3>
          <p>
            Unavailable. Provider limits, resets, credit balances and API
            charges need an authoritative provider source.
          </p>
          <p>
            Duration comes from Polyphonic-owned task timestamps. Native
            handoffs are excluded.
          </p>
        </section>
      </div>
      {tasks.length ? (
        <section className="hws-usage-records">
          <h3>Recent task receipts</h3>
          <ul>
            {tasks.slice(0, 12).map((task) => (
              <li key={task.taskId}>
                <p>{task.summary}</p>
                <span>
                  {task.controlOwner === "native_app"
                    ? "Native-owned"
                    : task.state}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

export function HarnessConnection({
  runtimeFamily,
  connections,
  loading,
  error,
  apiConnected,
  onRefresh,
  onSettings,
}: {
  runtimeFamily: HarnessRuntimeFamily;
  connections: readonly RuntimeConnectionStatusV1[];
  loading: boolean;
  error: string | null;
  apiConnected: boolean | null;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  const name = runtimeFamily === "codex" ? "Codex" : "Claude Code";
  const runtimes = connections.filter(
    (connection) => connection.runtimeId === runtimeFamily,
  );
  return (
    <section className="hws-information" aria-label={`${name} connection`}>
      <div className="hws-info-head">
        <div>
          <h2>Connection</h2>
          <p>
            Runtime status on this Mac. Credentials stay in the existing secure
            settings.
          </p>
        </div>
      </div>
      {error ? (
        <p className="hws-inline-status" role="alert">
          {error}
        </p>
      ) : null}
      {runtimes.length ? (
        runtimes.map((runtime) => (
          <div
            className="hws-settings-row"
            key={runtime.statusId ?? `${runtime.runtimeId}:${runtime.label}`}
          >
            <div>
              <h3>{runtime.label} on this Mac</h3>
              <p>
                {runtime.authentication === "required"
                  ? "Sign in required"
                  : runtime.readiness === "ready" &&
                      runtime.authentication === "ready"
                    ? "Ready for new tasks"
                    : runtime.readiness === "degraded"
                      ? "Needs attention"
                      : "Not ready"}
                {runtime.version ? ` · ${runtime.version}` : ""}
              </p>
              {runtime.reason ? <p>{runtime.reason}</p> : null}
            </div>
            {runtime.readiness === "ready" &&
            runtime.authentication === "ready" ? (
              <Check size={17} aria-label="Ready" />
            ) : (
              <button type="button" onClick={onSettings}>
                Review <ArrowUpRight size={13} aria-hidden />
              </button>
            )}
          </div>
        ))
      ) : (
        <div className="hws-settings-row">
          <div>
            <h3>{name} on this Mac</h3>
            <p>
              {loading
                ? "Checking connection…"
                : "Runtime status is unavailable."}
            </p>
          </div>
        </div>
      )}
      <div className="hws-settings-row">
        <div>
          <h3>Billing source</h3>
          <p>
            {runtimeFamily === "claude_code"
              ? apiConnected === null
                ? "Claude API configuration could not be verified."
                : apiConnected
                  ? "A Claude API key is configured. Existing sessions keep their own routing."
                  : "No Claude API key is configured in Polyphonic. Native sessions keep their own login."
              : "Follows the existing Codex configuration. Account billing is not reported here."}
          </p>
        </div>
        <button type="button" onClick={onSettings}>
          Manage <ArrowUpRight size={13} aria-hidden />
        </button>
      </div>
      <div className="hws-settings-row">
        <div>
          <h3>Default model</h3>
          <p>
            Follows your {name} configuration. No model override is applied
            here.
          </p>
        </div>
        <span>{name} default</span>
      </div>
      <div className="hws-settings-row">
        <div>
          <h3>Refresh status</h3>
          <p>
            Sessions refresh on native task events, window focus, or your
            request.
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={13} aria-hidden />
          Refresh
        </button>
      </div>
      <section className="hws-capabilities">
        <h3>What this workspace is for</h3>
        <ul>
          <li>
            <Check size={14} aria-hidden />
            Start a task in a chosen folder
          </li>
          <li>
            <Check size={14} aria-hidden />
            Review an exact saved session before continuing
          </li>
          <li>
            <Check size={14} aria-hidden />
            Send follow-ups where native routing supports them
          </li>
          <li>
            <Check size={14} aria-hidden />
            Answer supported local approval requests
          </li>
        </ul>
        <p>
          Native-owned approvals and stopping remain in {name}. Closing or
          switching this view never stops work. Saved transcripts are not a live
          activity signal.
        </p>
      </section>
    </section>
  );
}
