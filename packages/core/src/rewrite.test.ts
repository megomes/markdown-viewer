import { describe, expect, it } from 'vitest'
import { createResolver } from './resolver'
import { relativePath, rewriteLinks, type MoveContext } from './rewrite'

const before = createResolver([
  'Docs/Manual.md',
  'Docs/img.png',
  'Notas/Painel.md',
  'Outra/Manual.md',
])

function ctx(moved: Record<string, string>, ambiguous: string[] = []): MoveContext {
  return {
    moved: new Map(Object.entries(moved)),
    resolveBefore: (target, from) => before.resolve(target, from),
    nameIsAmbiguous: (name) => ambiguous.includes(name),
  }
}

describe('rewriteLinks', () => {
  it('troca só o alvo e mantém título, apelido e embed', () => {
    const text = 'Veja [[Docs/Manual#Seção|o manual]] e ![[img.png|200]] e [[Painel]].'
    const out = rewriteLinks(
      text,
      'Notas/Painel.md',
      'Notas/Painel.md',
      ctx({ 'Docs/Manual.md': 'Docs/Guia.md', 'Docs/img.png': 'Files/foto.png' }),
    )
    expect(out).toBe('Veja [[Docs/Guia#Seção|o manual]] e ![[foto.png|200]] e [[Painel]].')
  })

  it('usa o caminho inteiro quando o nome novo fica repetido', () => {
    const out = rewriteLinks(
      '[[Painel]]',
      'Docs/Manual.md',
      'Docs/Manual.md',
      ctx({ 'Notas/Painel.md': 'Notas/Manual.md' }, ['Manual.md']),
    )
    expect(out).toBe('[[Notas/Manual]]')
  })

  it('recalcula o link Markdown relativo, com espaço codificado', () => {
    const out = rewriteLinks(
      '[m](../Docs/Manual.md#intro)',
      'Notas/Painel.md',
      'Notas/Painel.md',
      ctx({ 'Docs/Manual.md': 'Arquivo Morto/Manual.md' }),
    )
    expect(out).toBe('[m](../Arquivo%20Morto/Manual.md#intro)')
  })

  it('segue os links relativos da própria nota quando ela muda de pasta', () => {
    const out = rewriteLinks(
      '![x](../Docs/img.png)',
      'Notas/Painel.md',
      'Notas/Sub/Painel.md',
      ctx({}),
    )
    expect(out).toBe('![x](../../Docs/img.png)')
  })

  it('devolve nulo quando nada aponta para o que mudou', () => {
    expect(
      rewriteLinks(
        '[[Painel]] `[[Docs/Manual]]`',
        'x.md',
        'x.md',
        ctx({ 'Docs/Manual.md': 'y.md' }),
      ),
    ).toBeNull()
  })

  it('caminho relativo entre pastas', () => {
    expect(relativePath('a/x/n.md', 'a/b/c.md')).toBe('../b/c.md')
    expect(relativePath('n.md', 'a/c.md')).toBe('a/c.md')
  })
})
