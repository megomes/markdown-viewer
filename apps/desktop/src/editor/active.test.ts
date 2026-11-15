import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { activeLines } from './active'

describe('activeLines', () => {
  it('marca a linha do cursor quando o texto é editável', () => {
    const state = EditorState.create({ doc: '---\na: 1\n---\n# T', selection: { anchor: 0 } })
    expect(activeLines(state)).toEqual([{ from: 0, to: 3 }])
  })

  it('não marca nada em modo leitura, para nada aparecer cru', () => {
    const state = EditorState.create({
      doc: '---\na: 1\n---\n# T',
      selection: { anchor: 0 },
      extensions: EditorState.readOnly.of(true),
    })
    expect(activeLines(state)).toEqual([])
  })
})
