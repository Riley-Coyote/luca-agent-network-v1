import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  BadgeInfo,
  BellRing,
  Bot,
  Check,
  Keyboard,
  KeyRound,
  MonitorCog,
  Moon,
  PlugZap,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
  Sun,
  SunMoon,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type {
  DesktopNotificationPermissionState,
  NotificationSettings,
} from "@/features/notifications/hooks";
import type { SoundName, SoundSlot } from "@/features/notifications/lib/sound";
import {
  setAgentNamesInMessages,
  useAgentNamesInMessages,
} from "@/features/messages/lib/conversationAppearancePreference";
import {
  setChatMarkAppearance,
  useChatMarkAppearance,
  type ChatMarkStyle,
} from "@/features/messages/lib/chatMarkAppearancePreference";
import {
  setStreamingTextEffect,
  useStreamingTextEffect,
} from "@/features/messages/lib/streamingTextPreference";
import {
  setMessageTextSize,
  useMessageTextSize,
  type MessageTextSize,
} from "@/features/messages/lib/messageTextSizePreference";
import type { StreamingTextEffect } from "@/shared/ui/markdownStreamingText";
import { RuntimeRailPinsSettings } from "@/features/runtime-sessions/RuntimeRailPinsSettings";
import {
  type ProjectRoomsPlacement,
  setProjectRoomsPlacement,
  useProjectRoomsPlacement,
} from "@/features/sidebar/lib/projectRoomsPlacement";
import {
  frameSentence,
  glassFrameName,
  solidFrameName,
  type Frame,
  useReducedTransparency,
} from "@/app/shell/shellGlass";
import {
  setClassicLayout,
  useClassicLayout,
} from "@/shared/features/classicLayout";
import {
  useShellFrameEnabled,
  useShellFrameOnByDefault,
} from "@/shared/features/useShellFrameEnabled";
import { cn } from "@/shared/lib/cn";
import { Switch } from "@/shared/ui/switch";
import {
  ACCENT_COLORS,
  isBuzzTheme,
  isFixedNeutralTheme,
  NEUTRAL_ACCENT,
  useTheme,
} from "@/shared/theme/ThemeProvider";
import {
  BUZZ_DARK_THEME_NAME,
  DEFAULT_THEME_NAME,
  LIGHT_THEMES,
  SYNTAX_THEMES,
  type SyntaxThemeName,
  getThemePair,
  isGlassTheme,
} from "@/shared/theme/theme-loader";
import {
  BUZZ_GRADIENT_STOPS,
  SystemPreferencePreviewFrame,
  ThemePreviewFrame,
  type ThemePreviewVars,
} from "@/shared/theme/ThemePreviewFrame";
import {
  getThemeFallbackPreviewVars,
  useThemePreviewVars,
  withAccentPreviewVars,
} from "@/shared/theme/useThemePreviewVars";
import { KeyboardShortcutsCard } from "./KeyboardShortcutsCard";
import { NotificationSettingsCard } from "./NotificationSettingsCard";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { ProfileSettingsCard } from "./ProfileSettingsCard";
import {
  SettingsPageTitleContext,
  SettingsSectionHeader,
  useSettingsAppName,
} from "./SettingsSectionHeader";
import { SettingsAgentsPanel } from "./SettingsAgentsPanel";
import { ConnectionsMcpSettings } from "./ConnectionsMcpSettings";
import {
  AboutLucaSettings,
  DefaultsPermissionsSettings,
  DiagnosticsSettings,
  MobileDevicesSettings,
  SecurityBackupSettings,
  UpdatesSettings,
} from "./LucaSettingsSupportPanels";

export type SettingsSection =
  | "profile"
  | "security"
  | "notifications"
  | "agents"
  | "connections"
  | "defaults"
  | "appearance"
  | "mobile"
  | "shortcuts"
  | "diagnostics"
  | "updates"
  | "about";

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "profile";

const SETTINGS_SECTION_VALUES: readonly SettingsSection[] = [
  "profile",
  "security",
  "notifications",
  "agents",
  "connections",
  "defaults",
  "appearance",
  "mobile",
  "shortcuts",
  "diagnostics",
  "updates",
  "about",
];

export function isSettingsSection(value: unknown): value is SettingsSection {
  return (
    typeof value === "string" &&
    (SETTINGS_SECTION_VALUES as readonly string[]).includes(value)
  );
}

export type SettingsSectionDescriptor = {
  value: SettingsSection;
  label: string;
  icon: LucideIcon;
};

