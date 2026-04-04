import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { createMemoryRelayStorage } from "../src/storage.js";

async function readJson(response) {
  return response.json();
}

test("GET /health returns relay service metadata", async () => {
  const response = await worker.fetch(new Request("https://relay.example/health"));
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: true,
    service: "agenthub-relay",
  });
});

test("pairing invite claim flow returns paired hosts for the client", async () => {
  const storage = createMemoryRelayStorage();

  const createInviteResponse = await worker.fetch(
    new Request("https://relay.example/api/pairing/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteId: "invite_123",
        host: {
          hostId: "host_123",
          displayName: "MacBook Pro",
          status: "online",
          lastSeenAt: "2026-04-03T11:59:00.000Z",
          capabilities: ["turns"],
        },
        code: "PAIR-123",
        createdAt: "2026-04-03T12:00:00.000Z",
        expiresAt: "2026-04-03T12:05:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  assert.equal(createInviteResponse.status, 200);

  const claimResponse = await worker.fetch(
    new Request("https://relay.example/api/pairing/invites/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "PAIR-123",
        clientId: "client_ios_1",
        claimedAt: "2026-04-03T12:01:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  assert.equal(claimResponse.status, 200);

  const hostsResponse = await worker.fetch(
    new Request("https://relay.example/api/clients/client_ios_1/hosts"),
    { RELAY_STORAGE: storage },
  );
  const payload = await readJson(hostsResponse);

  assert.equal(hostsResponse.status, 200);
  assert.equal(payload.hosts.length, 1);
  assert.equal(payload.hosts[0].hostId, "host_123");
  assert.equal(payload.hosts[0].displayName, "MacBook Pro");
});

test("pairing invite accepts legacy host name and connectedAt fields", async () => {
  const storage = createMemoryRelayStorage();

  const createInviteResponse = await worker.fetch(
    new Request("https://relay.example/api/pairing/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteId: "invite_legacy",
        host: {
          hostId: "host_legacy",
          name: "Legacy Mac",
          status: "online",
          connectedAt: "2026-04-03T11:59:00.000Z",
          capabilities: ["turns"],
        },
        code: "PAIR-LEGACY",
        createdAt: "2026-04-03T12:00:00.000Z",
        expiresAt: "2026-04-03T12:05:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  assert.equal(createInviteResponse.status, 200);

  const claimResponse = await worker.fetch(
    new Request("https://relay.example/api/pairing/invites/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "PAIR-LEGACY",
        clientId: "client_ios_legacy",
        claimedAt: "2026-04-03T12:01:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  assert.equal(claimResponse.status, 200);

  const hostsResponse = await worker.fetch(
    new Request("https://relay.example/api/clients/client_ios_legacy/hosts"),
    { RELAY_STORAGE: storage },
  );
  const payload = await readJson(hostsResponse);

  assert.equal(hostsResponse.status, 200);
  assert.equal(payload.hosts.length, 1);
  assert.equal(payload.hosts[0].hostId, "host_legacy");
  assert.equal(payload.hosts[0].displayName, "Legacy Mac");
  assert.equal(payload.hosts[0].lastSeenAt, "2026-04-03T11:59:00.000Z");
});

test("pairing invite route generates invite defaults when desktop only posts host identity", async () => {
  const storage = createMemoryRelayStorage();

  const createInviteResponse = await worker.fetch(
    new Request("https://relay.example/api/pairing/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: "host_defaults",
        host: {
          hostId: "host_defaults",
          displayName: "Defaulted Mac",
          status: "online",
          lastSeenAt: "2026-04-03T11:59:00.000Z",
          capabilities: ["turns"],
        },
      }),
    }),
    { RELAY_STORAGE: storage },
  );
  const createInvitePayload = await readJson(createInviteResponse);

  assert.equal(createInviteResponse.status, 200);
  assert.equal(createInvitePayload.invite.hostId, "host_defaults");
  assert.match(createInvitePayload.invite.inviteId, /^invite_/);
  assert.match(createInvitePayload.invite.code, /^PAIR-/);
  assert.ok(Date.parse(createInvitePayload.invite.createdAt));
  assert.ok(Date.parse(createInvitePayload.invite.expiresAt));
  assert.ok(
    Date.parse(createInvitePayload.invite.expiresAt) >
      Date.parse(createInvitePayload.invite.createdAt),
  );
});

test("host session sync flow returns the latest host sessions", async () => {
  const storage = createMemoryRelayStorage();

  const syncResponse = await worker.fetch(
    new Request("https://relay.example/api/hosts/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: {
          hostId: "host_123",
          displayName: "MacBook Pro",
          status: "online",
          lastSeenAt: "2026-04-03T11:59:00.000Z",
          capabilities: ["turns", "session-list"],
        },
        sessions: [
          {
            sessionId: "thread_123",
            hostId: "host_123",
            title: "Fix relay",
            summary: "implement relay session sync",
            updatedAt: "2026-04-03T12:03:00.000Z",
            primaryAgentId: "claude-code",
            state: "active",
          },
        ],
      }),
    }),
    { RELAY_STORAGE: storage },
  );

  assert.equal(syncResponse.status, 200);

  const sessionsResponse = await worker.fetch(
    new Request("https://relay.example/api/hosts/host_123/sessions"),
    { RELAY_STORAGE: storage },
  );
  const payload = await readJson(sessionsResponse);

  assert.equal(sessionsResponse.status, 200);
  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.sessions[0].sessionId, "thread_123");
});

