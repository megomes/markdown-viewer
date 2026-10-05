import { describe, expect, it } from 'vitest'
import { ignoreMatcher } from './ignore'

describe('ignore', () => {
  const ignored = ignoreMatcher('*.tmp\nRascunhos/\n/raiz.md\n# comentário')

  it('ignora as pastas de ferramenta e o lixo do sistema', () => {
    expect(ignored('.git/HEAD')).toBe(true)
    expect(ignored('Notas/node_modules/x.js')).toBe(true)
    expect(ignored('Notas/.DS_Store')).toBe(true)
    expect(ignored('.obsidian/workspace.json')).toBe(true)
  })

  it('mantém o resto, inclusive .obsidian e o estado das páginas', () => {
    expect(ignored('.obsidian/app.json')).toBe(false)
    expect(ignored('.markdown-viewer/state/Trackers/A-10C.html.json')).toBe(false)
    expect(ignored('Notas/Painel.md')).toBe(false)
  })

  it('aplica os padrões do vault', () => {
    expect(ignored('a/b/c.tmp')).toBe(true)
    expect(ignored('Rascunhos/x.md')).toBe(true)
    expect(ignored('Outro/Rascunhos/x.md')).toBe(true)
    expect(ignored('raiz.md')).toBe(true)
    expect(ignored('pasta/raiz.md')).toBe(false)
  })
})
