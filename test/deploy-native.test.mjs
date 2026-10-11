import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deploymentConfig,
  privateAddresses,
} from "../scripts/deploy-config.mjs";
import { accessPolicy } from "../server/access.mjs";
const nic = {
  en0: [{ family: "IPv4", internal: false, address: "192.168.1.10" }],
  lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
};
test("deployment defaults expose a precise LAN origin, preserve file values and prefer shell configuration", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "deploy-config-"));
  try {
    const c = deploymentConfig(root, {}, nic);
    assert.equal(c.host, "0.0.0.0");
    assert.equal(c.port, 4173);
    assert.equal(c.publicURL, "http://192.168.1.10:4173");
    assert.deepEqual(privateAddresses(nic), ["192.168.1.10"]);
    writeFileSync(
      path.join(root, ".env"),
      'PHOTO_SELECTOR_PORT=4180\nPHOTO_SELECTOR_BIND=127.0.0.1\nPHOTO_SELECTOR_PUBLIC_URL=https://photos.example.com\nPHOTO_SELECTOR_DATA_DIR="my photos"\n',
    );
    const explicit = deploymentConfig(root, {}, nic);
    assert.equal(explicit.host, "127.0.0.1");
    assert.equal(explicit.port, 4180);
    assert.equal(explicit.publicURL, "https://photos.example.com");
    assert.equal(explicit.dataDir, path.join(root, "my photos"));
    const shell = deploymentConfig(
      root,
      { PHOTO_SELECTOR_PORT: "4190", HOST: "0.0.0.0" },
      nic,
    );
    assert.equal(shell.port, 4190);
    assert.equal(shell.host, "0.0.0.0");
    assert.throws(() => deploymentConfig(root, { PORT: "bad" }, nic), /端口/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("LAN origins are explicit and validated, foreign hosts and origins remain blocked", () => {
  const policy = accessPolicy(
    "http://192.168.1.10:4173",
    "http://localhost:4173,http://192.168.1.11:4173",
  );
  const check = (host, origin) => {
    let status = 200;
    policy(
      { headers: { host, origin }, socket: { localPort: 4173 } },
      {
        status(n) {
          status = n;
          return this;
        },
        json() {},
      },
      () => {},
    );
    return status;
  };
  assert.equal(check("192.168.1.10:4173", "http://192.168.1.10:4173"), 200);
  assert.equal(check("192.168.1.11:4173", "http://192.168.1.11:4173"), 200);
  assert.equal(check("localhost:4173", "http://localhost:4173"), 200);
  assert.equal(check("evil.example", "http://evil.example"), 403);
  assert.equal(check("192.168.1.10:4173", "http://evil.example"), 403);
  assert.throws(() => accessPolicy("http://0.0.0.0:4173"), /访问地址/);
  assert.throws(() => accessPolicy("", "https://*.example.com"), /访问地址/);
  assert.throws(() => accessPolicy("", "http://localhost/private"), /访问地址/);
});
