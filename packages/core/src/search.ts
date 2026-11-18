/**
 * Search over the vault, shared by the app's search panel, the quick switcher
 * and the MCP server.
 *
 * Query language, kept small on purpose:
 * - words are all required, in any order, ignoring case and accents;
 * - `"duas palavras"` must appear together;
 * - `#tag` or `tag:tag` keeps notes with that tag (or a tag nested under it);
 * - `path:Pasta` keeps files under a folder whose path contains it;
 * - `-palavra` drops notes that have the word.
 */

export interface SearchDoc {
  path: string
  /** Shown before the path: the first heading, or the file name. */
  title: string
  text: string
  tags: string[]
  aliases: string[]
  /** `fold(text)`, when the caller keeps it: folding a whole vault per query is slow on a phone. */
  folded?: string
}

export interface SearchMatch {
  /** 0-based line. */
  line: number
  /** The line, trimmed to around the match. */
  preview: string
  /** Where the hits are inside `preview`. */
  ranges: [from: number, to: number][]
}

export interface SearchResult {
  path: string
  title: string
  score: number
  matches: SearchMatch[]
}

interface Query {
  terms: string[]
  phrases: string[]
  excluded: string[]
  tags: string[]
  paths: string[]
}

/** Lower case without accents, keeping one character per character. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function parseQuery(raw: string): Query {
  const query: Query = { terms: [], phrases: [], excluded: [], tags: [], paths: [] }
  for (const match of raw.matchAll(/(-?)"([^"]+)"|(\S+)/g)) {
    if (match[2] !== undefined) {
      if (match[1]) query.excluded.push(fold(match[2]))
      else query.phrases.push(fold(match[2]))
      continue
    }
    const token = match[3]!
    const lower = fold(token)
    if (lower.startsWith('tag:')) query.tags.push(lower.slice(4).replace(/^#/, ''))
    else if (lower.startsWith('#') && lower.length > 1) query.tags.push(lower.slice(1))
    else if (lower.startsWith('path:')) query.paths.push(lower.slice(5))
    else if (lower.startsWith('-') && lower.length > 1) query.excluded.push(lower.slice(1))
    else query.terms.push(lower)
  }
  return query
}

function hasTag(doc: SearchDoc, wanted: string): boolean {
  return doc.tags.some((tag) => {
    const t = fold(tag)
    return t === wanted || t.startsWith(wanted + '/')
  })
}

const MAX_MATCHES = 5
const PREVIEW = 140

function preview(line: string, needles: string[]): { text: string; ranges: [number, number][] } {
  const folded = fold(line)
  const hits = needles.map((n) => folded.indexOf(n)).filter((i) => i >= 0)
  const start = hits.length ? Math.max(0, Math.min(...hits) - 40) : 0
  const segment = line.slice(start, start + PREVIEW)
  const lead = start > 0 ? '…' : ''
  const foldedSegment = fold(segment)
  const ranges: [number, number][] = []
  for (const needle of needles) {
    for (
      let at = foldedSegment.indexOf(needle);
      at >= 0;
      at = foldedSegment.indexOf(needle, at + needle.length)
    ) {
      ranges.push([at + lead.length, at + lead.length + needle.length])
    }
  }
  ranges.sort((x, y) => x[0] - y[0])
  return { text: lead + segment, ranges }
}

export function search(raw: string, docs: Iterable<SearchDoc>, limit = 200): SearchResult[] {
  const query = parseQuery(raw)
  const needles = [...query.terms, ...query.phrases].filter(Boolean)
  const results: SearchResult[] = []

  for (const doc of docs) {
    if (query.tags.some((tag) => !hasTag(doc, tag))) continue
    const folderPath = fold(doc.path)
    if (query.paths.some((p) => !folderPath.includes(p))) continue
    const body = doc.folded ?? fold(doc.text)
    const named = fold(doc.title + ' ' + doc.path + ' ' + doc.aliases.join(' '))
    if (needles.some((n) => !body.includes(n) && !named.includes(n))) continue
    if (query.excluded.some((n) => body.includes(n))) continue

    let score = 1
    for (const n of needles) if (named.includes(n)) score += 10
    const matches: SearchMatch[] = []
    if (needles.length) {
      const lines = doc.text.split('\n')
      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
        const foldedLine = fold(lines[i]!)
        const hit = needles.filter((n) => foldedLine.includes(n))
        if (!hit.length) continue
        score += hit.length
        const { text, ranges } = preview(lines[i]!, hit)
        matches.push({ line: i, preview: text, ranges })
      }
    }
    results.push({ path: doc.path, title: doc.title, score, matches })
  }

  return results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit)
}

export interface SwitcherItem {
  path: string
  /** What the person typed matched: the file name or one of its aliases. */
  label: string
  alias: boolean
}

/**
 * The quick switcher: file names and aliases that contain every typed word,
 * best when the name starts with what was typed.
 */
export function switcher(
  raw: string,
  files: Iterable<{ path: string; aliases: string[] }>,
  limit = 50,
): SwitcherItem[] {
  const words = fold(raw).split(/\s+/).filter(Boolean)
  const scored: (SwitcherItem & { score: number })[] = []
  for (const file of files) {
    const name = file.path.slice(file.path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '')
    const candidates = [
      { label: name, alias: false },
      ...file.aliases.map((alias) => ({ label: alias, alias: true })),
    ]
    let best: (SwitcherItem & { score: number }) | null = null
    for (const candidate of candidates) {
      const label = fold(candidate.label)
      const whole = fold(file.path)
      if (!words.every((w) => label.includes(w) || whole.includes(w))) continue
      let score = 0
      if (words.length && label.startsWith(words[0]!)) score += 20
      for (const w of words) if (label.includes(w)) score += 5
      score -= file.path.length / 100
      if (!best || score > best.score) best = { path: file.path, ...candidate, score }
    }
    if (best) scored.push(best)
  }
  return scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit)
}
