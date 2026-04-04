import test from "node:test";
import assert from "node:assert/strict";

import {
  createEnvelope,
  parseCallSummary,
  parseEnvelope,
} from "../src/protocol.js";

test("createEnvelope requires messageId, hostId, and type", () => {
  assert.throws(
    () => createEnvelope({ hostId: "host_123", type: "host.register" }),
    /messageId/i,
  );
  assert.throws(
    () => createEnvelope({ messageId: "msg_123", type: "host.register" }),
    /hostId/i,
  );
  assert.throws(
    () => createEnvelope({ messageId: "msg_123", hostId: "host_123" }),
    /type/i,
  );
});

test("parseEnvelope accepts a valid envelope and applies defaults", () => {
  const envelope = parseEnvelope({
    messageId: "msg_123",
    hostId: "host_123",
    sessionId: "thread_123",
    type: "turn.submit",
    payload: { message: "hello" },
  });

  assert.equal(envelope.messageId, "msg_123");
  assert.equal(envelope.hostId, "host_123");
  assert.equal(envelope.sessionId, "thread_123");
  assert.equal(envelope.type, "turn.submit");
  assert.deepEqual(envelope.payload, { message: "hello" });
  assert.equal(envelope.seq, 0);
  assert.match(envelope.sentAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("parseEnvelope rejects invalid payloads", () => {
  assert.throws(
    () =>
      parseEnvelope({
        messageId: "msg_123",
        hostId: "host_123",
        type: "turn.submit",
        payload: "hello",
      }),
    /payload/i,
  );
});

test("parseCallSummary accepts voice call state and mode", () => {
  const call = parseCallSummary({
    callId: "call_123",
    hostId: "host_123",
    sessionId: "session_123",
    clientId: "client_ios",
    mode: "audio",
    state: "connecting",
    createdAt: "2026-04-04T01:00:00.000Z",
    updatedAt: "2026-04-04T01:00:01.000Z",
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
  });

  assert.equal(call.callId, "call_123");
  assert.equal(call.mode, "audio");
  assert.equal(call.state, "connecting");
  assert.deepEqual(call.mediaConfig, {
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

test("parseCallSummary rejects unsupported call state", () => {
  assert.throws(
    () =>
      parseCallSummary({
        callId: "call_123",
        hostId: "host_123",
        clientId: "client_ios",
        mode: "audio",
        state: "processing",
        createdAt: "2026-04-04T01:00:00.000Z",
        updatedAt: "2026-04-04T01:00:01.000Z",
      }),
    /state/i,
  );
});
