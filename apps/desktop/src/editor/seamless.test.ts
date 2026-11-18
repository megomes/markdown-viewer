// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { editorExtensions } from './setup'

/**
 * The hide-and-reveal layer, exercised through a real editor.
 *
 * The assertions read the rendered text rather than the decoration set, because
 * what matters is what somebody sees: `#` gone when the cursor is elsewhere,
 * back when the cursor is on the line, and the document itself never touched.
 */
function open(doc: string, cursor = 0): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(cursor),
      extensions: editorExtensions({
        title: 'teste.md',
        baseId: 'b',
        path: 'teste.md',
        plainText: false,
        readOnly: false,
        onSave: () => {},
      }),
    }),
    parent: document.body,
  })
  return view
}

/** What the lines of the editor actually show. */
function shown(view: EditorView): string {
  return [...view.contentDOM.querySelectorAll('.cm-line')]
    .map((line) => line.textContent)
    .join('\n')
}

function withCursor(doc: string, cursor: number): string {
  const view = open(doc, cursor)
  const text = shown(view)
  view.destroy()
  return text
}

describe('a escrita seamless', () => {
  it('esconde o # do título quando o cursor está em outra linha', () => {
    expect(withCursor('# Título\n\ncorpo', 12)).toContain('Título')
    expect(withCursor('# Título\n\ncorpo', 12)).not.toContain('# Título')
  })

  it('devolve o # quando o cursor entra na linha', () => {
    expect(withCursor('# Título\n\ncorpo', 3)).toContain('# Título')
  })

  it('esconde os asteriscos e os til fora da linha', () => {
    const doc = 'um **forte** e um ~~riscado~~\n\noutra linha'
    expect(withCursor(doc, 32)).toContain('um forte e um riscado')
  })

  it('mostra a marcação de volta na linha do cursor', () => {
    const doc = 'um **forte** aqui\n\noutra linha'
    expect(withCursor(doc, 4)).toContain('**forte**')
  })

  it('esconde o alvo de um wiki link com apelido', () => {
    const doc = 'veja [[pasta/alvo|apelido]] aqui\n\noutra linha'
    const visivel = withCursor(doc, 35)
    expect(visivel).toContain('apelido')
    expect(visivel).not.toContain('pasta/alvo')
  })

  it('esconde a URL de um link e deixa só o texto', () => {
    const doc = 'veja [texto](https://exemplo.com) aqui\n\noutra linha'
    const visivel = withCursor(doc, 41)
    expect(visivel).toContain('texto')
    expect(visivel).not.toContain('https://exemplo.com')
  })

  it('esconde as cercas do bloco de código e põe a linguagem no canto', () => {
    const doc = '```bash\nnode x.mjs\n```\n\ndepois'
    const view = open(doc, doc.length)
    expect(shown(view)).not.toContain('```')
    expect(view.contentDOM.querySelector('.cm-md-code-language')?.textContent).toBe('bash')
    expect(view.contentDOM.querySelector('.cm-md-code-copy')).not.toBeNull()
    view.destroy()
  })

  it('mostra as cercas quando o cursor entra no bloco, e o botão de copiar fica', () => {
    const doc = '```bash\nnode x.mjs\n```\n\ndepois'
    const view = open(doc, 10)
    expect(shown(view)).toContain('```bash')
    expect(view.contentDOM.querySelector('.cm-md-code-copy')).not.toBeNull()
    view.destroy()
  })

  it('copia só o código, sem as cercas', async () => {
    const doc = '```bash\nnode x.mjs\nnode y.mjs\n```\n\ndepois'
    const view = open(doc, doc.length)
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void (copied = text) },
    })
    view.contentDOM.querySelector<HTMLButtonElement>('.cm-md-code-copy')!.click()
    await Promise.resolve()
    expect(copied).toBe('node x.mjs\nnode y.mjs')
    view.destroy()
  })

  it('pinta a seleção no próprio texto, por cima do fundo do bloco', () => {
    const doc = '```bash\nSim.getPause()\n```\n'
    const view = open(doc, 8)
    view.dispatch({ selection: EditorSelection.single(8, 15) })
    expect(view.contentDOM.querySelector('.cm-md-selected')?.textContent).toBe('Sim.get')
    view.destroy()
  })

  it('nunca muda o documento, só o desenho', () => {
    const doc = '# Título\n\num **forte** e um [[link]]\n'
    const view = open(doc, 20)
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it('não interpreta nada num arquivo de texto puro', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '# não é título\n\n**não é forte**',
        extensions: editorExtensions({
          title: 'a.txt',
          baseId: 'b',
          path: 'a.txt',
          plainText: true,
          readOnly: false,
          onSave: () => {},
        }),
      }),
      parent: document.body,
    })
    expect(shown(view)).toContain('# não é título')
    expect(shown(view)).toContain('**não é forte**')
    view.destroy()
  })
})
