import { describe, expect, it } from 'vitest'
import {
  attachmentName,
  attachmentsFolder,
  embeddedFiles,
  isAttachmentsFolder,
} from './attachments'

describe('onde os anexos de uma nota ficam', () => {
  const environments = ['Pessoal', 'Trabalho']

  it('na Files do ambiente da nota', () => {
    expect(attachmentsFolder('Pessoal/Voo/DCS/a.md', environments)).toBe('Pessoal/Files')
    expect(attachmentsFolder('Trabalho/b.md', environments)).toBe('Trabalho/Files')
  })

  it('na Files da raiz quando a nota não está em ambiente nenhum', () => {
    expect(attachmentsFolder('Welcome.md', environments)).toBe('Files')
    expect(attachmentsFolder('Backup/x.md', environments)).toBe('Files')
    expect(attachmentsFolder('Pessoal/a.md', [])).toBe('Files')
  })

  it('reconhece as pastas de anexos, e só elas', () => {
    expect(isAttachmentsFolder('Files')).toBe(true)
    expect(isAttachmentsFolder('Pessoal/Files')).toBe(true)
    expect(isAttachmentsFolder('Pessoal/Projetos/Files')).toBe(false)
    expect(isAttachmentsFolder('Pessoal/Files/OKRs')).toBe(false)
    expect(isAttachmentsFolder('Filesystem')).toBe(false)
  })
})

describe('o nome de um anexo novo', () => {
  it('é o da nota, com um número', () => {
    expect(attachmentName('Reunião de planning.md', 'png', () => false)).toBe(
      'Reunião de planning 01.png',
    )
  })

  it('pula os que já existem', () => {
    const taken = new Set(['Nota 01.jpg', 'Nota 02.jpg'])
    expect(attachmentName('Nota.md', '.JPG', (name) => taken.has(name))).toBe('Nota 03.jpg')
  })

  it('tira o que não pode estar num nome de arquivo ou num link', () => {
    expect(attachmentName('A/B: plano [v2] #1.md', 'png', () => false)).toBe(
      'A B plano v2 1 01.png',
    )
    expect(attachmentName('.md', '', () => false)).toBe('Anexo 01.png')
  })
})

describe('o que uma nota embute', () => {
  it('arquivos, não notas nem endereços, cada um uma vez', () => {
    const text = [
      '![[foto 01.png]]',
      '![[foto 01.png|300]]',
      '![[Outra nota]]',
      '![[Outra nota.md#parte]]',
      '![legenda](imagens/mapa%20a.jpg "título")',
      '![x](https://exemplo.com/a.png)',
      '![[manual.pdf#page=3]]',
      '[[link comum.png]]',
    ].join('\n')
    expect(embeddedFiles(text)).toEqual(['foto 01.png', 'imagens/mapa a.jpg', 'manual.pdf'])
  })
})
