// ── Global Resource Pool Types ──

// Endpoint = a specific API URL with its protocol type
export interface ProviderEndpoint {
  baseUrl: string;
  apiType: "openai" | "anthropic";
  label?: string;  // optional short label like "OpenAI compat" / "Anthropic compat"
}

export interface ProviderAudioConfig {
  transcriptionModel?: string;
  realtimeAsrModel?: string;
}

export interface ProviderVisionConfig {
  reasoningModel?: string;
}

// Provider = a company/service that hosts models, with one API Key and one or more endpoints
export interface ModelProvider {
  id: string;
  name: string;
  apiKey: string;
  endpoints: ProviderEndpoint[];
  audio?: ProviderAudioConfig;
  vision?: ProviderVisionConfig;
  region?: "global" | "cn";  // only for distinguishing same-brand providers with different sites
}

export interface HubMediaVoiceConfig {
  asrProviderId?: string;
  asrModelId?: string;
}

export interface HubMediaVideoConfig {
  reasoningProviderId?: string;
  reasoningModelId?: string;
}

export interface HubMediaConfig {
  voice?: HubMediaVoiceConfig;
  video?: HubMediaVideoConfig;
}

// Model = a specific model that can be served by one or more providers
export interface Model {
  id: string;
  name: string;
  vendor: string;
  providerIds: string[];
  enabled: boolean;
  capabilities?: string[];
}

// backward compat
export interface ModelEntry {
  id: string;
  name?: string;
  enabled: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description: string;
  enabled: boolean;
}

export interface HubConfig {
  providers: ModelProvider[];
  models: Model[];
  mcpServers: McpServer[];
  skills: { directories: string[] };
  media?: HubMediaConfig;
}

// ── Provider Presets ──
// Research-verified API endpoints per provider (as of 2026-03)

export const PROVIDER_PRESETS: Omit<ModelProvider, "apiKey">[] = [
  {
    id: "anthropic", name: "Anthropic",
    endpoints: [
      { baseUrl: "https://api.anthropic.com", apiType: "anthropic", label: "Native" },
    ],
  },
  {
    id: "openai", name: "OpenAI",
    endpoints: [
      { baseUrl: "https://api.openai.com/v1", apiType: "openai", label: "Native" },
    ],
  },
  {
    id: "googleapis", name: "Google Gemini",
    endpoints: [
      { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiType: "openai", label: "OpenAI compat" },
    ],
  },
  {
    id: "xai", name: "xAI Grok",
    endpoints: [
      { baseUrl: "https://api.x.ai/v1", apiType: "openai", label: "OpenAI compat" },
      // xAI Anthropic SDK support is deprecated, using openai as primary
    ],
  },
  {
    id: "deepseek", name: "DeepSeek",
    endpoints: [
      { baseUrl: "https://api.deepseek.com", apiType: "openai", label: "OpenAI compat" },
      { baseUrl: "https://api.deepseek.com/anthropic", apiType: "anthropic", label: "Anthropic compat" },
    ],
  },
  {
    id: "openrouter", name: "OpenRouter",
    endpoints: [
      { baseUrl: "https://openrouter.ai/api/v1", apiType: "openai", label: "OpenAI compat" },
    ],
  },
  {
    id: "minimax-io", name: "MiniMax", region: "global",
    endpoints: [
      { baseUrl: "https://api.minimax.io/v1", apiType: "openai", label: "OpenAI compat" },
      { baseUrl: "https://api.minimax.io/anthropic", apiType: "anthropic", label: "Anthropic compat" },
    ],
  },
  {
    id: "minimaxi", name: "MiniMax", region: "cn",
    endpoints: [
      { baseUrl: "https://api.minimaxi.com/v1", apiType: "openai", label: "OpenAI compat" },
      { baseUrl: "https://api.minimaxi.com/anthropic", apiType: "anthropic", label: "Anthropic compat" },
    ],
  },
  {
    id: "moonshot-ai", name: "Moonshot", region: "global",
    endpoints: [
      { baseUrl: "https://api.moonshot.ai/v1", apiType: "openai", label: "OpenAI compat" },
      { baseUrl: "https://api.moonshot.ai/anthropic", apiType: "anthropic", label: "Anthropic compat" },
    ],
  },
  {
    id: "moonshot-cn", name: "Moonshot", region: "cn",
    endpoints: [
      { baseUrl: "https://api.moonshot.cn/v1", apiType: "openai", label: "OpenAI compat" },
      { baseUrl: "https://api.moonshot.cn/anthropic", apiType: "anthropic", label: "Anthropic compat" },
    ],
  },
  {
    id: "bigmodel", name: "智谱AI",
    endpoints: [
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiType: "openai", label: "OpenAI compat" },
      { baseUrl: "https://open.bigmodel.cn/api/anthropic", apiType: "anthropic", label: "Anthropic compat" },
    ],
  },
  {
    id: "volcengine", name: "豆包 Doubao",
    endpoints: [
      { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiType: "openai", label: "OpenAI compat" },
      { baseUrl: "https://ark.cn-beijing.volces.com/api/coding", apiType: "anthropic", label: "Anthropic compat" },
    ],
  },
  {
    id: "dashscope-intl", name: "通义千问 Qwen", region: "global",
    endpoints: [
      { baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", apiType: "openai", label: "OpenAI compat" },
    ],
  },
  {
    id: "dashscope", name: "通义千问 Qwen", region: "cn",
    endpoints: [
      { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiType: "openai", label: "OpenAI compat" },
    ],
  },
  {
    id: "ollama", name: "Ollama",
    endpoints: [
      { baseUrl: "http://localhost:11434/v1", apiType: "openai", label: "Local" },
    ],
  },
];

