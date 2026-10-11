import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { lstat, rm, writeFile, unlink } from "node:fs/promises";
import { Store } from "./database.mjs";
const directories = [
  "originals",
  "thumbs",
  "previews",
  "temp",
  "assets",
  "creations",
  "shares",
  "analysis-previews",
  "backups",
];
export async function resetLibrary(directory) {
  const root = path.resolve(directory);
  if ([path.parse(root).root, os.homedir(), process.cwd()].includes(root))
    throw new Error("请指定本次部署的独立数据目录");
  const info = await lstat(root),
    db = await lstat(path.join(root, "library.sqlite"));
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    !db.isFile() ||
    db.isSymbolicLink()
  )
    throw new Error("数据目录或数据库不能是符号链接");
  const lock = path.join(root, ".reset-in-progress");
  await writeFile(lock, String(Date.now()), { flag: "wx", mode: 0o600 });
  let store;
  try {
    store = new Store(root);
    const count = store.all("photo").length;
    store.transaction(() => {
      store.db
        .prepare(
          "DELETE FROM documents WHERE kind NOT IN ('settings','account','session','migration','resetOperation','pairingPreset','preset')",
        )
        .run();
      store.put("resetOperation", {
        id: "photo-wall",
        completedAt: new Date().toISOString(),
        removedPhotos: count,
      });
    });
    // Only managed children of this data root; rm unlinks symlinks without following them.
    for (const name of directories)
      await rm(path.join(root, name), { recursive: true, force: true });
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
    return {
      removedPhotos: count,
      preserved: ["settings", "credentials", "administrator"],
    };
  } finally {
    store?.close();
    await unlink(lock).catch(() => {});
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "先停止本次部署，再执行 node server/reset-library.mjs --confirm；仅清理 PHOTO_SELECTOR_DATA_DIR，保留服务配置、凭据和管理员。",
    );
    process.exitCode = 1;
  } else {
    try {
      console.log(
        JSON.stringify(
          await resetLibrary(process.env.PHOTO_SELECTOR_DATA_DIR || ".local"),
        ),
      );
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
  }
}
