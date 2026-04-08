import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Bot, User, FileText, BookmarkPlus, ChevronDown, ChevronRight,
  Users, Lightbulb, BookOpen, HelpCircle, GitMerge, BarChart3, Layout, Globe,
} from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { lastQueryPages } from "@/components/chat/chat-panel"
import type { DisplayMessage } from "@/stores/chat-store"
import type { FileNode } from "@/types/wiki"

// Comprehensive LaTeX command → Unicode mapping
const LATEX_TO_UNICODE: Record<string, string> = {
  // Arrows
  rightarrow: "→", Rightarrow: "⇒", longrightarrow: "⟶",
  leftarrow: "←", Leftarrow: "⇐", longleftarrow: "⟵",
  leftrightarrow: "↔", Leftrightarrow: "⇔",
  uparrow: "↑", Uparrow: "⇑", downarrow: "↓", Downarrow: "⇓",
  mapsto: "↦", hookrightarrow: "↪", hookleftarrow: "↩",
  nearrow: "↗", nwarrow: "↖", searrow: "↘", swarrow: "↙",
  // Math operators
  times: "×", div: "÷", pm: "±", mp: "∓", cdot: "·", ast: "∗",
  star: "⋆", circ: "∘", bullet: "•", oplus: "⊕", otimes: "⊗",
  // Relations
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", sim: "∼", simeq: "≃", equiv: "≡", cong: "≅",
  propto: "∝", ll: "≪", gg: "≫", prec: "≺", succ: "≻",
  subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇",
  in: "∈", notin: "∉", ni: "∋", cap: "∩", cup: "∪",
  vee: "∨", wedge: "∧", neg: "¬", lnot: "¬",
  // Greek lowercase
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ",
  sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  // Greek uppercase
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // Misc symbols
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  emptyset: "∅", varnothing: "∅", wp: "℘", Re: "ℜ", Im: "ℑ",
  aleph: "ℵ", hbar: "ℏ", ell: "ℓ", sharp: "♯", flat: "♭",
  natural: "♮", clubsuit: "♣", diamondsuit: "♢", heartsuit: "♡", spadesuit: "♠",
  // Big operators
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", oint: "∮",
  bigcup: "⋃", bigcap: "⋂", bigoplus: "⨁", bigotimes: "⨂",
  // Dots
  ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
  // Formatting
  quad: "  ", qquad: "    ", text: "", mathrm: "", mathbf: "", mathit: "",
  textbf: "", textit: "", textrm: "",
  // Delimiters
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋",
  lceil: "⌈", rceil: "⌉", lvert: "|", rvert: "|",
  // Accents (just show the base)
  hat: "^", tilde: "~", bar: "‾", vec: "→", dot: "·", ddot: "¨",
  // Common functions (keep as text)
  log: "log", ln: "ln", exp: "exp", sin: "sin", cos: "cos", tan: "tan",
  min: "min", max: "max", sup: "sup", inf: "inf", lim: "lim",
  sqrt: "√", frac: "/",
}

// Module-level cache of source file names
let cachedSourceFiles: string[] = []

export function useSourceFiles() {
  const project = useWikiStore((s) => s.project)

  useEffect(() => {
    if (!project) return
    listDirectory(`${project.path}/raw/sources`)
      .then((tree) => {
        cachedSourceFiles = flattenNames(tree)
      })
      .catch(() => {
        cachedSourceFiles = []
      })
  }, [project])

  return cachedSourceFiles
}

function flattenNames(nodes: FileNode[]): string[] {
  const names: string[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      names.push(...flattenNames(node.children))
    } else if (!node.is_dir) {
      names.push(node.name)
    }
  }
  return names
}

interface ChatMessageProps {
  message: DisplayMessage
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user"
  const isSystem = message.role === "system"
  const isAssistant = message.role === "assistant"
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isSystem
            ? "bg-accent text-accent-foreground"
            : isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="max-w-[80%] flex flex-col gap-1.5">
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>
        {isAssistant && <CitedReferencesPanel content={message.content} />}
        {isAssistant && (
          <SaveToWikiButton content={message.content} visible={hovered} />
        )}
      </div>
    </div>
  )
}

