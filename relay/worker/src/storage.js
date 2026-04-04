import { parseCallSummary } from "./protocol.js";

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const D1_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hosts (
    host_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    media_defaults_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS host_sessions (
    host_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    primary_agent_id TEXT,
    state TEXT NOT NULL,
    PRIMARY KEY (host_id, session_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pairing_invites (
    invite_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    claimed_at TEXT,
    claimed_by_client_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS pairings (
    host_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    PRIMARY KEY (host_id, client_id)
  )`,
  `CREATE TABLE IF NOT EXISTS relay_turns (
    turn_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT,
    runtime_session_id TEXT,
    agent_id TEXT,
    user_message_json TEXT,
    assistant_message_json TEXT,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS relay_calls (
    call_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    session_id TEXT,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    media_config_json TEXT
  )`,
];

export function createMemoryRelayStorage() {
  const invites = [];
  const pairings = [];
  const hosts = new Map();
  const hostSessions = new Map();
  const relayTurns = [];
  const relayCalls = new Map();

  return {
    kind: "memory",
    invites,
    pairings,
    hosts,
    hostSessions,
    relayTurns,
    relayCalls,
    debug() {
      return {
        invites: invites.map((invite) => clone(invite)),
        pairings: pairings.map((pairing) => clone(pairing)),
        hosts: Array.from(hosts.values()).map((host) => clone(host)),
        relayTurns: relayTurns.map((turn) => clone(turn)),
        relayCalls: Array.from(relayCalls.values()).map((call) => clone(call)),
        hostSessions: Array.from(hostSessions.entries()).map(([hostId, sessions]) => ({
          hostId,
          sessions: clone(sessions),
        })),
      };
    },
  };
}

export function createD1RelayStorage(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new TypeError("D1 database binding is required");
  }

  return {
    kind: "d1",
    db,
    schemaReady: null,
  };
}

async function ensureD1Schema(storage) {
  if (storage.kind !== "d1") {
    return;
  }

  if (!storage.schemaReady) {
    storage.schemaReady = (async () => {
      await storage.db.batch(
        D1_SCHEMA.map((statement) => storage.db.prepare(statement).bind()),
      );
      const migrations = [
        `ALTER TABLE hosts ADD COLUMN media_defaults_json TEXT`,
        `ALTER TABLE relay_calls ADD COLUMN media_config_json TEXT`,
      ];

      for (const statement of migrations) {
        try {
          await storage.db.prepare(statement).bind().run();
        } catch (error) {
          const message = String(error?.message || error).toLowerCase();
          if (!message.includes("duplicate column name")) {
            throw error;
          }
        }
      }
    })();
  }

  await storage.schemaReady;
}

function normalizeHostRecord(host) {
  const displayName =
    typeof host?.displayName === "string" && host.displayName.trim().length > 0
      ? host.displayName
      : host?.name;
  const lastSeenAt =
    typeof host?.lastSeenAt === "string" && host.lastSeenAt.trim().length > 0
      ? host.lastSeenAt
      : host?.connectedAt;

  return {
    hostId: requiredString(host.hostId, "hostId"),
    displayName: requiredString(displayName, "displayName"),
    status: requiredString(host.status, "status"),
    lastSeenAt: requiredString(lastSeenAt, "lastSeenAt"),
    capabilities: Array.isArray(host.capabilities) ? [...host.capabilities] : [],
    mediaDefaults: optionalObject(host.mediaDefaults),
  };
}

function normalizeInviteRecord(invite) {
  return {
    inviteId: requiredString(invite.inviteId, "inviteId"),
    hostId: requiredString(invite.hostId, "hostId"),
    code: requiredString(invite.code, "code"),
    createdAt: requiredString(invite.createdAt, "createdAt"),
    expiresAt: requiredString(invite.expiresAt, "expiresAt"),
    claimedAt: null,
    claimedByClientId: null,
  };
}

function normalizeSessionRecord(session) {
  return {
    sessionId: requiredString(session.sessionId, "sessionId"),
    hostId: requiredString(session.hostId, "session.hostId"),
    title: String(session.title || "").trim() || "Untitled session",
    summary: String(session.summary || "").trim(),
    updatedAt: requiredString(session.updatedAt, "updatedAt"),
    primaryAgentId:
      typeof session.primaryAgentId === "string" && session.primaryAgentId.trim().length > 0
        ? session.primaryAgentId.trim()
        : null,
    state: String(session.state || "active").trim() || "active",
  };
}

function parseCapabilities(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function optionalString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return clone(value);
}

function generateTurnId() {
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseOptionalJson(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "object") {
    return clone(value);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeRelayTurnRecord(input) {
  return {
    turnId: optionalString(input.turnId) || generateTurnId(),
    hostId: requiredString(input.hostId, "hostId"),
    clientId: requiredString(input.clientId, "clientId"),
    sessionId: requiredString(input.sessionId, "sessionId"),
    message: requiredString(input.message, "message"),
    status: requiredString(input.status || "queued", "status"),
    createdAt: requiredString(input.createdAt, "createdAt"),
    claimedAt: optionalString(input.claimedAt),
    completedAt: optionalString(input.completedAt),
    runtimeSessionId: optionalString(input.runtimeSessionId),
    agentId: optionalString(input.agentId),
    userMessage: optionalObject(input.userMessage),
    assistantMessage: optionalObject(input.assistantMessage),
    error: optionalString(input.error),
  };
}

function normalizeRelayCallRecord(input) {
  return parseCallSummary(input);
}

function mapRelayCallRow(row) {
  return {
    callId: row.callId,
    hostId: row.hostId,
    clientId: row.clientId,
    sessionId: row.sessionId ?? null,
    mode: row.mode,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    mediaConfig: parseOptionalJson(row.mediaConfigJson),
  };
}

function isTerminalCallState(state) {
  return state === "ended" || state === "failed";
}

function attachActiveCall(host, activeCall) {
  return {
    ...clone(host),
    activeCall: activeCall ? clone(activeCall) : null,
  };
}

function findMemoryActiveRelayCall(storage, hostId) {
  const calls = Array.from(storage.relayCalls.values())
    .filter((call) => call.hostId === hostId && !isTerminalCallState(call.state))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return calls[0] || null;
}

async function findD1ActiveRelayCall(storage, hostId) {
  const row = await storage.db
    .prepare(
      `SELECT call_id AS callId, host_id AS hostId, client_id AS clientId,
              session_id AS sessionId, mode, state, created_at AS createdAt,
              updated_at AS updatedAt, media_config_json AS mediaConfigJson
       FROM relay_calls
       WHERE host_id = ? AND state NOT IN ('ended', 'failed')
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .bind(hostId)
    .first();

  return row ? mapRelayCallRow(row) : null;
}

async function getActiveRelayCallForHost(storage, hostId) {
  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    return findD1ActiveRelayCall(storage, hostId);
  }

  return findMemoryActiveRelayCall(storage, hostId);
}

export async function getActiveRelayCall(storage, { hostId }) {
  const normalizedHostId = requiredString(hostId, "hostId");
  const call = await getActiveRelayCallForHost(storage, normalizedHostId);
  return call ? clone(call) : null;
}

export async function upsertHostMetadata(storage, host) {
  const record = normalizeHostRecord(host);

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    await storage.db
      .prepare(
        `INSERT INTO hosts (host_id, display_name, status, last_seen_at, capabilities_json, media_defaults_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(host_id) DO UPDATE SET
           display_name = excluded.display_name,
           status = excluded.status,
           last_seen_at = excluded.last_seen_at,
           capabilities_json = excluded.capabilities_json,
           media_defaults_json = excluded.media_defaults_json`,
      )
      .bind(
        record.hostId,
        record.displayName,
        record.status,
        record.lastSeenAt,
        JSON.stringify(record.capabilities),
        record.mediaDefaults ? JSON.stringify(record.mediaDefaults) : null,
      )
      .run();
    return clone(record);
  }

  storage.hosts.set(record.hostId, record);
  return clone(record);
}

export async function createPairingInvite(storage, invite) {
  const record = normalizeInviteRecord(invite);

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    await storage.db
      .prepare(
        `INSERT INTO pairing_invites (
          invite_id, host_id, code, created_at, expires_at, claimed_at, claimed_by_client_id
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        record.inviteId,
        record.hostId,
        record.code,
        record.createdAt,
        record.expiresAt,
      )
      .run();
    return clone(record);
  }

  storage.invites.push(record);
  return clone(record);
}

export async function claimPairingInvite(storage, { code, clientId, claimedAt }) {
  const normalizedCode = requiredString(code, "code");
  const normalizedClientId = requiredString(clientId, "clientId");
  const normalizedClaimedAt = requiredString(claimedAt, "claimedAt");

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);

    const invite = await storage.db
      .prepare(
        `SELECT invite_id AS inviteId, host_id AS hostId, code, created_at AS createdAt,
                expires_at AS expiresAt, claimed_at AS claimedAt,
                claimed_by_client_id AS claimedByClientId
         FROM pairing_invites
         WHERE code = ?`,
      )
      .bind(normalizedCode)
      .first();

    if (!invite) {
      throw new Error("Pairing invite not found");
    }
    if (invite.claimedAt) {
      if (invite.claimedByClientId === normalizedClientId) {
        return {
          hostId: invite.hostId,
          clientId: normalizedClientId,
          claimedAt: invite.claimedAt,
        };
      }
      throw new Error("Pairing invite already claimed");
    }
    if (Date.parse(invite.expiresAt) < Date.parse(normalizedClaimedAt)) {
      throw new Error("Pairing invite expired");
    }

    await storage.db.batch([
      storage.db
        .prepare(
          `UPDATE pairing_invites
           SET claimed_at = ?, claimed_by_client_id = ?
           WHERE code = ?`,
        )
        .bind(normalizedClaimedAt, normalizedClientId, normalizedCode),
      storage.db
        .prepare(
          `INSERT INTO pairings (host_id, client_id, claimed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(host_id, client_id) DO UPDATE SET claimed_at = excluded.claimed_at`,
        )
        .bind(invite.hostId, normalizedClientId, normalizedClaimedAt),
    ]);

    return {
      hostId: invite.hostId,
      clientId: normalizedClientId,
      claimedAt: normalizedClaimedAt,
    };
  }

  const invite = storage.invites.find((item) => item.code === normalizedCode);
  if (!invite) {
    throw new Error("Pairing invite not found");
  }
  if (invite.claimedAt) {
    if (invite.claimedByClientId === normalizedClientId) {
      return {
        hostId: invite.hostId,
        clientId: normalizedClientId,
        claimedAt: invite.claimedAt,
      };
    }
    throw new Error("Pairing invite already claimed");
  }
  if (Date.parse(invite.expiresAt) < Date.parse(normalizedClaimedAt)) {
    throw new Error("Pairing invite expired");
  }

  invite.claimedAt = normalizedClaimedAt;
  invite.claimedByClientId = normalizedClientId;

  const pairing = {
    hostId: invite.hostId,
    clientId: normalizedClientId,
    claimedAt: normalizedClaimedAt,
  };
  storage.pairings.push(pairing);
  return clone(pairing);
}

export async function listPairedHosts(storage, { clientId }) {
  const normalizedClientId = requiredString(clientId, "clientId");

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    const result = await storage.db
      .prepare(
        `SELECT h.host_id AS hostId, h.display_name AS displayName,
                h.status AS status, h.last_seen_at AS lastSeenAt,
                h.capabilities_json AS capabilitiesJson,
                h.media_defaults_json AS mediaDefaultsJson
         FROM pairings p
         JOIN hosts h ON h.host_id = p.host_id
         WHERE p.client_id = ?
         ORDER BY h.last_seen_at DESC`,
      )
      .bind(normalizedClientId)
      .all();

    const hosts = [];
    for (const row of result.results || []) {
      const activeCall = await getActiveRelayCallForHost(storage, row.hostId);
      hosts.push({
        hostId: row.hostId,
        displayName: row.displayName,
        status: row.status,
        lastSeenAt: row.lastSeenAt,
        capabilities: parseCapabilities(row.capabilitiesJson),
        mediaDefaults: parseOptionalJson(row.mediaDefaultsJson),
        activeCall,
      });
    }
    return hosts;
  }

  return storage.pairings
    .filter((pairing) => pairing.clientId === normalizedClientId)
    .map((pairing) => storage.hosts.get(pairing.hostId))
    .filter(Boolean)
    .map((host) => attachActiveCall(host, findMemoryActiveRelayCall(storage, host.hostId)));
}

export async function upsertHostSessions(storage, { hostId, sessions }) {
  const normalizedHostId = requiredString(hostId, "hostId");
  const normalizedSessions = Array.isArray(sessions)
    ? sessions.map((session) => normalizeSessionRecord(session))
    : [];

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    const statements = [
      storage.db.prepare(`DELETE FROM host_sessions WHERE host_id = ?`).bind(normalizedHostId),
      ...normalizedSessions.map((session) =>
        storage.db
          .prepare(
            `INSERT INTO host_sessions (
              host_id, session_id, title, summary, updated_at, primary_agent_id, state
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            normalizedHostId,
            session.sessionId,
            session.title,
            session.summary,
            session.updatedAt,
            session.primaryAgentId,
            session.state,
          ),
      ),
    ];
    await storage.db.batch(statements);
    return clone(normalizedSessions);
  }

  storage.hostSessions.set(normalizedHostId, normalizedSessions);
  return clone(normalizedSessions);
}

export async function listHostSessions(storage, { hostId }) {
  const normalizedHostId = requiredString(hostId, "hostId");

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    const result = await storage.db
      .prepare(
        `SELECT session_id AS sessionId, host_id AS hostId, title, summary,
                updated_at AS updatedAt, primary_agent_id AS primaryAgentId, state
         FROM host_sessions
         WHERE host_id = ?
         ORDER BY updated_at DESC`,
      )
      .bind(normalizedHostId)
      .all();

    return (result.results || []).map((row) => ({
      sessionId: row.sessionId,
      hostId: row.hostId,
      title: row.title,
      summary: row.summary,
      updatedAt: row.updatedAt,
      primaryAgentId: row.primaryAgentId ?? null,
      state: row.state,
    }));
  }

  return clone(storage.hostSessions.get(normalizedHostId) || []);
}

