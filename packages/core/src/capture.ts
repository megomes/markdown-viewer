/**
 * Quick capture, the part that is only text: what a note made in a hurry is
 * called, what goes in it, and what of a note fits on a widget.
 */

const UNSAFE = /[\\/:*?"<>|#^[\]]/g
const URL = /^https?:\/\/\S+$/i

function two(n: number): string {
  return String(n).padStart(2, '0')
}

/** `2026-11-16 1432`, for a capture with nothing to be named after. */
export function captureStamp(at: Date): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}${two(at.getMinutes())}`
}

/**
 * The name of a captured note, without the extension: the title that was given,
 * or the subject the sharing app sent, or the first line of the text, or the
 * time. Never a bare address, and never longer than a line of a list.
 */
export function captureName(title: string, subject: string, text: string, at: Date): string {
  const firstLine =
    text
      .split('\n')
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find((line) => line !== '' && !URL.test(line)) ?? ''
  const wanted = title.trim() || subject.trim() || firstLine
  const clean = wanted
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (!clean) return 'Captura ' + captureStamp(at)
  return clean.length > 60 ? clean.slice(0, 60).trim() : clean
}

/**
 * What goes in the note. A page shared from a browser comes as an address and
 * the page's title: it becomes a link that says where it goes.
 */
export function captureBody(subject: string, text: string): string {
  const trimmed = text.trim()
  if (URL.test(trimmed) && subject.trim()) {
    return `[${subject.trim().replace(/[[\]]/g, ' ')}](${trimmed})\n`
  }
  return trimmed ? trimmed + '\n' : ''
}

/**
 * The start of a note as plain words, for a widget: no frontmatter, no marks,
 * no embeds, and the lines of a list each on their own.
 */
export function noteSnippet(text: string, limit = 220): string {
  let body = text
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3)
    if (end > 0) body = body.slice(body.indexOf('\n', end + 1) + 1)
  }
  const lines: string[] = []
  let size = 0
  for (const raw of body.split('\n')) {
    let line = raw.trim()
    if (!line || /^!\[/.test(line) || /^```/.test(line) || /^[-*_]{3,}$/.test(line)) continue
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?(\[![^\]]*\][+-]?\s*)?/, '')
      .replace(/^[-*+]\s+\[ \]\s+/, '☐ ')
      .replace(/^[-*+]\s+\[[xX]\]\s+/, '☑ ')
      .replace(/^[-*+]\s+/, '• ')
      .replace(/!\[\[[^\]]*\]\]/g, '')
      .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|==|~~|`)/g, '')
      .trim()
    if (!line) continue
    lines.push(line)
    size += line.length + 1
    if (size >= limit || lines.length >= 6) break
  }
  const out = lines.join('\n')
  return out.length > limit ? out.slice(0, limit).trimEnd() + '…' : out
}

/**
 * Where a capture goes when the person has not said: a folder called Backlog or
 * Inbox if the vault has one (the first, by path), else the first environment,
 * else the root.
 */
export function defaultCaptureFolder(folders: string[], environments: string[]): string {
  const named = folders
    .filter((folder) => /(^|\/)(backlog|inbox|entrada|caixa de entrada)$/i.test(folder))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  return named[0] ?? environments[0] ?? ''
}
