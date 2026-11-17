import test from "node:test";
import assert from "node:assert/strict";
import {
  zoneInstant,
  wallTime,
  midnight,
  shiftDay,
  editedInstant,
} from "../src/lib/time.ts";
test("React time: Zurich conversion preserves seconds and DST day lengths", () => {
  const timestamp = Date.parse("2026-11-17T09:10:37Z");
  assert.equal(wallTime(timestamp), "2026-11-17T10:10:37");
  assert.equal(zoneInstant("2026-11-17T10:10:37"), timestamp);
  assert.equal(midnight("2026-03-30") - midnight("2026-03-29"), 23 * 3600000);
  assert.equal(midnight("2026-10-26") - midnight("2026-10-25"), 25 * 3600000);
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.throws(() => zoneInstant("2026-03-29T02:30"), /n’existe pas/);
  assert.throws(() => zoneInstant("2026-02-30T12:00"), /invalide/);
});
test("Editing the description preserves either occurrence of an ambiguous autumn time", () => {
  for (const text of ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"]) {
    const original = Date.parse(text);
    assert.equal(editedInstant("2026-10-25T02:30", original), original);
  }
});
