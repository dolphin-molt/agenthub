import { buildRelayApiUrl, fetchRelayJson } from "./relay-agent.mjs";

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

export function buildActiveRelayCallRequest({ relayBaseUrl, hostId }) {
  return {
    url: buildRelayApiUrl(
      relayBaseUrl,
      `/hosts/${encodeURIComponent(requiredString(hostId, "hostId"))}/calls/active`,
    ),
    options: {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    },
  };
}

export function buildRelayCallEventRequest({
  relayBaseUrl,
  hostId,
  callId,
  state,
  updatedAt,
}) {
  return {
    url: buildRelayApiUrl(
      relayBaseUrl,
      `/hosts/${encodeURIComponent(requiredString(hostId, "hostId"))}/calls/${encodeURIComponent(requiredString(callId, "callId"))}/events`,
    ),
    options: {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        state: requiredString(state, "state"),
        updatedAt: requiredString(updatedAt, "updatedAt"),
      }),
    },
  };
}

async function postRelayCallState({
  relayBaseUrl,
  hostId,
  callId,
  state,
  updatedAt,
  fetchImpl,
}) {
  const request = buildRelayCallEventRequest({
    relayBaseUrl,
    hostId,
    callId,
    state,
    updatedAt,
  });

  const payload = await fetchRelayJson(fetchImpl, request.url, request.options);
  return payload?.call || null;
}

export function createGatewayCallController({
  relayBaseUrl,
  hostId,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  onAcceptCall = async () => {},
}) {
  let acceptedCallId = null;
  let activeCall = null;

  async function tick() {
    const request = buildActiveRelayCallRequest({ relayBaseUrl, hostId });
    const payload = await fetchRelayJson(fetchImpl, request.url, request.options);
    const nextCall = payload?.call || null;

    if (!nextCall) {
      activeCall = null;
      acceptedCallId = null;
      return null;
    }

    if (nextCall.state === "dialing" && acceptedCallId !== nextCall.callId) {
      await onAcceptCall(nextCall);
      await postRelayCallState({
        relayBaseUrl,
        hostId,
        callId: nextCall.callId,
        state: "connecting",
        updatedAt: now(),
        fetchImpl,
      });
      activeCall = await postRelayCallState({
        relayBaseUrl,
        hostId,
        callId: nextCall.callId,
        state: "live",
        updatedAt: now(),
        fetchImpl,
      });
      acceptedCallId = nextCall.callId;
      return activeCall;
    }

    activeCall = nextCall;
    if (nextCall.state === "ended" || nextCall.state === "failed") {
      acceptedCallId = null;
    }
    return activeCall;
  }

  return {
    tick,
    getActiveCall() {
      return activeCall;
    },
  };
}
