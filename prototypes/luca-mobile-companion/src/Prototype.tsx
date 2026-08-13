import {
  ActivityLogIcon,
  ArrowRightIcon,
  BellIcon,
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  Cross2Icon,
  DesktopIcon,
  ExclamationTriangleIcon,
  EyeOpenIcon,
  FileIcon,
  GearIcon,
  HamburgerMenuIcon,
  InfoCircledIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MobileIcon,
  PaperPlaneIcon,
  ReaderIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BottomSheet,
  KeyboardInput,
  KeyboardTextarea,
  MobileScroll,
  useKeyboard,
  useKeyboardInsets,
} from "./mobile";

type PlaceId = "network" | "room";
type RoomMode = "conversation" | "listening";
type PermissionPhase = "idle" | "pending" | "open" | "approved" | "declined";
type ResidentId = "luca" | "vektor";
type SheetId = "resident" | "connection" | "menu" | "remove-device" | null;
type RecordId = "conversations" | "activity" | "notifications" | "settings" | "privacy" | "devices";
type OnboardingStep = "welcome" | "scan" | "verify" | "connecting" | "ready" | null;
type ConnectionState = "available" | "offline" | "revoked";
type MessageRole = "user" | "resident" | "system";
type MessageKind = "message" | "permission" | "status";
type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  time: string;
  resident?: ResidentId;
  kind?: MessageKind;
};
type SceneId =
  | "network"
  | "room"
  | "permission"
  | "approved"
  | "declined"
  | "onboarding"
  | "pairing"
  | "conversations"
  | "activity"
  | "notifications"
  | "settings"
  | "privacy"
  | "devices"
  | "offline";

const ease = [0.16, 1, 0.3, 1] as [number, number, number, number];
const permissionRequest = "Vektor needs your approval to review three launch files.";
const approvedStatement = "Vektor can read the three files. No standing access was created.";
const declinedStatement = "Vektor remains available. The files were not opened.";
const preparedPrompt = "Review the three launch files before we finalize the handoff.";
const processingStatement = "Vektor is reviewing what this would require.";

let messageSerial = 0;
function nextMessageId(prefix: string) {
  messageSerial += 1;
  return `${prefix}-${messageSerial}`;
}

function seedMessages(permission: PermissionPhase, resident: ResidentId, statement: string): ChatMessage[] {
  if (statement.toLowerCase().includes("offline") || statement.toLowerCase().includes("preserved here")) {
    return [
      {
        id: "seed-luca-cached",
        role: "resident",
        resident: "luca",
        text: "I’m here. Your conversations and identity remain connected through your Mac.",
        time: "earlier",
      },
      {
        id: "seed-offline",
        role: "system",
        kind: "status",
        text: statement,
        time: "now",
      },
    ];
  }

  const base: ChatMessage[] = [
    {
      id: "seed-user-1",
      role: "user",
      text: preparedPrompt,
      time: "21:28",
    },
    {
      id: "seed-luca-1",
      role: "resident",
      resident: "luca",
      text: "I’m here. Vektor is reviewing the launch plan on your Mac.",
      time: "21:29",
    },
  ];

  if (permission === "pending" || permission === "open") {
    return [
      ...base,
      {
        id: "seed-vektor-pending",
        role: "resident",
        resident: "vektor",
        kind: "permission",
        text: permissionRequest,
        time: "now",
      },
    ];
  }

  if (permission === "approved") {
    return [
      ...base,
      {
        id: "seed-vektor-approved",
        role: "resident",
        resident: "vektor",
        text: approvedStatement,
        time: "now",
      },
    ];
  }

  if (permission === "declined") {
    return [
      ...base,
      {
        id: "seed-vektor-declined",
        role: "resident",
        resident: "vektor",
        text: declinedStatement,
        time: "now",
      },
    ];
  }

  if (resident === "vektor") {
    return [
      ...base,
      {
        id: "seed-vektor-status",
        role: "resident",
        resident: "vektor",
        kind: "status",
        text: statement || "I’m reviewing the launch plan on your Mac. Nothing needs you yet.",
        time: "41m",
      },
    ];
  }

  // Default multi-resident room: familiar ChatGPT-style history already present.
  return [
    {
      id: "seed-user-open",
      role: "user",
      text: "Where are we on the launch plan?",
      time: "21:24",
    },
    {
      id: "seed-luca-open",
      role: "resident",
      resident: "luca",
      text: statement || "I’m here. Vektor is reviewing the launch plan on your Mac.",
      time: "21:25",
    },
    {
      id: "seed-vektor-open",
      role: "resident",
      resident: "vektor",
      kind: "status",
      text: "I’m reviewing the launch plan on your Mac. Nothing needs you yet.",
      time: "41m",
    },
  ];
}

const residents: Record<
  ResidentId,
  { name: string; role: string; state: string; detail: string; fingerprint: string }
> = {
  luca: {
    name: "Luca",
    role: "personal resident",
    state: "present",
    detail: "Available through your Mac",
    fingerprint: "7f3a · 9c21",
  },
  vektor: {
    name: "Vektor",
    role: "systems resident",
    state: "working",
    detail: "Reviewing the launch plan",
    fingerprint: "42d8 · ae06",
  },
};

