import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

const anima = "a".repeat(64);
const vektor = "b".repeat(64);

async function openPlaceFixture(
  page: Page,
  holdAnima = false,
  residentAuthored = false,
) {
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Anima",
        pubkey: anima,
        agentCommand: "claude",
        status: "running",
      },
      {
        name: "Vektor",
        pubkey: vektor,
        agentCommand: "codex",
        status: "running",
      },
    ],
  });
  // The roster opens its first Place eagerly, so install this fixture elsewhere.
  await page.goto("/?e2e=mock#/inbox");
  await expect(
    page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: "Agents", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    ({ anima, vektor, holdAnima, residentAuthored }) => {
      type Content = {
        introduction: string;
        exploration: string;
        selectedWork: { artifactId: string; version: number } | null;
      };
      type Place = {
        residentPubkey: string;
        revision: number;
        residentEditingEnabled: boolean;
        visibility: "private";
        content: Content;
        author: { kind: "owner" | "resident"; pubkey: string } | null;
        updatedAt: number | null;
        selectedWork: {
          artifactId: string;
          version: number;
          title: string;
          kind: string;
          conversationId: string | null;
          availability: "available" | "unavailable";
        } | null;
      };
      type Fixture = {
        places: Record<string, Place>;
        calls: string[];
        holdAnima: boolean;
        releaseAnima?: () => void;
      };
      const host = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            payload?: unknown,
            options?: unknown,
          ) => Promise<unknown>;
        };
        placeFixture: Fixture;
      };
      const original = host.__TAURI_INTERNALS__.invoke.bind(
        host.__TAURI_INTERNALS__,
      );
      const makePlace = (residentPubkey: string): Place => ({
        residentPubkey,
        revision: 0,
        residentEditingEnabled: false,
        visibility: "private",
        content: { introduction: "", exploration: "", selectedWork: null },
        author: null,
        updatedAt: null,
        selectedWork: null,
      });
      host.placeFixture = {
        places: { [anima]: makePlace(anima), [vektor]: makePlace(vektor) },
        calls: [],
        holdAnima,
      };
      if (holdAnima)
        host.placeFixture.places[anima].content.introduction = "Anima only";
      if (residentAuthored) {
        host.placeFixture.places[anima] = {
          ...host.placeFixture.places[anima],
          revision: 2,
          content: {
            introduction:
              "I keep returning to the shape of small decisions: where a thought pauses, what it leaves visible, and what can still be changed.",
            exploration:
              "A set of quiet HTML studies about annotation, memory, and the space between drafts.",
            selectedWork: { artifactId: "artifact-1", version: 3 },
          },
          author: { kind: "resident", pubkey: anima },
          updatedAt: 1_757_796_000,
          selectedWork: {
            artifactId: "artifact-1",
            version: 3,
            title: "Intervals — study 03",
            kind: "html",
            conversationId: "conversation-1",
            availability: "available",
          },
        };
      }
      host.__TAURI_INTERNALS__.invoke = async (command, payload, options) => {
        if (command === "get_resident_place") {
          const { residentPubkey } = payload as { residentPubkey: string };
          host.placeFixture.calls.push(`get:${residentPubkey}`);
          if (residentPubkey === anima && host.placeFixture.holdAnima) {
            await new Promise<void>((resolve) => {
              host.placeFixture.releaseAnima = resolve;
            });
          }
          return structuredClone(host.placeFixture.places[residentPubkey]);
        }
        if (command === "update_resident_place") {
          const { residentPubkey, input } = payload as {
            residentPubkey: string;
            input: { expectedRevision: number; content: Content };
          };
          host.placeFixture.calls.push(
            `update:${residentPubkey}:${input.expectedRevision}`,
          );
          const current = host.placeFixture.places[residentPubkey];
          if (input.expectedRevision !== current.revision)
            throw "resident_place_conflict: changed";
          const next = {
            ...current,
            revision: current.revision + 1,
            content: input.content,
            author: { kind: "owner" as const, pubkey: "owner" },
            updatedAt: 1_757_796_000,
          };
          next.selectedWork = input.content.selectedWork
            ? {
                ...input.content.selectedWork,
                title: "A quiet study",
                kind: "html",
                conversationId: "conversation-1",
                availability: "available",
              }
            : null;
          host.placeFixture.places[residentPubkey] = next;
          return structuredClone(next);
        }
        if (command === "set_resident_place_editing") {
          const { residentPubkey, expectedRevision, enabled } = payload as {
            residentPubkey: string;
            expectedRevision: number;
            enabled: boolean;
          };
          host.placeFixture.calls.push(
            `editing:${residentPubkey}:${expectedRevision}:${enabled}`,
          );
          const current = host.placeFixture.places[residentPubkey];
          if (expectedRevision !== current.revision)
            throw "resident_place_conflict: changed";
          const next = {
            ...current,
            revision: current.revision + 1,
            residentEditingEnabled: enabled,
          };
          host.placeFixture.places[residentPubkey] = next;
          return structuredClone(next);
        }
        if (command === "list_resident_place_work") {
          host.placeFixture.calls.push(
            `work:${(payload as { residentPubkey: string }).residentPubkey}`,
          );
          return [
            {
              artifactId: "artifact-1",
              version: 3,
              title: "A quiet study",
              kind: "html",
              conversationId: "conversation-1",
              availability: "available",
            },
          ];
        }
        return original(command, payload, options);
      };
    },
    { anima, vektor, holdAnima, residentAuthored },
  );
  await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await expect(page.getByTestId(`agent-library-row-${anima}`)).toBeVisible();
}

