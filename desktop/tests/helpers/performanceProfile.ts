import type { Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Opt-in diagnostic only; leave profiling off for comparable timing runs. */
export async function withPerformanceProfile<T>(
  page: Page,
  testInfo: TestInfo,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  if (process.env.POLYPHONIC_PERF_PROFILE !== "1") return work();
  const client = await page.context().newCDPSession(page);
  await client.send("Profiler.enable");
  await client.send("Profiler.start");
  try {
    return await work();
  } finally {
    const { profile } = await client.send("Profiler.stop");
    const path = testInfo.outputPath(`${name}.cpuprofile`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(profile));
    await testInfo.attach(`${name}.cpuprofile`, {
      path,
      contentType: "application/json",
    });
    await client.detach();
  }
}
