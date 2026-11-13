import * as React from "react";
import { ChevronLeft } from "lucide-react";
import type {
  MnemosPage,
  MnemosSection,
  ViewScope,
} from "@/shared/api/mnemosView";

export const labels: Record<MnemosSection, string> = {
  memories: "Memories",
  standing: "Standing memories",
  journal: "Journal",
  notes: "Notes",
  handoffs: "Handoffs",
  beliefs: "Beliefs",
};
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

export function MnemosReading({
  section,
  page,
  number,
  failed,
  onBack,
  onPrevious,
  onNext,
}: {
  section: MnemosSection;
  page: Extract<MnemosPage, { kind: "items" }> | null;
  number: number;
  failed: boolean;
  onBack: () => void;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
}) {
  const heading = React.useId();
  const next = page?.nextCursor;
  const paged = number > 1 || Boolean(next);
  return (
    <section aria-labelledby={heading} className="luca-mnemos-reading">
      <div className="luca-mnemos-heading">
        <h2
          id={heading}
          className="luca-mind-part-title"
          data-mnemos-focus={page ? "reading" : undefined}
          tabIndex={-1}
        >
          {labels[section]}
          {paged ? (
            <span className="luca-mnemos-page-number"> Page {number}</span>
          ) : null}
        </h2>
        <button type="button" className="luca-mind-back" onClick={onBack}>
          <ChevronLeft aria-hidden />
          All sections
        </button>
      </div>
      {page ? (
        <>
          {page.items.length ? (
            <ol className="luca-mind-rows luca-mnemos-items">
              {page.items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed read-only page; items have no controls or state.
                <li key={index}>
                  {item.author ? (
                    <small className="luca-mind-help">
                      {item.author === "agent"
                        ? "From the resident"
                        : "From the person"}
                    </small>
                  ) : null}
                  <p>{item.text}</p>
                  {item.clipped ? (
                    <small className="luca-mind-help">Excerpt</small>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="luca-mind-quiet">
              {number > 1
                ? "No more entries on this page."
                : "Nothing in this section yet."}
            </p>
          )}
          {paged ? (
            <nav
              aria-label={`${labels[section]} pages`}
              className="luca-mnemos-pages"
            >
              {number > 1 ? (
                <button
                  type="button"
                  className="luca-mind-inline"
                  onClick={onPrevious}
                >
                  Previous page
                </button>
              ) : null}
              {next ? (
                <button
                  type="button"
                  className="luca-mind-inline"
                  onClick={() => onNext(next)}
                >
                  Next page
                </button>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : !failed ? (
        <p className="luca-mind-quiet" role="status">
          Reading…
        </p>
      ) : null}
    </section>
  );
}
