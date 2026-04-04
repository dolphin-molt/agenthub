import test from "node:test";
import assert from "node:assert/strict";

import { executeGatewayTurn } from "../gateway-turn-executor.mjs";

function createIdFactory() {
  let counter = 0;
  return (prefix) => `${prefix}_${String(++counter).padStart(3, "0")}`;
}

test("executeGatewayTurn persists a single assistant event while streaming partial updates", async () => {
  const hub = {
    collaboration: {
      threads: [],
      boards: [],
      tasks: [],
      sessions: [],
      events: [],
    },
  };
  const customAgents = [
    {
      id: "dolphin",
      name: "dolphin",
      runtime_profile: {
        runtime_family: "claude-code",
      },
    },
  ];

  const persistedBodies = [];
  const assistantUpdates = [];
  const timestamps = [
    "2026-04-03T13:00:00.000Z",
    "2026-04-03T13:00:01.000Z",
    "2026-04-03T13:00:02.000Z",
    "2026-04-03T13:00:03.000Z",
    "2026-04-03T13:00:04.000Z",
    "2026-04-03T13:00:05.000Z",
  ];

  const result = await executeGatewayTurn({
    hub,
    message: "stream this reply",
    threadId: null,
    agentId: "dolphin",
    source: "relay",
    createdFrom: "relay",
    customAgents,
    nextId: createIdFactory(),
    now: () => timestamps.shift() || "2026-04-03T13:00:05.000Z",
    writeHubConfig: async (nextHub) => {
      const assistantBodies = (nextHub.collaboration?.events || [])
        .filter((event) => event.event_type === "assistant_message")
        .map((event) => event.body);
      persistedBodies.push(assistantBodies.at(-1) || null);
    },
    onAssistantUpdate: async ({ phase, message: assistantMessage }) => {
      assistantUpdates.push({
        phase,
        id: assistantMessage.id,
        content: assistantMessage.content,
      });
    },
    runRuntimeTurn: async ({ onPartial }) => {
      await onPartial({
        rawText: "hello",
        runtimeSessionId: "runtime_123",
      });
      await onPartial({
        rawText: "hello world",
        runtimeSessionId: "runtime_123",
      });
      return {
        rawText: "hello world from gateway",
        runtimeSessionId: "runtime_123",
        metadata: { model: "claude-sonnet-4" },
      };
    },
  });

  assert.equal(result.agentId, "dolphin");
  assert.equal(result.runtimeSessionId, "runtime_123");
  assert.equal(result.userMessage.content, "stream this reply");
  assert.equal(result.assistantMessage.content, "hello world from gateway");

  assert.equal(
    hub.collaboration.events.filter((event) => event.event_type === "assistant_message").length,
    1,
  );

  assert.equal(new Set(assistantUpdates.map((item) => item.id)).size, 1);
  assert.deepEqual(
    assistantUpdates.map((item) => ({ phase: item.phase, content: item.content })),
    [
      { phase: "partial", content: "hello" },
      { phase: "partial", content: "hello world" },
      { phase: "complete", content: "hello world from gateway" },
    ],
  );
  assert.deepEqual(persistedBodies, [
    null,
    "hello",
    "hello world",
    "hello world from gateway",
  ]);
});
