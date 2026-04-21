/**
 * Curated LLM provider presets.
 *
 * Selecting a preset pre-fills the underlying LlmConfig fields so users
 * don't have to remember endpoint URLs / API mode per vendor. The
 * dispatch code in `src/lib/llm-providers.ts` still branches on the
 * lower-level `provider` field — presets just populate the config.
 */
export type CustomApiMode = "chat_completions" | "anthropic_messages"

export type Provider =
  | "openai"
  | "anthropic"
  | "google"
  | "ollama"
  | "custom"
  | "minimax"

export interface LlmPreset {
  /** Stable id used as the dropdown value. */
  id: string
  /** Display label in the dropdown. */
  label: string
  /** Short subtitle shown under the label. */
  hint?: string
  /** Underlying provider dispatch key (see llm-providers.ts). */
  provider: Provider
  /** Suggested base URL. `customEndpoint` for custom, `ollamaUrl` for ollama, ignored for built-ins. */
  baseUrl?: string
  /** Suggested default model; user can override. */
  defaultModel?: string
  /**
   * Curated list of model ids the UI shows as clickable chips above the
   * Model input. The user can still type a custom value — the input stays
   * free-form. An empty/missing list means "no suggestions, type freely"
   * (e.g. Ollama Local where the model set is whatever the user pulled).
   */
  suggestedModels?: string[]
  /** Custom providers only: which wire protocol to speak. */
  apiMode?: CustomApiMode
  /** Suggested context window; user can override. */
  suggestedContextSize?: number
}

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    hint: "Official Claude API",
    provider: "anthropic",
    defaultModel: "claude-sonnet-4-5-20250929",
    // Cross-referenced with hermes-agent/hermes_cli/models.py:233-242.
    // Both shortened and dated aliases work on api.anthropic.com.
    suggestedModels: [
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
    ],
    suggestedContextSize: 200000,
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    hint: "Official OpenAI API",
    provider: "openai",
    defaultModel: "gpt-4o",
    // Current public GPT models on api.openai.com. Reasoning models and
    // the 4.1 family are both exposed under the chat/completions route.
    suggestedModels: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "o3",
      "o3-mini",
      "o1",
      "o1-mini",
      "gpt-4-turbo",
    ],
    suggestedContextSize: 128000,
  },
  {
    id: "google",
    label: "Google (Gemini)",
    hint: "Generative Language API",
    provider: "google",
    defaultModel: "gemini-2.5-flash",
    // 2.5 generation is the current stable; 2.0 kept as fallback.
    suggestedModels: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ],
    suggestedContextSize: 1000000,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hint: "api.deepseek.com",
    provider: "custom",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    apiMode: "chat_completions",
    // hermes models.py:243-246
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    suggestedContextSize: 64000,
  },
  {
    id: "groq",
    label: "Groq",
    hint: "api.groq.com",
    provider: "custom",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    apiMode: "chat_completions",
    // Groq hosts open-weight models; list stays current-practical picks.
    suggestedModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "llama-3.1-70b-versatile",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
      "moonshotai/kimi-k2-instruct",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3-32b",
    ],
    suggestedContextSize: 128000,
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    hint: "api.x.ai",
    provider: "custom",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3",
    apiMode: "chat_completions",
    suggestedModels: [
      "grok-4-latest",
      "grok-4",
      "grok-3",
      "grok-3-mini",
      "grok-3-fast",
      "grok-3-mini-fast",
      "grok-code-fast-1",
      "grok-2-vision-1212",
    ],
    suggestedContextSize: 131072,
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    hint: "api.moonshot.ai",
    provider: "custom",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2.6",
    apiMode: "chat_completions",
    // k2.6 and k2.5 are the current flagship models — prefer these.
    // Everything below them is being deprecated on 2026-05-25 by
    // Moonshot; kept for now so users mid-migration still have access,
    // but they are NOT the recommended choice.
    suggestedModels: [
      "kimi-k2.6",
      "kimi-k2.5",
      // ── Deprecated after 2026-05-25 ──
      "kimi-k2-0905-preview",
      "kimi-k2-turbo-preview",
      "kimi-k2-thinking",
      "kimi-k2-thinking-turbo",
      "moonshot-v1-128k",
      "moonshot-v1-32k",
      "moonshot-v1-8k",
    ],
    suggestedContextSize: 128000,
  },
  {
    id: "kimi-cn",
    label: "Kimi (Moonshot, 中国)",
    hint: "api.moonshot.cn",
    provider: "custom",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.6",
    apiMode: "chat_completions",
    // Same deprecation window as the international preset — see above.
    suggestedModels: [
      "kimi-k2.6",
      "kimi-k2.5",
      // ── Deprecated after 2026-05-25 ──
      "kimi-k2-0905-preview",
      "kimi-k2-turbo-preview",
      "kimi-k2-thinking",
      "moonshot-v1-128k",
      "moonshot-v1-32k",
      "moonshot-v1-8k",
    ],
    suggestedContextSize: 128000,
  },
  {
    id: "zhipu",
    label: "智谱 GLM (Zhipu)",
    hint: "open.bigmodel.cn",
    provider: "custom",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    apiMode: "chat_completions",
    // Zhipu BigModel stable models (current-gen 4.x + 4.6/4.7 preview).
    suggestedModels: [
      "glm-4-plus",
      "glm-4-air",
      "glm-4-airx",
      "glm-4-flash",
      "glm-4-long",
      "glm-4.5",
      "glm-4.5-flash",
      "glm-4.6",
      "glm-4.7",
    ],
    suggestedContextSize: 128000,
  },
  {
    id: "minimax-global",
    label: "MiniMax (Global)",
    hint: "api.minimax.io/anthropic",
    provider: "custom",
    baseUrl: "https://api.minimax.io/anthropic",
    defaultModel: "MiniMax-M2.7",
    apiMode: "anthropic_messages",
    // hermes models.py:221-226
    suggestedModels: ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1", "MiniMax-M2"],
    suggestedContextSize: 200000,
  },
  {
    id: "minimax-cn",
    label: "MiniMax (中国)",
    hint: "api.minimaxi.com/anthropic",
    provider: "custom",
    baseUrl: "https://api.minimaxi.com/anthropic",
    defaultModel: "MiniMax-M2.7",
    apiMode: "anthropic_messages",
    suggestedModels: ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1", "MiniMax-M2"],
    suggestedContextSize: 200000,
  },
  {
    id: "bailian-coding-openai",
    label: "阿里百炼 Coding Plan (OpenAI-compat)",
    hint: "coding.dashscope.aliyuncs.com/v1",
    provider: "custom",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    apiMode: "chat_completions",
    // Alibaba Bailian's subscription-only "Coding Plan" endpoint. Key
    // must come from the Bailian console's Coding Plan tab — using a
    // regular DashScope key here will 401. Order matches the docs'
    // "recommended" section, then "additional".
    defaultModel: "qwen3.6-plus",
    suggestedModels: [
      "qwen3.6-plus",
      "kimi-k2.5",
      "glm-5",
      "MiniMax-M2.5",
      "qwen3.5-plus",
      "qwen3-max-2026-01-23",
      "qwen3-coder-plus",
      "qwen3-coder-next",
      "glm-4.7",
    ],
    suggestedContextSize: 131072,
  },
  {
    id: "bailian-coding-anthropic",
    label: "阿里百炼 Coding Plan (Anthropic-compat)",
    hint: "coding.dashscope.aliyuncs.com/apps/anthropic",
    provider: "custom",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    apiMode: "anthropic_messages",
    // Same model catalog as the OpenAI-compat variant, but the wire is
    // Anthropic Messages. Auth uses Bearer (see requiresBearerAuth in
    // llm-providers.ts) — matches MiniMax / Bailian gateway convention.
    defaultModel: "qwen3.6-plus",
    suggestedModels: [
      "qwen3.6-plus",
      "kimi-k2.5",
      "glm-5",
      "MiniMax-M2.5",
      "qwen3.5-plus",
      "qwen3-max-2026-01-23",
      "qwen3-coder-plus",
      "qwen3-coder-next",
      "glm-4.7",
    ],
    suggestedContextSize: 131072,
  },
  {
    id: "xiaomi-mimo",
    label: "小米 MiMo (Xiaomi)",
    hint: "api.xiaomimimo.com",
    provider: "custom",
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiMode: "chat_completions",
    // Standard OpenAI-wire endpoint at api.xiaomimimo.com/v1.
    // Preflight explicitly whitelists `authorization` + `content-type`,
    // so browser fetch would work too — but all LLM calls still go
    // through the Tauri HTTP plugin for uniformity. Model list from
    // hermes-agent (hermes_cli/models.py:247-251).
    defaultModel: "mimo-v2-pro",
    suggestedModels: ["mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"],
    suggestedContextSize: 131072,
  },
  {
    id: "volcengine-ark",
    label: "火山引擎 Ark (Volcengine)",
    hint: "ark.cn-beijing.volces.com/api/coding/v3",
    provider: "custom",
    // Volcengine Ark's "coding" product line mandates this exact base URL
    // per their official docs. Their other OpenAI-compat base (api/v3) is
    // not a valid substitute. This endpoint rejects browser-origin fetch
    // via CORS (allow-headers omits `authorization`), so LLM calls route
    // through Tauri's HTTP plugin — see src/lib/llm-client.ts.
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    apiMode: "chat_completions",
    // Exact model catalog Volcengine's Coding product line accepts on
    // this endpoint. The older `doubao-*-1-5-*` / `doubao-seed-1-6-*` /
    // `deepseek-v3-250324` ids that work on the general Ark endpoints
    // are NOT available here and will 400.
    defaultModel: "Doubao-Seed-2.0-Code",
    suggestedModels: [
      "Doubao-Seed-2.0-Code",
      "Doubao-Seed-2.0-pro",
      "Doubao-Seed-2.0-lite",
      "Doubao-Seed-Code",
      "MiniMax-M2.5",
      "Kimi-K2.5",
      "GLM-4.7",
      "DeepSeek-V3",
    ],
    suggestedContextSize: 128000,
  },
  {
    id: "ollama-local",
    label: "Ollama (Local)",
    hint: "Self-hosted llama.cpp / Ollama",
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    // Intentionally no suggestedModels: local set depends on what the
    // user has actually pulled / loaded. Kept as free-text input.
    suggestedContextSize: 32768,
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    hint: "ollama.com",
    provider: "custom",
    baseUrl: "https://ollama.com/v1",
    apiMode: "chat_completions",
    // Ollama Cloud catalog rotates frequently — keep short common picks.
    suggestedModels: [
      "gpt-oss:120b",
      "gpt-oss:20b",
      "qwen3-coder:480b",
      "kimi-k2:1t",
      "deepseek-v3.1:671b",
    ],
    suggestedContextSize: 128000,
  },
  {
    id: "custom-openai",
    label: "Custom (OpenAI-compat)",
    hint: "Any /v1/chat/completions endpoint",
    provider: "custom",
    apiMode: "chat_completions",
    // No suggestedModels: user knows what their gateway exposes.
  },
  {
    id: "custom-anthropic",
    label: "Custom (Anthropic-compat)",
    hint: "Any /v1/messages endpoint",
    provider: "custom",
    apiMode: "anthropic_messages",
  },
]

/**
 * Best-effort reverse lookup: given the current LlmConfig fields, which
 * preset does it most likely correspond to? Used so the dropdown can
 * show the user what they're effectively on.
 */
export function matchPreset(params: {
  provider: Provider
  customEndpoint: string
  ollamaUrl: string
  apiMode?: CustomApiMode
}): LlmPreset | null {
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase()
  const { provider, customEndpoint, ollamaUrl, apiMode } = params

  for (const preset of LLM_PRESETS) {
    if (preset.provider !== provider) continue
    if (provider === "custom") {
      if (!preset.baseUrl) continue // skip the generic Custom catch-alls
      if (norm(preset.baseUrl) !== norm(customEndpoint)) continue
      if ((preset.apiMode ?? "chat_completions") !== (apiMode ?? "chat_completions"))
        continue
      return preset
    }
    if (provider === "ollama") {
      if (preset.baseUrl && norm(preset.baseUrl) !== norm(ollamaUrl)) continue
      return preset
    }
    return preset
  }
  return null
}
