import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from './vault'

let root: string
let vault: Vault

function put(path: string, text: string) {
  const full = join(root, ...path.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vault-'))
  put(
    'Docs/Manual.md',
    '---\naliases: [Guia]\ntags: [dcs/a10]\ntipo: manual\n---\n# Manual\n\nChecklist de partida.\n',
  )
  put('Notas/Painel.md', 'Veja [[Guia]] e [[Manual#Manual|o manual]].\n![[foto.png]]\n')
  put('Files/foto.png', 'png')
  put(
    'Livros.base',
    'filters: \'file.hasTag("dcs")\'\nviews:\n  - type: table\n    name: Tudo\n    order: [file.name, tipo]\n',
  )
  put('Trackers/Treino.html', '<title>Treino A-10C</title><p>Partida a frio</p>')
  put('.obsidian/app.json', '{}')
  vault = new Vault(root)
})

afterEach(() => {
  vault.close()
  rmSync(root, { recursive: true, force: true })
})

describe('Vault', () => {
  it('acha notas e páginas pela busca, com tag', async () => {
    expect((await vault.search('partida', 10)).map((r) => r.path).sort()).toEqual([
      'Docs/Manual.md',
      'Trackers/Treino.html',
    ])
    expect((await vault.search('#dcs', 10)).map((r) => r.path)).toEqual(['Docs/Manual.md'])
  })

  it('resolve link por alias e devolve backlinks', async () => {
    expect(await vault.locate('[[Guia]]')).toBe('Docs/Manual.md')
    expect((await vault.backlinks('Docs/Manual.md')).map((b) => b.path)).toEqual([
      'Notas/Painel.md',
    ])
    const { file } = await vault.note('Trackers/Treino.html')
    expect(file?.title).toBe('Treino A-10C')
  })

  it('lista tags e propriedades', async () => {
    expect(await vault.tags()).toEqual([['dcs/a10', 1]])
    expect(await vault.properties('tipo')).toEqual({
      property: 'tipo',
      files: 1,
      values: [['manual', 1]],
    })
  })

  it('roda uma Base', async () => {
    const result = await vault.queryBase('Livros.base')
    expect(result.total).toBe(1)
    expect(result.groups[0]!.rows[0]).toMatchObject({
      path: 'Docs/Manual.md',
      Nome: 'Manual',
      tipo: 'manual',
    })
  })

  it('renomeia e conserta os links, sem sobrescrever', async () => {
    const result = await vault.rename('Docs/Manual.md', 'Docs/Guia de voo.md')
    expect(result.updated).toEqual(['Notas/Painel.md'])
    expect(readFileSync(join(root, 'Notas', 'Painel.md'), 'utf8')).toBe(
      'Veja [[Guia]] e [[Guia de voo#Manual|o manual]].\n![[foto.png]]\n',
    )
    await expect(vault.rename('Notas/Painel.md', 'Files/foto.png')).rejects.toThrow(/Já existe/)
  })

  it('não sai do vault', async () => {
    await expect(vault.text('../fora.md')).rejects.toThrow(/fora do vault/)
  })
})
