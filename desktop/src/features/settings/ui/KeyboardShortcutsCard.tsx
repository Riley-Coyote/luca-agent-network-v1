import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import {
  getShortcutsByCategory,
  type KeyboardShortcut,
} from "@/shared/lib/keyboard-shortcuts";
import { isMacPlatform } from "@/shared/lib/platform";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

type FramedShortcut = Omit<KeyboardShortcut, "category">;

/**
 * The keys as the app answers them under the shell's frame (SHELL_BUILD.md
 * WP-17, from the final flows review), in the rail's words. Every key here
 * was checked against the handler that answers it:
 * - AppShell's shortcut handler: ⌘K, ⌘N, ⇧⌘K, ⇧⌘N, ⇧⌘O, ⇧⌘A;
 * - QuickChatRoot: ⇧⌘L; useSettingsShortcuts and SettingsView: ⌘, and Escape;
 * - useBackForwardControls: ⌘[ and ⌘] (Alt+← and Alt+→ elsewhere);
 * - the sidebar provider: ⌘S; useChannelFind: ⌘F;
 * - useMarkAsReadShortcuts: Escape and ⇧Escape;
 * - the composer (useRichTextEditor, TipTap's StarterKit keymap): Enter,
 *   ⇧Enter, ⌘B, ⌘I, ⇧⌘S (strikethrough: the keymap's Mod-Shift-s), ⌘E, ⌘K;
 * - ptt_shortcut.rs: ⌃Space while a huddle is live;
 * - useWebviewZoomShortcuts: ⌘+, ⌘−, ⌘0.
 * The old list's Publish note (⌘Enter) has no handler, so it is not listed.
 */
const FRAMED_SHORTCUTS: { group: string; keys: FramedShortcut[] }[] = [
  {
    group: "Places",
    keys: [
      {
        id: "quick-search",
        label: "Search",
        description: "Find a conversation, a mind or a message",
        keys: "⌘K",
        keysWindows: "Ctrl+K",
      },
      {
        id: "new-conversation",
        label: "New conversation",
        description: "Start a conversation",
        keys: "⌘N",
        keysWindows: "Ctrl+N",
      },
      {
        id: "new-conversation-shift",
        label: "New conversation",
        description: "Also opens New conversation",
        keys: "⇧⌘K",
        keysWindows: "Shift+Ctrl+K",
      },
      {
        id: "quick-chat",
        label: "Quick Chat",
        description: "Open or close Quick Chat",
        keys: "⇧⌘L",
        keysWindows: "Shift+Ctrl+L",
      },
      {
        id: "start-room",
        label: "Start a room",
        description: "Open Start a room",
        keys: "⇧⌘N",
        keysWindows: "Shift+Ctrl+N",
      },
      {
        id: "browse-rooms",
        label: "Browse rooms",
        description: "Find a room to join",
        keys: "⇧⌘O",
        keysWindows: "Shift+Ctrl+O",
      },
      {
        id: "go-chats",
        label: "Chats",
        description: "Go to Chats",
        keys: "⇧⌘A",
        keysWindows: "Shift+Ctrl+A",
      },
      {
        id: "open-settings",
        label: "Settings",
        description: "Open or close Settings",
        keys: "⌘,",
        keysWindows: "Ctrl+,",
      },
      {
        id: "go-back",
        label: "Back",
        description: "Go to where you were",
        keys: "⌘[",
        keysWindows: "Alt+←",
      },
      {
        id: "go-forward",
        label: "Forward",
        description: "Go forward again",
        keys: "⌘]",
        keysWindows: "Alt+→",
      },
      {
        id: "toggle-sidebar",
        label: "Rail",
        description: "Show or hide the rail",
        keys: "⌘S",
        keysWindows: "Ctrl+S",
      },
    ],
  },
  {
    group: "Conversation",
    keys: [
      {
        id: "send-message",
        label: "Send",
        description: "Send the message",
        keys: "Enter",
        keysWindows: "Enter",
      },
      {
        id: "new-line",
        label: "New line",
        description: "Break the line in the message box",
        keys: "Shift+Enter",
        keysWindows: "Shift+Enter",
      },
      {
        id: "find-in-channel",
        label: "Find",
        description: "Find words in this conversation",
        keys: "⌘F",
        keysWindows: "Ctrl+F",
      },
      {
        id: "mark-current-read",
        label: "Mark as read",
        description: "Mark this conversation as read",
        keys: "Escape",
        keysWindows: "Escape",
      },
      {
        id: "mark-all-read",
        label: "Mark all as read",
        description: "Mark every conversation as read",
        keys: "⇧Escape",
        keysWindows: "Shift+Escape",
      },
      {
        id: "close-dialog",
        label: "Close",
        description: "Close a dialog, or Settings",
        keys: "Escape",
        keysWindows: "Escape",
      },
      {
        id: "push-to-talk",
        label: "Push to talk",
        description: "Hold to speak in a huddle",
        keys: "⌃Space",
        keysWindows: "Ctrl+Space",
      },
    ],
  },
  {
    group: "Formatting",
    keys: [
      {
        id: "format-bold",
        label: "Bold",
        description: "Bold the selected words",
        keys: "⌘B",
        keysWindows: "Ctrl+B",
      },
      {
        id: "format-italic",
        label: "Italic",
        description: "Italicise the selected words",
        keys: "⌘I",
        keysWindows: "Ctrl+I",
      },
      {
        id: "format-strikethrough",
        label: "Strikethrough",
        description: "Strike through the selected words",
        keys: "⇧⌘S",
        keysWindows: "Shift+Ctrl+S",
      },
      {
        id: "format-code",
        label: "Inline code",
        description: "Set the selected words as code",
        keys: "⌘E",
        keysWindows: "Ctrl+E",
      },
      {
        id: "format-link",
        label: "Link",
        description: "Link the selected words, or edit the link at the caret",
        keys: "⌘K",
        keysWindows: "Ctrl+K",
      },
    ],
  },
  {
    group: "Zoom",
    keys: [
      {
        id: "zoom-in",
        label: "Zoom in",
        description: "Make everything larger",
        keys: "⌘+",
        keysWindows: "Ctrl+=",
      },
      {
        id: "zoom-out",
        label: "Zoom out",
        description: "Make everything smaller",
        keys: "⌘-",
        keysWindows: "Ctrl+-",
      },
      {
        id: "zoom-reset",
        label: "Actual size",
        description: "Return to the usual size",
        keys: "⌘0",
        keysWindows: "Ctrl+0",
      },
    ],
  },
];

