import { describe, expect, it } from 'vitest'
import { maskCode, readLinks, readNote, sameHeading, stringList } from './note'

describe('front matter', () => {
  it('lê propriedades, aliases e tags como o Obsidian', () => {
    const note = readNote(
      '---\ntags: [projeto, "#metodo"]\naliases:\n  - Outro nome\ntipo: livro\nprioridade: 2\n---\n# Título\n',
    )
    expect(note.properties).toMatchObject({ tipo: 'livro', prioridade: 2 })
    expect(note.aliases).toEqual(['Outro nome'])
    expect(note.tags).toEqual(['projeto', 'metodo'])
    expect(note.bodyStart).toBeGreaterThan(0)
  })

  it('aceita lista separada por vírgula e o singular', () => {
    expect(readNote('---\ntag: a, b\nalias: X\n---\n').tags).toEqual(['a', 'b'])
    expect(readNote('---\nalias: X\n---\n').aliases).toEqual(['X'])
  })

  it('YAML quebrado não derruba a nota', () => {
    const note = readNote('---\ntags: [a\n---\ncorpo #tag\n')
    expect(note.frontmatterError).not.toBeNull()
    expect(note.tags).toEqual(['tag'])
  })

  it('stringList ignora vazio e nulo', () => {
    expect(stringList(null)).toEqual([])
    expect(stringList(['a', null, ''])).toEqual(['a'])
  })
})

describe('tags no texto', () => {
  it('acha tag aninhada e ignora título, número e código', () => {
    const note = readNote(
      '# Título\n\nTexto #area/sub e #2024 e `#nao` e #y2024\n\n```\n#nada\n```\n',
    )
    expect(note.tags.sort()).toEqual(['area/sub', 'y2024'])
  })
})

describe('títulos e blocos', () => {
  it('lê os títulos e os ids de bloco', () => {
    const note = readNote('# Um\n\ntexto ^abc-1\n\n## Dois ##\n')
    expect(note.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Um'],
      [2, 'Dois'],
    ])
    expect(note.blockIds).toEqual(['abc-1'])
  })

  it('compara títulos sem ligar para caixa e pontuação', () => {
    expect(
      sameHeading('6. Como decido prioridade (critério)', '6 como decido prioridade critério'),
    ).toBe(true)
  })
})

describe('links', () => {
  it('separa alvo, subcaminho e o texto depois da barra', () => {
    const [link] = readLinks('veja [[Pasta/Nota#Seção|aqui]]')
    expect(link).toMatchObject({
      kind: 'wikilink',
      target: 'Pasta/Nota',
      subpath: 'Seção',
      display: 'aqui',
    })
  })

  it('reconhece embed com largura e link para bloco', () => {
    const links = readLinks('![[imagem.png|300]] e [[Nota#^bloco]] e [[#Título]]')
    expect(links.map((l) => [l.kind, l.target, l.subpath, l.display])).toEqual([
      ['embed', 'imagem.png', null, '300'],
      ['wikilink', 'Nota', '^bloco', null],
      ['wikilink', '', 'Título', null],
    ])
  })

  it('lê link Markdown com espaço codificado, parênteses e sinal de menor', () => {
    const links = readLinks(
      '[a](Minha%20Nota.md) [b](<../Outra Nota.md>) [c](pasta/arq%20(x).html) [d](https://x.com) ![e](img.png)',
    )
    expect(links.map((l) => [l.kind, l.target])).toEqual([
      ['markdown', 'Minha Nota.md'],
      ['markdown', '../Outra Nota.md'],
      ['markdown', 'pasta/arq (x).html'],
      ['markdown-image', 'img.png'],
    ])
  })

  it('ignora o que está em código e em comentário', () => {
    const text = '`[[a]]` %%[[b]]%%\n```\n[[c]]\n```\n[[d]]'
    expect(readLinks(text).map((l) => l.target)).toEqual(['d'])
  })

  it('a máscara mantém cada posição no lugar', () => {
    const text = 'x `y` z'
    expect(maskCode(text)).toHaveLength(text.length)
  })
})
