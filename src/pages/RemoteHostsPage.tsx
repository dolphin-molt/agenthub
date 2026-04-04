import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import { SettingsGroup } from "@/components/shared/SettingsGroup";
import { EditableRow } from "@/components/shared/EditableRow";
import { SelectRow } from "@/components/shared/SelectRow";
import { toast } from "sonner";

type ConnType = "ssh" | "docker-local" | "docker-ssh" | "gateway-ws";

interface RemoteHost {
  id: string;
  name: string;
  connType: ConnType;
  // SSH
  host?: string;
  user?: string;
  port?: number;
  keyPath?: string;
  // Docker
  containerId?: string;
  // Docker over SSH (reuses host/user/port/keyPath + containerId)
  // Gateway WebSocket
  wsUrl?: string;
  wsToken?: string;
  // State
  agents: { id: string; name: string; type: string; running: boolean }[];
  lastScan: string | null;
  status: "connected" | "disconnected" | "scanning";
}

interface RemoteBridgeStatus {
  running: boolean;
  pid: number | null;
  status: string;
  port: number | null;
  token: string | null;
  localUrls: string[];
  startedAt: string | null;
  updatedAt: string | null;
  lastRequestAt: string | null;
  lastError: string | null;
  activeThreadId: string | null;
  logPath: string;
}

interface RemoteBridgeLogTail {
  logPath: string;
  lines: string[];
  truncated: boolean;
  updatedAt: string;
}

interface RelayAgentStatus {
  running: boolean;
  pid: number | null;
  status: string;
  relayBaseUrl: string | null;
  hostId: string | null;
  hostDisplayName: string | null;
  sessionCount: number;
  startedAt: string | null;
  updatedAt: string | null;
  lastSyncAt: string | null;
  connectedAt: string | null;
  lastError: string | null;
  mediaDefaults: RelayMediaConfig | null;
  activeCall: RelayActiveCallSummary | null;
  logPath: string;
}

interface RelayModelSelection {
  providerId: string;
  modelId: string;
}

interface RelayMediaConfig {
  voice?: RelayModelSelection | null;
  video?: RelayModelSelection | null;
}

interface RelayActiveCallSummary {
  callId: string;
  hostId: string;
  clientId: string;
  sessionId: string | null;
  mode: "audio" | "video" | "camera-share";
  state: "idle" | "dialing" | "ringing" | "connecting" | "live" | "ended" | "failed";
  createdAt: string;
  updatedAt: string;
  mediaConfig: RelayMediaConfig | null;
}

interface RelayPairingInvite {
  inviteId: string;
  hostId: string;
  relayBaseUrl: string;
  code: string;
  expiresAt: string;
  pairingUrl: string;
  pairingAppUrl: string;
}

const CONN_OPTIONS = [
  { value: "ssh", label: "SSH 直连" },
  { value: "docker-local", label: "本地 Docker" },
  { value: "docker-ssh", label: "远程 Docker (SSH)" },
  { value: "gateway-ws", label: "Gateway WebSocket" },
];

const HOSTS_PATH = "/Users/dolphin/.agenthub/remote-hosts.json";
const WEB_CHAT_VERSION = "20260403b";

const RELAY_CALL_MODE_LABELS: Record<RelayActiveCallSummary["mode"], string> = {
  audio: "语音通话",
  video: "视频通话",
  "camera-share": "相机共享",
};

const RELAY_CALL_STATE_LABELS: Record<RelayActiveCallSummary["state"], string> = {
  idle: "空闲",
  dialing: "呼叫中",
  ringing: "振铃中",
  connecting: "连接中",
  live: "通话进行中",
  ended: "已结束",
  failed: "已失败",
};

function formatRelayModelTarget(target?: RelayModelSelection | null) {
  if (!target) {
    return null;
  }
  return `${target.providerId} / ${target.modelId}`;
}

function mergeRelayMediaConfig(
  primary?: RelayMediaConfig | null,
  fallback?: RelayMediaConfig | null,
): RelayMediaConfig | null {
  const voice = primary?.voice ?? fallback?.voice ?? null;
  const video = primary?.video ?? fallback?.video ?? null;
  if (!voice && !video) {
    return null;
  }
  return { voice, video };
}

