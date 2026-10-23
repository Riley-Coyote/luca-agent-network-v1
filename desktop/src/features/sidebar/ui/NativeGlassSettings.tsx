import * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * Apple's glass settings, shown only in native glass test builds
 * (NativeRailGlass.tsx): what the card and the rail's selection are made of,
 * how the selection reaches a row, and the floor beneath them. Kept on this
 * Mac only; NativeRailGlass hands them to the glass whenever they change.
 */

export type NativeGlassChoice = {
  material: "clear" | "smoked" | "dark";
  motion: "pour" | "drop" | "slide";
  floor: "plain" | "grain";
};

const STORAGE_KEY = "polyphonic.native-glass";
export const NATIVE_GLASS_SETTINGS_EVENT = "polyphonic-native-glass-settings";
const DEFAULT_CHOICE: NativeGlassChoice = {
  material: "clear",
  motion: "pour",
  floor: "plain",
};

export function readNativeGlassChoice(): NativeGlassChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...DEFAULT_CHOICE, ...stored };
  } catch {
    return DEFAULT_CHOICE;
  }
}

function writeNativeGlassChoice(choice: NativeGlassChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Without storage the choice still applies, for this launch.
  }
  window.dispatchEvent(
    new CustomEvent(NATIVE_GLASS_SETTINGS_EVENT, { detail: choice }),
  );
}

const announced = () =>
  Boolean(
    (window as Window & { __POLYPHONIC_NATIVE_GLASS__?: number })
      .__POLYPHONIC_NATIVE_GLASS__,
  );

const GROUPS: {
  key: keyof NativeGlassChoice;
  label: string;
  note: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "material",
    label: "Material",
    note: "Clear is the truest glass; Dark is closest to the black card.",
    options: [
      { value: "clear", label: "Clear" },
      { value: "smoked", label: "Smoked" },
      { value: "dark", label: "Dark" },
    ],
  },
  {
    key: "motion",
    label: "Motion",
    note: "How the selection reaches a row.",
    options: [
      { value: "pour", label: "Pour" },
      { value: "drop", label: "Drop" },
      { value: "slide", label: "Slide" },
    ],
  },
  {
    key: "floor",
    label: "Floor",
    note: "A fine grain gives the glass something to bend.",
    options: [
      { value: "plain", label: "Plain" },
      { value: "grain", label: "Grain" },
    ],
  },
];

export function NativeGlassSettings() {
  const [visible, setVisible] = React.useState(announced);
  const [choice, setChoice] = React.useState(readNativeGlassChoice);

  React.useEffect(() => {
    if (visible) return;
    const show = () => setVisible(true);
    window.addEventListener("polyphonic-native-glass", show);
    if (announced()) show();
    return () => window.removeEventListener("polyphonic-native-glass", show);
  }, [visible]);

  if (!visible) return null;

  const choose = (key: keyof NativeGlassChoice, value: string) => {
    const next = { ...choice, [key]: value } as NativeGlassChoice;
    setChoice(next);
    writeNativeGlassChoice(next);
  };

  return (
    <div
      className="mb-6 flex flex-col gap-3"
      data-testid="settings-native-glass"
    >
      <div>
        <p className="text-sm font-medium">Apple glass</p>
        <p className="text-xs text-muted-foreground">
          This test build draws the card and the rail's selection in Apple's
          real glass.
        </p>
      </div>
      {GROUPS.map((group) => (
        <div className="flex flex-col gap-1.5" key={group.key}>
          <div className="flex items-center gap-3">
            <span className="w-16 text-xs text-muted-foreground">
              {group.label}
            </span>
            <div className="flex gap-2">
              {group.options.map((option) => (
                <button
                  aria-pressed={choice[group.key] === option.value}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                    choice[group.key] === option.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                  data-testid={`native-glass-${group.key}-${option.value}`}
                  key={option.value}
                  onClick={() => choose(group.key, option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="pl-[4.75rem] text-xs text-muted-foreground">
            {group.note}
          </p>
        </div>
      ))}
    </div>
  );
}