export async function createRelayCall(storage, input) {
  const record = normalizeRelayCallRecord(input);

  const activeCall = await getActiveRelayCallForHost(storage, record.hostId);
  if (activeCall && activeCall.callId !== record.callId) {
    throw new Error("Host already has an active call");
  }

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    await storage.db
      .prepare(
        `INSERT INTO relay_calls (
          call_id, host_id, client_id, session_id, mode, state, created_at, updated_at, media_config_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(call_id) DO UPDATE SET
          host_id = excluded.host_id,
          client_id = excluded.client_id,
          session_id = excluded.session_id,
          mode = excluded.mode,
          state = excluded.state,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          media_config_json = excluded.media_config_json`,
      )
      .bind(
        record.callId,
        record.hostId,
        record.clientId,
        record.sessionId,
        record.mode,
        record.state,
        record.createdAt,
        record.updatedAt,
        record.mediaConfig ? JSON.stringify(record.mediaConfig) : null,
      )
      .run();
    return clone(record);
  }

  storage.relayCalls.set(record.callId, clone(record));
  return clone(record);
}

export async function updateRelayCall(storage, input) {
  const normalizedCallId = requiredString(input.callId, "callId");
  const normalizedHostId = requiredString(input.hostId, "hostId");
  const normalizedState = requiredString(input.state, "state");
  const normalizedUpdatedAt = requiredString(input.updatedAt, "updatedAt");

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    await storage.db
      .prepare(
        `UPDATE relay_calls
         SET state = ?, updated_at = ?
         WHERE call_id = ? AND host_id = ?`,
      )
      .bind(normalizedState, normalizedUpdatedAt, normalizedCallId, normalizedHostId)
      .run();

    return getRelayCall(storage, { callId: normalizedCallId });
  }

  const call = storage.relayCalls.get(normalizedCallId);
  if (!call || call.hostId !== normalizedHostId) {
    throw new Error("Relay call not found");
  }

  call.state = normalizedState;
  call.updatedAt = normalizedUpdatedAt;
  return clone(call);
}

