import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const AGENTHUB_MEMO_PREFIX = "<!-- agenthub-memory:";
const OPENMEM_APP_ID = "agenthub";

function sanitizeOpenMemKey(value) {
  return String(value || "")
    .split("")
    .map((char) => (/^[A-Za-z0-9_-]$/.test(char) ? char : "-"))
    .join("");
}

function openMemUserId() {
  const user =
    process.env.USER ||
    process.env.USERNAME ||
    os.userInfo().username ||
    "default";
  return `agenthub-user-${sanitizeOpenMemKey(user.toLowerCase())}`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function hubConfigPath() {
  return path.join(os.homedir(), ".agenthub", "hub.json");
}

async function readHubConfig() {
  try {
    const file = await fs.readFile(hubConfigPath(), "utf8");
    return JSON.parse(file);
  } catch {
    return {
      memory: {
        provider: "memos",
        enabled: false,
        base_url: "",
        access_token: null,
      },
      collaboration: {
        threads: [],
        boards: [],
        tasks: [],
        sessions: [],
        events: [],
      },
    };
  }
}

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function looksLikeOpenMem(baseUrl) {
  const lowered = normalizeBaseUrl(baseUrl).toLowerCase();
  return (
    lowered.includes("/api/openmem/") ||
    lowered.includes("memos.memtensor.cn") ||
    lowered.includes("openmem.net")
  );
}

function normalizeMemoryProvider(config) {
  const baseUrl = normalizeBaseUrl(config?.base_url);
  const provider = looksLikeOpenMem(baseUrl)
    ? "openmem"
    : String(config?.provider || "memos").trim() || "memos";

  return {
    provider,
    enabled: Boolean(config?.enabled),
    base_url:
      provider === "openmem" && baseUrl && !baseUrl.endsWith("/api/openmem/v1")
        ? `${baseUrl}/api/openmem/v1`
        : baseUrl,
    access_token: config?.access_token || null,
  };
}

function authHeaders(config) {
  if (!config.access_token) {
    return {};
  }

  if (config.provider === "openmem") {
    return { Authorization: `Token ${config.access_token}` };
  }

  return { Authorization: `Bearer ${config.access_token}` };
}

function parseAgentHubMemo(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed.startsWith(AGENTHUB_MEMO_PREFIX)) return null;
  const end = trimmed.indexOf("-->");
  if (end === -1) return null;
  try {
    const meta = JSON.parse(
      trimmed.slice(AGENTHUB_MEMO_PREFIX.length, end).trim(),
    );
    const body = trimmed.slice(end + 3).trim();
    return { meta, body };
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      body
        ? `${response.status} ${body}`
        : `${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

function parseGitHubRepoRef(input) {
  const source = String(input || "").trim();
  if (!source) return null;

  const urlMatch = source.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2].replace(/\.git$/i, ""),
    };
  }

  const shortMatch = source.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
    };
  }

  return null;
}

async function githubRepoOverview(repoInput) {
  const parsed = parseGitHubRepoRef(repoInput);
  if (!parsed) {
    throw new Error(
      "无法识别 GitHub 仓库地址，请提供完整 GitHub URL 或 owner/repo。",
    );
  }

  const { owner, repo } = parsed;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agenthub-runtime",
  };

  const [repoData, languages, contents] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
    fetchJson(`https://api.github.com/repos/${owner}/${repo}/languages`, {
      headers,
    }).catch(() => ({})),
    fetchJson(`https://api.github.com/repos/${owner}/${repo}/contents`, {
      headers,
    }).catch(() => []),
  ]);

  const languageEntries = Object.entries(languages || {});
  const totalBytes = languageEntries.reduce(
    (sum, [, bytes]) => sum + Number(bytes || 0),
    0,
  );

  return {
    full_name: repoData.full_name,
    description: repoData.description || "",
    html_url: repoData.html_url,
    default_branch: repoData.default_branch,
    created_at: repoData.created_at,
    updated_at: repoData.updated_at,
    pushed_at: repoData.pushed_at,
    language: repoData.language,
    stargazers_count: repoData.stargazers_count,
    forks_count: repoData.forks_count,
    subscribers_count: repoData.subscribers_count,
    open_issues_count: repoData.open_issues_count,
    watchers_count: repoData.watchers_count,
    size_kb: repoData.size,
    archived: Boolean(repoData.archived),
    topics: Array.isArray(repoData.topics) ? repoData.topics : [],
    license: repoData.license?.spdx_id || repoData.license?.name || null,
    languages: languageEntries
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, 6)
      .map(([name, bytes]) => ({
        name,
        bytes,
        pct:
          totalBytes > 0
            ? Number(((Number(bytes || 0) / totalBytes) * 100).toFixed(1))
            : 0,
      })),
    top_level: Array.isArray(contents)
      ? contents.slice(0, 12).map((item) => ({
          name: item.name,
          type: item.type,
        }))
      : [],
  };
}