function SaveToWikiButton({ content, visible }: { content: string; visible: boolean }) {
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async () => {
    if (!project || saving) return
    setSaving(true)
    try {
      // Generate slug from first line or first 50 chars
      const firstLine = content.split("\n")[0].replace(/^#+\s*/, "").trim()
      const title = firstLine.slice(0, 60) || "Saved Query"
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 50)
      const date = new Date().toISOString().slice(0, 10)
      const fileName = `${slug}-${date}.md`
      const filePath = `${project.path}/wiki/queries/${fileName}`

      // Strip hidden sources comment from content
      const cleanContent = content.replace(/<!--\s*sources:.*?-->/g, "").trimEnd()

      const frontmatter = [
        "---",
        `type: query`,
        `title: "${title.replace(/"/g, '\\"')}"`,
        `created: ${date}`,
        `tags: []`,
        "---",
        "",
      ].join("\n")

      await writeFile(filePath, frontmatter + cleanContent)

      // Update index.md — append under ## Queries section
      const indexPath = `${project.path}/wiki/index.md`
      let indexContent = ""
      try {
        indexContent = await readFile(indexPath)
      } catch {
        indexContent = "# Wiki Index\n\n## Queries\n"
      }
      const entry = `- [[queries/${slug}-${date}|${title}]]`
      if (indexContent.includes("## Queries")) {
        indexContent = indexContent.replace(
          /(## Queries\n)/,
          `$1${entry}\n`
        )
      } else {
        indexContent = indexContent.trimEnd() + "\n\n## Queries\n" + entry + "\n"
      }
      await writeFile(indexPath, indexContent)

      // Append to log.md
      const logPath = `${project.path}/wiki/log.md`
      let logContent = ""
      try {
        logContent = await readFile(logPath)
      } catch {
        logContent = "# Wiki Log\n\n"
      }
      const logEntry = `- ${date}: Saved query page \`${fileName}\`\n`
      await writeFile(logPath, logContent.trimEnd() + "\n" + logEntry)

      // Refresh file tree
      const tree = await listDirectory(project.path)
      setFileTree(tree)

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error("Failed to save to wiki:", err)
    } finally {
      setSaving(false)
    }
  }, [project, content, saving, setFileTree])

  if (!visible && !saved) return null

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving}
      className="self-start inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
      title="Save to wiki"
    >
      <BookmarkPlus className="h-3 w-3" />
      {saved ? "Saved!" : saving ? "Saving..." : "Save to Wiki"}
    </button>
  )
}

interface CitedPage {
  title: string
  path: string
}

const REF_TYPE_CONFIG: Record<string, { icon: typeof FileText; color: string }> = {
  entity: { icon: Users, color: "text-blue-500" },
  concept: { icon: Lightbulb, color: "text-purple-500" },
  source: { icon: BookOpen, color: "text-orange-500" },
  query: { icon: HelpCircle, color: "text-green-500" },
  synthesis: { icon: GitMerge, color: "text-red-500" },
  comparison: { icon: BarChart3, color: "text-teal-500" },
  overview: { icon: Layout, color: "text-yellow-500" },
  clip: { icon: Globe, color: "text-blue-400" },
}

function getRefType(path: string): string {
  if (path.includes("/entities/")) return "entity"
  if (path.includes("/concepts/")) return "concept"
  if (path.includes("/sources/")) return "source"
  if (path.includes("/queries/")) return "query"
  if (path.includes("/synthesis/")) return "synthesis"
  if (path.includes("/comparisons/")) return "comparison"
  if (path.includes("overview")) return "overview"
  if (path.includes("raw/sources/")) return "clip"
  return "source"
}

