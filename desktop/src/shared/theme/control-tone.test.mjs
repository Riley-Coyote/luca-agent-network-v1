import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  ASH_THEME_COLORS,
  contrastRatio,
  createThemeVars,
  GRAPHITE_THEME_COLORS,
  INVERSE_THEME_COLORS,
  OBSIDIAN_THEME_COLORS,
  PAPER_THEME_COLORS,
  VOID_THEME_COLORS,
} from "./adaptive-theme.ts";
import {
  extractThemeInfo,
  loadThemeData,
  resolveShikiThemeName,
  SYNTAX_THEMES,
} from "./theme-loader.ts";

/**
 * THE RESTING-CONTROL CONTRACT.
 *
 * `--mn-control` draws a control that is doing nothing: the track of a switch
 * that is off. It must clear the 3:1 non-text floor (WCAG 2.2 SC 1.4.11) on
 * every surface a control can sit on, in every palette the app can wear, and
 * stay the quiet one of the pair: a switch that is on must read as clearly
 * more than one that is off.
 *
 * The failure this guards against looked deliberate in the source for as long
 * as it shipped: the off track borrowed the strong-border role, a hairline's
 * tone, and drew at 1.2 to 1.4:1 on Paper and 1.0 to 1.7:1 on Slate. The
 * setting it hid worst was the one that most needs seeing, a safety switch
 * that starts off.
 *
 * The tone is a mix declared once, in `conversation-shell.css`. Its share is
 * read from there, so this asserts the stylesheet's own number, for every
 * palette: the authored ladders, Slate's in the stylesheet, and every bundled
 * syntax theme through the same builder the app uses.
 */
const NON_TEXT_FLOOR = 3;
/** On must hold at least this many times off's contrast on the same ground. */
const ON_OVER_OFF = 2;

const shell = readFileSync(
  new URL("../styles/globals/conversation-shell.css", import.meta.url),
  "utf8",
);

function faintShare() {
  const found =
    /--mn-control:\s*color-mix\(\s*in srgb,\s*hsl\(var\(--mn-ink-faint\)\)\s+([\d.]+)%,\s*hsl\(var\(--mn-ink-ghost\)\)\s*\)/.exec(
      shell,
    );
  assert.ok(
    found,
    "--mn-control must be a mix of the faint and ghost inks, declared in conversation-shell.css",
  );
  return Number(found[1]) / 100;
}

