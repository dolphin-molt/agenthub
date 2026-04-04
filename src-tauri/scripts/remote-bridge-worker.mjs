import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  buildHostRegistrationPayload,
  buildHostSyncRequest,
  buildRelayApiUrl,
  buildSessionSnapshotPayload,
  createSerializedRunner,
  extractRelayMediaDefaults,
  fetchRelayJson,
  processPendingRelayTurn,
} from "./relay-agent.mjs";
import { createGatewayCallController } from "./gateway-call-controller.mjs";
import { executeGatewayTurn } from "./gateway-turn-executor.mjs";

const projectRoot =
  process.env.AGENTHUB_PROJECT_ROOT ||
  path.resolve(import.meta.dirname, "..", "..");
const claudeRuntimeScript = path.join(
  projectRoot,
  "src-tauri",
  "scripts",
  "claude-runtime.mjs",
);
const statePath =
  process.env.AGENTHUB_REMOTE_BRIDGE_STATE_PATH ||
  path.join(os.homedir(), ".agenthub", "runtime", "remote-bridge.json");
const relayStatePath =
  process.env.AGENTHUB_RELAY_AGENT_STATE_PATH ||
  path.join(os.homedir(), ".agenthub", "runtime", "relay-agent.json");
const logPath = process.env.AGENTHUB_REMOTE_BRIDGE_LOG_PATH || "";
const port = Math.max(
  1024,
  parseInt(process.env.AGENTHUB_REMOTE_BRIDGE_PORT || "18921", 10) || 18921,
);
const token = String(process.env.AGENTHUB_REMOTE_BRIDGE_TOKEN || "").trim();
const relayBaseUrl = String(process.env.AGENTHUB_RELAY_BASE_URL || "").trim();
const relayHostId = String(process.env.AGENTHUB_RELAY_HOST_ID || "").trim();
const relayHostDisplayName =
  String(process.env.AGENTHUB_RELAY_HOST_DISPLAY_NAME || "").trim() ||
  os.hostname();
const relayEnabled = relayBaseUrl.length > 0 && relayHostId.length > 0;
const runtimeVersion = "0.1.0";

if (!token) {
  throw new Error("Missing AGENTHUB_REMOTE_BRIDGE_TOKEN");
}

const hubPath = path.join(os.homedir(), ".agenthub", "hub.json");
let activeThreadId = null;
let activeRelayCall = null;
let startedAt = new Date().toISOString();
let lastRequestAt = null;

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function compactText(text, maxLength) {
  const normalized = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function extractFileRefs(...texts) {
  const pattern = /(?:\/[\w.-]+)+\/[\w.-]+|(?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]+/g;
  const refs = texts
    .flatMap((text) => String(text || "").match(pattern) || [])
    .filter((item) => item.length > 3);
  return Array.from(new Set(refs)).slice(0, 6);
}

function detectLocalUrls() {
  const interfaces = os.networkInterfaces();
  const urls = new Set([`http://127.0.0.1:${port}`]);

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue;
      if (entry.family !== "IPv4") continue;
      urls.add(`http://${entry.address}:${port}`);
    }
  }

  return [...urls];
}

