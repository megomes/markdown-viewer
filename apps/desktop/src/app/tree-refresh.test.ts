import { describe, expect, it } from 'vitest'
import type { Entry } from '@markdown-viewer/core/fs'
import { sameEntries } from './store'

/**
 * Note #15: files added from outside the app never reached the tree. The tree
 * now reads its folders again on every check, and only an actual change is
 * dispatched, so an idle vault is not rendered again every few seconds.
 */

const BASE = 'C:\\Users\\alex\\Documents\\MainVault'
const entry = (path: string, kind: Entry['kind'] = 'file'): Entry => ({
  id: BASE + ':' + path,
  baseId: BASE,
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  kind,
})

describe('sameEntries', () => {
  it('sees an unchanged folder as the same', () => {
    expect(sameEntries([entry('a.md'), entry('b')], [entry('a.md'), entry('b')])).toBe(true)
  })

  it('notices a file added from outside', () => {
    expect(sameEntries([entry('a.md')], [entry('a.md'), entry('novo.md')])).toBe(false)
  })

  it('notices a file renamed or removed', () => {
    expect(sameEntries([entry('a.md')], [entry('b.md')])).toBe(false)
    expect(sameEntries([entry('a.md'), entry('b.md')], [entry('a.md')])).toBe(false)
  })

  it('treats a folder never read as changed', () => {
    expect(sameEntries(undefined, [])).toBe(false)
  })
})
