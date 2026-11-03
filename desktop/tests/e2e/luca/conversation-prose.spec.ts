import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

const channel = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

for (const mode of ["dark", "light"] as const) {
  test(`top blur stays at the surface edge in ${mode}`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      ({ key, mode }) => {
        localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
        localStorage.setItem(
          "buzz-theme",
          mode === "dark" ? "vitesse-black" : "paper",
        );
        localStorage.setItem("buzz-follow-system", "false");
      },
      { key: FEATURE_OVERRIDES_STORAGE_KEY, mode },
    );
    await installMockBridge(page, {
      managedAgents: [
        {
          name: "Luca",
          pubkey: TEST_IDENTITIES.bob.pubkey,
          status: "running",
          channelNames: ["bob-tyler"],
        },
      ],
    });
    await page.goto("/#/channels/7eb9f239-9393-50b0-bd76-d85eef0511c7");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "bob-tyler",
            }) ?? false,
        ),
      )
      .toBe(true);
    await page.evaluate((pubkey) => {
      for (let i = 0; i < 30; i++)
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "bob-tyler",
          pubkey,
          content: `Reading line ${i + 1}. The conversation stays sharp until it approaches the surface edge.\n\nOnly the words passing under the top edge soften away.`,
        });
    }, TEST_IDENTITIES.bob.pubkey);
    const edge = page.locator("[data-luca-top-edge] > .luca-top-edge");
    await expect(edge).toBeVisible();
    await expect(page.getByTestId("composer-agent-ledge")).toHaveCount(0);
    for (const width of [1440, 1280, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await expect(edge).toHaveCSS("height", "48px");
      const metrics = await edge.evaluate((el) => {
        const root = el.parentElement;
        const viewport = root?.querySelector("[data-luca-timeline-viewport]");
        if (!root || !viewport) throw new Error("Missing timeline edge host");
        return {
          rise: Number.parseFloat(
            getComputedStyle(root).getPropertyValue(
              "--luca-timeline-top-inset",
            ),
          ),
          fade: getComputedStyle(viewport).maskImage,
          ramp: Array.from(el.children, (child) =>
            getComputedStyle(child).getPropertyValue("--edge-in").trim(),
          ),
        };
      });
      expect(metrics.rise).toBeGreaterThan(48);
      expect(metrics.fade).toContain("48px");
      expect(metrics.ramp).toEqual(["0px", "8px", "16px", "24px", "32px"]);
      await page.locator("[data-luca-timeline-viewport]").evaluate((el) => {
        const scroller =
          el.querySelector("[data-testid='message-scroll-container']") ??
          el.firstElementChild;
        if (scroller) scroller.scrollTop = scroller.scrollHeight / 2;
      });
      await page.screenshot({
        path: info.outputPath(`edge-${mode}-${width}.png`),
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/#/settings?section=appearance");
    const sphere = page.getByTestId("composer-sphere-toggle");
    await expect(sphere).toHaveAttribute("aria-checked", "false");
    await sphere.click();
    await page.goto("/#/channels/7eb9f239-9393-50b0-bd76-d85eef0511c7");
    await expect(page.getByTestId("composer-agent-ledge")).toBeVisible();
    await page.goto("/#/settings?section=appearance");
    await page.getByTestId("composer-sphere-toggle").click();
    const settings = `/#/agents?profile=${TEST_IDENTITIES.bob.pubkey}&page=settings`;
    await page.goto(settings);
    const picker = page.getByTestId("agent-chat-picture-input");
    await picker.setInputFiles({
      name: "avatar.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
    await expect(page.getByRole("alert")).toContainText("PNG, JPG, or WebP");
    await picker.setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: readFileSync(
        new URL("../../../src-tauri/icons/128x128.png", import.meta.url),
      ),
    });
    await expect(
      page.getByTestId("agent-chat-picture").locator("img"),
    ).toBeVisible();
    const pictureShape = await page
      .getByTestId("agent-chat-picture")
      .locator("img")
      .evaluate((el) => ({
        radius: getComputedStyle(el).borderRadius,
        width: el.getBoundingClientRect().width,
      }));
    expect(Number.parseFloat(pictureShape.radius)).toBeGreaterThanOrEqual(
      pictureShape.width / 2,
    );
    await page.screenshot({
      path: info.outputPath(`picture-settings-${mode}.png`),
      animations: "disabled",
    });
    await page.reload();
    await expect(
      page.getByTestId("agent-chat-picture").locator("img"),
    ).toBeVisible();
    await page.goto("/#/channels/7eb9f239-9393-50b0-bd76-d85eef0511c7");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "bob-tyler",
            }) ?? false,
        ),
      )
      .toBe(true);
    await page.evaluate(
      (pubkey) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "bob-tyler",
          pubkey,
          content: "Your chosen picture stays with this conversation.",
        }),
      TEST_IDENTITIES.bob.pubkey,
    );
    await expect(page.locator(".luca-presence-face img")).toHaveAttribute(
      "src",
      /^data:image\/webp;base64,/,
    );
    await expect(page.getByTestId("composer-agent-ledge")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`picture-chat-${mode}.png`),
      animations: "disabled",
    });
    await page.goto(settings);
    await page
      .getByRole("button", { name: "Use agent mark", exact: true })
      .click();
    await page.goto("/#/channels/7eb9f239-9393-50b0-bd76-d85eef0511c7");
    await expect(page.locator(".luca-presence-face img")).toHaveCount(0);
    await expect(page.locator(".luca-presence-face canvas")).toBeVisible();
  });
}