async function writeState(partial = {}) {
  const next = {
    running: true,
    pid: process.pid,
    status: "running",
    port,
    token,
    localUrls: detectLocalUrls(),
    startedAt,
    updatedAt: nowIso(),
    lastRequestAt,
    lastError: null,
    activeThreadId,
    logPath: partial.logPath || logPath,
    ...partial,
  };

  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function writeRelayState(partial = {}, snapshot = null) {
  if (!relayEnabled) {
    return;
  }

  const hub = await readHubConfig();
  const nextSnapshot = snapshot || buildSessionSnapshotPayload({ hostId: relayHostId, hub });
  const mediaDefaults = extractRelayMediaDefaults(hub);
  const next = {
    running: true,
    pid: process.pid,
    status: "running",
    relayBaseUrl,
    hostId: relayHostId,
    hostDisplayName: relayHostDisplayName,
    sessionCount: nextSnapshot.sessions.length,
    startedAt,
    updatedAt: nowIso(),
    lastSyncAt: nowIso(),
    connectedAt: startedAt,
    lastError: null,
    activeCall: partial.activeCall ?? activeRelayCall,
    mediaDefaults,
    logPath,
    ...partial,
  };

  await fs.mkdir(path.dirname(relayStatePath), { recursive: true });
  await fs.writeFile(relayStatePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function markError(message) {
  await writeState({
    running: true,
    status: "error",
    lastError: String(message || "unknown_error"),
  });
  await writeRelayState({
    running: true,
    status: "error",
    lastError: String(message || "unknown_error"),
  }).catch(() => {});
}

async function markStopped() {
  try {
    await writeState({
      running: false,
      pid: null,
      status: "stopped",
    });
    await writeRelayState({
      running: false,
      pid: null,
      status: "stopped",
      connectedAt: null,
    }).catch(() => {});
  } catch {
    // noop
  }
}

async function readHubConfig() {
  try {
    const raw = await fs.readFile(hubPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      providers: [],
      models: [],
      mcpServers: [],
      secrets: [],
      channels: {},
      customAgents: [],
      skills: { directories: [] },
      cronJobs: [],
      memory: {
        provider: "memos",
        enabled: false,
        base_url: "",
        access_token: null,
      },
      collaboration: {
        connectors: [],
        threads: [],
        boards: [],
        tasks: [],
        sessions: [],
        events: [],
        routes: [],
      },
      ...parsed,
    };
  } catch {
    return {
      providers: [],
      models: [],
      mcpServers: [],
      secrets: [],
      channels: {},
      customAgents: [],
      skills: { directories: [] },
      cronJobs: [],
      memory: {
        provider: "memos",
        enabled: false,
        base_url: "",
        access_token: null,
      },
      collaboration: {
        connectors: [],
        threads: [],
        boards: [],
        tasks: [],
        sessions: [],
        events: [],
        routes: [],
      },
    };
  }
}

async function writeHubConfig(hub) {
  await fs.mkdir(path.dirname(hubPath), { recursive: true });
  await fs.writeFile(hubPath, `${JSON.stringify(hub, null, 2)}\n`, "utf8");
}

function readCustomAgents(hub) {
  const customAgents = Array.isArray(hub.customAgents) ? hub.customAgents : [];
  if (customAgents.length > 0) {
    return customAgents;
  }
  return [
    {
      id: "dolphin",
      name: "dolphin",
      icon: "🐬",
      runtime_profile: {
        runtime_family: "claude-code",
        auth_source: "claude-subscription",
        default_model: null,
      },
    },
  ];
}

function getThreadBundle(hub, threadId) {
  const collaboration = hub.collaboration || {};
  const thread = (collaboration.threads || []).find((item) => item.id === threadId);
  if (!thread) return null;
  const board = (collaboration.boards || []).find((item) => item.id === thread.board_id);
  const tasks = (collaboration.tasks || []).filter((item) => item.thread_id === threadId);
  const sessions = (collaboration.sessions || []).filter((item) => item.thread_id === threadId);
  const events = (collaboration.events || []).filter((item) => item.thread_id === threadId);
  tasks.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  sessions.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  events.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return { thread, board, tasks, sessions, events };
}

function createThread(hub, { title, goal, primaryAgentId }) {
  const collaboration = hub.collaboration || (hub.collaboration = {});
  collaboration.threads ||= [];
  collaboration.boards ||= [];
  collaboration.tasks ||= [];
  collaboration.sessions ||= [];
  collaboration.events ||= [];
  collaboration.connectors ||= [];
  collaboration.routes ||= [];

  const now = nowIso();
  const threadId = nextId("thread");
  const boardId = nextId("board");
  const trimmedTitle = String(title || "").trim() || "新任务线";
  const trimmedGoal = String(goal || "").trim();

  const thread = {
    id: threadId,
    title: trimmedTitle,
    goal: trimmedGoal,
    status: "active",
    primary_agent_id: primaryAgentId || null,
    board_id: boardId,
    created_at: now,
    updated_at: now,
  };

  const board = {
    id: boardId,
    thread_id: threadId,
    version: 1,
    objective: trimmedGoal || trimmedTitle,
    current_focus: null,
    summary: "",
    decisions: [],
    open_questions: [],
    key_files: [],
    artifacts: [],
    updated_by: null,
    updated_at: now,
  };

  const event = {
    id: nextId("event"),
    thread_id: threadId,
    board_version: 1,
    event_type: "thread_created",
    title: "任务线已创建",
    body: "这条任务线已经准备好，可以开始协作。",
    agent_id: primaryAgentId || null,
    session_id: null,
    task_id: null,
    payload: null,
    created_at: now,
  };

  collaboration.threads.push(thread);
  collaboration.boards.push(board);
  collaboration.events.push(event);
  return { thread, board, tasks: [], sessions: [], events: [event] };
}

function ensureThreadSession(hub, { threadId, agentId, runtimeSessionId, mode }) {
  const collaboration = hub.collaboration || (hub.collaboration = {});
  collaboration.sessions ||= [];
  collaboration.events ||= [];
  const thread = (collaboration.threads || []).find((item) => item.id === threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }
  const board = (collaboration.boards || []).find((item) => item.id === thread.board_id);
  const boardVersion = board?.version || 1;
  const now = nowIso();

  let session = collaboration.sessions.find(
    (item) => item.thread_id === threadId && item.agent_id === agentId,
  );

  if (session) {
    if (runtimeSessionId) {
      session.runtime_session_id = runtimeSessionId;
    }
    if (mode) {
      session.mode = mode;
    }
    session.status = "idle";
    session.updated_at = now;
    return session;
  }

  session = {
    id: nextId("session"),
    thread_id: threadId,
    agent_id: agentId,
    runtime_session_id: runtimeSessionId || null,
    mode: mode || "stateless",
    status: "idle",
    last_seen_board_version: boardVersion,
    last_handoff_version: 0,
    created_at: now,
    updated_at: now,
  };

  collaboration.sessions.push(session);
  collaboration.events.push({
    id: nextId("event"),
    thread_id: threadId,
    board_version: boardVersion,
    event_type: "session_created",
    title: `已建立会话：${agentId}`,
    body: "当前线程下的 Agent 会话映射已创建。",
    agent_id: agentId,
    session_id: session.id,
    task_id: null,
    payload: null,
    created_at: now,
  });
  return session;
}

function recordThreadEvent(hub, params) {
  const collaboration = hub.collaboration || (hub.collaboration = {});
  collaboration.events ||= [];
  collaboration.threads ||= [];
  collaboration.boards ||= [];

  const thread = collaboration.threads.find((item) => item.id === params.threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${params.threadId}`);
  }
  const board = collaboration.boards.find((item) => item.id === thread.board_id);
  const boardVersion = board?.version || 1;
  const now = nowIso();
  thread.updated_at = now;

  const event = {
    id: params.eventId || nextId("event"),
    thread_id: params.threadId,
    board_version: boardVersion,
    event_type: params.eventType,
    title: params.title,
    body: params.body || null,
    agent_id: params.agentId || null,
    session_id: params.sessionId || null,
    task_id: params.taskId || null,
    payload: params.payload || null,
    created_at: now,
  };
  collaboration.events.push(event);
  return event;
}

function updateBoardAfterTurn(hub, { threadId, userContent, response, agentId }) {
  const collaboration = hub.collaboration || {};
  const thread = (collaboration.threads || []).find((item) => item.id === threadId);
  if (!thread) return;
  const board = (collaboration.boards || []).find((item) => item.id === thread.board_id);
  if (!board) return;

  const mergedFiles = Array.from(
    new Set([...(board.key_files || []), ...extractFileRefs(userContent, response)]),
  ).slice(0, 8);

  board.version = Number(board.version || 0) + 1;
  board.current_focus = compactText(userContent, 72) || board.current_focus || null;
  board.key_files = mergedFiles;
  board.updated_by = agentId || null;
  board.updated_at = nowIso();
}

function formatThreadTitle(source) {
  const trimmed = String(source || "").trim();
  if (!trimmed) {
    return `新任务线 ${new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

function runClaudeRuntime(payload, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [claudeRuntimeScript], {
      cwd: projectRoot,
      env: {
        ...process.env,
        AGENTHUB_PROJECT_ROOT: projectRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";

    function processRuntimeLine(line) {
      if (!line.startsWith("{")) {
        return;
      }

      try {
        const parsed = JSON.parse(line);
        if (
          parsed?.type === "partial" &&
          typeof parsed.rawText === "string" &&
          typeof options.onPartial === "function"
        ) {
          options.onPartial({
            rawText: parsed.rawText,
            runtimeSessionId: parsed.runtimeSessionId || payload.runtimeSessionId || null,
          });
        }
      } catch {
        // Ignore non-final malformed lines from the runtime stream.
      }
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;

      while (stdoutBuffer.includes("\n")) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          processRuntimeLine(line);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const trailing = stdoutBuffer.trim();
      if (trailing) {
        processRuntimeLine(trailing);
      }

      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const finalLine = [...lines].reverse().find((line) => line.startsWith("{"));

      if (!finalLine) {
        return reject(
          new Error(
            stderr.trim() || `Claude runtime returned no final payload (code ${code ?? "?"})`,
          ),
        );
      }

      try {
        const parsed = JSON.parse(finalLine);
        if (parsed?.success === false) {
          return reject(new Error(parsed.error || "Claude runtime failed"));
        }
        return resolve({
          rawText: parsed.rawText || "",
          runtimeSessionId: parsed.runtimeSessionId || payload.runtimeSessionId || null,
          metadata: parsed.metadata || null,
        });
      } catch (error) {
        return reject(
          new Error(`Failed to parse Claude runtime payload: ${error?.message || error}`),
        );
      }
    });

    child.stdin.write(
      JSON.stringify({
        ...payload,
        outputSurface: "plain-chat",
      }),
    );
    child.stdin.end();
  });
}

async function runRuntimeTurn({ agentConfig, threadId, agentId, prompt, runtimeSessionId, onPartial }) {
  const runtimeFamily =
    agentConfig?.runtime_profile?.runtime_family || agentConfig?.runtimeFamily || "claude-code";

  switch (runtimeFamily) {
    case "claude-code":
      return runClaudeRuntime(
        {
          prompt,
          threadId,
          agentId,
          agentName: agentConfig?.name || agentId,
          authSource: agentConfig?.runtime_profile?.auth_source || null,
          model: agentConfig?.runtime_profile?.default_model || null,
          runtimeSessionId,
          maxTurns: 12,
          requestId: nextId("relay_turn"),
        },
        { onPartial },
      );
    default:
      throw new Error(`当前 remote bridge 暂不支持 runtime: ${runtimeFamily}`);
  }
}

async function syncRelayHostOnce() {
  if (!relayEnabled) {
    return;
  }

  const hub = await readHubConfig();
  const snapshot = buildSessionSnapshotPayload({ hostId: relayHostId, hub });
  const mediaDefaults = extractRelayMediaDefaults(hub);
  const request = buildHostSyncRequest({
    relayBaseUrl,
    host: {
      ...buildHostRegistrationPayload({
        hostId: relayHostId,
        displayName: relayHostDisplayName,
        platform: process.platform,
        runtimeVersion,
        capabilities: ["turns", "streaming", "session-list", "voice"],
        connectedAt: startedAt,
        mediaDefaults,
      }),
      connectedAt: startedAt,
    },
    snapshot,
  });

  await fetchRelayJson(
    fetch,
    request.url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(request.body),
    },
  );

  await writeRelayState(
    {
      connectedAt: startedAt,
      lastError: null,
      activeCall: activeRelayCall,
      mediaDefaults,
    },
    snapshot,
  );
}

async function reportRelayTurnProgress({ turnId, runtimeSessionId, agentId, assistantMessage }) {
  if (!relayEnabled || !turnId || !assistantMessage) {
    return;
  }

  await fetchRelayJson(
    fetch,
    buildRelayApiUrl(
      relayBaseUrl,
      `/hosts/${encodeURIComponent(relayHostId)}/turns/${encodeURIComponent(turnId)}/progress`,
    ),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        runtimeSessionId: runtimeSessionId || null,
        agentId: agentId || null,
        assistantMessage,
        updatedAt: nowIso(),
      }),
    },
  );
}

async function executeTurnLocally({
  message,
  threadId,
  agentId,
  source,
  createdFrom,
  relayTurnId = null,
}) {
  const hub = await readHubConfig();
  const result = await executeGatewayTurn({
    hub,
    message,
    threadId,
    agentId,
    source,
    createdFrom,
    customAgents: readCustomAgents(hub),
    writeHubConfig,
    runRuntimeTurn,
    onAssistantUpdate: relayTurnId
      ? async ({ message: assistantMessage, runtimeSessionId }) => {
          await reportRelayTurnProgress({
            turnId: relayTurnId,
            runtimeSessionId,
            agentId: assistantMessage.agentId,
            assistantMessage,
          });
        }
      : async () => {},
  });

  activeThreadId = result.threadId;
  await writeState();
  if (relayEnabled) {
    await syncRelayHostOnce();
  }
  return result;
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(res, statusCode, payload) {
  withCors(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function isAuthorized(req) {
  const auth = String(req.headers.authorization || "").trim();
  return auth === `Bearer ${token}`;
}

function buildThreadSummary(bundle) {
  const latestMessage = [...(bundle.events || [])]
    .filter(
      (event) =>
        event.event_type === "user_message" || event.event_type === "assistant_message",
    )
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];

  return {
    id: bundle.thread.id,
    title: bundle.thread.title,
    goal: bundle.thread.goal,
    status: bundle.thread.status,
    primaryAgentId: bundle.thread.primary_agent_id || null,
    updatedAt: bundle.thread.updated_at,
    latestMessagePreview: latestMessage?.body
      ? compactText(latestMessage.body, 88)
      : null,
  };
}

function buildMessageView(event) {
  return {
    id: event.id,
    role: event.event_type === "user_message" ? "user" : "assistant",
    content: event.body || "",
    agentId: event.agent_id || null,
    timestamp: event.created_at,
    payload: event.payload || null,
  };
}

const server = http.createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

  try {
    if (url.pathname === "/health") {
      const hub = await readHubConfig();
      const threads = Array.isArray(hub?.collaboration?.threads)
        ? hub.collaboration.threads.length
        : 0;
      const agents = readCustomAgents(hub).length;
      return sendJson(res, 200, {
        ok: true,
        service: "agenthub-remote-bridge",
        startedAt,
        threads,
        agents,
      });
    }

    if (!isAuthorized(req)) {
      return sendJson(res, 401, {
        ok: false,
        error: "unauthorized",
      });
    }

    lastRequestAt = nowIso();
    await writeState();
    const hub = await readHubConfig();
    const customAgents = readCustomAgents(hub);

    if (req.method === "GET" && url.pathname === "/agents") {
      return sendJson(res, 200, {
        ok: true,
        agents: customAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          icon: agent.icon || null,
          runtimeFamily: agent.runtime_profile?.runtime_family || null,
          defaultModel: agent.runtime_profile?.default_model || null,
        })),
      });
    }

    if (req.method === "GET" && url.pathname === "/threads") {
      const threadIds = (hub.collaboration?.threads || [])
        .map((thread) => thread.id)
        .sort((left, right) => {
          const leftThread = (hub.collaboration?.threads || []).find((item) => item.id === left);
          const rightThread = (hub.collaboration?.threads || []).find((item) => item.id === right);
          return String(rightThread?.updated_at || "").localeCompare(
            String(leftThread?.updated_at || ""),
          );
        });
      const threads = threadIds
        .map((threadId) => getThreadBundle(hub, threadId))
        .filter(Boolean)
        .map(buildThreadSummary);
      return sendJson(res, 200, { ok: true, threads });
    }

    if (req.method === "GET" && url.pathname.startsWith("/threads/")) {
      const threadId = decodeURIComponent(url.pathname.replace(/^\/threads\//, ""));
      const bundle = getThreadBundle(hub, threadId);
      if (!bundle) {
        return sendJson(res, 404, { ok: false, error: "thread_not_found" });
      }
      return sendJson(res, 200, {
        ok: true,
        thread: bundle.thread,
        board: bundle.board,
        tasks: bundle.tasks,
        sessions: bundle.sessions,
        messages: bundle.events
          .filter(
            (event) =>
              event.event_type === "user_message" ||
              event.event_type === "assistant_message",
          )
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
          .map(buildMessageView),
      });
    }

    if (req.method === "POST" && url.pathname === "/threads") {
      const body = await readJsonBody(req);
      const agentId = String(body.agentId || "").trim() || null;
      const bundle = createThread(hub, {
        title: String(body.title || "").trim() || formatThreadTitle(body.goal || ""),
        goal: String(body.goal || "").trim(),
        primaryAgentId: agentId,
      });
      await writeHubConfig(hub);
      return sendJson(res, 200, { ok: true, thread: buildThreadSummary(bundle) });
    }

    if (req.method === "POST" && url.pathname === "/turn") {
      const body = await readJsonBody(req);
      const message = String(body.message || "").trim();
      if (!message) {
        return sendJson(res, 400, { ok: false, error: "message_required" });
      }

      const result = await executeTurnLocally({
        message,
        threadId: String(body.threadId || "").trim() || null,
        agentId: String(body.agentId || "").trim() || null,
        source: "remote-bridge",
        createdFrom: "http",
      });

      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, {
      ok: false,
      error: "not_found",
      path: url.pathname,
    });
  } catch (error) {
    await markError(error?.message || error);
    return sendJson(res, 500, {
      ok: false,
      error: String(error?.message || error),
    });
  }
});

