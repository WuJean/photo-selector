import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  generateImage,
  normalizeImageConfig,
} from "../server/image-generation.mjs";
test("image adapter uses native protocol with one image, reference bytes and configured size; downloads decoded local bytes", async () => {
  const config = normalizeImageConfig(
    {},
    { baseURL: "https://example.com/v1" },
  );
  assert.equal(config.model, "wan2.7-image");
  assert.equal(normalizeImageConfig({}, null).keyBaseURL, undefined);
  assert.equal(config.keyBaseURL, "https://example.com/v1");
  assert.throws(() =>
    normalizeImageConfig({ endpoint: "http://external.test" }),
  );
  const bytes = await sharp({
    create: { width: 300, height: 400, channels: 3, background: "#99bb99" },
  })
    .png()
    .toBuffer();
  let request;
  const result = await generateImage(config, "secret", {
    prompt: "封面",
    images: [bytes],
    fetchImpl: async (url, options) => {
      if (url === config.endpoint) {
        request = JSON.parse(options.body);
        assert.equal(options.headers.Authorization, "Bearer secret");
        return Response.json({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: "https://result.test/image.png" }],
                },
              },
            ],
          },
        });
      }
      assert.equal(options.headers, undefined);
      return new Response(bytes);
    },
  });
  assert.equal(request.model, "wan2.7-image");
  assert.equal(request.parameters.n, 1);
  assert.equal(request.parameters.size, "1536*2048");
  assert.equal(request.input.messages[0].content.length, 2);
  assert.equal((await sharp(result).metadata()).width, 300);
});
test("generation errors and unknown outcomes never automatically resubmit; cancelled jobs reject", async () => {
  const config = normalizeImageConfig();
  let calls = 0;
  await assert.rejects(
    () =>
      generateImage(config, null, {
        prompt: "test",
        fetchImpl: async () => {
          calls++;
          throw new Error("network");
        },
      }),
    /结果未知/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      generateImage(config, null, {
        prompt: "test",
        fetchImpl: async () => new Response("{}", { status: 401 }),
      }),
    /HTTP 401/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() =>
    generateImage(config, null, {
      prompt: "test",
      signal: controller.signal,
      fetchImpl: () => assert.fail("cancelled dispatched"),
    }),
  );
});

test("a failed download can resume from the persisted image URL without paying for another generation", async () => {
  const config = normalizeImageConfig();
  let savedURL,
    posts = 0;
  await assert.rejects(
    () =>
      generateImage(config, null, {
        prompt: "cover",
        onOutput: (url) => {
          savedURL = url;
        },
        fetchImpl: async (url, options) => {
          if (options.method === "POST") {
            posts++;
            return Response.json({
              output: {
                choices: [
                  {
                    message: {
                      content: [{ image: "https://image.test/result.png" }],
                    },
                  },
                ],
              },
            });
          }
          return new Response("", { status: 503 });
        },
      }),
    /下载失败/,
  );
  const bytes = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  await generateImage(config, null, {
    prompt: "cover",
    resultURL: savedURL,
    fetchImpl: async (url, options) => {
      assert.equal(options.method, undefined);
      return new Response(bytes);
    },
  });
  assert.equal(posts, 1);
});
