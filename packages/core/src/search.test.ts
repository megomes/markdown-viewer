import { describe, expect, it } from 'vitest'
import { fold, parseQuery, search, switcher, type SearchDoc } from './search'

const docs: SearchDoc[] = [
  {
    path: 'DCS/A-10C.md',
    title: 'A-10C',
    text: 'Checklist de partida\nLigar a APU antes',
    tags: ['dcs/aviao'],
    aliases: ['Warthog'],
  },
  {
    path: 'Música/Patches.md',
    title: 'Patches',
    text: 'Timbre de guitarra\nPartida lenta',
    tags: ['musica'],
    aliases: [],
  },
  {
    path: 'Reasset/Notas.md',
    title: 'Notas',
    text: 'Reunião sobre crédito',
    tags: [],
    aliases: [],
  },
]

describe('busca', () => {
  it('ignora caixa e acento e exige todas as palavras', () => {
    expect(
      search('PARTIDA', docs)
        .map((r) => r.path)
        .sort(),
    ).toEqual(['DCS/A-10C.md', 'Música/Patches.md'])
    expect(search('reuniao credito', docs).map((r) => r.path)).toEqual(['Reasset/Notas.md'])
    expect(search('partida apu', docs).map((r) => r.path)).toEqual(['DCS/A-10C.md'])
  })

  it('filtra por tag, inclusive aninhada, e por pasta', () => {
    expect(search('#dcs', docs).map((r) => r.path)).toEqual(['DCS/A-10C.md'])
    expect(search('tag:musica partida', docs).map((r) => r.path)).toEqual(['Música/Patches.md'])
    expect(search('partida path:musica', docs).map((r) => r.path)).toEqual(['Música/Patches.md'])
  })

  it('aceita frase entre aspas e exclusão', () => {
    expect(search('"ligar a apu"', docs)).toHaveLength(1)
    expect(search('partida -apu', docs).map((r) => r.path)).toEqual(['Música/Patches.md'])
  })

  it('marca onde está o trecho achado', () => {
    const [result] = search('apu', docs)
    const match = result!.matches[0]!
    const [from, to] = match.ranges[0]!
    expect(match.preview.slice(from, to)).toBe('APU')
  })

  it('lê a consulta', () => {
    expect(parseQuery('a "b c" #t path:p -x')).toEqual({
      terms: ['a'],
      phrases: ['b c'],
      excluded: ['x'],
      tags: ['t'],
      paths: ['p'],
    })
    expect(fold('Ação')).toBe('acao')
  })
})

describe('abertura rápida', () => {
  it('acha pelo nome e pelo alias, começo do nome primeiro', () => {
    const files = docs.map((d) => ({ path: d.path, aliases: d.aliases }))
    expect(switcher('warth', files)[0]).toMatchObject({
      path: 'DCS/A-10C.md',
      label: 'Warthog',
      alias: true,
    })
    expect(switcher('pat', files)[0]!.path).toBe('Música/Patches.md')
  })
})
