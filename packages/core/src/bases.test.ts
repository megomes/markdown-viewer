import { describe, expect, it } from 'vitest'
import { parseBase, parseExpression, runView, showValue, type BaseFile } from './bases'

const files: BaseFile[] = [
  {
    path: 'Biblioteca/Duna.md',
    tags: ['livro'],
    links: [],
    embeds: ['Files/duna.jpg'],
    properties: { tipo: 'Ficção', prioridade: 2, status: false, autor: 'Herbert' },
  },
  {
    path: 'Biblioteca/Sapiens.md',
    tags: ['livro/ensaio'],
    links: [],
    embeds: [],
    properties: { tipo: 'Ensaio', prioridade: -1, status: true },
  },
  {
    path: 'Biblioteca/Fundação.md',
    tags: ['livro'],
    links: [],
    embeds: [],
    properties: { tipo: 'Ficção', status: true },
  },
  {
    path: 'Outros/Filme.md',
    tags: ['media'],
    links: [],
    embeds: [],
    properties: { tipo: 'Filme' },
  },
]

const BIBLIOTECA = `
filters:
  and:
    - file.hasTag("livro")
formulas:
  ordem: if(prioridade >= 0, prioridade, 99)
properties:
  file.name:
    displayName: Livro
views:
  - type: table
    name: Por tipo
    groupBy:
      property: tipo
      direction: ASC
    order: [file.name, prioridade, autor]
    sort:
      - property: formula.ordem
        direction: ASC
      - property: file.name
        direction: ASC
  - type: table
    name: Quero ler
    filters:
      and:
        - prioridade >= 0
  - type: table
    name: Lidos
    filters:
      and:
        - status == true
  - type: cards
    name: Capas
    image: file.embeds[0]
`

describe('Bases', () => {
  const config = parseBase(BIBLIOTECA)

  it('filtra por tag, inclusive aninhada, agrupa e ordena pela fórmula', () => {
    const result = runView(config, 0, files)
    expect(result.total).toBe(3)
    expect(result.columns.map((c) => c.label)).toEqual(['Livro', 'prioridade', 'autor'])
    expect(result.groups.map((g) => [g.key, g.rows.map((r) => r.values['file.name'])])).toEqual([
      ['Ensaio', ['Sapiens']],
      ['Ficção', ['Duna', 'Fundação']],
    ])
  })

  it('valor ausente não passa em comparação', () => {
    expect(runView(config, 1, files).groups[0]!.rows.map((r) => r.path)).toEqual([
      'Biblioteca/Duna.md',
    ])
  })

  it('compara booleano', () => {
    expect(runView(config, 2, files).total).toBe(2)
  })

  it('pega a capa do primeiro embed', () => {
    const rows = runView(config, 3, files).groups[0]!.rows
    expect(rows.find((r) => r.path === 'Biblioteca/Duna.md')!.image).toBe('Files/duna.jpg')
  })

  it('lê expressões com precedência, métodos e listas', () => {
    expect(parseExpression('a + b * 2 >= 3 && !c').t).toBe('binary')
    const result = runView(
      parseBase('filters: \'file.name.lower().contains("du") || tipo == "filme"\''),
      0,
      files,
    )
    expect(result.groups[0]!.rows.map((r) => r.path).sort()).toEqual([
      'Biblioteca/Duna.md',
      'Outros/Filme.md',
    ])
  })

  it('expressão desconhecida não derruba a base', () => {
    const result = runView(parseBase('filters: "algumaFuncao(1) ==="'), 0, files)
    expect(result.total).toBe(4)
  })

  it('mostra valores', () => {
    expect(showValue(['a', 2])).toBe('a, 2')
    expect(showValue(null)).toBe('')
  })
})
