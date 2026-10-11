import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault } from "../server/vault.mjs";
import { accessPolicy } from "../server/access.mjs";
import { normalizeConfig } from "../server/ai.mjs";

test("encrypted fallback retains isolated service keys across restarts and deletes durably", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "photo-vault-"));
  try {
    const native = { available: false };
    const config = { baseURL: "https://example.com/v1" };
    const other = { baseURL: "https://another.example/v1" };
    const vault = new Vault(native, { root });
    await Promise.all([
      vault.set(config, "fixture-secret-one"),
      vault.set(other, "fixture-secret-two"),
    ]);
    const file = path.join(root, "secrets/credentials.enc");
    assert.equal(readFileSync(file, "utf8").includes("fixture-secret"), false);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(
      statSync(path.join(root, "secrets/master.key")).mode & 0o777,
      0o600,
    );
    const restarted = new Vault(native, { root });
    assert.equal(restarted.storage, "本地加密凭据");
    assert.equal(await restarted.get(config), "fixture-secret-one");
    assert.equal(await restarted.get(other), "fixture-secret-two");
    await restarted.remove(config);
    assert.equal(await new Vault(native, { root }).get(config), null);
    const saved = readFileSync(file, "utf8");
    const corrupt = JSON.parse(saved);
    corrupt.tag = Buffer.alloc(16).toString("base64");
    writeFileSync(file, JSON.stringify(corrupt));
    assert.throws(() => new Vault(native, { root }), /无法读取加密凭据/);
    writeFileSync(file, saved);
    unlinkSync(path.join(root, "secrets/master.key"));
    assert.throws(() => new Vault(native, { root }), /密钥文件缺失/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function check(policy, host, origin) {
  let status = 200;
  policy(
    {
      headers: { host, ...(origin ? { origin } : {}) },
      socket: { localPort: 4173 },
    },
    {
      status(code) {
        status = code;
        return this;
      },
      json() {},
    },
    () => {},
  );
  return status;
}
test("Docker published ports and proxy origins are explicit, unrelated origins and hosts rejected", () => {
  const local = accessPolicy("http://localhost:4180");
  assert.equal(check(local, "localhost:4180", "http://localhost:4180"), 200);
  assert.equal(check(local, "127.0.0.1:4180", "http://127.0.0.1:4180"), 200);
  assert.equal(check(local, "[::1]:4180", "http://[::1]:4180"), 200);
  assert.equal(check(local, "localhost:4173"), 200);
  assert.equal(check(local, "localhost:4180", "https://evil.example"), 403);
  assert.equal(check(local, "evil.example"), 403);
  const proxy = accessPolicy("https://photos.example.com");
  assert.equal(
    check(proxy, "photos.example.com", "https://photos.example.com"),
    200,
  );
  assert.equal(
    check(proxy, "photos.example.com", "http://photos.example.com"),
    403,
  );
  assert.equal(check(proxy, "photos.example.com", "null"), 403);
  assert.equal(check(accessPolicy(), "localhost:4180"), 403);
  assert.throws(() => accessPolicy("https://user:secret@example.com"));
  assert.throws(() => accessPolicy("https://example.com/photos"));
  assert.equal(
    normalizeConfig({
      baseURL: "http://host.docker.internal:11434/v1",
      model: "local",
    }).model,
    "local",
  );
});
