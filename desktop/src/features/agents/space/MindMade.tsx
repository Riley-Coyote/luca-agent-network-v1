import * as React from "react";
import { ChevronRight } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useArtifactCanvas } from "@/features/artifacts/ArtifactCanvasProvider";
import { useChannelsQuery } from "@/features/channels/hooks";
import type { ResidentPlaceView } from "./mindPlaceContext";
import { MadeThumb } from "./MadeThumb";
import type { MadePiece } from "./MindNotebook";
import { MindChips, MindPageHead, MindSection, NewDot } from "./MindPageKit";
import { isNewSince } from "./mindVisits";

/** "Yesterday", "Today", else the short date: a tile's when. */
export function madeWhen(at: number, now: number = Date.now()): string {
  if (!at) return "";
  const date = new Date(at);
  const start = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).valueOf();
  const days = Math.round((start(new Date(now)) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

/** A piece's one line: pinned, or on their own, or for you, and when. */
function pieceLine(piece: MadePiece, pinned: boolean): string {
  const who = pinned ? "Pinned" : piece.own ? "On their own" : "For you";
  const when = madeWhen(piece.at);
  return when ? `${who} · ${when}` : who;
}

/** Their Selected work comes first, as Pinned (Decided 7). */
export function pinnedFirst(
  pieces: readonly MadePiece[],
  place: ResidentPlaceView | null,
): { piece: MadePiece; pinned: boolean }[] {
  const pinnedId =
    place?.selectedWork?.availability === "available"
      ? place.selectedWork.artifactId
      : null;
  // The pinned piece is always theirs to show, even when the Library's
  // list hasn't reached it yet: drawn from the place's own record of it.
  const selected = place?.selectedWork;
  const pinned = pinnedId
    ? (pieces.find((piece) => piece.id === pinnedId) ??
      (selected
        ? {
            at: 0,
            conversationId: selected.conversationId,
            createdAt: "",
            currentVersion: selected.version,
            id: selected.artifactId,
            kind: selected.kind,
            own: true,
            summary: null,
            title: selected.title,
          }
        : undefined))
    : undefined;
  return [
    ...(pinned ? [{ piece: pinned, pinned: true }] : []),
    ...pieces
      .filter((piece) => piece !== pinned)
      .map((piece) => ({ piece, pinned: false })),
  ];
}

function Tile({
  fresh,
  line,
  onOpen,
  piece,
}: {
  fresh: boolean;
  line: string;
  onOpen: () => void;
  piece: MadePiece;
}) {
  const lineId = React.useId();
  return (
    <li>
      <button
        aria-describedby={lineId}
        aria-label={`Open ${piece.title}`}
        className="luca-mind-tile"
        data-new={fresh ? "true" : undefined}
        data-testid="mind-made-tile"
        onClick={onOpen}
        type="button"
      >
        <MadeThumb
          artifactId={piece.id}
          className="luca-mind-plate"
          kind={piece.kind}
          title={piece.title}
          version={piece.currentVersion}
        />
        <span className="luca-mind-tile-title">
          {fresh ? <NewDot /> : null}
          <span>{piece.title}</span>
        </span>
        <span className="luca-mind-tile-line" id={lineId}>
          {line}
        </span>
      </button>
    </li>
  );
}

/** Made by {name} (Decided 7): four even tiles, Pinned first, and the way
 *  to every piece. */
export function MindMadeSection({
  name,
  onOpenAll,
  onOpenPiece,
  pieces,
  place,
  settled,
  since,
}: {
  name: string;
  onOpenAll: () => void;
  onOpenPiece: (artifactId: string) => void;
  pieces: readonly MadePiece[];
  place: ResidentPlaceView | null;
  settled: boolean;
  since: number | null;
}) {
  const all = pinnedFirst(pieces, place);
  const ordered = all.slice(0, 4);
  return (
    <MindSection
      control={
        all.length > 0 ? (
          <button
            className="luca-mind-link"
            data-testid="mind-made-all"
            onClick={onOpenAll}
            type="button"
          >
            See all {all.length} <ChevronRight aria-hidden />
          </button>
        ) : null
      }
      testId="mind-made"
      title={`Made by ${name}`}
    >
      {ordered.length > 0 ? (
        <ul className="luca-mind-tiles" data-testid="mind-made-tiles">
          {ordered.map(({ piece, pinned }) => (
            <Tile
              fresh={isNewSince(piece.at, since)}
              key={piece.id}
              line={pieceLine(piece, pinned)}
              onOpen={() => onOpenPiece(piece.id)}
              piece={piece}
            />
          ))}
        </ul>
      ) : settled ? (
        <p
          className="luca-mind-help luca-mind-empty-line"
          data-testid="mind-made-empty"
        >
          What {name} makes will gather here: things they make on their own or
          for you.
        </p>
      ) : null}
    </MindSection>
  );
}

type MadeFilter = "all" | "own" | "you";

/** Made (Decided 7): every piece, three across, All · On their own · For
 *  you. */
export function MindMadePage({
  name,
  onBack,
  onOpenPiece,
  pieces,
  place,
  since,
  titleRef,
}: {
  name: string;
  onBack: () => void;
  onOpenPiece: (artifactId: string) => void;
  pieces: readonly MadePiece[];
  place: ResidentPlaceView | null;
  since: number | null;
  titleRef: React.Ref<HTMLHeadingElement>;
}) {
  const [filter, setFilter] = React.useState<MadeFilter>("all");
  const shown = pinnedFirst(pieces, place).filter(({ piece }) =>
    filter === "all" ? true : filter === "own" ? piece.own : !piece.own,
  );
  return (
    <div data-testid="mind-made-page">
      <MindPageHead
        back={name}
        lede={`Everything ${name} has made, newest first.`}
        onBack={onBack}
        title="Made"
        titleRef={titleRef}
      />
      <div className="luca-mind-made-bar">
        <MindChips<MadeFilter>
          label="Show"
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: pieces.length },
            {
              id: "own",
              label: "On their own",
              count: pieces.filter((piece) => piece.own).length,
            },
            {
              id: "you",
              label: "For you",
              count: pieces.filter((piece) => !piece.own).length,
            },
          ]}
          testIdPrefix="mind-made-filter"
          value={filter}
        />
      </div>
      {shown.length > 0 ? (
        <ul
          className="luca-mind-tiles luca-mind-tiles-three"
          data-testid="mind-made-grid"
        >
          {shown.map(({ piece, pinned }) => (
            <Tile
              fresh={isNewSince(piece.at, since)}
              key={piece.id}
              line={pieceLine(piece, pinned)}
              onOpen={() => onOpenPiece(piece.id)}
              piece={piece}
            />
          ))}
        </ul>
      ) : (
        <p className="luca-mind-help luca-mind-empty-line">
          {filter === "own"
            ? `Nothing ${name} made on their own yet.`
            : filter === "you"
              ? `Nothing ${name} made for you yet.`
              : `What ${name} makes will gather here.`}
        </p>
      )}
    </div>
  );
}

