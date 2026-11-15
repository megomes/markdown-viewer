import { describe, expect, it } from 'vitest'
import { createVaultKey, VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { SyncEngine } from './engine'
import { MemoryServer } from './memory-remote'
import { MemoryFiles, MemoryStore } from './memory-files'
import { downloadsEagerly, MemoryMirrorStore, VaultMirror } from './mirror'

async function setup() {
  const server = new MemoryServer()
  const crypto = await VaultCrypto.create(await createVaultKey())
  const desktop = new MemoryFiles()
  const engine = new SyncEngine({
    files: desktop,
    store: new MemoryStore(),
    remote: server.remote('mac'),
    crypto,
    deviceName: 'mac',
  })
  const phone = new MemoryFiles()
  const store = new MemoryMirrorStore()
  const mirror = new VaultMirror({ files: phone, store, remote: server.remote('s25'), crypto })
  return { server, desktop, engine, phone, store, mirror, crypto }
}

const bytes = (size: number) => new Uint8Array(size).fill(7)

describe('VaultMirror', () => {
  it('baixa notas e imagens pequenas e só lista os PDFs', async () => {
    const { desktop, engine, phone, mirror } = await setup()
    await desktop.setText('Notas/a.md', '# A')
    await desktop.write('Files/foto.png', bytes(1000))
    await desktop.write('Manuais/grande.pdf', bytes(5000))
    await engine.syncUntilQuiet()

    const report = await mirror.sync()
    expect(report.changed).toBe(3)
    expect(phone.text('Notas/a.md')).toBe('# A')
    expect(phone.files.has('Files/foto.png')).toBe(true)
    expect(phone.files.has('Manuais/grande.pdf')).toBe(false)
    expect((await mirror.catalog()).map((f) => f.path).toSorted()).toEqual([
      'Files/foto.png',
      'Manuais/grande.pdf',
      'Notas/a.md',
    ])
  })

  it('baixa o PDF quando aberto, uma vez só, e o mantém', async () => {
    const { desktop, engine, phone, mirror } = await setup()
    await desktop.write('Manuais/grande.pdf', bytes(5000))
    await engine.syncUntilQuiet()
    await mirror.sync()

    const [a, b] = await Promise.all([
      mirror.open('Manuais/grande.pdf'),
      mirror.open('Manuais/grande.pdf'),
    ])
    expect(a.length).toBe(5000)
    expect(b).toBe(a)
    expect(phone.files.has('Manuais/grande.pdf')).toBe(true)
    expect((await mirror.fileAt('Manuais/grande.pdf'))?.local).toBe(true)
  })

  it('segue edições, renomeações e exclusões feitas no desktop', async () => {
    const { desktop, engine, phone, mirror } = await setup()
    await desktop.setText('a.md', 'um')
    await desktop.setText('b.md', 'dois')
    await engine.syncUntilQuiet()
    await mirror.sync()

    await desktop.setText('a.md', 'um, editado')
    await desktop.move('b.md', 'pasta/b.md')
    await engine.syncUntilQuiet()
    await mirror.sync()
    expect(phone.text('a.md')).toBe('um, editado')
    expect(phone.text('pasta/b.md')).toBe('dois')
    expect(phone.files.has('b.md')).toBe(false)

    await desktop.remove('a.md')
    await engine.syncUntilQuiet()
    await mirror.sync()
    expect(phone.files.has('a.md')).toBe(false)
    expect((await mirror.catalog()).map((f) => f.path)).toEqual(['pasta/b.md'])
  })

  it('tira do aparelho a versão velha de um PDF baixado, até ser aberto de novo', async () => {
    const { desktop, engine, phone, mirror } = await setup()
    await desktop.write('m.pdf', bytes(10))
    await engine.syncUntilQuiet()
    await mirror.sync()
    await mirror.open('m.pdf')

    await desktop.write('m.pdf', bytes(20))
    await engine.syncUntilQuiet()
    await mirror.sync()
    expect(phone.files.has('m.pdf')).toBe(false)
    expect((await mirror.open('m.pdf')).length).toBe(20)
  })

  it('nunca escreve no servidor, mesmo com o armazenamento do aparelho apagado', async () => {
    const { server, desktop, engine, phone, mirror } = await setup()
    await desktop.setText('a.md', 'um')
    await engine.syncUntilQuiet()
    await mirror.sync()
    const before = server.log.length

    phone.files.clear()
    await mirror.sync()
    expect(server.log.length).toBe(before)
    expect(desktop.text('a.md')).toBe('um')
  })

  it('volta de onde parou com o estado salvo', async () => {
    const { desktop, engine, store, server, phone, crypto } = await setup()
    await desktop.setText('a.md', 'um')
    await engine.syncUntilQuiet()
    const first = new VaultMirror({ files: phone, store, remote: server.remote('s25'), crypto })
    await first.sync()

    await desktop.setText('b.md', 'dois')
    await engine.syncUntilQuiet()
    const again = new VaultMirror({ files: phone, store, remote: server.remote('s25'), crypto })
    const report = await again.sync()
    expect(report.paths).toEqual(['b.md'])
  })
})

describe('downloadsEagerly', () => {
  it('texto, HTML e imagem pequena descem logo; PDF e imagem grande esperam', () => {
    expect(downloadsEagerly({ path: 'a.md', size: 10 })).toBe(true)
    expect(downloadsEagerly({ path: 'tracker.html', size: 500_000 })).toBe(true)
    expect(downloadsEagerly({ path: 'f.png', size: 100_000 })).toBe(true)
    expect(downloadsEagerly({ path: 'scan.png', size: 8_000_000 })).toBe(false)
    expect(downloadsEagerly({ path: 'manual.pdf', size: 1000 })).toBe(false)
  })
})
