import { describe, expect, it } from 'vitest'
import {
  iconizeName,
  iconsAfterMove,
  iconsAfterRemove,
  lucideName,
  parseIconize,
  parseIcons,
  serializeIcons,
} from './icons'
import { ACCENTS, accentOf, environmentsOf, parseEnvironments } from './environments'

describe('nomes de ícone', () => {
  it('lê os nomes do Iconize', () => {
    expect(lucideName('LiBookOpen')).toBe('book-open')
    expect(lucideName('LiPlane')).toBe('plane')
    expect(lucideName('LiGamepad2')).toBe('gamepad-2')
    expect(lucideName('📎')).toBeNull()
  })

  it('escreve um nome que volta ao mesmo ícone', () => {
    for (const icon of ['book-open', 'plane', 'gamepad-2', 'message-square', 'map-pin']) {
      expect(lucideName(iconizeName(icon))).toBe(icon)
    }
  })
})

describe('arquivo de ícones', () => {
  it('do Iconize, deixa de fora as configurações do plugin', () => {
    const text = JSON.stringify({ settings: { fontSize: 16 }, Notas: 'LiUser', 'Notas/Voo': '✈️' })
    expect(parseIconize(text)).toEqual({ Notas: 'LiUser', 'Notas/Voo': '✈️' })
    expect(parseIconize('não é json')).toEqual({})
  })

  it('o do app distingue não existir de estar vazio', () => {
    expect(parseIcons('')).toBeNull()
    expect(parseIcons('{}')).toBeNull()
    expect(parseIcons(serializeIcons({}))).toEqual({})
    expect(parseIcons(serializeIcons({ b: 'LiBox', a: 'LiUser' }))).toEqual({
      a: 'LiUser',
      b: 'LiBox',
    })
  })

  it('renomear uma pasta leva o ícone dela e os de dentro', () => {
    const icons = { Notas: 'LiUser', 'Notas/Voo': 'LiPlane', Notas2: 'LiBox', Outra: 'LiStar' }
    expect(iconsAfterMove(icons, 'Notas', 'Pessoal')).toEqual({
      Pessoal: 'LiUser',
      'Pessoal/Voo': 'LiPlane',
      Notas2: 'LiBox',
      Outra: 'LiStar',
    })
    // Nothing of that path: the very same map, so nothing is written to disk.
    expect(iconsAfterMove(icons, 'Nada', 'Outro')).toBe(icons)
  })

  it('apagar uma pasta tira o ícone dela e os de dentro', () => {
    const icons = { Notas: 'LiUser', 'Notas/Voo': 'LiPlane', Outra: 'LiStar' }
    expect(iconsAfterRemove(icons, 'Notas')).toEqual({ Outra: 'LiStar' })
    expect(iconsAfterRemove(icons, 'Nada')).toBe(icons)
  })
})

describe('ambientes', () => {
  it('são as pastas da raiz, menos as ocultas, a de anexos e as postas de lado', () => {
    const roots = ['Reasset Notes', '.obsidian', 'Files', '_meta', 'Personal Notes', 'Backup']
    expect(environmentsOf(roots, { skip: ['Backup'], colors: {} })).toEqual([
      'Personal Notes',
      'Reasset Notes',
    ])
  })

  it('um arquivo ausente ou estragado é configuração nenhuma', () => {
    expect(parseEnvironments('')).toEqual({ skip: [], colors: {} })
    expect(parseEnvironments('{"skip":"x","colors":{"A":"blue","B":3}}')).toEqual({
      skip: [],
      colors: { A: 'blue' },
    })
  })

  it('a cor que não existe é a primeira', () => {
    expect(accentOf('blue').id).toBe('blue')
    expect(accentOf('nada')).toBe(ACCENTS[0])
    expect(accentOf(undefined)).toBe(ACCENTS[0])
  })
})