export async function endRelayCall(storage, { callId, clientId = null, updatedAt }) {
  const call = await getRelayCall(storage, { callId, clientId });
  if (!call) {
    throw new Error("Relay call not found");
  }

  return updateRelayCall(storage, {
    callId: call.callId,
    hostId: call.hostId,
    state: "ended",
    updatedAt: requiredString(updatedAt, "updatedAt"),
  });
}

export async function getRelayCall(storage, { callId, clientId = null }) {
  const normalizedCallId = requiredString(callId, "callId");
  const normalizedClientId = optionalString(clientId);

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    const statement = normalizedClientId
      ? storage.db
          .prepare(
            `SELECT call_id AS callId, host_id AS hostId, client_id AS clientId,
                    session_id AS sessionId, mode, state, created_at AS createdAt,
                    updated_at AS updatedAt, media_config_json AS mediaConfigJson
             FROM relay_calls
             WHERE call_id = ? AND client_id = ?`,
          )
          .bind(normalizedCallId, normalizedClientId)
      : storage.db
          .prepare(
            `SELECT call_id AS callId, host_id AS hostId, client_id AS clientId,
                    session_id AS sessionId, mode, state, created_at AS createdAt,
                    updated_at AS updatedAt, media_config_json AS mediaConfigJson
             FROM relay_calls
             WHERE call_id = ?`,
          )
          .bind(normalizedCallId);

    const row = await statement.first();
    return row ? mapRelayCallRow(row) : null;
  }

  const call = storage.relayCalls.get(normalizedCallId);
  if (!call) {
    return null;
  }
  if (normalizedClientId && call.clientId !== normalizedClientId) {
    return null;
  }
  return clone(call);
}

