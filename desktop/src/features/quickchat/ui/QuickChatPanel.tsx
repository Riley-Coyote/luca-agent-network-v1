import * as React from "react";
import {
  ArrowUp,
  Camera,
  ChevronDown,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Plus,
  Square,
  X,
} from "lucide-react";
import { Markdown } from "@/shared/ui/markdown";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import { ManagedPermissionCard } from "@/features/agents/ui/ManagedPermissionCard";
import type { QuickChatViewModel } from "../types";
import { mountPhosphorEffort } from "./phosphor-effort.js";
import "./quickchat.css";

function Effort({ model }: { model: QuickChatViewModel }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const host = React.useRef<HTMLDivElement>(null);
  const { isDark } = useTheme();
  const values = model.effort.values;
  const position = model.effortPosition;
  const setPosition = model.setEffortPosition;
  const fieldRef = React.useRef<ReturnType<typeof mountPhosphorEffort> | null>(
    null,
  );
  React.useEffect(() => {
    if (
      !model.effort.supported ||
      values.length < 2 ||
      !canvas.current ||
      !input.current ||
      !host.current
    )
      return;
    const field = mountPhosphorEffort({
      canvas: canvas.current,
      input: input.current,
      themeRoot: host.current,
    });
    fieldRef.current = field;
    return () => {
      field.destroy();
      fieldRef.current = null;
    };
  }, [model.effort.supported, values.length]);
  React.useLayoutEffect(() => {
    if (input.current) {
      input.current.value = String(position);
      fieldRef.current?.update();
    }
  }, [position]);
  if (!model.effort.supported || values.length < 2) {
    // The runtime has said it owns thinking for this conversation: there is no
    // ladder to draw, only the sentence.
    if (!model.effort.awaitingFirstReply)
      return (
        <p className="text-xs text-muted-foreground">
          {model.effort.reason ??
            "Thinking effort is managed by this resident’s runtime."}
        </p>
      );
    // Nothing reported yet. Show the control where it will be, inert, so the
    // panel does not change shape after the first reply.
    return (
      <div>
        <div className="qc-effort-meta text-xs">
          <span>Thinking effort</span>
          <span>—</span>
        </div>
        <div className="qc-effort-track" data-inert="true">
          <input
            data-testid="quickchat-effort-unavailable"
            aria-label="Thinking effort"
            type="range"
            min={0}
            max={3}
            step={0.001}
            value={0}
            readOnly
            disabled
          />
        </div>
        <p className="qc-effort-status text-2xs text-muted-foreground">
          {model.effort.reason ?? "Available after the first reply"}
        </p>
      </div>
    );
  }
  const selected = values[Math.round((position / 3) * (values.length - 1))];
  const commit = () => {
    if (selected && selected.value !== model.effort.value)
      model.setEffort(selected.value);
  };
  return (
    <div
      ref={host}
      data-theme={isDark ? "inverse" : "paper"}
      style={{ "--ink": isDark ? "#f5f3ef" : "#282624" } as React.CSSProperties}
    >
      <div className="qc-effort-meta text-xs">
        <span>Thinking effort</span>
        <span>{selected?.label}</span>
      </div>
      <div className="qc-effort-track">
        <canvas ref={canvas} aria-hidden="true" tabIndex={-1} />
        <input
          ref={input}
          data-testid="quickchat-effort"
          aria-label="Thinking effort"
          aria-valuetext={selected?.label}
          type="range"
          min={0}
          max={3}
          step={0.001}
          value={position}
          disabled={model.effort.pending}
          onChange={(event) => setPosition(Number(event.target.value))}
          onPointerUp={commit}
          onPointerCancel={commit}
          onBlur={commit}
          onKeyUp={commit}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setPosition(
                Math.max(
                  0,
                  Math.min(
                    3,
                    position +
                      (event.key === "ArrowRight" ? 1 : -1) *
                        (event.shiftKey ? 0.03 : 3 / (values.length - 1)),
                  ),
                ),
              );
            }
          }}
        />
      </div>
      <p
        className="qc-effort-status text-2xs text-muted-foreground"
        role="status"
      >
        {model.effort.pending
          ? "Updating effort…"
          : selected?.value === model.effort.value
            ? (model.effort.reason ?? "Selected for your next message")
            : "Release to select effort"}
      </p>
    </div>
  );
}

