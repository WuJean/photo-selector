import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler, workers } from "../server/scheduler.mjs";
test("shared service slots bound concurrent workers; cancellation drops queued work and 429 reduces capacity", async () => {
  const s = new Scheduler();
  let active = 0,
    peak = 0;
  const seen = [];
  await Promise.all(
    [0, 1].map((group) => {
      let i = 0;
      return workers(
        8,
        () => (i < 8 ? i++ : null),
        (id) =>
          s.run("service", 3, null, async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5 + (id % 3) * 3));
            seen.push(`${group}-${id}`);
            active--;
          }),
      );
    }),
  );
  assert.equal(peak, 3);
  assert.equal(new Set(seen).size, 16);
  const controller = new AbortController();
  let release;
  const hold = s.run("other", 1, null, () => new Promise((r) => (release = r)));
  await new Promise((r) => setImmediate(r));
  const cancelled = s.run("other", 1, controller.signal, () =>
    assert.fail("cancelled request dispatched"),
  );
  controller.abort();
  await assert.rejects(cancelled, /取消/);
  release();
  await hold;
  s.limited("service", 1);
  assert.equal(s.state("service", 3).limit, 1);
});
