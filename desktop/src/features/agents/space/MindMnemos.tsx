import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { managedAgentsQueryKey } from "@/features/agents/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  type MindChoice,
  mnemosSections,
  mnemosView,
  type MnemosPage,
  type MnemosSection,
  type ViewCounts,
  type ViewScope,
  type ViewStatus,
} from "@/shared/api/mnemosView";
import { listManagedAgents } from "@/shared/api/tauri";
import {
  startManagedAgent,
  stopManagedAgent,
  tryStopManagedAgentForAutoRestart,
} from "@/shared/api/tauriManagedAgents";
import { MindGroup, MindPageHead, MindRow } from "./MindPageKit";
import "./mind-mnemos.css";

import {
  emptyScope,
  labels,
  MnemosConnectForm,
  MnemosReading,
} from "./MnemosViewParts";

function count(c: ViewCounts, s: MnemosSection) {
  return s === "memories"
    ? c.memories.active + c.memories.dormant
    : s === "notes"
      ? c.notes.all
      : c[s];
}
type Issue = {
  message: string;
  restart?: true;
  connection?: true;
  review?: true;
};
function explain(error: unknown): Issue {
  const code = error instanceof Error ? error.message : String(error);
  switch (code) {
    case "store_changed":
      return {
        message:
          "The store moved or was replaced. Reconnect it before reading again.",
        review: true,
      };
    case "store_unavailable":
      return {
        message:
          "This store couldn’t be read. Check that the file is available on this Mac.",
      };
    case "binding_changed":
      return {
        message: "The connection changed. Open its current overview.",
        restart: true,
      };
    case "stale_page":
      return {
        message:
          "This page is no longer available. Open the overview to start again.",
        restart: true,
      };
    case "reader_unavailable":
      return { message: "The compatible local reader isn’t available." };
    case "reader_timeout":
    case "reader_busy":
      return {
        message: "The reader is busy. Try this page again in a moment.",
      };
    case "invalid_scope":
      return { message: "Check the three IDs against your Mnemos store." };
    case "mnemos_unavailable":
      return { message: "Mnemos isn’t installed on this Mac anymore." };
    default:
      return { message: "This memory view couldn’t be opened." };
  }
}
function onVisibility(change: () => void) {
  document.addEventListener("visibilitychange", change);
  window.addEventListener("focus", change);
  window.addEventListener("blur", change);
  return () => {
    document.removeEventListener("visibilitychange", change);
    window.removeEventListener("focus", change);
    window.removeEventListener("blur", change);
  };
}
const visibleNow = () =>
  document.visibilityState === "visible" && document.hasFocus();
const hidden = () => false;

