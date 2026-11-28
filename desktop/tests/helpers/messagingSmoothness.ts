import { expect, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "./bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "./features";

/** The conversation the smoothness checks run in, and the one they switch to. */
export const GENERAL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
export const RANDOM_ID = "9dae0116-799b-5071-a0a8-fdd30a91a35d";
export const RESIDENT = TEST_IDENTITIES.alice.pubkey;
const PRESENTATION_EVENT = "luca://managed-presentation";

const PROSE = [
  "The draft makes one real claim, that the questions felt calibrated rather than scripted, and everything else in the piece is context that is doing more work than it should.",
  "When the reader reaches the second section they already suspect the answer, so the paragraph that names it has to earn its place by saying something new.",
  "A good revision keeps the order of the argument and changes only the weight of each sentence, which is slower than rewriting but leaves the voice intact.",
];

/** A reply holding prose, emphasis, a link, code, a list, a table and a coloured phrase. */
export function smoothnessReply(sections: number): string {
  return Array.from({ length: sections }, (_, index) => {
    const k = index + 1;
    return [
      `Part ${k} opens. ${PROSE[k % 3]}`,
      `${PROSE[(k + 1) % 3]} The **important point** stays short. See the [style notes](https://example.com/notes/${k}).`,
      "```ts\nconst calibrated = questions.filter((q) => q.honest);\nexport default calibrated;\n```",
      `- first item ${k}\n- second item with \`inline code\``,
      `| Part | Words |\n| --- | --- |\n| ${k} | 120 |`,
      `[A warm phrase lands here](color:warmth~care) before part ${k} closes.`,
    ].join("\n\n");
  }).join("\n\n");
}

/** History rows of every ordinary kind, oldest first. */
function historyRows(count: number) {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: count }, (_, i) => {
    const kinds = [
      `History ${i}: a short ordinary line.`,
      `History ${i}: ${PROSE[i % 3]} ${PROSE[(i + 1) % 3]}`,
      `History ${i} code:\n\n\`\`\`ts\nconst value = ${i};\n\`\`\``,
      `History ${i} list:\n\n- one point\n- another with **bold**`,
      `History ${i} table:\n\n| A | B |\n| --- | --- |\n| ${i} | two |`,
      `History ${i} has a [link to notes](https://example.com/h/${i}).`,
      `History ${i}: [a warm phrase here](color:warmth~care) and plain words.`,
    ];
    return {
      content: kinds[i % kinds.length] as string,
      createdAt: now - (count - i) * 60 - 3600,
      id: `smooth${String(i).padStart(4, "0")}`.padEnd(64, "0"),
      pubkey: i % 2 === 0 ? RESIDENT : undefined,
    };
  });
}

async function waitLive(page: Page, channelName: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          (name) =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: name,
            }) ?? false,
          channelName,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Open a room in the redesigned shell by its row in the side rail. */
export async function openRoom(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}(,|$)`) })
    .first()
    .click();
  await waitLive(page, name);
}

/**
 * Boot the real app on the mock bridge with the new look on, a resident in
 * #general and #random, and `history` earlier messages in #general.
 */
export async function bootSmoothness(
  page: Page,
  options: { history?: number; openGeneral?: boolean } = {},
) {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
    localStorage.setItem("buzz-theme", "obsidian");
    localStorage.setItem("buzz-follow-system", "false");
  }, FEATURE_OVERRIDES_STORAGE_KEY);
  await page.addInitScript(installFrameSampler);
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general", "random"],
        name: "Claude Code",
        pubkey: RESIDENT,
        status: "running",
      },
    ],
    searchProfiles: [
      { displayName: "Claude Code", isAgent: true, pubkey: RESIDENT },
    ],
  });
  await page.goto(`/?e2e=mock#/channels/${RANDOM_ID}`);
  await waitLive(page, "random");
  const history = options.history ?? 0;
  if (history > 0) {
    await page.evaluate((rows) => {
      for (const row of rows) {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: row.content,
          createdAt: row.createdAt,
          id: row.id,
          pubkey: row.pubkey,
        });
      }
    }, historyRows(history));
  }
  if (options.openGeneral !== false) await openRoom(page, "general");
  await expect(page.getByTestId("message-input")).toHaveAttribute(
    "contenteditable",
    "true",
    { timeout: 30_000 },
  );
}