export function QuickChatPanel({ model }: { model: QuickChatViewModel }) {
  const pendingPermissions = useManagedPermissions();
  const permissions = pendingPermissions.filter(
    (pending) =>
      pending.request.conversationId === model.channelId &&
      pending.request.residentPubkey.toLowerCase() ===
        model.selectedPubkey?.toLowerCase(),
  );
  const [picker, setPicker] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(
    null,
  );
  const transcript = React.useRef<HTMLDivElement>(null);
  const composer = React.useRef<HTMLTextAreaElement>(null);
  const file = React.useRef<HTMLInputElement>(null);
  const nearBottom = React.useRef(true);
  const activeReader = React.useRef<FileReader | null>(null);
  React.useEffect(() => {
    if (!model.open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (contextOpen) setContextOpen(false);
      else if (picker) setPicker(false);
      else if (menu) setMenu(false);
      else model.setOpen(false);
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [model.open, model.setOpen, contextOpen, picker, menu]);
  React.useEffect(
    () => () => {
      activeReader.current?.abort();
      activeReader.current = null;
    },
    [],
  );

  const resident = model.residents.find(
    (item) => item.pubkey === model.selectedPubkey,
  );
  React.useLayoutEffect(() => {
    if (model.open && model.selectedPubkey && transcript.current) {
      transcript.current.scrollTop = model.scrollTop;
      nearBottom.current =
        transcript.current.scrollHeight -
          transcript.current.scrollTop -
          transcript.current.clientHeight <
        60;
    }
  }, [model.open, model.selectedPubkey, model.scrollTop]);
  React.useEffect(() => {
    if (model.messages.length && nearBottom.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [model.messages]);
  React.useEffect(() => {
    if (model.open) composer.current?.focus();
    else {
      setMenu(false);
      setPicker(false);
      setContextOpen(false);
    }
  }, [model.open]);
  const attach = (value?: File) => {
    if (!value) return;
    if (
      !/^image\/(png|jpeg|webp|gif)$/.test(value.type) ||
      value.size > 10 * 1024 * 1024
    ) {
      setAttachmentError("Choose a PNG, JPEG, WebP or GIF under 10 MB.");
      return;
    }
    setAttachmentError(null);
    activeReader.current?.abort();
    const reader = new FileReader();
    activeReader.current = reader;
    reader.onload = () => {
      if (activeReader.current !== reader) return;
      activeReader.current = null;
      if (typeof reader.result === "string")
        model.setImage({ dataUrl: reader.result, name: value.name });
    };
    reader.onerror = () => {
      if (activeReader.current === reader) {
        activeReader.current = null;
        setAttachmentError(
          "This image could not be read. Try attaching it again.",
        );
      }
    };
    reader.readAsDataURL(value);
  };
  const resize = (
    event: React.PointerEvent<HTMLButtonElement>,
    horizontal: boolean,
    vertical: boolean,
  ) => {
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: model.width,
      height: model.height,
    };
    const move = (moveEvent: PointerEvent) =>
      model.setSize(
        horizontal ? start.width + start.x - moveEvent.clientX : start.width,
        vertical ? start.height + start.y - moveEvent.clientY : start.height,
      );
    const stop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };
  if (!model.open)
    return (
      <button
        type="button"
        className="qc-launcher"
        data-testid="quickchat-launcher"
        aria-label="Open Quick Chat"
        title="Quick Chat"
        onClick={() => model.setOpen(true)}
      >
        <MessageCircle size={20} />
      </button>
    );
  return (
    <section
      className="qc-panel"
      data-testid="quickchat-panel"
      aria-label="Quick Chat"
      style={{ width: model.width, height: model.height }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        attach(event.dataTransfer.files[0]);
      }}
    >
      {(["top", "left", "corner"] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          className={`qc-resize qc-resize-${edge}`}
          aria-label={`Resize Quick Chat ${edge}`}
          onPointerDown={(event) =>
            resize(event, edge !== "top", edge !== "left")
          }
          onDoubleClick={() => model.setSize(420, 560)}
          onKeyDown={(event) => {
            const delta = event.shiftKey ? 40 : 10;
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              model.setSize(
                model.width +
                  (event.key === "ArrowLeft"
                    ? delta
                    : event.key === "ArrowRight"
                      ? -delta
                      : 0),
                model.height +
                  (event.key === "ArrowUp"
                    ? delta
                    : event.key === "ArrowDown"
                      ? -delta
                      : 0),
              );
            }
          }}
        />
      ))}
      <header className="qc-header text-sm">
        <span>
          {resident?.name ?? "Luca"}{" "}
          <span className="text-muted-foreground">· Quick Chat</span>
        </span>
        <div className="qc-actions">
          <button
            type="button"
            aria-label="Quick Chat options"
            aria-expanded={menu}
            onClick={() => {
              setMenu(!menu);
              setContextOpen(false);
              setPicker(false);
            }}
          >
            <MoreHorizontal size={17} />
          </button>
          <button
            type="button"
            data-testid="quickchat-minimize"
            aria-label="Minimize Quick Chat"
            onClick={() => model.setOpen(false)}
          >
            <Minus size={17} />
          </button>
          <button
            type="button"
            aria-label="Close Quick Chat"
            onClick={() => model.setOpen(false)}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      {menu && (
        <div className="qc-menu text-xs">
          <button
            type="button"
            data-testid="quickchat-new-chat"
            onClick={() => {
              model.newChat();
              setMenu(false);
            }}
          >
            New chat
          </button>
          <button
            type="button"
            data-testid="quickchat-open-full"
            onClick={() => {
              model.openFullConversation();
              setMenu(false);
            }}
          >
            Open full conversation
          </button>
          <label>
            <input
              type="checkbox"
              checked={model.contextEnabled}
              onChange={(event) =>
                model.setContextEnabled(event.target.checked)
              }
            />{" "}
            Include current app context
          </label>
          <button
            type="button"
            data-testid="quickchat-capture"
            disabled={model.capturing}
            onClick={() => {
              void model.capture();
              setMenu(false);
            }}
          >
            <Camera size={14} /> Attach current view
          </button>
        </div>
      )}
      <div
        className="qc-transcript text-sm"
        ref={transcript}
        role="log"
        aria-label="Quick Chat messages"
        onScroll={(event) => {
          const node = event.currentTarget;
          nearBottom.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 60;
          model.setScrollTop(node.scrollTop);
        }}
      >
        {model.messages.length === 0 && permissions.length === 0 && (
          <p className="qc-empty text-muted-foreground">
            {resident
              ? "Ask about what you see, or start a conversation."
              : "Choose a resident to start chatting."}
          </p>
        )}
        {model.messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "owner" ? "qc-owner" : "qc-assistant"}
          >
            {message.role === "owner" ? (
              message.text
            ) : (
              <Markdown
                streaming={message.pending}
                progressive
                content={message.text || (message.pending ? "Thinking…" : "")}
              />
            )}
          </div>
        ))}
        {permissions.map((pending) => (
          <ManagedPermissionCard
            key={pending.pendingId}
            pending={pending}
            compact
          />
        ))}
      </div>
      {(model.error || attachmentError) && (
        <p role="alert" className="text-xs text-destructive">
          {model.error || attachmentError}
        </p>
      )}
      {model.image && (
        <div className="qc-attachment text-xs">
          <img src={model.image.dataUrl} alt="Attached screenshot" />
          <span>{model.image.name}</span>
          <button
            type="button"
            aria-label="Remove image"
            onClick={() => model.setImage(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="qc-context-wrap">
        <button
          type="button"
          data-testid="quickchat-context"
          className="qc-context text-2xs"
          aria-expanded={contextOpen}
          aria-controls="quickchat-context-details"
          onClick={() => {
            model.refreshContext();
            setContextOpen(!contextOpen);
            setMenu(false);
            setPicker(false);
          }}
        >
          App context ·{" "}
          {model.contextEnabled
            ? (model.context?.screen ?? "Current view")
            : "Off"}{" "}
          <ChevronDown size={10} />
        </button>
        {contextOpen && (
          <section
            id="quickchat-context-details"
            className="qc-context-details text-xs"
            aria-label="Included app context"
          >
            <label className="qc-context-toggle">
              <input
                type="checkbox"
                checked={model.contextEnabled}
                onChange={(event) =>
                  model.setContextEnabled(event.target.checked)
                }
              />{" "}
              Include current app context
            </label>
            {model.contextEnabled ? (
              <>
                <p className="text-muted-foreground">
                  A fresh snapshot is included when you send. This preview
                  excludes Quick Chat.
                </p>
                {model.context ? (
                  <>
                    <strong>{model.context.screen}</strong>
                    <pre>{model.context.text}</pre>
                    {model.context.targets.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">
                          Visible controls
                        </span>
                        <ul>
                          {model.context.targets.map((target) => (
                            <li key={target.id}>{target.label}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Current view will be captured when you send.
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                App context will not be included with your message.
              </p>
            )}
          </section>
        )}
      </div>
      <form
        className="qc-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void model.send();
        }}
      >
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            attach(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          aria-label="Attach image"
          onClick={() => file.current?.click()}
        >
          <Plus size={18} />
        </button>
        <textarea
          ref={composer}
          data-testid="quickchat-input"
          aria-label="Message"
          placeholder="Ask about what you see…"
          rows={1}
          value={model.draft}
          onChange={(event) => model.setDraft(event.target.value)}
          onPaste={(event) => {
            const image = Array.from(event.clipboardData.files).find((item) =>
              item.type.startsWith("image/"),
            );
            if (image) {
              event.preventDefault();
              attach(image);
            }
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (!model.busy && (model.draft.trim() || model.image))
                void model.send();
            }
          }}
        />
        <div className="qc-picker-wrap">
          <button
            className="qc-picker-trigger text-xs"
            type="button"
            data-testid="quickchat-agent-picker"
            aria-label="Choose resident and thinking effort"
            aria-expanded={picker}
            onClick={() => {
              setPicker(!picker);
              setContextOpen(false);
              setMenu(false);
            }}
          >
            {resident?.name ?? "Choose"}
            <ChevronDown size={13} />
          </button>
          {picker && (
            <div className="qc-picker">
              <div className="qc-residents">
                {model.residents.map((item) => (
                  <button
                    type="button"
                    key={item.pubkey}
                    aria-pressed={item.pubkey === model.selectedPubkey}
                    onClick={() => model.selectResident(item.pubkey)}
                  >
                    <span>{item.name}</span>
                    <span className="text-2xs text-muted-foreground">
                      {item.detail}
                    </span>
                  </button>
                ))}
                {!model.residents.length && (
                  <button type="button" onClick={model.openAgentSetup}>
                    Set up a resident
                  </button>
                )}
              </div>
              <Effort model={model} />
            </div>
          )}
        </div>
        {model.busy ? (
          <button
            type="button"
            className="qc-send"
            aria-label="Stop response"
            onClick={model.stop}
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="submit"
            className="qc-send"
            data-testid="quickchat-send"
            aria-label="Send message"
            disabled={
              !model.selectedPubkey || (!model.draft.trim() && !model.image)
            }
          >
            <ArrowUp size={18} />
          </button>
        )}
      </form>
    </section>
  );
}
