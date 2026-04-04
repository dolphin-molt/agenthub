import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

function optionalString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeModelSelection(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  return {
    providerId: requiredString(value.providerId, `${fieldName}.providerId`),
    modelId: requiredString(value.modelId, `${fieldName}.modelId`),
  };
}

function normalizeMediaConfig(value, fieldName) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }

  const voice = value.voice == null ? null : normalizeModelSelection(value.voice, `${fieldName}.voice`);
  const video = value.video == null ? null : normalizeModelSelection(value.video, `${fieldName}.video`);
  if (!voice && !video) {
    return null;
  }
  return { voice, video };
}

function normalizeConfiguredModelSelection(value, providerFieldName, modelFieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const providerId = optionalString(value.providerId) ?? optionalString(value[providerFieldName]);
  const modelId = optionalString(value.modelId) ?? optionalString(value[modelFieldName]);
  if (!providerId || !modelId) {
    return null;
  }

  return { providerId, modelId };
}

export function extractRelayMediaDefaults(hub) {
  if (!hub || typeof hub !== "object" || Array.isArray(hub)) {
    return null;
  }

  const media = hub.media;
  if (!media || typeof media !== "object" || Array.isArray(media)) {
    return null;
  }

  return normalizeMediaConfig(
    {
      voice: normalizeConfiguredModelSelection(media.voice, "asrProviderId", "asrModelId"),
      video: normalizeConfiguredModelSelection(
        media.video,
        "reasoningProviderId",
        "reasoningModelId",
      ),
    },
    "hub.media",
  );
}

export function buildHostRegistrationPayload(input) {
  const payload = {
    hostId: requiredString(input.hostId, "hostId"),
    displayName: requiredString(input.displayName, "displayName"),
    platform: requiredString(input.platform, "platform"),
    runtimeVersion: requiredString(input.runtimeVersion, "runtimeVersion"),
    status: "online",
    connectedAt:
      typeof input.connectedAt === "string" && input.connectedAt.trim().length > 0
        ? input.connectedAt
        : new Date().toISOString(),
    capabilities: normalizeCapabilities(input.capabilities),
  };

  const mediaDefaults = normalizeMediaConfig(input.mediaDefaults, "mediaDefaults");
  if (mediaDefaults) {
    payload.mediaDefaults = mediaDefaults;
  }

  return payload;
}

