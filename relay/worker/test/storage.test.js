import test from "node:test";
import assert from "node:assert/strict";

import {
  claimNextRelayTurn,
  createRelayCall,
  createD1RelayStorage,
  createMemoryRelayStorage,
  createPairingInvite,
  claimPairingInvite,
  completeRelayTurn,
  getRelayCall,
  getRelayTurn,
  listPairedHosts,
  listHostSessions,
  submitRelayTurn,
  updateRelayTurnProgress,
  updateRelayCall,
  upsertHostSessions,
  upsertHostMetadata,
} from "../src/storage.js";

test("createPairingInvite stores an expiring invite", async () => {
  const storage = createMemoryRelayStorage();

  const invite = await createPairingInvite(storage, {
    inviteId: "invite_123",
    hostId: "host_123",
    code: "PAIR-123",
    createdAt: "2026-04-03T12:00:00.000Z",
    expiresAt: "2026-04-03T12:05:00.000Z",
  });

  assert.equal(invite.inviteId, "invite_123");
  assert.equal(invite.hostId, "host_123");
  assert.equal(invite.claimedAt, null);
  assert.deepEqual(storage.debug().invites[0], invite);
});

test("claimPairingInvite only allows one successful claim", async () => {
  const storage = createMemoryRelayStorage();

  await upsertHostMetadata(storage, {
    hostId: "host_123",
    displayName: "MacBook Pro",
    status: "online",
    lastSeenAt: "2026-04-03T11:59:00.000Z",
    capabilities: ["turns"],
  });
  await createPairingInvite(storage, {
    inviteId: "invite_123",
    hostId: "host_123",
    code: "PAIR-123",
    createdAt: "2026-04-03T12:00:00.000Z",
    expiresAt: "2026-04-03T12:05:00.000Z",
  });

  const firstClaim = await claimPairingInvite(storage, {
    code: "PAIR-123",
    clientId: "client_ios_1",
    claimedAt: "2026-04-03T12:01:00.000Z",
  });

  assert.equal(firstClaim.clientId, "client_ios_1");

  await assert.rejects(
    () =>
      claimPairingInvite(storage, {
        code: "PAIR-123",
        clientId: "client_web_1",
        claimedAt: "2026-04-03T12:02:00.000Z",
      }),
    /already claimed/i,
  );
});

test("claimPairingInvite is idempotent for the same client", async () => {
  const storage = createMemoryRelayStorage();

  await upsertHostMetadata(storage, {
    hostId: "host_123",
    displayName: "MacBook Pro",
    status: "online",
    lastSeenAt: "2026-04-03T11:59:00.000Z",
    capabilities: ["turns"],
  });
  await createPairingInvite(storage, {
    inviteId: "invite_123",
    hostId: "host_123",
    code: "PAIR-123",
    createdAt: "2026-04-03T12:00:00.000Z",
    expiresAt: "2026-04-03T12:05:00.000Z",
  });

  const firstClaim = await claimPairingInvite(storage, {
    code: "PAIR-123",
    clientId: "client_ios_1",
    claimedAt: "2026-04-03T12:01:00.000Z",
  });
  const secondClaim = await claimPairingInvite(storage, {
    code: "PAIR-123",
    clientId: "client_ios_1",
    claimedAt: "2026-04-03T12:01:05.000Z",
  });

  assert.deepEqual(secondClaim, firstClaim);
});

test("listPairedHosts returns paired host metadata for a client", async () => {
  const storage = createMemoryRelayStorage();

  await upsertHostMetadata(storage, {
    hostId: "host_123",
    displayName: "MacBook Pro",
    status: "online",
    lastSeenAt: "2026-04-03T11:59:00.000Z",
    capabilities: ["turns"],
    mediaDefaults: {
      voice: {
        providerId: "volcengine",
        modelId: "doubao-realtime-asr",
      },
      video: {
        providerId: "googleapis",
        modelId: "gemini-2.5-flash",
      },
    },
  });
  await createPairingInvite(storage, {
    inviteId: "invite_123",
    hostId: "host_123",
    code: "PAIR-123",
    createdAt: "2026-04-03T12:00:00.000Z",
    expiresAt: "2026-04-03T12:05:00.000Z",
  });
  await claimPairingInvite(storage, {
    code: "PAIR-123",
    clientId: "client_ios_1",
    claimedAt: "2026-04-03T12:01:00.000Z",
  });

  const hosts = await listPairedHosts(storage, {
    clientId: "client_ios_1",
  });

  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].hostId, "host_123");
  assert.equal(hosts[0].displayName, "MacBook Pro");
  assert.deepEqual(hosts[0].mediaDefaults, {
    voice: {
      providerId: "volcengine",
      modelId: "doubao-realtime-asr",
    },
    video: {
      providerId: "googleapis",
      modelId: "gemini-2.5-flash",
    },
  });
});

