import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  symlink,
  mkdir,
  rm,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/database.mjs";
import { resetLibrary } from "../server/reset-library.mjs";
test("explicit business reset preserves configuration and credentials and never follows external source paths or symlinks", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "wall-reset-")),
    root = path.join(parent, "deployment"),
    outside = path.join(parent, "my-originals");
  try {
    await mkdir(outside);
    await writeFile(path.join(outside, "source.jpg"), "original");
    const s = new Store(root);
    s.put("settings", { id: "ai", model: "keep" });
    s.put("account", { id: "admin", password: "hash" });
    s.put("photo", {
      id: "p",
      projectId: "old",
      originalPath: path.join(outside, "source.jpg"),
    });
    s.close();
    await mkdir(path.join(root, "secrets"));
    await writeFile(path.join(root, "secrets", "master.key"), "preserve");
    await symlink(outside, path.join(root, "creations"));
    await writeFile(path.join(root, "originals", "p.jpg"), "copy");
    assert.equal((await resetLibrary(root)).removedPhotos, 1);
    const restored = new Store(root);
    assert.equal(restored.all("photo").length, 0);
    assert.equal(restored.get("settings", "ai").model, "keep");
    assert.equal(restored.get("account", "admin").password, "hash");
    restored.close();
    assert.equal(
      await readFile(path.join(outside, "source.jpg"), "utf8"),
      "original",
    );
    assert.equal(
      await readFile(path.join(root, "secrets", "master.key"), "utf8"),
      "preserve",
    );
    await assert.rejects(access(path.join(root, "originals", "p.jpg")));
    assert.equal((await resetLibrary(root)).removedPhotos, 0);
    await assert.rejects(resetLibrary("/"), /独立数据目录/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
