import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

const READY_CODEX_RUNTIME = {
  id: "codex",
  label: "Codex",
  avatar_url: "",
  availability: "available",
  command: "codex",
  binary_path: "/synthetic/bin/codex",
  default_args: [],
  mcp_command: null,
  install_hint: "Install Codex",
  install_instructions_url: "https://example.invalid/codex",
  can_auto_install: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "logged_in" },
  login_hint: "Sign in to Codex",
};

async function openDoor(page: import("@playwright/test").Page) {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: { runtimes: [] },
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
  await expect(page.getByTestId("onboarding-footer-scrim")).toHaveCount(0);
}

test("the door names the application and the name field never seeds a key label", async ({
  page,
}, testInfo) => {
  await openDoor(page);
  await expect(page.getByRole("heading", { name: "Luca" })).toHaveCount(0);
  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  if (evidenceDirectory) {
    await waitForAnimations(page);
    await page.screenshot({
      animations: "allow",
      path: `${evidenceDirectory}/onboarding-door-without-bottom-gradient.png`,
    });
  } else {
    await testInfo.attach("onboarding door", {
      body: await page.screenshot({ animations: "allow" }),
      contentType: "image/png",
    });
  }
  await page.getByTestId("polyphonic-door-begin").click();
  // The mock identity's display name is a shortened npub; the field must not
  // ask a new owner to delete their own key.
  await expect(page.getByTestId("polyphonic-owner-name")).toHaveValue("");
});

test("the field is one object: it does not move between the door and the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDoor(page);
  const field = page.getByTestId("polyphonic-onboarding-field");
  await expect(field).toHaveCount(1);
  const before = await field.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });

  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  // Never unmounted, never remounted: same element, same place.
  await expect(field).toHaveCount(1);
  await expect
    .poll(async () =>
      field.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
        };
      }),
    )
    .toEqual(before);
  // The card mounted around it, in the frame's own geometry.
  const pane = page.getByTestId("polyphonic-setup-pane");
  const paneRect = await pane.evaluate((el) => el.getBoundingClientRect());
  expect(
    Math.abs(paneRect.left + paneRect.width / 2 - (before.x + before.w / 2)),
  ).toBeLessThan(2);
});

test("the setup card is dark whatever the system scheme, and reads in the app's type", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openDoor(page);
  await page.getByTestId("polyphonic-door-begin").click();
  // The card's surface is the shell the door already had; the frame in the
  // tree is transparent and holds only the column.
  const card = page.getByTestId("polyphonic-onboarding-shell");
  // The card's surface while it floats: the dark plate at 76% over the blur.
  await expect(card).toHaveCSS("background-color", "rgba(20, 20, 22, 0.76)");
  // The frame's canvas is still the dark one whatever the OS says; it is
  // simply not painted while the card floats on a transparent window, so the
  // token is what carries the fact and the surface reports nothing.
  const frame = page.getByTestId("polyphonic-onboarding");
  await expect(frame).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const canvasToken = await frame.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--prototype-canvas").trim(),
  );
  expect(canvasToken).toBe("#060608");
  const family = await page
    .getByRole("heading", { name: "What should Luca call you?" })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toMatch(/Instrument Sans/);
});

test("the shell is the same object on the door and in the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDoor(page);
  const shell = page.getByTestId("polyphonic-onboarding-shell");
  // The card is there from the first frame — there is no door without it.
  await expect(shell).toBeVisible();
  const before = await shell.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });

  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  await expect(shell).toHaveCount(1);
  // Nothing materialised: same object, same place.
  await expect
    .poll(async () =>
      shell.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
        };
      }),
    )
    .toEqual(before);
  // And the transparent frame the column sits on is exactly the shell.
  const frame = await page
    .getByTestId("polyphonic-setup-assistant")
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    });
  expect(frame).toEqual(before);
});

/** On a first run the window IS the card: 1040×584, no margin around it. */
const FIRST_RUN_VIEWPORT = { width: 1040, height: 584 };
/** The pane the dendrite lives in, and the air either side of the dendrite. */
const PANE_WIDTH = 480;
const FIELD_INSET = 40;
/** The interaction column's measure, and the air either side of it. */
const COLUMN_MEASURE = 480;
const COLUMN_GUTTER = 40;
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const PURE_BLACK = "rgb(0, 0, 0)";

/**
 * A bright, busy stand-in for the desktop, painted behind the transparent
 * document so the glass can be judged where it is hardest: the dendrite's dots
 * have to hold their ground over a light wallpaper, not only a dark one.
 */
