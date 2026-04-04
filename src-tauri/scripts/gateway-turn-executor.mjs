function defaultNowIso() {
  return new Date().toISOString();
}

function defaultNextId(prefix) {
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

function createThread(hub, { title, goal, primaryAgentId, nextId, now }) {
  const collaboration = hub.collaboration || (hub.collaboration = {});
  collaboration.threads ||= [];
  collaboration.boards ||= [];
  collaboration.tasks ||= [];
  collaboration.sessions ||= [];
  collaboration.events ||= [];
  collaboration.connectors ||= [];
  collaboration.routes ||= [];

  const nowValue = now();
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
    created_at: nowValue,
    updated_at: nowValue,
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
    updated_at: nowValue,
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
    created_at: nowValue,
  };

  collaboration.threads.push(thread);
  collaboration.boards.push(board);
  collaboration.events.push(event);
  return { thread, board, tasks: [], sessions: [], events: [event] };
}

function ensureThreadSession(hub, { threadId, agentId, runtimeSessionId, mode, nextId, now }) {
  const collaboration = hub.collaboration || (hub.collaboration = {});
  collaboration.sessions ||= [];
  collaboration.events ||= [];
  const thread = (collaboration.threads || []).find((item) => item.id === threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }
  const board = (collaboration.boards || []).find((item) => item.id === thread.board_id);
  const boardVersion = board?.version || 1;
  const nowValue = now();

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
    session.updated_at = nowValue;
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
    created_at: nowValue,
    updated_at: nowValue,
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
    created_at: nowValue,
  });
  return session;
}

function recordThreadEvent(hub, params, { nextId, now }) {
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
  const nowValue = now();
  thread.updated_at = nowValue;

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
    created_at: nowValue,
  };
  collaboration.events.push(event);
  return event;
}

function upsertAssistantEvent(hub, params, { nextId, now }) {
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
  const nowValue = now();
  thread.updated_at = nowValue;

  const existing = collaboration.events.find((item) => item.id === params.eventId);
  if (existing) {
    existing.board_version = boardVersion;
    existing.title = params.title;
    existing.body = params.body || null;
    existing.agent_id = params.agentId || null;
    existing.session_id = params.sessionId || null;
    existing.task_id = params.taskId || null;
    existing.payload = params.payload || null;
    return existing;
  }

  const event = {
    id: params.eventId || nextId("event"),
    thread_id: params.threadId,
    board_version: boardVersion,
    event_type: "assistant_message",
    title: params.title,
    body: params.body || null,
    agent_id: params.agentId || null,
    session_id: params.sessionId || null,
    task_id: params.taskId || null,
    payload: params.payload || null,
    created_at: nowValue,
  };
  collaboration.events.push(event);
  return event;
}