function KeyCombo({
  shortcut,
}: {
  shortcut: Pick<KeyboardShortcut, "keys" | "keysWindows">;
}) {
  const keys = isMacPlatform() ? shortcut.keys : shortcut.keysWindows;
  // Split on "+" but keep "+" as a standalone key (e.g. for zoom-in "⌘+")
  const parts = keys
    .split(/(?<!\+)\+(?!\s*$)/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <span className="flex items-center gap-1">
      {parts.map((part) => (
        <kbd
          className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border/70 bg-muted/60 px-1.5 font-mono text-xs text-muted-foreground"
          key={part}
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

export function KeyboardShortcutsCard() {
  const frame = useShellFrameEnabled();
  const categories = getShortcutsByCategory();

  if (frame) {
    return (
      <section className="min-w-0" data-testid="settings-shortcuts">
        <SettingsSectionHeader
          title="Keyboard shortcuts"
          description="The keys the app answers to. These can't be changed."
        />
        {FRAMED_SHORTCUTS.map(({ group, keys }) => (
          <div className="luca-settings-page-group" key={group}>
            <h2 className="type-eyebrow">{group}</h2>
            <SettingsOptionGroup>
              {keys.map((shortcut) => (
                <SettingsOptionRow
                  data-shortcut={shortcut.id}
                  key={shortcut.id}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">
                      {shortcut.label}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {shortcut.description}
                    </span>
                  </div>
                  <KeyCombo shortcut={shortcut} />
                </SettingsOptionRow>
              ))}
            </SettingsOptionGroup>
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="min-w-0" data-testid="settings-shortcuts">
      <SettingsSectionHeader
        title="Keyboard shortcuts"
        description="All available keyboard shortcuts. Shortcuts are read-only."
      />

      <div className="space-y-4">
        {[...categories.entries()].map(([category, shortcuts]) => (
          <div key={category}>
            <h2 className="mb-2 text-lg font-semibold tracking-tight">
              {category}
            </h2>
            <SettingsOptionGroup>
              {shortcuts.map((shortcut) => (
                <SettingsOptionRow
                  className="min-h-12 px-3 py-2"
                  key={shortcut.id}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">
                      {shortcut.label}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {shortcut.description}
                    </span>
                  </div>
                  <KeyCombo shortcut={shortcut} />
                </SettingsOptionRow>
              ))}
            </SettingsOptionGroup>
          </div>
        ))}
      </div>
    </section>
  );
}
