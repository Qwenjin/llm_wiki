import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

export interface SearchResult {
  path: string
  title: string
  snippet: string
  titleMatch: boolean
  score: number
}

const MAX_RESULTS = 20
const SNIPPET_CONTEXT = 80
const TITLE_MATCH_BONUS = 10

const STOP_WORDS = new Set([
  "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
])

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\]+/)
    .filter((t) => t.length > 1)
    .filter((t) => !STOP_WORDS.has(t))
}

function tokenMatchScore(text: string, tokens: readonly string[]): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (lower.includes(token)) score += 1
  }
  return score
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function extractTitle(content: string, fileName: string): string {
  // Try YAML frontmatter title
  const frontmatterMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterMatch) return frontmatterMatch[1].trim()

  // Try first heading
  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  // Fall back to filename
  return fileName.replace(/\.md$/, "").replace(/-/g, " ")
}

function buildSnippet(content: string, query: string): string {
  const lower = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lower.indexOf(lowerQuery)
  if (idx === -1) return content.slice(0, SNIPPET_CONTEXT * 2).replace(/\n/g, " ")

  const start = Math.max(0, idx - SNIPPET_CONTEXT)
  const end = Math.min(content.length, idx + query.length + SNIPPET_CONTEXT)
  let snippet = content.slice(start, end).replace(/\n/g, " ")
  if (start > 0) snippet = "..." + snippet
  if (end < content.length) snippet = snippet + "..."
  return snippet
}

export async function searchWiki(
  projectPath: string,
  query: string,
): Promise<SearchResult[]> {
  if (!query.trim()) return []

  const tokens = tokenizeQuery(query)
  // Fallback: if all tokens were filtered out, use the trimmed query as a single token
  const effectiveTokens = tokens.length > 0 ? tokens : [query.trim().toLowerCase()]
  const results: SearchResult[] = []

  // Search wiki pages
  try {
    const wikiTree = await listDirectory(`${projectPath}/wiki`)
    const wikiFiles = flattenMdFiles(wikiTree)
    await searchFiles(wikiFiles, effectiveTokens, query, results)
  } catch {
    // no wiki directory
  }

  // Also search raw sources (extracted text)
  try {
    const rawTree = await listDirectory(`${projectPath}/raw/sources`)
    const rawFiles = flattenAllFiles(rawTree)
    await searchFiles(rawFiles, effectiveTokens, query, results)
  } catch {
    // no raw sources
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, MAX_RESULTS)
}

async function searchFiles(
  files: FileNode[],
  tokens: readonly string[],
  query: string,
  results: SearchResult[],
): Promise<void> {
  for (const file of files) {
    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      continue
    }

    const title = extractTitle(content, file.name)
    const titleText = `${title} ${file.name}`

    const titleScore = tokenMatchScore(titleText, tokens)
    const contentScore = tokenMatchScore(content, tokens)

    if (titleScore === 0 && contentScore === 0) continue

    const isTitleMatch = titleScore > 0
    const score = contentScore + (isTitleMatch ? TITLE_MATCH_BONUS : 0)

    const firstMatchingToken = tokens.find((t) =>
      content.toLowerCase().includes(t),
    ) ?? query
    const snippet = buildSnippet(content, firstMatchingToken)

    results.push({
      path: file.path,
      title,
      snippet,
      titleMatch: isTitleMatch,
      score,
    })
  }
}

function flattenAllFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenAllFiles(node.children))
    } else if (!node.is_dir) {
      files.push(node)
    }
  }
  return files
}
