import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const desktopDirectory = process.cwd();
const repoDirectory = path.resolve(desktopDirectory, "..");
const dmgBackgroundSha256 =
  "64ac83d8e5e2cd3630ba8653fb0774985a2874ec7a2ab83df6be46a739eaabbb";

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.resolve(desktopDirectory, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

test("Luca public package and native bundle identity are locked", () => {
  const packageJson = readJson("package.json");
  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  const deepLink = tauriConfig.plugins as {
    "deep-link": { desktop: { schemes: string[] } };
  };

  expect(packageJson.name).toBe("luca-agent-network");
  expect(tauriConfig.productName).toBe("Luca");
  expect(tauriConfig.identifier).toBe("com.luca.agent-network");
  expect(deepLink["deep-link"].desktop.schemes).toEqual(["luca"]);
});

test("Luca bundles generated icons, a dark Luca DMG background, and Buzz attribution", () => {
  const requiredIcons = [
    "src-tauri/icons/icon.svg",
    "src-tauri/icons/icon.png",
    "src-tauri/icons/icon.icns",
    "src-tauri/icons/icon.ico",
    "src-tauri/icons/32x32.png",
    "src-tauri/icons/128x128.png",
    "src-tauri/icons/128x128@2x.png",
    "src-tauri/icons/icon.iconset/icon_512x512@2x.png",
    "src-tauri/icons/ios/AppIcon-512@2x.png",
    "src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png",
  ];

  for (const icon of requiredIcons) {
    expect(existsSync(path.resolve(desktopDirectory, icon))).toBe(true);
  }

  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  const bundle = tauriConfig.bundle as {
    icon: string[];
    macOS: { dmg: { background: string } };
  };
  const dmgBackground = path.resolve(
    desktopDirectory,
    "src-tauri",
    bundle.macOS.dmg.background,
  );
  expect(bundle.macOS.dmg.background).toBe("icons/dmg-background.png");
  expect(bundle.icon).not.toContain("icons/buzz-source.png");
  expect(
    createHash("sha256").update(readFileSync(dmgBackground)).digest("hex"),
  ).toBe(dmgBackgroundSha256);

  const notice = readFileSync(path.resolve(repoDirectory, "NOTICE"), "utf8");
  const license = readFileSync(path.resolve(repoDirectory, "LICENSE"), "utf8");
  expect(notice).toContain("Buzz");
  expect(notice).toContain("Block, Inc.");
  expect(notice).toContain("Apache License, Version 2.0");
  expect(license).toContain("Apache License");
});