function updateBoardAfterTurn(hub, { threadId, userContent, response, agentId, now }) {
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
  board.updated_at = now();
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

export async function executeGatewayTurn({
  hub,
  message,
  threadId,
  agentId,
  title = "",
  goal = "",
  source = "remote-bridge",
  createdFrom = "http",
  customAgents,
  runRuntimeTurn,
  writeHubConfig = async () => {},
  onAssistantUpdate = async () => {},
  nextId = defaultNextId,
  now = defaultNowIso,
}) {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    throw new Error("message_required");
  }

  const normalizedAgents = Array.isArray(customAgents) ? customAgents : [];
  const resolvedAgentId =
    String(agentId || "").trim() ||
    normalizedAgents[0]?.id ||
    "dolphin";
  const agentConfig = normalizedAgents.find((agent) => agent.id === resolvedAgentId);
  if (!agentConfig) {
    throw new Error(`agent_not_found:${resolvedAgentId}`);
  }

  let bundle =
    typeof threadId === "string" && threadId.trim().length > 0
      ? (() => {
          const collaboration = hub.collaboration || {};
          const thread = (collaboration.threads || []).find((item) => item.id === threadId);
          if (!thread) return null;
          const board = (collaboration.boards || []).find((item) => item.id === thread.board_id);
          const tasks = (collaboration.tasks || []).filter((item) => item.thread_id === threadId);
          const sessions = (collaboration.sessions || []).filter((item) => item.thread_id === threadId);
          const events = (collaboration.events || []).filter((item) => item.thread_id === threadId);
          return { thread, board, tasks, sessions, events };
        })()
      : null;

  let resolvedThreadId = typeof threadId === "string" ? threadId.trim() : "";

  if (!bundle) {
    bundle = createThread(hub, {
      title: String(title || "").trim() || formatThreadTitle(normalizedMessage),
      goal: String(goal || "").trim() || normalizedMessage,
      primaryAgentId: resolvedAgentId,
      nextId,
      now,
    });
    resolvedThreadId = bundle.thread.id;
  }

  bundle.thread.primary_agent_id = resolvedAgentId;
  bundle.thread.updated_at = now();

  const session = ensureThreadSession(hub, {
    threadId: resolvedThreadId,
    agentId: resolvedAgentId,
    runtimeSessionId: null,
    mode: "native",
    nextId,
    now,
  });

  const userEvent = recordThreadEvent(
    hub,
    {
      threadId: resolvedThreadId,
      eventType: "user_message",
      title: "远程控制发来消息",
      body: normalizedMessage,
      agentId: resolvedAgentId,
      sessionId: session.id,
      taskId: null,
      payload: {
        source,
        createdFrom,
      },
    },
    { nextId, now },
  );
  await writeHubConfig(hub);

  const assistantEventId = nextId("event");

  const handleAssistantUpdate = async ({ rawText, runtimeSessionId, phase }) => {
    const assistantEvent = upsertAssistantEvent(
      hub,
      {
        eventId: assistantEventId,
        threadId: resolvedThreadId,
        title:
          phase === "complete"
            ? `${agentConfig.name || resolvedAgentId} 已回复`
            : `${agentConfig.name || resolvedAgentId} 正在回复`,
        body: rawText,
        agentId: resolvedAgentId,
        sessionId: session.id,
        taskId: null,
        payload: {
          source,
          rawText,
          runtimeSessionId: runtimeSessionId || session.runtime_session_id || null,
          partial: phase !== "complete",
        },
      },
      { nextId, now },
    );
    if (phase !== "complete") {
      await writeHubConfig(hub);
    }
    await onAssistantUpdate({
      phase,
      message: buildMessageView(assistantEvent),
      runtimeSessionId: runtimeSessionId || null,
    });
    return assistantEvent;
  };

  const runtimeResult = await runRuntimeTurn({
    agentConfig,
    threadId: resolvedThreadId,
    agentId: resolvedAgentId,
    prompt: normalizedMessage,
    runtimeSessionId: session.runtime_session_id || null,
    onPartial: async ({ rawText, runtimeSessionId }) => {
      await handleAssistantUpdate({
        rawText,
        runtimeSessionId,
        phase: "partial",
      });
    },
  });

  session.runtime_session_id = runtimeResult.runtimeSessionId || session.runtime_session_id || null;
  session.mode = "native";
  session.status = "idle";
  session.updated_at = now();
  session.last_seen_board_version = Math.max(
    Number(session.last_seen_board_version || 0),
    Number(bundle.board?.version || 1),
  );

  const assistantEvent = await handleAssistantUpdate({
    rawText: runtimeResult.rawText,
    runtimeSessionId: runtimeResult.runtimeSessionId || null,
    phase: "complete",
  });

  if (assistantEvent?.payload) {
    assistantEvent.payload = {
      ...assistantEvent.payload,
      metadata: runtimeResult.metadata || null,
      partial: false,
    };
  }

  updateBoardAfterTurn(hub, {
    threadId: resolvedThreadId,
    userContent: normalizedMessage,
    response: runtimeResult.rawText,
    agentId: resolvedAgentId,
    now,
  });

  await writeHubConfig(hub);

  return {
    ok: true,
    threadId: resolvedThreadId,
    agentId: resolvedAgentId,
    userMessage: buildMessageView(userEvent),
    assistantMessage: buildMessageView(assistantEvent),
    runtimeSessionId: session.runtime_session_id || null,
  };
}