export type SettingsPanelProps = {
  currentPubkey?: string;
  fallbackDisplayName?: string;
  isUpdatingDesktopNotifications: boolean;
  notificationErrorMessage: string | null;
  notificationPermission: DesktopNotificationPermissionState;
  notificationSettings: NotificationSettings;
  onSetDesktopNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  onSetHomeBadgeEnabled: (enabled: boolean) => void;
  onSetSlotAlertsEnabled: (slot: SoundSlot, enabled: boolean) => void;
  onSetNotifyWhileViewing: (enabled: boolean) => void;
  onSetAllSlotAlertsEnabled: (enabled: boolean) => void;
  onSetSoundForSlot: (slot: SoundSlot, name: SoundName) => void;
};

export const settingsSections: SettingsSectionDescriptor[] = [
  {
    value: "profile",
    label: "Profile & identity",
    icon: UserRound,
  },
  {
    value: "security",
    label: "Security & backup",
    icon: KeyRound,
  },
  {
    value: "appearance",
    label: "Appearance",
    icon: MonitorCog,
  },
  {
    value: "notifications",
    label: "Notifications",
    icon: BellRing,
  },
  {
    value: "mobile",
    label: "Mobile & devices",
    icon: Smartphone,
  },
  {
    value: "shortcuts",
    label: "Shortcuts",
    icon: Keyboard,
  },
  {
    value: "agents",
    label: "Agents",
    icon: Bot,
  },
  {
    value: "connections",
    label: "Connections & MCP",
    icon: PlugZap,
  },
  {
    value: "defaults",
    label: "Defaults & permissions",
    icon: SlidersHorizontal,
  },
  {
    value: "diagnostics",
    label: "Diagnostics",
    icon: Activity,
  },
  {
    value: "updates",
    label: "Updates",
    icon: RefreshCw,
  },
  {
    value: "about",
    label: "About Luca",
    icon: BadgeInfo,
  },
];

/**
 * A section's name as its row says it. Under the shell's frame the app is
 * Polyphonic, and About needs no name after it (the study's rail: "About";
 * SHELL_BUILD.md WP-17, 6).
 */
export function settingsSectionLabel(
  section: SettingsSection,
  framed: boolean,
): string {
  if (framed && section === "about") return "About";
  return (
    settingsSections.find((entry) => entry.value === section)?.label ??
    "Settings"
  );
}

