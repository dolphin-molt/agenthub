import test from "node:test";
import assert from "node:assert/strict";

import {
  extractRelayMediaDefaults,
  buildHostSyncRequest,
  buildHostRegistrationPayload,
  buildLocalBridgeTurnRequest,
  buildRelayApiUrl,
  buildSessionSnapshotPayload,
  createSerializedRunner,
  processPendingRelayTurn,
} from "../relay-agent.mjs";

test("buildHostRegistrationPayload produces a normalized relay host payload", () => {
  const payload = buildHostRegistrationPayload({
    hostId: "host_123",
    displayName: "MacBook Pro",
    platform: "macos",
    runtimeVersion: "0.1.0",
    capabilities: ["turns", "streaming"],
    connectedAt: "2026-04-03T12:00:00.000Z",
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

  assert.deepEqual(payload, {
    hostId: "host_123",
    displayName: "MacBook Pro",
    platform: "macos",
    runtimeVersion: "0.1.0",
    status: "online",
    connectedAt: "2026-04-03T12:00:00.000Z",
    capabilities: ["turns", "streaming"],
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
});

test("extractRelayMediaDefaults maps hub media config into relay media defaults", () => {
  const mediaDefaults = extractRelayMediaDefaults({
    media: {
      voice: {
        asrProviderId: "volcengine",
        asrModelId: "doubao-realtime-asr",
      },
      video: {
        reasoningProviderId: "googleapis",
        reasoningModelId: "gemini-2.5-flash",
      },
    },
  });

  assert.deepEqual(mediaDefaults, {
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

test("buildSessionSnapshotPayload maps collaboration threads into relay sessions", () => {
  const payload = buildSessionSnapshotPayload({
    hostId: "host_123",
    hub: {
      collaboration: {
        threads: [
          {
            id: "thread_older",
            title: "Older thread",
            goal: "older goal",
            primary_agent_id: "dolphin",
            updated_at: "2026-04-03T11:59:00.000Z",
          },
          {
            id: "thread_newer",
            title: "Newer thread",
            goal: "newer goal",
            primary_agent_id: "claude-code",
            updated_at: "2026-04-03T12:01:00.000Z",
          },
        ],
      },
    },
  });

  assert.equal(payload.hostId, "host_123");
  assert.equal(payload.sessions.length, 2);
  assert.deepEqual(payload.sessions[0], {
    sessionId: "thread_newer",
    hostId: "host_123",
    title: "Newer thread",
    summary: "newer goal",
    updatedAt: "2026-04-03T12:01:00.000Z",
    primaryAgentId: "claude-code",
    state: "active",
  });
});

test("buildRelayApiUrl keeps a single api prefix", () => {
  assert.equal(
    buildRelayApiUrl("https://relay.example.workers.dev/api", "/hosts/sync"),
    "https://relay.example.workers.dev/api/hosts/sync",
  );
  assert.equal(
    buildRelayApiUrl("https://relay.example.workers.dev", "hosts/sync"),
    "https://relay.example.workers.dev/api/hosts/sync",
  );
});

test("buildHostSyncRequest combines host metadata with session snapshot", () => {
  const request = buildHostSyncRequest({
    relayBaseUrl: "https://relay.example.workers.dev/api",
    host: {
      hostId: "host_123",
      displayName: "MacBook Pro",
      platform: "darwin",
      runtimeVersion: "0.1.0",
      capabilities: ["turns", "session-list"],
      connectedAt: "2026-04-03T12:00:00.000Z",
    },
    snapshot: {
      hostId: "host_123",
      sessions: [
        {
          sessionId: "thread_1",
          hostId: "host_123",
          title: "Relay v1",
          summary: "Design work",
          updatedAt: "2026-04-03T12:01:00.000Z",
          primaryAgentId: "claude-code",
          state: "active",
        },
      ],
    },
  });

  assert.equal(request.url, "https://relay.example.workers.dev/api/hosts/sync");
  assert.deepEqual(request.body, {
    hostId: "host_123",
    host: {
      hostId: "host_123",
      displayName: "MacBook Pro",
      platform: "darwin",
      runtimeVersion: "0.1.0",
      status: "online",
      connectedAt: "2026-04-03T12:00:00.000Z",
      lastSeenAt: "2026-04-03T12:00:00.000Z",
      capabilities: ["turns", "session-list"],
    },
    sessions: [
      {
        sessionId: "thread_1",
        hostId: "host_123",
        title: "Relay v1",
        summary: "Design work",
        updatedAt: "2026-04-03T12:01:00.000Z",
        primaryAgentId: "claude-code",
        state: "active",
      },
    ],
  });
});

test("buildHostSyncRequest preserves host media defaults", () => {
  const request = buildHostSyncRequest({
    relayBaseUrl: "https://relay.example.workers.dev/api",
    host: {
      hostId: "host_123",
      displayName: "MacBook Pro",
      platform: "darwin",
      runtimeVersion: "0.1.0",
      capabilities: ["turns", "session-list", "voice"],
      connectedAt: "2026-04-03T12:00:00.000Z",
      mediaDefaults: {
        voice: {
          providerId: "volcengine",
          modelId: "doubao-realtime-asr",
        },
      },
    },
    snapshot: {
      hostId: "host_123",
      sessions: [],
    },
  });

  assert.deepEqual(request.body.host.mediaDefaults, {
    voice: {
      providerId: "volcengine",
      modelId: "doubao-realtime-asr",
    },
    video: null,
  });
});

test("buildLocalBridgeTurnRequest targets local bridge turn endpoint with bearer auth", () => {
  const request = buildLocalBridgeTurnRequest({
    bridge: {
      port: 18921,
      token: "ahb_test_123",
    },
    turn: {
      sessionId: "thread_123",
      message: "ship relay text turn",
    },
  });

  assert.equal(request.url, "http://127.0.0.1:18921/turn");
  assert.deepEqual(request.options, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: "Bearer ahb_test_123",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      threadId: "thread_123",
      message: "ship relay text turn",
    }),
  });
});

test("processPendingRelayTurn claims a relay turn, executes local bridge, and completes the turn", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (String(url).endsWith("/api/hosts/host_123/turns/claim")) {
      return new Response(
        JSON.stringify({
          ok: true,
          turn: {
            turnId: "turn_123",
            hostId: "host_123",
            clientId: "client_ios_1",
            sessionId: "thread_123",
            message: "ship relay text turn",
            status: "processing",
            createdAt: "2026-04-03T12:10:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (String(url) === "http://127.0.0.1:18921/turn") {
      return new Response(
        JSON.stringify({
          ok: true,
          threadId: "thread_123",
          agentId: "dolphin",
          runtimeSessionId: "runtime_123",
          userMessage: {
            id: "msg_user_1",
            role: "user",
            content: "ship relay text turn",
          },
          assistantMessage: {
            id: "msg_assistant_1",
            role: "assistant",
            content: "relay text turn shipped",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (String(url).endsWith("/api/hosts/host_123/turns/turn_123/complete")) {
      return new Response(
        JSON.stringify({
          ok: true,
          turn: {
            turnId: "turn_123",
            status: "completed",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const result = await processPendingRelayTurn({
    relayBaseUrl: "https://relay.example.workers.dev",
    hostId: "host_123",
    fetchImpl,
    now: (() => {
      const values = [
        "2026-04-03T12:10:02.000Z",
        "2026-04-03T12:10:08.000Z",
      ];
      return () => values.shift() || "2026-04-03T12:10:08.000Z";
    })(),
    readRemoteBridgeState: async () => ({
      running: true,
      port: 18921,
      token: "ahb_test_123",
    }),
  });

  assert.equal(result?.turn?.turnId, "turn_123");
  assert.equal(result?.turn?.status, "completed");
  assert.equal(calls.length, 3);

  const completion = calls[2];
  assert.equal(
    completion.url,
    "https://relay.example.workers.dev/api/hosts/host_123/turns/turn_123/complete",
  );
  assert.match(completion.options.body, /relay text turn shipped/);
});

test("processPendingRelayTurn can execute the claimed turn directly without the local HTTP bridge hop", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (String(url).endsWith("/api/hosts/host_123/turns/claim")) {
      return new Response(
        JSON.stringify({
          ok: true,
          turn: {
            turnId: "turn_direct",
            hostId: "host_123",
            clientId: "client_ios_1",
            sessionId: "thread_123",
            message: "stream from local gateway",
            status: "processing",
            createdAt: "2026-04-03T12:20:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (String(url).endsWith("/api/hosts/host_123/turns/turn_direct/complete")) {
      return new Response(
        JSON.stringify({
          ok: true,
          turn: {
            turnId: "turn_direct",
            status: "completed",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const executedTurns = [];
  const result = await processPendingRelayTurn({
    relayBaseUrl: "https://relay.example.workers.dev",
    hostId: "host_123",
    fetchImpl,
    now: (() => {
      const values = [
        "2026-04-03T12:20:02.000Z",
        "2026-04-03T12:20:08.000Z",
      ];
      return () => values.shift() || "2026-04-03T12:20:08.000Z";
    })(),
    executeTurn: async (turn) => {
      executedTurns.push(turn);
      return {
        threadId: turn.sessionId,
        agentId: "dolphin",
        runtimeSessionId: "runtime_direct",
        userMessage: {
          id: "msg_user_direct",
          role: "user",
          content: turn.message,
        },
        assistantMessage: {
          id: "msg_assistant_direct",
          role: "assistant",
          content: "local gateway handled it",
        },
      };
    },
  });

  assert.equal(executedTurns.length, 1);
  assert.equal(executedTurns[0].turnId, "turn_direct");
  assert.equal(result?.turn?.turnId, "turn_direct");
  assert.equal(result?.turn?.status, "completed");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].url,
    "https://relay.example.workers.dev/api/hosts/host_123/turns/turn_direct/complete",
  );
});

test("processPendingRelayTurn retries transient relay fetch failures before succeeding", async () => {
  let claimAttempts = 0;
  const delays = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/api/hosts/host_123/turns/claim")) {
      claimAttempts += 1;

      if (claimAttempts === 1) {
        const error = new TypeError("fetch failed");
        error.cause = { code: "ECONNRESET" };
        throw error;
      }

      return new Response(
        JSON.stringify({
          ok: true,
          turn: {
            turnId: "turn_retry",
            hostId: "host_123",
            clientId: "client_ios_1",
            sessionId: "thread_123",
            message: "retry relay turn",
            status: "processing",
            createdAt: "2026-04-03T12:12:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (String(url) === "http://127.0.0.1:18921/turn") {
      return new Response(
        JSON.stringify({
          ok: true,
          threadId: "thread_123",
          agentId: "dolphin",
          runtimeSessionId: "runtime_retry",
          userMessage: {
            id: "msg_user_retry",
            role: "user",
            content: "retry relay turn",
          },
          assistantMessage: {
            id: "msg_assistant_retry",
            role: "assistant",
            content: "relay retry shipped",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (String(url).endsWith("/api/hosts/host_123/turns/turn_retry/complete")) {
      return new Response(
        JSON.stringify({
          ok: true,
          turn: {
            turnId: "turn_retry",
            status: "completed",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const result = await processPendingRelayTurn({
    relayBaseUrl: "https://relay.example.workers.dev",
    hostId: "host_123",
    fetchImpl,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    now: (() => {
      const values = [
        "2026-04-03T12:12:01.000Z",
        "2026-04-03T12:12:05.000Z",
      ];
      return () => values.shift() || "2026-04-03T12:12:05.000Z";
    })(),
    readRemoteBridgeState: async () => ({
      running: true,
      port: 18921,
      token: "ahb_test_123",
    }),
  });

  assert.equal(claimAttempts, 2);
  assert.deepEqual(delays, [250]);
  assert.equal(result?.turn?.turnId, "turn_retry");
  assert.equal(result?.turn?.status, "completed");
});

test("createSerializedRunner ignores overlapping executions", async () => {
  let resolveTask;
  let runCount = 0;

  const runner = createSerializedRunner(async () => {
    runCount += 1;
    await new Promise((resolve) => {
      resolveTask = resolve;
    });
  });

  const firstRun = runner();
  const secondRunResult = await runner();

  assert.equal(secondRunResult, false);
  assert.equal(runCount, 1);

  resolveTask();
  assert.equal(await firstRun, true);

  const thirdRun = runner();
  resolveTask();
  assert.equal(await thirdRun, true);
  assert.equal(runCount, 2);
});
