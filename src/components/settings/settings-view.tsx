import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useState, useEffect } from "react"

const PROVIDERS = [
  { value: "openai" as const, label: "OpenAI", models: ["gpt-4o", "gpt-4.1", "gpt-4o-mini"] },
  { value: "anthropic" as const, label: "Anthropic", models: ["claude-sonnet-4-5-20250514", "claude-opus-4-5-20250514", "claude-haiku-4-5-20251001"] },
  { value: "google" as const, label: "Google", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { value: "ollama" as const, label: "Ollama (Local)", models: [] },
  { value: "custom" as const, label: "Custom", models: [] },
]

export function SettingsView() {
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig)

  const [provider, setProvider] = useState(llmConfig.provider)
  const [apiKey, setApiKey] = useState(llmConfig.apiKey)
  const [model, setModel] = useState(llmConfig.model)
  const [ollamaUrl, setOllamaUrl] = useState(llmConfig.ollamaUrl)
  const [customEndpoint, setCustomEndpoint] = useState(llmConfig.customEndpoint)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setProvider(llmConfig.provider)
    setApiKey(llmConfig.apiKey)
    setModel(llmConfig.model)
    setOllamaUrl(llmConfig.ollamaUrl)
    setCustomEndpoint(llmConfig.customEndpoint)
  }, [llmConfig])

  const currentProvider = PROVIDERS.find((p) => p.value === provider)

  async function handleSave() {
    const { saveLlmConfig } = await import("@/lib/project-store")
    const newConfig = { provider, apiKey, model, ollamaUrl, customEndpoint }
    setLlmConfig(newConfig)
    await saveLlmConfig(newConfig)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mx-auto max-w-xl">
        <h2 className="mb-6 text-2xl font-bold">Settings</h2>

        <div className="space-y-6">
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">LLM Provider</h3>

            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="flex flex-wrap gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => {
                      setProvider(p.value)
                      setModel(p.models[0] || "")
                    }}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      provider === p.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {provider === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="customEndpoint">API Endpoint (OpenAI-compatible)</Label>
                <Input
                  id="customEndpoint"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                  placeholder="https://your-api.example.com/v1"
                />
                <p className="text-xs text-muted-foreground">
                  Any OpenAI-compatible API endpoint (e.g., LiteLLM, vLLM, LocalAI, Azure OpenAI)
                </p>
              </div>
            )}

            {provider === "ollama" && (
              <div className="space-y-2">
                <Label htmlFor="ollamaUrl">Ollama URL</Label>
                <Input
                  id="ollamaUrl"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </div>
            )}

            {provider !== "ollama" && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === "custom"
                      ? "Enter API key (if required)"
                      : `Enter your ${currentProvider?.label} API key`
                  }
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              {currentProvider && currentProvider.models.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {currentProvider.models.map((m) => (
                      <button
                        key={m}
                        onClick={() => setModel(m)}
                        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          model === m
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Or type a custom model name"
                  />
                </div>
              ) : (
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={
                    provider === "ollama"
                      ? "Enter model name (e.g., llama3)"
                      : "Enter model name"
                  }
                />
              )}
            </div>
          </div>

          <Button onClick={handleSave} className="w-full">
            {saved ? "Saved!" : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  )
}
