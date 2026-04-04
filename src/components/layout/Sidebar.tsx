import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  LayoutDashboard, Plug, Wrench, Zap, Lock, Settings, RefreshCw, Loader2,
  BarChart3, Eye, Brain, Network, DollarSign, User, Cloud,
  MessageSquare, ListTodo, Clock, Send, Terminal,
  ChevronDown, ChevronRight, Radio, Bot,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAgentsStore } from "@/stores/agents-store";
import { useModeStore } from "@/stores/mode-store";
import { useAuthStore } from "@/stores/auth-store";
import { useCollaborationStore } from "@/stores/collaboration-store";
import { startCollaborationLiveSync } from "@/stores/collaboration-live-sync";
import type { DetectedAgent } from "@/lib/types/agents";

interface NavItem { label: string; icon: React.ReactNode; path: string; }

// Config mode nav — Dashboard is separate (top-level)
const configDashboard: NavItem = { label: "Dashboard", icon: <LayoutDashboard size={16} />, path: "/dashboard" };
const configResourceNav: NavItem[] = [
  { label: "Models", icon: <Plug size={16} />, path: "/models" },
  { label: "CLI", icon: <Terminal size={16} />, path: "/cli" },
  { label: "Channels", icon: <Radio size={16} />, path: "/channels" },
  { label: "MCP Servers", icon: <Wrench size={16} />, path: "/mcp" },
  { label: "Skills", icon: <Zap size={16} />, path: "/skills" },
  { label: "Secrets", icon: <Lock size={16} />, path: "/secrets" },
];
const configMonitorNav: NavItem[] = [
  { label: "Token Monitor", icon: <BarChart3 size={16} />, path: "/tokens" },
  { label: "API Usage", icon: <DollarSign size={16} />, path: "/usage" },
  { label: "Prompt Inspector", icon: <Eye size={16} />, path: "/prompts" },
  { label: "Memory", icon: <Brain size={16} />, path: "/memory" },
  { label: "Collaboration", icon: <Network size={16} />, path: "/collab" },
];

// Work mode nav
const workNav: NavItem[] = [
  { label: "对话", icon: <Send size={16} />, path: "/work/chat" },
  { label: "消息", icon: <MessageSquare size={16} />, path: "/work/messages" },
  { label: "任务", icon: <ListTodo size={16} />, path: "/work/tasks" },
  { label: "定时", icon: <Clock size={16} />, path: "/work/cron" },
];

function NavLink_({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink to={item.path}
      className={({ isActive }) => cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors",
        "hover:bg-foreground/[0.045] hover:text-foreground",
        isActive ? "bg-foreground/[0.045] text-foreground font-medium" : "text-sidebar-foreground"
      )} title={item.label}>
      {item.icon}
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}

