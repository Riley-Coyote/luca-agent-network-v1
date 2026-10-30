import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The parts every page of a mind is built from (BETA14_RELEASE.md WP-43):
 * a page's head (its back link, its title, the line saying what it
 * decides), Settings' filled panels with plain titles and rows of at least
 * 44, a section's hairline head, and the small ink dot that says new.
 */

/** A page that slid in: "‹ {where you came from}", its title, its line.
 *  The title takes focus on arrival (Decided 2). */
export function MindPageHead({
  back,
  lede,
  mark,
  onBack,
  title,
  titleRef,
  titleTestId,
}: {
  back: string;
  lede?: React.ReactNode;
  mark?: React.ReactNode;
  onBack: () => void;
  title: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
  titleTestId?: string;
}) {
  return (
    <header className="luca-mind-pagehead">
      <button
        className="luca-mind-back"
        data-testid="mind-back"
        onClick={onBack}
        type="button"
      >
        <ChevronLeft aria-hidden />
        {back}
      </button>
      <div className="luca-mind-pagetitle">
        {mark ? (
          <span aria-hidden className="luca-mind-pagemark">
            {mark}
          </span>
        ) : null}
        <h1
          className="luca-mind-title"
          data-testid={titleTestId ?? "mind-page-title"}
          ref={titleRef}
          tabIndex={-1}
        >
          {title}
        </h1>
      </div>
      {lede ? <p className="luca-mind-lede">{lede}</p> : null}
    </header>
  );
}

/** A group: its plain title above a filled panel, a footnote under it. */
export function MindGroup({
  children,
  footnote,
  testId,
  title,
}: {
  children: React.ReactNode;
  footnote?: React.ReactNode;
  testId?: string;
  title: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className="luca-mind-group"
      data-testid={testId}
    >
      <h2 className="luca-mind-group-title" id={id}>
        {title}
      </h2>
      <div className="luca-mind-panel">{children}</div>
      {footnote ? <p className="luca-mind-footnote">{footnote}</p> : null}
    </section>
  );
}

/**
 * One row of a panel, at least 44 tall: its label, a help line, its value
 * at the right and a chevron when it opens a page; a switch or a select
 * when it carries its control inline.
 */
export function MindRow({
  capabilityState,
  control,
  help,
  label,
  onOpen,
  testId,
  value,
}: {
  /** A capability's state, as today's rows mark it (`data-capability-state`). */
  capabilityState?: string;
  control?: React.ReactNode;
  help?: React.ReactNode;
  label: React.ReactNode;
  onOpen?: () => void;
  testId?: string;
  value?: React.ReactNode;
}) {
  const words = (
    <span className="luca-mind-prow-words">
      <span className="luca-mind-prow-label">{label}</span>
      {help ? <span className="luca-mind-prow-help">{help}</span> : null}
    </span>
  );
  const end = (
    <>
      {value !== undefined && value !== null && value !== "" ? (
        <span className="luca-mind-prow-value">{value}</span>
      ) : null}
      {onOpen ? (
        <ChevronRight aria-hidden className="luca-mind-prow-chevron" />
      ) : null}
    </>
  );
  if (onOpen)
    return (
      <button
        className="luca-mind-prow"
        data-opens="true"
        data-testid={testId}
        onClick={onOpen}
        type="button"
      >
        {words}
        {end}
      </button>
    );
  return (
    <div
      className="luca-mind-prow"
      data-capability-state={capabilityState}
      data-testid={testId}
    >
      {words}
      {end}
      {control ? (
        <span className="luca-mind-prow-control">{control}</span>
      ) : null}
    </div>
  );
}

/** A section of their page: a hairline, the title at the left, its one
 *  control at the right, then its content (Decided 7). */
export function MindSection({
  children,
  control,
  testId,
  title,
}: {
  children: React.ReactNode;
  control?: React.ReactNode;
  testId?: string;
  title: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className="luca-mind-part"
      data-testid={testId}
    >
      <div className="luca-mind-part-head">
        <h2 className="luca-mind-part-title" id={id}>
          {title}
        </h2>
        {control ? (
          <div className="luca-mind-part-control">{control}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Chips (`.luca-mind-filter`): one choice of a few, with its count. */
export function MindChips<T extends string>({
  label,
  onChange,
  options,
  testIdPrefix,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: { id: T; label: string; count?: number | null }[];
  testIdPrefix: string;
  value: T;
}) {
  return (
    <fieldset aria-label={label} className="luca-mind-filters">
      {options.map((each) => (
        <button
          aria-pressed={value === each.id}
          className="luca-mind-filter"
          data-selected={value === each.id ? "true" : undefined}
          data-testid={`${testIdPrefix}-${each.id}`}
          key={each.id}
          onClick={() => onChange(each.id)}
          type="button"
        >
          {each.label}
          {typeof each.count === "number" ? (
            <span className="luca-mind-count">{each.count}</span>
          ) : null}
        </button>
      ))}
    </fieldset>
  );
}

/** New since your last visit (Decided 8): a 6 px ink dot. */
export function NewDot() {
  return (
    <span
      aria-label="New since your last visit"
      className="luca-mind-newdot"
      data-testid="mind-new"
      role="img"
    />
  );
}
