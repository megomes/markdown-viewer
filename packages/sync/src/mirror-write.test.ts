import { describe, expect, it } from 'vitest'
import { createVaultKey, VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { SyncEngine } from './engine'
import { MemoryServer } from './memory-remote'
import { MemoryFiles, MemoryStore } from './memory-files'
import { MemoryMirrorStore, VaultMirror } from './mirror'
import type { Remote } from './protocol'

const text = (value: string) => new TextEncoder().encode(value)
const bytes = (size: number, fill = 7) => new Uint8Array(size).fill(fill)

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
  // The network can be cut, as on a phone.
  const net = { online: true }
  const real = server.remote('s25')
  const remote = new Proxy(real, {
    get: (target, key: keyof Remote) =>
      net.online
        ? target[key]
        : async () => {
            throw new Error('sem rede')
          },
  })
  const mirror = new VaultMirror({
    files: phone,
    store,
    remote,
    crypto,
    deviceName: 'S25',
    now: () => new Date(2026, 10, 15, 9, 30),
  })
  const paths = async () => (await mirror.catalog()).map((file) => file.path).toSorted()
  return { server, desktop, engine, phone, store, mirror, crypto, net, paths }
}

describe('VaultMirror, mudanças feitas no aparelho', () => {
  it('cria e edita notas, e o desktop recebe', async () => {
    const { desktop, engine, mirror } = await setup()
    await mirror.write('Inbox/nova.md', text('# Nova'))
    expect((await mirror.sync()).pushed).toBe(1)
    await engine.syncUntilQuiet()
    expect(desktop.text('Inbox/nova.md')).toBe('# Nova')

    await mirror.write('Inbox/nova.md', text('# Nova\n\nmais'))
    await mirror.sync()
    await engine.syncUntilQuiet()
    expect(desktop.text('Inbox/nova.md')).toBe('# Nova\n\nmais')
    expect(await mirror.pendingCount()).toBe(0)
  })

  it('guarda a edição sem rede e envia quando ela volta', async () => {
    const { desktop, engine, mirror, net, phone } = await setup()
    await desktop.setText('a.md', 'um')
    await engine.syncUntilQuiet()
    await mirror.sync()

    net.online = false
    await mirror.write('a.md', text('um, no metrô'))
    await expect(mirror.sync()).rejects.toThrow('sem rede')
    expect(phone.text('a.md')).toBe('um, no metrô')
    expect(await mirror.pendingCount()).toBe(1)

    net.online = true
    expect((await mirror.sync()).pushed).toBe(1)
    await engine.syncUntilQuiet()
    expect(desktop.text('a.md')).toBe('um, no metrô')
  })

  it('a edição pendente sobrevive ao app fechar', async () => {
    const { server, desktop, engine, mirror, net, phone, store, crypto } = await setup()
    net.online = false
    await mirror.write('a.md', text('offline'))
    const reopened = new VaultMirror({ files: phone, store, remote: server.remote('s25'), crypto })
    expect((await reopened.sync()).pushed).toBe(1)
    await engine.syncUntilQuiet()
    expect(desktop.text('a.md')).toBe('offline')
  })

  it('junta edições em partes diferentes da mesma nota', async () => {
    const { desktop, engine, mirror, phone } = await setup()
    await desktop.setText('a.md', 'um\ndois\ntrês\n')
    await engine.syncUntilQuiet()
    await mirror.sync()

    await mirror.write('a.md', text('um, celular\ndois\ntrês\n'))
    await desktop.setText('a.md', 'um\ndois\ntrês, desktop\n')
    await engine.syncUntilQuiet()
    const report = await mirror.sync()
    expect(report.conflicts).toEqual([])
    expect(phone.text('a.md')).toBe('um, celular\ndois\ntrês, desktop\n')
    await engine.syncUntilQuiet()
    expect(desktop.text('a.md')).toBe('um, celular\ndois\ntrês, desktop\n')
  })

  it('quando as duas mudam a mesma linha, guarda a do aparelho numa cópia de conflito', async () => {
    const { desktop, engine, mirror, phone, paths } = await setup()
    await desktop.setText('a.md', 'um\n')
    await engine.syncUntilQuiet()
    await mirror.sync()

    await mirror.write('a.md', text('celular\n'))
    await desktop.setText('a.md', 'desktop\n')
    await engine.syncUntilQuiet()
    const report = await mirror.sync()
    const copy = 'a (conflito S25 2026-11-15 0930).md'
    expect(report.conflicts).toEqual([copy])
    expect(phone.text('a.md')).toBe('desktop\n')
    expect(phone.text(copy)).toBe('celular\n')
    expect(await paths()).toEqual([copy, 'a.md'])
    await engine.syncUntilQuiet()
    expect(desktop.text(copy)).toBe('celular\n')
    expect(desktop.text('a.md')).toBe('desktop\n')
  })

  it('renomeia e apaga, inclusive um PDF que nunca foi baixado', async () => {
    const { desktop, engine, mirror, phone } = await setup()
    await desktop.setText('a.md', 'um')
    await desktop.setText('b.md', 'dois')
    await desktop.write('m.pdf', bytes(5000))
    await engine.syncUntilQuiet()
    await mirror.sync()

    await mirror.move('a.md', 'Notas/a2.md')
    await mirror.move('m.pdf', 'Manuais/m.pdf')
    await mirror.remove('b.md')
    expect(phone.files.has('Manuais/m.pdf')).toBe(false)
    await mirror.sync()
    await engine.syncUntilQuiet()
    expect(desktop.text('Notas/a2.md')).toBe('um')
    expect(desktop.files.has('a.md')).toBe(false)
    expect(desktop.files.has('b.md')).toBe(false)
    expect(desktop.files.get('Manuais/m.pdf')?.bytes.length).toBe(5000)
    expect(desktop.files.has('m.pdf')).toBe(false)
  })

  it('apagada aqui e editada lá: a edição vence e a nota volta', async () => {
    const { desktop, engine, mirror, phone, paths } = await setup()
    await desktop.setText('a.md', 'um')
    await engine.syncUntilQuiet()
    await mirror.sync()

    await mirror.remove('a.md')
    expect(await paths()).toEqual([])
    await desktop.setText('a.md', 'um, editado')
    await engine.syncUntilQuiet()
    await mirror.sync()
    expect(phone.text('a.md')).toBe('um, editado')
    await engine.syncUntilQuiet()
    expect(desktop.text('a.md')).toBe('um, editado')
  })

  it('editada aqui e apagada lá: a edição vence e a nota volta ao desktop', async () => {
    const { desktop, engine, mirror } = await setup()
    await desktop.setText('a.md', 'um')
    await engine.syncUntilQuiet()
    await mirror.sync()

    await mirror.write('a.md', text('um, no celular'))
    await desktop.remove('a.md')
    await engine.syncUntilQuiet()
    await mirror.sync()
    await engine.syncUntilQuiet()
    expect(desktop.text('a.md')).toBe('um, no celular')
  })

  it('renomeada aqui e editada lá: fica com o nome novo e o texto novo', async () => {
    const { desktop, engine, mirror, phone } = await setup()
    await desktop.setText('a.md', 'um')
    await engine.syncUntilQuiet()
    await mirror.sync()

    await mirror.move('a.md', 'b.md')
    await desktop.setText('a.md', 'um, editado')
    await engine.syncUntilQuiet()
    await mirror.sync()
    expect(phone.text('b.md')).toBe('um, editado')
    await engine.syncUntilQuiet()
    expect(desktop.text('b.md')).toBe('um, editado')
    expect(desktop.files.has('a.md')).toBe(false)
  })

  it('duas notas criadas com o mesmo nome: a do aparelho vai para o lado', async () => {
    const { desktop, engine, mirror, phone } = await setup()
    await mirror.write('a.md', text('celular'))
    await desktop.setText('a.md', 'desktop')
    await engine.syncUntilQuiet()
    const report = await mirror.sync()
    expect(report.conflicts).toHaveLength(1)
    expect(phone.text('a.md')).toBe('desktop')
    expect(phone.text(report.conflicts[0]!)).toBe('celular')
    await engine.syncUntilQuiet()
    expect(desktop.text(report.conflicts[0]!)).toBe('celular')
  })

  it('desfazer a edição não deixa nada para enviar', async () => {
    const { server, desktop, engine, mirror } = await setup()
    await desktop.setText('a.md', 'um')
    await engine.syncUntilQuiet()
    await mirror.sync()
    const before = server.log.length

    await mirror.write('a.md', text('dois'))
    await mirror.write('a.md', text('um'))
    expect(await mirror.pendingCount()).toBe(0)
    await mirror.sync()
    expect(server.log.length).toBe(before)
  })

  it('envia imagem anexada e nota criada e apagada sem rede não chega ao servidor', async () => {
    const { server, desktop, engine, mirror, net } = await setup()
    net.online = false
    await mirror.write('rascunho.md', text('x'))
    await mirror.remove('rascunho.md')
    await mirror.write('Files/foto.jpg', bytes(300_000, 3))
    net.online = true
    expect((await mirror.sync()).pushed).toBe(1)
    await engine.syncUntilQuiet()
    expect(desktop.files.get('Files/foto.jpg')?.bytes.length).toBe(300_000)
    expect(server.log).toHaveLength(1)
  })
})
