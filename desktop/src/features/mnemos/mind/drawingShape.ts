/**
 * One memory, as the notebook's herbarium reads it (Mnemos
 * `shared/specimens.js`, `herbariumOf`), from that memory alone: its own
 * fields, and a spine for each of its own links. Pure, so the shape and the
 * words said for it are tested here; `MemoryDrawing.tsx` hands the shape to
 * the copied herbarium to draw.
 */
import type { BookMemory } from "../book";
import { plural } from "../notebookWords";

/** A cell, in the fields the herbarium's specimen reads. */
export type HerbariumCell = {
  id: string;
  i: number;
  lesson: boolean;
  strength: number;
  stability: number;
  accessibility: number;
  accessCount: number;
  state: string;
  bornT: number;
  /** Its links, each with the other end left out (only this memory is
   *  given). */
  inc: HerbariumLink[];
  links: number;
};

export type HerbariumLink = {
  li: number;
  s: number;
  t: number;
  rel: string;
  w: number;
  bornT: number;
};

/** A memory tied to hundreds is drawn with its strongest (the herbarium's
 *  own limit); the words say how many. */
const MOST_SPINES = 64;

/** The memory as the herbarium's model: one cell, its links its spines. A
 *  link from it ends at -1 (another memory, not drawn); one to it starts
 *  there. */
export function cellOfMemory(memory: BookMemory): HerbariumCell {
  const inc: HerbariumLink[] = (memory.ties ?? []).map(
    ([, rel, w, born, , out], k) => ({
      li: k + 1,
      s: out === 1 ? 0 : -1,
      t: out === 1 ? -1 : 0,
      rel,
      w,
      bornT: born ? Date.parse(born) : Number.NaN,
    }),
  );
  const links = inc.length;
  const strongest =
    links > MOST_SPINES
      ? inc
          .slice()
          .sort(
            (a, b) =>
              Number(b.rel === "distilled_into") -
                Number(a.rel === "distilled_into") || b.w - a.w,
          )
          .slice(0, MOST_SPINES)
      : inc;
  return {
    id: memory.id,
    i: 0,
    lesson: memory.lesson === true,
    strength: memory.strength ?? 0.5,
    stability: memory.stability ?? 0.5,
    accessibility: memory.acc ?? 0,
    accessCount: memory.recalls ?? 0,
    state: memory.state,
    bornT: memory.born ? Date.parse(memory.born) : Number.NaN,
    inc: strongest,
    links,
  };
}

/** What the drawing shows, said plainly (the herbarium's `lifeWords`, for
 *  a memory drawn alone). */
export function drawingWords(memory: BookMemory): string {
  const cell = cellOfMemory(memory);
  const parts = [cell.lesson ? "A lesson" : "An experience"];
  parts.push(
    cell.links ? `with ${plural(cell.links, "link")}` : "tied to nothing yet",
  );
  if (cell.accessCount > 0)
    parts.push(`come back ${plural(cell.accessCount, "time")}`);
  if (memory.state === "dormant") parts.push("gone quiet");
  return parts.join(", ");
}
