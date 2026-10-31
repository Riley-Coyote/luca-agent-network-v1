import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  RotateCcw,
  X,
} from "lucide-react";
import { AgentDendrite } from "@/shared/ui/dendrite/AgentDendrite";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createBuzzQueryClient } from "@/shared/api/queryClient";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import "@/features/thinking/ui/thinking-effort.css";
import { DesignTools } from "./DesignTools";
import { MATERIALS, readDesign, TEMPORARY_SURFACES_KEY } from "./design";
import "./temporarySurfacesStudy.css";

type Scene = "approval" | "command" | "notice" | "confirmation" | "error";
type Modal = "access" | "remember" | "agents" | null;
/** What a surface leaves behind: words for screen readers, and a line in the
 *  conversation when it was a decision about the conversation. */
type Outcome = { say: string; record?: string };
const SCENES: { id: Scene; title: string }[] = [
  { id: "approval", title: "Approval" },
  { id: "command", title: "Command" },
  { id: "notice", title: "Notice" },
  { id: "confirmation", title: "Confirmation" },
  { id: "error", title: "Recovery" },
];
const LUCA = "4fb94373fb5cfb7fe322d95a48d8cc4c4bb04a990cf43d4f38b895a52635d5bb";
const COMMAND =
  'ls -la ~/.claude/projects/*/a9cd5554*.jsonl ~/.claude/projects/*/28590871*.jsonl 2>/dev/null; find ~/.codex/sessions -name "*01a1892e*" -o -name "*01a18448*"';
const ASKS = {
  approval: {
    question: "Look at your recent Claude Code sessions?",
    summary:
      "Read session titles and timestamps to get a sense of your recent work.",
    scope: ["Read only", "Session titles and times", "Polyphonic project"],
    details: "What’s shared",
    allowed: "You let Luca read your recent session titles, once.",
    denied: "You said no. Luca won’t look at your sessions.",
  },
  command: {
    question: "Find your recent session files?",
    summary:
      "Run this command to find Claude Code and Codex session files on this Mac.",
    scope: ["Shell command", "Outside your project", "This once"],
    details: "Request details",
    allowed: "You let Luca run the command, once.",
    denied: "You said no. The command didn’t run.",
  },
} as const;

/** How far a card sits behind the composer, and how much of a hidden ask
 *  still shows above it: its question, so you know what's waiting. */
const TUCK = 18;
const LIP = 44;
/** Out of the composer's shadow on a spring that settles; back in by falling
 *  away, quicker each moment, with no tail to wait out. */
const RISE = { type: "spring", visualDuration: 0.44, bounce: 0.14 } as const;
const SINK = { duration: 0.22, ease: [0.4, 0, 0.9, 0.6] } as const;
const STILL = { duration: 0 } as const;

/** Isolated fixtures. Production composer queries use the lab's mocked bridge;
 * no real permissions, messages, or provider calls leave this preview. */