function formatNewThreadTitle() {
  return `新任务线 ${new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function resolveRuntimeFamily(agent: DetectedAgent | undefined) {
  if (!agent) return "";
  return agent.runtime_family ?? agent.runtime_profile?.runtime_family ?? agent.agent_type;
}

function resolveCurrentAgent(
  agents: DetectedAgent[],
  pathname: string,
  queryAgentId: string,
  currentBundleAgentId: string,
  selectedAgentId: string,
) {
  const routeAgentId = pathname.match(/^\/agent\/([^/]+)/)?.[1] ?? "";
  const activeAgents = agents.filter((agent) => agent.running);
  const fallbackAgent = activeAgents[0] ?? agents[0] ?? null;
  const candidateIds = [routeAgentId, queryAgentId, currentBundleAgentId, selectedAgentId].filter(Boolean);

  for (const candidateId of candidateIds) {
    const matched = agents.find((agent) => agent.id === candidateId);
    if (matched) return matched;
  }

  return fallbackAgent;
}

function CurrentAgentResources() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { agents, selectedAgentId } = useAgentsStore();
  const { currentBundle } = useCollaborationStore();

  const currentAgent = resolveCurrentAgent(
    agents,
    location.pathname,
    searchParams.get("agent") ?? "",
    currentBundle?.thread.primary_agent_id ?? "",
    selectedAgentId ?? "",
  );

  if (!currentAgent) return null;

  const runtimeFamily = resolveRuntimeFamily(currentAgent);
  const overviewPath = `/agent/${currentAgent.id}`;
  const skillsPath = runtimeFamily === "claude-code" ? `${overviewPath}/skills` : "/skills";
  const channelsPath = runtimeFamily === "openclaw" ? `${overviewPath}/channels` : "/channels";

  const skillsMeta =
    currentAgent.details.type === "custom-agent"
      ? `${currentAgent.details.skill_directory_count} 个`
      : "has_skills" in currentAgent.details
        ? currentAgent.details.has_skills
          ? "已启用"
          : "未启用"
        : "查看";

  const channelMeta =
    currentAgent.details.type === "openclaw"
      ? [
          currentAgent.details.has_discord,
          currentAgent.details.has_telegram,
          currentAgent.details.has_whatsapp,
          currentAgent.details.has_feishu,
          currentAgent.details.has_slack,
          currentAgent.details.has_weixin,
        ].filter(Boolean).length
      : null;

  return (
    <>
      <div className="px-3 pt-1 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">当前 Agent</span>
      </div>
      <div className="px-2">
        <NavLink
          to={overviewPath}
          end
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors",
              isActive ? "bg-foreground/[0.045] text-foreground font-medium" : "text-sidebar-foreground hover:bg-foreground/[0.045] hover:text-foreground",
            )
          }
        >
          <span className="text-base leading-none">{currentAgent.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{currentAgent.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">{runtimeFamily || currentAgent.agent_type}</div>
          </div>
          <span className={cn("h-1.5 w-1.5 rounded-full", currentAgent.running ? "bg-emerald-400" : "bg-zinc-500/50")} />
        </NavLink>

        <div className="mt-0.5 flex flex-col gap-0.5">
          <NavLink
            to={overviewPath}
            end
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] transition-colors",
                isActive ? "bg-foreground/[0.045] text-foreground font-medium" : "text-sidebar-foreground hover:bg-foreground/[0.045] hover:text-foreground",
              )
            }
          >
            <Bot size={14} />
            <span className="flex-1">资源</span>
          </NavLink>

          <NavLink
            to={skillsPath}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] transition-colors",
                isActive ? "bg-foreground/[0.045] text-foreground font-medium" : "text-sidebar-foreground hover:bg-foreground/[0.045] hover:text-foreground",
              )
            }
          >
            <Zap size={14} />
            <span className="flex-1">Skills</span>
            <span className="text-[10px] text-muted-foreground/70">{skillsMeta}</span>
          </NavLink>

          <NavLink
            to={channelsPath}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] transition-colors",
                isActive ? "bg-foreground/[0.045] text-foreground font-medium" : "text-sidebar-foreground hover:bg-foreground/[0.045] hover:text-foreground",
              )
            }
          >
            <Radio size={14} />
            <span className="flex-1">Channels</span>
            <span className="text-[10px] text-muted-foreground/70">
              {channelMeta == null ? "查看" : channelMeta > 0 ? `${channelMeta} 个` : "未配置"}
            </span>
          </NavLink>
        </div>
      </div>
    </>
  );
}

function WorkChatThreads({ collapsed }: { collapsed: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState(true);
  const { agents } = useAgentsStore();
  const {
    threads,
    selectedThreadId,
    threadsLoading,
    creatingThread,
    loadThreads,
    selectThread,
    createThread,
  } = useCollaborationStore();

  const activeAgents = agents.filter((agent) => agent.running);
  const visibleAgents = activeAgents.length > 0 ? activeAgents : agents;
  const defaultAgentId =
    visibleAgents.find((agent) => agent.id === "dolphin")?.id ||
    visibleAgents[0]?.id ||
    "";
  const requestedThreadId = searchParams.get("thread") ?? "";
  const activeThreadId = threads.some((thread) => thread.id === requestedThreadId)
    ? requestedThreadId
    : selectedThreadId;
  const inChatRoute = location.pathname.startsWith("/work/chat");
  const showParentHighlight = inChatRoute && !activeThreadId;

  useEffect(() => startCollaborationLiveSync(loadThreads), [loadThreads]);

  useEffect(() => {
    if (inChatRoute) {
      setExpanded(true);
    }
  }, [inChatRoute]);

  if (collapsed) {
    return <NavLink_ item={workNav[0]} collapsed={collapsed} />;
  }

  const openThread = async (threadId: string) => {
    const nextThread = threads.find((thread) => thread.id === threadId);
    const nextAgentId =
      (nextThread?.primary_agent_id &&
      visibleAgents.some((agent) => agent.id === nextThread.primary_agent_id)
        ? nextThread.primary_agent_id
        : defaultAgentId) || undefined;

    await selectThread(threadId);

    const params = new URLSearchParams();
    params.set("thread", threadId);
    if (nextAgentId) {
      params.set("agent", nextAgentId);
    }

    navigate(`/work/chat?${params.toString()}`);
  };

  const handleCreateThread = async () => {
    try {
      const bundle = await createThread({
        title: formatNewThreadTitle(),
        goal: "",
        primaryAgentId: defaultAgentId || undefined,
      });

      const params = new URLSearchParams();
      params.set("thread", bundle.thread.id);
      if (defaultAgentId) {
        params.set("agent", defaultAgentId);
      }

      navigate(`/work/chat?${params.toString()}`);
    } catch (error) {
      console.error("Failed to create thread from sidebar:", error);
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="group flex items-center gap-1">
          <button
            onClick={() => setExpanded((value) => !value)}
            className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors",
            "hover:bg-foreground/[0.045] hover:text-foreground",
            showParentHighlight
              ? "bg-foreground/[0.045] text-foreground font-medium"
              : "text-sidebar-foreground",
          )}
          title="对话"
        >
          <Send size={16} />
          <span className="flex-1 text-left">对话</span>
          {expanded ? <ChevronDown size={14} className="text-muted-foreground/60" /> : <ChevronRight size={14} className="text-muted-foreground/60" />}
        </button>

        <button
          onClick={() => {
            void handleCreateThread();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-foreground"
          title="创建新对话"
        >
          {creatingThread ? <Loader2 size={12} className="animate-spin" /> : <span className="text-[14px] leading-none">+</span>}
        </button>
      </div>

      {expanded && (
        <div className="ml-6 flex flex-col gap-0.5 border-l border-sidebar-border/45 pl-2">
          {threadsLoading ? (
            <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground/55">加载中...</div>
          ) : threads.length === 0 ? (
            <button
              onClick={() => {
                void handleCreateThread();
              }}
              className="rounded-lg px-2.5 py-1.5 text-left text-[12px] text-muted-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              创建第一条对话
            </button>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => {
                  void openThread(thread.id);
                }}
                className={cn(
                  "rounded-xl px-3 py-2 text-left text-[12px] transition-colors",
                  activeThreadId === thread.id
                    ? "bg-foreground/[0.045] text-foreground font-medium"
                    : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
                )}
                title={thread.title}
              >
                <div className="truncate">{thread.title}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AgentInstances({ collapsed }: { collapsed: boolean }) {
  const { agents, loading, refresh } = useAgentsStore();

  return (
    <div>
      {!collapsed && (
        <div className="flex items-center justify-between px-3 pt-4 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Agents</span>
          <button onClick={() => refresh()} className="text-muted-foreground/50 hover:text-foreground transition-colors" title="Refresh">
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          </button>
        </div>
      )}
      <nav className="flex flex-col gap-0.5 px-2 mt-1">
        {agents.length === 0 && !loading && !collapsed && (
          <div className="px-2.5 py-1.5 text-xs text-muted-foreground/50">No agents detected</div>
        )}
        {agents.map((agent) => (
          <NavLink key={agent.id}
            to={`/agent/${agent.id}`}
            className={({ isActive }) => cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors",
              "hover:bg-foreground/[0.045] hover:text-foreground",
              isActive ? "bg-foreground/[0.045] text-foreground font-medium" : "text-sidebar-foreground"
            )} title={`${agent.name}${agent.running ? " (Running)" : ""}`}>
            <span className="text-sm leading-none">{agent.icon}</span>
            {!collapsed && (
              <>
                <span className="flex-1 truncate">{agent.name}</span>
                <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", agent.running ? "bg-emerald-400" : "bg-zinc-500/40")} />
              </>
            )}
          </NavLink>
        ))}
        {!collapsed && (
          <NavLink to="/remote-hosts"
            className={({ isActive }) => cn(
              "mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] transition-colors",
              "hover:bg-foreground/[0.045] hover:text-foreground",
              isActive ? "bg-foreground/[0.045] text-foreground" : "text-muted-foreground/50"
            )}>
            <span className="text-[11px]">＋</span>
            <span>添加远程主机</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}

export function Sidebar() {
  const { totalRunning, totalDetected, refresh } = useAgentsStore();
  const { mode, setMode, sidebarCollapsed: collapsed } = useModeStore();
  const authUser = useAuthStore(s => s.user);

  useEffect(() => {
    refresh();
    const intervalId = setInterval(refresh, 15000);
    return () => clearInterval(intervalId);
  }, [refresh]);

  return (
    <aside
      className={cn(
        "shrink-0 overflow-hidden bg-sidebar transition-[width,opacity,transform,border-color,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        collapsed ? "w-0 -translate-x-2 opacity-0" : "w-[228px] opacity-100",
      )}
    >
      <div className="flex h-full min-h-0 w-[228px] flex-col">
        {/* Top: Logo */}
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-lg flex-shrink-0">⬡</span>
          <span className="flex-1 text-[14px] font-semibold text-foreground">AgentHub</span>
          <div className="flex items-center gap-1.5" title={`${totalRunning} running / ${totalDetected} detected`}>
            <span className={cn("h-1.5 w-1.5 rounded-full", totalRunning > 0 ? "bg-emerald-400" : "bg-zinc-500")} />
            <span className="text-[10px] text-muted-foreground/60">{totalRunning}/{totalDetected}</span>
          </div>
        </div>

        <div className="px-2 pb-2">
          <div className="flex rounded-xl border border-border/70 bg-background/60 p-0.5 backdrop-blur">
            <button onClick={() => setMode("work")}
              className={cn("flex-1 text-[11px] py-1 rounded-md transition-colors",
                mode === "work" ? "bg-card text-foreground font-medium shadow-[0_10px_22px_-18px_rgba(24,24,27,0.35)]" : "text-muted-foreground hover:text-foreground")}>
              Work
            </button>
            <button onClick={() => setMode("config")}
              className={cn("flex-1 text-[11px] py-1 rounded-md transition-colors",
                mode === "config" ? "bg-card text-foreground font-medium shadow-[0_10px_22px_-18px_rgba(24,24,27,0.35)]" : "text-muted-foreground hover:text-foreground")}>
              Config
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto px-0 pt-1">
          {mode === "work" ? (
            <>
              <CurrentAgentResources />
              <div className="px-3 pt-1 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">工作</span>
              </div>
              <nav className="flex flex-col gap-0.5 px-2">
                <WorkChatThreads collapsed={collapsed} />
                {workNav.slice(1).map(item => <NavLink_ key={item.path} item={item} collapsed={collapsed} />)}
              </nav>
            </>
          ) : (
            <>
              {/* Dashboard — top level */}
              <nav className="mb-2 flex flex-col gap-0.5 px-2">
                <NavLink_ item={configDashboard} collapsed={collapsed} />
              </nav>

              <div className="px-3 pt-1 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Resources</span>
              </div>
              <nav className="flex flex-col gap-0.5 px-2">
                {configResourceNav.map(item => <NavLink_ key={item.path} item={item} collapsed={collapsed} />)}
              </nav>
              <div className="px-3 pt-4 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Monitor</span>
              </div>
              <nav className="flex flex-col gap-0.5 px-2">
                {configMonitorNav.map(item => <NavLink_ key={item.path} item={item} collapsed={collapsed} />)}
              </nav>
            </>
          )}

          {mode === "config" && <AgentInstances collapsed={collapsed} />}
        </div>

        {/* Bottom */}
        <div className="px-2 py-2">
          <div className="flex items-center gap-1.5">
            <NavLink to="/account"
              className={({ isActive }) => cn(
                "flex flex-1 min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                "hover:bg-foreground/[0.045] hover:text-foreground", isActive ? "bg-foreground/[0.045]" : ""
              )} title="Account">
              {authUser ? (
                <img src={authUser.avatar_url} className="h-6 w-6 rounded-full flex-shrink-0" />
              ) : (
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/15 flex-shrink-0">
                  <User size={13} className="text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-sidebar-foreground truncate">{authUser?.name || authUser?.login || "登录"}</div>
                <div className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                  {authUser ? <><Cloud size={9} /> 已连接</> : "未登录"}
                </div>
              </div>
            </NavLink>
            <NavLink to="/settings"
              className={({ isActive }) => cn(
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors",
                "hover:bg-foreground/[0.045] hover:text-foreground",
                isActive ? "bg-foreground/[0.045] text-foreground" : "text-muted-foreground/40"
              )} title="Settings">
              <Settings size={15} />
            </NavLink>
          </div>
        </div>
      </div>
    </aside>
  );
}
