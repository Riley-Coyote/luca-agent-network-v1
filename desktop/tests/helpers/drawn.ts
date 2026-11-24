import type { Page } from "@playwright/test";

/**
 * What the browser really drew, for checks that have to be measured from the
 * render and not read off a stylesheet: a colour through a see-through fill,
 * a disabled control's opacity, a ring over whatever is behind it.
 */
export type Rgb = [number, number, number];

function luminance([r, g, b]: Rgb) {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** The WCAG contrast ratio of two drawn colours, to two places. */
export function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * The colour at each point of the viewport (CSS pixels), read from one
 * screenshot. The picture is decoded in the page, on a canvas that is never
 * attached, so nothing on the page changes.
 */
export async function pixels(
  page: Page,
  points: { x: number; y: number }[],
): Promise<Rgb[]> {
  const shot = (
    await page.screenshot({ animations: "disabled", type: "png" })
  ).toString("base64");
  return page.evaluate(
    async ({ shot, points }) => {
      const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / window.innerWidth;
      return points.map(({ x, y }) => {
        const data = context.getImageData(
          Math.round(x * scale),
          Math.round(y * scale),
          1,
          1,
        ).data;
        return [data[0], data[1], data[2]] as [number, number, number];
      });
    },
    { shot, points },
  );
}
