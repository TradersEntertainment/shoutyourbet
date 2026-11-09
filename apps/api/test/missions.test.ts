import { test } from "node:test";
import assert from "node:assert/strict";
import { activeMissionForRoom, canTalkAnytime, dailyTalkCap, dayKey, missionsForDay, nextMission, trDayStart, trTime } from "@syb/shared";

// helpers: build an instant from a Türkiye wall-clock time
const tr = (iso: string) => Date.parse(`${iso}+03:00`);

test("Türkiye day boundaries (UTC+3)", () => {
  assert.equal(dayKey(tr("2026-11-09T23:59:00")), "2026-11-09");
  assert.equal(dayKey(tr("2026-11-10T00:00:00")), "2026-11-10");
  // 22:30 UTC is already the next day in Türkiye
  assert.equal(dayKey(Date.parse("2026-11-09T22:30:00Z")), "2026-11-10");
  assert.equal(trDayStart(tr("2026-11-09T15:00:00")), tr("2026-11-09T00:00:00"));
  assert.equal(trTime(tr("2026-11-09T21:05:00")), "21:05");
});

test("weekday missions don't run on weekends", () => {
  const mon = missionsForDay(tr("2026-11-09T12:00:00")).map((m) => m.id); // Monday
  const sat = missionsForDay(tr("2026-11-14T12:00:00")).map((m) => m.id); // Saturday
  assert.ok(mon.includes("bist-open") && mon.includes("us-open"));
  assert.ok(!sat.includes("bist-open") && !sat.includes("us-open"));
  assert.ok(sat.includes("btc-evening") && sat.includes("night-crypto"));
});

test("active mission only in its room and window", () => {
  assert.equal(activeMissionForRoom("inst-BTC", tr("2026-11-09T21:00:00"))?.id, "btc-evening");
  assert.equal(activeMissionForRoom("inst-BTC", tr("2026-11-09T21:59:59"))?.id, "btc-evening");
  assert.equal(activeMissionForRoom("inst-BTC", tr("2026-11-09T22:00:00")), null); // end is exclusive
  assert.equal(activeMissionForRoom("inst-BTC", tr("2026-11-09T20:59:59")), null);
  assert.equal(activeMissionForRoom("inst-ETH", tr("2026-11-09T21:30:00")), null); // wrong room
  assert.equal(activeMissionForRoom("inst-BIST", tr("2026-11-14T10:30:00")), null); // Saturday
});

test("next mission rolls over to the next day after the last one", () => {
  assert.equal(nextMission(tr("2026-11-09T12:00:00"))?.id, "us-open");
  const late = nextMission(tr("2026-11-09T23:50:00"));
  assert.equal(late?.id, "bist-open");
  assert.equal(late?.day, "2026-11-10");
  // Friday night -> Saturday has no BIST, first is btc-evening
  assert.equal(nextMission(tr("2026-11-13T23:50:00"))?.id, "btc-evening");
});

test("daily cap follows the best owned mic; anytime only for epic+", () => {
  assert.equal(dailyTalkCap([]), 0);
  assert.equal(dailyTalkCap(["common"]), 15 * 60);
  assert.equal(dailyTalkCap(["common", "rare", "uncommon"]), 40 * 60);
  assert.equal(dailyTalkCap(["legendary", "common"]), 90 * 60);
  assert.deepEqual(
    (["common", "uncommon", "rare", "epic", "legendary"] as const).map(canTalkAnytime),
    [false, false, false, true, true],
  );
});
