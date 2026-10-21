import test from "node:test";
import assert from "node:assert/strict";
import {
  AIClient,
  normalizeConfig,
  validateAnalysis,
  validateRecommendation,
  endpoint,
  parseJSON,
  Vault,
} from "../server/ai.mjs";
const config = normalizeConfig({
  baseURL: "https://example.com/v1/",
  model: "vision-model",
});
const payload = (value) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }),
    { status: 200 },
  );
test("configuration validates addresses, supports local model and does not contain secrets", () => {
  assert.equal(config.baseURL, "https://example.com/v1");
  assert.equal(endpoint(config), "https://example.com/v1/chat/completions");
  assert.equal(
    normalizeConfig({ baseURL: "http://localhost:1234/v1", model: "local" })
      .model,
    "local",
  );
  assert.throws(() =>
    normalizeConfig({ baseURL: "http://example.com", model: "x" }),
  );
  assert.throws(() =>
    normalizeConfig({ baseURL: "https://key@example.com", model: "x" }),
  );
  assert.equal(
    normalizeConfig({ ...config, apiKey: "secret" }).apiKey,
    undefined,
  );
});
test("AI image request is real multimodal and parsed into validated labels with usage", async () => {
  let request;
  const client = new AIClient(config, "secret", {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return payload({
        description: "雪山下的人像",
        tags: ["雪山", "人像"],
        shot: "远景",
        people: 1,
      });
    },
  });
  const result = await client.analyze(Buffer.from("image"));
  assert.equal(result.shot, "远景");
  const body = JSON.parse(request.options.body);
  assert.match(
    body.messages[1].content[1].image_url.url,
    /^data:image\/jpeg;base64,/,
  );
  assert.equal(request.options.headers.Authorization, "Bearer secret");
  assert.equal(client.usage.prompt_tokens, 5);
});
test("malformed JSON and rate limiting retry; authentication never retries; cancellation stops requests", async () => {
  let calls = 0;
  const client = new AIClient(config, "secret", {
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response("", { status: 429 });
      if (calls === 2)
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "bad JSON" } }] }),
        );
      return payload({ description: "山", tags: ["雪山"] });
    },
  });
  await client.analyze(Buffer.from("image"));
  assert.equal(calls, 3);
  calls = 0;
  const auth = new AIClient(config, "secret", {
    sleep: async () => {},
    fetchImpl: async () => {
      calls++;
      return new Response("", { status: 401 });
    },
  });
  await assert.rejects(() => auth.analyze(Buffer.from("image")), /认证失败/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => client.analyze(Buffer.from("image"), { signal: controller.signal }),
    /取消/,
  );
  assert.equal(calls, 1);
  let offlineCalls = 0;
  const offline = new AIClient(config, "secret", {
    sleep: async () => {},
    fetchImpl: async () => {
      offlineCalls++;
      throw new Error("offline");
    },
  });
  await assert.rejects(() => offline.analyze(Buffer.from("image")), /offline/);
  assert.equal(offlineCalls, 3);
});
test("recommendations reject invented photos, duplicates and missing locks", () => {
  const candidates = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.equal(
    validateRecommendation(
      { template: "rows", photoIds: ["a", "b", "c"], reason: "搭配" },
      candidates,
      ["a"],
    ).photoIds.length,
    3,
  );
  assert.throws(() =>
    validateRecommendation(
      { template: "rows", photoIds: ["a", "b", "fake"] },
      candidates,
    ),
  );
  assert.throws(() =>
    validateRecommendation(
      { template: "rows", photoIds: ["a", "a", "c"] },
      candidates,
    ),
  );
  assert.throws(() =>
    validateRecommendation(
      { template: "rows", photoIds: ["a", "b", "c"] },
      candidates,
      ["d"],
    ),
  );
  assert.throws(() =>
    validateAnalysis({ description: "山", tags: "not array" }),
  );
  assert.equal(parseJSON('```json\n{"ok":true}\n```').ok, true);
});
test("non-mac key fallback is memory-only and isolated per endpoint", async () => {
  const vault = new Vault({ available: false });
  await vault.set(config, "test-secret");
  assert.equal(await vault.get(config), "test-secret");
  assert.equal(await new Vault({ available: false }).get(config), null);
  await vault.remove(config);
  assert.equal(await vault.get(config), null);
});

test("visual request timeout is reported without automatically resending the images", async () => {
  let calls = 0;
  const client = new AIClient(config, "secret", {
    fetchImpl: async () => {
      calls++;
      throw new DOMException("timeout", "TimeoutError");
    },
    sleep: async () => assert.fail("timed out request retried"),
  });
  await assert.rejects(
    () => client.complete([], (v) => v, { timeoutMs: 180000 }),
    /超时/,
  );
  assert.equal(calls, 1);
});

test("local Qwen profile uses bounded sequential defaults and sufficient JSON output without cloud fallback", async () => {
  const local = normalizeConfig({
    baseURL: "http://127.0.0.1:8765/v1",
    model: "qwen3.6:35b",
    profile: "local-qwen",
  });
  assert.equal(local.analysisConcurrency, 1);
  assert.equal(local.serviceConcurrency, 1);
  assert.throws(
    () => normalizeConfig({ ...local, baseURL: "https://cloud.example/v1" }),
    /本机/,
  );
  let body, address;
  const client = new AIClient(local, "local-key", {
    fetchImpl: async (url, options) => {
      address = url;
      body = JSON.parse(options.body);
      return payload({ ok: true });
    },
  });
  await client.complete([{ role: "user", content: "JSON" }], (v) => v);
  assert.equal(address, "http://127.0.0.1:8765/v1/chat/completions");
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.context_size, 16384);
  assert.equal(body.think, false);
});
