import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveShellFrameEnabled,
  shellFrameOnByDefault,
} from "./shellFrame.ts";

describe("resolveShellFrameEnabled", () => {
  it("is off by default", () => {
    assert.equal(resolveShellFrameEnabled({}, undefined), false);
  });

  it("follows the preview override", () => {
    assert.equal(resolveShellFrameEnabled({ "shell-frame": true }, ""), true);
    assert.equal(resolveShellFrameEnabled({ "shell-frame": false }, ""), false);
  });

  it("is on in a build made with VITE_LUCA_SHELL_FRAME=1", () => {
    assert.equal(resolveShellFrameEnabled({}, "1"), true);
    assert.equal(resolveShellFrameEnabled({ "shell-frame": false }, "1"), true);
  });

  it("ignores other build values", () => {
    assert.equal(resolveShellFrameEnabled({}, "0"), false);
    assert.equal(resolveShellFrameEnabled({}, "true"), false);
  });

  it("is off in a build made with it when the classic layout is chosen", () => {
    assert.equal(resolveShellFrameEnabled({}, "1", true), false);
    assert.equal(
      resolveShellFrameEnabled({ "shell-frame": true }, "1", true),
      false,
    );
    assert.equal(resolveShellFrameEnabled({}, "1", false), true);
  });

  it("never reads the classic layout where the shell is off by default", () => {
    assert.equal(resolveShellFrameEnabled({}, undefined, true), false);
    assert.equal(
      resolveShellFrameEnabled({ "shell-frame": true }, undefined, true),
      true,
    );
  });
});

describe("shellFrameOnByDefault", () => {
  it("is true only in a build made with VITE_LUCA_SHELL_FRAME=1", () => {
    assert.equal(shellFrameOnByDefault("1"), true);
    assert.equal(shellFrameOnByDefault(undefined), false);
    assert.equal(shellFrameOnByDefault(""), false);
    assert.equal(shellFrameOnByDefault("%VITE_LUCA_SHELL_FRAME%"), false);
  });
});
