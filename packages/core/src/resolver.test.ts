import { describe, expect, it } from 'vitest'
import { createResolver, normalizePath } from './resolver'

const vault = createResolver(
  [
    'Welcome.md',
    'Files/Pasted image 1.png',
    'Personal Notes/Flight Sim/DCS/Docs/Manual.pdf',
    'Personal Notes/Flight Sim/DCS/A-10C.md',
    'Personal Notes/Música/A-10C.md',
    'Personal Notes/Música/Patches.md',
    'Reasset Notes/Projects/X/1 - AS-IS/AS-IS (diagnóstico).html',
    'Reasset Notes/Projects/X/catalog.md',
    'Reasset Notes/Projects/Y/Briefing.pdf',
  ],
  [['Outro Nome', 'Personal Notes/Música/Patches.md']],
)

describe('resolver', () => {
  it('acha pelo nome em qualquer pasta, sem extensão', () => {
    expect(vault.resolve('Welcome', 'Personal Notes/x.md')).toBe('Welcome.md')
    expect(vault.resolve('pasted IMAGE 1.png', 'a.md')).toBe('Files/Pasted image 1.png')
  })

  it('com nome repetido, prefere o da mesma pasta, depois o caminho mais curto', () => {
    expect(vault.resolve('A-10C', 'Personal Notes/Música/Patches.md')).toBe(
      'Personal Notes/Música/A-10C.md',
    )
    expect(vault.resolve('A-10C', 'Welcome.md')).toBe('Personal Notes/Música/A-10C.md')
  })

  it('aceita o fim de um caminho mais longo', () => {
    expect(vault.resolve('DCS/Docs/Manual.pdf', 'x.md')).toBe(
      'Personal Notes/Flight Sim/DCS/Docs/Manual.pdf',
    )
    expect(vault.resolve('Flight Sim/DCS/A-10C', 'x.md')).toBe(
      'Personal Notes/Flight Sim/DCS/A-10C.md',
    )
  })

  it('resolve relativo à nota com ./ e ../', () => {
    expect(vault.resolve('../Y/Briefing.pdf', 'Reasset Notes/Projects/X/catalog.md')).toBe(
      'Reasset Notes/Projects/Y/Briefing.pdf',
    )
  })

  it('cai no alias e, só aqui, numa página HTML de mesmo nome', () => {
    expect(vault.resolve('outro nome', 'x.md')).toBe('Personal Notes/Música/Patches.md')
    expect(vault.resolve('1 - AS-IS/AS-IS (diagnóstico)', 'x.md')).toBe(
      'Reasset Notes/Projects/X/1 - AS-IS/AS-IS (diagnóstico).html',
    )
  })

  it('devolve nulo para o que não existe', () => {
    expect(vault.resolve('Nada', 'x.md')).toBeNull()
    expect(vault.resolve('Nada.pdf', 'x.md')).toBeNull()
  })

  it('normaliza caminhos', () => {
    expect(normalizePath('a/./b/../c\\d')).toBe('a/c/d')
  })
})