/** Send from the composer; returns the owner event id the reply answers. */
export async function sendFromComposer(page: Page, text: string) {
  await page.getByTestId("message-input").fill(text);
  await page.getByTestId("send-message").click();
  const row = page.getByTestId("message-row").filter({ hasText: text }).last();
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-message-id");
  if (!id) throw new Error("The sent message has no event id.");
  return id;
}

/**
 * Deliver a reply the way the app receives one: presentation frames whose
 * public text arrives in uneven pieces, cut wherever they fall, then the
 * signed final message.
 */
export async function deliverReply(
  page: Page,
  receiptId: string,
  text: string,
  target: { channelId: string; resident: string } | null = null,
) {
  await page.evaluate(
    async ({ claude, event, receipt, reply, channel }) => {
      const sizes = [23, 7, 41, 13, 31, 5, 53, 17];
      let sequence = 0;
      const emit = (kind: string, chunk?: string) => {
        sequence += 1;
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(event, {
          protocol: "luca.managed.presentation.v1",
          kind,
          resident_pubkey: claude,
          conversation_id: channel,
          turn_id: `smooth-${receipt.slice(0, 8)}`,
          dispatch_receipt_id: receipt,
          session_epoch: 7,
          sequence,
          ...(chunk ? { public_chunk: chunk } : {}),
        });
      };
      emit("turn_started");
      for (let at = 0, i = 0; at < reply.length; i += 1) {
        const size = sizes[i % sizes.length] as number;
        emit("public_chunk", reply.slice(at, at + size));
        at += size;
        await new Promise((resolve) => setTimeout(resolve, 33));
      }
      emit("completed");
    },
    {
      channel: target?.channelId ?? GENERAL_ID,
      claude: target?.resident ?? RESIDENT,
      event: PRESENTATION_EVENT,
      receipt: receiptId,
      reply: text,
    },
  );
  if (!target) {
    const row = page.locator("[data-managed-response-ui-key]").last();
    await expect(row).toHaveAttribute("data-managed-response-ui-key", /.+/);
  } else {
    // Let the last pieces drain before the signed message arrives.
    await page.waitForTimeout(900);
  }
  await page.evaluate(
    ({ id, parent, pubkey, content, channelId }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        ...(channelId ? { channelId } : { channelName: "general" }),
        content,
        id,
        parentEventId: parent,
        pubkey,
        extraTags: [
          ["broadcast", "1"],
          ["luca-managed-dispatch", parent],
        ],
      });
    },
    {
      channelId: target?.channelId ?? null,
      content: text,
      id: `smoothfinal${receiptId.slice(0, 8)}`.padEnd(64, "f"),
      parent: receiptId,
      pubkey: target?.resident ?? RESIDENT,
    },
  );
}

/** One painted frame of the conversation, read after the frame was drawn. */
export type SmoothFrame = {
  /** Pixels between the bottom of the view and the end of the conversation. */
  dist: number;
  top: number;
  rows: number;
  /** Largest stretch of the view, in px, that no row covers. */
  gap: number;
  /** Viewport top of the watched row, when one is watched. */
  anchorTop: number | null;
  /** Viewport top of each visible row by its key. */
  keys: Record<string, number>;
  /** Ids of the visible messages. */
  ids: string[];
  header: string;
  /** Milliseconds since the last wheel input. */
  sinceWheel: number;
};

