/** Window-local, bounded playback memory. No transcript text is retained. */
export class InkGestureLedger {
  private readonly seen = new Set<string>();
  private readonly limit: number;

  constructor(limit = 2000) {
    this.limit = limit;
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }

  mark(key: string): void {
    this.seen.delete(key);
    this.seen.add(key);
    while (this.seen.size > this.limit) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }

  replay(key: string): void {
    this.seen.delete(key);
  }

  clear(): void {
    this.seen.clear();
  }
}

export function inkGestureKey(
  scope: string,
  index: number,
  words: string,
  motion: string,
  pressure: string,
): string {
  let hash = 2166136261;
  for (const char of `${motion}\0${pressure}\0${words}`)
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  return `${scope}:${index}:${(hash >>> 0).toString(16)}`;
}