test("upsertHostSessions replaces the current session snapshot for a host", async () => {
  const storage = createMemoryRelayStorage();

  await upsertHostSessions(storage, {
    hostId: "host_123",
    sessions: [
      {
        sessionId: "thread_older",
        hostId: "host_123",
        title: "Older thread",
        summary: "older goal",
        updatedAt: "2026-04-03T11:59:00.000Z",
        primaryAgentId: "dolphin",
        state: "active",
      },
    ],
  });
  await upsertHostSessions(storage, {
    hostId: "host_123",
    sessions: [
      {
        sessionId: "thread_newer",
        hostId: "host_123",
        title: "Newer thread",
        summary: "newer goal",
        updatedAt: "2026-04-03T12:01:00.000Z",
        primaryAgentId: "claude-code",
        state: "active",
      },
    ],
  });

  const sessions = await listHostSessions(storage, { hostId: "host_123" });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, "thread_newer");
});

test("D1-backed storage supports pairing and session lookup", async () => {
  const storage = createD1RelayStorage(createFakeD1Database());

  await upsertHostMetadata(storage, {
    hostId: "host_123",
    displayName: "MacBook Pro",
    status: "online",
    lastSeenAt: "2026-04-03T11:59:00.000Z",
    capabilities: ["turns"],
  });
  await upsertHostSessions(storage, {
    hostId: "host_123",
    sessions: [
      {
        sessionId: "thread_newer",
        hostId: "host_123",
        title: "Newer thread",
        summary: "newer goal",
        updatedAt: "2026-04-03T12:01:00.000Z",
        primaryAgentId: "claude-code",
        state: "active",
      },
    ],
  });
  await createPairingInvite(storage, {
    inviteId: "invite_123",
    hostId: "host_123",
    code: "PAIR-123",
    createdAt: "2026-04-03T12:00:00.000Z",
    expiresAt: "2026-04-03T12:05:00.000Z",
  });
  await claimPairingInvite(storage, {
    code: "PAIR-123",
    clientId: "client_ios_1",
    claimedAt: "2026-04-03T12:01:00.000Z",
  });

  const hosts = await listPairedHosts(storage, {
    clientId: "client_ios_1",
  });
  const sessions = await listHostSessions(storage, { hostId: "host_123" });

  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].hostId, "host_123");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, "thread_newer");
});

test("D1-backed storage round-trips host defaults and call media config", async () => {
  const storage = createD1RelayStorage(createFakeD1Database());

  await upsertHostMetadata(storage, {
    hostId: "host_123",
    displayName: "MacBook Pro",
    status: "online",
    lastSeenAt: "2026-04-04T02:19:00.000Z",
    capabilities: ["turns", "voice", "video"],
    mediaDefaults: {
      voice: {
        providerId: "volcengine",
        modelId: "doubao-realtime-asr",
      },
      video: {
        providerId: "googleapis",
        modelId: "gemini-2.5-flash",
      },
    },
  });
  await createPairingInvite(storage, {
    inviteId: "invite_123",
    hostId: "host_123",
    code: "PAIR-123",
    createdAt: "2026-04-04T02:20:00.000Z",
    expiresAt: "2026-04-04T02:25:00.000Z",
  });
  await claimPairingInvite(storage, {
    code: "PAIR-123",
    clientId: "client_ios_1",
    claimedAt: "2026-04-04T02:20:30.000Z",
  });

  await createRelayCall(storage, {
    callId: "call_voice_1",
    hostId: "host_123",
    clientId: "client_ios_1",
    sessionId: "thread_123",
    mode: "audio",
    state: "dialing",
    createdAt: "2026-04-04T02:21:00.000Z",
    updatedAt: "2026-04-04T02:21:00.000Z",
    mediaConfig: {
      voice: {
        providerId: "bigmodel",
        modelId: "glm-asr-2512",
      },
    },
  });
  await updateRelayCall(storage, {
    callId: "call_voice_1",
    hostId: "host_123",
    state: "live",
    updatedAt: "2026-04-04T02:21:05.000Z",
  });

  const hosts = await listPairedHosts(storage, {
    clientId: "client_ios_1",
  });
  const storedCall = await getRelayCall(storage, {
    callId: "call_voice_1",
    clientId: "client_ios_1",
  });

  assert.deepEqual(hosts[0]?.mediaDefaults, {
    voice: {
      providerId: "volcengine",
      modelId: "doubao-realtime-asr",
    },
    video: {
      providerId: "googleapis",
      modelId: "gemini-2.5-flash",
    },
  });
  assert.deepEqual(hosts[0]?.activeCall?.mediaConfig, {
    voice: {
      providerId: "bigmodel",
      modelId: "glm-asr-2512",
    },
    video: null,
  });
  assert.deepEqual(storedCall?.mediaConfig, {
    voice: {
      providerId: "bigmodel",
      modelId: "glm-asr-2512",
    },
    video: null,
  });
});