export function TemporarySurfacesStudy() {
  const [queryClient] = React.useState(createBuzzQueryClient);
  const [router] = React.useState(() =>
    createRouter({
      routeTree: createRootRoute({ component: TemporarySurfacesPreview }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function TemporarySurfacesPreview() {
  const [initial] = React.useState(readDesign);
  const [design, setDesign] = React.useState(initial.design);
  const [saved, setSaved] = React.useState(initial.saved);
  const [storageError, setStorageError] = React.useState(initial.error);
  const [scene, setScene] = React.useState<Scene>("approval");
  const [replay, setReplay] = React.useState(0);
  const [folded, setFolded] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [details, setDetails] = React.useState(false);
  const [modal, setModal] = React.useState<Modal>(null);
  const [posted, setPosted] = React.useState("");
  const [composerNotice, setComposerNotice] = React.useState("");
  const [retrying, setRetrying] = React.useState(false);
  const [keyboard, setKeyboard] = React.useState(false);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const cancel = React.useRef<HTMLButtonElement>(null);
  const sceneButton = React.useRef<HTMLButtonElement>(null);
  const foldButton = React.useRef<HTMLButtonElement>(null);
  const transcript = React.useRef<HTMLDivElement>(null);
  const reading = React.useRef<HTMLDivElement>(null);
  const foldedBefore = React.useRef(false);
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();

  React.useEffect(() => {
    if (initial.error) return;
    try {
      localStorage.setItem(
        TEMPORARY_SURFACES_KEY,
        JSON.stringify({ schema: 2, design, saved }),
      );
      setStorageError("");
    } catch {
      setStorageError(
        "Browser storage is unavailable. Changes are in memory only; export to keep them.",
      );
    }
  }, [design, saved, initial.error]);
  React.useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );
  React.useEffect(() => {
    if (modal) {
      dialog.current?.showModal();
      cancel.current?.focus();
    } else dialog.current?.close();
  }, [modal]);
  React.useEffect(() => {
    if (foldedBefore.current === folded) return;
    foldedBefore.current = folded;
    if (keyboard) foldButton.current?.focus();
  }, [folded, keyboard]);
  // The newest line stays in view while a card rises and the conversation
  // makes room, unless you've scrolled up to read.
  React.useLayoutEffect(() => {
    const el = transcript.current;
    const inner = reading.current;
    if (!el || !inner) return;
    let pinned = true;
    const onScroll = () => {
      pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    };
    const observer = new ResizeObserver(() => {
      if (pinned) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    observer.observe(inner);
    el.scrollTop = el.scrollHeight;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  function reset(next: Scene = scene) {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    setScene(next);
    setReplay((value) => value + 1);
    setFolded(false);
    setDetails(false);
    setOutcome(null);
    setRetrying(false);
  }
  function resolve(say: string, record?: string) {
    setOutcome({ say, record });
    setModal(null);
    // Removed decision buttons must not strand keyboard focus.
    if (keyboard) sceneButton.current?.focus();
  }
  const command = scene === "command";
  const approval = scene === "approval" || command;
  const ask = ASKS[command ? "command" : "approval"];
  const cardVisible = !outcome && scene !== "confirmation";
  const animate = design.motion && !keyboard && !reducedMotion;
  const style = {
    "--ts-inset": `${design.inset}px`,
    "--ts-shade": design.shade,
    "--ts-tuck": `${TUCK}px`,
  } as React.CSSProperties;

  return (
    <div
      className="ts-study"
      style={style}
      data-compact={design.compact}
      data-opaque={design.opaque}
      data-motion={animate}
      data-material={design.material}
      data-signal={design.signal}
      data-depth={design.depth}
      onKeyDownCapture={() => setKeyboard(true)}
      onPointerDownCapture={() => setKeyboard(false)}
    >
      <div className="ts-study-bar">
        <span>
          Temporary surfaces{" "}
          <span className="ts-prototype">Cards only · production composer</span>
        </span>
        <DesignTools
          design={design}
          setDesign={setDesign}
          saved={saved}
          setSaved={setSaved}
          error={storageError}
        />
      </div>
      <div className="ts-controls">
        <fieldset className="ts-scenes" aria-label="Preview scenarios">
          {SCENES.map((item) => (
            <button
              type="button"
              key={item.id}
              ref={item.id === scene ? sceneButton : undefined}
              aria-pressed={scene === item.id}
              onClick={() => reset(item.id)}
            >
              {item.title}
            </button>
          ))}
          <button
            className="ts-replay"
            type="button"
            aria-label="Replay current example"
            title="Replay current example"
            onClick={() => reset()}
          >
            <RotateCcw size={14} />
          </button>
        </fieldset>
        <fieldset className="ts-scenes" aria-label="Material">
          {MATERIALS.map((m) => (
            <button
              type="button"
              key={m.id}
              aria-pressed={design.material === m.id}
              onClick={() => setDesign({ ...design, material: m.id })}
            >
              {m.name}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={design.signal}
            onClick={() => setDesign({ ...design, signal: !design.signal })}
          >
            Blue light
          </button>
          <button
            type="button"
            aria-pressed={design.depth}
            onClick={() => setDesign({ ...design, depth: !design.depth })}
          >
            Depth
          </button>
        </fieldset>
      </div>
      <div className="ts-transcript" ref={transcript}>
        <div className="ts-reading" ref={reading}>
          <div className="ts-day">Today</div>
          <article className="ts-message">
            <div className="ts-author">
              <AgentDendrite residentKey={LUCA} size={18} />
              <span>Luca</span>
            </div>
            <p>
              We can start with what you’ve been working on, and take it from
              there.
            </p>
          </article>
          <div className="ts-user-message">
            Look at my recent sessions first, then we’ll talk.
          </div>
          <article className="ts-message">
            <div className="ts-author">
              <AgentDendrite residentKey={LUCA} size={18} />
              <span>Luca</span>
            </div>
            <p>
              {scene === "notice"
                ? "I also found agents already on this Mac. You can review them whenever you’re ready—nothing will be imported automatically."
                : scene === "confirmation"
                  ? "You can choose how much freedom I have. Broader access always needs a clear decision from you."
                  : "I’ll start with a list of recent sessions. Here’s exactly what I’m asking to access."}
            </p>
          </article>
          <AnimatePresence initial={false}>
            {outcome?.record && (
              <motion.p
                key={outcome.record}
                className="ts-record"
                initial={animate ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  animate
                    ? { duration: 0.32, delay: 0.16, ease: "easeOut" }
                    : STILL
                }
              >
                {outcome.record}
              </motion.p>
            )}
          </AnimatePresence>
          {posted && (
            <div className="ts-user-message">
              {posted}
              <small>Preview message · not sent</small>
            </div>
          )}
        </div>
      </div>
      <div className="ts-bottom">
        {scene === "confirmation" && !outcome && (
          <div className="ts-confirm-invite">
            <span>Access · Work in my project</span>
            <button
              type="button"
              className="ts-text-button"
              onClick={() => setModal("access")}
            >
              Change access <ChevronRight size={13} strokeWidth={1.75} />
            </button>
          </div>
        )}
        <div className="ts-dock">
          <AnimatePresence initial={false} mode="wait">
            {cardVisible && (
              <motion.div
                key={replay}
                className="ts-card-slot"
                initial={animate ? { height: 0, marginBottom: 0 } : false}
                animate={{
                  height: approval && folded ? LIP + TUCK : "auto",
                  marginBottom: -TUCK,
                }}
                exit={
                  animate
                    ? {
                        height: 0,
                        marginBottom: 0,
                        transition: SINK,
                      }
                    : { height: 0, marginBottom: 0, transition: STILL }
                }
                transition={animate ? RISE : STILL}
              >
                <section
                  className="ts-sheet"
                  data-kind={approval ? "ask" : "note"}
                  data-folded={(approval && folded) || undefined}
                  aria-labelledby="ts-sheet-title"
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && approval && !folded) {
                      event.stopPropagation();
                      setFolded(true);
                    }
                  }}
                  onClick={(event) => {
                    // A hidden ask's whole lip is the way back to it.
                    const onButton = (event.target as Element).closest(
                      "button",
                    );
                    if (approval && folded && !onButton) setFolded(false);
                  }}
                >
                  {approval ? (
                    <>
                      <div className="ts-ask-head">
                        <h2 id="ts-sheet-title">{ask.question}</h2>
                        {folded && <span className="ts-waiting">Waiting</span>}
                        <button
                          type="button"
                          className="ts-icon"
                          ref={foldButton}
                          aria-expanded={!folded}
                          aria-label={
                            folded ? "Show Luca’s request" : "Hide for now"
                          }
                          title={
                            folded
                              ? "Show Luca’s request"
                              : "Hide for now · it keeps waiting"
                          }
                          onClick={() => setFolded(!folded)}
                        >
                          {folded ? (
                            <ChevronUp size={16} strokeWidth={1.75} />
                          ) : (
                            <ChevronDown size={16} strokeWidth={1.75} />
                          )}
                        </button>
                      </div>
                      <div className="ts-ask-body" inert={folded}>
                        <p className="ts-ask-summary">{ask.summary}</p>
                        <p className="ts-ask-scope">
                          {ask.scope.map((part) => (
                            <span key={part}>{part}</span>
                          ))}
                        </p>
                        {command && (
                          <pre className="ts-well ts-code">
                            <code>{COMMAND}</code>
                          </pre>
                        )}
                        <AnimatePresence initial={false}>
                          {details && (
                            <motion.div
                              id="ts-request-details"
                              className="ts-details"
                              initial={
                                animate ? { height: 0, opacity: 0 } : false
                              }
                              animate={{ height: "auto", opacity: 1 }}
                              exit={
                                animate
                                  ? { height: 0, opacity: 0 }
                                  : { height: 0, transition: STILL }
                              }
                              transition={
                                animate
                                  ? {
                                      type: "spring",
                                      visualDuration: 0.3,
                                      bounce: 0,
                                    }
                                  : STILL
                              }
                            >
                              <div className="ts-well">
                                {command ? (
                                  <>
                                    <p>
                                      The command runs on this Mac. Its result
                                      can be included in Luca’s conversation
                                      with the current model provider.
                                    </p>
                                    <p>
                                      Nothing carries over. This request can
                                      only be allowed once.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p>
                                      Session titles and times can be included
                                      in Luca’s conversation with the current
                                      model provider. Nothing keeps watching
                                      afterwards.
                                    </p>
                                    <dl>
                                      <div>
                                        <dt>Request</dt>
                                        <dd>
                                          List Claude Code session titles and
                                          times on this Mac
                                        </dd>
                                      </div>
                                      <div>
                                        <dt>If remembered</dt>
                                        <dd>
                                          This action, for Luca, in the
                                          Polyphonic project only
                                        </dd>
                                      </div>
                                    </dl>
                                  </>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <footer className="ts-ask-actions">
                          <button
                            type="button"
                            className="ts-text-button"
                            aria-expanded={details}
                            aria-controls="ts-request-details"
                            onClick={() => setDetails(!details)}
                          >
                            {ask.details}
                            <ChevronRight size={13} strokeWidth={1.75} />
                          </button>
                          <div className="ts-ask-choices">
                            <button
                              type="button"
                              className="ts-button"
                              onClick={() =>
                                resolve("Request declined", ask.denied)
                              }
                            >
                              Deny
                            </button>
                            {!command && (
                              <button
                                type="button"
                                className="ts-button"
                                onClick={() => setModal("remember")}
                              >
                                Always here
                              </button>
                            )}
                            <button
                              type="button"
                              className="ts-button ts-button--primary"
                              onClick={() =>
                                resolve("Allowed once", ask.allowed)
                              }
                            >
                              Allow once
                            </button>
                          </div>
                        </footer>
                      </div>
                    </>
                  ) : scene === "notice" ? (
                    <div className="ts-note">
                      <div className="ts-note-text">
                        <h2 id="ts-sheet-title">Agents already on this Mac</h2>
                        <p>Review them first. Nothing imports on its own.</p>
                      </div>
                      <div className="ts-note-actions">
                        <button
                          type="button"
                          className="ts-button"
                          onClick={() => setModal("agents")}
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          className="ts-icon"
                          aria-label="Dismiss"
                          onClick={() => resolve("Notice dismissed")}
                        >
                          <X size={15} strokeWidth={1.75} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ts-note">
                      <div className="ts-note-text">
                        <h2 id="ts-sheet-title">Claude Code is unavailable</h2>
                        <p>Your conversation is safe.</p>
                      </div>
                      <div className="ts-note-actions">
                        <button
                          type="button"
                          className="ts-button"
                          data-busy={retrying || undefined}
                          disabled={retrying}
                          onClick={() => {
                            setRetrying(true);
                            retryTimer.current = setTimeout(() => {
                              setRetrying(false);
                              resolve(
                                "Claude Code reconnected",
                                "Claude Code is connected again.",
                              );
                            }, 900);
                          }}
                        >
                          {retrying ? "Reconnecting" : "Try again"}
                        </button>
                        <button
                          type="button"
                          className="ts-icon"
                          aria-label="Dismiss"
                          onClick={() => resolve("Notice dismissed")}
                        >
                          <X size={15} strokeWidth={1.75} />
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </motion.div>
            )}
          </AnimatePresence>
          <div
            className="ts-production-composer"
            onClickCapture={(event) => {
              // Preserve the real composer without asking for microphone access
              // in a visual study. All other IPC uses the lab's mock bridge.
              const button = (event.target as Element).closest("button");
              if (button?.getAttribute("aria-label") === "Record audio") {
                event.preventDefault();
                event.stopPropagation();
                setComposerNotice(
                  "Microphone is inactive in this design preview.",
                );
              }
            }}
            onPasteCapture={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                event.stopPropagation();
                setComposerNotice(
                  "Attachments are inactive in this design preview.",
                );
              }
            }}
          >
            <MessageComposer
              channelId={null}
              channelName="Luca"
              draftKey="temporary-surfaces-preview"
              placeholder="Message Luca…"
              showTopBorder={false}
              onSend={async (content) => {
                setPosted(content);
              }}
              toolbarPostAudioActions={
                <button
                  type="button"
                  className="thinking-effort-picker__trigger text-xs"
                  onClick={() => setModal("access")}
                >
                  Access · Work in my project <ChevronDown size={12} />
                </button>
              }
              toolbarTrailingActions={
                <span className="thinking-effort-picker__trigger text-xs">
                  Thinking · Medium <ChevronDown size={12} />
                </span>
              }
            />
          </div>
          <span className="ts-preview-caption">
            {composerNotice ||
              "Preview only · no messages sent or permissions changed"}
          </span>
          <span className="ts-sr" role="status">
            {outcome?.say ?? ""}
          </span>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="ts-dialog"
        aria-labelledby="ts-dialog-title"
        aria-describedby="ts-dialog-description"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            );
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onCancel={() => setModal(null)}
        onClose={() => setModal(null)}
      >
        <h2 id="ts-dialog-title">
          {modal === "access"
            ? "Let Luca act without asking?"
            : modal === "remember"
              ? "Allow this here from now on?"
              : "Agents found on this Mac"}
        </h2>
        <p id="ts-dialog-description">
          {modal === "access"
            ? "Luca won’t ask before acting in this project, including messaging people, deleting files and running shell commands."
            : modal === "remember"
              ? "Luca will read Claude Code session titles in the Polyphonic project without asking. Nothing else changes."
              : "Claude Code and Codex. The real review lets you choose which to bring in. Nothing has been imported."}
        </p>
        {modal !== "agents" && (
          <p className="ts-dialog-fact">
            {modal === "access"
              ? "Every action is still recorded in Activity, and you can turn this off at any time."
              : "Every other request still asks first."}
          </p>
        )}
        <footer>
          <button
            ref={cancel}
            type="button"
            className="ts-button"
            onClick={() => setModal(null)}
          >
            {modal === "agents" ? "Close" : "Cancel"}
          </button>
          {modal !== "agents" && (
            <button
              type="button"
              className="ts-button ts-button--primary"
              onClick={() =>
                modal === "access"
                  ? resolve(
                      "Access changed",
                      "Luca can now act without asking in this project.",
                    )
                  : resolve(
                      "Remembered for this project",
                      "Luca can read session titles here without asking.",
                    )
              }
            >
              {modal === "access"
                ? "Turn on “Don’t ask me”"
                : "Always allow here"}
            </button>
          )}
        </footer>
        <small className="ts-dialog-caption">
          Design preview · no permissions are changed
        </small>
      </dialog>
    </div>
  );
}
