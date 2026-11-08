import * as React from "react";
import { ArrowUpRight, Check, ChevronDown } from "lucide-react";

const HOURS = [38, 65, 46, 117, 93, 163, 105, 201, 141, 112, 98, 101];
export function Usage({ billing }: { billing: string }) {
  const [hour, setHour] = React.useState<number | null>(null);
  return (
    <section className="hds-information" aria-label="Example usage">
      <div className="hds-info-head">
        <div>
          <h2>Today’s usage</h2>
          <p>
            Sample data · sessions visible to Polyphonic, not your whole account
          </p>
        </div>
        <span>
          Today <ChevronDown size={12} />
        </span>
      </div>
      <section className="hds-usage-lead">
        <div>
          <strong>{billing === "API key" ? "$2.84" : "1.28M"}</strong>
          <p>
            {billing === "API key"
              ? "Estimated API cost"
              : "Input tokens observed"}
          </p>
        </div>
        <dl>
          <div>
            <dt>Input</dt>
            <dd>1.28M tokens</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>78K tokens</dd>
          </div>
          <div>
            <dt>Cache reads</dt>
            <dd>78% of input</dd>
          </div>
        </dl>
      </section>
      <section className="hds-chart-section">
        <div>
          <h3>Input tokens through the day</h3>
          <span aria-live="polite">
            {hour === null
              ? "Select an hour to inspect"
              : `${hour + 8}:00 · ${HOURS[hour]}K example tokens`}
          </span>
        </div>
        <fieldset className="hds-chart" aria-label="Example tokens by hour">
          {HOURS.map((value, i) => (
            <button
              key={value}
              type="button"
              style={
                { "--bar": `${(value / 201) * 100}%` } as React.CSSProperties
              }
              aria-label={`${i + 8}:00, ${value} thousand example tokens`}
              aria-pressed={hour === i}
              onClick={() => setHour(i)}
            >
              <span />
            </button>
          ))}
        </fieldset>
        <div className="hds-chart-axis">
          <span>08:00</span>
          <span>12:00</span>
          <span>16:00</span>
          <span>20:00</span>
        </div>
      </section>
      <section className="hds-usage-projects">
        <h3>By project</h3>
        {[
          ["Polyphonic", "$1.92", 68],
          ["Field Notes", "$0.71", 25],
          ["Personal website", "$0.21", 7],
        ].map(([name, cost, width]) => (
          <div key={name}>
            <span>{name}</span>
            <div>
              <span style={{ width: `${width}%` }} />
            </div>
            <span>{cost}</span>
          </div>
        ))}
      </section>
      <div className="hds-usage-boundaries">
        <section>
          <h3>Session context</h3>
          <p>
            Shown per session when the harness reports it. A context window is
            not your subscription allowance.
          </p>
        </section>
        <section>
          <h3>Account allowance</h3>
          <p>
            Not available in this preview. Provider limits, resets and credit
            balances need an authoritative provider source.
          </p>
        </section>
      </div>
    </section>
  );
}

export function Connection({
  billing,
  setBilling,
  disconnected,
  reconnect,
  explain,
}: {
  billing: string;
  setBilling: (value: string) => void;
  disconnected: boolean;
  reconnect: () => void;
  explain: (value: string) => void;
}) {
  return (
    <section className="hds-information" aria-label="Example connection">
      <div className="hds-info-head">
        <div>
          <h2>Connection</h2>
          <p>Example configuration · no real account or key is shown</p>
        </div>
      </div>
      <div className="hds-settings-row">
        <div>
          <h3>Claude Code on this Mac</h3>
          <p>
            {disconnected
              ? "The connection needs attention. Your sessions are preserved."
              : "Connected · sessions and task controls available"}
          </p>
        </div>
        {disconnected ? (
          <button className="hds-primary" type="button" onClick={reconnect}>
            Reconnect
          </button>
        ) : (
          <Check size={17} />
        )}
      </div>
      <div className="hds-settings-row">
        <div>
          <h3>Billing source</h3>
          <p>
            New tasks use this account. Existing sessions keep their routing.
          </p>
        </div>
        <select
          aria-label="Example billing source"
          value={billing}
          onChange={(e) => setBilling(e.target.value)}
        >
          <option>API key</option>
          <option>Subscription</option>
        </select>
      </div>
      <div className="hds-settings-row">
        <div>
          <h3>{billing === "API key" ? "API key" : "Subscription"}</h3>
          <p>
            {billing === "API key"
              ? "Example key connected · stored in Keychain in the real app"
              : "Uses your existing Claude Code login in the real app"}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            explain(
              "Design preview only. Account settings and billing would open through the existing secure connection flow.",
            )
          }
        >
          Manage <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="hds-settings-row">
        <div>
          <h3>Default model</h3>
          <p>Follows your Claude Code configuration.</p>
        </div>
        <span>Claude Code default</span>
      </div>
      <section className="hds-capabilities">
        <h3>What this workspace is for</h3>
        <ul>
          <li>
            <Check size={14} />
            Start a task in a project
          </li>
          <li>
            <Check size={14} />
            Continue the exact session
          </li>
          <li>
            <Check size={14} />
            Send a follow-up and follow progress
          </li>
          <li>
            <Check size={14} />
            Review supported approvals here
          </li>
        </ul>
        <p>
          These are proposed controls, not a live capability check. Native-owned
          requests and unsupported actions open in Claude Code. Nothing silently
          substitutes a new session.
        </p>
      </section>
    </section>
  );
}
