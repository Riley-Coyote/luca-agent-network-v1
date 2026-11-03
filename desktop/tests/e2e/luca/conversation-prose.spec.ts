import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

const channel = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
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
