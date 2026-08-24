/**
 * Plain language for a backend that answered badly.
 *
 * The relay's own words are engineering words. `relay.rs` formats every failed
 * HTTP call as `relay returned {status}: {message}`, and the relay's router
 * fills that message with its internals — the nine-hour dead-backend session
 * put this in front of the owner, verbatim, in red, three lines tall:
 *
 *   relay returned 404 Not Found: relay: no community is configured for this host
 *
 * There is nothing in that sentence a person can act on, and two things in it
 * that shouldn't be on screen at all: an HTTP status and the relay's internal
 * vocabulary. Meanwhile the same app says "Resident unavailable · Check its
 * setup" when a message fails — the two were held to different standards only
 * because one of them was written and the other was leaked.
 *
 * So: match on the shapes the backend actually emits (each case below names
 * its producer), and say what is wrong and what to do. Anything unrecognised
 * falls through to a truthful generic rather than to the raw string — a wrong
 * guess about the cause is worse than admitting we only know the effect.
 */
export type ConnectionStatusCopy = {
  /** What is wrong, in the owner's terms. Never a status code. */
  title: string;
  /** The one thing worth doing about it. */
  detail: string;
};

const GENERIC: ConnectionStatusCopy = {
  title: "Can't load your conversations",
  detail: "Retry, or check the community in Settings.",
};

export function describeConnectionError(
  errorMessage: string | undefined,
): ConnectionStatusCopy {
  if (!errorMessage) {
    return GENERIC;
  }

  const message = errorMessage.toLowerCase();

  // `buzz-relay/src/router.rs` — the host resolves to no community. The app is
  // pointed at a server that is up and simply does not host this community, so
  // reconnecting cannot help; the address is the thing to look at.
  if (message.includes("no community is configured")) {
    return {
      title: "This community isn't on that server",
      detail: "Check the address in Settings, then retry.",
    };
  }

  // NIP-42 auth rejection. Retrying the same credentials will not clear it.
  if (
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("401") ||
    message.includes("403")
  ) {
    return {
      title: "The server refused this account",
      detail: "Sign in again from Settings, then retry.",
    };
  }

  // `relay.rs` arms the rate-limit gate and returns this prefix. The quota
  // window expires on its own, so the honest instruction is to wait.
  if (message.includes("rate-limited") || message.includes("429")) {
    return {
      title: "Too many requests",
      detail: "This clears on its own. Retry in a moment.",
    };
  }

  // 5xx, or `MALFORMED_RESPONSE_MESSAGE` from `relay.rs`: the server is there
  // and is not well. Nothing local is wrong and nothing local is lost.
  if (
    message.includes("malformed response") ||
    /\b5\d{2}\b/.test(errorMessage)
  ) {
    return {
      title: "The server is having trouble",
      detail: "Nothing is lost. Retry in a moment.",
    };
  }

  return GENERIC;
}