/** Installed before the app boots; idle until `startFrames`. */
function installFrameSampler() {
  type State = {
    frames: unknown[];
    on: boolean;
    anchor: string | null;
    wheelAt: number;
  };
  const state: State = { frames: [], on: false, anchor: null, wheelAt: -1e9 };
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const sc = document.querySelector<HTMLElement>(
      '[data-testid="message-timeline"]',
    );
    if (!sc) return;
    const rect = sc.getBoundingClientRect();
    const keys: Record<string, number> = {};
    const spans: [number, number][] = [];
    for (const row of sc.querySelectorAll<HTMLElement>(
      "[data-timeline-item-key]",
    )) {
      const box = row.getBoundingClientRect();
      if (box.bottom <= rect.top || box.top >= rect.bottom) continue;
      keys[row.dataset.timelineItemKey ?? ""] = box.top - rect.top;
      spans.push([
        Math.max(box.top, rect.top),
        Math.min(box.bottom, rect.bottom),
      ]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let cursor = rect.top;
    let gap = 0;
    for (const [from, to] of spans) {
      if (from > cursor) gap = Math.max(gap, from - cursor);
      cursor = Math.max(cursor, to);
    }
    const anchor = state.anchor
      ? sc.querySelector<HTMLElement>(
          `[data-timeline-item-key="${CSS.escape(state.anchor)}"]`,
        )
      : null;
    state.frames.push({
      dist: sc.scrollHeight - sc.clientHeight - sc.scrollTop,
      top: sc.scrollTop,
      rows: spans.length,
      gap,
      anchorTop: anchor ? anchor.getBoundingClientRect().top - rect.top : null,
      keys,
      ids: Array.from(sc.querySelectorAll<HTMLElement>("[data-message-id]"))
        .filter((row) => {
          const box = row.getBoundingClientRect();
          return box.bottom > rect.top && box.top < rect.bottom;
        })
        .map((row) => row.dataset.messageId ?? ""),
      header: document.querySelector("h1")?.textContent ?? "",
      sinceWheel: performance.now() - state.wheelAt,
    });
  };
  const loop = () => {
    if (!state.on) return;
    channel.port2.postMessage(0);
    requestAnimationFrame(loop);
  };
  window.addEventListener(
    "wheel",
    () => {
      state.wheelAt = performance.now();
    },
    { capture: true, passive: true },
  );
  Object.assign(window, {
    __smoothFrames: {
      start(anchor: string | null) {
        state.frames = [];
        state.anchor = anchor;
        state.on = true;
        requestAnimationFrame(loop);
      },
      stop() {
        state.on = false;
        return state.frames;
      },
    },
  });
}

type SamplerWindow = {
  __smoothFrames: {
    start: (anchor: string | null) => void;
    stop: () => SmoothFrame[];
  };
};

export async function startFrames(page: Page, anchorKey: string | null = null) {
  await page.evaluate(
    (key) => (window as unknown as SamplerWindow).__smoothFrames.start(key),
    anchorKey,
  );
}

export async function stopFrames(page: Page): Promise<SmoothFrame[]> {
  return page.evaluate(() =>
    (window as unknown as SamplerWindow).__smoothFrames.stop(),
  );
}

/** Scroll the conversation with real wheel input over its middle. */
export async function wheelConversation(
  page: Page,
  deltaY: number,
  times: number,
  pauseMs = 50,
) {
  const box = await page.getByTestId("message-timeline").boundingBox();
  if (!box) throw new Error("The conversation has no box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < times; i += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(pauseMs);
  }
}

/** The key of the first row whose top is at least `inset` px into the view. */
export async function rowKeyNearTop(page: Page, inset = 80) {
  return page.evaluate((offset) => {
    const sc = document.querySelector<HTMLElement>(
      '[data-testid="message-timeline"]',
    );
    if (!sc) return null;
    const top = sc.getBoundingClientRect().top;
    const row = Array.from(
      sc.querySelectorAll<HTMLElement>("[data-timeline-item-key]"),
    ).find(
      (candidate) => candidate.getBoundingClientRect().top >= top + offset,
    );
    return row?.dataset.timelineItemKey ?? null;
  }, inset);
}

/**
 * A reply that writes every kind of formatting a reply can hold: emphasis of
 * each kind, strike-through, a spoiler, inline code, a link, a code block
 * straight under a line, a list straight under a line, a list, a table, an
 * optional picture and a coloured phrase. Its prose holds none of those
 * characters, so any of them seen as text is markup shown before it is drawn.
 */
export function everyKindReply(sections: number, picture?: string): string {
  return Array.from({ length: sections }, (_, index) => {
    const k = index + 1;
    return [
      `Part ${k} opens with **an important point** and *a softer one*, then _another_ and __a strong one__. ${PROSE[k % 3]}`,
      `${PROSE[(k + 1) % 3]} The old plan is ~~withdrawn now~~ and ||the ending stays hidden|| for later.`,
      `Use \`repo_read\` and see the [style notes](https://example.com/notes/${k}) before ${PROSE[(k + 2) % 3]}`,
      `Here is the code for part ${k}:\n\`\`\`ts\nconst calibrated${k} = questions.filter((q) => q.honest);\nconst label = \`part ${k}\`;\nexport default calibrated${k};\n\`\`\``,
      `Steps for part ${k}:\n1. Open **the file** first.\n2. Then run \`check\` once.`,
      `- first item ${k}\n- second item with \`inline code\``,
      `| Part | Words |\n| --- | --- |\n| ${k} | **120** |`,
      ...(picture ? [`![](${picture})`] : []),
      `[A warm phrase lands here](color:warmth~care) before part ${k} closes.`,
    ].join("\n\n");
  }).join("\n\n");
}

type MarkupWindow = { __markupSeen: { seen: string[]; on: boolean } };

/**
 * After every painted frame, read the newest reply's unfinished end (its last
 * blocks, outside code) and keep any frame that shows markup as text.
 */
export async function watchMarkupShown(
  page: Page,
  surface: "conversation" | "mini",
) {
  await page.evaluate((where) => {
    const RAW =
      /\*|__|~~|\|\||`|\[|\]|\||(^|\s)_\S|(^|\n)\s*(?:[-+]|\d+[.)])\s|(^|\n)#{1,6}\s/;
    const state = { seen: [] as string[], on: true };
    (window as unknown as MarkupWindow).__markupSeen = state;
    const prose = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
      if (!(node instanceof Element)) return "";
      if (node.matches("pre, code, [data-code-block]")) return "";
      return Array.from(node.childNodes).map(prose).join("");
    };
    const root = () => {
      if (where === "mini") {
        const replies = document.querySelectorAll(
          ".qc-message:not(.qc-owner) .message-markdown",
        );
        return replies[replies.length - 1] ?? null;
      }
      const replies = document.querySelectorAll(
        "[data-managed-response-ui-key] .message-markdown",
      );
      return replies[replies.length - 1] ?? null;
    };
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const md = root();
      if (!md) return;
      const text = Array.from(md.children).slice(-4).map(prose).join("\n");
      if (RAW.test(text)) state.seen.push(text.slice(-80));
    };
    const loop = () => {
      if (!state.on) return;
      channel.port2.postMessage(0);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, surface);
}

export async function stopMarkupShown(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = (window as unknown as MarkupWindow).__markupSeen;
    state.on = false;
    return state.seen;
  });
}

export type CodeBlockWatch = {
  /** Whether the first frame showing the sentinel line showed it in a code block. */
  firstSeenInBlock: boolean | null;
  /** Frames the open block showed syntax colours before it closed. */
  colouredWhileOpen: number;
  /** Each time the drawn block was replaced: how far its lines moved. */
  swaps: { lines: number; maxDy: number }[];
};

type CodeWindow = {
  __codeWatch: CodeBlockWatch & { on: boolean };
};

/**
 * After every painted frame, follow the code block whose code holds
 * `sentinel`: whether its first line ever showed outside a code block, and
 * how far its lines moved, relative to the reply, when it was redrawn.
 */
export async function watchCodeBlock(page: Page, sentinel: string) {
  await page.evaluate((needle) => {
    const ids = new WeakMap<Element, number>();
    let nextId = 1;
    let last: { id: number; tops: number[] } | null = null;
    const state: CodeBlockWatch & { on: boolean } = {
      colouredWhileOpen: 0,
      firstSeenInBlock: null,
      on: true,
      swaps: [],
    };
    (window as unknown as CodeWindow).__codeWatch = state;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const replies = document.querySelectorAll(
        "[data-managed-response-ui-key] .message-markdown",
      );
      const md = replies[replies.length - 1];
      if (!md || !(md.textContent ?? "").includes(needle)) return;
      const block = Array.from(md.querySelectorAll("[data-code-block]")).find(
        (candidate) => (candidate.textContent ?? "").includes(needle),
      );
      if (state.firstSeenInBlock === null) state.firstSeenInBlock = !!block;
      if (!block) return;
      if (!ids.has(block)) ids.set(block, nextId++);
      const id = ids.get(block) as number;
      const origin = md.getBoundingClientRect().top;
      const tops = Array.from(block.querySelectorAll("[data-line]")).map(
        (line) => line.getBoundingClientRect().top - origin,
      );
      if (state.swaps.length === 0 && block.querySelector("[style*='color']")) {
        state.colouredWhileOpen += 1;
      }
      if (last && last.id !== id) {
        const common = Math.min(last.tops.length, tops.length);
        let maxDy = 0;
        for (let i = 0; i < common; i += 1) {
          maxDy = Math.max(
            maxDy,
            Math.abs((tops[i] as number) - (last.tops[i] as number)),
          );
        }
        state.swaps.push({ lines: common, maxDy: +maxDy.toFixed(2) });
      }
      last = { id, tops };
    };
    const loop = () => {
      if (!state.on) return;
      channel.port2.postMessage(0);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, sentinel);
}

export async function stopCodeBlock(page: Page): Promise<CodeBlockWatch> {
  return page.evaluate(() => {
    const state = (window as unknown as CodeWindow).__codeWatch;
    state.on = false;
    return {
      colouredWhileOpen: state.colouredWhileOpen,
      firstSeenInBlock: state.firstSeenInBlock,
      swaps: state.swaps,
    };
  });
}

/** The resident the mini chat talks to. */
export const MINI_RESIDENT = "a".repeat(64);

/** Boot the app with the new look and open the mini chat. */
export async function bootMiniChat(page: Page) {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
    localStorage.setItem("buzz-theme", "obsidian");
    localStorage.setItem("buzz-follow-system", "false");
  }, FEATURE_OVERRIDES_STORAGE_KEY);
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        personaId: "builtin:fizz",
        pubkey: MINI_RESIDENT,
        status: "running",
      },
    ],
  });
  await page.goto(`/?e2e=mock#/channels/${GENERAL_ID}`);
  await expect(page.getByTestId("message-composer")).toBeVisible();
  await page.getByTestId("quickchat-launcher").click();
  await expect(page.getByTestId("quickchat-input")).toBeFocused();
}

/** Send in the mini chat; returns what its reply answers and where. */
export async function sendFromMiniChat(page: Page, text: string) {
  const field = page.getByTestId("quickchat-input");
  await field.fill(text);
  await field.press("Enter");
  await expect(field).toHaveValue("");
  const row = page
    .locator(".qc-message.qc-owner")
    .filter({ hasText: text })
    .last();
  await expect(row).toBeVisible();
  const receiptId = await row.getAttribute("data-message-id");
  const channelId = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? "";
      if (!key.startsWith("luca:quickchat:v1:")) continue;
      const value = JSON.parse(localStorage.getItem(key) ?? "{}") as {
        companionRooms?: Record<string, { channelId?: string }>;
      };
      const room = Object.values(value.companionRooms ?? {})[0];
      if (room?.channelId) return room.channelId;
    }
    return null;
  });
  if (!receiptId || !channelId)
    throw new Error("The mini chat send is missing.");
  return { channelId, receiptId };
}