export async function submitRelayTurn(storage, turn) {
  const record = normalizeRelayTurnRecord({
    ...turn,
    status: "queued",
  });

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    await storage.db
      .prepare(
        `INSERT INTO relay_turns (
          turn_id, host_id, client_id, session_id, message, status, created_at,
          claimed_at, completed_at, runtime_session_id, agent_id,
          user_message_json, assistant_message_json, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      )
      .bind(
        record.turnId,
        record.hostId,
        record.clientId,
        record.sessionId,
        record.message,
        record.status,
        record.createdAt,
      )
      .run();
    return clone(record);
  }

  storage.relayTurns.push(record);
  return clone(record);
}

export async function claimNextRelayTurn(storage, { hostId, claimedAt }) {
  const normalizedHostId = requiredString(hostId, "hostId");
  const normalizedClaimedAt = requiredString(claimedAt, "claimedAt");

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    const turn = await storage.db
      .prepare(
        `SELECT turn_id AS turnId, host_id AS hostId, client_id AS clientId,
                session_id AS sessionId, message, status, created_at AS createdAt,
                claimed_at AS claimedAt, completed_at AS completedAt,
                runtime_session_id AS runtimeSessionId, agent_id AS agentId,
                user_message_json AS userMessageJson,
                assistant_message_json AS assistantMessageJson, error
         FROM relay_turns
         WHERE host_id = ? AND status = 'queued'
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .bind(normalizedHostId)
      .first();

    if (!turn) {
      return null;
    }

    await storage.db
      .prepare(
        `UPDATE relay_turns
         SET status = 'processing', claimed_at = ?
         WHERE turn_id = ?`,
      )
      .bind(normalizedClaimedAt, turn.turnId)
      .run();

    return {
      turnId: turn.turnId,
      hostId: turn.hostId,
      clientId: turn.clientId,
      sessionId: turn.sessionId,
      message: turn.message,
      status: "processing",
      createdAt: turn.createdAt,
      claimedAt: normalizedClaimedAt,
      completedAt: turn.completedAt ?? null,
      runtimeSessionId: turn.runtimeSessionId ?? null,
      agentId: turn.agentId ?? null,
      userMessage: parseOptionalJson(turn.userMessageJson),
      assistantMessage: parseOptionalJson(turn.assistantMessageJson),
      error: turn.error ?? null,
    };
  }

  const turn = storage.relayTurns.find(
    (item) => item.hostId === normalizedHostId && item.status === "queued",
  );
  if (!turn) {
    return null;
  }

  turn.status = "processing";
  turn.claimedAt = normalizedClaimedAt;
  return clone(turn);
}

