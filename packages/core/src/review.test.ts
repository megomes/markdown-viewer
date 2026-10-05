import { describe, expect, it } from 'vitest'
import {
  buildReviewExport,
  noteItem,
  pendingItems,
  readReview,
  sourceOfState,
  writeReview,
  type ReviewItem,
} from './review'

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  id: 'i1',
  n: 1,
  kind: 'título',
  tagSig: '<h2 class="sec-title">',
  inside: 'section#diagnostico',
  anchor: 'Cobertura por safra',
  anchorFrom: 'texto',
  path: 'section#diagnostico > h2.sec-title',
  occurrences: 2,
  comment: 'o título não diz o efeito.',
  ...over,
})

describe('export no formato do Revisor', () => {
  it('reproduz o texto do Copiar tudo, com o caminho do arquivo no vault', () => {
    const text = buildReviewExport(
      [
        {
          filePath: 'C:/vault/AS-IS.html',
          title: 'AS-IS',
          items: [item({}), item({ id: 'i2', n: 2, comment: '  ' })],
        },
      ],
      new Date(2026, 8, 18, 14, 9),
    )
    expect(text).toBe(
      [
        '# Revisão visual: 1 item em 1 página',
        'Gerado em 2026-09-18 14:09.',
        '',
        'Cada item traz uma âncora, que é o texto como ele aparece na página e, em geral,',
        'literalmente no arquivo fonte, mais um caminho CSS que confirma o alvo. Ache o',
        'trecho pela âncora, confirme pelo caminho e aplique o pedido. Não altere nada',
        'fora do que está listado.',
        '',
        '## Página 1: AS-IS',
        'Arquivo: C:/vault/AS-IS.html',
        '',
        '### 1 · título <h2 class="sec-title"> em section#diagnostico',
        'Âncora: "Cobertura por safra"',
        'Caminho: section#diagnostico > h2.sec-title',
        'Atenção: esse texto aparece 2 vezes na página. Desempate pelo caminho.',
        'Pedido: o título não diz o efeito.',
        '',
      ].join('\n'),
    )
  })

  it('vazio quando nada tem pedido', () => {
    expect(buildReviewExport([{ filePath: 'a', title: 'a', items: [item({ comment: '' })] }])).toBe(
      '',
    )
  })
})

describe('estado no arquivo de estado da página', () => {
  it('lê, escreve, cria comentário de nota e acha os pendentes', () => {
    const review = noteItem(null, {
      title: 'Painel',
      selected: 'Seção dois',
      context: '...ver a «Seção dois» abaixo',
      section: '# Painel › ## Seção dois',
      comment: 'detalhar',
    })
    const text = writeReview('{"version":1,"localStorage":{"outra":"1"}}', review)
    const back = readReview(text)!
    expect(back.items).toHaveLength(1)
    expect(back.nextN).toBe(2)
    expect(JSON.parse(text).localStorage.outra).toBe('1')
    expect(pendingItems(back)).toHaveLength(1)
    back.items[0]!.claude = { status: 'applied', at: 'x' }
    expect(pendingItems(back)).toHaveLength(0)
  })

  it('acha o arquivo de origem de um estado', () => {
    expect(sourceOfState('.markdown-viewer/state/Trackers/A-10C.html.json')).toBe(
      'Trackers/A-10C.html',
    )
    expect(sourceOfState('Notas/x.md')).toBeNull()
  })
})