/** A mind's name as its agent id reads: "claude-code" is Claude Code. */
export function mindName(agentId: string) {
  return agentId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
/** "2,431 memories · newest Nov 17", from what the app found in a store. */
export function describeMind(mind: MindChoice) {
  const count = `${mind.memories.toLocaleString()} ${mind.memories === 1 ? "memory" : "memories"}`;
  if (!mind.newest) return count;
  const day = new Date(`${mind.newest}T12:00:00`);
  return Number.isNaN(day.getTime())
    ? count
    : `${count} · newest ${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** A running resident starts again so it wakes with (or without) the linked
 *  memory. It never interrupts work: busy, it is left for the owner to restart. */
async function restartIntoMemory(pubkey: string) {
  const agent = (await listManagedAgents()).find((a) => a.pubkey === pubkey);
  if (agent?.status !== "running") return "stopped" as const;
  if (!(await tryStopManagedAgentForAutoRestart(pubkey)))
    return "busy" as const;
  await startManagedAgent(pubkey);
  return "restarted" as const;
}

export function MindMnemos({
  resident,
  name,
  titleRef,
  onBack,
}: {
  resident: string | null;
  name: string;
  titleRef: React.Ref<HTMLHeadingElement>;
  onBack: () => void;
}) {
  const identity = useIdentityQuery();
  const owner = identity.data?.pubkey;
  return (
    <div data-testid="mind-mnemos">
      <MindPageHead
        title="Mnemos"
        lede={`What ${name} has kept in memory.`}
        back={name}
        onBack={onBack}
        titleRef={titleRef}
      />
      {resident && owner ? (
        <ResidentView
          key={`${owner}:${resident}`}
          resident={resident}
          name={name}
        />
      ) : resident && identity.isPending ? (
        <p className="luca-mind-quiet" role="status">
          Opening memory…
        </p>
      ) : (
        <p className="luca-mind-quiet">
          {resident
            ? "Your Polyphonic identity is needed to open this view."
            : "This view needs a local resident."}
        </p>
      )}
    </div>
  );
}
type Location = {
  section: MnemosSection | null;
  cursor: string | null;
  previous: (string | null)[];
};
const home: Location = { section: null, cursor: null, previous: [] };
function ResidentView({ resident, name }: { resident: string; name: string }) {
  const visible = React.useSyncExternalStore(onVisibility, visibleNow, hidden);
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<ViewStatus | null>(null);
  const [minds, setMinds] = React.useState<MindChoice[] | null>(null);
  // A running resident that was busy when its memory changed.
  const [waiting, setWaiting] = React.useState(false);
  const [location, go] = React.useState<Location>(home);
  const { section, cursor } = location;
  const [page, setPage] = React.useState<MnemosPage | null>(null);
  const [error, setError] = React.useState<Issue | null>(null);
  // Only an intentional navigation may place focus. A refresh after a window
  // focus event must never steal it from another control.
  const view = React.useRef<HTMLDivElement>(null);
  const connectionDetails = React.useRef<HTMLDetailsElement>(null);
  const pendingFocus = React.useRef<{
    target: string;
    from: Element | null;
  } | null>(null);
  const lastGrant = React.useRef<string | null>(null);
  function requestFocus(target: string) {
    pendingFocus.current = { target, from: document.activeElement };
  }
  function navigate(next: Location, target: string) {
    requestFocus(target);
    setPage(null);
    setError(null);
    go(next);
  }
  const focusPage = () => {
    const pending = pendingFocus.current;
    if (!pending || !visibleNow()) return;
    const el = view.current?.querySelector<HTMLElement>(
      `[data-mnemos-focus="${pending.target}"]`,
    );
    if (!el) return;
    pendingFocus.current = null;
    // A slow response must not take focus back after the user has moved on.
    if (
      document.activeElement === document.body ||
      document.activeElement === pending.from
    ) {
      (el.closest("button") ?? el).focus();
    }
  };
  const [refresh, renew] = React.useReducer((n: number) => n + 1, 0);
  const [busy, setBusy] = React.useState(false);
  const [form, showForm] = React.useState(false);
  const [scope, setScope] = React.useState<ViewScope>(emptyScope);
  const epoch = React.useRef(0),
    operation = React.useRef(false),
    present = React.useRef(true);
  React.useEffect(() => {
    present.current = true;
    return () => {
      present.current = false;
      epoch.current++;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh explicitly revalidates an unchanged binding; no polling.
  React.useLayoutEffect(() => {
    const id = ++epoch.current;
    setPage(null);
    if (!visible || operation.current) {
      setStatus(null);
      if (!visible) pendingFocus.current = null;
      return;
    }
    setError(null);
    const current = () =>
      present.current && id === epoch.current && visibleNow();
    let statusConfirmed = false;
    (async () => {
      const s = await mnemosView.status(resident);
      if (!current()) return;
      statusConfirmed = true;
      const changed = lastGrant.current !== s.grant;
      lastGrant.current = s.grant;
      setStatus(s);
      if (changed && section) {
        // Neither the cursor nor its enclosing section belongs to a new store.
        if (pendingFocus.current)
          pendingFocus.current.target = s.grant ? "overview" : "connect";
        go(home);
        return;
      }
      if (!s.grant) {
        if (!s.mnemosReady) return;
        const found = await mnemosView.minds(resident);
        if (current()) setMinds(found);
        return;
      }
      if (!s.readerReady) return;
      const result = await mnemosView.read(
        resident,
        s.grant,
        section ?? "summary",
        cursor,
      );
      if (current()) setPage(result);
    })().catch((e) => {
      if (current()) {
        if (!statusConfirmed) setStatus(null);
        if (pendingFocus.current) pendingFocus.current.target = "error";
        setError(explain(e));
      }
    });
    return () => {
      epoch.current++;
    };
  }, [resident, section, cursor, refresh, visible]);
  React.useLayoutEffect(focusPage);
  const connection = async (
    kind: "connect" | "disconnect" | { link: MindChoice },
  ) => {
    if (operation.current || !visible) return;
    operation.current = true;
    epoch.current++;
    setBusy(true);
    setPage(null);
    setError(null);
    const opening = kind !== "disconnect";
    requestFocus(opening ? "overview" : "connect");
    let feedback: Issue | null = null;
    let focusAfter = opening ? "overview" : "connect";
    // The resident's memory changes only with a link: a view never touches it.
    let memoryChanged = false;
    try {
      if (typeof kind === "object") {
        const accepted = await mnemosView.link(resident, kind.link.id);
        if (!present.current) return;
        if (accepted) {
          setMinds(null);
          memoryChanged = true;
        } else
          focusAfter =
            minds?.[0]?.id === kind.link.id
              ? "connect"
              : `mind-${kind.link.id}`;
      } else if (kind === "connect") {
        const accepted = await mnemosView.connect(resident, scope);
        if (!present.current) return;
        if (accepted) {
          showForm(false);
          setScope(emptyScope);
        } else {
          focusAfter = "choose";
        }
      } else if (status?.grant) {
        await mnemosView.disconnect(resident, status.grant);
        if (!present.current) return;
        memoryChanged = status.linked;
        go(home);
        setStatus(null);
      }
      if (memoryChanged) {
        // The link is saved either way; a restart that can't happen now is
        // left to the owner, never reported as a failed link.
        const outcome = await restartIntoMemory(resident).catch(
          () => "busy" as const,
        );
        if (present.current) setWaiting(outcome === "busy");
        void queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
      }
    } catch (e) {
      feedback = explain(e);
    } finally {
      operation.current = false;
      if (present.current) {
        setBusy(false);
        const target = feedback ? "error" : focusAfter;
        if (pendingFocus.current) pendingFocus.current.target = target;
        // Returning from the native picker can remount the form with no
        // focused element. Restore only this explicit action, never an idle refocus.
        else pendingFocus.current = { target, from: document.body };
        if (feedback) {
          setError({ ...feedback, connection: true });
        } else renew();
      }
    }
  };
  const restartNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopManagedAgent(resident);
      await startManagedAgent(resident);
      if (present.current) setWaiting(false);
    } catch (e) {
      if (present.current) setError(explain(e));
    } finally {
      if (present.current) setBusy(false);
      void queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
    }
  };
  if (!visible)
    return (
      <p className="luca-mind-quiet">
        Memory is only shown while this view is open.
      </p>
    );
  return (
    <div className="luca-mnemos-view" ref={view}>
      {error ? (
        <p
          className="luca-mind-error"
          role="alert"
          tabIndex={-1}
          data-mnemos-focus="error"
        >
          {error.message}{" "}
          <button
            className="luca-mind-inline"
            type="button"
            onClick={() => {
              if (error.review && connectionDetails.current) {
                connectionDetails.current.open = true;
                connectionDetails.current.querySelector("summary")?.focus();
                return;
              }
              requestFocus(
                error.restart || !section
                  ? status?.grant
                    ? "overview"
                    : form
                      ? "first-id"
                      : "connect"
                  : "reading",
              );
              if (error.restart) go(home);
              renew();
            }}
          >
            {error.review && status?.grant
              ? "Review connection"
              : error.restart
                ? "Open overview"
                : error.connection
                  ? "Check connection"
                  : "Try again"}
          </button>
        </p>
      ) : null}
      {!status && !error && !busy ? (
        <p className="luca-mind-quiet" role="status">
          Opening memory…
        </p>
      ) : null}
      {waiting ? (
        <p className="luca-mind-help" role="status">
          {name} is in the middle of something. It changes memory the next time
          it starts.{" "}
          <button
            type="button"
            className="luca-mind-inline"
            disabled={busy}
            onClick={() => void restartNow()}
          >
            Restart now
          </button>
        </p>
      ) : null}
      {status && !status.grant && !form ? (
        <MindGroup
          title={`Give ${name} a memory`}
          footnote={`${name} remembers with the memory you choose, the same one your other apps reach through Mnemos, like Claude Code. While it’s linked, Polyphonic’s own notes for ${name} stay off.`}
        >
          {!status.mnemosReady ? (
            <MindRow
              label="Mnemos isn’t on this Mac"
              help={`Install Mnemos to give ${name} a memory it keeps across your apps.`}
            />
          ) : minds === null ? (
            <MindRow label="Looking for your memories…" />
          ) : minds.length === 0 ? (
            <MindRow
              label="No memories yet"
              help="Mnemos is installed, but it doesn’t keep a memory on this Mac yet."
            />
          ) : (
            minds.map((mind, index) => (
              <MindRow
                key={mind.id}
                label={mind.name}
                help={describeMind(mind)}
                control={
                  <button
                    type="button"
                    className="luca-mind-inline"
                    disabled={busy}
                    aria-label={`Use ${mind.name} as ${name}’s memory`}
                    data-mnemos-focus={
                      index === 0 ? "connect" : `mind-${mind.id}`
                    }
                    onClick={() => void connection({ link: mind })}
                  >
                    Use
                  </button>
                }
              />
            ))
          )}
        </MindGroup>
      ) : null}
      {status && !status.grant && status.readerReady && !form ? (
        <button
          type="button"
          className="luca-mind-quietlink luca-mnemos-viewonly"
          // The first mind takes "connect" once the list arrives; while it is
          // still loading, this button must not take that focus from it.
          data-mnemos-focus={
            status.mnemosReady && minds?.length !== 0 ? "view-only" : "connect"
          }
          disabled={busy}
          onClick={() => {
            requestFocus("first-id");
            showForm(true);
          }}
        >
          Only view a memory
        </button>
      ) : null}
      {status && !status.grant && form ? (
        <MindGroup
          title="View a memory"
          footnote="Viewing memory does not wake the resident, mark notes read or share anything with a model."
        >
          <MnemosConnectForm
            scope={scope}
            busy={busy}
            onChange={setScope}
            onChoose={() => void connection("connect")}
            onCancel={() => {
              requestFocus("connect");
              showForm(false);
              setScope(emptyScope);
            }}
          />
        </MindGroup>
      ) : null}
      {status?.grant && status.linked ? (
        <MindGroup title="Memory">
          <MindRow
            label={mindName(status.scope?.agent_id ?? "")}
            help={`${name} remembers with this memory, here and in your other apps.`}
            value="Linked"
          />
        </MindGroup>
      ) : null}
      {status?.grant ? (
        <>
          {!status.readerReady ? (
            <p className="luca-mind-quiet">
              {status.linked
                ? "Reading it here needs Python 3.12 or 3.13 on this Mac."
                : "Your connection is saved. The compatible reader isn’t available on this Mac."}
            </p>
          ) : section ? (
            <MnemosReading
              section={section}
              page={page?.kind === "items" ? page : null}
              number={location.previous.length + 1}
              failed={Boolean(error)}
              onBack={() => navigate(home, section)}
              onPrevious={() =>
                navigate(
                  {
                    section,
                    cursor: location.previous.at(-1) ?? null,
                    previous: location.previous.slice(0, -1),
                  },
                  "reading",
                )
              }
              onNext={(next) =>
                navigate(
                  {
                    section,
                    cursor: next,
                    previous: [...location.previous, cursor],
                  },
                  "reading",
                )
              }
            />
          ) : page?.kind === "summary" ? (
            <MindGroup
              title={
                <span tabIndex={-1} data-mnemos-focus="overview">
                  Memory sections
                </span>
              }
            >
              {mnemosSections.map((s) => (
                <MindRow
                  key={s}
                  label={<span data-mnemos-focus={s}>{labels[s]}</span>}
                  value={count(page.counts, s)}
                  onOpen={() =>
                    navigate(
                      { section: s, cursor: null, previous: [] },
                      "reading",
                    )
                  }
                />
              ))}
            </MindGroup>
          ) : !error ? (
            <p className="luca-mind-quiet" role="status">
              Reading…
            </p>
          ) : null}
          <div className="luca-mnemos-tools">
            <details className="luca-mnemos-connection" ref={connectionDetails}>
              <summary>
                {status.linked ? "Linked memory" : "Read-only connection"}
              </summary>
              <dl>
                <dt>Agent</dt>
                <dd>{status.scope?.agent_id}</dd>
                <dt>Person</dt>
                <dd>{status.scope?.person_id}</dd>
                <dt>Project</dt>
                <dd>{status.scope?.project_scope}</dd>
              </dl>
              <button
                type="button"
                className="luca-mind-inline"
                disabled={busy}
                onClick={() => void connection("disconnect")}
              >
                {status.linked ? "Unlink" : "Disconnect"}
              </button>
            </details>
            {status.readerReady && !error ? (
              <button
                type="button"
                className="luca-mind-quietlink luca-mnemos-refresh"
                disabled={!page || busy}
                onClick={() => {
                  requestFocus(section ? "reading" : "overview");
                  renew();
                }}
              >
                Refresh
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
