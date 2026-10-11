import test from "node:test";
import assert from "node:assert/strict";
import { analysisTaskActivity, creationTaskVisible } from "../shared/tasks.mjs";
test("task bar hides completed or cancelled work and keeps pending, paused, in-flight and failed tasks actionable", () => {
  assert.deepEqual(analysisTaskActivity(null), {
    visible: false,
    pending: false,
  });
  const finished = {
    total: 3,
    done: 3,
    photoIds: [],
    runningIds: [],
    running: false,
    errors: 0,
  };
  assert.deepEqual(analysisTaskActivity(finished), {
    visible: false,
    pending: false,
  });
  assert.deepEqual(
    analysisTaskActivity({ ...finished, done: 1, paused: true }),
    { visible: false, pending: false },
  );
  for (const change of [
    { photoIds: ["a"], paused: true },
    { runningIds: ["a"] },
    { running: true },
  ]) {
    assert.deepEqual(analysisTaskActivity({ ...finished, ...change }), {
      visible: true,
      pending: true,
    });
  }
  assert.deepEqual(analysisTaskActivity({ ...finished, errors: 1 }), {
    visible: true,
    pending: false,
  });
  for (const state of ["done", "cancelled"])
    assert.equal(creationTaskVisible({ state }), false);
  for (const state of ["running", "paused", "error"])
    assert.equal(creationTaskVisible({ state }), true);
});