// ── Model Presets ──

export const MODEL_PRESETS: Omit<Model, "enabled">[] = [
  // Anthropic
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", vendor: "Anthropic", providerIds: ["anthropic", "openrouter"], capabilities: ["text", "vision", "reasoning", "coding"] },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", vendor: "Anthropic", providerIds: ["anthropic", "openrouter"], capabilities: ["text", "vision", "coding"] },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", vendor: "Anthropic", providerIds: ["anthropic", "openrouter"], capabilities: ["text", "vision"] },
  // OpenAI
  { id: "gpt-4o", name: "GPT-4o", vendor: "OpenAI", providerIds: ["openai", "openrouter"], capabilities: ["text", "vision"] },
  { id: "gpt-4.1", name: "GPT-4.1", vendor: "OpenAI", providerIds: ["openai", "openrouter"], capabilities: ["text", "vision", "coding"] },
  { id: "o3", name: "o3", vendor: "OpenAI", providerIds: ["openai", "openrouter"], capabilities: ["text", "reasoning"] },
  { id: "o4-mini", name: "o4-mini", vendor: "OpenAI", providerIds: ["openai", "openrouter"], capabilities: ["text", "reasoning"] },
  // Google
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", vendor: "Google", providerIds: ["googleapis", "openrouter"], capabilities: ["text", "vision", "reasoning", "coding"] },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", vendor: "Google", providerIds: ["googleapis", "openrouter"], capabilities: ["text", "vision"] },
  // xAI
  { id: "grok-3", name: "Grok 3", vendor: "xAI", providerIds: ["xai", "openrouter"], capabilities: ["text", "vision", "reasoning"] },
  { id: "grok-3-mini", name: "Grok 3 Mini", vendor: "xAI", providerIds: ["xai", "openrouter"], capabilities: ["text", "reasoning"] },
  // DeepSeek
  { id: "deepseek-chat", name: "DeepSeek V3", vendor: "DeepSeek", providerIds: ["deepseek", "openrouter"], capabilities: ["text", "coding"] },
  { id: "deepseek-reasoner", name: "DeepSeek R1", vendor: "DeepSeek", providerIds: ["deepseek", "openrouter"], capabilities: ["text", "reasoning"] },
  // MiniMax
  { id: "MiniMax-M2.5", name: "MiniMax M2.5", vendor: "MiniMax", providerIds: ["minimax-io", "minimaxi", "openrouter"], capabilities: ["text"] },
  { id: "MiniMax-M2.5-highspeed", name: "MiniMax M2.5 Highspeed", vendor: "MiniMax", providerIds: ["minimax-io", "minimaxi"], capabilities: ["text", "reasoning"] },
  // 智谱 GLM
  { id: "glm-5", name: "GLM-5", vendor: "智谱AI", providerIds: ["bigmodel", "openrouter"], capabilities: ["text", "vision", "reasoning", "coding"] },
  { id: "glm-4.7", name: "GLM-4.7", vendor: "智谱AI", providerIds: ["bigmodel"], capabilities: ["text", "vision", "coding"] },
  { id: "glm-4.7-flash", name: "GLM-4.7 Flash", vendor: "智谱AI", providerIds: ["bigmodel"], capabilities: ["text"] },
  // 豆包 Doubao
  { id: "doubao-seed-1.8", name: "豆包 Seed 1.8", vendor: "字节跳动", providerIds: ["volcengine"], capabilities: ["text", "reasoning"] },
  { id: "doubao-1.5-thinking-pro", name: "豆包 1.5 Thinking Pro", vendor: "字节跳动", providerIds: ["volcengine"], capabilities: ["text", "reasoning"] },
  // Kimi / Moonshot
  { id: "kimi-k2.5", name: "Kimi K2.5", vendor: "Moonshot", providerIds: ["moonshot-ai", "moonshot-cn", "openrouter"], capabilities: ["text", "coding", "reasoning"] },
  { id: "moonshot-v1-128k", name: "Moonshot V1 128K", vendor: "Moonshot", providerIds: ["moonshot-ai", "moonshot-cn"], capabilities: ["text"] },
  // Qwen
  { id: "qwen-max", name: "Qwen Max", vendor: "Alibaba", providerIds: ["dashscope-intl", "dashscope", "openrouter"], capabilities: ["text", "vision", "reasoning"] },
  { id: "qwen-plus", name: "Qwen Plus", vendor: "Alibaba", providerIds: ["dashscope-intl", "dashscope"], capabilities: ["text", "vision"] },
  { id: "qwen-coder-plus", name: "Qwen Coder Plus", vendor: "Alibaba", providerIds: ["dashscope-intl", "dashscope"], capabilities: ["text", "coding"] },
];

// ── Helpers ──

export function getProvidersForModel(modelId: string): typeof PROVIDER_PRESETS {
  const model = MODEL_PRESETS.find((m) => m.id === modelId);
  if (!model) return [];
  return PROVIDER_PRESETS.filter((p) => model.providerIds.includes(p.id));
}

export function getModelsForProvider(providerId: string): typeof MODEL_PRESETS {
  return MODEL_PRESETS.filter((m) => m.providerIds.includes(providerId));
}

// ── ClawHub Skills Types ──

export interface ClawHubSkill {
  name: string;
  description: string;
  author: string;
  installs: number;
  version: string;
  tags: string[];
  url: string;
}