export async function completeRelayTurn(storage, input) {
  const normalizedTurnId = requiredString(input.turnId, "turnId");
  const normalizedHostId = requiredString(input.hostId, "hostId");
  const normalizedCompletedAt = requiredString(input.completedAt, "completedAt");
  const normalizedRuntimeSessionId = optionalString(input.runtimeSessionId);
  const normalizedAgentId = optionalString(input.agentId);
  const normalizedUserMessage = optionalObject(input.userMessage);
  const normalizedAssistantMessage = optionalObject(input.assistantMessage);
  const normalizedError = optionalString(input.error);
  const status = normalizedError ? "failed" : "completed";

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    await storage.db
      .prepare(
        `UPDATE relay_turns
         SET status = ?, completed_at = ?, runtime_session_id = ?, agent_id = ?,
             user_message_json = ?, assistant_message_json = ?, error = ?
         WHERE turn_id = ? AND host_id = ?`,
      )
      .bind(
        status,
        normalizedCompletedAt,
        normalizedRuntimeSessionId,
        normalizedAgentId,
        normalizedUserMessage ? JSON.stringify(normalizedUserMessage) : null,
        normalizedAssistantMessage ? JSON.stringify(normalizedAssistantMessage) : null,
        normalizedError,
        normalizedTurnId,
        normalizedHostId,
      )
      .run();

    return getRelayTurn(storage, { turnId: normalizedTurnId });
  }

  const turn = storage.relayTurns.find(
    (item) => item.turnId === normalizedTurnId && item.hostId === normalizedHostId,
  );
  if (!turn) {
    throw new Error("Relay turn not found");
  }

  turn.status = status;
  turn.completedAt = normalizedCompletedAt;
  turn.runtimeSessionId = normalizedRuntimeSessionId;
  turn.agentId = normalizedAgentId;
  turn.userMessage = normalizedUserMessage;
  turn.assistantMessage = normalizedAssistantMessage;
  turn.error = normalizedError;
  return clone(turn);
}

