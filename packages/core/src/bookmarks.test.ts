import { describe, expect, it } from 'vitest'
import { bookmarkedFiles, obsidianUrl, toggleBookmark } from './bookmarks'

describe('bookmarks', () => {
  it('adds a file to an empty list and reads it back', () => {
    const text = toggleBookmark(null, 'Notas/Ideia.md', 1)
    expect(JSON.parse(text)).toEqual({
      items: [{ type: 'file', ctime: 1, path: 'Notas/Ideia.md' }],
    })
    expect(bookmarkedFiles(text)).toEqual([{ path: 'Notas/Ideia.md', title: 'Ideia' }])
  })

  it('takes a file out of a group and keeps the rest', () => {
    const before = JSON.stringify({
      items: [
        { type: 'search', query: 'x' },
        { type: 'group', title: 'G', items: [{ type: 'file', path: 'a.md', title: 'A' }] },
      ],
    })
    const after = JSON.parse(toggleBookmark(before, 'a.md'))
    expect(after.items).toEqual([
      { type: 'search', query: 'x' },
      { type: 'group', title: 'G', items: [] },
    ])
  })

  it('reads a broken file as empty', () => {
    expect(bookmarkedFiles('{nope')).toEqual([])
  })

  it('builds the Obsidian link without the .md', () => {
    expect(obsidianUrl('Meu vault', 'Pasta/Nota com espaço.md')).toBe(
      'obsidian://open?vault=Meu%20vault&file=Pasta%2FNota%20com%20espa%C3%A7o',
    )
  })
})