test("D1-backed pairing claim is idempotent for the same client", async () => {
  const storage = createD1RelayStorage(createFakeD1Database());

  await upsertHostMetadata(storage, {
    hostId: "host_123",
    displayName: "MacBook Pro",
    status: "online",
    lastSeenAt: "2026-04-03T11:59:00.000Z",
    capabilities: ["turns"],
  });
  await createPairingInvite(storage, {
    inviteId: "invite_123",
    hostId: "host_123",
    code: "PAIR-123",
    createdAt: "2026-04-03T12:00:00.000Z",
    expiresAt: "2026-04-03T12:05:00.000Z",
  });

  const firstClaim = await claimPairingInvite(storage, {
    code: "PAIR-123",
    clientId: "client_ios_1",
    claimedAt: "2026-04-03T12:01:00.000Z",
  });
  const secondClaim = await claimPairingInvite(storage, {
    code: "PAIR-123",
    clientId: "client_ios_1",
    claimedAt: "2026-04-03T12:01:05.000Z",
  });

  assert.deepEqual(secondClaim, firstClaim);
});

test("D1-backed storage supports relay turn lifecycle", async () => {
  const storage = createD1RelayStorage(createFakeD1Database());

  const turn = await submitRelayTurn(storage, {
    clientId: "client_ios_1",
    hostId: "host_123",
    sessionId: "thread_newer",
    message: "finish relay text turn",
    createdAt: "2026-04-03T12:10:00.000Z",
  });

  assert.equal(turn.status, "queued");

  const claimed = await claimNextRelayTurn(storage, {
    hostId: "host_123",
    claimedAt: "2026-04-03T12:10:02.000Z",
  });

  assert.equal(claimed?.status, "processing");
  assert.equal(claimed?.turnId, turn.turnId);

  await completeRelayTurn(storage, {
    turnId: turn.turnId,
    hostId: "host_123",
    completedAt: "2026-04-03T12:10:08.000Z",
    runtimeSessionId: "runtime_123",
    agentId: "dolphin",
    userMessage: {
      id: "msg_user_1",
      role: "user",
      content: "finish relay text turn",
    },
    assistantMessage: {
      id: "msg_assistant_1",
      role: "assistant",
      content: "relay text turn finished",
    },
  });

  const stored = await getRelayTurn(storage, {
    turnId: turn.turnId,
    clientId: "client_ios_1",
  });

  assert.equal(stored?.status, "completed");
  assert.equal(stored?.runtimeSessionId, "runtime_123");
  assert.equal(stored?.assistantMessage?.content, "relay text turn finished");
});