export async function updateRelayTurnProgress(storage, input) {
  const normalizedTurnId = requiredString(input.turnId, "turnId");
  const normalizedHostId = requiredString(input.hostId, "hostId");
  const normalizedRuntimeSessionId = optionalString(input.runtimeSessionId);
  const normalizedAgentId = optionalString(input.agentId);
  const normalizedAssistantMessage = optionalObject(input.assistantMessage);

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    await storage.db
      .prepare(
        `UPDATE relay_turns
         SET runtime_session_id = ?, agent_id = ?, assistant_message_json = ?
         WHERE turn_id = ? AND host_id = ?`,
      )
      .bind(
        normalizedRuntimeSessionId,
        normalizedAgentId,
        normalizedAssistantMessage ? JSON.stringify(normalizedAssistantMessage) : null,
        normalizedTurnId,
        normalizedHostId,
      )
      .run();

    return getRelayTurn(storage, { turnId: normalizedTurnId });
  }

  const turn = storage.relayTurns.find(
    (item) => item.turnId === normalizedTurnId && item.hostId === normalizedHostId,
  );
  if (!turn) {
    throw new Error("Relay turn not found");
  }

  turn.runtimeSessionId = normalizedRuntimeSessionId;
  turn.agentId = normalizedAgentId;
  turn.assistantMessage = normalizedAssistantMessage;
  return clone(turn);
}

export async function getRelayTurn(storage, { turnId, clientId = null }) {
  const normalizedTurnId = requiredString(turnId, "turnId");
  const normalizedClientId = optionalString(clientId);

  if (storage.kind === "d1") {
    await ensureD1Schema(storage);
    const statement = normalizedClientId
      ? storage.db
          .prepare(
            `SELECT turn_id AS turnId, host_id AS hostId, client_id AS clientId,
                    session_id AS sessionId, message, status, created_at AS createdAt,
                    claimed_at AS claimedAt, completed_at AS completedAt,
                    runtime_session_id AS runtimeSessionId, agent_id AS agentId,
                    user_message_json AS userMessageJson,
                    assistant_message_json AS assistantMessageJson, error
             FROM relay_turns
             WHERE turn_id = ? AND client_id = ?`,
          )
          .bind(normalizedTurnId, normalizedClientId)
      : storage.db
          .prepare(
            `SELECT turn_id AS turnId, host_id AS hostId, client_id AS clientId,
                    session_id AS sessionId, message, status, created_at AS createdAt,
                    claimed_at AS claimedAt, completed_at AS completedAt,
                    runtime_session_id AS runtimeSessionId, agent_id AS agentId,
                    user_message_json AS userMessageJson,
                    assistant_message_json AS assistantMessageJson, error
             FROM relay_turns
             WHERE turn_id = ?`,
          )
          .bind(normalizedTurnId);

    const row = await statement.first();
    if (!row) {
      return null;
    }

    return {
      turnId: row.turnId,
      hostId: row.hostId,
      clientId: row.clientId,
      sessionId: row.sessionId,
      message: row.message,
      status: row.status,
      createdAt: row.createdAt,
      claimedAt: row.claimedAt ?? null,
      completedAt: row.completedAt ?? null,
      runtimeSessionId: row.runtimeSessionId ?? null,
      agentId: row.agentId ?? null,
      userMessage: parseOptionalJson(row.userMessageJson),
      assistantMessage: parseOptionalJson(row.assistantMessageJson),
      error: row.error ?? null,
    };
  }

  const turn = storage.relayTurns.find((item) =>
    item.turnId === normalizedTurnId &&
    (!normalizedClientId || item.clientId === normalizedClientId)
  );
  return turn ? clone(turn) : null;
}
