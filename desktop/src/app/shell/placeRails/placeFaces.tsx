import type * as React from "react";
import {
  Activity,
  AppWindow,
  Bell,
  Bookmark,
  Bot,
  Code,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Keyboard,
  LayoutGrid,
  ListEnd,
  NotebookPen,
  Palette,
  Plug,
  Puzzle,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  StickyNote,
  Smartphone,
  Sparkles,
  Stethoscope,
  Trash2,
  User,
  Users,
  Waypoints,
} from "lucide-react";

import type {
  LibraryKindId,
  RailPlace,
} from "@/app/shell/placeRails/placePicks";
import type { SettingsSection } from "@/features/settings/ui/SettingsPanels";
import { AgentMark } from "@/shared/ui/AgentMark";
import { AgentDendrite } from "@/shared/ui/dendrite/AgentDendrite";
import { HarnessLogo, harnessIdFromRuntimeId } from "@/shared/ui/HarnessLogo";

/**
 * The faces a page's head leads with (BETA14_RELEASE.md WP-33, Decided 1):
 * the rail row's own face, as the lab draws each row (shell-lab-rail,
 * `content.ts`, "Every row has a face"). Line drawings for the places' own
 * rows; a connected app's maker's mark; a mind wears the agent mark
 * (`shared/ui/AgentMark.tsx`).
 */

/** The Library's kinds, as the lab's Made rows draw them. */
export const LIBRARY_KIND_FACES: Record<LibraryKindId, typeof LayoutGrid> = {
  all: LayoutGrid,
  prototypes: Sparkles,
  apps: AppWindow,
  images: ImageIcon,
  documents: FileText,
  code: Code,
};

/** Skills (all of them) and Recently deleted. */
export const LIBRARY_SKILLS_FACE = Puzzle;
export const LIBRARY_DELETED_FACE = Trash2;

/** Settings' sections, as the lab's Settings rail draws them. */
export const SETTINGS_SECTION_FACES: Record<SettingsSection, typeof User> = {
  profile: User,
  security: ShieldCheck,
  appearance: Palette,
  notifications: Bell,
  mobile: Smartphone,
  shortcuts: Keyboard,
  agents: Bot,
  connections: Plug,
  defaults: SlidersHorizontal,
  diagnostics: Stethoscope,
  updates: Download,
  about: Info,
};

/** A connected app's maker's mark, as the lab's rows draw it: the makers
 *  whose own mark is a colour keep it; the black-and-white ones take the
 *  row's ink. */
export function HarnessFace({
  runtimeId,
  size = 19,
}: {
  runtimeId: string;
  size?: number;
}) {
  const harness = harnessIdFromRuntimeId(runtimeId);
  return (
    <HarnessLogo
      appearance={
        harness === "codex" || harness === "grok" ? "monochrome" : "brand"
      }
      decorative
      harness={harness}
      size={size}
    />
  );
}

/** What a rail row's face is: a mind's mark, a maker's mark, or a line
 *  drawing. The rail's CSS tones each kind (shell-rail.css). */
export type RailFaceKind = "agent" | "app" | "icon";

/**
 * A place's rail row's face (BETA14_RELEASE.md WP-40, Decided 2), as the
 * lab's rails draw them (shell-lab-rail `6049f9246`, content.ts): a mind
 * wears the agent mark (WP-42 turns it into their dendrite); a connected
 * app its maker's mark; everything else a line drawing. Brain's two views
 * have no row in the lab: Connections wears the joined points, Activity the
 * pulse the lab gives "What they read".
 */
/** A mind's rooms in the Mnemos place: the notebook's own glyphs where
 *  WP-33 gave them (memory a bookmark, journal a pen), line drawings else. */
const MNEMOS_ROOM_FACES: Record<string, typeof User> = {
  glance: LayoutGrid,
  memories: Bookmark,
  journal: NotebookPen,
  notes: StickyNote,
  beliefs: Scale,
  carrying: ListEnd,
};

export function placeRowFace(
  place: RailPlace,
  rowId: string,
): { kind: RailFaceKind; face: React.ReactNode } {
  const icon = (Icon: typeof User) => ({
    kind: "icon" as const,
    face: <Icon />,
  });
  if (rowId.startsWith("mind:") || rowId.startsWith("record:")) {
    // Each mind wears its own dendrite (WP-42); one not yet keyed keeps the agent mark.
    const key = rowId.slice(rowId.indexOf(":") + 1);
    return {
      kind: "agent",
      face: key ? (
        <AgentDendrite group="rail" residentKey={key} size={18} />
      ) : (
        <AgentMark />
      ),
    };
  }
  if (rowId === "luca" || rowId.startsWith("persona:"))
    return { kind: "agent", face: <AgentMark /> };
  if (rowId.startsWith("group:")) return icon(Users);
  if (place === "activity") return icon(Activity);
  if (place === "brain")
    return rowId === "connections" ? icon(Waypoints) : icon(Activity);
  if (place === "mnemos") return icon(MNEMOS_ROOM_FACES[rowId] ?? LayoutGrid);
  if (rowId === "deleted") return icon(LIBRARY_DELETED_FACE);
  if (rowId === "skills:all") return icon(LIBRARY_SKILLS_FACE);
  if (rowId.startsWith("skills:"))
    return {
      kind: "app",
      face: <HarnessFace runtimeId={rowId.slice("skills:".length)} size={16} />,
    };
  if (rowId.startsWith("made:")) {
    const kind = rowId.slice("made:".length) as LibraryKindId;
    return icon(LIBRARY_KIND_FACES[kind] ?? LayoutGrid);
  }
  return icon(LayoutGrid);
}