test("relay turn progress updates assistant preview before completion", async () => {
  const storage = createD1RelayStorage(createFakeD1Database());

  const turn = await submitRelayTurn(storage, {
    clientId: "client_ios_1",
    hostId: "host_123",
    sessionId: "thread_newer",
    message: "stream the reply",
    createdAt: "2026-04-03T12:20:00.000Z",
  });

  await claimNextRelayTurn(storage, {
    hostId: "host_123",
    claimedAt: "2026-04-03T12:20:02.000Z",
  });

  await updateRelayTurnProgress(storage, {
    turnId: turn.turnId,
    hostId: "host_123",
    runtimeSessionId: "runtime_456",
    agentId: "dolphin",
    assistantMessage: {
      id: "msg_assistant_progress",
      role: "assistant",
      content: "hello wor",
    },
  });

  const stored = await getRelayTurn(storage, {
    turnId: turn.turnId,
    clientId: "client_ios_1",
  });

  assert.equal(stored?.status, "processing");
  assert.equal(stored?.runtimeSessionId, "runtime_456");
  assert.equal(stored?.assistantMessage?.content, "hello wor");
});

test("relay call lifecycle tracks an active audio call for the paired host", async () => {
  const storage = createD1RelayStorage(createFakeD1Database());

  await upsertHostMetadata(storage, {
    hostId: "host_123",
    displayName: "MacBook Pro",
    status: "online",
    lastSeenAt: "2026-04-04T02:20:00.000Z",
    capabilities: ["turns", "voice"],
  });
  await createPairingInvite(storage, {
    inviteId: "invite_voice",
    hostId: "host_123",
    code: "PAIR-VOICE",
    createdAt: "2026-04-04T02:20:00.000Z",
    expiresAt: "2026-04-04T02:25:00.000Z",
  });
  await claimPairingInvite(storage, {
    code: "PAIR-VOICE",
    clientId: "client_ios_1",
    claimedAt: "2026-04-04T02:20:30.000Z",
  });

  const call = await createRelayCall(storage, {
    callId: "call_voice_1",
    hostId: "host_123",
    clientId: "client_ios_1",
    sessionId: "thread_123",
    mode: "audio",
    state: "dialing",
    createdAt: "2026-04-04T02:21:00.000Z",
    updatedAt: "2026-04-04T02:21:00.000Z",
  });

  assert.equal(call.state, "dialing");

  const liveCall = await updateRelayCall(storage, {
    callId: "call_voice_1",
    hostId: "host_123",
    state: "live",
    updatedAt: "2026-04-04T02:21:10.000Z",
  });

  assert.equal(liveCall.state, "live");

  const stored = await getRelayCall(storage, {
    callId: "call_voice_1",
    clientId: "client_ios_1",
  });
  const hosts = await listPairedHosts(storage, { clientId: "client_ios_1" });

  assert.equal(stored?.mode, "audio");
  assert.equal(hosts[0]?.activeCall?.callId, "call_voice_1");
  assert.equal(hosts[0]?.activeCall?.state, "live");
});

