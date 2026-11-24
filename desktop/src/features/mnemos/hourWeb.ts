/**
 * What an hour that went online read and searched, as Hours shows it under
 * the opened hour (Mnemos `room.js` `webHTML`). Every word is the hour's
 * own, kept as text: a page is shown by its host and path, with its whole
 * address to open; an address that isn't `http` or `https` is shown as
 * written and opens nothing.
 */
import type { BookHourWeb } from "./book";

/** One page it read: what is shown, and the address to open, if any. */
export type WebPage = {
  /** The address as the hour wrote it. */
  written: string;
  /** Its host and path, or the address as written. */
  shown: string;
  /** The whole address to open outside the app; null for one that isn't
   *  `http` or `https`. */
  href: string | null;
};

/** One address it read, by the notebook's rule. */
export function webPage(written: string): WebPage {
  let url: URL | null = null;
  try {
    url = new URL(written);
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol))
    return { written, shown: written, href: null };
  return {
    written,
    shown: url.host + (url.pathname === "/" ? "" : url.pathname),
    href: url.href,
  };
}

/** What it read and searched; empty when it recorded nothing. */
export function webOfHour(web: BookHourWeb): {
  read: WebPage[];
  searched: string[];
} {
  return { read: web.read.map(webPage), searched: web.searched };
}