/** "Image", "Document": a piece's kind as a word. */
function kindWord(kind: string): string {
  if (kind === "markdown" || kind === "text") return "Document";
  if (kind === "html") return "Prototype";
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Work";
}

/**
 * A piece (Decided 7): its large picture, "{name} made this on their own
 * (or for you) · when · kind", their note on it and where it came from,
 * Open, and Show in Library.
 */
export function MindPiecePage({
  backLabel,
  name,
  onBack,
  piece,
  pinned,
  residentPubkey,
  titleRef,
}: {
  backLabel: string;
  name: string;
  onBack: () => void;
  piece: MadePiece | null;
  pinned: boolean;
  residentPubkey: string | null;
  titleRef: React.Ref<HTMLHeadingElement>;
}) {
  const { openArtifact } = useArtifactCanvas();
  const { goArtifacts } = useAppNavigation();
  const channels = useChannelsQuery();
  if (!piece)
    return (
      <div data-testid="mind-piece-page">
        <MindPageHead
          back={backLabel}
          lede="This piece is no longer in the Library."
          onBack={onBack}
          title="Not found"
          titleRef={titleRef}
        />
      </div>
    );
  const room = piece.conversationId
    ? channels.data?.find((channel) => channel.id === piece.conversationId)
        ?.name
    : null;
  const made = [
    `${name} made this ${piece.own ? "on their own" : "for you"}`,
    madeWhen(piece.at),
    kindWord(piece.kind),
  ]
    .filter(Boolean)
    .join(" · ");
  const from = [
    room ? `From ${room}` : null,
    pinned ? `Pinned to ${name}'s page` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div data-testid="mind-piece-page">
      <MindPageHead
        back={backLabel}
        lede={made}
        onBack={onBack}
        title={piece.title}
        titleRef={titleRef}
      />
      <MadeThumb
        artifactId={piece.id}
        className="luca-mind-plate luca-mind-plate-large"
        kind={piece.kind}
        title={piece.title}
        version={piece.currentVersion}
      />
      {piece.summary?.trim() ? (
        <p className="luca-mind-piece-note" data-testid="mind-piece-note">
          {piece.summary}
        </p>
      ) : null}
      {from ? (
        <p className="luca-mind-meta luca-mind-piece-from">{from}</p>
      ) : null}
      <div className="luca-mind-actions">
        <button
          className="luca-mind-button"
          data-testid="mind-piece-open"
          onClick={() =>
            openArtifact({
              artifactId: piece.id,
              conversationId: piece.conversationId,
              previewSessionId: null,
              residentPubkey,
              source: "library",
              turnId: null,
              version: piece.currentVersion,
            })
          }
          type="button"
        >
          Open
        </button>
        <button
          className="luca-mind-button"
          data-testid="mind-piece-library"
          onClick={() => void goArtifacts()}
          type="button"
        >
          Show in Library
        </button>
      </div>
    </div>
  );
}
