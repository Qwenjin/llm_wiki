# LLM Wiki Phase 2: LLM Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the app to LLM providers and implement the interactive Ingest flow — the core operation that turns raw sources into structured wiki pages.

**Architecture:** LLM calls happen from the TypeScript frontend using streaming fetch. This is a desktop app (no server exposure), so API keys in the webview are safe. The LLM reads source content + schema.md + purpose.md + existing wiki pages, then writes multiple wiki files via existing Rust commands. Chat UI displays the conversation in real-time with streaming.

**Tech Stack:** Streaming fetch (no SDK dependencies), Zustand for chat state, existing Tauri IPC for file operations

---

## Phase Overview

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1: Foundation | Tauri scaffold, file system ops, layout shell, wiki browser, Milkdown editor | **Done** |
| **Phase 2: LLM Integration** | LLM client, Chat UI, interactive Ingest flow | **Current** |
| Phase 3: Search & Query | tantivy search, query pipeline, Save to Wiki | Planned |
| Phase 4: Lint & Graph | Lint engine, graph view, lint dashboard | Planned |
| Phase 5: Polish | i18n, settings persistence, templates system | Planned |
| Phase 6: Extension | Browser clipper, batch ingest, image processing | Planned |

---

## File Structure

```
src/
├── lib/
│   ├── llm-client.ts              # Unified LLM streaming client (OpenAI/Anthropic/Google/Ollama/Custom)
│   └── llm-providers.ts           # Provider-specific config (endpoints, headers, body format)
├── stores/
│   └── chat-store.ts              # Chat state: messages, streaming status, current mode (ingest/query)
├── components/
│   ├── chat/
│   │   ├── chat-panel.tsx          # Full chat panel (message list + input)
│   │   ├── chat-message.tsx        # Single message bubble (user/assistant/system)
│   │   └── chat-input.tsx          # Input box with send button + ingest trigger
│   └── sources/
│       └── sources-view.tsx        # (Modify) Add "Ingest" button per source
├── lib/
│   └── ingest.ts                   # Ingest orchestrator: reads source → builds LLM prompt → parses response → writes files
```

---

### Task 1: LLM Provider Config and Streaming Client

**Files:**
- Create: `src/lib/llm-providers.ts`
- Create: `src/lib/llm-client.ts`

- [ ] **Step 1: Create provider configuration**

Create `src/lib/llm-providers.ts`:

```ts
import type { LlmConfig } from "@/stores/wiki-store"

interface ProviderConfig {
  url: string
  headers: Record<string, string>
  buildBody: (messages: ChatMessage[], model: string) => unknown
  parseStream: (line: string) => string | null
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

function buildOpenAIBody(messages: ChatMessage[], model: string) {
  return { model, messages, stream: true }
}

function parseOpenAIStream(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    const parsed = JSON.parse(data)
    return parsed.choices?.[0]?.delta?.content ?? null
  } catch {
    return null
  }
}

function buildAnthropicBody(messages: ChatMessage[], model: string) {
  const system = messages.find((m) => m.role === "system")?.content ?? ""
  const nonSystem = messages.filter((m) => m.role !== "system")
  return {
    model,
    max_tokens: 8192,
    system,
    messages: nonSystem,
    stream: true,
  }
}

function parseAnthropicStream(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  try {
    const parsed = JSON.parse(data)
    if (parsed.type === "content_block_delta") {
      return parsed.delta?.text ?? null
    }
    return null
  } catch {
    return null
  }
}

function buildGoogleBody(messages: ChatMessage[], model: string) {
  const system = messages.find((m) => m.role === "system")?.content ?? ""
  const nonSystem = messages.filter((m) => m.role !== "system")
  return {
    contents: nonSystem.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
  }
}

function parseGoogleStream(line: string): string | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  try {
    const parsed = JSON.parse(data)
    return parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  } catch {
    return null
  }
}

export function getProviderConfig(config: LlmConfig): ProviderConfig {
  switch (config.provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        buildBody: buildOpenAIBody,
        parseStream: parseOpenAIStream,
      }
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "Content-Type": "application/json",
        },
        buildBody: buildAnthropicBody,
        parseStream: parseAnthropicStream,
      }
    case "google":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`,
        headers: { "Content-Type": "application/json" },
        buildBody: buildGoogleBody,
        parseStream: parseGoogleStream,
      }
    case "ollama":
      return {
        url: `${config.ollamaUrl}/v1/chat/completions`,
        headers: { "Content-Type": "application/json" },
        buildBody: buildOpenAIBody,
        parseStream: parseOpenAIStream,
      }
    case "custom":
      return {
        url: config.customEndpoint.endsWith("/chat/completions")
          ? config.customEndpoint
          : `${config.customEndpoint.replace(/\/$/, "")}/chat/completions`,
        headers: {
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        buildBody: buildOpenAIBody,
        parseStream: parseOpenAIStream,
      }
  }
}
```

- [ ] **Step 2: Create streaming LLM client**

Create `src/lib/llm-client.ts`:

```ts
import type { LlmConfig } from "@/stores/wiki-store"
import { getProviderConfig, type ChatMessage } from "./llm-providers"

