import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { createMemoryRelayStorage } from "../src/storage.js";

async function readJson(response) {
  return response.json();
}

test("relay turn progress updates are visible from client polling before completion", async () => {
  const storage = createMemoryRelayStorage();

  const submitResponse = await worker.fetch(
    new Request("https://relay.example/api/turns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "client_ios_1",
        hostId: "host_123",
        sessionId: "thread_123",
        message: "stream progress",
        createdAt: "2026-04-03T12:10:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );
  const submitPayload = await readJson(submitResponse);

  await worker.fetch(
    new Request("https://relay.example/api/hosts/host_123/turns/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimedAt: "2026-04-03T12:10:02.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  const progressResponse = await worker.fetch(
    new Request(
      `https://relay.example/api/hosts/host_123/turns/${submitPayload.turn.turnId}/progress`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeSessionId: "runtime_123",
          agentId: "dolphin",
          assistantMessage: {
            id: "msg_assistant_1",
            role: "assistant",
            content: "hello wor",
            timestamp: "2026-04-03T12:10:04.000Z",
            agentId: "dolphin",
          },
          updatedAt: "2026-04-03T12:10:04.000Z",
        }),
      },
    ),
    { RELAY_STORAGE: storage },
  );

  assert.equal(progressResponse.status, 200);

  const statusResponse = await worker.fetch(
    new Request(`https://relay.example/api/clients/client_ios_1/turns/${submitPayload.turn.turnId}`),
    { RELAY_STORAGE: storage },
  );
  const statusPayload = await readJson(statusResponse);

  assert.equal(statusResponse.status, 200);
  assert.equal(statusPayload.turn.status, "processing");
  assert.equal(statusPayload.turn.runtimeSessionId, "runtime_123");
  assert.equal(statusPayload.turn.assistantMessage?.content, "hello wor");
});