function CitedReferencesPanel({ content }: { content: string }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const [expanded, setExpanded] = useState(false)

  const citedPages = useMemo(() => extractCitedPages(content), [content])

  if (citedPages.length === 0) return null

  const MAX_COLLAPSED = 3
  const visiblePages = expanded ? citedPages : citedPages.slice(0, MAX_COLLAPSED)
  const hasMore = citedPages.length > MAX_COLLAPSED

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs mb-1">
      <button
        type="button"
        onClick={() => hasMore && setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span className="font-medium">References ({citedPages.length})</span>
        {hasMore && (
          expanded
            ? <ChevronDown className="h-3 w-3 ml-auto" />
            : <ChevronRight className="h-3 w-3 ml-auto" />
        )}
      </button>
      <div className="px-2 pb-1.5">
        {visiblePages.map((page, i) => {
          const refType = getRefType(page.path)
          const config = REF_TYPE_CONFIG[refType] ?? REF_TYPE_CONFIG.source
          const Icon = config.icon
          return (
            <button
              key={page.path}
              type="button"
              onClick={async () => {
                if (!project) return
                // Try the given path first, then search all wiki subdirectories
                const id = page.path.replace(/^wiki\//, "").replace(/\.md$/, "").split("/").pop() ?? ""
                const candidates = [
                  `${project.path}/${page.path}`,
                  `${project.path}/wiki/entities/${id}.md`,
                  `${project.path}/wiki/concepts/${id}.md`,
                  `${project.path}/wiki/sources/${id}.md`,
                  `${project.path}/wiki/queries/${id}.md`,
                  `${project.path}/wiki/synthesis/${id}.md`,
                  `${project.path}/wiki/comparisons/${id}.md`,
                  `${project.path}/wiki/${id}.md`,
                ]
                for (const candidate of candidates) {
                  try {
                    await readFile(candidate)
                    setSelectedFile(candidate)
                    return
                  } catch {
                    // try next
                  }
                }
                // Last resort: set the original path anyway
                setSelectedFile(`${project.path}/${page.path}`)
              }}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent/50 transition-colors"
              title={page.path}
            >
              <span className="text-[10px] text-muted-foreground/60 w-4 shrink-0 text-right">[{i + 1}]</span>
              <Icon className={`h-3 w-3 shrink-0 ${config.color}`} />
              <span className="truncate text-foreground/80">{page.title}</span>
            </button>
          )
        })}
        {hasMore && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full text-center text-[10px] text-muted-foreground hover:text-primary pt-0.5"
          >
            +{citedPages.length - MAX_COLLAPSED} more...
          </button>
        )}
      </div>
    </div>
  )
}


/**
 * Extract cited wiki pages from the hidden <!-- cited: 1, 3, 5 --> comment.
 * Maps page numbers back to the pages that were sent to the LLM.
 */
function extractCitedPages(text: string): CitedPage[] {
  const citedMatch = text.match(/<!--\s*cited:\s*(.+?)\s*-->/)
  if (citedMatch && lastQueryPages.length > 0) {
    const numbers = citedMatch[1]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= lastQueryPages.length)

    const pages = numbers.map((n) => lastQueryPages[n - 1])
    if (pages.length > 0) return pages
  }

  // Fallback: if LLM used [1], [2] notation in text, try to match those
  if (lastQueryPages.length > 0) {
    const numberRefs = text.match(/\[(\d+)\]/g)
    if (numberRefs) {
      const numbers = [...new Set(numberRefs.map((r) => parseInt(r.slice(1, -1), 10)))]
        .filter((n) => n >= 1 && n <= lastQueryPages.length)
      if (numbers.length > 0) {
        return numbers.map((n) => lastQueryPages[n - 1])
      }
    }
  }

  // Fallback for persisted messages: extract [[wikilinks]] from the text
  // Try to resolve each wikilink to a real file path by checking common wiki subdirectories
  const wikilinks = text.match(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)
  if (wikilinks) {
    const seen = new Set<string>()
    const pages: CitedPage[] = []
    const WIKI_DIRS = ["entities", "concepts", "sources", "queries", "synthesis", "comparisons"]

    for (const link of wikilinks) {
      const nameMatch = link.match(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/)
      if (nameMatch) {
        const id = nameMatch[1].trim()
        const display = nameMatch[2]?.trim() || id

        // Skip if id contains path separators (already a path like queries/xxx)
        if (seen.has(id)) continue
        seen.add(id)

        // Try to find the file in known wiki subdirectories
        let resolvedPath = ""
        if (id.includes("/")) {
          // Already has directory like "queries/my-query"
          resolvedPath = `wiki/${id}.md`
        } else {
          // Search in common directories
          for (const dir of WIKI_DIRS) {
            resolvedPath = `wiki/${dir}/${id}.md`
            // We can't do async file checking here, so try all known patterns
            // The click handler will try multiple paths
            break // Use first candidate, click handler resolves the rest
          }
          if (!resolvedPath) resolvedPath = `wiki/${id}.md`
        }

        pages.push({ title: display, path: resolvedPath })
      }
    }
    if (pages.length > 0) return pages
  }

  // No citations found
  return []
}

interface StreamingMessageProps {
  content: string
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  const { thinking, answer } = useMemo(() => separateThinking(content), [content])
  const isThinking = thinking !== null && answer.length === 0