async function paintDesktopBehind(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const id = "wp-float-desktop";
    if (document.getElementById(id)) return;
    const node = document.createElement("div");
    node.id = id;
    node.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:-1",
      "background:" +
        "repeating-linear-gradient(45deg, rgba(0,0,0,0.06) 0 12px, rgba(255,255,255,0.06) 12px 24px)," +
        "radial-gradient(60% 70% at 25% 20%, #fff8e1, transparent 70%)," +
        "radial-gradient(70% 60% at 80% 75%, #cfe9ff, transparent 70%)," +
        "linear-gradient(140deg, #f7f4ee 0%, #e8d9c2 45%, #dbe8f2 100%)",
    ].join(";");
    document.body.appendChild(node);
  });
}

function backgroundOf(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<string | null> {
  return page.evaluate((target) => {
    const node = document.querySelector(target);
    return node ? window.getComputedStyle(node).backgroundColor : null;
  }, selector);
}

test("the first run floats: nothing is painted but the card", async ({
  page,
}, testInfo) => {
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);

  // One fact with one source: the onboarding scene's stage, on <html>.
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-floating-card",
    "",
  );

  // Everything between the desktop and the card stops painting…
  expect(await backgroundOf(page, "html")).toBe(TRANSPARENT);
  expect(await backgroundOf(page, "body")).toBe(TRANSPARENT);
  expect(await backgroundOf(page, "#root")).toBe(TRANSPARENT);
  expect(
    await backgroundOf(page, '[data-testid="machine-onboarding-gate"]'),
  ).toBe(TRANSPARENT);

  // …and the card is a plate of glass over the blurred desktop: the same
  // surface colour at 76%, with the pane sharing it so the two halves read as
  // one object.
  const shell = page.getByTestId("polyphonic-onboarding-shell");
  await expect(shell).toBeVisible();
  await expect(shell).toHaveCSS("background-color", "rgba(20, 20, 22, 0.76)");
  await expect(page.getByTestId("polyphonic-setup-pane")).toHaveCount(0);

  // The window is the card: it fills the viewport, no margin around it.
  const shellBox = await shell.boundingBox();
  expect(shellBox?.width).toBe(FIRST_RUN_VIEWPORT.width);
  expect(shellBox?.height).toBe(FIRST_RUN_VIEWPORT.height);

  // The living field stays inside the card — there is no canvas outside it to
  // spill onto any more.
  const bounds = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const card = rect('[data-testid="polyphonic-onboarding-shell"]');
    const field = rect('[data-testid="polyphonic-onboarding-field"]');
    if (!card || !field) return null;
    return {
      card: {
        left: card.left,
        top: card.top,
        right: card.right,
        bottom: card.bottom,
      },
      field: {
        left: field.left,
        top: field.top,
        right: field.right,
        bottom: field.bottom,
      },
    };
  });
  expect(bounds).not.toBeNull();
  if (bounds) {
    expect(bounds.field.left).toBeGreaterThanOrEqual(bounds.card.left - 1);
    expect(bounds.field.top).toBeGreaterThanOrEqual(bounds.card.top - 1);
    expect(bounds.field.right).toBeLessThanOrEqual(bounds.card.right + 1);
    expect(bounds.field.bottom).toBeLessThanOrEqual(bounds.card.bottom + 1);
  }

  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  await waitForAnimations(page);
  if (evidenceDirectory) {
    await page.screenshot({
      animations: "allow",
      path: `${evidenceDirectory}/floating-card-door.png`,
    });
  } else {
    await testInfo.attach("floating door", {
      body: await page.screenshot({ animations: "allow" }),
      contentType: "image/png",
    });
  }

  // And over a bright desktop: the plate has to carry the field's dots there
  // too, which is the only place 76% is actually a judgement call.
  await paintDesktopBehind(page);
  await waitForAnimations(page);
  if (evidenceDirectory) {
    await page.screenshot({
      animations: "allow",
      path: `${evidenceDirectory}/floating-card-door-over-bright-desktop.png`,
    });
  } else {
    await testInfo.attach("floating door over a bright desktop", {
      body: await page.screenshot({ animations: "allow" }),
      contentType: "image/png",
    });
  }

  // The name step is the same object on the same transparent window.
  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-floating-card",
    "",
  );
  expect(await backgroundOf(page, "body")).toBe(TRANSPARENT);
  expect(
    await backgroundOf(page, '[data-testid="polyphonic-onboarding"]'),
  ).toBe(TRANSPARENT);
  await waitForAnimations(page);
  if (evidenceDirectory) {
    await page.screenshot({
      animations: "allow",
      path: `${evidenceDirectory}/floating-card-name-step.png`,
    });
  } else {
    await testInfo.attach("floating name step", {
      body: await page.screenshot({ animations: "allow" }),
      contentType: "image/png",
    });
  }
});

