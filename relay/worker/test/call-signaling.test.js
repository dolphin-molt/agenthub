import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { createMemoryRelayStorage } from "../src/storage.js";

async function readJson(response) {
  return response.json();
}

test("client can create a relay audio call and fetch its status", async () => {
  const storage = createMemoryRelayStorage();

  await worker.fetch(
    new Request("https://relay.example/api/pairing/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteId: "invite_voice",
        host: {
          hostId: "host_123",
          displayName: "MacBook Pro",
          status: "online",
          lastSeenAt: "2026-04-04T02:20:00.000Z",
          capabilities: ["turns", "voice"],
        },
        code: "PAIR-VOICE",
        createdAt: "2026-04-04T02:20:00.000Z",
        expiresAt: "2026-04-04T02:25:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  await worker.fetch(
    new Request("https://relay.example/api/pairing/invites/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "PAIR-VOICE",
        clientId: "client_ios_1",
        claimedAt: "2026-04-04T02:20:30.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  const createResponse = await worker.fetch(
    new Request("https://relay.example/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId: "call_voice_1",
        clientId: "client_ios_1",
        hostId: "host_123",
        sessionId: "thread_123",
        mode: "audio",
        state: "dialing",
        createdAt: "2026-04-04T02:21:00.000Z",
        updatedAt: "2026-04-04T02:21:00.000Z",
        mediaConfig: {
          voice: {
            providerId: "volcengine",
            modelId: "doubao-realtime-asr",
          },
          video: {
            providerId: "googleapis",
            modelId: "gemini-2.5-flash",
          },
        },
      }),
    }),
    { RELAY_STORAGE: storage },
  );
  const createPayload = await readJson(createResponse);

  assert.equal(createResponse.status, 200);
  assert.equal(createPayload.call.callId, "call_voice_1");
  assert.equal(createPayload.call.state, "dialing");
  assert.equal(createPayload.call.mediaConfig.voice.providerId, "volcengine");
  assert.equal(createPayload.call.mediaConfig.video.modelId, "gemini-2.5-flash");

  const eventResponse = await worker.fetch(
    new Request("https://relay.example/api/hosts/host_123/calls/call_voice_1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: "live",
        updatedAt: "2026-04-04T02:21:12.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );
  const eventPayload = await readJson(eventResponse);

  assert.equal(eventResponse.status, 200);
  assert.equal(eventPayload.call.state, "live");

  const statusResponse = await worker.fetch(
    new Request("https://relay.example/api/clients/client_ios_1/calls/call_voice_1"),
    { RELAY_STORAGE: storage },
  );
  const statusPayload = await readJson(statusResponse);

  assert.equal(statusResponse.status, 200);
  assert.equal(statusPayload.call.state, "live");
  assert.equal(statusPayload.call.mode, "audio");
  assert.equal(statusPayload.call.mediaConfig.voice.modelId, "doubao-realtime-asr");
});

test("host can fetch the active relay call and client can end it", async () => {
  const storage = createMemoryRelayStorage();

  await worker.fetch(
    new Request("https://relay.example/api/pairing/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteId: "invite_voice_2",
        host: {
          hostId: "host_123",
          displayName: "MacBook Pro",
          status: "online",
          lastSeenAt: "2026-04-04T02:30:00.000Z",
          capabilities: ["turns", "voice"],
        },
        code: "PAIR-VOICE-2",
        createdAt: "2026-04-04T02:30:00.000Z",
        expiresAt: "2026-04-04T02:35:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  await worker.fetch(
    new Request("https://relay.example/api/pairing/invites/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "PAIR-VOICE-2",
        clientId: "client_ios_2",
        claimedAt: "2026-04-04T02:30:30.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  await worker.fetch(
    new Request("https://relay.example/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId: "call_voice_2",
        clientId: "client_ios_2",
        hostId: "host_123",
        sessionId: "thread_456",
        mode: "audio",
        state: "dialing",
        createdAt: "2026-04-04T02:31:00.000Z",
        updatedAt: "2026-04-04T02:31:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  const activeResponse = await worker.fetch(
    new Request("https://relay.example/api/hosts/host_123/calls/active"),
    { RELAY_STORAGE: storage },
  );
  const activePayload = await readJson(activeResponse);

  assert.equal(activeResponse.status, 200);
  assert.equal(activePayload.call.callId, "call_voice_2");
  assert.equal(activePayload.call.state, "dialing");

  const endResponse = await worker.fetch(
    new Request("https://relay.example/api/clients/client_ios_2/calls/call_voice_2/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updatedAt: "2026-04-04T02:31:20.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );
  const endPayload = await readJson(endResponse);

  assert.equal(endResponse.status, 200);
  assert.equal(endPayload.call.state, "ended");
});