export type { ChatMessage } from "./llm-providers"

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: (fullText: string) => void
  onError: (error: string) => void
}

export async function streamChat(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  if (!config.model) {
    callbacks.onError("No model selected. Please configure a model in Settings.")
    return
  }

  const provider = getProviderConfig(config)
  const body = provider.buildBody(messages, config.model)

  let response: Response
  try {
    response = await fetch(provider.url, {
      method: "POST",
      headers: provider.headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    callbacks.onError(`Network error: ${err}`)
    return
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    callbacks.onError(`API error (${response.status}): ${errorText}`)
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError("No response body")
    return
  }

  const decoder = new TextDecoder()
  let fullText = ""
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const token = provider.parseStream(trimmed)
        if (token) {
          fullText += token
          callbacks.onToken(token)
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return
    callbacks.onError(`Stream error: ${err}`)
    return
  }

  callbacks.onDone(fullText)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/llm-client.ts src/lib/llm-providers.ts
git commit -m "feat: add unified streaming LLM client for all providers"
```

---

### Task 2: Chat Store

**Files:**
- Create: `src/stores/chat-store.ts`

- [ ] **Step 1: Create chat store**

Create `src/stores/chat-store.ts`:

```ts
import { create } from "zustand"
import type { ChatMessage } from "@/lib/llm-client"

export interface DisplayMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}

interface ChatState {
  messages: DisplayMessage[]
  isStreaming: boolean
  streamingContent: string
  mode: "chat" | "ingest"
  ingestSource: string | null

  addMessage: (role: DisplayMessage["role"], content: string) => void
  setStreaming: (streaming: boolean) => void
  appendStreamToken: (token: string) => void
  finalizeStream: (content: string) => void
  setMode: (mode: ChatState["mode"]) => void
  setIngestSource: (path: string | null) => void
  clearMessages: () => void
}

let messageCounter = 0

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  streamingContent: "",
  mode: "chat",
  ingestSource: null,

  addMessage: (role, content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: `msg-${++messageCounter}`,
          role,
          content,
          timestamp: Date.now(),
        },
      ],
    })),

  setStreaming: (isStreaming) =>
    set({ isStreaming, streamingContent: isStreaming ? "" : "" }),

  appendStreamToken: (token) =>
    set((state) => ({
      streamingContent: state.streamingContent + token,
    })),

  finalizeStream: (content) =>
    set((state) => ({
      isStreaming: false,
      streamingContent: "",
      messages: [
        ...state.messages,
        {
          id: `msg-${++messageCounter}`,
          role: "assistant",
          content,
          timestamp: Date.now(),
        },
      ],
    })),

  setMode: (mode) => set({ mode }),
  setIngestSource: (ingestSource) => set({ ingestSource }),
  clearMessages: () => set({ messages: [], streamingContent: "" }),
}))

export function chatMessagesToLLM(messages: DisplayMessage[]): ChatMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/chat-store.ts
git commit -m "feat: add chat store for message state and streaming"
```

---

### Task 3: Chat UI Components

**Files:**
- Create: `src/components/chat/chat-message.tsx`
- Create: `src/components/chat/chat-input.tsx`
- Create: `src/components/chat/chat-panel.tsx`
- Modify: `src/components/layout/chat-bar.tsx`

- [ ] **Step 1: Create chat message component**

Create `src/components/chat/chat-message.tsx`:

```tsx
import { Bot, User } from "lucide-react"
import type { DisplayMessage } from "@/stores/chat-store"