function sceneFixture(): {
  place: PlaceId;
  permission: PermissionPhase;
  resident: ResidentId;
  statement: string;
  record: RecordId | null;
  onboarding: OnboardingStep;
  connection: ConnectionState;
} {
  const scene = new URLSearchParams(window.location.search).get("scene") as SceneId | null;
  const base = {
    record: null as RecordId | null,
    onboarding: null as OnboardingStep,
    connection: "available" as ConnectionState,
  };
  if (scene === "network") {
    return {
      ...base,
      place: "network",
      permission: "idle",
      resident: "vektor",
      statement: "I’m reviewing the launch plan on your Mac. Nothing needs you yet.",
    };
  }
  if (scene === "permission") {
    return { ...base, place: "room", permission: "open", resident: "vektor", statement: permissionRequest };
  }
  if (scene === "approved") {
    return { ...base, place: "room", permission: "approved", resident: "vektor", statement: approvedStatement };
  }
  if (scene === "declined") {
    return { ...base, place: "room", permission: "declined", resident: "vektor", statement: declinedStatement };
  }
  if (scene === "onboarding" || scene === "pairing") {
    return {
      ...base,
      place: "network",
      permission: "idle",
      resident: "luca",
      statement: "I’m here. Vektor is reviewing the launch plan on your Mac.",
      onboarding: scene === "pairing" ? "scan" : "welcome",
    };
  }
  if (scene === "offline") {
    return {
      ...base,
      place: "room",
      permission: "idle",
      resident: "luca",
      statement: "You’re offline. The room is preserved here and will reconnect when the network returns.",
      connection: "offline",
    };
  }
  if (
    scene === "conversations"
    || scene === "activity"
    || scene === "notifications"
    || scene === "settings"
    || scene === "privacy"
    || scene === "devices"
  ) {
    return {
      ...base,
      place: "network",
      permission: scene === "activity" ? "pending" : "idle",
      resident: "vektor",
      statement: scene === "activity" ? permissionRequest : "I’m reviewing the launch plan on your Mac. Nothing needs you yet.",
      record: scene,
    };
  }
  return {
    ...base,
    place: "room",
    permission: "idle",
    resident: "luca",
    statement: "I’m here. Vektor is reviewing the launch plan on your Mac.",
  };
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function IdentityMark({
  resident,
  size = 30,
  tone = "light",
}: {
  resident: ResidentId;
  size?: number;
  tone?: "light" | "dark";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = size * scale;
    canvas.height = size * scale;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.scale(scale, scale);
    context.clearRect(0, 0, size, size);
    const seed = hashSeed(resident);
    const cells = 7;
    const gap = size >= 30 ? 1.4 : 1.05;
    const cell = (size - gap * (cells - 1)) / cells;
    context.fillStyle = tone === "dark"
      ? resident === "luca" ? "#25292b" : "#496f91"
      : resident === "luca" ? "#e9eae6" : "#c6c9c8";

    for (let row = 0; row < cells; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const bit = (seed >>> ((row * 4 + column) % 28)) & 1;
        const anchor = column === 3 || row === 3 || (row + column) % 4 === 0;
        if (!bit && !anchor) continue;
        const mirror = cells - 1 - column;
        [column, mirror].forEach((xCell) => {
          context.beginPath();
          context.roundRect(
            xCell * (cell + gap),
            row * (cell + gap),
            cell,
            cell,
            cell * 0.38,
          );
          context.fill();
        });
      }
    }
  }, [resident, size, tone]);

  return (
    <canvas
      ref={canvasRef}
      className="identity-mark"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${residents[resident].name} identity mark`}
    />
  );
}

function WorkingMark({
  size = 32,
  active = true,
  tone = "light",
}: {
  size?: number;
  active?: boolean;
  tone?: "light" | "dark";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = size * scale;
    canvas.height = size * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;

    const draw = (time: number) => {
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, size, size);
      const grid = 7;
      const gap = size >= 40 ? 1.8 : 1.45;
      const cell = (size - gap * (grid - 1)) / grid;
      for (let row = 0; row < grid; row += 1) {
        for (let column = 0; column < grid; column += 1) {
          const distance = Math.hypot(row - 3, column - 3);
          const wave = active
            ? (Math.sin(time / 520 - distance * 1.02) + 1) / 2
            : ((row * 5 + column * 3) % 7) / 7;
          if (((row * 5 + column * 3) % 7) / 7 > wave) continue;
          context.globalAlpha = active ? 0.2 + wave * 0.72 : 0.52;
          context.fillStyle = active && column > 3 && row < 4
            ? tone === "dark" ? "#496f91" : "#72a8d8"
            : tone === "dark" ? "#25292b" : "#d4d7d5";
          context.beginPath();
          context.arc(
            column * (cell + gap) + cell / 2,
            row * (cell + gap) + cell / 2,
            cell * 0.39,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
      context.globalAlpha = 1;
      if (active && !reducedMotion) frame = window.requestAnimationFrame(draw);
    };

    draw(0);
    return () => window.cancelAnimationFrame(frame);
  }, [active, reducedMotion, size, tone]);

  return (
    <canvas
      ref={canvasRef}
      className="identity-mark"
      style={{ width: size, height: size }}
      role="img"
      aria-label={active ? "Vektor working state" : "Vektor identity mark"}
    />
  );
}

function ResidentMark({
  resident,
  size,
  working,
  tone = "light",
}: {
  resident: ResidentId;
  size: number;
  working: boolean;
  tone?: "light" | "dark";
}) {
  return resident === "vektor" ? (
    <WorkingMark size={size} active={working} tone={tone} />
  ) : (
    <IdentityMark resident={resident} size={size} tone={tone} />
  );
}

function residentClause(resident: ResidentId, permission: PermissionPhase) {
  if (resident === "luca") return "replied 2m ago";
  if (permission === "pending" || permission === "open") return "waiting for one decision · 41m";
  if (permission === "approved") return "reviewing three files · just now";
  if (permission === "declined") return "launch review paused · just now";
  return "on the launch plan · 41m";
}

function NetworkPlace({
  activeResident,
  permission,
  visible,
  onEnterResident,
  onOpenResident,
  onConnection,
  onOpenMenu,
}: {
  activeResident: ResidentId;
  permission: PermissionPhase;
  visible: boolean;
  onEnterResident: (resident: ResidentId) => void;
  onOpenResident: (resident: ResidentId) => void;
  onConnection: () => void;
  onOpenMenu: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const vektorWorking = permission !== "declined";

  return (
    <motion.section
      className="place-layer network-place"
      data-testid="network-place"
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
      initial={false}
      animate={visible
        ? { opacity: 1, x: 0 }
        : reducedMotion
          ? { opacity: 0 }
          : { opacity: 0, x: -24 }}
      transition={{ duration: reducedMotion ? 0.16 : 0.48, ease }}
      style={{ pointerEvents: visible ? "auto" : "none" }}
    >
      <button className="network-menu-button" type="button" onClick={onOpenMenu} aria-label="Open companion menu">
        <HamburgerMenuIcon width={18} height={18} />
      </button>
      <MobileScroll className="app-screen network-scroll">
        <main className="network-surface" aria-label="Luca network">
          <section className="network-hero">
            <span className="eyebrow">LUCA NETWORK · NOW</span>
            <div className="network-measure">
              <strong>2</strong>
              <span>residents present</span>
            </div>
            <p>Your network is quiet. One resident is working.</p>
          </section>

          <section className="resident-floor" aria-labelledby="resident-heading">
            <div className="floor-heading">
              <span className="eyebrow">RESIDENTS</span>
              <h1 id="resident-heading">Within reach</h1>
            </div>

            {(["luca", "vektor"] as ResidentId[]).map((resident) => (
              <div className="resident-line" key={resident} data-resident={resident}>
                <button
                  type="button"
                  className="resident-identity-button"
                  aria-label={`Open ${residents[resident].name} details`}
                  onClick={() => onOpenResident(resident)}
                >
                  <motion.span
                    className="shared-mark"
                    layoutId={!reducedMotion && visible ? `resident-mark-${resident}` : undefined}
                    transition={{ duration: reducedMotion ? 0.16 : 0.48, ease }}
                  >
                    <ResidentMark resident={resident} size={34} working={resident === "vektor" && vektorWorking} tone="dark" />
                  </motion.span>
                </button>
                <button
                  type="button"
                  className="resident-enter-button"
                  aria-label={`Enter the room with ${residents[resident].name}`}
                  onClick={() => onEnterResident(resident)}
                >
                  <motion.span
                    className="resident-copy"
                    layoutId={
                      !reducedMotion && activeResident === resident
                        && visible
                        ? `resident-copy-${resident}`
                        : undefined
                    }
                    transition={{ duration: reducedMotion ? 0.16 : 0.48, ease }}
                  >
                    <strong>{residents[resident].name}</strong>
                    <small>{residentClause(resident, permission)}</small>
                  </motion.span>
                  <ChevronLeftIcon className="resident-enter-arrow" width={16} height={16} aria-hidden="true" />
                </button>
              </div>
            ))}

            <button className="network-footer" type="button" onClick={onConnection}>
              <span><i aria-hidden="true" />Mac available</span>
              <small>connection detail</small>
            </button>
          </section>
        </main>
      </MobileScroll>
    </motion.section>
  );
}

function RoomPlace({
  activeResident,
  permission,
  mode,
  messages,
  draft,
  bottomInset,
  visible,
  endRef,
  onBack,
  onOpenPermission,
  onDraft,
  onSend,
  onOrbDown,
  onOrbUp,
  onOrbCancel,
}: {
  activeResident: ResidentId;
  permission: PermissionPhase;
  mode: RoomMode;
  messages: ChatMessage[];
  draft: string;
  bottomInset: number;
  visible: boolean;
  endRef: RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onOpenPermission: () => void;
  onDraft: (draft: string) => void;
  onSend: () => void;
  onOrbDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOrbUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOrbCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const reducedMotion = useReducedMotion();
  const working = activeResident === "vektor" && permission !== "declined" && permission !== "approved";
  const permissionOpen = permission === "open";
  const roomTitle = activeResident === "luca" ? "Luca & Vektor" : residents[activeResident].name;
  const roomSubtitle = permission === "pending"
    ? "Needs one decision"
    : permission === "approved"
      ? "Files opened for this request"
      : permission === "declined"
        ? "Request declined"
        : working
          ? "Working on your Mac"
          : "Within reach";
  const latestResident = [...messages].reverse().find((message) => message.role === "resident");
  const statementText = mode === "listening"
    ? "Listening…"
    : latestResident?.text ?? residents[activeResident].detail;

  return (
    <motion.section
      className="place-layer room-place"
      data-testid="room-place"
      aria-hidden={!visible}
      inert={!visible || permissionOpen ? true : undefined}
      initial={false}
      animate={visible
        ? { opacity: 1, x: 0 }
        : reducedMotion
          ? { opacity: 0 }
          : { opacity: 0, x: 24 }}
      transition={{ duration: reducedMotion ? 0.16 : 0.48, ease }}
      style={{ pointerEvents: visible && !permissionOpen ? "auto" : "none" }}
    >
      <img className="room-field" src="/assets/luca-room-field.jpg" alt="" aria-hidden="true" draggable={false} />

      <header className="room-header">
        <button className="room-back" type="button" onClick={onBack} aria-label="Back to network">
          <ChevronLeftIcon width={20} height={20} />
        </button>
        <div className="room-header-identity">
          <motion.span
            className={`shared-mark room-mark ${permission === "pending" ? "is-requesting" : ""}`}
            layoutId={
              !reducedMotion && visible && !permissionOpen
                ? `resident-mark-${activeResident}`
                : undefined
            }
            transition={{ duration: reducedMotion ? 0.16 : permission === "pending" ? 0.42 : 0.48, ease }}
          >
            <ResidentMark resident={activeResident} size={28} working={working || permission === "pending"} />
          </motion.span>
          <div className="room-header-copy">
            <strong>{roomTitle}</strong>
            <small>{roomSubtitle}</small>
          </div>
        </div>
        <span className="room-header-spacer" aria-hidden="true" />
      </header>

      <motion.div
        className="edge-back-zone"
        aria-hidden="true"
        drag={reducedMotion ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        onDragEnd={(_, info) => {
          if (info.offset.x > 68 || info.velocity.x > 420) onBack();
        }}
      />

      <MobileScroll className="room-transcript-scroll">
        <div className="room-transcript" aria-label="Conversation">
          <p className="room-transcript-eyebrow">Conversation stays signed on your Mac. This phone is a quiet doorway.</p>

          {messages.map((message, index) => {
            const isLatestResident = latestResident?.id === message.id;
            const isPermission = message.kind === "permission" || (message.role === "resident" && message.text === permissionRequest);
            const body = (
              <>
                {message.role === "resident" && message.resident ? (
                  <span className="turn-mark" aria-hidden="true">
                    <ResidentMark
                      resident={message.resident}
                      size={22}
                      working={message.resident === "vektor" && (working || isPermission)}
                    />
                  </span>
                ) : null}
                <div className="turn-body">
                  <div className="turn-meta">
                    <span>
                      {message.role === "user"
                        ? "You"
                        : message.resident
                          ? residents[message.resident].name
                          : "Room"}
                    </span>
                    <time>{message.time}</time>
                  </div>
                  <p>{message.text}</p>
                  {isPermission ? (
                    <span className="turn-action-hint">Tap to review request</span>
                  ) : null}
                </div>
              </>
            );

            const statementTestId = mode === "listening"
              ? undefined
              : index === messages.length - 1
                ? "room-statement"
                : undefined;

            if (isPermission) {
              return (
                <button
                  key={message.id}
                  type="button"
                  className={`chat-turn is-resident is-permission ${isLatestResident ? "is-latest" : ""}`}
                  data-testid={statementTestId}
                  onClick={onOpenPermission}
                  aria-label={`${message.text} Open permission request.`}
                >
                  {body}
                </button>
              );
            }

            return (
              <article
                key={message.id}
                className={`chat-turn is-${message.role} ${message.kind === "status" ? "is-status" : ""} ${isLatestResident ? "is-latest" : ""}`}
                data-testid={statementTestId}
              >
                {body}
              </article>
            );
          })}

          {mode === "listening" ? (
            <div className="chat-turn is-listening" data-testid="room-statement" aria-live="polite">
              <span className="turn-mark" aria-hidden="true">
                <WorkingMark size={22} active />
              </span>
              <div className="turn-body">
                <div className="turn-meta"><span>Listening</span><time>now</time></div>
                <p>Listening…</p>
              </div>
            </div>
          ) : null}

          {!messages.length && mode !== "listening" ? (
            <article className="chat-turn is-resident is-latest" data-testid="room-statement">
              <div className="turn-body"><p>{statementText}</p></div>
            </article>
          ) : null}

          <div ref={endRef} className="room-transcript-end" aria-hidden="true" />
        </div>
      </MobileScroll>

      <div
        className={`room-composer-dock ${mode === "listening" ? "is-listening" : ""}`}
        data-testid="inline-composer"
        style={{ bottom: bottomInset }}
      >
        {mode === "listening" ? (
          <p className="composer-listening-label">Listening — release to send</p>
        ) : null}
        <div className="composer-row">
          <button
            className={`voice-orb ${mode === "listening" ? "is-listening" : ""}`}
            data-testid="voice-orb"
            type="button"
            aria-label={mode === "listening" ? "Listening. Release to send" : "Hold to speak"}
            aria-pressed={mode === "listening"}
            onPointerDown={onOrbDown}
            onPointerUp={onOrbUp}
            onPointerCancel={onOrbCancel}
            onContextMenu={(event) => event.preventDefault()}
          />
          <KeyboardTextarea
            id="room-message"
            value={draft}
            onChange={(event) => onDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="Message Luca and Vektor"
            aria-label="Message Luca and Vektor"
            disabled={mode === "listening"}
          />
          <button
            className="composer-send"
            type="button"
            onClick={onSend}
            disabled={!draft.trim() || mode === "listening"}
            aria-label="Send message"
          >
            <PaperPlaneIcon width={16} height={16} />
          </button>
        </div>
      </div>
    </motion.section>
  );
}

function RecordRow({
  icon,
  title,
  detail,
  meta,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  meta?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  const content = (
    <>
      <span className="record-row-icon" aria-hidden="true">{icon}</span>
      <span className="record-row-copy"><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span>
      {meta ? <span className="record-row-meta">{meta}</span> : onClick ? <ChevronRightIcon className="record-row-arrow" width={16} height={16} aria-hidden="true" /> : null}
    </>
  );
  return onClick ? (
    <button className={`record-row ${danger ? "is-danger" : ""}`} type="button" onClick={onClick}>{content}</button>
  ) : (
    <div className={`record-row ${danger ? "is-danger" : ""}`}>{content}</div>
  );
}

function ToggleRow({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className="toggle-row"
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span><strong>{title}</strong><small>{detail}</small></span>
      <i className="quiet-switch" aria-hidden="true"><b /></i>
    </button>
  );
}

const recordTitles: Record<RecordId, { eyebrow: string; title: string; description: string }> = {
  conversations: { eyebrow: "LUCA", title: "Conversations", description: "Three rooms within reach" },
  activity: { eyebrow: "NETWORK", title: "Activity", description: "Owner-visible work and decisions" },
  notifications: { eyebrow: "THIS PHONE", title: "Notifications", description: "Attention without exposing private work" },
  settings: { eyebrow: "COMPANION", title: "Settings", description: "This phone, not your resident runtimes" },
  privacy: { eyebrow: "THIS PHONE", title: "Privacy & Security", description: "What appears here and when" },
  devices: { eyebrow: "AUTHORITY", title: "Paired devices", description: "Independent access you can remove" },
};

function AppRecord({
  record,
  permission,
  connection,
  search,
  notificationsEnabled,
  notificationPreview,
  screenShield,
  activityStopped,
  onBack,
  onOpenRecord,
  onSearch,
  onEnterRoom,
  onOpenPermission,
  onOpenConnection,
  onNotifications,
  onNotificationPreview,
  onScreenShield,
  onStopActivity,
  onRemoveDevice,
}: {
  record: RecordId;
  permission: PermissionPhase;
  connection: ConnectionState;
  search: string;
  notificationsEnabled: boolean;
  notificationPreview: "names" | "generic" | "none";
  screenShield: boolean;
  activityStopped: boolean;
  onBack: () => void;
  onOpenRecord: (record: RecordId) => void;
  onSearch: (query: string) => void;
  onEnterRoom: (resident: ResidentId) => void;
  onOpenPermission: () => void;
  onOpenConnection: () => void;
  onNotifications: (value: boolean) => void;
  onNotificationPreview: (value: "names" | "generic" | "none") => void;
  onScreenShield: (value: boolean) => void;
  onStopActivity: () => void;
  onRemoveDevice: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const copy = recordTitles[record];
  const conversations = [
    { id: "room", title: "Luca & Vektor", detail: permission === "pending" || permission === "open" ? permissionRequest : "The launch plan is moving quietly.", time: "now", resident: "vektor" as ResidentId, unread: permission === "pending" || permission === "open" },
    { id: "luca", title: "Luca", detail: "Your network remains connected through your Mac.", time: "2m", resident: "luca" as ResidentId, unread: false },
    { id: "vektor", title: "Vektor", detail: activityStopped ? "Launch review stopped on this phone." : "Reviewing the launch plan.", time: "41m", resident: "vektor" as ResidentId, unread: false },
  ].filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    const deviceScreen = document.querySelector<HTMLElement>('[data-testid="device-screen"]');
    if (deviceScreen) deviceScreen.scrollTop = 0;
    const frame = window.requestAnimationFrame(() => {
      if (deviceScreen) deviceScreen.scrollTop = 0;
      titleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [record]);

  return (
    <motion.section
      className="app-record"
      data-testid={`record-${record}`}
      aria-labelledby="record-title"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      transition={{ duration: reducedMotion ? 0.16 : 0.28, ease }}
    >
      <header className="record-header">
        <button type="button" className="record-back" onClick={onBack} aria-label="Back">
          <ChevronLeftIcon width={20} height={20} />
        </button>
        <div className="record-heading">
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1 id="record-title" ref={titleRef} tabIndex={-1}>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        {record === "conversations" ? (
          <button className="record-action" type="button" onClick={() => setSearchOpen((value) => !value)} aria-label="Search conversations">
            {searchOpen ? <Cross2Icon width={18} height={18} /> : <MagnifyingGlassIcon width={18} height={18} />}
          </button>
        ) : null}
      </header>

      <MobileScroll className="record-scroll">
        <main className="record-content">
          {connection !== "available" ? (
            <button className="connection-notice" type="button" onClick={onOpenConnection}>
              <ExclamationTriangleIcon width={17} height={17} />
              <span><strong>Phone offline</strong><small>Cached rooms remain readable. New messages will wait.</small></span>
              <ChevronRightIcon width={16} height={16} />
            </button>
          ) : null}

          {record === "conversations" ? (
            <>
              <AnimatePresence initial={false}>
                {searchOpen ? (
                  <motion.div className="conversation-search" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 48 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reducedMotion ? 0.16 : 0.22, ease }}>
                    <MagnifyingGlassIcon width={15} height={15} aria-hidden="true" />
                    <KeyboardInput value={search} onChange={(event) => onSearch(event.currentTarget.value)} autoFocus placeholder="Search conversations" aria-label="Search conversations" />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <section className="conversation-list" aria-label="Conversations">
                {conversations.map((item) => (
                  <button className="conversation-row" type="button" key={item.id} onClick={() => onEnterRoom(item.resident)}>
                    <span className="conversation-mark">
                      {item.id === "room" ? <><IdentityMark resident="luca" size={23} tone="light" /><WorkingMark size={23} active={!activityStopped} /></> : <ResidentMark resident={item.resident} size={31} working={item.resident === "vektor" && !activityStopped} />}
                    </span>
                    <span className="conversation-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
                    <span className="conversation-time">{item.time}{item.unread ? <i aria-label="unread">1</i> : null}</span>
                  </button>
                ))}
                {conversations.length === 0 ? (
                  <div className="record-empty"><MagnifyingGlassIcon width={22} height={22} /><strong>No matching rooms</strong><span>Try a resident name or a phrase from the conversation.</span></div>
                ) : null}
              </section>
              <p className="record-footnote">Conversation chronology remains signed and canonical on the Luca relay.</p>
            </>
          ) : null}

          {record === "activity" ? (
            <>
              {permission === "pending" || permission === "open" ? (
                <button className="decision-callout" type="button" onClick={onOpenPermission}>
                  <WorkingMark size={34} active />
                  <span><small>VEKTOR · NEEDS YOU</small><strong>Review three launch files?</strong><p>This request has not opened any files.</p></span>
                  <ChevronRightIcon width={18} height={18} />
                </button>
              ) : null}
              <section className="activity-group" aria-labelledby="active-work-title">
                <span className="section-label">CURRENT</span>
                <article className="activity-entry is-current">
                  <WorkingMark size={31} active={!activityStopped} />
                  <div><h2 id="active-work-title">{activityStopped ? "Launch review stopped" : "Vektor is reviewing the launch plan"}</h2><p>{activityStopped ? "No further work is running from this turn." : "Reading the brief and preparing one bounded recommendation."}</p><span>{activityStopped ? "stopped · just now" : "working · 6m"}</span></div>
                </article>
                {!activityStopped ? <button className="quiet-action" type="button" onClick={onStopActivity}>Stop Vektor’s current work</button> : null}
              </section>
              <section className="activity-group" aria-label="Earlier activity">
                <span className="section-label">EARLIER</span>
                <article className="activity-entry"><IdentityMark resident="luca" size={30} /><div><h2>Luca replied in the room</h2><p>Your network remains connected through your Mac.</p><span>conversation · 2m</span></div></article>
                <article className="activity-entry"><WorkingMark size={30} active={false} /><div><h2>Launch review started</h2><p>Vektor began work after your message.</p><span>owner-visible activity · 41m</span></div></article>
              </section>
            </>
          ) : null}

          {record === "notifications" ? (
            <>
              <section className="settings-section">
                <span className="section-label">ATTENTION</span>
                <ToggleRow title="Allow notifications" detail="Resident replies, exact requests, and connection changes" checked={notificationsEnabled} onChange={onNotifications} />
              </section>
              <section className="settings-section">
                <span className="section-label">LOCK SCREEN PREVIEW</span>
                {([[
                  "names",
                  "Resident and room",
                  "Show who reached you, never the message body",
                ], ["generic", "Generic", "Show only that Luca has an update"], ["none", "No preview", "Reveal content after the phone unlocks"]] as const).map(([value, title, detail]) => (
                  <button className="choice-row" type="button" key={value} aria-pressed={notificationPreview === value} onClick={() => onNotificationPreview(value)}>
                    <span><strong>{title}</strong><small>{detail}</small></span>
                    <i aria-hidden="true">{notificationPreview === value ? <CheckIcon width={15} height={15} /> : null}</i>
                  </button>
                ))}
              </section>
              <div className="privacy-example"><span>EXAMPLE</span><strong>{notificationPreview === "names" ? "Vektor needs your attention" : notificationPreview === "generic" ? "Luca has an update" : "Notification content hidden"}</strong><p>{notificationPreview === "names" ? "Launch room · permission request" : "Open Luca to view it."}</p></div>
              <p className="record-footnote">Permission payloads, local paths, private reasoning, and message bodies never appear in this preview.</p>
            </>
          ) : null}

          {record === "settings" ? (
            <>
              <section className="settings-identity">
                <div className="companion-seal"><IdentityMark resident="luca" size={32} /><WorkingMark size={32} active /></div>
                <div><strong>Luca Companion</strong><span>This iPhone · paired to Riley’s Mac</span></div>
              </section>
              <section className="settings-section">
                <span className="section-label">COMPANION</span>
                <RecordRow icon={<DesktopIcon width={18} height={18} />} title="Riley’s Mac" detail="Available · two residents within reach" onClick={onOpenConnection} />
                <RecordRow icon={<BellIcon width={18} height={18} />} title="Notifications" detail={notificationsEnabled ? "Allowed · privacy-safe previews" : "Off"} onClick={() => onOpenRecord("notifications")} />
                <RecordRow icon={<LockClosedIcon width={18} height={18} />} title="Privacy & Security" detail="Screen shielding and preview policy" onClick={() => onOpenRecord("privacy")} />
              </section>
              <section className="settings-section">
                <span className="section-label">AUTHORITY</span>
                <RecordRow icon={<MobileIcon width={18} height={18} />} title="Paired devices" detail="This phone has independent mobile access" onClick={() => onOpenRecord("devices")} />
              </section>
              <section className="settings-section">
                <span className="section-label">ABOUT</span>
                <RecordRow icon={<InfoCircledIcon width={18} height={18} />} title="Luca Companion prototype" detail="Frontend concept · no production relay connected" meta="v2" />
              </section>
            </>
          ) : null}

          {record === "privacy" ? (
            <>
              <section className="privacy-intro"><LockClosedIcon width={23} height={23} /><p>The phone can converse with residents hosted by your Mac. It cannot reconfigure them or inherit their credentials.</p></section>
              <section className="settings-section">
                <span className="section-label">ON THIS PHONE</span>
                <ToggleRow title="Shield app switcher" detail="Conceal Room content when Luca leaves the foreground" checked={screenShield} onChange={onScreenShield} />
                <RecordRow icon={<EyeOpenIcon width={18} height={18} />} title="Notification previews" detail={notificationPreview === "names" ? "Resident and room only" : notificationPreview === "generic" ? "Generic" : "No preview"} onClick={() => onOpenRecord("notifications")} />
              </section>
              <section className="authority-ledger" aria-label="Mobile authority boundary">
                <span className="section-label">MOBILE AUTHORITY</span>
                <dl><div><dt>messages</dt><dd>read and send</dd></div><div><dt>permissions</dt><dd>exact requests only</dd></div><div><dt>resident secrets</dt><dd>remain on Mac</dd></div><div><dt>runtime changes</dt><dd>not available</dd></div></dl>
              </section>
              <p className="record-footnote">This prototype explains the intended boundary; it does not claim secure storage or revocation is implemented.</p>
            </>
          ) : null}

          {record === "devices" ? (
            <>
              <section className="device-card is-current">
                <MobileIcon width={23} height={23} />
                <div><small>THIS DEVICE</small><strong>Riley’s iPhone</strong><span>{connection === "revoked" ? "Mobile access removed" : "Authorized just now · independently removable"}</span></div>
                {connection !== "revoked" ? <CheckIcon width={16} height={16} aria-label="Current device" /> : null}
              </section>
              <section className="device-card">
                <DesktopIcon width={23} height={23} />
                <div><small>HOST</small><strong>Riley’s Mac</strong><span>Resident runtimes and signing remain here</span></div>
              </section>
              <section className="device-boundary"><h2>Removing this phone</h2><p>Revokes its companion authorization and removes cached Luca content from this device. It does not stop or delete residents on your Mac.</p></section>
              {connection !== "revoked" ? <button className="destructive-action" type="button" onClick={onRemoveDevice}><TrashIcon width={17} height={17} />Remove this phone</button> : <div className="revoked-state"><CheckIcon width={18} height={18} /><span><strong>This phone was removed</strong><small>Pair again from Luca on your Mac to restore access.</small></span></div>}
            </>
          ) : null}
        </main>
      </MobileScroll>
    </motion.section>
  );
}

function OnboardingFlow({
  step,
  notificationsEnabled,
  onStep,
  onNotifications,
  onComplete,
}: {
  step: Exclude<OnboardingStep, null>;
  notificationsEnabled: boolean;
  onStep: (step: Exclude<OnboardingStep, null>) => void;
  onNotifications: (value: boolean) => void;
  onComplete: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const deviceScreen = document.querySelector<HTMLElement>('[data-testid="device-screen"]');
    if (deviceScreen) deviceScreen.scrollTop = 0;
    const frame = window.requestAnimationFrame(() => {
      if (deviceScreen) deviceScreen.scrollTop = 0;
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (step !== "connecting") return;
    const timer = window.setTimeout(() => onStep("ready"), 1050);
    return () => window.clearTimeout(timer);
  }, [onStep, step]);

  const progress = step === "welcome" ? 1 : step === "scan" ? 2 : step === "verify" ? 3 : step === "connecting" ? 4 : 5;

  return (
    <motion.section className="onboarding" data-testid="onboarding" aria-labelledby="onboarding-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0.16 : 0.28, ease }}>
      <div className="onboarding-progress" aria-label={`Pairing step ${progress} of 5`}><span style={{ width: `${progress * 20}%` }} /></div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} className={`onboarding-step is-${step}`} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={{ duration: reducedMotion ? 0.16 : 0.3, ease }}>
          {step === "welcome" ? (
            <>
              <div className="onboarding-constellation" aria-hidden="true"><IdentityMark resident="luca" size={46} /><WorkingMark size={46} active /></div>
              <div className="onboarding-copy"><span className="eyebrow">LUCA COMPANION</span><h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>Your residents,<br />within reach.</h1><p>This phone becomes a quiet doorway to Luca on your Mac. Residents keep running there; conversation comes with you.</p></div>
              <div className="onboarding-actions"><button className="onboarding-primary" type="button" onClick={() => onStep("scan")}>Pair with my Mac<ArrowRightIcon width={17} height={17} /></button><small>No resident secrets move to this phone.</small></div>
            </>
          ) : null}
          {step === "scan" ? (
            <>
              <div className="onboarding-copy compact"><span className="eyebrow">PAIR · 2 OF 5</span><h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>Find your Mac.</h1><p>Open Luca on Riley’s Mac and show its one-time pairing code.</p></div>
              <div className="scan-field" aria-hidden="true"><i /><span><CameraIcon width={23} height={23} /><small>QR code stays inside this frame</small></span></div>
              <div className="onboarding-actions"><button className="onboarding-primary" type="button" onClick={() => onStep("verify")}><CameraIcon width={17} height={17} />Use camera</button><button className="onboarding-secondary" type="button" onClick={() => setPasteOpen((value) => !value)}><ClipboardIcon width={16} height={16} />Paste pairing code</button>{pasteOpen ? <div className="pairing-code"><KeyboardInput value={pairingCode} onChange={(event) => setPairingCode(event.currentTarget.value)} placeholder="Paste one-time code" aria-label="One-time pairing code" autoFocus /><button type="button" onClick={() => pairingCode.trim() && onStep("verify")} disabled={!pairingCode.trim()} aria-label="Continue with pairing code"><ArrowRightIcon width={17} height={17} /></button></div> : null}</div>
            </>
          ) : null}
          {step === "verify" ? (
            <>
              <div className="onboarding-copy compact"><span className="eyebrow">VERIFY · 3 OF 5</span><h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>Same words on both?</h1><p>Compare this short phrase with Luca on Riley’s Mac. Continue only when both match.</p></div>
              <div className="verification-phrase"><span>MICA</span><i>·</i><span>47</span></div>
              <div className="verification-boundary"><LockClosedIcon width={18} height={18} /><span><strong>Riley’s Mac</strong><small>One-time invitation · expires in 08:42</small></span></div>
              <div className="onboarding-actions"><button className="onboarding-primary" type="button" onClick={() => onStep("connecting")}><CheckIcon width={17} height={17} />They match</button><button className="onboarding-secondary" type="button" onClick={() => onStep("scan")}>Start again</button></div>
            </>
          ) : null}
          {step === "connecting" ? (
            <>
              <div className="connecting-mark"><WorkingMark size={58} active /></div>
              <div className="onboarding-copy centered"><span className="eyebrow">CONNECT · 4 OF 5</span><h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>Making one<br />trusted doorway.</h1><p>Verifying the relay, this phone, and Riley’s Mac.</p></div>
              <div className="connecting-ledger"><span>Mac identity <CheckIcon width={14} height={14} /></span><span>Mobile authorization <i /></span><span>Resident secrets <strong>remain on Mac</strong></span></div>
            </>
          ) : null}
          {step === "ready" ? (
            <>
              <div className="ready-mark"><CheckIcon width={24} height={24} /></div>
              <div className="onboarding-copy"><span className="eyebrow">READY · 5 OF 5</span><h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>Your network<br />is within reach.</h1><p>Luca and Vektor are available through Riley’s Mac. This phone can message them and answer exact permission requests.</p></div>
              <div className="ready-notifications"><BellIcon width={19} height={19} /><span><strong>Useful notifications</strong><small>Names and rooms only. Never message bodies.</small></span><button type="button" role="switch" aria-label="Allow useful notifications" aria-checked={notificationsEnabled} onClick={() => onNotifications(!notificationsEnabled)}><i className="quiet-switch" aria-hidden="true"><b /></i></button></div>
              <div className="onboarding-actions"><button className="onboarding-primary" type="button" onClick={onComplete}>Enter the room<ArrowRightIcon width={17} height={17} /></button></div>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}

function PermissionEvent({
  approval,
  onApproval,
  onApprovalEnd,
  onDecline,
}: {
  approval: number;
  onApproval: (value: number) => void;
  onApprovalEnd: () => void;
  onDecline: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const sliderStyle = { "--approval": approval } as CSSProperties;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <motion.section
      className="permission-event"
      data-testid="permission-event"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-title"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985, transformOrigin: "50% 19%" }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.992, transformOrigin: "50% 19%" }}
      transition={{ duration: reducedMotion ? 0.16 : 0.42, ease }}
    >
      <img src="/assets/luca-permission-field.jpg" alt="" aria-hidden="true" draggable={false} />
      <MobileScroll className="permission-scroll">
        <div className="permission-plane">
          <header className="permission-heading">
            <motion.span
              className="shared-mark permission-mark"
              layoutId={reducedMotion ? undefined : "resident-mark-vektor"}
              transition={{ duration: reducedMotion ? 0.16 : 0.42, ease }}
            >
              <WorkingMark size={38} active />
            </motion.span>
            <span className="eyebrow">VEKTOR · PERMISSION</span>
            <h1 id="permission-title" ref={headingRef} tabIndex={-1}>Review three launch files?</h1>
            <p>Vektor asked to read three named files on your Mac before completing the launch review.</p>
          </header>

          <section className="permission-ledger" aria-label="Permission scope">
            <div className="ledger-row"><span>resident</span><strong>Vektor</strong></div>
            <div className="ledger-row"><span>operation</span><strong>read selected files</strong></div>
            <div className="file-list" aria-label="Files included in this request">
              <span><FileIcon width={14} height={14} />Launch brief.md</span>
              <span><FileIcon width={14} height={14} />Onboarding notes.md</span>
              <span><FileIcon width={14} height={14} />Mobile handoff.md</span>
            </div>
            <div className="ledger-row authority-row"><span>authority</span><strong>this request only</strong></div>
          </section>

          <section className="approval-zone" aria-label="Permission decision">
            <label className="approval-control" style={sliderStyle}>
              <span className="approval-fill" aria-hidden="true" />
              <span className="approval-label">Slide to approve</span>
              <span
                className="approval-thumb"
                style={{ left: `calc(${approval}% - ${approval * 0.68}px + 5px)` }}
                aria-hidden="true"
              >
                <WorkingMark size={34} active />
              </span>
              <input
                data-testid="approval-control"
                type="range"
                min="0"
                max="100"
                value={approval}
                onInput={(event) => onApproval(Number(event.currentTarget.value))}
                onChange={(event) => onApproval(Number(event.currentTarget.value))}
                onPointerUp={onApprovalEnd}
                onTouchEnd={onApprovalEnd}
                onKeyUp={onApprovalEnd}
                aria-label="Slide to approve Vektor reading three selected files"
              />
            </label>
            <button className="decline-button" type="button" onClick={onDecline}>Decline request</button>
          </section>
        </div>
      </MobileScroll>
    </motion.section>
  );
}

export default function Prototype() {
  const initial = useMemo(sceneFixture, []);
  const keyboard = useKeyboard();
  const { bottomInset, isKeyboardVisible } = useKeyboardInsets();
  const [place, setPlace] = useState<PlaceId>(initial.place);
  const [roomMode, setRoomMode] = useState<RoomMode>("conversation");
  const [permission, setPermission] = useState<PermissionPhase>(initial.permission);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [recordHistory, setRecordHistory] = useState<RecordId[]>(initial.record ? [initial.record] : []);
  const [onboarding, setOnboarding] = useState<OnboardingStep>(initial.onboarding);
  const [connection, setConnection] = useState<ConnectionState>(initial.connection);
  const [activeResident, setActiveResident] = useState<ResidentId>(initial.resident);
  const [selectedResident, setSelectedResident] = useState<ResidentId>(initial.resident);
  const [, setStatement] = useState(initial.statement);
  const [messages, setMessages] = useState<ChatMessage[]>(() => seedMessages(initial.permission, initial.resident, initial.statement));
  const [draft, setDraft] = useState("");
  const [approval, setApproval] = useState(0);
  const [conversationSearch, setConversationSearch] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationPreview, setNotificationPreview] = useState<"names" | "generic" | "none">("names");
  const [screenShield, setScreenShield] = useState(true);
  const [activityStopped, setActivityStopped] = useState(false);
  const replyTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const holdActivated = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const selectedDetail = residents[selectedResident];
  const permissionOpen = permission === "open";
  const record = recordHistory.at(-1) ?? null;
  const sheetTitle = sheet === "resident"
    ? selectedDetail.name
    : sheet === "connection"
      ? "Mac connection"
      : sheet === "menu"
        ? "Luca Companion"
        : "Remove this phone?";

  useEffect(() => () => {
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const deviceScreen = document.querySelector<HTMLElement>('[data-testid="device-screen"]');
    const reset = () => { if (deviceScreen) deviceScreen.scrollTop = 0; };
    reset();
    const frame = window.requestAnimationFrame(reset);
    const timer = window.setTimeout(reset, 320);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [sheet]);

  useEffect(() => {
    if (place !== "room") return;
    const frame = window.requestAnimationFrame(() => {
      transcriptEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, place, roomMode, bottomInset]);

  const appendMessage = (message: Omit<ChatMessage, "id"> & { id?: string }) => {
    setMessages((current) => [...current, { ...message, id: message.id ?? nextMessageId(message.role) }]);
  };

  const enterRoom = (resident: ResidentId) => {
    keyboard.hide();
    setRecordHistory([]);
    setSheet(null);
    setActiveResident(resident);
    setRoomMode("conversation");
    if (permission === "idle") {
      const nextStatement = resident === "luca"
        ? "I’m here. Your conversations and identity remain connected through your Mac."
        : "I’m reviewing the launch plan on your Mac. Nothing needs you yet.";
      setStatement(nextStatement);
      setMessages(seedMessages("idle", resident, nextStatement));
    }
    setPlace("room");
  };

  const returnToNetwork = () => {
    if (permissionOpen) return;
    keyboard.hide();
    setRoomMode("conversation");
    setPlace("network");
  };

  const openRecord = (next: RecordId) => {
    keyboard.hide();
    const deviceScreen = document.querySelector<HTMLElement>('[data-testid="device-screen"]');
    if (deviceScreen) deviceScreen.scrollTop = 0;
    setSheet(null);
    setRecordHistory((history) => history.at(-1) === next ? history : [...history, next]);
  };

  const closeRecord = () => {
    keyboard.hide();
    setRecordHistory((history) => history.slice(0, -1));
  };

  const openSheet = (next: Exclude<SheetId, null>) => {
    keyboard.hide();
    setRoomMode("conversation");
    setSheet(next);
  };

  const openResident = (resident: ResidentId) => {
    setSelectedResident(resident);
    openSheet("resident");
  };

  const sendPrompt = (prompt: string) => {
    const body = prompt.trim();
    if (!body) return;
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    appendMessage({ role: "user", text: body, time: stamp });
    setDraft("");
    setRoomMode("conversation");
    keyboard.hide();
    setActiveResident("vektor");
    setStatement(processingStatement);
    appendMessage({
      role: "resident",
      resident: "vektor",
      kind: "status",
      text: processingStatement,
      time: "now",
    });
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    replyTimer.current = window.setTimeout(() => {
      setPermission("pending");
      setStatement(permissionRequest);
      setMessages((current) => {
        const withoutProcessing = current.filter((message) => message.text !== processingStatement);
        return [
          ...withoutProcessing,
          {
            id: nextMessageId("permission"),
            role: "resident",
            resident: "vektor",
            kind: "permission",
            text: permissionRequest,
            time: "now",
          },
        ];
      });
    }, 1500);
  };

  const beginOrb = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    holdActivated.current = false;
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdActivated.current = true;
      setRoomMode("listening");
      keyboard.hide();
    }, 180);
  };

  const endOrb = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released by the browser.
    }
    if (holdActivated.current) {
      holdActivated.current = false;
      sendPrompt(preparedPrompt);
      return;
    }
    // Short tap focuses the text field — ChatGPT-style primary text path.
    setRoomMode("conversation");
    window.requestAnimationFrame(() => {
      const textarea = document.getElementById("room-message") as HTMLTextAreaElement | null;
      textarea?.focus();
    });
  };

  const cancelOrb = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdActivated.current = false;
    setRoomMode("conversation");
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released by the browser.
    }
  };

  const openPermission = () => {
    if (permission === "pending" || permission === "open") {
      setPermission("open");
      setApproval(0);
    }
  };

  const openPermissionFromActivity = () => {
    keyboard.hide();
    setRecordHistory([]);
    setSheet(null);
    setPlace("room");
    setActiveResident("vektor");
    setStatement(permissionRequest);
    setPermission("open");
    setApproval(0);
    setMessages(seedMessages("pending", "vektor", permissionRequest));
    setRoomMode("conversation");
  };

  const approveIfComplete = (value = approval) => {
    if (value < 86) {
      setApproval(0);
      return;
    }
    if (permission === "approved") return;
    setApproval(100);
    setPermission("approved");
    setStatement(approvedStatement);
    setMessages((current) => {
      if (current.some((message) => message.text === approvedStatement)) return current;
      return [
        ...current.filter((message) => message.kind !== "permission" && message.text !== permissionRequest),
        {
          id: nextMessageId("approved"),
          role: "resident",
          resident: "vektor",
          text: approvedStatement,
          time: "now",
        },
      ];
    });
  };

  const declinePermission = () => {
    if (permission === "declined") return;
    setApproval(0);
    setPermission("declined");
    setStatement(declinedStatement);
    setMessages((current) => {
      if (current.some((message) => message.text === declinedStatement)) return current;
      return [
        ...current.filter((message) => message.kind !== "permission" && message.text !== permissionRequest),
        {
          id: nextMessageId("declined"),
          role: "resident",
          resident: "vektor",
          text: declinedStatement,
          time: "now",
        },
      ];
    });
  };

  return (
    <div
      className="luca-app"
      data-place={place}
      data-permission={permission}
      data-room-mode={roomMode}
      data-record={record ?? "none"}
      data-connection={connection}
      data-screen-shield={screenShield}
      data-testid="luca-mobile-prototype"
    >
      <div className="places-root" inert={record || onboarding ? true : undefined} aria-hidden={record || onboarding ? true : undefined}>
      <LayoutGroup id="luca-companion">
        <NetworkPlace
          activeResident={activeResident}
          permission={permission}
          visible={place === "network"}
          onEnterResident={enterRoom}
          onOpenResident={openResident}
          onConnection={() => openSheet("connection")}
          onOpenMenu={() => openSheet("menu")}
        />
        <RoomPlace
          activeResident={activeResident}
          permission={permission}
          mode={roomMode}
          messages={messages}
          draft={draft}
          bottomInset={bottomInset}
          visible={place === "room"}
          endRef={transcriptEndRef}
          onBack={returnToNetwork}
          onOpenPermission={openPermission}
          onDraft={setDraft}
          onSend={() => sendPrompt(draft)}
          onOrbDown={beginOrb}
          onOrbUp={endOrb}
          onOrbCancel={cancelOrb}
        />

        <AnimatePresence>
          {permissionOpen ? (
            <PermissionEvent
              approval={approval}
              onApproval={(value) => {
                setApproval(value);
                if (value >= 98) approveIfComplete(value);
              }}
              onApprovalEnd={() => approveIfComplete()}
              onDecline={declinePermission}
            />
          ) : null}
        </AnimatePresence>
      </LayoutGroup>
      </div>

      <AnimatePresence mode="wait">
        {record ? (
          <AppRecord
            key={record}
            record={record}
            permission={permission}
            connection={connection}
            search={conversationSearch}
            notificationsEnabled={notificationsEnabled}
            notificationPreview={notificationPreview}
            screenShield={screenShield}
            activityStopped={activityStopped}
            onBack={closeRecord}
            onOpenRecord={openRecord}
            onSearch={setConversationSearch}
            onEnterRoom={enterRoom}
            onOpenPermission={openPermissionFromActivity}
            onOpenConnection={() => openSheet("connection")}
            onNotifications={setNotificationsEnabled}
            onNotificationPreview={setNotificationPreview}
            onScreenShield={setScreenShield}
            onStopActivity={() => setActivityStopped(true)}
            onRemoveDevice={() => openSheet("remove-device")}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {onboarding ? (
          <OnboardingFlow
            step={onboarding}
            notificationsEnabled={notificationsEnabled}
            onStep={setOnboarding}
            onNotifications={setNotificationsEnabled}
            onComplete={() => {
              setConnection("available");
              setPlace("room");
              setOnboarding(null);
            }}
          />
        ) : null}
      </AnimatePresence>

      <BottomSheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        title={sheetTitle}
        description={
          sheet === "connection"
            ? "The phone is a secure surface for residents hosted by your Mac."
            : sheet === "resident"
              ? selectedDetail.role
              : sheet === "menu"
                ? "Records and settings for this companion phone."
                : "This removes companion access from this device."
        }
        snap={sheet === "menu" ? 0.62 : sheet === "remove-device" ? 0.52 : 0.5}
      >
        {sheet === "resident" ? (
          <div className="resident-sheet">
            <div className="resident-sheet-identity">
              <ResidentMark resident={selectedResident} size={46} working={selectedResident === "vektor" && permission !== "declined"} />
              <div><strong>{selectedDetail.state}</strong><span>{selectedDetail.detail}</span></div>
            </div>
            <dl>
              <div><dt>identity</dt><dd>{selectedDetail.fingerprint}</dd></div>
              <div><dt>host</dt><dd>Riley’s Mac</dd></div>
              <div><dt>runtime</dt><dd>{selectedResident === "luca" ? "Hermes · linked" : "OpenClaw · linked"}</dd></div>
            </dl>
            <button type="button" className="sheet-primary" onClick={() => { setSheet(null); enterRoom(selectedResident); }}>
              Enter the room<ArrowRightIcon width={17} height={17} />
            </button>
          </div>
        ) : null}
        {sheet === "connection" ? (
          <div className="connection-sheet">
            <div className="connection-state">{connection === "available" ? <LockClosedIcon width={22} height={22} /> : <ExclamationTriangleIcon width={22} height={22} />}<div><strong>{connection === "available" ? "Mac available" : connection === "offline" ? "Phone offline" : "Phone access removed"}</strong><span>{connection === "available" ? "paired · encrypted relay · identity verified" : connection === "offline" ? "cached rooms remain readable" : "pair again to reconnect"}</span></div></div>
            <dl>
              <div><dt>phone</dt><dd>this device</dd></div>
              <div><dt>residents</dt><dd>{connection === "available" ? "2 available" : "not reachable"}</dd></div>
              <div><dt>authority</dt><dd>signing stays on Mac</dd></div>
            </dl>
            <button type="button" className="sheet-primary" onClick={() => openRecord("devices")}>
              Manage paired devices<ArrowRightIcon width={17} height={17} />
            </button>
          </div>
        ) : null}
        {sheet === "menu" ? (
          <nav className="companion-menu" aria-label="Companion records">
            <RecordRow icon={<ReaderIcon width={18} height={18} />} title="Conversations" detail="Three rooms within reach" onClick={() => openRecord("conversations")} />
            <RecordRow icon={<ActivityLogIcon width={18} height={18} />} title="Activity" detail={permission === "pending" || permission === "open" ? "One decision needs you" : "Owner-visible work and outcomes"} meta={permission === "pending" || permission === "open" ? "1 new" : undefined} onClick={() => openRecord("activity")} />
            <RecordRow icon={<BellIcon width={18} height={18} />} title="Notifications" detail="Privacy-safe attention" onClick={() => openRecord("notifications")} />
            <RecordRow icon={<GearIcon width={18} height={18} />} title="Settings" detail="This phone and its pairing" onClick={() => openRecord("settings")} />
          </nav>
        ) : null}
        {sheet === "remove-device" ? (
          <div className="remove-device-sheet">
            <div className="removal-explanation"><MobileIcon width={22} height={22} /><p>Riley’s iPhone will lose Luca access and its cached conversation content will be removed. Residents on Riley’s Mac keep running.</p></div>
            <button className="confirm-removal" type="button" onClick={() => { setConnection("revoked"); setSheet(null); }}>Remove Luca access from this phone</button>
            <button className="cancel-removal" type="button" onClick={() => setSheet(null)}>Keep this phone paired</button>
          </div>
        ) : null}
      </BottomSheet>

      <span className="screen-reader-status" aria-live="polite">
        {isKeyboardVisible ? "Keyboard visible. " : ""}
        {roomMode === "listening" ? "Listening. Release to send. " : ""}
        {permission === "approved" ? approvedStatement : permission === "declined" ? declinedStatement : ""}
      </span>
    </div>
  );
}