server.on("clientError", (error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  void markError(error?.message || error);
});

server.listen(port, "0.0.0.0", async () => {
  await writeState();
  if (relayEnabled) {
    await syncRelayHostOnce().catch(async (error) => {
      await writeRelayState({
        status: "error",
        lastError: String(error?.message || error),
      }).catch(() => {});
    });
  }
  process.stdout.write(
    `${JSON.stringify({
      type: "ready",
      pid: process.pid,
      port,
      localUrls: detectLocalUrls(),
    })}\n`,
  );
});

let relaySyncTimer = null;
let relayTurnTimer = null;
let relayCallTimer = null;

if (relayEnabled) {
  const callController = createGatewayCallController({
    relayBaseUrl,
    hostId: relayHostId,
    onAcceptCall: async (call) => {
      activeRelayCall = call;
      await writeRelayState({
        activeCall: call,
        lastError: null,
      }).catch(() => {});
    },
  });

  const runRelaySync = createSerializedRunner(async () => {
    await syncRelayHostOnce();
  });

  relaySyncTimer = setInterval(() => {
    void runRelaySync().catch(async (error) => {
      await writeRelayState({
        status: "error",
        lastError: String(error?.message || error),
      }).catch(() => {});
    });
  }, 5000);

  const runRelayTurnPoll = createSerializedRunner(async () => {
    await processPendingRelayTurn({
      relayBaseUrl,
      hostId: relayHostId,
      executeTurn: async (turn) =>
        executeTurnLocally({
          message: turn.message,
          threadId: turn.sessionId,
          agentId: null,
          source: "relay",
          createdFrom: "relay",
          relayTurnId: turn.turnId,
        }),
    });
  });

  relayTurnTimer = setInterval(() => {
    void runRelayTurnPoll().catch(async (error) => {
      await writeRelayState({
        status: "error",
        lastError: String(error?.message || error),
      }).catch(() => {});
    });
  }, 2000);

  const runRelayCallPoll = createSerializedRunner(async () => {
    activeRelayCall = await callController.tick();
    await writeRelayState({
      activeCall: activeRelayCall,
      lastError: null,
    }).catch(() => {});
  });

  relayCallTimer = setInterval(() => {
    void runRelayCallPoll().catch(async (error) => {
      await writeRelayState({
        status: "error",
        lastError: String(error?.message || error),
      }).catch(() => {});
    });
  }, 1500);
}

process.on("SIGTERM", async () => {
  await markStopped();
  if (relaySyncTimer) clearInterval(relaySyncTimer);
  if (relayTurnTimer) clearInterval(relayTurnTimer);
  if (relayCallTimer) clearInterval(relayCallTimer);
  server.close(() => process.exit(0));
});

process.on("SIGINT", async () => {
  await markStopped();
  if (relaySyncTimer) clearInterval(relaySyncTimer);
  if (relayTurnTimer) clearInterval(relayTurnTimer);
  if (relayCallTimer) clearInterval(relayCallTimer);
  server.close(() => process.exit(0));
});

process.on("uncaughtException", async (error) => {
  await markError(error?.message || error);
  process.stderr.write(`${error?.stack || error}\n`);
});
