// Fixed px on purpose: the top chrome strip hosts the fixed-size macOS
// traffic lights and the px-pinned nav buttons (see `AppTopChrome`), so its
// height must not follow the Cmd +/- rem text scale either. Deliberate
// exception to the rem-first rule.
//
// 32px is the tightest height that still centres the native traffic lights:
// they are 12px tall, so `trafficLightPosition.y` in `tauri.conf.json` is 10
// ((32 - 12) / 2). These two values are a pair — changing one without the
// other makes the lights overflow the strip onto the content below.
export const TOP_CHROME_HEIGHT_DEFAULT = "32px";
export const CHANNEL_CONTENT_TOP_PADDING_DEFAULT = "5.75rem";
export const NATIVE_TRAFFIC_LIGHT_INSET_DEFAULT = "80px";

export const chromeCssVars = {
  topChromeHeight: "--buzz-top-chrome-height",
  channelContentTopPadding: "--buzz-channel-content-top-padding",
  nativeTrafficLightInset: "--buzz-native-traffic-light-inset",
} as const;

export const chromeCssVarDefaults = {
  [chromeCssVars.topChromeHeight]: TOP_CHROME_HEIGHT_DEFAULT,
  [chromeCssVars.channelContentTopPadding]: CHANNEL_CONTENT_TOP_PADDING_DEFAULT,
  [chromeCssVars.nativeTrafficLightInset]: NATIVE_TRAFFIC_LIGHT_INSET_DEFAULT,
} as const;

export const channelContentTopPaddingMeasurement = {
  cssVariable: chromeCssVars.channelContentTopPadding,
  resetValue: chromeCssVarDefaults[chromeCssVars.channelContentTopPadding],
} as const;

/** Tailwind class fragments for content below the in-flow global top chrome. */
export const topChromeInset = {
  /** Absolute/fixed top offset inside the content row. */
  top: "top-0",
  /** Content now sits below the global chrome in normal layout flow. */
  padding: "pt-0",
  /** `after:` pseudo-element top offset. */
  afterTop: "after:top-0",
  /** Horizontal divider at the top edge of the content row. */
  divider:
    "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border/35 before:content-['']",
  /** Shared header backdrop and bottom border below the inset row. */
  headerBase:
    "relative z-40 shrink-0 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55",
  /** Vertical pane divider starting at the top of the content row. */
  verticalDivider:
    "after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:top-0 after:z-40 after:w-px after:bg-border/35 after:content-['']",
} as const;

/** Tailwind class fragments for the global top chrome backdrop strip. */
export const topChromeBackdrop = {
  /** Height matching the global top chrome search/drag strip. */
  height: "h-(--buzz-top-chrome-height,32px)",
  /** `after:` pseudo-element offset aligned to the bottom of top chrome. */
  dividerTop: "after:top-(--buzz-top-chrome-height,32px)",
} as const;

/** Tailwind class fragments for measured channel header chrome. */
export const channelChrome = {
  /** Padding-top that clears the measured channel header chrome. */
  contentPadding: "pt-(--buzz-channel-content-top-padding,5.75rem)",
  /** Absolute/fixed top offset below the measured channel header chrome. */
  top: "top-(--buzz-channel-content-top-padding,5.75rem)",
  /** Height matching the measured channel header chrome. */
  headerHeight: "h-(--buzz-channel-content-top-padding,5.75rem)",
  /** Negative margin for overlaid channel chrome that should not affect flow. */
  negativeMargin: "-mb-(--buzz-channel-content-top-padding,5.75rem)",
} as const;