function createFakeD1Database() {
  const state = {
    hosts: new Map(),
    hostSessions: new Map(),
    invites: new Map(),
    pairings: [],
    relayTurns: new Map(),
    relayCalls: new Map(),
  };

  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              const normalized = normalizeSql(sql);
              if (normalized.startsWith("CREATE TABLE")) {
                return { success: true };
              }
              if (normalized === "ALTER TABLE HOSTS ADD COLUMN MEDIA_DEFAULTS_JSON TEXT") {
                return { success: true };
              }
              if (normalized === "ALTER TABLE RELAY_CALLS ADD COLUMN MEDIA_CONFIG_JSON TEXT") {
                return { success: true };
              }
              if (normalized.startsWith("INSERT INTO HOSTS")) {
                state.hosts.set(params[0], {
                  hostId: params[0],
                  displayName: params[1],
                  status: params[2],
                  lastSeenAt: params[3],
                  capabilitiesJson: params[4],
                  mediaDefaultsJson: params[5],
                });
                return { success: true };
              }
              if (normalized.startsWith("DELETE FROM HOST_SESSIONS")) {
                state.hostSessions.set(params[0], []);
                return { success: true };
              }
              if (normalized.startsWith("INSERT INTO HOST_SESSIONS")) {
                const current = state.hostSessions.get(params[0]) || [];
                current.push({
                  sessionId: params[1],
                  hostId: params[0],
                  title: params[2],
                  summary: params[3],
                  updatedAt: params[4],
                  primaryAgentId: params[5],
                  state: params[6],
                });
                state.hostSessions.set(params[0], current);
                return { success: true };
              }
              if (normalized.startsWith("INSERT INTO PAIRING_INVITES")) {
                state.invites.set(params[0], {
                  inviteId: params[0],
                  hostId: params[1],
                  code: params[2],
                  createdAt: params[3],
                  expiresAt: params[4],
                  claimedAt: null,
                  claimedByClientId: null,
                });
                return { success: true };
              }
              if (normalized.startsWith("UPDATE PAIRING_INVITES")) {
                const invite = Array.from(state.invites.values()).find((item) => item.code === params[2]);
                if (invite) {
                  invite.claimedAt = params[0];
                  invite.claimedByClientId = params[1];
                }
                return { success: true };
              }
              if (normalized.startsWith("INSERT INTO PAIRINGS")) {
                state.pairings = state.pairings.filter(
                  (pairing) => !(pairing.hostId === params[0] && pairing.clientId === params[1]),
                );
                state.pairings.push({
                  hostId: params[0],
                  clientId: params[1],
                  claimedAt: params[2],
                });
                return { success: true };
              }
              if (normalized.startsWith("INSERT INTO RELAY_TURNS")) {
                state.relayTurns.set(params[0], {
                  turnId: params[0],
                  hostId: params[1],
                  clientId: params[2],
                  sessionId: params[3],
                  message: params[4],
                  status: params[5],
                  createdAt: params[6],
                  claimedAt: null,
                  completedAt: null,
                  runtimeSessionId: null,
                  agentId: null,
                  userMessageJson: null,
                  assistantMessageJson: null,
                  error: null,
                });
                return { success: true };
              }
              if (normalized.startsWith("INSERT INTO RELAY_CALLS")) {
                state.relayCalls.set(params[0], {
                  callId: params[0],
                  hostId: params[1],
                  clientId: params[2],
                  sessionId: params[3],
                  mode: params[4],
                  state: params[5],
                  createdAt: params[6],
                  updatedAt: params[7],
                  mediaConfigJson: params[8],
                });
                return { success: true };
              }
              if (normalized.startsWith("UPDATE RELAY_CALLS SET STATE = ?")) {
                const call = state.relayCalls.get(params[2]);
                if (call && call.hostId === params[3]) {
                  call.state = params[0];
                  call.updatedAt = params[1];
                }
                return { success: true };
              }
              if (normalized.startsWith("UPDATE RELAY_TURNS SET STATUS = 'PROCESSING'")) {
                const turn = state.relayTurns.get(params[1]);
                if (turn) {
                  turn.status = "processing";
                  turn.claimedAt = params[0];
                }
                return { success: true };
              }
              if (normalized.startsWith("UPDATE RELAY_TURNS SET STATUS = ?")) {
                const turn = state.relayTurns.get(params[7]);
                if (turn && turn.hostId === params[8]) {
                  turn.status = params[0];
                  turn.completedAt = params[1];
                  turn.runtimeSessionId = params[2];
                  turn.agentId = params[3];
                  turn.userMessageJson = params[4];
                  turn.assistantMessageJson = params[5];
                  turn.error = params[6];
                }
                return { success: true };
              }
              if (normalized.startsWith("UPDATE RELAY_TURNS SET RUNTIME_SESSION_ID = ?")) {
                const turn = state.relayTurns.get(params[3]);
                if (turn && turn.hostId === params[4]) {
                  turn.runtimeSessionId = params[0];
                  turn.agentId = params[1];
                  turn.assistantMessageJson = params[2];
                }
                return { success: true };
              }
              throw new Error(`Unhandled run SQL: ${normalized}`);
            },
            async all() {
              const normalized = normalizeSql(sql);
              if (normalized.startsWith("SELECT H.HOST_ID")) {
                return {
                  results: state.pairings
                    .filter((pairing) => pairing.clientId === params[0])
                    .map((pairing) => {
                      const host = state.hosts.get(pairing.hostId);
                      return host
                        ? {
                            hostId: host.hostId,
                            displayName: host.displayName,
                            status: host.status,
                            lastSeenAt: host.lastSeenAt,
                            capabilitiesJson: host.capabilitiesJson,
                            mediaDefaultsJson: host.mediaDefaultsJson,
                          }
                        : null;
                    })
                    .filter(Boolean),
                };
              }
              if (normalized.startsWith("SELECT CALL_ID")) {
                if (normalized.includes("WHERE HOST_ID = ? AND STATE NOT IN")) {
                  const call = Array.from(state.relayCalls.values())
                    .filter((item) => item.hostId === params[0] && item.state !== "ended" && item.state !== "failed")
                    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
                  return { results: call ? [mapRelayCallRow(call)] : [] };
                }
              }
              if (normalized.startsWith("SELECT SESSION_ID")) {
                return {
                  results: (state.hostSessions.get(params[0]) || []).map((session) => ({
                    sessionId: session.sessionId,
                    hostId: session.hostId,
                    title: session.title,
                    summary: session.summary,
                    updatedAt: session.updatedAt,
                    primaryAgentId: session.primaryAgentId,
                    state: session.state,
                  })),
                };
              }
              if (normalized.startsWith("SELECT TURN_ID")) {
                const turns = Array.from(state.relayTurns.values());

                if (normalized.includes("WHERE HOST_ID = ? AND STATUS = 'QUEUED'")) {
                  return {
                    results: turns
                      .filter((turn) => turn.hostId === params[0] && turn.status === "queued")
                      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
                      .slice(0, 1)
                      .map(mapRelayTurnRow),
                  };
                }
              }
              throw new Error(`Unhandled all SQL: ${normalized}`);
            },
            async first() {
              const normalized = normalizeSql(sql);
              if (normalized.startsWith("SELECT INVITE_ID")) {
                return (
                  Array.from(state.invites.values()).find((invite) => invite.code === params[0]) || null
                );
              }
              if (normalized.startsWith("SELECT CALL_ID")) {
                const calls = Array.from(state.relayCalls.values());

                if (normalized.includes("WHERE HOST_ID = ? AND STATE NOT IN")) {
                  const call = calls
                    .filter((item) => item.hostId === params[0] && item.state !== "ended" && item.state !== "failed")
                    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
                  return call ? mapRelayCallRow(call) : null;
                }

                if (normalized.includes("WHERE CALL_ID = ? AND CLIENT_ID = ?")) {
                  const call = calls.find(
                    (item) => item.callId === params[0] && item.clientId === params[1],
                  );
                  return call ? mapRelayCallRow(call) : null;
                }

                if (normalized.includes("WHERE CALL_ID = ?")) {
                  const call = calls.find((item) => item.callId === params[0]);
                  return call ? mapRelayCallRow(call) : null;
                }
              }
              if (normalized.startsWith("SELECT TURN_ID")) {
                const turns = Array.from(state.relayTurns.values());

                if (normalized.includes("WHERE HOST_ID = ? AND STATUS = 'QUEUED'")) {
                  return turns
                    .filter((turn) => turn.hostId === params[0] && turn.status === "queued")
                    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
                    .map(mapRelayTurnRow)[0] || null;
                }

                if (normalized.includes("WHERE TURN_ID = ? AND CLIENT_ID = ?")) {
                  const turn = turns.find(
                    (item) => item.turnId === params[0] && item.clientId === params[1],
                  );
                  return turn ? mapRelayTurnRow(turn) : null;
                }

                if (normalized.includes("WHERE TURN_ID = ?")) {
                  const turn = turns.find((item) => item.turnId === params[0]);
                  return turn ? mapRelayTurnRow(turn) : null;
                }
              }
              throw new Error(`Unhandled first SQL: ${normalized}`);
            },
          };
        },
      };
    },
    async batch(statements) {
      for (const statement of statements) {
        await statement.run();
      }
      return [];
    },
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toUpperCase();
}

function mapRelayTurnRow(turn) {
  return {
    turnId: turn.turnId,
    hostId: turn.hostId,
    clientId: turn.clientId,
    sessionId: turn.sessionId,
    message: turn.message,
    status: turn.status,
    createdAt: turn.createdAt,
    claimedAt: turn.claimedAt,
    completedAt: turn.completedAt,
    runtimeSessionId: turn.runtimeSessionId,
    agentId: turn.agentId,
    userMessageJson: turn.userMessageJson,
    assistantMessageJson: turn.assistantMessageJson,
    error: turn.error,
  };
}

function mapRelayCallRow(call) {
  return {
    callId: call.callId,
    hostId: call.hostId,
    clientId: call.clientId,
    sessionId: call.sessionId,
    mode: call.mode,
    state: call.state,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
    mediaConfigJson: call.mediaConfigJson ?? null,
  };
}
