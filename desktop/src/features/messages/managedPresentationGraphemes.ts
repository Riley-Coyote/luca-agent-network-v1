let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  return segmenter;
}

/** Splits streamed public text without slicing surrogate pairs or graphemes. */
export function segmentManagedPresentationText(text: string): string[] {
  const activeSegmenter = getSegmenter();
  if (!activeSegmenter) return Array.from(text);
  return [...activeSegmenter.segment(text)].map(({ segment }) => segment);
}

export function managedPresentationDrainQuota(backlog: number): number {
  if (backlog <= 16) return 2;
  if (backlog <= 34) return 4;
  return 7;
}
