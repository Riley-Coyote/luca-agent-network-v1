import * as React from "react";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  mnemosSections,
  mnemosView,
  type MnemosPage,
  type MnemosSection,
  type ViewCounts,
  type ViewScope,
  type ViewStatus,
} from "@/shared/api/mnemosView";
import { MindGroup, MindPageHead, MindRow } from "./MindPageKit";
import "./mind-mnemos.css";

const labels: Record<MnemosSection, string> = {
  memories: "Memories",
  standing: "Standing memories",
  journal: "Journal",
  notes: "Notes",
  handoffs: "Handoffs",
  beliefs: "Beliefs",
};
const emptyScope: ViewScope = {
  agent_id: "",
  person_id: "",
  project_scope: "",
};
const canConnect = (s: ViewScope) =>
  Object.values(s).every(
    (v) => v.length <= 128 && /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/.test(v),
  );
function count(c: ViewCounts, s: MnemosSection) {
  return s === "memories"
    ? c.memories.active + c.memories.dormant
    : s === "notes"
      ? c.notes.all
      : c[s];
}
function explain(error: unknown) {
  switch (String(error)) {
    case "store_changed":
      return "The store moved or was replaced. Disconnect this view and choose the store again.";
    case "store_unavailable":
      return "This store could not be read. Check that it is available on this Mac.";
    case "binding_changed":
    case "stale_page":
      return "This connection changed. Refresh to open its current view.";
    case "reader_unavailable":
      return "The compatible local reader isn’t available.";
    case "reader_timeout":
    case "reader_busy":
      return "The reader is busy. Try again in a moment.";
    default:
      return "This memory view couldn’t be opened.";
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
  const owner = useIdentityQuery().data?.pubkey;
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
        <ResidentView key={`${owner}:${resident}`} resident={resident} />
      ) : (
        <p className="luca-mind-quiet">This view needs a local resident.</p>
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
function ResidentView({ resident }: { resident: string }) {
  const visible = React.useSyncExternalStore(onVisibility, visibleNow, hidden);
  const [status, setStatus] = React.useState<ViewStatus | null>(null);
  const [location, go] = React.useState<Location>(home);
  const { section, cursor } = location;
  const [page, setPage] = React.useState<MnemosPage | null>(null);
  const [error, setError] = React.useState("");
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
    setStatus(null);
    if (!visible || operation.current) return;
    setError("");
    const current = () =>
      present.current && id === epoch.current && visibleNow();
    (async () => {
      const s = await mnemosView.status(resident);
      if (!current()) return;
      setStatus(s);
      if (!s.grant || !s.readerReady) return;
      const result = await mnemosView.read(
        resident,
        s.grant,
        section ?? "summary",
        cursor,
      );
      if (current()) setPage(result);
    })().catch((e) => {
      if (current()) setError(explain(e));
    });
    return () => {
      epoch.current++;
    };
  }, [resident, section, cursor, refresh, visible]);
  const connection = async (kind: "connect" | "disconnect") => {
    if (operation.current || !visible) return;
    operation.current = true;
    epoch.current++;
    setBusy(true);
    setPage(null);
    setError("");
    let feedback = "";
    try {
      if (kind === "connect") {
        if (await mnemosView.connect(resident, scope)) {
          showForm(false);
          setScope(emptyScope);
        }
      } else if (status?.grant) {
        await mnemosView.disconnect(resident, status.grant);
        go(home);
        setStatus(null);
      }
    } catch (e) {
      feedback = explain(e);
    } finally {
      operation.current = false;
      if (present.current) {
        setBusy(false);
        if (feedback) setError(feedback);
        else renew();
      }
    }
  };
  if (!visible)
    return (
      <p className="luca-mind-quiet">
        Memory is only shown while this view is open.
      </p>
    );
  return (
    <div className="luca-mnemos-view">
      {error ? (
        <p className="luca-mind-error" role="alert">
          {error}{" "}
          <button
            className="luca-mind-inline"
            type="button"
            onClick={() => {
              go(home);
              renew();
            }}
          >
            Refresh
          </button>
        </p>
      ) : null}
      {!status && !error ? (
        <p className="luca-mind-quiet" role="status">
          Opening memory…
        </p>
      ) : null}
      {status && !status.grant ? (
        <MindGroup
          title="Memory connection"
          footnote="Viewing memory does not wake the resident, mark notes read or share anything with a model."
        >
          {!form ? (
            <MindRow
              label="No store connected"
              help={
                status.readerReady
                  ? "Choose one existing store to read on this Mac."
                  : "A compatible local Mnemos reader is needed before a store can be connected."
              }
              control={
                status.readerReady ? (
                  <button
                    type="button"
                    className="luca-mind-inline"
                    onClick={() => showForm(true)}
                  >
                    Connect a store
                  </button>
                ) : undefined
              }
            />
          ) : (
            <form
              className="luca-mnemos-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (canConnect(scope)) void connection("connect");
              }}
            >
              <p className="luca-mind-help">
                Enter the three IDs used in this Mnemos store. You’ll choose the
                file and review the connection next.
              </p>
              {(["agent_id", "person_id", "project_scope"] as const).map(
                (key, i) => (
                  <label key={key}>
                    {["Agent ID", "Person ID", "Project scope"][i]}
                    <input
                      className="luca-mind-input"
                      autoComplete="off"
                      spellCheck={false}
                      required
                      maxLength={128}
                      value={scope[key]}
                      onChange={(e) =>
                        setScope({ ...scope, [key]: e.target.value })
                      }
                    />
                  </label>
                ),
              )}
              <div className="luca-mind-actions">
                <button
                  type="submit"
                  disabled={!canConnect(scope) || busy}
                  className="luca-mind-inline"
                >
                  Choose store…
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="luca-mind-quietlink"
                  onClick={() => {
                    showForm(false);
                    setScope(emptyScope);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </MindGroup>
      ) : null}
      {status?.grant ? (
        <>
          {!status.readerReady ? (
            <p className="luca-mind-quiet">
              Your connection is saved. The compatible reader isn’t available on
              this Mac.
            </p>
          ) : section ? (
            <>
              <button
                type="button"
                className="luca-mind-inline"
                onClick={() => go(home)}
              >
                All sections
              </button>
              <h2 className="luca-mind-part-title">{labels[section]}</h2>
              {page?.kind === "items" ? (
                <>
                  {page.items.length ? (
                    <ol className="luca-mind-rows luca-mnemos-items">
                      {page.items.map((item, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed, read-only window; rows have no controls or local state.
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
                      Nothing in this section yet.
                    </p>
                  )}
                  <div className="luca-mind-actions">
                    {location.previous.length > 0 ? (
                      <button
                        type="button"
                        className="luca-mind-inline"
                        onClick={() =>
                          go({
                            ...location,
                            cursor: location.previous.at(-1) ?? null,
                            previous: location.previous.slice(0, -1),
                          })
                        }
                      >
                        Previous page
                      </button>
                    ) : null}
                    {page.nextCursor ? (
                      <button
                        type="button"
                        className="luca-mind-inline"
                        onClick={() =>
                          go({
                            ...location,
                            cursor: page.nextCursor,
                            previous: [...location.previous, cursor],
                          })
                        }
                      >
                        Next page
                      </button>
                    ) : null}
                  </div>
                </>
              ) : !error ? (
                <p className="luca-mind-quiet" role="status">
                  Reading…
                </p>
              ) : null}
            </>
          ) : page?.kind === "summary" ? (
            <MindGroup title="Memory sections">
              {mnemosSections.map((s) => (
                <MindRow
                  key={s}
                  label={labels[s]}
                  value={count(page.counts, s)}
                  onOpen={() => go({ section: s, cursor: null, previous: [] })}
                />
              ))}
            </MindGroup>
          ) : !error ? (
            <p className="luca-mind-quiet" role="status">
              Reading…
            </p>
          ) : null}
          <details className="luca-mnemos-connection">
            <summary>Read-only connection</summary>
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
              Disconnect
            </button>
          </details>
        </>
      ) : null}
    </div>
  );
}
