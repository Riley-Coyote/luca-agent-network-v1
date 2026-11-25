/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      // Sub-`text-xs` ramp for meta text (timestamps, count badges, tracking
      // labels) and tiny glyphs. Defined in rem so Cmd +/- zoom — which scales
      // the root <html> font-size — keeps scaling them. Do NOT reintroduce
      // arbitrary `text-[…rem]` / `text-[…px]` literals; the px-text guard
      // rejects them. Stock scale picks up from here: xs (12px), sm (14px)…
      fontSize: {
        "2xs": "0.6875rem", // 11px — meta-text workhorse (timestamps, badges)
        "3xs": "0.5rem", // 8px — tiny glyphs / micro labels
        badge: "0.625rem", // 10px — compact status badges
        chat: "0.9375rem", // 15px — dense conversation content
        lip: "0.8125rem", // 13px — the shell frame's words (the lip's page name)
        // 40px — onboarding page titles (tightened tracking for large display type)
        title: ["2.5rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        // 36px — the backup-step private key, shown large in monospace
        "nsec-key": ["2.25rem", { lineHeight: "1.3" }],
      },
      boxShadow: {
        // Edge + elevation for a surface anchored to the right of the content
        // area, whose only exposed edge faces left. Tailwind's stock shadows are
        // all y-offset, so they cast almost nothing sideways — `shadow-xl` on a
        // left-facing edge is nearly invisible. Both layers run -x so they wrap
        // the surface's rounded left corners: the hairline draws the boundary
        // (and carries dark mode, where a black shadow reads as nothing), the
        // soft layer carries the lift. A left-only `border` can't do this job —
        // it tapers out at each corner instead of turning it.
        "panel-left":
          "-1px 0 0 0 hsl(var(--border) / 0.8), -16px 0 32px -12px rgb(0 0 0 / 0.18)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      spacing: {
        4.5: "1.125rem",
      },
      // Uppercase tracking, named once in typography.css. Reach for these
      // rather than `tracking-[0.11em]`; lowercase text takes its tracking
      // from its ramp step and needs none of these.
      letterSpacing: {
        caps: "var(--type-caps-tracking)",
        "caps-wide": "var(--type-eyebrow-tracking)",
        "caps-wider": "var(--type-caps-wider-tracking)",
      },
      fontFamily: {
        sans: [
          '"Inter Variable"',
          "Inter",
          '"Avenir Next"',
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // THE INK LADDER as utilities. Secondary text used to be written as an
        // alpha on the foreground — `text-muted-foreground/60` and thirteen
        // other values — which reads as a tone in dark mode and falls through
        // the AA floor the moment the ink goes near-black on paper. These four
        // are the only levels; each holds a known contrast in every palette.
        // Reach for `text-ink-muted`, never `text-foreground/70`.
        ink: {
          DEFAULT: "hsl(var(--mn-ink))",
          muted: "hsl(var(--mn-ink-muted))",
          faint: "hsl(var(--mn-ink-faint))",
          // Decorative and disabled only — it does not clear AA by design.
          ghost: "hsl(var(--mn-ink-ghost))",
        },
        // The plate: a borderless filled group that reads in every theme
        // because it is ink at a small alpha, not a fixed grey. Defined in
        // conversation-shell.css beside the shell scale.
        plate: {
          DEFAULT: "var(--mn-plate)",
          hover: "var(--mn-plate-hover)",
          opaque: "var(--mn-plate-opaque)",
        },
        // A control at rest: the track of a switch that is off, the edge of
        // a text box or a picker. The quietest tone that still clears 3:1 on
        // every surface. Defined in conversation-shell.css beside the focus
        // role. Outside the Luca shell there is no ink ladder to take it
        // from, so it is the input border it always was.
        control: "var(--mn-control, hsl(var(--input)))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        // The strong hairline, for an outline that is not what tells you a
        // thing is a control: a labelled button, a chip, a rule. It is the
        // tone `border-input` used to draw.
        "border-strong": "hsl(var(--mn-border-strong, var(--input)))",
        // THE EDGE OF A FIELD is the control tone, not a hairline. The edge
        // is the only thing that says "you can type here", so it has to hold
        // 3:1 where a hairline never will. Write `border-input` whole: an
        // alpha on it (`border-input/40`) walks it back under the floor, and
        // control-tone.test.mjs fails on one.
        input: "var(--mn-control, hsl(var(--input)))",
        ring: "hsl(var(--ring))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          active: "hsl(var(--sidebar-active))",
          "active-foreground": "hsl(var(--sidebar-active-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        status: {
          added: "var(--status-added)",
          deleted: "var(--status-deleted)",
          modified: "var(--status-modified)",
        },
        warning: {
          DEFAULT: "var(--ui-warning)",
          bg: "var(--ui-warning-bg)",
        },
      },
    },
  },
  plugins: [],
};
