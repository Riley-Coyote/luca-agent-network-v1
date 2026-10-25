import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProfileAvatar } from "../../profile/ui/ProfileAvatar.tsx";
import { SHELL_AVATAR_DISC_CLASS } from "./SidebarProfileCard.tsx";

// The shell's avatar (SHELL_BUILD.md, WP-01b, decision 1): one disc at the
// ink at 14%, never the profile card's two stacked fills.
function renderShellAvatar() {
  return renderToStaticMarkup(
    createElement(ProfileAvatar, {
      avatarUrl: null,
      className: SHELL_AVATAR_DISC_CLASS,
      label: "Riley",
      plain: true,
      testId: "shell-profile-avatar",
    }),
  );
}

test("the shell avatar paints its disc once, at the ink at 14%", () => {
  const html = renderShellAvatar();
  assert.equal(html.split("bg-[hsl(var(--mn-ink)/0.14)]").length - 1, 1);
  assert.doesNotMatch(html, /bg-primary\/20/);
  assert.doesNotMatch(html, /shadow-xs/);
});

test("the shell avatar's initial is text-xs, its fallback clear", () => {
  const html = renderShellAvatar();
  assert.match(html, /text-xs/);
  assert.doesNotMatch(html, /text-2xs/);
  const fallback = html.match(/<[^>]*"shell-profile-avatar-fallback"[^>]*>/);
  assert.ok(fallback, html);
  assert.match(fallback[0], /bg-transparent/);
  assert.match(html, /shell-profile-avatar-fallback[^<]*>R</);
});

test("the profile card's own avatar keeps its fill", () => {
  const html = renderToStaticMarkup(
    createElement(ProfileAvatar, {
      avatarUrl: null,
      className: "h-full w-full text-xs",
      label: "Riley",
    }),
  );
  assert.match(html, /bg-primary\/20/);
});