export function ChatMessage({ message }: { message: DisplayMessage }) {
  const isUser = message.role === "user"

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  )
}

export function StreamingMessage({ content }: { content: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm">
        <p className="whitespace-pre-wrap">{content}<span className="animate-pulse">▊</span></p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create chat input component**

Create `src/components/chat/chat-input.tsx`:

```tsx
import { useState, useRef } from "react"
import { Send, Square } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ChatInputProps {
  onSend: (message: string) => void
  onStop: () => void
  isStreaming: boolean
  placeholder?: string
}

export function ChatInput({ onSend, onStop, isStreaming, placeholder }: ChatInputProps) {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSend() {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Type a message..."}
        rows={1}
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
      />
      {isStreaming ? (
        <Button size="icon" variant="destructive" onClick={onStop}>
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="icon" onClick={handleSend} disabled={!input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create chat panel**

Create `src/components/chat/chat-panel.tsx`:

```tsx
import { useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { chatMessagesToLLM } from "@/stores/chat-store"
import { ChatMessage as ChatMessageComponent, StreamingMessage } from "./chat-message"
import { ChatInput } from "./chat-input"

let abortController: AbortController | null = null

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const addMessage = useChatStore((s) => s.addMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent])

  async function handleSend(text: string) {
    addMessage("user", text)

    const allMessages: ChatMessage[] = [
      ...chatMessagesToLLM(useChatStore.getState().messages),
    ]

    setStreaming(true)
    abortController = new AbortController()

    await streamChat(llmConfig, allMessages, {
      onToken: appendStreamToken,
      onDone: finalizeStream,
      onError: (err) => {
        setStreaming(false)
        addMessage("assistant", `Error: ${err}`)
      },
    }, abortController.signal)
  }

  function handleStop() {
    abortController?.abort()
    const content = useChatStore.getState().streamingContent
    if (content) {
      finalizeStream(content)
    } else {
      setStreaming(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="flex flex-col gap-3 p-4">
          {messages.length === 0 && !isStreaming && (
            <p className="text-center text-sm text-muted-foreground">
              Ask a question or start an ingest to begin.
            </p>
          )}
          {messages.map((msg) => (
            <ChatMessageComponent key={msg.id} message={msg} />
          ))}
          {isStreaming && streamingContent && (
            <StreamingMessage content={streamingContent} />
          )}
        </div>
      </ScrollArea>
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        placeholder="Ask about your wiki..."
      />
    </div>
  )
}
```

- [ ] **Step 4: Replace chat-bar.tsx to use ChatPanel**

Replace `src/components/layout/chat-bar.tsx`:

```tsx
import { MessageSquare, ChevronUp, ChevronDown } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { ChatPanel } from "@/components/chat/chat-panel"

export function ChatBar() {
  const chatExpanded = useWikiStore((s) => s.chatExpanded)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)

  if (!chatExpanded) {
    return (
      <button
        onClick={() => setChatExpanded(true)}
        className="flex w-full items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground hover:bg-accent/50"
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          CHAT
        </span>
        <ChevronUp className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <button
        onClick={() => setChatExpanded(false)}
        className="flex w-full items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground hover:bg-accent/50"
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          CHAT
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>
      <div className="flex-1 overflow-hidden">
        <ChatPanel />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/nash_su/projects/llm_wiki && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ src/components/layout/chat-bar.tsx
git commit -m "feat: add chat UI with streaming message display"
```

---

### Task 4: Ingest Orchestrator

**Files:**
- Create: `src/lib/ingest.ts`

The ingest orchestrator reads the source file, builds a prompt that includes schema.md, purpose.md, and existing index.md, sends it to the LLM, parses the structured response, and writes multiple wiki files.

- [ ] **Step 1: Create ingest orchestrator**

Create `src/lib/ingest.ts`:

```ts
import { readFile, writeFile } from "@/commands/fs"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"

export async function startIngest(
  projectPath: string,
  sourcePath: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal
): Promise<void> {
  const store = useChatStore.getState()
  store.setMode("ingest")
  store.setIngestSource(sourcePath)
  store.clearMessages()

  // Read required context files
  const sourceContent = await readFile(sourcePath)
  const schema = await readFile(`${projectPath}/schema.md`).catch(() => "")
  const purpose = await readFile(`${projectPath}/purpose.md`).catch(() => "")
  const index = await readFile(`${projectPath}/wiki/index.md`).catch(() => "")
  const log = await readFile(`${projectPath}/wiki/log.md`).catch(() => "")

  const fileName = sourcePath.split("/").pop() ?? "unknown"

  const systemPrompt = buildIngestSystemPrompt(schema, purpose, index)
  const userPrompt = buildIngestUserPrompt(fileName, sourceContent)

  store.addMessage("system", `Starting ingest of: ${fileName}`)

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  // Phase 1: LLM reads and presents key takeaways
  store.setStreaming(true)

  await streamChat(llmConfig, messages, {
    onToken: store.appendStreamToken,
    onDone: (fullText) => {
      store.finalizeStream(fullText)
    },
    onError: (err) => {
      store.setStreaming(false)
      store.addMessage("assistant", `Error during ingest: ${err}`)
    },
  }, signal)
}

export async function executeIngestWrites(
  projectPath: string,
  llmConfig: LlmConfig,
  userGuidance: string,
  signal?: AbortSignal
): Promise<string[]> {
  const store = useChatStore.getState()

  store.addMessage("user", userGuidance)

  const schema = await readFile(`${projectPath}/schema.md`).catch(() => "")
  const index = await readFile(`${projectPath}/wiki/index.md`).catch(() => "")

  const writePrompt = buildWritePrompt(schema, index)

  const allMessages: ChatMessage[] = [
    ...store.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: writePrompt + "\n\n" + userGuidance },
  ]

  // Add system message
  allMessages.unshift({
    role: "system",
    content: `You are a wiki maintainer. Based on the discussion above, now write the wiki pages. Output each file in this exact format:

---FILE: wiki/sources/filename.md---
(file content here)
---END FILE---

---FILE: wiki/entities/name.md---
(file content here)
---END FILE---

Continue for all files that need to be created or updated. Include:
1. A source summary page in wiki/sources/
2. Entity pages in wiki/entities/ for key entities mentioned
3. Concept pages in wiki/concepts/ for key concepts
4. Updated wiki/index.md with new entries
5. Appended entry to wiki/log.md

Use YAML frontmatter on each page. Use [[wikilink]] syntax for cross-references.`,
  })

  store.setStreaming(true)
  let fullResponse = ""

  await streamChat(llmConfig, allMessages, {
    onToken: (token) => {
      fullResponse += token
      store.appendStreamToken(token)
    },
    onDone: (text) => {
      fullResponse = text
      store.finalizeStream(text)
    },
    onError: (err) => {
      store.setStreaming(false)
      store.addMessage("assistant", `Error writing wiki: ${err}`)
    },
  }, signal)

  // Parse and write files
  const files = parseFileBlocks(fullResponse)
  const writtenFiles: string[] = []

  for (const file of files) {
    const fullPath = `${projectPath}/${file.path}`
    try {
      if (file.path === "wiki/log.md") {
        // Append to log instead of overwriting
        const existingLog = await readFile(fullPath).catch(() => "")
        await writeFile(fullPath, existingLog + "\n" + file.content)
      } else if (file.path === "wiki/index.md") {
        // For index, overwrite with the new version
        await writeFile(fullPath, file.content)
      } else {
        await writeFile(fullPath, file.content)
      }
      writtenFiles.push(file.path)
    } catch (err) {
      console.error(`Failed to write ${file.path}:`, err)
    }
  }

  if (writtenFiles.length > 0) {
    store.addMessage("system", `✓ Updated ${writtenFiles.length} files:\n${writtenFiles.map((f) => `  - ${f}`).join("\n")}`)
  }

  return writtenFiles
}

interface FileBlock {
  path: string
  content: string
}

function parseFileBlocks(text: string): FileBlock[] {
  const blocks: FileBlock[] = []
  const regex = /---FILE:\s*(.+?)\s*---\n([\s\S]*?)---END FILE---/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      path: match[1].trim(),
      content: match[2].trim() + "\n",
    })
  }

  return blocks
}

function buildIngestSystemPrompt(schema: string, purpose: string, index: string): string {
  return `You are an expert knowledge base assistant. You help the user build and maintain a personal wiki.

Your job right now: Read a new source document and present its key takeaways to the user. Be concise but thorough. Identify:
1. Key entities (people, organizations, products, datasets)
2. Key concepts (theories, methods, techniques, phenomena)
3. Main arguments or findings
4. How this relates to existing wiki content (if any)
5. Any contradictions with existing knowledge

After presenting takeaways, wait for the user to guide you on what to emphasize, what to ignore, and what connections to make.

${purpose ? `## Wiki Purpose\n${purpose}\n` : ""}
${schema ? `## Wiki Schema\n${schema}\n` : ""}
${index ? `## Current Wiki Index\n${index}\n` : ""}`
}

function buildIngestUserPrompt(fileName: string, content: string): string {
  const truncated = content.length > 50000 ? content.slice(0, 50000) + "\n\n[...truncated...]" : content
  return `Please read this source document and present the key takeaways:\n\n**Source:** ${fileName}\n\n---\n\n${truncated}`
}

function buildWritePrompt(schema: string, index: string): string {
  return `Now please write the wiki pages based on our discussion. Follow the schema conventions for page types, naming, and frontmatter.

Current index for reference (to avoid duplicates and maintain consistency):
${index}

Remember to use [[wikilink]] syntax for cross-references between pages.`
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "feat: add ingest orchestrator with LLM-driven wiki page generation"
```

---

### Task 5: Wire Ingest into Sources View and Chat

**Files:**
- Modify: `src/components/sources/sources-view.tsx`
- Modify: `src/components/chat/chat-panel.tsx`
- Modify: `src/stores/wiki-store.ts` (export LlmConfig type)

- [ ] **Step 1: Export LlmConfig type from wiki-store**

Add to the end of `src/stores/wiki-store.ts`:

```ts
export type { LlmConfig }
```

- [ ] **Step 2: Add Ingest button to sources view**

In `src/components/sources/sources-view.tsx`, add an ingest button per source. Import the necessary modules and modify the source list item to include an "Ingest" button:

Add imports:
```tsx
import { Plus, FileText, RefreshCw, BookOpen } from "lucide-react"
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { startIngest } from "@/lib/ingest"
```

Add ingest handler inside the `SourcesView` component:
```tsx
const llmConfig = useWikiStore((s) => s.llmConfig)
const setChatExpanded = useWikiStore((s) => s.setChatExpanded)

async function handleIngest(source: FileNode) {
  if (!project) return
  setChatExpanded(true)
  await startIngest(project.path, source.path, llmConfig)
}
```

Update the source list item to add an ingest button next to each file:
```tsx
<div className="flex w-full items-center gap-2">
  <button
    onClick={() => handleOpenSource(source)}
    className="flex min-w-0 flex-1 items-center gap-2 text-left"
  >
    <FileText className="h-4 w-4 shrink-0" />
    <span className="truncate">{source.name}</span>
  </button>
  <Button
    variant="ghost"
    size="sm"
    onClick={() => handleIngest(source)}
    title="Ingest this source into wiki"
    className="shrink-0 text-xs"
  >
    <BookOpen className="mr-1 h-3 w-3" />
    Ingest
  </Button>
</div>
```

- [ ] **Step 3: Add "Write to Wiki" button in chat panel**

In `src/components/chat/chat-panel.tsx`, add the ability to trigger the write phase after the user has discussed takeaways. Import:

```tsx
import { useChatStore } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { executeIngestWrites } from "@/lib/ingest"
import { listDirectory } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import { BookOpen } from "lucide-react"
```

Add a "Write to Wiki" button that appears when in ingest mode and not streaming:

```tsx
const mode = useChatStore((s) => s.mode)
const project = useWikiStore((s) => s.project)
const setFileTree = useWikiStore((s) => s.setFileTree)

async function handleWriteToWiki() {
  if (!project) return
  const written = await executeIngestWrites(
    project.path,
    llmConfig,
    "Please proceed with writing the wiki pages based on our discussion.",
  )
  if (written.length > 0) {
    const tree = await listDirectory(project.path)
    setFileTree(tree)
  }
}
```

Add the button between the message list and the input, visible only when in ingest mode and not streaming:

```tsx
{mode === "ingest" && !isStreaming && messages.length > 1 && (
  <div className="flex justify-center border-t px-4 py-2">
    <Button size="sm" onClick={handleWriteToWiki}>
      <BookOpen className="mr-2 h-4 w-4" />
      Write to Wiki
    </Button>
  </div>
)}
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/nash_su/projects/llm_wiki && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire ingest flow into sources view and chat panel"
```

---

### Task 6: Settings Persistence

**Files:**
- Modify: `src/components/settings/settings-view.tsx`
- Modify: `src/lib/project-store.ts`
- Modify: `src/App.tsx`

Settings currently live only in Zustand (lost on reload). Persist them using the Tauri store.

- [ ] **Step 1: Add settings persistence to project-store.ts**

Add to `src/lib/project-store.ts`:

```ts
import type { LlmConfig } from "@/stores/wiki-store"

const LLM_CONFIG_KEY = "llmConfig"

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  const store = await getStore()
  await store.set(LLM_CONFIG_KEY, config)
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  const store = await getStore()
  return (await store.get<LlmConfig>(LLM_CONFIG_KEY)) ?? null
}
```

- [ ] **Step 2: Update settings view to persist on save**

In `src/components/settings/settings-view.tsx`, import `saveLlmConfig` and call it in `handleSave`:

```tsx
import { saveLlmConfig } from "@/lib/project-store"

async function handleSave() {
  const newConfig = { provider, apiKey, model, ollamaUrl, customEndpoint }
  setLlmConfig(newConfig)
  await saveLlmConfig(newConfig)
  setSaved(true)
  setTimeout(() => setSaved(false), 2000)
}
```

- [ ] **Step 3: Load persisted settings on startup in App.tsx**

In `src/App.tsx`, import `loadLlmConfig` and load it in the startup `useEffect`:

```tsx
import { getLastProject, saveLastProject, loadLlmConfig } from "@/lib/project-store"

// Inside the useEffect:
const savedConfig = await loadLlmConfig()
if (savedConfig) {
  useWikiStore.getState().setLlmConfig(savedConfig)
}
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/nash_su/projects/llm_wiki && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: persist LLM settings across app restarts"
```

---

### Task 7: End-to-End Verification

- [ ] **Step 1: Full build check**

```bash
cd /Users/nash_su/projects/llm_wiki && npx vite build && cd src-tauri && cargo build
```

- [ ] **Step 2: Manual end-to-end test**

```bash
npm run tauri dev
```

Test the following flow:
1. Open a project (or create new)
2. Go to Settings → configure an LLM provider with API key and model
3. Go to Sources → Import a markdown/text file
4. Click "Ingest" next to the imported source
5. Chat panel expands → LLM reads source and presents key takeaways (streaming)
6. Type a message guiding what to emphasize
7. Click "Write to Wiki" → LLM generates wiki pages
8. File tree updates with new pages in wiki/entities/, wiki/concepts/, wiki/sources/
9. Click a generated page → view in Milkdown editor
10. Close and reopen app → settings preserved, last project auto-opens

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 2 — LLM integration with interactive ingest"
```

---

## Phase 2 Deliverables

After completing all tasks:

- ✅ Streaming LLM client supporting OpenAI, Anthropic, Google, Ollama, Custom
- ✅ Real-time chat UI with message bubbles and streaming display
- ✅ Interactive Ingest flow: source → discuss → guide → write wiki pages
- ✅ Multi-file wiki generation (source summary, entities, concepts, index, log)
- ✅ LLM settings persisted across app restarts
- ✅ File tree auto-refreshes after ingest

## What's Next

**Phase 3: Search & Query** will add:
- tantivy full-text search over wiki pages
- Query flow: ask question → search wiki → LLM synthesize → Save to Wiki
- Multi-format response rendering