function getThreadBundle(hub, threadId) {
  const collaboration = hub?.collaboration || {};
  const thread = (collaboration.threads || []).find(
    (item) => item.id === threadId,
  );
  if (!thread) return null;
  const board = (collaboration.boards || []).find(
    (item) => item.id === thread.board_id,
  );
  const tasks = (collaboration.tasks || []).filter(
    (item) => item.thread_id === threadId,
  );
  const sessions = (collaboration.sessions || []).filter(
    (item) => item.thread_id === threadId,
  );
  const events = (collaboration.events || []).filter(
    (item) => item.thread_id === threadId,
  );
  return {
    thread,
    board,
    tasks,
    sessions,
    events,
  };
}

async function weatherLookup(location, days = 5) {
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      location,
    )}&count=1&language=zh&format=json`,
  );

  const first = geo?.results?.[0];
  if (!first) {
    throw new Error(`没有找到 ${location} 的天气位置`);
  }

  const forecast = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${first.latitude}&longitude=${first.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${Math.min(
      Math.max(days, 1),
      7,
    )}`,
  );

  const weatherCodeToText = (code) => {
    const map = {
      0: "晴朗",
      1: "大致晴朗",
      2: "局部多云",
      3: "阴天",
      45: "雾",
      48: "冻雾",
      51: "毛毛雨",
      53: "小雨",
      55: "中雨",
      61: "小雨",
      63: "中雨",
      65: "大雨",
      71: "小雪",
      73: "中雪",
      75: "大雪",
      80: "阵雨",
      81: "强阵雨",
      82: "暴雨",
      95: "雷暴",
    };
    return map[code] || "天气变化";
  };

  const daily = (forecast?.daily?.time || []).map((date, index) => ({
    date,
    high_c: forecast.daily.temperature_2m_max?.[index] ?? 0,
    low_c: forecast.daily.temperature_2m_min?.[index] ?? 0,
    condition: weatherCodeToText(forecast.daily.weather_code?.[index]),
  }));

  return {
    location: `${first.name}${first.admin1 ? `, ${first.admin1}` : ""}`,
    timezone: forecast?.timezone,
    condition: weatherCodeToText(forecast?.current?.weather_code),
    temperature_c: forecast?.current?.temperature_2m,
    feels_like_c: forecast?.current?.apparent_temperature,
    wind_speed_kmh: forecast?.current?.wind_speed_10m,
    high_c: forecast?.daily?.temperature_2m_max?.[0],
    low_c: forecast?.daily?.temperature_2m_min?.[0],
    updated_at: forecast?.current?.time,
    daily,
  };
}

