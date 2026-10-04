import test from "node:test";
import assert from "node:assert/strict";
import { validTask, readBackup } from "../src/lib/task-validation.ts";
const task = {
  id: "t1",
  title: "Call partner",
  day: "2026-09-29",
  comment: "Follow up",
  done: 0,
};
test("valid dates and completion states", () => {
  assert.ok(validTask(task));
  assert.ok(validTask({ ...task, day: "2028-02-29", done: 1 }));
  assert.equal(validTask({ ...task, day: "2026-02-29" }), false);
  assert.equal(validTask({ ...task, done: 2 }), false);
});
test("reject unsafe IDs and invalid content", () => {
  assert.equal(validTask({ ...task, id: "bad/id" }), false);
  assert.equal(validTask({ ...task, title: " " }), false);
  assert.equal(validTask({ ...task, comment: "x".repeat(10001) }), false);
});
test("backup preserves task fields and rejects duplicates", () => {
  assert.deepEqual(readBackup({ tasks: [task] }), [task]);
  assert.throws(() => readBackup([task, task]));
  assert.throws(() => readBackup({ tasks: [{ ...task, day: "wrong" }] }));
});
