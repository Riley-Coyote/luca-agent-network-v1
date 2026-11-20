import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import "./mnemos-board.css";

import { kindWords, when } from "./boardWords";
import { type Picture, stepTo } from "./glance/boardFacts";
import type { NotebookView } from "./roomKit";

/** A picture's address, read once through the notebook (only a path its
 *  engine listed); `failed` when it can't be read. */
function usePictureUrl(
  picture: NotebookView["picture"],
  path: string,
): { url: string | null; failed: boolean } {
  const [state, setState] = React.useState<{
    path: string;
    url: string | null;
    failed: boolean;
  }>({ path, url: null, failed: false });
  React.useEffect(() => {
    if (!path) return;
    let current = true;
    picture(path).then(
      (url) => {
        if (current) setState({ path, url, failed: url === null });
      },
      () => {
        if (current) setState({ path, url: null, failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, [picture, path]);
  return state.path === path ? state : { url: null, failed: false };
}

/** A picture's when, and the hour that made it, in a few words. */
const madeWords = (p: Picture, now: Date) => when(p.at, now);

/** Small thumbnails of pictures; each opens large. */
export function Thumbs({
  notebook,
  onOpen,
  pictures,
  testId,
}: {
  notebook: NotebookView;
  onOpen: (index: number, opener: HTMLElement) => void;
  pictures: Picture[];
  testId: string;
}) {
  const now = new Date();
  return (
    <ul className="luca-mnemos-thumbs" data-testid={testId}>
      {pictures.map((p, i) => (
        <li key={p.path}>
          <button
            aria-label={`${p.name}, ${madeWords(p, now)}. Open it`}
            className="luca-mnemos-thumb"
            data-testid={`${testId}-${i}`}
            onClick={(event) => onOpen(i, event.currentTarget)}
            type="button"
          >
            <Thumb notebook={notebook} picture={p} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thumb({
  notebook,
  picture,
}: {
  notebook: NotebookView;
  picture: Picture;
}) {
  const { url, failed } = usePictureUrl(notebook.picture, picture.path);
  if (failed)
    return (
      <span className="luca-mnemos-thumb-none text-2xs">{picture.name}</span>
    );
  return url ? <img alt="" draggable={false} src={url} /> : null;
}

/** The picture opened, while one is. */
export type OpenPicture = {
  pictures: Picture[];
  index: number;
  opener: HTMLElement | null;
};

/** Which picture is open in a room, and the way back to what opened it. */
export function usePictureView() {
  const [open, setOpen] = React.useState<OpenPicture | null>(null);
  const show = React.useCallback(
    (pictures: Picture[], index: number, opener: HTMLElement | null) =>
      setOpen({ pictures, index, opener }),
    [],
  );
  const close = React.useCallback(() => {
    setOpen((was) => {
      // Focus goes back to the thumbnail that opened it, once it shows.
      const opener = was?.opener;
      if (opener)
        requestAnimationFrame(() => {
          if (opener.isConnected) opener.focus();
        });
      return null;
    });
  }, []);
  const step = React.useCallback(
    (delta: number) =>
      setOpen((was) =>
        was
          ? { ...was, index: stepTo(was.index, delta, was.pictures.length) }
          : was,
      ),
    [],
  );
  return { open, show, close, step };
}

/**
 * A picture opened large inside the card (WP-49, Decided 7): the page
 * stays. Its name, when, and the hour that made it when the notebook says
 * (which opens that hour). Escape and the back arrow close it; the arrow
 * keys step through. One that can't be read shows its name and one quiet
 * line, never a broken image.
 */
export function PictureView({
  backLabel,
  notebook,
  onClose,
  onOpenHour,
  onStep,
  open,
}: {
  backLabel: string;
  notebook: NotebookView;
  onClose: () => void;
  onOpenHour: (hour: string) => void;
  onStep: (delta: number) => void;
  open: OpenPicture;
}) {
  const root = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    root.current?.focus();
  }, []);
  // At either end, that step button goes quiet and the browser drops its
  // focus; it comes back to the picture, so the keys still step.
  React.useEffect(() => {
    if (open.index < 0) return;
    const at = document.activeElement;
    if (
      at === document.body ||
      (at instanceof HTMLButtonElement && at.disabled)
    )
      root.current?.focus();
  }, [open.index]);
  const p = open.pictures[open.index];
  const { url, failed } = usePictureUrl(notebook.picture, p?.path ?? "");
  if (!p) return null;
  const now = new Date();
  const first = open.index === 0;
  const last = open.index === open.pictures.length - 1;
  return (
    <section
      aria-label={`${p.name}, a picture it made`}
      className="luca-mnemos-picture"
      data-testid="mnemos-picture"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === "ArrowLeft" && !first) {
          event.preventDefault();
          onStep(-1);
        } else if (event.key === "ArrowRight" && !last) {
          event.preventDefault();
          onStep(1);
        }
      }}
      ref={root}
      tabIndex={-1}
    >
      <div className="luca-mnemos-picture-top">
        <button
          className="luca-mnemos-back text-sm"
          data-testid="mnemos-picture-back"
          onClick={onClose}
          type="button"
        >
          <ChevronLeft aria-hidden />
          {backLabel}
        </button>
        {open.pictures.length > 1 ? (
          <span className="luca-mnemos-steps">
            <button
              aria-label="The one before"
              className="luca-mnemos-step"
              data-testid="mnemos-picture-before"
              disabled={first}
              onClick={() => onStep(-1)}
              type="button"
            >
              <ChevronLeft aria-hidden />
            </button>
            <span
              aria-live="polite"
              className="text-2xs tabular-nums"
              data-testid="mnemos-picture-step"
            >
              {open.index + 1} of {open.pictures.length}
            </span>
            <button
              aria-label="The next one"
              className="luca-mnemos-step"
              data-testid="mnemos-picture-next"
              disabled={last}
              onClick={() => onStep(1)}
              type="button"
            >
              <ChevronRight aria-hidden />
            </button>
          </span>
        ) : null}
      </div>
      <figure className="luca-mnemos-picture-figure">
        <div className="luca-mnemos-picture-frame">
          {failed ? (
            <p
              className="luca-mnemos-quiet text-sm"
              data-testid="mnemos-picture-unread"
            >
              This picture couldn’t be read.
            </p>
          ) : url ? (
            <img
              alt={p.name}
              data-testid="mnemos-picture-img"
              draggable={false}
              src={url}
            />
          ) : null}
        </div>
        <figcaption className="luca-mnemos-picture-caption">
          <span className="text-sm" data-testid="mnemos-picture-name">
            {p.name}
          </span>
          <span className="luca-mnemos-quiet text-xs">
            {madeWords(p, now)}
            {p.hour ? (
              <>
                {" · made in "}
                <button
                  className="luca-mnemos-link"
                  data-testid="mnemos-picture-hour"
                  onClick={() => p.hour && onOpenHour(p.hour.id)}
                  type="button"
                >
                  {kindWords(p.hour.kind)}, {when(p.hour.start, now)}
                </button>
              </>
            ) : null}
          </span>
        </figcaption>
      </figure>
    </section>
  );
}
