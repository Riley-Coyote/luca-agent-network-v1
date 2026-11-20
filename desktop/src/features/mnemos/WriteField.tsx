import * as React from "react";

import { Button } from "@/shared/ui/button";
import type { WriteFailure } from "./adapt";
import { fieldState } from "./notebook";

/** What a field says when a write didn't happen, by why. The words stay in
 *  the field whatever it says. */
export function failureWords(
  failure: WriteFailure,
  fallback: string,
): { line: string; again: boolean } {
  if (failure.kind === "said") return { line: failure.said, again: false };
  if (failure.kind === "busy")
    return {
      line: "Mnemos was busy with this memory, so nothing was saved.",
      again: true,
    };
  return { line: fallback, again: true };
}

/** A write's failure, whatever was thrown. */
const asFailure = (error: unknown): WriteFailure =>
  typeof error === "object" && error !== null && "kind" in error
    ? (error as WriteFailure)
    : { kind: "failed", code: String(error) };

/**
 * A field for the person's own words (WP-47, Decided 1 to 4): one label,
 * the notebook's hint under it where there is one, and one button. The
 * count shows only near Mnemos's limit, and a text past it can't be sent.
 * A write goes once: the button is off while it is in flight, and nothing
 * sends it again by itself. When it doesn't happen, the field says why in
 * one line (the engine's own sentence where it gave one) and keeps every
 * word typed.
 */
export function WriteField({
  autoFocus,
  cancelLabel,
  failLine = "It couldn’t be sent just now. Your words are still here.",
  hint,
  initial = "",
  hideLabel,
  label,
  layout = "inline",
  needsChange,
  onCancel,
  onSend,
  sendLabel,
  sendingLabel,
  testId,
}: {
  autoFocus?: boolean;
  /** With `onCancel`: a second button that leaves without writing. */
  cancelLabel?: string;
  /** The line for a write that failed for no reason Mnemos gave. */
  failLine?: string;
  hint?: string;
  /** The label is said, not shown: a heading above already shows it. */
  hideLabel?: boolean;
  initial?: string;
  label: string;
  /** `inline`: one line that grows to about five, Send beside it (an
   *  answer, a note). `stacked`: the words whole, the buttons under them
   *  (a correction). */
  layout?: "inline" | "stacked";
  /** Nothing to send until the words differ from `initial` (a correction). */
  needsChange?: boolean;
  onCancel?: () => void;
  /** Writes the words; throws a `WriteFailure` when it didn't happen. */
  onSend: (text: string) => Promise<void>;
  sendLabel: string;
  /** The button's words while the write is in flight. */
  sendingLabel?: string;
  testId: string;
}) {
  const id = React.useId();
  const [text, setText] = React.useState(initial);
  const [sending, setSending] = React.useState(false);
  const [failure, setFailure] = React.useState<WriteFailure | null>(null);
  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The field grows with what's written in it, from one line.
  const area = React.useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again whenever the words change.
  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const fits = fieldState(text);
  const state = {
    ...fits,
    canSend: fits.canSend && !(needsChange && text.trim() === initial.trim()),
  };

  const send = async () => {
    if (inFlight.current || !state.canSend) return;
    inFlight.current = true;
    setSending(true);
    setFailure(null);
    try {
      await onSend(text);
      if (mounted.current) setText("");
    } catch (error) {
      if (mounted.current) setFailure(asFailure(error));
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  };

  const said = failure ? failureWords(failure, failLine) : null;
  const sendButton = (
    <Button
      data-testid={`${testId}-send`}
      disabled={sending || !state.canSend}
      size="quiet"
      type="submit"
    >
      {sending && sendingLabel ? sendingLabel : sendLabel}
    </Button>
  );
  const count = state.count ? (
    <span
      aria-live="polite"
      className="luca-mnemos-write-count text-2xs tabular-nums"
      data-over={state.over ? "" : undefined}
      data-testid={`${testId}-count`}
    >
      {state.count}
    </span>
  ) : null;
  return (
    <form
      aria-busy={sending || undefined}
      className="luca-mnemos-write"
      data-layout={layout}
      data-testid={testId}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label
        className={
          hideLabel
            ? "sr-only"
            : "luca-place-section-label luca-mnemos-write-label"
        }
        htmlFor={id}
      >
        {label}
      </label>
      {hint ? (
        <p className="luca-mnemos-quiet text-xs" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <div className="luca-mnemos-write-row">
        <textarea
          aria-describedby={
            [hint ? `${id}-hint` : null, said ? `${id}-said` : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={state.over || undefined}
          // biome-ignore lint/a11y/noAutofocus: Correct it turns the words into this field; the person's next act is typing.
          autoFocus={autoFocus}
          className="luca-mnemos-write-text text-base"
          data-testid={`${testId}-text`}
          id={id}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            } else if (event.key === "Escape" && onCancel && !sending) {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          ref={area}
          rows={1}
          value={text}
        />
        {layout === "inline" ? sendButton : null}
      </div>
      {said ? (
        <div
          className="luca-mnemos-write-said"
          data-testid={`${testId}-said`}
          id={`${id}-said`}
          role="status"
        >
          <p className="text-sm">{said.line}</p>
          {said.again ? (
            <Button
              disabled={sending || !state.canSend}
              onClick={() => void send()}
              size="quiet"
              type="button"
              variant="quiet"
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {layout === "inline" ? (
        count ? (
          <div className="luca-mnemos-write-foot">{count}</div>
        ) : null
      ) : (
        <div className="luca-mnemos-write-foot">
          {count}
          {onCancel && cancelLabel ? (
            <Button
              data-testid={`${testId}-cancel`}
              disabled={sending}
              onClick={onCancel}
              size="quiet"
              type="button"
              variant="quiet"
            >
              {cancelLabel}
            </Button>
          ) : null}
          {sendButton}
        </div>
      )}
    </form>
  );
}
