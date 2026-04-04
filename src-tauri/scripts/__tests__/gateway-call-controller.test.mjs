import test from "node:test";
import assert from "node:assert/strict";

import { createGatewayCallController } from "../gateway-call-controller.mjs";

test("gateway call controller promotes a dialing relay call to live once", async () => {
  const fetchCalls = [];
  let activeCallState = "dialing";

  const fetchImpl = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });

    if (String(url).endsWith("/api/hosts/host_123/calls/active")) {
      return new Response(
        JSON.stringify({
          ok: true,
          call: {
            callId: "call_voice_1",
            hostId: "host_123",
            clientId: "client_ios_1",
            sessionId: "thread_123",
            mode: "audio",
            state: activeCallState,
            createdAt: "2026-04-04T03:50:00.000Z",
            updatedAt: "2026-04-04T03:50:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (String(url).endsWith("/api/hosts/host_123/calls/call_voice_1/events")) {
      const body = JSON.parse(options.body);
      activeCallState = body.state;
      return new Response(
        JSON.stringify({
          ok: true,
          call: {
            callId: "call_voice_1",
            hostId: "host_123",
            clientId: "client_ios_1",
            sessionId: "thread_123",
            mode: "audio",
            state: body.state,
            createdAt: "2026-04-04T03:50:00.000Z",
            updatedAt: body.updatedAt,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  const acceptedCalls = [];
  const controller = createGatewayCallController({
    relayBaseUrl: "https://relay.example.workers.dev",
    hostId: "host_123",
    fetchImpl,
    now: (() => {
      const values = [
        "2026-04-04T03:50:01.000Z",
        "2026-04-04T03:50:02.000Z",
      ];
      return () => values.shift() || "2026-04-04T03:50:02.000Z";
    })(),
    onAcceptCall: async (call) => {
      acceptedCalls.push(call.callId);
    },
  });

  const first = await controller.tick();
  const second = await controller.tick();

  assert.equal(first?.state, "live");
  assert.equal(second?.state, "live");
  assert.deepEqual(acceptedCalls, ["call_voice_1"]);

  const eventCalls = fetchCalls.filter((call) => call.url.endsWith("/events"));
  assert.equal(eventCalls.length, 2);
  assert.match(eventCalls[0].options.body, /"connecting"/);
  assert.match(eventCalls[1].options.body, /"live"/);
});
