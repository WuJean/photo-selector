import { test, expect } from "@playwright/test";
import { writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
test("development file serving cannot bypass private-data authentication", async ({
  page,
}) => {
  const file = path.resolve(".local", `security-probe-${randomUUID()}.txt`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "test-only-private-data");
  try {
    for (const resource of [file, path.resolve("server/database.mjs")]) {
      const response = await page.request.get(
        encodeURI("/@fs/" + resource) + "?raw",
      );
      expect(response.status()).toBe(403);
      expect(await response.text()).not.toContain("test-only-private-data");
    }
    expect((await page.request.get("/api/assets")).status()).toBe(401);
  } finally {
    await rm(file, { force: true });
  }
});