async function memorySearch(memoryConfig, queryText, threadId, limit = 5) {
  if (!memoryConfig.enabled || !memoryConfig.base_url || !queryText.trim()) {
    return [];
  }

  if (memoryConfig.provider === "openmem") {
    const response = await fetchJson(`${memoryConfig.base_url}/search/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(memoryConfig),
      },
      body: JSON.stringify({
        user_id: openMemUserId(),
        query: queryText.trim(),
        conversation_id: threadId || undefined,
        filter: { app_id: OPENMEM_APP_ID },
        memory_limit_number: Math.max(limit, 1),
        include_preference: true,
        preference_limit_number: 4,
        include_tool_memory: false,
      }),
    });

    const data = response?.data || {};
    const detailList = Array.isArray(data.memory_detail_list)
      ? data.memory_detail_list
      : [];
    const preferences = Array.isArray(data.preference_detail_list)
      ? data.preference_detail_list
      : [];

    const items = detailList.map((item) => ({
      id: item.id,
      content: item.memory_value || item.memory_key || "",
      scope: item.conversation_id ? "thread" : "global",
      updated_at: item.update_time || item.create_time || null,
      tags: item.tags || [],
    }));

    items.push(
      ...preferences.map((item) => ({
        id: item.id,
        content: item.preference || "",
        scope: item.conversation_id ? "thread" : "global",
        updated_at: item.update_time || item.create_time || null,
        tags: [item.preference_type].filter(Boolean),
      })),
    );

    return items.slice(0, limit);
  }

  const payload = await fetchJson(
    `${memoryConfig.base_url}/api/v1/memos?pageSize=200&orderBy=display_time%20desc`,
    {
      headers: authHeaders(memoryConfig),
    },
  );
  const memos = Array.isArray(payload?.memos) ? payload.memos : [];
  const lowered = queryText.trim().toLowerCase();

  return memos
    .map((memo) => {
      const parsed = parseAgentHubMemo(memo.content);
      if (!parsed || parsed.meta.hidden) return null;
      return {
        id: memo.name,
        content: parsed.body,
        scope: parsed.meta.scope || "global",
        updated_at: memo.updateTime || memo.createTime || null,
        tags: parsed.meta.tags || [],
      };
    })
    .filter(Boolean)
    .filter((item) => item.content.toLowerCase().includes(lowered))
    .slice(0, limit);
}

function toToolResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function emitRuntimeMessage(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function extractAssistantText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

function buildUiPrompt(payload) {
  const outputSurface =
    payload?.outputSurface === "plain-chat" ? "plain-chat" : "agenthub-chat";

  if (outputSurface === "plain-chat") {
    return [
      "You are answering inside an external chat surface such as Feishu, Telegram, or voice transcript chat.",
      "Reply only in normal Markdown or plain text that reads naturally in a messaging app.",
      "Do not emit show-widget fences, HTML, CSS, JavaScript, JSON blobs, or implementation markers.",
      "Do not mention widgets, cards, rendering, visualization, components, or any internal protocol.",
      "Keep the answer direct and user-facing. Prefer concise paragraphs or short flat bullets when they genuinely help.",
      "If tools do not provide enough reliable data, answer honestly in normal Markdown instead of inventing structured output.",
      payload?.threadTitle
        ? `Current thread title: ${payload.threadTitle}`
        : "",
      payload?.agentName ? `Current acting agent: ${payload.agentName}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "You are answering inside AgentHub chat.",
    "You may answer entirely in normal Markdown. Decide for yourself whether a visual widget would materially improve comprehension, scannability, or usefulness.",
    "Only emit a widget when the answer truly benefits from a visual or interactive artifact. Do not force widgets for simple questions.",
    "Widgets are often helpful for compact overviews, key metrics, comparisons, trends, timelines, architecture sketches, checklists, dashboards, repository snapshots, task status, or memory summaries.",
    "When you choose to render a widget, emit one or more Markdown fenced blocks using exactly the marker ```show-widget.",
    "Each fence body must be valid JSON.",
    "Preferred widget protocol:",
    '```show-widget\\n{"title":"short title","widget_code":"<div>...</div><style>...</style><script>...</script>"}\\n```',
    "AgentHub also understands structured card JSON for weather, memory, and task boards, but a free widget is the default richer UI path.",
    "Use AgentHub tools whenever you need real data. Do not guess or fabricate values.",
    "When a widget contains concrete external facts, metrics, dates, repo metadata, weather values, memory items, or task state, you must call the relevant AgentHub tool in the same turn before emitting that widget.",
    "For weather, repository snapshots, memory recall, and task/workspace summaries, always use the matching AgentHub tool before showing exact numbers or specific factual claims.",
    "If you did not call a relevant tool, do not emit a factual widget. Fall back to normal Markdown and be honest about uncertainty.",
    "If tools do not provide enough reliable data, answer in normal Markdown instead of inventing a widget.",
    "Widgets must be self-contained HTML/CSS/JS with no external scripts, fonts, network calls, form submission, or nested iframes.",
    "Default to a light, low-chrome, embedded visual style that blends into a white chat surface. Avoid heavy dark dashboards, giant canvases, thick outer frames, ornamental borders, and giant empty areas unless the user explicitly asks for them.",
    "Aim for polished embedded cards, mini dashboards, compact charts, or tidy comparison views that feel native to chat instead of full-screen app mockups.",
    "Use the provided CSS variables such as --widget-bg, --widget-fg, --widget-muted, --widget-border, --widget-accent, --widget-surface, and --widget-surface-strong when styling widgets.",
    "Let AgentHub provide most of the outer chrome. Prefer transparent or very light widget roots over full-bleed dark backgrounds.",
    "Keep widgets responsive, visually polished, compact, and easy to scan inside a chat bubble. A typical widget should usually fit within roughly 220 to 420 px height unless the content clearly needs more room.",
    "If the widget already communicates the answer, keep any prose outside the widget extremely brief and non-redundant. One short lead-in or one short takeaway is enough.",
    "Do not repeat the same metrics in a long paragraph right below the widget unless extra explanation is genuinely helpful.",
    "Do not append Markdown tables, full metric dumps, or long bullet lists after a widget unless the user explicitly asks for a table or detailed text report.",
    "Do not narrate the UI choice. Never say things like '我来渲染一个卡片', '下面是可视化', '我做了一个小组件', or describe the rendering process. If you choose a widget, output it directly.",
    "Do not mention internal words such as widget, card, visualization, render, or component in user-facing prose unless the user explicitly asks about implementation.",
    "Do not write internal labels such as context sync, current thread, latest shared context, acting agent, or other implementation wording in user-facing output.",
    "Keep explanatory prose outside the widget fences in normal Markdown.",
    "Never wrap ordinary prose in show-widget fences.",
    payload?.threadTitle ? `Current thread title: ${payload.threadTitle}` : "",
    payload?.agentName ? `Current acting agent: ${payload.agentName}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildClaudeQueryOptions({ payload, bundle, agenthubServer }) {
  const env = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: "agenthub/0.1.0",
  };

  if (payload.authSource === "claude-subscription") {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_MODEL;
  }

  return {
    cwd: payload.cwd || process.cwd(),
    model: payload.model || undefined,
    tools: {
      type: "preset",
      preset: "claude_code",
    },
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: payload.maxTurns || 10,
    resume: payload.runtimeSessionId || undefined,
    persistSession: true,
    includePartialMessages: true,
    thinking: {
      type: "disabled",
    },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: buildUiPrompt({
        threadTitle: bundle?.thread?.title,
        agentName: payload.agentName,
        outputSurface: payload.outputSurface,
      }),
    },
    mcpServers: {
      agenthub: agenthubServer,
    },
    env,
    stderr(data) {
      process.stderr.write(data);
    },
  };
}

async function runQuery(payload) {
  const hub = await readHubConfig();
  const memoryConfig = normalizeMemoryProvider(hub.memory || hub.memos || {});
  const bundle = payload.threadId
    ? getThreadBundle(hub, payload.threadId)
    : null;
  const invokedTools = new Set();

  const agenthubServer = createSdkMcpServer({
    name: "agenthub",
    tools: [
      tool(
        "weather_lookup",
        "Look up real weather and short forecast using Open-Meteo. Use when the user asks about weather, temperature, conditions, or forecast.",
        {
          location: z.string().min(1),
          days: z.number().int().min(1).max(7).optional(),
        },
        async ({ location, days }) => {
          invokedTools.add("weather_lookup");
          return toToolResult(await weatherLookup(location, days ?? 5));
        },
      ),
      tool(
        "memory_search",
        "Search long-term memory from the configured Memos provider. Use when you need to recall stable facts, preferences, or previous long-term notes.",
        {
          query: z.string().min(1),
          thread_id: z.string().optional(),
          limit: z.number().int().min(1).max(10).optional(),
        },
        async ({ query: searchQuery, thread_id, limit }) => {
          invokedTools.add("memory_search");
          return toToolResult(
            await memorySearch(
              memoryConfig,
              searchQuery,
              thread_id || payload.threadId,
              limit ?? 5,
            ),
          );
        },
      ),
      tool(
        "task_board_read",
        "Read the current thread board, task list, open questions, and artifacts from AgentHub.",
        {
          thread_id: z.string().optional(),
        },
        async ({ thread_id }) => {
          invokedTools.add("task_board_read");
          const nextBundle = getThreadBundle(
            hub,
            thread_id || payload.threadId,
          );
          if (!nextBundle) {
            return toToolResult({ error: "thread_not_found" });
          }
          return toToolResult({
            thread: nextBundle.thread,
            board: nextBundle.board,
            tasks: nextBundle.tasks,
            artifacts: nextBundle.board?.artifacts || [],
          });
        },
      ),
      tool(
        "workspace_summary",
        "Get a concise summary of the current thread/workspace for collaboration context.",
        {
          thread_id: z.string().optional(),
        },
        async ({ thread_id }) => {
          invokedTools.add("workspace_summary");
          const nextBundle = getThreadBundle(
            hub,
            thread_id || payload.threadId,
          );
          if (!nextBundle) {
            return toToolResult({ error: "thread_not_found" });
          }
          return toToolResult({
            thread_title: nextBundle.thread?.title,
            objective: nextBundle.board?.objective,
            current_focus: nextBundle.board?.current_focus || null,
            summary: nextBundle.board?.summary || "",
            open_questions: nextBundle.board?.open_questions || [],
            key_files: nextBundle.board?.key_files || [],
            tasks: (nextBundle.tasks || []).map((task) => ({
              title: task.title,
              status: task.status,
              priority: task.priority,
              assigned_agent_id: task.assigned_agent_id || null,
            })),
          });
        },
      ),
      tool(
        "github_repo_overview",
        "Fetch real GitHub repository metadata, language mix, and top-level structure. Use when the user asks to analyze a GitHub repository, mentions a repo URL, or wants repository stats and a project snapshot.",
        {
          repo: z.string().min(1),
        },
        async ({ repo }) => {
          invokedTools.add("github_repo_overview");
          return toToolResult(await githubRepoOverview(repo));
        },
      ),
    ],
  });

  const toolsUsed = new Set();
  let sessionId = payload.runtimeSessionId || null;
  let lastAssistantText = "";
  let streamedText = "";
  let model = null;
  let resultUsage = null;
  let turns = null;

  const stream = query({
    prompt: payload.prompt,
    options: buildClaudeQueryOptions({
      payload,
      bundle,
      agenthubServer,
    }),
  });

  for await (const message of stream) {
    if (
      message &&
      typeof message === "object" &&
      "session_id" in message &&
      message.session_id
    ) {
      sessionId = message.session_id;
    }

    if (message?.type === "stream_event") {
      const streamEvent = message.event;
      if (
        streamEvent?.type === "content_block_delta" &&
        streamEvent?.delta?.type === "text_delta" &&
        typeof streamEvent.delta.text === "string"
      ) {
        streamedText += streamEvent.delta.text;
        if (payload.requestId) {
          emitRuntimeMessage({
            type: "partial",
            requestId: payload.requestId,
            rawText: streamedText,
            runtimeSessionId: sessionId,
          });
        }
      }
    }

    if (message?.type === "system" && message.subtype === "init") {
      model = message.model || model;
    }

    if (message?.type === "assistant") {
      const text = extractAssistantText(message.message);
      if (text) {
        lastAssistantText = text;
        if (payload.requestId && text !== streamedText) {
          streamedText = text;
          emitRuntimeMessage({
            type: "partial",
            requestId: payload.requestId,
            rawText: text,
            runtimeSessionId: sessionId,
          });
        }
      }
    }

    if (
      message?.type === "tool_progress" &&
      typeof message.tool_name === "string"
    ) {
      toolsUsed.add(message.tool_name);
    }

    if (message?.type === "result") {
      turns = message.num_turns ?? turns;
      resultUsage = message.usage ?? resultUsage;
      if (!lastAssistantText && typeof message.result === "string") {
        lastAssistantText = message.result.trim();
      }
    }
  }

  return {
    rawText: lastAssistantText || streamedText || "（无回复）",
    runtimeSessionId: sessionId,
    metadata: {
      model,
      toolsUsed: [...new Set([...toolsUsed, ...invokedTools])],
      turnCount: turns,
      usage: resultUsage,
    },
  };
}

async function main() {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};

  try {
    let result;
    try {
      result = await runQuery(payload);
    } catch (error) {
      if (payload.runtimeSessionId) {
        result = await runQuery({
          ...payload,
          runtimeSessionId: null,
        });
      } else {
        throw error;
      }
    }

    emitRuntimeMessage({
      type: "final",
      success: true,
      ...result,
    });
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    emitRuntimeMessage({
      type: "final",
      success: false,
      error: String(error?.message || error),
      rawText: "",
      runtimeSessionId: payload.runtimeSessionId || null,
      requestId: payload.requestId || null,
    });
    process.exitCode = 1;
  }
}

const entryHref = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (entryHref && import.meta.url === entryHref) {
  await main();
}
