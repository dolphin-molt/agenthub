import test from "node:test";
import assert from "node:assert/strict";

import {
  createHostRoomState,
  registerHostConnection,
  acquireControllerLease,
} from "../src/objects/host-room.js";

test("a newer host connection generation replaces the old connection", () => {
  const initial = createHostRoomState({ hostId: "host_123" });
  const afterFirstConnect = registerHostConnection(initial, {
    connectionId: "conn_1",
    connectedAt: "2026-04-03T12:00:00.000Z",
  });
  const afterReconnect = registerHostConnection(afterFirstConnect, {
    connectionId: "conn_2",
    connectedAt: "2026-04-03T12:05:00.000Z",
  });

  assert.equal(afterReconnect.connection.connectionId, "conn_2");
  assert.equal(afterReconnect.connection.generation, 2);
  assert.equal(afterReconnect.status, "online");
});

test("controller lease acquisition fails when another controller is active", () => {
  const initial = createHostRoomState({ hostId: "host_123" });
  const afterFirstLease = acquireControllerLease(initial, {
    clientId: "client_ios_1",
    leaseId: "lease_1",
    grantedAt: "2026-04-03T12:00:00.000Z",
    expiresAt: "2026-04-03T12:10:00.000Z",
  });

  assert.equal(afterFirstLease.lease.clientId, "client_ios_1");

  assert.throws(
    () =>
      acquireControllerLease(afterFirstLease, {
        clientId: "client_web_1",
        leaseId: "lease_2",
        grantedAt: "2026-04-03T12:01:00.000Z",
        expiresAt: "2026-04-03T12:11:00.000Z",
      }),
    /active controller/i,
  );
});