function formatThemeLabel(name: string): string {
  // The default shell is the Linear-dose ladder ("Slate"); Ash (the
  // carved neutral), Inverse and Void are named themes of their own.
  if (isBuzzTheme(name)) return "Slate";

  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Derive a display label for a paired theme from its light variant name.
 * Strips mode-specific tokens (light, latte, dawn, lotus, ochin, lighter, plus)
 * from any position, handling names like "github-light-default", "light-plus",
 * "material-theme-lighter", and "gruvbox-light-soft".
 */
function pairedThemeLabel(lightName: string): string {
  const modeTokens = new Set([
    "light",
    "latte",
    "dawn",
    "lotus",
    "ochin",
    "lighter",
    "plus",
  ]);
  const parts = lightName.split("-").filter((t) => !modeTokens.has(t));
  // If stripping removed everything (e.g. "light-plus"), fall back to the raw name
  const base = parts.length > 0 ? parts.join("-") : lightName;
  return formatThemeLabel(base);
}

/**
 * Categorize themes into three groups:
 * 1. Paired — themes with both a light and dark variant (auto-switches with system)
 * 2. Light-only — light themes with no dark counterpart
 * 3. Dark-only — dark themes with no light counterpart
 *
 * For paired themes, we deduplicate by only keeping the light member
 * (the dark member is shown alongside it as a preview).
 *
 * `framed`: the shell's frame is on, so the pairs are its own (Paper with
 * Vitesse Black; theme-loader's FRAMED_THEME_PAIRS).
 */
function useThemeCategories(framed: boolean) {
  return useMemo(() => {
    const pairedLight: SyntaxThemeName[] = [];
    const lightOnly: SyntaxThemeName[] = [];
    const darkOnly: SyntaxThemeName[] = [];

    // Track which themes are the "dark side" of a pair so we skip them
    const darkPairMembers = new Set<string>();
    for (const name of SYNTAX_THEMES) {
      if (isBuzzTheme(name)) continue;
      if (LIGHT_THEMES.has(name)) {
        const pair = getThemePair(name, framed);
        if (pair) {
          darkPairMembers.add(pair);
        }
      }
    }

    for (const name of SYNTAX_THEMES) {
      if (isBuzzTheme(name)) continue;
      // Skip dark members of pairs — they'll be shown alongside their light counterpart
      if (darkPairMembers.has(name)) continue;

      if (LIGHT_THEMES.has(name)) {
        const pair = getThemePair(name, framed);
        if (pair) {
          pairedLight.push(name);
        } else {
          lightOnly.push(name);
        }
      } else {
        darkOnly.push(name);
      }
    }

    return { pairedLight, lightOnly, darkOnly };
  }, [framed]);
}

function PairedThemeTile({
  isActive,
  lightName,
  darkName,
  lightVars,
  darkVars,
  onSelect,
}: {
  isActive: boolean;
  lightName: SyntaxThemeName;
  darkName: SyntaxThemeName;
  lightVars: ThemePreviewVars | null;
  darkVars: ThemePreviewVars | null;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isActive}
      className="group flex w-[168px] shrink-0 flex-col items-center text-center focus-visible:outline-hidden"
      data-testid={`theme-pair-${lightName}`}
      onClick={onSelect}
      type="button"
    >
      <SystemPreferencePreviewFrame
        className={cn(
          "h-[112px] w-[168px] transition-shadow",
          isActive
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
            : "group-hover:ring-2 group-hover:ring-border",
        )}
        darkGradient={BUZZ_GRADIENT_STOPS[darkName]}
        darkVars={darkVars}
        lightGradient={BUZZ_GRADIENT_STOPS[lightName]}
        lightVars={lightVars}
      />
      <span
        className={cn(
          "mt-1.5 w-full truncate text-xs",
          isActive ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {pairedThemeLabel(lightName)}
      </span>
    </button>
  );
}

function SingleThemeTile({
  isActive,
  name,
  vars,
  onSelect,
}: {
  isActive: boolean;
  name: SyntaxThemeName;
  vars: ThemePreviewVars | null;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isActive}
      className="group flex w-[168px] shrink-0 flex-col items-center text-center focus-visible:outline-hidden"
      data-testid={`theme-option-${name}`}
      onClick={onSelect}
      type="button"
    >
      <ThemePreviewFrame
        className={cn(
          "h-[112px] w-[168px] transition-shadow",
          isActive
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
            : "group-hover:ring-2 group-hover:ring-border",
        )}
        sidebarGradient={BUZZ_GRADIENT_STOPS[name]}
        vars={vars}
      />
      <span
        className={cn(
          "mt-1.5 w-full truncate text-xs",
          isActive ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {formatThemeLabel(name)}
      </span>
    </button>
  );
}

type AppearanceMode = "system" | "light" | "dark";

// Reveal/hide motion for the accent picker: a small translate + opacity fade.
// The picker sits below the theme grid and reads as tucking up behind it, so
// it enters from above (slides *down* into place when a non-Buzz theme reveals
// it) and exits upward (slides up behind the grid when Buzz hides it). No
// height/scale — height collapse clipped the swatches behind the grid's bottom
// fade (the "white bar"). Snappier than the modal 0.2s since this is a small
// settings control, sharing the modal/ProfileSettingsCard easing curve.
const ACCENT_PICKER_TRANSITION = {
  duration: 0.16,
  ease: [0.23, 1, 0.32, 1] as const,
};

function ThemeSettingsCard({ currentPubkey }: { currentPubkey?: string }) {
  const {
    setTheme,
    selectedThemeName,
    themeName,
    isDark,
    accentColor,
    setAccentColor,
    followSystem,
    setFollowSystem,
  } = useTheme();

  // The shell's frame brings its own Frame row; its glass replaces the rail
  // glass test builds' settings.
  const shellFrame = useShellFrameEnabled();

  // First-party app palettes pin a neutral accent so their authored selection
  // and focus hierarchy cannot be overwritten by a stored chromatic swatch.
  const accentPickerHidden = isFixedNeutralTheme(themeName);
  const shouldReduceMotion = useReducedMotion();

  const appName = useSettingsAppName();
  // Without the frame the grid scrolls in its own box, its edges fading into
  // the page's background. Under the frame it flows on the page (WP-22, 1).
  const gridFade = (to: "top" | "bottom") =>
    `linear-gradient(to ${to}, hsl(var(--background)), hsl(var(--background) / 0))`;
  const previewVarsByTheme = useThemePreviewVars();
  const categories = useThemeCategories(shellFrame);
  // Under the frame the glass themes retire (SHELL_SPEC.md, Decided 7): the
  // Glass frame is the see-through window now, so their tiles leave.
  const { pairedLight, lightOnly, darkOnly } = useMemo(() => {
    if (!shellFrame) return categories;
    const kept = (name: SyntaxThemeName) => !isGlassTheme(name);
    return {
      pairedLight: categories.pairedLight.filter(kept),
      lightOnly: categories.lightOnly.filter(kept),
      darkOnly: categories.darkOnly.filter(kept),
    };
  }, [categories, shellFrame]);

  // Determine the active mode from current state
  const activeMode: AppearanceMode = followSystem
    ? "system"
    : isDark
      ? "dark"
      : "light";

  const [selectedMode, setSelectedMode] = useState<AppearanceMode>(activeMode);

  const getVars = (name: SyntaxThemeName) => {
    const previewAccent = isFixedNeutralTheme(name)
      ? NEUTRAL_ACCENT
      : accentColor;
    return withAccentPreviewVars(
      previewVarsByTheme[name] ?? getThemeFallbackPreviewVars(name),
      previewAccent,
    );
  };

  // All light themes (paired light + light-only)
  const allLightThemes = useMemo(
    () => [...pairedLight, ...lightOnly],
    [pairedLight, lightOnly],
  );

  // All dark themes (paired dark + dark-only)
  const allDarkThemes = useMemo<SyntaxThemeName[]>(() => {
    // Paper's dark counterpart is Ash (the default shell), which already
    // leads this list as BUZZ_DARK_THEME_NAME — take it out of the paired
    // run so "Ash" appears once rather than twice. Void follows as its own
    // named dark theme.
    const pairedDark = pairedLight
      .map((l) => getThemePair(l, shellFrame))
      .filter((name): name is SyntaxThemeName => !!name && !isBuzzTheme(name));
    const dark: SyntaxThemeName[] = [
      BUZZ_DARK_THEME_NAME,
      ...pairedDark,
      ...darkOnly,
    ];
    if (!shellFrame) return dark;
    // Under the frame the dark default leads, as Paper leads Light: it is
    // where Obsidian's owners were moved (SHELL_SPEC.md, Decided 7).
    return [
      DEFAULT_THEME_NAME,
      ...dark.filter((name) => name !== DEFAULT_THEME_NAME),
    ];
  }, [pairedLight, darkOnly, shellFrame]);

  const handleModeSelect = (mode: AppearanceMode) => {
    setSelectedMode(mode);
    if (mode === "system") {
      setFollowSystem(true);
      // If the current theme is unpaired, resolveSystemTheme can't switch it
      // with the OS. Fall back to the first paired theme so System mode works.
      const pair = getThemePair(
        selectedThemeName as SyntaxThemeName,
        shellFrame,
      );
      if (!pair && pairedLight.length > 0) {
        setTheme(pairedLight[0]);
      }
    } else {
      setFollowSystem(false);
      // Switch to the counterpart theme when the current theme doesn't match
      // the selected mode. E.g. if the stored theme is light and the user
      // clicks Dark, apply the dark pair so the app immediately reflects the
      // chosen mode. A System pair can stay dark (the legacy buzz-dark alias),
      // so accept it only when it matches the explicitly requested mode.
      const currentIsLight = LIGHT_THEMES.has(
        selectedThemeName as SyntaxThemeName,
      );
      const needsDark = mode === "dark" && currentIsLight;
      const needsLight = mode === "light" && !currentIsLight;
      if (needsDark || needsLight) {
        const pair = getThemePair(
          selectedThemeName as SyntaxThemeName,
          shellFrame,
        );
        if (pair && LIGHT_THEMES.has(pair) === (mode === "light")) {
          setTheme(pair);
        } else {
          // No matching counterpart — pick the first theme in the target mode.
          const fallback = needsDark ? allDarkThemes[0] : allLightThemes[0];
          if (fallback) {
            setTheme(fallback);
          }
        }
      }
    }
  };

  const handleSelectTheme = (name: SyntaxThemeName) => {
    setTheme(name);
    if (selectedMode === "system") {
      setFollowSystem(true);
    } else {
      setFollowSystem(false);
    }
  };

  /** Check if a paired theme (by its light member) is the active selection */
  const isPairActive = (lightName: SyntaxThemeName) => {
    const darkName = getThemePair(lightName, shellFrame);
    return selectedThemeName === lightName || selectedThemeName === darkName;
  };

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="settings-theme"
    >
      <SettingsSectionHeader
        title="Appearance"
        description={`Choose a theme for ${appName}.`}
      />

      {shellFrame ? (
        // Under the frame Mode is Frame's segment, on a row of the same
        // group (WP-17, 3): the study's Appearance, Mode then Frame. Each
        // row has its own test id; the Frame row's is only the Frame row,
        // so it stays a statement in a browser (WP-28, 2).
        <SettingsOptionGroup className="mb-4">
          <SettingsOptionRow data-testid="appearance-mode">
            <p
              className="min-w-0 text-sm font-medium"
              id="appearance-mode-label"
            >
              Mode
            </p>
            <SettingsSegment
              isDark={isDark}
              labelledBy="appearance-mode-label"
              onChange={handleModeSelect}
              options={[
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ]}
              testId={(mode) => `appearance-mode-${mode}`}
              value={selectedMode}
            />
          </SettingsOptionRow>
          <FrameSetting />
          <ClassicLayoutSetting />
        </SettingsOptionGroup>
      ) : null}

      {/* Mode selector: System / Light / Dark */}
      {shellFrame ? null : (
        <div className="mb-4 flex gap-2">
          {(
            [
              { mode: "system" as const, label: "System", Icon: SunMoon },
              { mode: "light" as const, label: "Light", Icon: Sun },
              { mode: "dark" as const, label: "Dark", Icon: Moon },
            ] as const
          ).map(({ mode, label, Icon }) => (
            <button
              aria-pressed={selectedMode === mode}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                selectedMode === mode
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
              )}
              data-testid={`appearance-mode-${mode}`}
              key={mode}
              onClick={() => handleModeSelect(mode)}
              type="button"
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}

      {shellFrame ? null : <ClassicLayoutGroup />}

      {/* Theme grid — without the frame constrained to ~3 rows and
          scrolling internally; under the frame every theme shows, with its
          name, and the page scrolls (WP-22, 1). */}
      <div className="relative mb-6">
        {shellFrame ? null : (
          <>
            {/* Top fade */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3"
              style={{
                background: gridFade("bottom"),
              }}
            />
            {/* Bottom fade — hidden while the accent picker is visible so its
                near-white gradient (Buzz light) can't mask the swatches below
                it (the "white bar"). Kept only when the picker is hidden. */}
            {accentPickerHidden ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3"
                style={{
                  background: gridFade("top"),
                }}
              />
            ) : null}
          </>
        )}
        <div
          className={
            shellFrame
              ? "rounded-lg pt-2"
              : "max-h-[430px] overflow-y-auto rounded-lg pt-2"
          }
          data-testid="appearance-theme-grid"
        >
          <div className="flex flex-wrap gap-4 p-1">
            {selectedMode === "system" ? (
              <SingleThemeTile
                isActive={isBuzzTheme(selectedThemeName)}
                name={BUZZ_DARK_THEME_NAME}
                onSelect={() => handleSelectTheme(BUZZ_DARK_THEME_NAME)}
                vars={getVars(BUZZ_DARK_THEME_NAME)}
              />
            ) : null}
            {selectedMode === "system" &&
              pairedLight.map((lightName) => {
                const darkName = getThemePair(lightName, shellFrame);
                if (!darkName) return null;
                return (
                  <PairedThemeTile
                    darkName={darkName}
                    darkVars={getVars(darkName)}
                    isActive={isPairActive(lightName)}
                    key={lightName}
                    lightName={lightName}
                    lightVars={getVars(lightName)}
                    onSelect={() => handleSelectTheme(lightName)}
                  />
                );
              })}
            {selectedMode === "light" &&
              allLightThemes.map((name) => (
                <SingleThemeTile
                  isActive={selectedThemeName === name}
                  key={name}
                  name={name}
                  onSelect={() => handleSelectTheme(name)}
                  vars={getVars(name)}
                />
              ))}
            {selectedMode === "dark" &&
              allDarkThemes.map((name) => (
                <SingleThemeTile
                  isActive={selectedThemeName === name}
                  key={name}
                  name={name}
                  onSelect={() => handleSelectTheme(name)}
                  vars={getVars(name)}
                />
              ))}
          </div>
        </div>
      </div>

      {/* Accent color picker — hidden for Buzz themes (pinned neutral accent).
          Reveal/hide with the translate-up + opacity fade defined by
          ACCENT_PICKER_TRANSITION above. Reduced motion skips the transition
          and just renders/unrenders. */}
      {shouldReduceMotion ? (
        accentPickerHidden ? null : (
          <AccentPickerContent
            accentColor={accentColor}
            isDark={isDark}
            setAccentColor={setAccentColor}
          />
        )
      ) : (
        <AnimatePresence initial={false}>
          {accentPickerHidden ? null : (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="will-change-[opacity,transform]"
              exit={{ opacity: 0, y: -10 }}
              initial={{ opacity: 0, y: -10 }}
              key="accent-picker"
              transition={ACCENT_PICKER_TRANSITION}
            >
              <AccentPickerContent
                accentColor={accentColor}
                isDark={isDark}
                setAccentColor={setAccentColor}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <ConversationAppearanceSettings currentPubkey={currentPubkey} />
      <RuntimeRailPinsSettings />
    </section>
  );
}

/** The shell's one rail choice (WP-02): where a project's rooms are listed.
 *  The Conversation group's last row, divided like its neighbours. */
function ProjectRoomsSetting() {
  const shellFrame = useShellFrameEnabled();
  const placement = useProjectRoomsPlacement();
  if (!shellFrame) return null;
  return (
    <SettingsOptionRow
      className="flex-wrap border-t border-border/30"
      data-testid="project-rooms-setting"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">Project rooms</p>
        <p className="text-sm font-normal text-muted-foreground">
          {placement === "rail"
            ? "Listed under each project in the rail."
            : "Listed in a column beside the conversation."}
        </p>
      </div>
      <fieldset className="flex gap-1 rounded-full bg-background/50 p-1">
        <legend className="sr-only">Project rooms</legend>
        {(
          [
            ["rail", "In the rail"],
            ["column", "In a column"],
          ] as const satisfies readonly (readonly [
            ProjectRoomsPlacement,
            string,
          ])[]
        ).map(([value, label]) => (
          <button
            aria-pressed={placement === value}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              placement === value
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`project-rooms-${value}`}
            key={value}
            onClick={() => setProjectRoomsPlacement(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </fieldset>
    </SettingsOptionRow>
  );
}

/** Label and one line of help for each streaming-text choice. */
const STREAMING_TEXT_CHOICES = [
  ["bloom", "Bloom", "Words land a touch large and settle."],
  ["diffusion", "Diffusion", "Words condense out of the page."],
  ["off", "Off", "Text appears as it arrives."],
] as const satisfies readonly (readonly [
  StreamingTextEffect,
  string,
  string,
])[];

/** Label for each message-text size. */
const MESSAGE_TEXT_CHOICES = [
  ["small", "Small"],
  ["default", "Default"],
  ["large", "Large"],
] as const satisfies readonly (readonly [MessageTextSize, string])[];

/**
 * The study's segment (shellStudy.css:1137-1155), as the Frame row draws it
 * and, under the frame, Mode too (WP-17, 3): a track of the ink at 6%; the
 * chosen option the ink at 14% at night, and by day a piece of paper
 * standing up on its track, like Send (shellStudy.css:1382-1388), never a
 * darker dip.
 */
function SettingsSegment<T extends string>({
  describedBy,
  isDark,
  labelledBy,
  onChange,
  options,
  testId,
  value,
}: {
  describedBy?: string;
  isDark: boolean;
  labelledBy: string;
  onChange: (value: T) => void;
  options: [T, string][];
  testId: (value: T) => string;
  value: T;
}) {
  return (
    <fieldset
      aria-describedby={describedBy}
      aria-labelledby={labelledBy}
      className="flex gap-1 rounded-full bg-[hsl(var(--mn-ink)/0.06)] p-1"
    >
      {options.map(([option, label]) => (
        <button
          aria-pressed={value === option}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            value !== option
              ? "text-muted-foreground hover:text-foreground"
              : isDark
                ? "bg-[hsl(var(--mn-ink)/0.14)] text-foreground"
                : "bg-[hsl(var(--mn-surface))] text-foreground shadow-[0_0.5px_1px_hsl(var(--mn-ink)/0.22),0_1px_3px_hsl(var(--mn-ink)/0.1)]",
          )}
          data-testid={testId(option)}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The Frame row, under the shell's frame (SHELL_SPEC.md, "The frame setting"):
 * Black (Paper in light) or Glass, named "Liquid Glass" where Apple's is
 * beneath the page. Glass is offered only where it can be drawn (the app, on
 * a Mac); elsewhere the row is a statement, the label and its sentence. One
 * plain sentence under it says what the choice draws, here and now: under
 * Reduce Transparency the glass stays chosen, drawn solid (WP-05b, 6).
 */
function FrameSetting() {
  const { frame, setFrame, glassFrame, isDark } = useTheme();
  const reducedTransparency = useReducedTransparency();
  const chosen: Frame = glassFrame.offered ? frame : "solid";
  const choices: [Frame, string][] = [
    ["solid", solidFrameName(isDark)],
    ["glass", glassFrameName({ announced: glassFrame.liquid })],
  ];

  // As the study's setting (shellStudy.css:1230-1253): the label and its
  // choice share one line, and the sentence sits beneath on its own, so its
  // length never moves the choice. A row of Appearance's first group.
  return (
    <SettingsOptionRow
      className="flex-col items-stretch justify-center gap-1.5"
      data-testid="appearance-frame"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 text-sm font-medium" id="appearance-frame-label">
          Frame
        </p>
        {glassFrame.offered ? (
          <SettingsSegment
            describedBy="appearance-frame-sentence"
            isDark={isDark}
            labelledBy="appearance-frame-label"
            onChange={setFrame}
            options={choices}
            testId={(value) => `appearance-frame-${value}`}
            value={chosen}
          />
        ) : null}
      </div>
      <p
        className="text-sm font-normal text-muted-foreground"
        data-testid="appearance-frame-sentence"
        id="appearance-frame-sentence"
      >
        {frameSentence(chosen, {
          isDark,
          announced: glassFrame.liquid,
          reducedTransparency,
        })}
      </p>
    </SettingsOptionRow>
  );
}

/**
 * The classic layout, for beta.14 only (docs/luca/BETA14_RELEASE.md, WP-31):
 * one quiet row, offered only where the build draws the shell by default.
 * On, the shell goes at once and stays gone across launches; off, it comes
 * back. Under the shell it is the third row of Mode and Frame's group.
 */
function ClassicLayoutSetting() {
  const offered = useShellFrameOnByDefault();
  const classic = useClassicLayout();
  if (!offered) return null;
  return (
    <SettingsOptionRow data-testid="appearance-classic-layout">
      <div className="min-w-0">
        <label
          className="text-sm font-medium"
          htmlFor="appearance-classic-layout-switch"
        >
          Classic layout
        </label>
        <p
          className="text-sm font-normal text-muted-foreground"
          id="appearance-classic-layout-sentence"
        >
          The layout from before beta.14. It goes away in the next release.
        </p>
      </div>
      <Switch
        aria-describedby="appearance-classic-layout-sentence"
        checked={classic}
        data-testid="appearance-classic-layout-toggle"
        id="appearance-classic-layout-switch"
        onCheckedChange={setClassicLayout}
      />
    </SettingsOptionRow>
  );
}

/** In the classic layout the row is a group of its own, under the mode
 *  buttons, so the way back to the shell is always on Appearance. */
function ClassicLayoutGroup() {
  const offered = useShellFrameOnByDefault();
  if (!offered) return null;
  return (
    <SettingsOptionGroup className="mb-4">
      <ClassicLayoutSetting />
    </SettingsOptionGroup>
  );
}

function ConversationAppearanceSettings({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  const agentNamesInMessages = useAgentNamesInMessages(currentPubkey);
  const chatMarks = useChatMarkAppearance(currentPubkey);
  const streamingText = useStreamingTextEffect(currentPubkey);
  const messageTextSize = useMessageTextSize();

  return (
    <div className="mt-8">
      <h3 className="mb-2 px-1 text-sm font-medium">Conversation</h3>
      <SettingsOptionGroup>
        <SettingsOptionRow>
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="agent-names-in-messages-switch"
            >
              Show agent names in messages
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Show who sent each agent reply and which runtime they use.
            </p>
          </div>
          <Switch
            checked={agentNamesInMessages}
            data-testid="agent-names-in-messages-toggle"
            disabled={!currentPubkey}
            id="agent-names-in-messages-switch"
            onCheckedChange={(enabled) =>
              setAgentNamesInMessages(currentPubkey, enabled)
            }
          />
        </SettingsOptionRow>
        <SettingsOptionRow className="border-t border-border/30">
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="chat-marks-visible-switch"
            >
              Show agent marks in chats
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Show the selected identity style in conversations. Thinking
              activity stays visible.
            </p>
          </div>
          <Switch
            checked={chatMarks.visible}
            data-testid="chat-marks-visible-toggle"
            disabled={!currentPubkey}
            id="chat-marks-visible-switch"
            onCheckedChange={(visible) =>
              setChatMarkAppearance(currentPubkey, { visible })
            }
          />
        </SettingsOptionRow>
        <SettingsOptionRow className="border-t border-border/30">
          <div className="min-w-0">
            <label
              className="text-sm font-medium"
              htmlFor="composer-sphere-switch"
            >
              Show sphere above composer
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Show the resting sphere beside the message field. Working activity
              stays visible.
            </p>
          </div>
          <Switch
            checked={chatMarks.composerVisible}
            disabled={!currentPubkey}
            id="composer-sphere-switch"
            data-testid="composer-sphere-toggle"
            onCheckedChange={(composerVisible) =>
              setChatMarkAppearance(currentPubkey, { composerVisible })
            }
          />
        </SettingsOptionRow>
        <SettingsOptionRow className="flex-wrap border-t border-border/30">
          <div className="min-w-0">
            <p className="text-sm font-medium">Chat mark</p>
            <p className="text-sm font-normal text-muted-foreground">
              Glyphs sit beside replies. The optional sphere sits above the
              composer. This style also applies to agent profiles and pickers.
            </p>
          </div>
          <fieldset className="flex gap-1 rounded-full bg-background/50 p-1">
            <legend className="sr-only">Chat mark style</legend>
            {(
              [
                ["sphere", "Sphere"],
                ["glyph", "Glyph"],
              ] as const satisfies readonly (readonly [ChatMarkStyle, string])[]
            ).map(([style, label]) => (
              <button
                aria-pressed={chatMarks.style === style}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  chatMarks.style === style
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`chat-mark-style-${style}`}
                disabled={!currentPubkey || !chatMarks.visible}
                key={style}
                onClick={() => setChatMarkAppearance(currentPubkey, { style })}
                type="button"
              >
                {label}
              </button>
            ))}
          </fieldset>
        </SettingsOptionRow>
        <SettingsOptionRow className="flex-wrap border-t border-border/30">
          <div className="min-w-0">
            <p className="text-sm font-medium">Streaming text</p>
            <p className="text-sm font-normal text-muted-foreground">
              {STREAMING_TEXT_CHOICES.find(
                ([value]) => value === streamingText,
              )?.[2] ?? ""}
            </p>
          </div>
          <fieldset className="flex gap-1 rounded-full bg-background/50 p-1">
            <legend className="sr-only">Streaming text</legend>
            {STREAMING_TEXT_CHOICES.map(([value, label]) => (
              <button
                aria-pressed={streamingText === value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  streamingText === value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`streaming-text-${value}`}
                disabled={!currentPubkey}
                key={value}
                onClick={() => setStreamingTextEffect(currentPubkey, value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </fieldset>
        </SettingsOptionRow>
        <SettingsOptionRow className="flex-wrap border-t border-border/30">
          <div className="min-w-0">
            <p className="text-sm font-medium">Message text</p>
            <p className="text-sm font-normal text-muted-foreground">
              Resizes messages and the composer only. ⌘+ and ⌘− still scale the
              whole app.
            </p>
          </div>
          <fieldset className="flex gap-1 rounded-full bg-background/50 p-1">
            <legend className="sr-only">Message text</legend>
            {MESSAGE_TEXT_CHOICES.map(([value, label]) => (
              <button
                aria-pressed={messageTextSize === value}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  messageTextSize === value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`message-text-${value}`}
                key={value}
                onClick={() => setMessageTextSize(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </fieldset>
        </SettingsOptionRow>
        <ProjectRoomsSetting />
      </SettingsOptionGroup>
    </div>
  );
}

/** Accent swatch grid — shared by the animated and reduced-motion reveal paths. */
function AccentPickerContent({
  accentColor,
  isDark,
  setAccentColor,
}: {
  accentColor: string;
  isDark: boolean;
  setAccentColor: (value: string) => void;
}) {
  return (
    <div className="shrink-0 px-1 pb-2 pt-1">
      <h3 className="mb-2 text-sm font-medium">Accent color</h3>
      <div className="flex flex-wrap gap-2 p-1">
        {ACCENT_COLORS.map((color) => {
          const isNeutral = color.value === NEUTRAL_ACCENT;
          const swatchColor = isNeutral
            ? "hsl(var(--foreground))"
            : color.value;
          const checkClassName =
            isNeutral && isDark ? "text-black" : "text-white";

          return (
            <button
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border border-border/50 transition-transform hover:scale-110",
                accentColor === color.value &&
                  "ring-2 ring-ring ring-offset-2 ring-offset-background",
              )}
              data-testid={`accent-color-${color.name.toLowerCase()}`}
              key={color.value}
              onClick={() => setAccentColor(color.value)}
              style={{ backgroundColor: swatchColor }}
              title={color.name}
              type="button"
            >
              {accentColor === color.value && (
                <Check className={cn("h-4 w-4", checkClassName)} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function renderSettingsSection(
  section: SettingsSection,
  props: SettingsPanelProps,
): React.ReactNode {
  // The page's title, so a group head that only repeats it can leave it
  // to the page (WP-22, 2).
  return (
    <SettingsPageTitleContext.Provider
      value={settingsSectionLabel(section, true)}
    >
      {renderSettingsSectionPanel(section, props)}
    </SettingsPageTitleContext.Provider>
  );
}

function renderSettingsSectionPanel(
  section: SettingsSection,
  props: SettingsPanelProps,
): React.ReactNode {
  switch (section) {
    case "profile":
      return (
        <ProfileSettingsCard
          currentPubkey={props.currentPubkey}
          fallbackDisplayName={props.fallbackDisplayName}
        />
      );
    case "security":
      return <SecurityBackupSettings />;
    case "notifications":
      return (
        <NotificationSettingsCard
          isUpdatingDesktopNotifications={props.isUpdatingDesktopNotifications}
          notificationErrorMessage={props.notificationErrorMessage}
          notificationPermission={props.notificationPermission}
          notificationSettings={props.notificationSettings}
          onSetDesktopNotificationsEnabled={
            props.onSetDesktopNotificationsEnabled
          }
          onSetHomeBadgeEnabled={props.onSetHomeBadgeEnabled}
          onSetSlotAlertsEnabled={props.onSetSlotAlertsEnabled}
          onSetNotifyWhileViewing={props.onSetNotifyWhileViewing}
          onSetAllSlotAlertsEnabled={props.onSetAllSlotAlertsEnabled}
          onSetSoundForSlot={props.onSetSoundForSlot}
        />
      );
    case "agents":
      return <SettingsAgentsPanel />;
    case "connections":
      return <ConnectionsMcpSettings />;
    case "defaults":
      return <DefaultsPermissionsSettings />;
    case "appearance":
      return <ThemeSettingsCard currentPubkey={props.currentPubkey} />;
    case "mobile":
      return <MobileDevicesSettings currentPubkey={props.currentPubkey} />;
    case "shortcuts":
      return <KeyboardShortcutsCard />;
    case "diagnostics":
      return <DiagnosticsSettings />;
    case "updates":
      return <UpdatesSettings />;
    case "about":
      return <AboutLucaSettings />;
    default: {
      const exhaustiveCheck: never = section;
      return exhaustiveCheck;
    }
  }
}