/** Every rect the layout is judged on, in one read of the page. */
async function readCardGeometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    return {
      card: box('[data-testid="polyphonic-onboarding-shell"]'),
      pane: box('[data-testid="polyphonic-setup-pane"]'),
      fieldBox: box('[data-testid="polyphonic-setup-field-box"]'),
      field: box('[data-testid="polyphonic-onboarding-field"]'),
      column: box('[data-testid="polyphonic-setup-column"]'),
      heading: box("#polyphonic-welcome-heading"),
      footer: box(".polyphonic-onboarding-footer"),
      body: box(".polyphonic-onboarding-body"),
    };
  });
}

test("the card is 1040×584: a pane wide enough for the dendrite to breathe", async ({
  page,
}) => {
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);
  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  // The field settles onto its anchor; these are the resting numbers.
  await waitForAnimations(page);

  const geometry = await readCardGeometry(page);
  const { card, pane, fieldBox, column } = geometry;
  expect(card).not.toBeNull();
  expect(pane).not.toBeNull();
  expect(fieldBox).not.toBeNull();
  expect(column).not.toBeNull();
  if (!card || !pane || !fieldBox || !column) return;

  // The window is the card.
  expect(Math.round(card.width)).toBe(FIRST_RUN_VIEWPORT.width);
  expect(Math.round(card.height)).toBe(FIRST_RUN_VIEWPORT.height);
  expect(Math.round(pane.width)).toBe(PANE_WIDTH);

  // …and the dendrite has the same air on both sides of itself. This is the
  // whole point of the wider pane: edge to edge is not a composition.
  expect(Math.round(fieldBox.left - pane.left)).toBe(FIELD_INSET);
  expect(Math.round(pane.right - fieldBox.right)).toBe(FIELD_INSET);
  expect(Math.round(fieldBox.width)).toBe(PANE_WIDTH - FIELD_INSET * 2);
  // Square, and centred on the pane.
  expect(Math.round(fieldBox.height)).toBe(Math.round(fieldBox.width));
  expect(
    Math.abs(fieldBox.top - pane.top - (pane.bottom - fieldBox.bottom)),
  ).toBeLessThan(1.5);
  // …and the dendrite that is actually drawn is on that box, not behind it.
  // The card slides to the window's edges when the document stops painting
  // around it, without ever changing size; the field has to follow that.
  const { field } = geometry;
  expect(field).not.toBeNull();
  if (!field) return;
  expect(Math.abs(field.left - fieldBox.left)).toBeLessThan(1.5);
  expect(Math.abs(field.right - fieldBox.right)).toBeLessThan(1.5);

  // One column, one measure, centred in the half that is left — and its air
  // is the dendrite's air, so the two halves breathe the same amount.
  // (The card's own 1px border is inside these numbers, hence the tolerance.)
  expect(Math.round(column.width)).toBe(COLUMN_MEASURE);
  const leftGutter = column.left - pane.right;
  const rightGutter = card.right - column.right;
  expect(Math.abs(leftGutter - rightGutter)).toBeLessThanOrEqual(1);
  expect(Math.abs(leftGutter - COLUMN_GUTTER)).toBeLessThanOrEqual(1);
  expect(Math.abs(rightGutter - COLUMN_GUTTER)).toBeLessThanOrEqual(1);
});