test("relay turn submit, claim, complete, and fetch status", async () => {
  const storage = createMemoryRelayStorage();

  const submitResponse = await worker.fetch(
    new Request("https://relay.example/api/turns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "client_ios_1",
        hostId: "host_123",
        sessionId: "thread_123",
        message: "ship the relay text turn",
        createdAt: "2026-04-03T12:10:00.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );
  const submitPayload = await readJson(submitResponse);

  assert.equal(submitResponse.status, 200);
  assert.equal(submitPayload.turn.status, "queued");
  assert.equal(submitPayload.turn.sessionId, "thread_123");

  const claimResponse = await worker.fetch(
    new Request("https://relay.example/api/hosts/host_123/turns/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimedAt: "2026-04-03T12:10:02.000Z",
      }),
    }),
    { RELAY_STORAGE: storage },
  );
  const claimPayload = await readJson(claimResponse);

  assert.equal(claimResponse.status, 200);
  assert.equal(claimPayload.turn.status, "processing");
  assert.equal(claimPayload.turn.message, "ship the relay text turn");

  const completeResponse = await worker.fetch(
    new Request(
      `https://relay.example/api/hosts/host_123/turns/${claimPayload.turn.turnId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completedAt: "2026-04-03T12:10:08.000Z",
          runtimeSessionId: "runtime_123",
          agentId: "dolphin",
          userMessage: {
            id: "msg_user_1",
            role: "user",
            content: "ship the relay text turn",
          },
          assistantMessage: {
            id: "msg_assistant_1",
            role: "assistant",
            content: "relay text turn shipped",
          },
        }),
      },
    ),
    { RELAY_STORAGE: storage },
  );
  const completePayload = await readJson(completeResponse);

  assert.equal(completeResponse.status, 200);
  assert.equal(completePayload.turn.status, "completed");
  assert.equal(completePayload.turn.assistantMessage.content, "relay text turn shipped");

  const statusResponse = await worker.fetch(
    new Request(`https://relay.example/api/clients/client_ios_1/turns/${claimPayload.turn.turnId}`),
    { RELAY_STORAGE: storage },
  );
  const statusPayload = await readJson(statusResponse);

  assert.equal(statusResponse.status, 200);
  assert.equal(statusPayload.turn.status, "completed");
  assert.equal(statusPayload.turn.runtimeSessionId, "runtime_123");
});