test("owner authors a private place and pins one exact work version", async ({
  page,
}) => {
  await openPlaceFixture(page);
  await expect(page.getByTestId("resident-place-empty")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Let Anima edit this place" }),
  ).toHaveAttribute("data-state", "unchecked");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { placeFixture: { calls: string[] } })
          .placeFixture.calls,
    ),
  ).not.toContain(`work:${anima}`);

  await page.getByRole("button", { name: "Edit place" }).click();
  await page.getByLabel("Introduction").fill("I make small, careful studies.");
  await page.getByLabel("Exploring").fill("The spaces between two notes.");
  await page.getByRole("button", { name: "Choose work" }).click();
  await page.getByLabel("Selected work").selectOption("0");
  await page.getByRole("button", { name: "Save place" }).click();
  await expect(page.getByTestId("resident-place-introduction")).toHaveText(
    "I make small, careful studies.",
  );
  await expect(page.getByTestId("resident-place-author")).toContainText(
    "Edited by you",
  );
  await expect(page.getByTestId("resident-place-selected-work")).toContainText(
    "version 3",
  );
  await page.getByRole("switch", { name: "Let Anima edit this place" }).click();
  await expect(
    page.getByRole("switch", { name: "Let Anima edit this place" }),
  ).toHaveAttribute("data-state", "checked");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { placeFixture: { calls: string[] } })
          .placeFixture.calls,
    ),
  ).toContain(`editing:${anima}:1:true`);
});

test("conflict keeps the owner draft until Reload latest is chosen", async ({
  page,
}) => {
  await openPlaceFixture(page);
  await expect(page.getByTestId("resident-place-empty")).toBeVisible();
  await page.getByRole("button", { name: "Edit place" }).click();
  await page.getByLabel("Introduction").fill("My unsaved draft");
  await page.evaluate((pubkey) => {
    const host = window as unknown as {
      placeFixture: {
        places: Record<
          string,
          { revision: number; content: { introduction: string } }
        >;
      };
    };
    host.placeFixture.places[pubkey].revision = 1;
    host.placeFixture.places[pubkey].content.introduction = "New resident text";
  }, anima);
  await page.getByRole("button", { name: "Save place" }).click();
  await expect(page.getByLabel("Introduction")).toHaveValue("My unsaved draft");
  await expect(
    page.getByRole("button", { name: "Reload latest" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();
  await expect(page.getByLabel("Introduction")).toHaveValue(
    "New resident text",
  );
});

test("late reads from one resident cannot appear in another place", async ({
  page,
}) => {
  await openPlaceFixture(page, true);
  await expect(page.getByText("Opening private place…")).toBeVisible();
  await page.getByTestId(`agent-library-row-${vektor}`).click();
  await expect(page.getByTestId("resident-place-empty")).toBeVisible();
  await page.evaluate(() => {
    const host = window as unknown as {
      placeFixture: { releaseAnima?: () => void };
    };
    host.placeFixture.releaseAnima?.();
  });
  await expect(page.getByTestId("resident-place-introduction")).toHaveCount(0);
  await expect(page.getByTestId("resident-place-empty")).toBeVisible();
});

test("visual specimen: resident-authored Place at wide and narrow widths", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openPlaceFixture(page, false, true);
  await expect(page.getByTestId("resident-place-author")).toContainText(
    "Written by Anima",
  );
  await expect(page.getByTestId("resident-place-selected-work")).toContainText(
    "version 3",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("place-authored-wide.png") });
  await page.setViewportSize({ width: 780, height: 760 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("place-authored-narrow.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