const sample = `A small, verified update—not a redesign.

## What changed

The conversation keeps its familiar shape. **The answer leads**, with supporting detail underneath and an [ordinary link](https://example.com) when useful.

- One short point.
- Another point with \`inlineCode()\`.
  - A nested detail stays with its parent.

1. Review the result.

   This supporting paragraph belongs to the first step.

   A second paragraph must stay separate, not run into the first.

2. Continue when ready.

### A concrete example

\`\`\`typescript
const message = await companion.ask("What changed?");
console.log(message);
\`\`\`

> Keep the explanation readable.
>
> Keep the second paragraph distinct.

| Surface | Result |
| --- | --- |
| Main conversation | Same reading rhythm |
| Mini chat | Compact, not a different language |

#### A smaller section

No heading is smaller than the words it introduces.`;

for (const mode of ["dark", "light"] as const) {
  for (const dpr of [1, 2]) {
    test.describe(`${mode} at ${dpr}x`, () => {
      test.use({ deviceScaleFactor: dpr, reducedMotion: "reduce" });
      for (const surface of ["main", "popout"] as const) {
        test(`${surface}: structured replies retain hierarchy and fit`, async ({
          page,
        }, info) => {
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.addInitScript(
            ({ key, mode }) => {
              localStorage.setItem(
                key,
                JSON.stringify({ "shell-frame": true }),
              );
              localStorage.setItem(
                "buzz-theme",
                mode === "dark" ? "vitesse-black" : "paper",
              );
              localStorage.setItem("buzz-follow-system", "false");
              localStorage.setItem("polyphonic-frame", "solid");
            },
            { key: FEATURE_OVERRIDES_STORAGE_KEY, mode },
          );
          await installMockBridge(page, {
            managedAgents: [
              {
                name: "Luca",
                pubkey: TEST_IDENTITIES.bob.pubkey,
                status: "running",
                channelNames: ["general"],
              },
            ],
          });
          const query =
            surface === "popout" ? `?window=popout&channel=${channel}` : "";
          await page.goto(`/${query}#/channels/${channel}`);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
                    channelName: "general",
                  }) ?? false,
              ),
            )
            .toBe(true);
          await page.evaluate(
            ({ content, pubkey }) =>
              window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
                channelName: "general",
                content,
                pubkey,
              }),
            { content: sample, pubkey: TEST_IDENTITIES.bob.pubkey },
          );
          const prose = page
            .locator(".message-markdown")
            .filter({ hasText: "A small, verified update" })
            .last();
          await expect(prose).toContainText("No heading is smaller");
          const row = prose.locator(
            "xpath=ancestor::*[@data-testid='message-row']",
          );
          const expand = row.getByTestId("message-body-expand");
          if (await expand.isVisible()) await expand.click();
          const loose = prose.locator("ol > li").first();
          await expect(loose.locator(":scope > p")).toHaveCount(3);
          expect(
            await loose
              .locator("p")
              .first()
              .evaluate((el) => getComputedStyle(el).display),
          ).toBe("block");
          await expect(prose.locator("ul ul")).toHaveCount(1);
          const sizes = await prose.evaluate((el) => {
            const size = (node: Element | null) =>
              Number.parseFloat(getComputedStyle(node ?? el).fontSize);
            return {
              body: size(el),
              heading: size(el.querySelector("h4")),
              code: size(el.querySelector("li code")),
              leading:
                Number.parseFloat(getComputedStyle(el).lineHeight) / size(el),
            };
          });
          expect(sizes.heading).toBeGreaterThanOrEqual(sizes.body);
          expect(sizes.code / sizes.body).toBeCloseTo(0.875, 2);
          expect(sizes.leading).toBeCloseTo(1.6, 1);
          for (const width of [1440, 1280, 1024, 390]) {
            await page.setViewportSize({
              width,
              height: width === 390 ? 844 : 900,
            });
            await prose.locator("h2").scrollIntoViewIfNeeded();
            await page.mouse.move(1, 1);
            await page.screenshot({
              path: info.outputPath(`${surface}-${mode}-${width}-${dpr}x.png`),
              animations: "disabled",
            });
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
            ).toBe(true);
            await prose.locator("table").scrollIntoViewIfNeeded();
            await page.screenshot({
              path: info.outputPath(
                `${surface}-${mode}-${width}-${dpr}x-detail.png`,
              ),
              animations: "disabled",
            });
          }
          const copy = prose.getByRole("button", { name: "Copy code block" });
          await copy.focus();
          await expect(copy).toBeFocused();
          await expect(copy).toHaveCSS("opacity", "1");
          for (const [preference, expected] of [
            ["large", 18],
            ["small", 14],
          ] as const) {
            await page.evaluate(
              (value) =>
                document.documentElement.setAttribute(
                  "data-message-text",
                  value,
                ),
              preference,
            );
            await expect(prose).toHaveCSS("font-size", `${expected}px`);
            await expect(prose.locator("h4")).toHaveCSS(
              "font-size",
              `${expected}px`,
            );
          }
          expect(errors).toEqual([]);
        });
      }
    });
  }
}
