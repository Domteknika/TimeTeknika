import test from "node:test";
import assert from "node:assert/strict";
import { layoutCalendarDay } from "../src/lib/calendar-layout.ts";

function entry(key, topHour, endHour, running = false) {
  return { key, topHour, endHour, start: topHour * 3600000, end: running ? null : endHour * 3600000 };
}

test("React calendar lays out overlapping short bars separately from full-width blocks", () => {
  const { blocks, markers } = layoutCalendarDay([
    entry("running", 8.4, 8.4, true),
    entry("follow-up", 8.26, 8.261),
    entry("plans", 8, 9.5),
    entry("call", 8.25, 8.251),
  ], 50, 7, 18, 14);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].key, "plans");
  assert.equal(blocks[0].top, 50);
  assert.equal(blocks[0].height, 72);
  assert.equal(blocks[0].columns, 1);
  assert.deepEqual(markers.map(segment => segment.key), ["call", "follow-up", "running"]);
  assert.equal(markers[0].top, 62.5);
  assert.ok(markers.every(segment => segment.height === 2));
  assert.deepEqual(markers.map(({ column, columns }) => [column, columns]), [[0, 2], [1, 2], [0, 1]]);
});

test("React calendar preserves the scale near the end of the displayed range", () => {
  const { blocks, markers } = layoutCalendarDay([
    entry("last", 17.999, 18),
    entry("out of range", 18.5, 19),
  ], 50, 7, 18, 18);
  assert.deepEqual(blocks, []);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].height, 2);
  assert.equal(markers[0].top + markers[0].height, 550);
});