function hasRelayMediaConfig(config?: RelayMediaConfig | null) {
  return Boolean(config?.voice || config?.video);
}

export default function RemoteHostsPage() {
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [relayStatus, setRelayStatus] = useState<RelayAgentStatus | null>(null);
  const [relayBusy, setRelayBusy] = useState<"start" | "restart" | "stop" | "pair" | null>(null);
  const [relayBaseUrlInput, setRelayBaseUrlInput] = useState("");
  const [pairingInvite, setPairingInvite] = useState<RelayPairingInvite | null>(null);
  const [relayQrCode, setRelayQrCode] = useState("");
  const [bridgeStatus, setBridgeStatus] = useState<RemoteBridgeStatus | null>(null);
  const [bridgeLog, setBridgeLog] = useState<RemoteBridgeLogTail | null>(null);
  const [bridgeBusy, setBridgeBusy] = useState<"start" | "restart" | "stop" | null>(null);
  const [adding, setAdding] = useState(false);
  const [newConn, setNewConn] = useState<ConnType>("ssh");
  const [form, setForm] = useState({ name: "", host: "", user: "root", port: 22, keyPath: "~/.ssh/id_rsa", containerId: "", wsUrl: "", wsToken: "" });
  const [scanning, setScanning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chatQrCode, setChatQrCode] = useState<string>("");
  const hostMediaDefaults = relayStatus?.mediaDefaults ?? null;
  const activeCallMedia = mergeRelayMediaConfig(relayStatus?.activeCall?.mediaConfig, hostMediaDefaults);
  const activeCallHasOverride = hasRelayMediaConfig(relayStatus?.activeCall?.mediaConfig);

  useEffect(() => {
    import("@tauri-apps/api/core").then(async ({ invoke }) => {
      try {
        const data = await invoke<Record<string, unknown>>("read_json_file", { path: HOSTS_PATH });
        if (Array.isArray(data?.hosts)) setHosts(data.hosts as RemoteHost[]);
      } catch { /* */ }
    });
  }, []);

  const loadRelayState = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<RelayAgentStatus>("get_relay_agent_status");
      setRelayStatus(status);
      setRelayBaseUrlInput((current) => current || status.relayBaseUrl || "");
    } catch (error) {
      console.error("Failed to load relay state:", error);
    }
  };

  const loadBridgeState = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [status, logTail] = await Promise.all([
        invoke<RemoteBridgeStatus>("get_remote_bridge_status"),
        invoke<RemoteBridgeLogTail>("read_remote_bridge_log", { tailLines: 60 }),
      ]);
      setBridgeStatus(status);
      setBridgeLog(logTail);
    } catch (error) {
      console.error("Failed to load remote bridge state:", error);
    }
  };

  useEffect(() => {
    void loadRelayState();
    void loadBridgeState();
  }, []);

  useEffect(() => {
    if (!relayStatus?.running) return;
    const timer = window.setInterval(() => {
      void loadRelayState();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [relayStatus?.running]);

  useEffect(() => {
    if (!bridgeStatus?.running) return;
    const timer = window.setInterval(() => {
      void loadBridgeState();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [bridgeStatus?.running]);

  const saveHosts = async (updated: RemoteHost[]) => {
    setHosts(updated);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_json_file", { path: HOSTS_PATH, data: JSON.stringify({ hosts: updated }, null, 2) });
    } catch { /* */ }
  };

  const addHost = async () => {
    const host: RemoteHost = {
      id: `remote-${Date.now()}`,
      name: form.name || form.host || form.containerId || form.wsUrl || "未命名",
      connType: newConn,
      host: newConn !== "docker-local" && newConn !== "gateway-ws" ? form.host : undefined,
      user: newConn === "ssh" || newConn === "docker-ssh" ? form.user : undefined,
      port: newConn === "ssh" || newConn === "docker-ssh" ? form.port : undefined,
      keyPath: newConn === "ssh" || newConn === "docker-ssh" ? form.keyPath : undefined,
      containerId: newConn === "docker-local" || newConn === "docker-ssh" ? form.containerId : undefined,
      wsUrl: newConn === "gateway-ws" ? form.wsUrl : undefined,
      wsToken: newConn === "gateway-ws" ? form.wsToken : undefined,
      agents: [], lastScan: null, status: "disconnected",
    };
    const updated = [...hosts, host];
    await saveHosts(updated);
    setAdding(false);
    setForm({ name: "", host: "", user: "root", port: 22, keyPath: "~/.ssh/id_rsa", containerId: "", wsUrl: "", wsToken: "" });
    toast.success(`已添加 ${host.name}`);
    scanHost(host.id, updated);
  };

  const removeHost = async (id: string) => {
    await saveHosts(hosts.filter(h => h.id !== id));
    toast.success("已删除");
  };

  const runRelayAction = async (action: "start" | "restart" | "stop") => {
    try {
      setRelayBusy(action);
      const { invoke } = await import("@tauri-apps/api/core");
      if (action === "stop") {
        await invoke("stop_relay_agent");
        setPairingInvite(null);
        setRelayQrCode("");
      } else {
        await invoke("sync_relay_agent", {
          forceRestart: action === "restart",
          relayBaseUrl: relayBaseUrlInput,
        });
      }
      await loadRelayState();
      toast.success(
        action === "stop"
          ? "Remote Mode 已停止"
          : action === "restart"
            ? "Remote Mode 已重启"
            : "Remote Mode 已启动",
      );
    } catch (error) {
      console.error("Failed to run relay action:", error);
      toast.error(`Relay 操作失败: ${error}`);
    } finally {
      setRelayBusy(null);
    }
  };

  const generatePairingInvite = async () => {
    try {
      setRelayBusy("pair");
      const { invoke } = await import("@tauri-apps/api/core");
      const invite = await invoke<RelayPairingInvite>("create_relay_pairing_invite", {
        ttlSecs: 300,
      });
      setPairingInvite(invite);
      toast.success("已生成配对二维码");
    } catch (error) {
      console.error("Failed to create pairing invite:", error);
      toast.error(`生成配对二维码失败: ${error}`);
    } finally {
      setRelayBusy(null);
    }
  };

  const runBridgeAction = async (action: "start" | "restart" | "stop") => {
    try {
      setBridgeBusy(action);
      const { invoke } = await import("@tauri-apps/api/core");
      if (action === "stop") {
        await invoke("stop_remote_bridge");
      } else {
        await invoke("sync_remote_bridge", { forceRestart: action === "restart" });
      }
      await loadBridgeState();
      toast.success(
        action === "stop"
          ? "本地调试入口已停止"
          : action === "restart"
            ? "本地调试入口已重启"
            : "本地调试入口已启动",
      );
    } catch (error) {
      console.error("Failed to run remote bridge action:", error);
      toast.error(`本地调试入口操作失败: ${error}`);
    } finally {
      setBridgeBusy(null);
    }
  };

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`已复制${label}`);
    } catch (error) {
      console.error(`Failed to copy ${label}:`, error);
      toast.error(`复制${label}失败`);
    }
  };

  const scanHost = async (id: string, currentHosts?: RemoteHost[]) => {
    const list = currentHosts || hosts;
    const host = list.find(h => h.id === id);
    if (!host) return;
    setScanning(id);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const agents: RemoteHost["agents"] = [];

      if (host.connType === "gateway-ws") {
        // Gateway WebSocket — just check health
        const url = (host.wsUrl || "").replace("ws://", "http://").replace("wss://", "https://").replace(/\/$/, "");
        const result = await invoke<{ stdout: string; success: boolean }>("run_shell_cmd", {
          command: `curl -s -m 5 ${url}/health 2>/dev/null`, timeoutSecs: 10,
        });
        if (result.stdout.includes('"ok":true')) {
          agents.push({ id: "openclaw-remote", name: "OpenClaw (Gateway)", type: "openclaw", running: true });
        }
      } else {
        // Build exec prefix based on connection type
        let execPrefix = "";
        if (host.connType === "ssh") {
          execPrefix = `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -p ${host.port || 22} -i ${host.keyPath || "~/.ssh/id_rsa"} ${host.user || "root"}@${host.host}`;
        } else if (host.connType === "docker-local") {
          execPrefix = `docker exec ${host.containerId}`;
        } else if (host.connType === "docker-ssh") {
          const sshPart = `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -p ${host.port || 22} -i ${host.keyPath || "~/.ssh/id_rsa"} ${host.user || "root"}@${host.host}`;
          execPrefix = `${sshPart} docker exec ${host.containerId}`;
        }

        // Scan for agent directories
        const result = await invoke<{ stdout: string; success: boolean }>("run_shell_cmd", {
          command: `${execPrefix} sh -c 'ls -d ~/.openclaw 2>/dev/null && echo OPENCLAW; ls -d ~/.claude 2>/dev/null && echo CLAUDE; ls -d ~/.codex 2>/dev/null && echo CODEX; ls -d ~/.qclaw 2>/dev/null && echo QCLAW' 2>/dev/null`,
          timeoutSecs: 15,
        });

        const output = result.stdout || "";
        if (output.includes("OPENCLAW")) agents.push({ id: "openclaw", name: "OpenClaw", type: "openclaw", running: false });
        if (output.includes("CLAUDE")) agents.push({ id: "claude-code", name: "Claude Code", type: "claude-code", running: false });
        if (output.includes("CODEX")) agents.push({ id: "codex", name: "Codex CLI", type: "codex", running: false });
        if (output.includes("QCLAW")) agents.push({ id: "qclaw", name: "QClaw", type: "openclaw", running: false });

        // Check running processes
        const psResult = await invoke<{ stdout: string; success: boolean }>("run_shell_cmd", {
          command: `${execPrefix} sh -c 'pgrep -fl "openclaw\\|claude\\|codex" 2>/dev/null || true'`, timeoutSecs: 10,
        });
        const ps = (psResult.stdout || "").toLowerCase();
        agents.forEach(a => {
          if (a.type === "openclaw" && ps.includes("openclaw")) a.running = true;
          if (a.type === "claude-code" && ps.includes("claude")) a.running = true;
          if (a.type === "codex" && ps.includes("codex")) a.running = true;
        });
      }

      const updated = list.map(h => h.id === id ? { ...h, agents, lastScan: new Date().toISOString(), status: "connected" as const } : h);
      await saveHosts(updated);
      toast.success(`扫描到 ${agents.length} 个 Agent`);
    } catch (err) {
      const updated = list.map(h => h.id === id ? { ...h, status: "disconnected" as const } : h);
      await saveHosts(updated);
      toast.error(`连接失败: ${err}`);
    }
    setScanning(null);
  };

  const connLabel = (t: ConnType) => CONN_OPTIONS.find(o => o.value === t)?.label || t;
  const primaryBridgeUrl = bridgeStatus?.localUrls?.[0] || "";
  const maskedToken = bridgeStatus?.token ? `${bridgeStatus.token.slice(0, 8)}...${bridgeStatus.token.slice(-6)}` : "尚未生成";
  const publicChatUrl = bridgeStatus?.token
    ? `https://control.nanobanani.app/?v=${WEB_CHAT_VERSION}#token=${encodeURIComponent(bridgeStatus.token)}`
    : "";
  const curlListCommand =
    primaryBridgeUrl && bridgeStatus?.token
      ? `curl -H "Authorization: Bearer ${bridgeStatus.token}" ${primaryBridgeUrl}/threads`
      : "";

  useEffect(() => {
    let cancelled = false;
    const qrValue = pairingInvite?.pairingAppUrl || pairingInvite?.pairingUrl;

    if (!qrValue) {
      setRelayQrCode("");
      return;
    }

    void QRCode.toDataURL(qrValue, {
      width: 220,
      margin: 1,
      color: {
        dark: "#1f1a16",
        light: "#0000",
      },
    })
      .then((dataUrl: string) => {
        if (!cancelled) {
          setRelayQrCode(dataUrl);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to generate relay QR code:", error);
        if (!cancelled) {
          setRelayQrCode("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pairingInvite?.pairingAppUrl, pairingInvite?.pairingUrl]);
  const curlTurnCommand =
    primaryBridgeUrl && bridgeStatus?.token
      ? `curl -X POST -H "Authorization: Bearer ${bridgeStatus.token}" -H "Content-Type: application/json" -d '{"message":"你好","agentId":"dolphin"}' ${primaryBridgeUrl}/turn`
      : "";

  useEffect(() => {
    let cancelled = false;

    if (!publicChatUrl) {
      setChatQrCode("");
      return;
    }

    void QRCode.toDataURL(publicChatUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: "#1f1a16",
        light: "#0000",
      },
    })
      .then((dataUrl: string) => {
        if (!cancelled) {
          setChatQrCode(dataUrl);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to generate chat QR code:", error);
        if (!cancelled) {
          setChatQrCode("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [publicChatUrl]);

  return (
    <div className="space-y-6 max-w-xl pb-8">
      <div>
        <h1 className="text-lg font-semibold">远程主机</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">管理远程服务器、Docker 容器和 Gateway 上的 Agent</p>
      </div>

      <SettingsGroup title="Remote Mode">
        <div className="px-1 py-2 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn("w-1.5 h-1.5 rounded-full", relayStatus?.running ? "bg-emerald-500" : "bg-muted-foreground/20")} />
                <span className="text-[13px] font-medium">Cloud Relay Gateway</span>
                <span className="text-[11px] text-muted-foreground">
                  {relayStatus?.running ? "运行中" : relayStatus?.status || "未启动"}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                这就是手机和后续语音视频入口会复用的主远程模式。本地 Gateway 通过出站连接注册到云端 Relay，客户端先连云端，再路由回这台机器。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void runRelayAction(relayStatus?.running ? "restart" : "start")}
                disabled={relayBusy !== null}
                className="text-[12px] px-3 py-1 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-60"
              >
                {relayBusy === "start" || relayBusy === "restart"
                  ? "处理中..."
                  : relayStatus?.running
                    ? "重启"
                    : "启动"}
              </button>
              <button
                onClick={() => void runRelayAction("stop")}
                disabled={!relayStatus?.running || relayBusy !== null}
                className="text-[12px] px-3 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                停止
              </button>
            </div>
          </div>

          <EditableRow
            label="Relay URL"
            value={relayBaseUrlInput}
            mono
            onSave={(value) => setRelayBaseUrlInput(value)}
            placeholder="https://your-relay.workers.dev/api"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Host ID</div>
              <div className="mt-1 text-[12px] break-all font-mono text-foreground/90">
                {relayStatus?.hostId || "启动后生成"}
              </div>
              {relayStatus?.hostId && (
                <button
                  onClick={() => void copyText("Host ID", relayStatus.hostId!)}
                  className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  复制 Host ID
                </button>
              )}
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sessions</div>
              <div className="mt-1 text-[12px] text-foreground/90">
                {relayStatus?.sessionCount ?? 0} 个本地会话
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {relayStatus?.hostDisplayName || "当前桌面 Host"}
              </div>
            </div>
          </div>

          {hasRelayMediaConfig(hostMediaDefaults) && (
            <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Media Defaults</div>
              <div className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                {hostMediaDefaults?.voice && (
                  <div>语音模型：{formatRelayModelTarget(hostMediaDefaults.voice)}</div>
                )}
                {hostMediaDefaults?.video && (
                  <div>视频模型：{formatRelayModelTarget(hostMediaDefaults.video)}</div>
                )}
              </div>
            </div>
          )}

          {relayStatus?.activeCall && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-600/90">
                    Active Call
                  </div>
                  <div className="mt-1 text-[13px] font-medium text-foreground">
                    {RELAY_CALL_MODE_LABELS[relayStatus.activeCall.mode]} · {RELAY_CALL_STATE_LABELS[relayStatus.activeCall.state]}
                  </div>
                </div>
                <div className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-700">
                  {relayStatus.activeCall.sessionId ? "已绑定会话" : "等待会话"}
                </div>
              </div>
              <div className="mt-3 space-y-1 text-[12px] text-muted-foreground">
                {relayStatus.activeCall.sessionId && <div>会话：{relayStatus.activeCall.sessionId}</div>}
                <div>客户端：{relayStatus.activeCall.clientId}</div>
                {activeCallMedia?.voice && (
                  <div>当前语音模型：{formatRelayModelTarget(activeCallMedia.voice)}</div>
                )}
                {activeCallMedia?.video && (
                  <div>当前视频模型：{formatRelayModelTarget(activeCallMedia.video)}</div>
                )}
                {activeCallHasOverride && (
                  <div className="text-emerald-700/90">本次通话覆盖了 Host 默认媒体配置</div>
                )}
                <div>最近状态更新时间：{new Date(relayStatus.activeCall.updatedAt).toLocaleString("zh-CN")}</div>
              </div>
            </div>
          )}

          {(relayStatus?.connectedAt || relayStatus?.lastSyncAt || relayStatus?.lastError) && (
            <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-[12px] text-muted-foreground space-y-1">
              {relayStatus?.connectedAt && <div>连接建立：{new Date(relayStatus.connectedAt).toLocaleString("zh-CN")}</div>}
              {relayStatus?.lastSyncAt && <div>最近同步：{new Date(relayStatus.lastSyncAt).toLocaleString("zh-CN")}</div>}
              {relayStatus?.lastError && <div className="text-red-500/90">最近错误：{relayStatus.lastError}</div>}
            </div>
          )}

          <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">手机配对</div>
                <p className="text-[12px] text-muted-foreground">
                  生成一次性的二维码邀请，让 iOS App 直接认领这台 Host，不再手填 Base URL 和长 Token。
                </p>
              </div>
              <button
                onClick={() => void generatePairingInvite()}
                disabled={!relayStatus?.running || relayBusy !== null}
                className="text-[12px] px-3 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {relayBusy === "pair" ? "生成中..." : "生成二维码"}
              </button>
            </div>

            {pairingInvite && (
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="shrink-0 rounded-2xl border border-border/70 bg-white p-3 shadow-sm">
                  {relayQrCode ? (
                    <img
                      src={relayQrCode}
                      alt="Relay 配对二维码"
                      className="h-[156px] w-[156px] rounded-lg"
                    />
                  ) : (
                    <div className="flex h-[156px] w-[156px] items-center justify-center text-[12px] text-muted-foreground">
                      生成二维码中...
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-[12px] break-all text-foreground/90 font-mono">{pairingInvite.code}</div>
                  <div className="text-[11px] text-muted-foreground">
                    过期时间：{new Date(pairingInvite.expiresAt).toLocaleString("zh-CN")}
                  </div>
                  <div className="text-[11px] text-foreground/70">
                    手机扫码会直接打开 LobsterMobile 并开始配对。
                  </div>
                  <div className="text-[12px] break-all text-muted-foreground">{pairingInvite.pairingAppUrl}</div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => void copyText("配对链接", pairingInvite.pairingAppUrl)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      复制配对链接
                    </button>
                    <button
                      onClick={() => void copyText("配对码", pairingInvite.code)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      复制配对码
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Advanced / Local Debug">
        <div className="px-1 py-2 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn("w-1.5 h-1.5 rounded-full", bridgeStatus?.running ? "bg-emerald-500" : "bg-muted-foreground/20")} />
                <span className="text-[13px] font-medium">Direct Local Bridge</span>
                <span className="text-[11px] text-muted-foreground">
                  {bridgeStatus?.running ? "运行中" : bridgeStatus?.status || "未启动"}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                这套是本机或局域网调试入口，主要给开发排查和直连自测用，不是默认的移动端接入方式。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void runBridgeAction(bridgeStatus?.running ? "restart" : "start")}
                disabled={bridgeBusy !== null}
                className="text-[12px] px-3 py-1 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-60"
              >
                {bridgeBusy === "start" || bridgeBusy === "restart"
                  ? "处理中..."
                  : bridgeStatus?.running
                    ? "重启"
                    : "启动"}
              </button>
              <button
                onClick={() => void runBridgeAction("stop")}
                disabled={!bridgeStatus?.running || bridgeBusy !== null}
                className="text-[12px] px-3 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                停止
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">地址</div>
              <div className="mt-1 text-[12px] break-all text-foreground/90">
                {primaryBridgeUrl || "启动后生成"}
              </div>
              {primaryBridgeUrl && (
                <button
                  onClick={() => void copyText("地址", primaryBridgeUrl)}
                  className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  复制地址
                </button>
              )}
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Token</div>
              <div className="mt-1 text-[12px] break-all text-foreground/90">{maskedToken}</div>
              {bridgeStatus?.token && (
                <button
                  onClick={() => void copyText("Token", bridgeStatus.token!)}
                  className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  复制 Token
                </button>
              )}
            </div>
          </div>

          {publicChatUrl && (
            <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">手机扫码聊天</div>
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="shrink-0 rounded-2xl border border-border/70 bg-white p-3 shadow-sm">
                  {chatQrCode ? (
                    <img
                      src={chatQrCode}
                      alt="网页聊天二维码"
                      className="h-[156px] w-[156px] rounded-lg"
                    />
                  ) : (
                    <div className="flex h-[156px] w-[156px] items-center justify-center text-[12px] text-muted-foreground">
                      生成二维码中...
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-[13px] text-foreground/90">
                    用手机相机或微信扫一扫，打开后会自动带上连接信息，直接进入聊天页。
                  </div>
                  <div className="text-[12px] break-all text-muted-foreground">{publicChatUrl}</div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => void copyText("聊天链接", publicChatUrl)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      复制聊天链接
                    </button>
                    <a
                      href={publicChatUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      打开网页聊天
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(bridgeStatus?.localUrls?.length ?? 0) > 1 && (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">局域网地址</div>
              <div className="space-y-1">
                {bridgeStatus?.localUrls.map((url) => (
                  <div key={url} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/50 px-3 py-2">
                    <span className="text-[12px] font-mono text-foreground/90">{url}</span>
                    <button
                      onClick={() => void copyText("地址", url)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      复制
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(bridgeStatus?.lastRequestAt || bridgeStatus?.activeThreadId || bridgeStatus?.lastError) && (
            <div className="rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-[12px] text-muted-foreground space-y-1">
              {bridgeStatus?.lastRequestAt && <div>最近请求：{new Date(bridgeStatus.lastRequestAt).toLocaleString("zh-CN")}</div>}
              {bridgeStatus?.activeThreadId && <div>最近线程：<span className="font-mono text-foreground/80">{bridgeStatus.activeThreadId}</span></div>}
              {bridgeStatus?.lastError && <div className="text-red-500/90">最近错误：{bridgeStatus.lastError}</div>}
            </div>
          )}

          {curlListCommand && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">快速自测</div>
              <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-3 space-y-2">
                <div>
                  <div className="text-[11px] text-muted-foreground">列出线程</div>
                  <code className="block mt-1 text-[11px] leading-relaxed break-all text-foreground/90">{curlListCommand}</code>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">远程发一条消息</div>
                  <code className="block mt-1 text-[11px] leading-relaxed break-all text-foreground/90">{curlTurnCommand}</code>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void copyText("测试命令", curlListCommand)}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    复制列线程命令
                  </button>
                  <button
                    onClick={() => void copyText("测试命令", curlTurnCommand)}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    复制发消息命令
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">最近日志</div>
              <button
                onClick={() => void loadBridgeState()}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                刷新
              </button>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-3">
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-foreground/85">
                {bridgeLog?.lines?.length ? bridgeLog.lines.join("\n") : "暂无日志"}
              </pre>
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={`主机 (${hosts.length})`}>
        {hosts.length === 0 && !adding && (
          <div className="min-h-[44px] px-1 flex items-center text-[13px] text-muted-foreground">没有远程主机</div>
        )}
        {hosts.map(host => {
          const isOpen = expanded === host.id;
          return (
            <div key={host.id} className="py-2 px-1 group">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(isOpen ? null : host.id)}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn("w-1.5 h-1.5 rounded-full", host.status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/20")} />
                    <span className="text-[13px] font-medium">{host.name}</span>
                    <span className="text-[10px] text-muted-foreground">{connLabel(host.connType)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono ml-4">
                    {host.connType === "ssh" && `${host.user}@${host.host}:${host.port}`}
                    {host.connType === "docker-local" && `container: ${host.containerId}`}
                    {host.connType === "docker-ssh" && `${host.user}@${host.host} → ${host.containerId}`}
                    {host.connType === "gateway-ws" && host.wsUrl}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={(e) => { e.stopPropagation(); scanHost(host.id); }} disabled={scanning === host.id}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                    {scanning === host.id ? <Loader2 className="animate-spin" size={12} /> : "扫描"}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); removeHost(host.id); }}
                    className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all">删除</button>
                </div>
              </div>
              {host.agents.length > 0 && (
                <div className="mt-1.5 ml-4 space-y-0.5">
                  {host.agents.map(agent => (
                    <div key={agent.id} className="flex items-center gap-2 text-[12px]">
                      <span className={cn("w-1.5 h-1.5 rounded-full", agent.running ? "bg-emerald-500" : "bg-muted-foreground/20")} />
                      <span className="text-muted-foreground">{agent.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Add new host */}
        {adding ? (
          <div className="py-3 px-1 space-y-2">
            <SelectRow label="连接方式" value={newConn} options={CONN_OPTIONS}
              onSave={(v) => setNewConn(v as ConnType)} />
            <EditableRow label="名称" value={form.name}
              onSave={(v) => setForm(p => ({ ...p, name: v }))} placeholder="我的服务器" />

            {(newConn === "ssh" || newConn === "docker-ssh") && (
              <>
                <EditableRow label="主机" value={form.host} mono
                  onSave={(v) => setForm(p => ({ ...p, host: v }))} placeholder="192.168.1.100" />
                <EditableRow label="用户" value={form.user} mono
                  onSave={(v) => setForm(p => ({ ...p, user: v }))} />
                <EditableRow label="端口" value={String(form.port)}
                  onSave={(v) => setForm(p => ({ ...p, port: parseInt(v) || 22 }))} />
                <EditableRow label="密钥" value={form.keyPath} mono
                  onSave={(v) => setForm(p => ({ ...p, keyPath: v }))} />
              </>
            )}

            {(newConn === "docker-local" || newConn === "docker-ssh") && (
              <EditableRow label="容器 ID/名称" value={form.containerId} mono
                onSave={(v) => setForm(p => ({ ...p, containerId: v }))} placeholder="openclaw-container 或 abc123" />
            )}

            {newConn === "gateway-ws" && (
              <>
                <EditableRow label="WebSocket URL" value={form.wsUrl} mono
                  onSave={(v) => setForm(p => ({ ...p, wsUrl: v }))} placeholder="ws://192.168.1.100:18789" />
                <EditableRow label="Token" value={form.wsToken} mono
                  onSave={(v) => setForm(p => ({ ...p, wsToken: v }))} placeholder="Gateway auth token" />
              </>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={addHost}
                className="text-[12px] px-3 py-1 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors">
                添加并扫描
              </button>
              <button onClick={() => setAdding(false)}
                className="text-[12px] text-muted-foreground hover:text-foreground">取消</button>
            </div>
          </div>
        ) : (
          <div className="min-h-[44px] px-1 flex items-center">
            <button onClick={() => setAdding(true)}
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">+ 添加远程主机</button>
          </div>
        )}
      </SettingsGroup>

      <div className="text-[11px] text-muted-foreground px-1 space-y-1">
        <p><strong>SSH 直连</strong> — 通过 SSH 直接读取远程服务器上的 Agent 配置</p>
        <p><strong>本地 Docker</strong> — 通过 docker exec 读取本机容器中的 Agent</p>
        <p><strong>远程 Docker</strong> — SSH 到服务器后再 docker exec 进容器</p>
        <p><strong>Gateway WebSocket</strong> — 直连 OpenClaw Gateway，不需要 SSH 权限</p>
      </div>
    </div>
  );
}