export function buildRelayApiUrl(relayBaseUrl, pathName) {
  const normalizedBaseUrl = requiredString(relayBaseUrl, "relayBaseUrl")
    .replace(/\/+$/, "");
  const apiBase = normalizedBaseUrl.endsWith("/api")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/api`;
  const normalizedPath = String(pathName || "").startsWith("/")
    ? String(pathName || "")
    : `/${String(pathName || "")}`;

  return `${apiBase}${normalizedPath}`;
}

export function buildSessionSnapshotPayload({ hostId, hub }) {
  const normalizedHostId = requiredString(hostId, "hostId");
  const collaboration = hub?.collaboration || {};
  const threads = Array.isArray(collaboration.threads)
    ? [...collaboration.threads]
    : [];

  threads.sort((left, right) =>
    String(right.updated_at || "").localeCompare(String(left.updated_at || "")),
  );

  return {
    hostId: normalizedHostId,
    sessions: threads.map((thread) => ({
      sessionId: requiredString(thread.id, "thread.id"),
      hostId: normalizedHostId,
      title: String(thread.title || "").trim() || "Untitled session",
      summary: String(thread.goal || "").trim(),
      updatedAt:
        typeof thread.updated_at === "string" && thread.updated_at.trim().length > 0
          ? thread.updated_at
          : new Date().toISOString(),
      primaryAgentId:
        typeof thread.primary_agent_id === "string" && thread.primary_agent_id.trim().length > 0
          ? thread.primary_agent_id.trim()
          : null,
      state:
        typeof thread.status === "string" && thread.status.trim().length > 0
          ? thread.status.trim()
          : "active",
    })),
  };
}

export function buildHostSyncRequest({ relayBaseUrl, host, snapshot }) {
  const registration = buildHostRegistrationPayload(host);
  const normalizedSnapshot = {
    hostId: requiredString(snapshot?.hostId, "snapshot.hostId"),
    sessions: Array.isArray(snapshot?.sessions) ? snapshot.sessions : [],
  };

  return {
    url: buildRelayApiUrl(relayBaseUrl, "/hosts/sync"),
    body: {
      hostId: normalizedSnapshot.hostId,
      host: {
        ...registration,
        lastSeenAt: registration.connectedAt,
      },
      sessions: normalizedSnapshot.sessions,
    },
  };
}

const projectRoot =
  process.env.AGENTHUB_PROJECT_ROOT ||
  path.resolve(import.meta.dirname, "..", "..");
const statePath =
  process.env.AGENTHUB_RELAY_AGENT_STATE_PATH ||
  path.join(os.homedir(), ".agenthub", "runtime", "relay-agent.json");
const remoteBridgeStatePath =
  process.env.AGENTHUB_REMOTE_BRIDGE_STATE_PATH ||
  path.join(os.homedir(), ".agenthub", "runtime", "remote-bridge.json");
const logPath = process.env.AGENTHUB_RELAY_AGENT_LOG_PATH || "";
const relayBaseUrl = process.env.AGENTHUB_RELAY_BASE_URL || "";
const hostId =
  process.env.AGENTHUB_RELAY_HOST_ID || `host_${process.pid}_${Date.now()}`;
const hostDisplayName =
  process.env.AGENTHUB_RELAY_HOST_DISPLAY_NAME || os.hostname();
const runtimeVersion = "0.1.0";

async function readJsonResponse(response) {
  const text = await response.text();
  let payload = {};

  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`invalid_json_response:${text.trim().slice(0, 200)}`);
    }
  }

  if (!response.ok) {
    throw new Error(String(payload?.error || payload?.message || `HTTP ${response.status}`));
  }

  return payload;
}

function isRetryableRelayError(error) {
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (["ECONNRESET", "ETIMEDOUT", "EPIPE", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  return message.includes("fetch failed") || message.includes("network socket disconnected");
}

async function sleep(delayMs) {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function createSerializedRunner(task) {
  let running = false;

  return async () => {
    if (running) {
      return false;
    }

    running = true;
    try {
      await task();
      return true;
    } finally {
      running = false;
    }
  };
}

export async function fetchRelayJson(fetchImpl, url, options, config = {}) {
  const retries = Number.isInteger(config.retries) ? config.retries : 2;
  const retryDelayMs = Number.isInteger(config.retryDelayMs) ? config.retryDelayMs : 250;
  const sleepImpl = typeof config.sleep === "function" ? config.sleep : sleep;

  let attempt = 0;
  while (true) {
    try {
      const response = await fetchImpl(url, options);
      return await readJsonResponse(response);
    } catch (error) {
      if (attempt >= retries || !isRetryableRelayError(error)) {
        throw error;
      }

      attempt += 1;
      await sleepImpl(retryDelayMs * attempt);
    }
  }
}

async function readHubConfig() {
  const hubPath = path.join(os.homedir(), ".agenthub", "hub.json");
  try {
    const raw = await fs.readFile(hubPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      collaboration: {
        threads: [],
      },
    };
  }
}

export async function readRemoteBridgeState(pathName = remoteBridgeStatePath) {
  const raw = await fs.readFile(pathName, "utf8");
  return JSON.parse(raw);
}

export function buildLocalBridgeTurnRequest({ bridge, turn }) {
  const port = Number(bridge?.port);
  if (!Number.isFinite(port) || port <= 0) {
    throw new TypeError("bridge.port is required");
  }
  const token = requiredString(bridge?.token, "bridge.token");
  const sessionId = requiredString(turn?.sessionId, "turn.sessionId");
  const message = requiredString(turn?.message, "turn.message");

  return {
    url: `http://127.0.0.1:${port}/turn`,
    options: {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        threadId: sessionId,
        message,
      }),
    },
  };
}

export function buildRelayTurnCompletionRequest({
  relayBaseUrl,
  hostId,
  turnId,
  completedAt,
  result = null,
  error = null,
}) {
  const normalizedHostId = requiredString(hostId, "hostId");
  const normalizedTurnId = requiredString(turnId, "turnId");
  const normalizedCompletedAt = requiredString(completedAt, "completedAt");

  return {
    url: buildRelayApiUrl(
      relayBaseUrl,
      `/hosts/${encodeURIComponent(normalizedHostId)}/turns/${encodeURIComponent(normalizedTurnId)}/complete`,
    ),
    body: {
      completedAt: normalizedCompletedAt,
      runtimeSessionId:
        typeof result?.runtimeSessionId === "string" ? result.runtimeSessionId : null,
      agentId: typeof result?.agentId === "string" ? result.agentId : null,
      userMessage:
        result?.userMessage && typeof result.userMessage === "object" ? result.userMessage : null,
      assistantMessage:
        result?.assistantMessage && typeof result.assistantMessage === "object"
          ? result.assistantMessage
          : null,
      error:
        error == null
          ? null
          : String(error?.message || error).trim() || "relay_turn_failed",
    },
  };
}

