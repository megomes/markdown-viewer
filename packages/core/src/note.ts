/**
 * What a note says about itself and about the rest of the vault, read the way
 * Obsidian reads it: properties from the front matter, aliases and tags, the
 * headings and block ids other notes can point into, and every link and embed.
 *
 * This is a reader, not a parser of the whole Markdown grammar. It skips fenced
 * code, inline code and `%% comments %%`, because a link written inside one is
 * text, and that is the one mistake that would make the vault look broken.
 */

import { parse as parseYaml } from 'yaml'

export type LinkKind = 'wikilink' | 'embed' | 'markdown' | 'markdown-image'

export interface LinkRef {
  kind: LinkKind
  /** The file part: `nota`, `pasta/nota`, `imagem.png`. Empty for `[[#título]]`. */
  target: string
  /** `#Título` or `#^bloco` without the hash, when there is one. */
  subpath: string | null
  /** The text after `|`: alias for a link, size for an embed. */
  display: string | null
  /** Offset of the whole link in the text, for renames. */
  from: number
  to: number
}

export interface Heading {
  level: number
  text: string
  line: number
}

export interface NoteInfo {
  /** Parsed front matter, or empty when there is none or it does not parse. */
  properties: Record<string, unknown>
  /** Where the front matter ends, in characters; 0 without one. */
  bodyStart: number
  /** The YAML did not parse. The note still opens; the panel says so. */
  frontmatterError: string | null
  aliases: string[]
  /** Without the `#`, as written, from the front matter and the body. */
  tags: string[]
  headings: Heading[]
  blockIds: string[]
  links: LinkRef[]
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/
// A tag needs a letter somewhere: `#123` is not a tag, `#y2024` is.
const TAG = /(^|[\s([,;])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/
const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g
const MD_LINK =
  /(!?)\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(\s*(<[^>\n]+>|(?:[^\s()]|\([^\s()]*\))+)(?:\s+"[^"\n]*")?\s*\)/g

/** Front matter split off the note, with its YAML read. */
export function readFrontmatter(text: string): {
  properties: Record<string, unknown>
  bodyStart: number
  error: string | null
} {
  const match = FRONTMATTER.exec(text)
  if (!match) return { properties: {}, bodyStart: 0, error: null }
  try {
    const data: unknown = parseYaml(match[1]!, { uniqueKeys: false })
    const properties =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {}
    return { properties, bodyStart: match[0].length, error: null }
  } catch (error) {
    return {
      properties: {},
      bodyStart: match[0].length,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** A property that may be one value or a list, as a list of strings. */
export function stringList(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const items = Array.isArray(value) ? value : [value]
  return items
    .flatMap((item) => (typeof item === 'string' ? item.split(/,\s*/) : [item]))
    .filter((item) => item !== null && item !== undefined && item !== '')
    .map((item) => String(item).trim())
    .filter(Boolean)
}

/** `tags: [a, '#b']`, `tags: a, b` and `tag:` all count, the way Obsidian reads them. */
function frontmatterTags(properties: Record<string, unknown>): string[] {
  return [...stringList(properties.tags), ...stringList(properties.tag)].map((tag) =>
    tag.replace(/^#/, ''),
  )
}

function frontmatterAliases(properties: Record<string, unknown>): string[] {
  return [...stringList(properties.aliases), ...stringList(properties.alias)]
}

/**
 * Blanks out everything a link may not live in, keeping every offset where it
 * was, so a match in the masked text is a match in the real one.
 */
export function maskCode(text: string, from = 0): string {
  const chars = text.split('')
  const blank = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' '
  }
  blank(0, from)

  // Fenced code: ``` or ~~~, closed by the same fence or the end of the note.
  const fence = /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*$/gm
  let open: { start: number; marker: string } | null = null
  for (const match of text.matchAll(fence)) {
    const index = match.index!
    if (index < from) continue
    const marker = match[2]!
    if (!open) open = { start: index, marker }
    else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
      blank(open.start, index + match[0].length)
      open = null
    }
  }
  if (open) blank(open.start, text.length)

  const masked = chars.join('')
  const parts = masked.split('')
  // Inline code and Obsidian comments, on what is left.
  for (const match of masked.matchAll(/(`+)[^`\n]+?\1|%%[\s\S]*?%%/g)) {
    for (let i = match.index!; i < match.index! + match[0].length; i++) {
      if (parts[i] !== '\n') parts[i] = ' '
    }
  }
  return parts.join('')
}

function splitTarget(inner: string): {
  target: string
  subpath: string | null
  display: string | null
} {
  const bar = inner.indexOf('|')
  const path = bar < 0 ? inner : inner.slice(0, bar)
  const display = bar < 0 ? null : inner.slice(bar + 1)
  const hash = path.indexOf('#')
  return {
    target: (hash < 0 ? path : path.slice(0, hash)).trim(),
    subpath: hash < 0 ? null : path.slice(hash + 1).trim() || null,
    display,
  }
}

function isRemote(target: string): boolean {
  return /^[a-z][\w+.-]*:/i.test(target)
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Every link and embed in the note, outside code and comments. */
export function readLinks(text: string, from = 0): LinkRef[] {
  const masked = maskCode(text, from)
  const links: LinkRef[] = []

  for (const match of masked.matchAll(WIKI)) {
    const index = match.index!
    const inner = text.slice(index + match[1]!.length + 2, index + match[0].length - 2)
    const { target, subpath, display } = splitTarget(inner)
    links.push({
      kind: match[1] ? 'embed' : 'wikilink',
      target,
      subpath,
      display,
      from: index,
      to: index + match[0].length,
    })
  }

  for (const match of masked.matchAll(MD_LINK)) {
    const index = match.index!
    let raw = match[3]!
    if (raw.startsWith('<')) raw = raw.slice(1, -1)
    if (isRemote(raw) || (raw.startsWith('#') && raw.length === 1)) continue
    const hash = raw.indexOf('#')
    const target = safeDecode(hash < 0 ? raw : raw.slice(0, hash))
    if (isRemote(target)) continue
    links.push({
      kind: match[1] ? 'markdown-image' : 'markdown',
      target: target.trim(),
      subpath: hash < 0 ? null : safeDecode(raw.slice(hash + 1)) || null,
      display: match[2] ?? null,
      from: index,
      to: index + match[0].length,
    })
  }

  return links.sort((a, b) => a.from - b.from)
}

export function readNote(text: string): NoteInfo {
  const matter = readFrontmatter(text)
  const masked = maskCode(text, matter.bodyStart)
  const headings: Heading[] = []
  const blockIds: string[] = []
  const tags = new Set(frontmatterTags(matter.properties))

  const lines = masked.split('\n')
  lines.forEach((line, index) => {
    const heading = HEADING.exec(line)
    if (heading) headings.push({ level: heading[1]!.length, text: heading[2]!.trim(), line: index })
    const block = BLOCK_ID.exec(line)
    if (block) blockIds.push(block[1]!)
  })

  // Headings are not tags, so their hashes go before the tags are read.
  const tagSource = masked.replace(/^#{1,6}[ \t]/gm, '   ')
  for (const match of tagSource.matchAll(TAG)) tags.add(match[2]!)

  return {
    properties: matter.properties,
    bodyStart: matter.bodyStart,
    frontmatterError: matter.error,
    aliases: frontmatterAliases(matter.properties),
    tags: [...tags],
    headings,
    blockIds,
    links: readLinks(text, matter.bodyStart),
  }
}

/** Obsidian compares headings in links loosely: case and punctuation do not matter. */
export function sameHeading(a: string, b: string): boolean {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  return clean(a) === clean(b)
}
