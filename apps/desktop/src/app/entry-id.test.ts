import { describe, expect, it } from 'vitest'
import { pathIn, reducer, type State, type Doc } from './store'

/**
 * Note #8: on Windows a base is `C:\…`, and an id cut at its first colon belonged
 * to a base called `C`. A rename then moved the tab but not the active id or the
 * loaded text, and the note seemed to close.
 */

const BASE = 'C:\\Users\\alex\\Documents\\MainVault'
const id = (path: string) => BASE + ':' + path

describe('pathIn', () => {
  it('reads the path after a Windows base', () => {
    expect(pathIn(id('notas/a.md'), BASE)).toBe('notas/a.md')
    expect(pathIn(id(''), BASE)).toBe('')
  })

  it('refuses an id of another base, even one that starts the same', () => {
    expect(pathIn('C:\\Users\\alex\\Documents\\MainVault2:a.md', BASE)).toBeNull()
    expect(pathIn('C:a.md', 'C')).toBe('a.md')
  })

  it('keeps colons inside the path', () => {
    expect(pathIn('/Users/m/vault:notas/10:30.md', '/Users/m/vault')).toBe('notas/10:30.md')
  })
})

describe('a rename on Windows', () => {
  it('takes the active tab and the loaded text to the new name', () => {
    const doc = { text: 'oi', dirty: false } as Doc
    const state = {
      bases: [],
      children: {},
      expanded: { [id('pasta')]: true },
      tabs: [
        {
          id: id('Sem título.md'),
          baseId: BASE,
          path: 'Sem título.md',
          name: 'Sem título.md',
          preview: false,
        },
      ],
      activeId: id('Sem título.md'),
      docs: { [id('Sem título.md')]: doc },
      filter: '',
      error: null,
      recents: { files: [], bases: [] },
      index: {},
      pending: [],
      restored: true,
    } as unknown as State

    const next = reducer(state, {
      type: 'entry/moved',
      baseId: BASE,
      from: 'Sem título.md',
      to: 'nota.md',
    })

    expect(next.activeId).toBe(id('nota.md'))
    expect(next.tabs[0]!.id).toBe(id('nota.md'))
    expect(next.docs[id('nota.md')]).toBe(doc)
    expect(next.expanded[id('pasta')]).toBe(true)
  })
})