  return (
    <div className="flex gap-2 flex-row">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-muted text-foreground">
        {isThinking ? (
          <StreamingThinkingBlock content={thinking} />
        ) : (
          <>
            {thinking && <ThinkingBlock content={thinking} />}
            <MarkdownContent content={answer} />
            <span className="animate-pulse">▊</span>
          </>
        )}
      </div>
    </div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  // Strip hidden comments
  const cleaned = content.replace(/<!--.*?-->/gs, "").trimEnd()

  // Separate thinking blocks from main content
  const { thinking, answer } = useMemo(() => separateThinking(cleaned), [cleaned])
  const processed = useMemo(() => processContent(answer), [answer])

  return (
    <div>
      {thinking && <ThinkingBlock content={thinking} />}
      <div className="chat-markdown prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("wikilink:")) {
                const pageName = href.slice("wikilink:".length)
                return <WikiLink pageName={pageName}>{children}</WikiLink>
              }
              return (
                <span className="text-primary underline cursor-default" title={href}>
                  {children}
                </span>
              )
            },
            table: ({ children, ...props }) => (
              <div className="my-2 overflow-x-auto rounded border border-border">
                <table className="w-full border-collapse text-xs" {...props}>{children}</table>
              </div>
            ),
            thead: ({ children, ...props }) => (
              <thead className="bg-muted" {...props}>{children}</thead>
            ),
            th: ({ children, ...props }) => (
              <th className="border border-border/80 px-3 py-1.5 text-left font-semibold bg-muted" {...props}>{children}</th>
            ),
            td: ({ children, ...props }) => (
              <td className="border border-border/60 px-3 py-1.5" {...props}>{children}</td>
            ),
            pre: ({ children, ...props }) => (
              <pre className="rounded bg-background/50 p-2 text-xs overflow-x-auto" {...props}>{children}</pre>
            ),
          }}
        >
          {processed}
        </ReactMarkdown>
      </div>
    </div>
  )
}

/**
 * Separate <think>...</think> blocks from the main answer.
 * Handles multiple think blocks and partial (unclosed) thinking during streaming.
 */
function separateThinking(text: string): { thinking: string | null; answer: string } {
  // Match complete <think>...</think> and <thinking>...</thinking> blocks
  const thinkRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi
  const thinkParts: string[] = []
  let answer = text

  let match: RegExpExecArray | null
  while ((match = thinkRegex.exec(text)) !== null) {
    thinkParts.push(match[1].trim())
  }
  answer = answer.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").trim()

  // Handle unclosed <think> or <thinking> tag (streaming in progress)
  const unclosedMatch = answer.match(/<think(?:ing)?>([\s\S]*)$/i)
  if (unclosedMatch) {
    thinkParts.push(unclosedMatch[1].trim())
    answer = answer.replace(/<think(?:ing)?>[\s\S]*$/i, "").trim()
  }

  const thinking = thinkParts.length > 0 ? thinkParts.join("\n\n") : null
  return { thinking, answer }
}

/** Streaming thinking: shows latest ~5 lines rolling upward with animation */
function StreamingThinkingBlock({ content }: { content: string }) {
  const lines = content.split("\n").filter((l) => l.trim())
  const visibleLines = lines.slice(-5)

  return (
    <div className="rounded-md border border-dashed border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 px-2.5 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm animate-pulse">💭</span>
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Thinking...</span>
        <span className="text-[10px] text-amber-600/50 dark:text-amber-500/40">{lines.length} lines</span>
      </div>
      <div className="h-[5lh] overflow-hidden text-xs text-amber-800/70 dark:text-amber-300/60 font-mono leading-relaxed">
        {visibleLines.map((line, i) => (
          <div
            key={lines.length - 5 + i}
            className="truncate"
            style={{ opacity: 0.4 + (i / visibleLines.length) * 0.6 }}
          >
            {line}
          </div>
        ))}
        <span className="animate-pulse text-amber-500">▊</span>
      </div>
    </div>
  )
}

/** Completed thinking: collapsed by default, click to expand */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split("\n").filter((l) => l.trim())

  return (
    <div className="mb-2 rounded-md border border-dashed border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors"
      >
        <span className="text-sm">💭</span>
        <span className="font-medium">Thought for {lines.length} lines</span>
        <span className="text-amber-600/60 dark:text-amber-500/60">
          {expanded ? "▼" : "▶"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/20 px-2.5 py-2 text-xs text-amber-800/80 dark:text-amber-300/70 whitespace-pre-wrap max-h-64 overflow-y-auto font-mono leading-relaxed">
          {content}
        </div>
      )}
    </div>
  )
}