const channels = (hex) =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const toHex = (rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
/** `top` over `under` at `share`: an sRGB mix, as CSS draws one. */
const mix = (top, under, share) => {
  const a = channels(top);
  const b = channels(under);
  return toHex(a.map((c, i) => c * share + b[i] * (1 - share)));
};

/** "H S% L%", as the builders and the stylesheet write a role, to hex. */
function hslToHex(triplet) {
  const [h, s, l] = triplet.replaceAll("%", "").trim().split(/\s+/).map(Number);
  const sat = s / 100;
  const light = l / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - chroma / 2;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return toHex([r, g, b].map((c) => (c + m) * 255));
}

/** A palette as plain hex, from a builder's role vars. */
function fromVars(vars) {
  const role = (name) => hslToHex(vars[`--mn-${name}`]);
  return {
    floor: role("floor"),
    surface: role("surface"),
    raised: role("raised"),
    hover: role("hover"),
    recess: role("recess"),
    ink: role("ink"),
    inkFaint: role("ink-faint"),
    inkGhost: role("ink-ghost"),
  };
}

/** Slate, the default ladder, lives in the stylesheet and nowhere else. */
function slate() {
  const vars = {};
  for (const name of [
    "floor",
    "surface",
    "raised",
    "hover",
    "recess",
    "ink",
    "ink-faint",
    "ink-ghost",
  ]) {
    const found = new RegExp(
      `--mn-${name}:\\s*([\\d.]+ [\\d.]+% [\\d.]+%);`,
    ).exec(shell);
    assert.ok(found, `Slate's --mn-${name} is in conversation-shell.css`);
    vars[`--mn-${name}`] = found[1];
  }
  return fromVars(vars);
}

/**
 * Every ground a control can sit on: the ladder, and the fills the shell
 * lays over the page (the plate of a panel, a hovered row, a popover, a
 * focused menu row), each at the dose the stylesheets give it.
 */
function grounds({ floor, surface, raised, hover, recess, ink }) {
  const popover = mix(raised, surface, 0.2);
  return [
    ["surface", surface],
    ["floor", floor],
    ["raised", raised],
    ["hover", hover],
    ["recess", recess],
    ["a panel's plate", mix(ink, surface, 0.035)],
    ["a hovered row", mix(ink, surface, 0.06)],
    ["a popover", popover],
    ["a focused menu row", mix(raised, popover, 0.5)],
  ];
}

function assertControlTone(name, palette) {
  const control = mix(palette.inkFaint, palette.inkGhost, faintShare());
  for (const [groundName, ground] of grounds(palette)) {
    const off = contrastRatio(control, ground);
    assert.ok(
      off >= NON_TEXT_FLOOR,
      `${name}: a control at rest on ${groundName} is ${off.toFixed(2)}:1, under the 3:1 non-text floor`,
    );
    const on = contrastRatio(palette.ink, ground);
    assert.ok(
      on >= off * ON_OVER_OFF,
      `${name}: on ${groundName}, on (${on.toFixed(2)}:1) must read as at least ${ON_OVER_OFF}x off (${off.toFixed(2)}:1)`,
    );
    // A field's edge steps up to the focus tone as you reach it, and a
    // focused field wears that tone twice as thick. It may not fall back
    // under the edge at rest.
    const reached = contrastRatio(palette.inkFaint, ground);
    assert.ok(
      reached >= off,
      `${name}: on ${groundName}, a field's edge must not get quieter from rest (${off.toFixed(2)}:1) to hover and focus (${reached.toFixed(2)}:1)`,
    );
  }
  // The thumb is the page's own surface, sitting on the track.
  const thumb = contrastRatio(palette.surface, control);
  assert.ok(
    thumb >= NON_TEXT_FLOOR,
    `${name}: the thumb on a track at rest is ${thumb.toFixed(2)}:1, under the 3:1 non-text floor`,
  );
}

test("a control at rest is seen on every surface of every authored palette", () => {
  for (const [name, palette] of [
    ["Slate", slate()],
    ["Void", VOID_THEME_COLORS],
    ["Ash", ASH_THEME_COLORS],
    ["Inverse", INVERSE_THEME_COLORS],
    ["Graphite", GRAPHITE_THEME_COLORS],
    ["Obsidian", OBSIDIAN_THEME_COLORS],
    ["Paper", PAPER_THEME_COLORS],
  ]) {
    assertControlTone(name, palette);
  }
});

test("a control at rest is seen in every palette derived from a syntax theme", async () => {
  // The app palettes resolve to a bundled theme for code only; their shell
  // is the authored ladder above. Everything else is derived, as shipped.
  const derived = SYNTAX_THEMES.filter(
    (name) => resolveShikiThemeName(name) === name,
  );
  assert.ok(derived.length > 50, "the bundled syntax themes are all here");
  for (const name of derived) {
    const info = extractThemeInfo(name, await loadThemeData(name));
    const { vars } = createThemeVars(info.bg, info.fg, info.comment, {
      added: info.added,
      deleted: info.deleted,
      modified: info.modified,
    });
    assertControlTone(name, fromVars(vars));
  }
});

test("neither ink does the job alone, which is why the tone is a mix", () => {
  // If the first half ever fails, the mix can go and the switch can take the
  // ghost role as it is.
  const { raised, hover, ink, inkFaint, inkGhost } = slate();
  assert.ok(contrastRatio(inkGhost, raised) < NON_TEXT_FLOOR);
  assert.ok(contrastRatio(inkGhost, hover) < NON_TEXT_FLOOR);
  // The faint ink clears the floor and crowds on: under 3x between the pair
  // where the mix leaves more.
  const off = mix(inkFaint, inkGhost, faintShare());
  assert.ok(
    contrastRatio(ink, raised) / contrastRatio(inkFaint, raised) <
      contrastRatio(ink, raised) / contrastRatio(off, raised),
  );
});

/**
 * THE FIELD-EDGE CONTRACT.
 *
 * A text box or a picker has nothing but its edge to say it is there. That
 * edge is the control tone, through the one name every field already used,
 * `border-input`. Two ways it used to go wrong, both guarded here: the name
 * pointed at a hairline (1.1 to 1.4:1 on Paper), and call sites turned it
 * down further with an alpha.
 */
const sources = readdirSync(new URL("../../", import.meta.url), {
  recursive: true,
})
  .filter((path) => /\.(tsx?|css)$/.test(path))
  .map((path) => [
    path,
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
  ]);

test("the edge of a field is the control tone", () => {
  const config = readFileSync(
    new URL("../../../tailwind.config.js", import.meta.url),
    "utf8",
  );
  assert.match(
    config,
    /\binput: "var\(--mn-control, hsl\(var\(--input\)\)\)"/,
    "Tailwind's `input` colour must read --mn-control, so `border-input` draws a field's edge at 3:1 or better",
  );
  for (const part of ["input", "textarea"]) {
    const source = readFileSync(
      new URL(`../ui/${part}.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /\bborder border-input(?![/\w-])/,
      `the shared ${part} draws its edge with border-input, whole`,
    );
  }
});

test("nothing turns a field's edge back down", () => {
  const dimmed = [];
  const fallsOnApproach = [];
  for (const [path, text] of sources) {
    text.split("\n").forEach((line, index) => {
      const at = `${path}:${index + 1}`;
      // An alpha on the edge walks it back under the floor.
      if (
        /\b(?:border|ring|outline|divide|bg)(?:-[trblxy])?-input\/\d/.test(line)
      )
        dimmed.push(at);
      // The old step-up was an alpha of the muted ink, quieter than the
      // edge is now: a field must not fade as you hover or enter it.
      if (
        /\bborder-input\b/.test(line) &&
        /(?:hover|focus|focus-within|focus-visible):border-muted-foreground\/\d/.test(
          line,
        )
      )
        fallsOnApproach.push(at);
    });
  }
  assert.deepEqual(
    dimmed,
    [],
    "write `border-input` whole; for a labelled button's outline use `border-border-strong`",
  );
  assert.deepEqual(
    fallsOnApproach,
    [],
    "a field's hover and focus edge is `border-ring`, never an alpha of the muted ink",
  );
});
