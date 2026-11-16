import { describe, expect, it } from 'vitest'
import { captureBody, captureName, defaultCaptureFolder, noteSnippet } from './capture'

const at = new Date(2026, 10, 16, 14, 32)

describe('o nome de uma captura', () => {
  it('é o título dado', () => {
    expect(captureName(' Ideia do widget ', 'assunto', 'texto', at)).toBe('Ideia do widget')
  })

  it('sem título, o assunto que o outro app mandou', () => {
    expect(captureName('', 'Como funciona o R2', 'https://exemplo.com/r2', at)).toBe(
      'Como funciona o R2',
    )
  })

  it('sem os dois, a primeira linha do texto que não seja um endereço', () => {
    expect(captureName('', '', 'https://exemplo.com\n# Comprar filtro\nna loja', at)).toBe(
      'Comprar filtro',
    )
  })

  it('sem nada disso, a hora', () => {
    expect(captureName('', '', 'https://exemplo.com/a', at)).toBe('Captura 2026-11-16 1432')
    expect(captureName('', '', '', at)).toBe('Captura 2026-11-16 1432')
  })

  it('cabe num nome de arquivo', () => {
    expect(captureName('A/B: plano? [v2].', '', '', at)).toBe('A B plano v2')
    expect(captureName('x'.repeat(200), '', '', at)).toHaveLength(60)
  })
})

describe('o texto de uma captura', () => {
  it('uma página compartilhada vira um link com o título dela', () => {
    expect(captureBody('Guia [novo] do R2', ' https://exemplo.com/r2 ')).toBe(
      '[Guia  novo  do R2](https://exemplo.com/r2)\n',
    )
  })

  it('o resto fica como veio', () => {
    expect(captureBody('assunto', 'ligar para a oficina')).toBe('ligar para a oficina\n')
    expect(captureBody('', 'https://exemplo.com')).toBe('https://exemplo.com\n')
    expect(captureBody('', '  ')).toBe('')
  })
})

describe('o trecho de uma nota no widget', () => {
  it('sem frontmatter, marcas nem embeds', () => {
    const text = [
      '---',
      'tags: [a]',
      '---',
      '# Compras',
      '',
      '- [ ] filtro de **óleo**',
      '- [x] pneu',
      '![[foto 01.png]]',
      'ver [[Oficina|a oficina]] e [o site](https://x.y)',
      '> [!note] lembrar',
    ].join('\n')
    expect(noteSnippet(text)).toBe(
      ['Compras', '☐ filtro de óleo', '☑ pneu', 'ver a oficina e o site', 'lembrar'].join('\n'),
    )
  })

  it('corta no limite', () => {
    const out = noteSnippet('palavra '.repeat(100), 40)
    expect(out.length).toBeLessThanOrEqual(41)
    expect(out.endsWith('…')).toBe(true)
  })

  it('uma nota vazia não tem trecho', () => {
    expect(noteSnippet('---\na: 1\n---\n')).toBe('')
  })
})

describe('para onde vai uma captura sem destino escolhido', () => {
  it('para o Backlog mais perto da raiz', () => {
    expect(
      defaultCaptureFolder(
        ['Trabalho/Projetos/Backlog', 'Pessoal/Backlog', 'Pessoal/Voo'],
        ['Pessoal', 'Trabalho'],
      ),
    ).toBe('Pessoal/Backlog')
  })

  it('sem Backlog, para o primeiro ambiente, e sem ambiente, para a raiz', () => {
    expect(defaultCaptureFolder(['Pessoal/Voo'], ['Pessoal'])).toBe('Pessoal')
    expect(defaultCaptureFolder([], [])).toBe('')
  })
})