/**
 * Process content to create clickable links:
 * - [[wikilinks]] → markdown links with wikilink: protocol
 */
function processContent(text: string): string {
  let result = text

  // Clean up LaTeX notation → readable Unicode
  // First handle $\command$ patterns, then strip remaining $...$
  result = result.replace(/\$\\([a-zA-Z]+)\$/g, (_match, cmd: string) => {
    return LATEX_TO_UNICODE[cmd] ?? `\\${cmd}`
  })
  // Handle $$...$$ display math (keep inner content, strip delimiters)
  result = result.replace(/\$\$([^$]+)\$\$/g, "\n$1\n")
  // Handle remaining $...$ inline math with potential LaTeX inside
  result = result.replace(/\$([^$]+)\$/g, (_match, inner: string) => {
    // Replace LaTeX commands inside the math expression
    return inner.replace(/\\([a-zA-Z]+)/g, (_m, cmd: string) => LATEX_TO_UNICODE[cmd] ?? `\\${cmd}`)
  })

  // Fix malformed wikilinks like [[name] (missing closing bracket)
  result = result.replace(/\[\[([^\]]+)\](?!\])/g, "[[$1]]")

  // Convert [[wikilinks]] to markdown links
  result = result.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_match, pageName: string, displayText?: string) => {
      const display = displayText?.trim() || pageName.trim()
      return `[${display}](wikilink:${pageName.trim()})`
    }
  )

  return result
}

function SourceRef({ fileName }: { fileName: string }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!project) return

    // Try exact match first, then search with the name as given
    const candidates = [
      `${project.path}/raw/sources/${fileName}`,
    ]

    // If fileName has no extension, try to find a matching file
    if (!fileName.includes(".")) {
      for (const sf of cachedSourceFiles) {
        const stem = sf.replace(/\.[^.]+$/, "")
        if (stem === fileName || sf.startsWith(fileName)) {
          candidates.unshift(`${project.path}/raw/sources/${sf}`)
        }
      }
    }

    setActiveView("wiki")

    for (const path of candidates) {
      try {
        const content = await readFile(path)
        setSelectedFile(path)
        setFileContent(content)
        return
      } catch {
        // try next
      }
    }

    // Fallback: just set the path even if we can't read it
    setSelectedFile(candidates[0])
    setFileContent(`Unable to load: ${fileName}`)
  }, [project, fileName, setSelectedFile, setFileContent, setActiveView])

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 rounded bg-accent/50 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-accent transition-colors"
      title={`Open source: ${fileName}`}
    >
      <Paperclip className="inline h-3 w-3" />
      {fileName}
    </button>
  )
}

function WikiLink({ pageName, children }: { pageName: string; children: React.ReactNode }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [exists, setExists] = useState<boolean | null>(null)
  const resolvedPath = useRef<string | null>(null)

  useEffect(() => {
    if (!project) return
    const candidates = [
      `${project.path}/wiki/entities/${pageName}.md`,
      `${project.path}/wiki/concepts/${pageName}.md`,
      `${project.path}/wiki/sources/${pageName}.md`,
      `${project.path}/wiki/queries/${pageName}.md`,
      `${project.path}/wiki/comparisons/${pageName}.md`,
      `${project.path}/wiki/synthesis/${pageName}.md`,
      `${project.path}/wiki/${pageName}.md`,
    ]

    let cancelled = false
    async function check() {
      for (const path of candidates) {
        try {
          await readFile(path)
          if (!cancelled) {
            resolvedPath.current = path
            setExists(true)
          }
          return
        } catch {
          // try next
        }
      }
      if (!cancelled) setExists(false)
    }
    check()
    return () => { cancelled = true }
  }, [project, pageName])

  const handleClick = useCallback(async () => {
    if (!resolvedPath.current) return
    try {
      const content = await readFile(resolvedPath.current)
      setSelectedFile(resolvedPath.current)
      setFileContent(content)
      setActiveView("wiki")
    } catch {
      // ignore
    }
  }, [setSelectedFile, setFileContent, setActiveView])

  if (exists === false) {
    return (
      <span className="inline text-muted-foreground" title={`Page not found: ${pageName}`}>
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-primary underline decoration-primary/30 hover:bg-primary/10 hover:decoration-primary"
      title={`Open wiki page: ${pageName}`}
    >
      <FileText className="inline h-3 w-3" />
      {children}
    </button>
  )
}
