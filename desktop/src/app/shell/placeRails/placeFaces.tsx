import {
  AppWindow,
  Bell,
  Bot,
  Code,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Keyboard,
  LayoutGrid,
  Palette,
  Plug,
  Puzzle,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Stethoscope,
  Trash2,
  User,
} from "lucide-react";

import type { LibraryKindId } from "@/app/shell/placeRails/placePicks";
import type { SettingsSection } from "@/features/settings/ui/SettingsPanels";
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
