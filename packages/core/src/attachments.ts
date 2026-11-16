/**
 * Attachments: the pictures and files a note carries. They live in one `Files`
 * folder per environment (at the root of the vault for a note that is in none),
 * which is where Obsidian can be told to put them too, so nothing here is a
 * format of our own. The tree keeps that folder out of the way, and each note
 * shows what it carries; that is how they stay near the note without littering
 * the folders.
 */

import { ATTACHMENTS } from './environments'

/** The folder a note's attachments go to. */
export function attachmentsFolder(notePath: string, environments: string[]): string {
  const slash = notePath.indexOf('/')
  const root = slash < 0 ? '' : notePath.slice(0, slash)
  return root && environments.includes(root) ? root + '/' + ATTACHMENTS : ATTACHMENTS
}

/** Whether a folder is an attachments folder: `Files`, at the root or inside a root folder. */
export function isAttachmentsFolder(path: string): boolean {
  const parts = path.split('/')
  return parts[parts.length - 1] === ATTACHMENTS && parts.length <= 2
}

const UNSAFE = /[\\/:*?"<>|#^[\]]/g

/**
 * A name for a new attachment, after the note it goes in: `Reunião 01.png`, then
 * `02`. The name has to be the only one in the whole vault, because an embed is
 * written with the name alone and found wherever it is.
 */
export function attachmentName(
  noteName: string,
  extension: string,
  taken: (name: string) => boolean,
): string {
  const stem =
    noteName
      .replace(/\.(md|markdown|txt)$/i, '')
      .replace(UNSAFE, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Anexo'
  const ext = extension.replace(/^\./, '').toLowerCase() || 'png'
  for (let n = 1; ; n++) {
    const name = `${stem} ${String(n).padStart(2, '0')}.${ext}`
    if (!taken(name)) return name
  }
}

const NOTE = /\.(md|markdown)$/i

/**
 * What a note embeds that is not another note, in the order it appears and each
 * once: the targets of `![[file.png]]` and of `![](file.png)`, as written.
 */
export function embeddedFiles(text: string): string[] {
  const found: string[] = []
  const add = (raw: string) => {
    const target = raw.split('|')[0]!.split('#')[0]!.trim()
    if (!target || /^(https?:|data:)/i.test(target)) return
    // An embed with no extension is a note.
    if (!/\.[a-z0-9]{1,8}$/i.test(target) || NOTE.test(target)) return
    if (!found.includes(target)) found.push(target)
  }
  const pattern = /!\[\[([^\]\n]+)\]\]|!\[[^\]\n]*\]\(<?([^)\n>]+?)>?(?:\s+"[^"]*")?\)/g
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined) add(match[1])
    else if (match[2] !== undefined) {
      try {
        add(decodeURI(match[2]))
      } catch {
        add(match[2])
      }
    }
  }
  return found
}
