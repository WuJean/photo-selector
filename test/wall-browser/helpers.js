import { expect } from "@playwright/test";
import sharp from "sharp";
export const password = "fixture-password-123";
export async function login(page) {
  await page.goto("/");
  await page.getByLabel("管理员密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "每一张，值得留下" }),
  ).toBeVisible();
}
export async function jpeg() {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: "#93a989" },
  })
    .jpeg()
    .toBuffer();
}
export async function folderFixture(page, files) {
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("旅行", { create: true });
    for (const item of files) {
      const handle = await dir.getFileHandle(item.name, { create: true });
      const writer = await handle.createWritable();
      await writer.write(new Uint8Array(item.bytes));
      await writer.close();
    }
    window.showDirectoryPicker = async () => dir;
  }, files);
}
