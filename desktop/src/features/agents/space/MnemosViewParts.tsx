import * as React from "react";
import type { ViewScope } from "@/shared/api/mnemosView";

export const emptyScope: ViewScope = {
  agent_id: "",
  person_id: "",
  project_scope: "",
};
const fields = [
  ["agent_id", "Agent ID"],
  ["person_id", "Person ID"],
  ["project_scope", "Project scope"],
] as const;
const validId = (value: string) =>
  value.length > 0 &&
  value.length <= 128 &&
  !/[^a-z0-9_-]/.test(value) &&
  !value.startsWith("-") &&
  !value.endsWith("-");

export function MnemosConnectForm({
  scope,
  onChange,
  onChoose,
  onCancel,
  busy,
}: {
  scope: ViewScope;
  onChange: (scope: ViewScope) => void;
  onChoose: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const hint = React.useId();
  const invalid = fields.some(
    ([key]) => scope[key] !== "" && !validId(scope[key]),
  );
  return (
    <form
      className="luca-mnemos-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && fields.every(([key]) => validId(scope[key]))) onChoose();
      }}
    >
      <p className="luca-mind-help">
        Enter the IDs from your Mnemos store. You’ll choose the file and review
        the connection next.
      </p>
      {fields.map(([key, label]) => {
        const bad = scope[key] !== "" && !validId(scope[key]);
        return (
          <label key={key}>
            {label}
            <input
              className="luca-mind-input"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              required
              maxLength={128}
              readOnly={busy}
              data-mnemos-focus={key === "agent_id" ? "first-id" : undefined}
              aria-invalid={bad || undefined}
              aria-describedby={bad ? hint : undefined}
              value={scope[key]}
              onChange={(e) => onChange({ ...scope, [key]: e.target.value })}
            />
          </label>
        );
      })}
      {invalid ? (
        <p id={hint} className="luca-mind-help" role="status">
          Use lowercase letters, numbers, underscores, or hyphens. An ID can’t
          start or end with a hyphen.
        </p>
      ) : null}
      <div className="luca-mind-actions">
        <button
          type="submit"
          data-mnemos-focus="choose"
          disabled={busy || !fields.every(([key]) => validId(scope[key]))}
          className="luca-mind-inline"
        >
          Choose store…
        </button>
        <button
          type="button"
          disabled={busy}
          className="luca-mind-quietlink"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
