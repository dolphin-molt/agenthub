import test from "node:test";
import assert from "node:assert/strict";

import { startCollaborationLiveSync } from "./collaboration-live-sync.ts";

test("starts with an immediate refresh and keeps polling until cleanup", () => {
  const timerCalls: Array<{ callback: () => void; intervalMs: number }> = [];
  const clearedTimers: unknown[] = [];
  let refreshCount = 0;

  const stop = startCollaborationLiveSync(
    () => {
      refreshCount += 1;
    },
    {
      intervalMs: 2500,
      clock: {
        setInterval(callback, intervalMs) {
          const handle = { callback, intervalMs };
          timerCalls.push(handle);
          return handle;
        },
        clearInterval(handle) {
          clearedTimers.push(handle);
        },
      },
    },
  );

  assert.equal(refreshCount, 1, "live sync should refresh immediately when it starts");
  assert.equal(timerCalls.length, 1, "live sync should register one interval");
  assert.equal(timerCalls[0]?.intervalMs, 2500, "live sync should use the requested polling cadence");

  timerCalls[0]?.callback();
  assert.equal(refreshCount, 2, "polling callback should trigger additional refreshes");

  stop();
  assert.equal(clearedTimers.length, 1, "cleanup should clear the active interval");
  assert.equal(clearedTimers[0], timerCalls[0], "cleanup should clear the exact interval handle");
});
