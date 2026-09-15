/// <reference types="vite/client" />

/**
 * The version in `package.json`, stamped in at build time by `vite.config.ts`.
 *
 * The crash boundary is the reason this exists: when the native bridge is what
 * broke, `getVersion()` is exactly the call that will not answer, and a bug
 * report without a build number is most of the way to useless.
 */
declare const __APP_VERSION__: string;
