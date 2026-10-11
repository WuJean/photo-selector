import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { wechatConfig } from "../scripts/wechat-config.mjs";
test("public mini-program builds use safe example defaults and explicit personal overrides", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wechat-config-"));
  try {
    assert.deepEqual(await wechatConfig({ root, environment: {} }), {
      appId: "touristappid",
      envId: "",
      projectDir: "",
    });
    await assert.rejects(
      wechatConfig({ root, environment: {}, required: true }),
      /云环境/,
    );
    await mkdir(path.join(root, "wechat"));
    await writeFile(
      path.join(root, "wechat/config.local.json"),
      JSON.stringify({
        appId: "wx-example",
        envId: "example-environment",
        projectDir: "/example/project",
      }),
    );
    const local = await wechatConfig({ root, environment: {}, required: true });
    assert.equal(local.envId, "example-environment");
    const overridden = await wechatConfig({
      root,
      environment: { WECHAT_ENV_ID: "test-environment" },
    });
    assert.equal(overridden.envId, "test-environment");
    assert.equal(overridden.appId, "wx-example");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