export async function processPendingRelayTurn({
  relayBaseUrl,
  hostId,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  sleep: sleepImpl = sleep,
  readRemoteBridgeState: readRemoteBridgeStateImpl = readRemoteBridgeState,
  executeTurn = null,
}) {
  const claimPayload = await fetchRelayJson(
    fetchImpl,
    buildRelayApiUrl(relayBaseUrl, `/hosts/${encodeURIComponent(requiredString(hostId, "hostId"))}/turns/claim`),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        claimedAt: now(),
      }),
    },
    { sleep: sleepImpl },
  );
  const turn = claimPayload?.turn || null;

  if (!turn) {
    return null;
  }

  let completionRequest;

  try {
    const bridgePayload =
      typeof executeTurn === "function"
        ? await executeTurn(turn)
        : await (async () => {
            const bridgeState = await readRemoteBridgeStateImpl();
            if (!bridgeState?.running) {
              throw new Error("local_bridge_unavailable");
            }

            const bridgeRequest = buildLocalBridgeTurnRequest({
              bridge: bridgeState,
              turn,
            });
            const bridgeResponse = await fetchImpl(bridgeRequest.url, bridgeRequest.options);
            return readJsonResponse(bridgeResponse);
          })();

    completionRequest = buildRelayTurnCompletionRequest({
      relayBaseUrl,
      hostId,
      turnId: turn.turnId,
      completedAt: now(),
      result: bridgePayload,
    });
  } catch (error) {
    completionRequest = buildRelayTurnCompletionRequest({
      relayBaseUrl,
      hostId,
      turnId: turn.turnId,
      completedAt: now(),
      error,
    });
  }

  return fetchRelayJson(
    fetchImpl,
    completionRequest.url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(completionRequest.body),
    },
    { sleep: sleepImpl },
  );
}

async function writeState(partial = {}, snapshot = null) {
  const nextSnapshot = snapshot || buildSessionSnapshotPayload({ hostId, hub: await readHubConfig() });
  const next = {
    running: true,
    pid: process.pid,
    status: "running",
    relayBaseUrl,
    hostId,
    hostDisplayName,
    sessionCount: nextSnapshot.sessions.length,
    startedAt: partial.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    connectedAt: partial.connectedAt || new Date().toISOString(),
    lastError: null,
    logPath: partial.logPath || logPath,
    ...partial,
  };

  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function markStopped() {
  await writeState({
    running: false,
    pid: null,
    status: "stopped",
    connectedAt: null,
  });
}

export async function runRelayAgent() {
  const registration = buildHostRegistrationPayload({
    hostId,
    displayName: hostDisplayName,
    platform: process.platform,
    runtimeVersion,
    capabilities: ["turns", "streaming", "session-list"],
  });

  console.log("[relay-agent] starting", registration);

  async function syncOnce() {
    const hub = await readHubConfig();
    const snapshot = buildSessionSnapshotPayload({ hostId, hub });

    if (relayBaseUrl) {
      const request = buildHostSyncRequest({
        relayBaseUrl,
        host: {
          ...registration,
          connectedAt: registration.connectedAt,
        },
        snapshot,
      });
      await fetchRelayJson(
        fetch,
        request.url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(request.body),
        },
      );
    }

    await writeState({
      startedAt: registration.connectedAt,
      connectedAt: registration.connectedAt,
      lastError: null,
    }, snapshot);
  }

  await syncOnce();

  const runTurnPoll = createSerializedRunner(async () => {
    await processPendingRelayTurn({
      relayBaseUrl,
      hostId,
    });
  });

  const turnTimer = setInterval(() => {
    void runTurnPoll().catch(async (error) => {
      console.error("[relay-agent] failed to process turn", error);
      await writeState({
        lastError: String(error?.message || error),
      }).catch(() => {});
    });
  }, 2000);

  const runSyncPoll = createSerializedRunner(async () => {
    await syncOnce();
  });

  const timer = setInterval(() => {
    void runSyncPoll().catch(async (error) => {
      console.error("[relay-agent] failed to sync", error);
      await writeState({
        lastError: String(error?.message || error),
      }).catch(() => {});
    });
  }, 5000);

  const shutdown = async () => {
    clearInterval(timer);
    clearInterval(turnTimer);
    await markStopped().catch(() => {});
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  void runRelayAgent().catch(async (error) => {
    console.error("[relay-agent] fatal", error);
    await writeState({
      running: false,
      status: "error",
      lastError: String(error?.message || error),
      connectedAt: null,
    }).catch(() => {});
    process.exit(1);
  });
}
