function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Missing required ${fieldName}`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new TypeError("Expected string");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensurePayload(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid payload");
  }
  return value;
}

const CALL_MODES = new Set(["audio", "video", "camera-share"]);
const CALL_STATES = new Set([
  "idle",
  "dialing",
  "ringing",
  "connecting",
  "live",
  "ended",
  "failed",
]);

function parseModelSelection(input, fieldName) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  return {
    providerId: requiredString(input.providerId, `${fieldName}.providerId`),
    modelId: requiredString(input.modelId, `${fieldName}.modelId`),
  };
}

function optionalMediaConfig(input, fieldName) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  const voice = input.voice == null ? null : parseModelSelection(input.voice, `${fieldName}.voice`);
  const video = input.video == null ? null : parseModelSelection(input.video, `${fieldName}.video`);

  if (!voice && !video) {
    return null;
  }

  return {
    voice,
    video,
  };
}

function requiredCallMode(value) {
  const mode = requiredString(value, "mode");
  if (!CALL_MODES.has(mode)) {
    throw new TypeError(`Unsupported call mode: ${mode}`);
  }
  return mode;
}

function requiredCallState(value) {
  const state = requiredString(value, "state");
  if (!CALL_STATES.has(state)) {
    throw new TypeError(`Unsupported call state: ${state}`);
  }
  return state;
}

export function createEnvelope(input) {
  return parseEnvelope(input);
}

export function parseEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Envelope must be an object");
  }

  return {
    messageId: requiredString(input.messageId, "messageId"),
    hostId: requiredString(input.hostId, "hostId"),
    sessionId: optionalString(input.sessionId),
    type: requiredString(input.type, "type"),
    seq:
      typeof input.seq === "number" && Number.isFinite(input.seq) && input.seq >= 0
        ? input.seq
        : 0,
    sentAt:
      typeof input.sentAt === "string" && input.sentAt.trim().length > 0
        ? input.sentAt
        : new Date().toISOString(),
    payload: ensurePayload(input.payload),
  };
}

export function parseCallSummary(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Call summary must be an object");
  }

  return {
    callId: requiredString(input.callId, "callId"),
    hostId: requiredString(input.hostId, "hostId"),
    sessionId: optionalString(input.sessionId),
    clientId: requiredString(input.clientId, "clientId"),
    mode: requiredCallMode(input.mode),
    state: requiredCallState(input.state),
    createdAt:
      typeof input.createdAt === "string" && input.createdAt.trim().length > 0
        ? input.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof input.updatedAt === "string" && input.updatedAt.trim().length > 0
        ? input.updatedAt
        : new Date().toISOString(),
    mediaConfig: optionalMediaConfig(input.mediaConfig, "mediaConfig"),
  };
}
