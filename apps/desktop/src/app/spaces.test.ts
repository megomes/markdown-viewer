import { describe, expect, it } from 'vitest'
import { inVault, spaceOfTab, spacesOf } from './spaces'
import type { Tab } from './store'

const tab = (baseId: string, path: string): Tab =>
  ({
    id: baseId + ':' + path,
    baseId,
    path,
    name: path.split('/').pop() ?? '',
    preview: false,
  }) as Tab

const vault = { id: 'V', name: 'Notas', label: 'C:/Notas' }
const other = { id: 'O', name: 'Outra', label: 'C:/Outra' }
const environments = ['Pessoal', 'Trabalho']

describe('em que espaço uma aba fica', () => {
  it('no ambiente da pasta raiz em que o arquivo está', () => {
    expect(spaceOfTab(tab('V', 'Pessoal/voo/a.md'), 'V', environments)).toBe('env:Pessoal')
    expect(spaceOfTab(tab('V', 'Trabalho/b.md'), 'V', environments)).toBe('env:Trabalho')
  })

  it('no vault inteiro quando não está em ambiente nenhum', () => {
    expect(spaceOfTab(tab('V', 'Welcome.md'), 'V', environments)).toBe('vault')
    expect(spaceOfTab(tab('V', 'Files/a.png'), 'V', environments)).toBe('vault')
    // A file at the root whose name is an environment's is not inside it.
    expect(spaceOfTab(tab('V', 'Pessoal'), 'V', environments)).toBe('vault')
  })

  it('sem ambientes, tudo do vault é do vault', () => {
    expect(spaceOfTab(tab('V', 'Pessoal/a.md'), 'V')).toBe('vault')
  })

  it('fora do vault, na pasta ou nos arquivos avulsos', () => {
    expect(spaceOfTab(tab('O', 'Pessoal/a.md'), 'V', environments)).toBe('folder:O')
    expect(spaceOfTab(tab('C:/solto.md', ''), 'V', environments)).toBe('files')
  })
})

describe('os espaços', () => {
  it('cada ambiente é um espaço do vault, com a árvore na sua pasta', () => {
    const spaces = spacesOf([vault, other], [], 'V', environments)
    expect(spaces.map((space) => space.id)).toEqual([
      'vault',
      'env:Pessoal',
      'env:Trabalho',
      'folder:O',
    ])
    const env = spaces[1]!
    expect(env).toMatchObject({ kind: 'env', baseId: 'V', root: 'Pessoal' })
    expect(inVault(env)).toBe(true)
    expect(inVault(spaces[3]!)).toBe(false)
  })

  it('sem o vault aberto não há ambientes', () => {
    expect(spacesOf([other], [], 'V', environments).map((space) => space.id)).toEqual([
      'vault',
      'folder:O',
    ])
  })
})