test("the column is centred in the card, and the actions sit on its bottom edge", async ({
  page,
}) => {
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);
  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();

  const { column, heading, footer, body, card } = await readCardGeometry(page);
  expect(heading).not.toBeNull();
  expect(footer).not.toBeNull();
  if (!column || !heading || !footer || !body || !card) return;

  // The content group is centred against the card's height, not hung from the
  // top of it: the empty space is shared between above and below, and the
  // group's own middle is the card's middle.
  const group = await page.evaluate(() => {
    const column = document.querySelector(
      '[data-testid="polyphonic-setup-column"]',
    );
    const content = column?.firstElementChild;
    if (!content) return null;
    const rect = content.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  expect(group).not.toBeNull();
  if (!group) return;
  const above = group.top - column.top;
  const below = column.bottom - group.bottom;
  expect(above).toBeGreaterThan(8);
  expect(Math.abs(above - below)).toBeLessThan(2);
  expect(
    Math.abs((group.top + group.bottom) / 2 - (card.top + card.bottom) / 2),
  ).toBeLessThan(2);

  // The actions are the column's, not the card's corner: same edges, and on
  // the bottom edge of the column rather than floating above the card's.
  expect(Math.round(footer.left)).toBe(Math.round(column.left));
  expect(Math.round(footer.right)).toBe(Math.round(column.right));
  const back = await page.getByRole("button", { name: "Back" }).boundingBox();
  const primary = await page
    .getByTestId("polyphonic-setup-continue")
    .boundingBox();
  expect(back).not.toBeNull();
  expect(primary).not.toBeNull();
  if (!back || !primary) return;
  expect(Math.round(back.x)).toBe(Math.round(column.left));
  expect(Math.round(primary.x + primary.width)).toBe(Math.round(column.right));
  // Quiet Back on the left, primary on the right, both on one baseline.
  expect(back.x).toBeLessThan(primary.x);
  expect(
    Math.abs(back.y + back.height / 2 - (primary.y + primary.height / 2)),
  ).toBeLessThan(2);
});

test("the pane is pure black and the glass is the other half's", async ({
  page,
}) => {
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);
  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();

  // The field's ground is nothing at all: not the canvas token, not a tinted
  // near-black, and above all not the plate showing through at 76%.
  const pane = page
    .getByTestId("polyphonic-onboarding-shell")
    .locator("> div")
    .first();
  await expect(pane).toHaveCSS("background-color", PURE_BLACK);
  // No gradient laid over it either.
  await expect(pane).toHaveCSS("background-image", "none");
  // The card behind it is still the glass the right half is made of.
  await expect(page.getByTestId("polyphonic-onboarding-shell")).toHaveCSS(
    "background-color",
    "rgba(20, 20, 22, 0.76)",
  );
});

test("the field is 44px and focus is its own border, in place", async ({
  page,
}) => {
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);
  await page.getByTestId("polyphonic-door-begin").click();
  const field = page.getByTestId("polyphonic-owner-name");
  await expect(field).toBeVisible();
  const box = await field.boundingBox();
  expect(Math.round(box?.height ?? 0)).toBe(44);

  const resting = await field.evaluate((el) => ({
    border: getComputedStyle(el).borderColor,
    width: getComputedStyle(el).borderTopWidth,
  }));
  expect(resting.width).toBe("1px");
  await field.focus();
  const focused = await field.evaluate((el) => ({
    border: getComputedStyle(el).borderColor,
    outline: getComputedStyle(el).outlineStyle,
    width: getComputedStyle(el).borderTopWidth,
    shadow: getComputedStyle(el).boxShadow,
  }));
  // The border brightened where it already was. No second ring beside it.
  expect(focused.border).not.toBe(resting.border);
  expect(focused.width).toBe("1px");
  expect(focused.outline).toBe("none");
  expect(focused.shadow).not.toMatch(/0px 0px 0px [1-9]/);
});

test("a chosen runtime is a brighter hairline and a dot, never a fill", async ({
  page,
}) => {
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);
  await page.getByTestId("polyphonic-door-begin").click();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await page.getByTestId("polyphonic-setup-continue").click();
  const row = page.getByRole("radio", { name: /Codex/ }).locator("..");
  await expect(row).toBeVisible();

  const shape = await row.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      height: Math.round(el.getBoundingClientRect().height),
      radius: style.borderTopLeftRadius,
      borderWidth: style.borderTopWidth,
      background: style.backgroundColor,
    };
  });
  expect(shape.height).toBe(52);
  expect(shape.radius).toBe("12px");
  expect(shape.borderWidth).toBe("1px");

  const unchosen = await row.evaluate((el) => getComputedStyle(el).borderColor);
  await page.getByRole("radio", { name: /Codex/ }).check();
  const chosen = await row.evaluate((el) => ({
    border: getComputedStyle(el).borderColor,
    background: getComputedStyle(el).backgroundColor,
  }));
  // Brighter hairline, and the row's ground is exactly what it was: a chosen
  // row is not a lit plate.
  expect(chosen.border).not.toBe(unchosen);
  expect(chosen.background).toBe(shape.background);
  // …and the small filled dot is there to say so.
  await expect(row.locator("span.rounded-full").first()).toBeVisible();

  // Five rows before the list scrolls.
  const rows = page.getByTestId("polyphonic-runtime-rows");
  const maxHeight = await rows.evaluate((el) => getComputedStyle(el).maxHeight);
  expect(maxHeight).toBe("276px");
});

test("a step change moves the column and nothing else, and never empties the pane", async ({
  page,
}) => {
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);
  await page.getByTestId("polyphonic-door-begin").click();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  // The field settles onto its anchor once, on arrival; the question here is
  // whether the STEP change moves it, so start from rest.
  await waitForAnimations(page);

  const before = await readCardGeometry(page);
  // Press, then sample the card every frame across the whole change: the next
  // page has to be on screen fast, the pane is never allowed to be empty, and
  // the card, the pane and the field are not allowed to move at all.
  const trace = await page.evaluate(async () => {
    const rect = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    };
    const samples: {
      at: number;
      columns: number;
      card: ReturnType<typeof rect>;
      pane: ReturnType<typeof rect>;
      field: ReturnType<typeof rect>;
    }[] = [];
    const start = performance.now();
    let arrivedAt = -1;
    const sample = () => {
      const columns = document.querySelectorAll(
        '[data-testid="polyphonic-setup-column"]',
      ).length;
      samples.push({
        at: performance.now() - start,
        columns,
        card: rect('[data-testid="polyphonic-onboarding-shell"]'),
        pane: rect('[data-testid="polyphonic-setup-pane"]'),
        field: rect('[data-testid="polyphonic-onboarding-field"]'),
      });
      if (
        arrivedAt < 0 &&
        document.querySelector("#polyphonic-runtime-heading")
      )
        arrivedAt = performance.now() - start;
    };
    document
      .querySelector<HTMLElement>('[data-testid="polyphonic-setup-continue"]')
      ?.click();
    await new Promise<void>((resolve) => {
      const tick = () => {
        sample();
        if (performance.now() - start > 400) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { samples, arrivedAt };
  });

  // The next page is painted well inside the budget.
  expect(trace.arrivedAt).toBeGreaterThanOrEqual(0);
  expect(trace.arrivedAt).toBeLessThan(150);
  // There was a column on screen in every single frame of the change.
  expect(trace.samples.every((sample) => sample.columns >= 1)).toBe(true);
  // And the object around it never moved.
  const after = await readCardGeometry(page);
  for (const sample of trace.samples) {
    expect(sample.card).toEqual({
      x: Math.round(before.card?.left ?? 0),
      y: Math.round(before.card?.top ?? 0),
      w: Math.round(before.card?.width ?? 0),
    });
    expect(sample.field).toEqual({
      x: Math.round(before.field?.left ?? 0),
      y: Math.round(before.field?.top ?? 0),
      w: Math.round(before.field?.width ?? 0),
    });
  }
  expect(Math.round(after.pane?.width ?? 0)).toBe(PANE_WIDTH);

  // And the press Riley watched turn into "Working…" for a couple of seconds:
  // "Meet Luca" is a page change like any other, and the work happens on the
  // page it arrives at.
  await page.getByRole("radio", { name: /Codex/ }).check();
  await expect(page.getByTestId("polyphonic-setup-continue")).toHaveText(
    "Meet Luca",
  );
  const toWaking = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        document
          .querySelector<HTMLElement>(
            '[data-testid="polyphonic-setup-continue"]',
          )
          ?.click();
        const tick = () => {
          if (document.querySelector("#polyphonic-preparing-heading"))
            resolve(performance.now() - start);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(toWaking).toBeLessThan(150);
  await expect(page.getByTestId("polyphonic-setup-continue")).toHaveCount(0);
});

test("every page of the card, over a bright desktop", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize(FIRST_RUN_VIEWPORT);
  await openDoor(page);
  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  const shoot = async (name: string) => {
    await waitForAnimations(page);
    const body = await page.screenshot({ animations: "allow" });
    if (evidenceDirectory) {
      await page.screenshot({
        animations: "allow",
        path: `${evidenceDirectory}/${name}.png`,
      });
    }
    await testInfo.attach(name, { body, contentType: "image/png" });
  };

  await paintDesktopBehind(page);
  await shoot("card-1-door");

  await page.getByTestId("polyphonic-door-begin").click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await shoot("card-2-name");

  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(page.getByRole("radio", { name: /Codex/ })).toBeVisible();
  await page.getByRole("radio", { name: /Codex/ }).check();
  await shoot("card-3-runtime");

  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Luca is waking up." }),
  ).toBeVisible({ timeout: 15_000 });
  await shoot("card-4-waking");
});
