import { describe, expect, it } from 'vitest'
import { createVaultKey, VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { chunk, MIN_CHUNK } from './chunker'
import { SyncEngine } from './engine'
import { MemoryServer } from './memory-remote'
import { MemoryFiles, MemoryStore } from './memory-files'
import { mergeState, mergeText } from './merge'

async function setup(names = ['mac', 'win']) {
  const server = new MemoryServer()
  const crypto = await VaultCrypto.create(await createVaultKey())
  const devices = names.map((name) => {
    const files = new MemoryFiles()
    const engine = new SyncEngine({
      files,
      store: new MemoryStore(),
      remote: server.remote(name),
      crypto,
      deviceName: name,
      now: () => new Date(2026, 9, 5, 1, 30),
    })
    return { name, files, engine }
  })
  return { server, crypto, devices }
}

const settle = async (devices: { engine: SyncEngine }[]) => {
  for (let round = 0; round < 3; round++) for (const d of devices) await d.engine.syncUntilQuiet()
}

describe('merge', () => {
  it('junta edições em linhas diferentes e recusa a mesma linha', () => {
    const base = 'a\nb\nc\nd\n'
    expect(mergeText(base, 'A\nb\nc\nd\n', 'a\nb\nc\nD\n')).toBe('A\nb\nc\nD\n')
    expect(mergeText(base, 'a\nX\nc\nd\n', 'a\nY\nc\nd\n')).toBeNull()
    expect(mergeText(base, 'a\nX\nc\nd\n', 'a\nX\nc\nd\n')).toBe('a\nX\nc\nd\n')
  })

  it('junta o estado das páginas chave por chave', () => {
    const state = (o: object) => JSON.stringify({ version: 1, localStorage: o })
    const merged = mergeState(
      state({ a: '1', b: '1' }),
      state({ a: '2', b: '1' }),
      state({ a: '1', b: '3', c: '9' }),
    )
    expect(JSON.parse(merged!).localStorage).toEqual({ a: '2', b: '3', c: '9' })
  })
})

describe('chunker', () => {
  it('um arquivo pequeno é um pedaço só; um grande se divide e os pedaços somam o todo', () => {
    expect(chunk(new Uint8Array(10))).toHaveLength(1)
    const big = new Uint8Array(20 * MIN_CHUNK)
    for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24
    const pieces = chunk(big)
    expect(pieces.length).toBeGreaterThan(2)
    expect(pieces.reduce((n, p) => n + p.length, 0)).toBe(big.length)
  })
})

describe('sync', () => {
  it('leva um arquivo novo e uma edição de um aparelho ao outro', async () => {
    const {
      devices: [mac, win],
    } = await setup()
    await mac!.files.setText('Notas/a.md', 'oi\n')
    await settle([mac!, win!])
    expect(win!.files.text('Notas/a.md')).toBe('oi\n')
    await win!.files.setText('Notas/a.md', 'oi\ntchau\n')
    await settle([mac!, win!])
    expect(mac!.files.text('Notas/a.md')).toBe('oi\ntchau\n')
  })

  it('o servidor nunca vê caminho nem conteúdo', async () => {
    const {
      server,
      devices: [mac],
    } = await setup(['mac'])
    await mac!.files.setText('Reasset/Análise de falência.md', 'dado sigiloso\n')
    await mac!.engine.syncUntilQuiet()
    const everything =
      JSON.stringify(server.log) +
      [...server.chunks.values()].map((c) => new TextDecoder().decode(c)).join('')
    expect(everything).not.toContain('falência')
    expect(everything).not.toContain('sigiloso')
  })

  it('junta edições simultâneas em trechos diferentes', async () => {
    const {
      devices: [mac, win],
    } = await setup()
    await mac!.files.setText('n.md', 'um\ndois\ntrês\nquatro\n')
    await settle([mac!, win!])
    await mac!.files.setText('n.md', 'UM\ndois\ntrês\nquatro\n')
    await win!.files.setText('n.md', 'um\ndois\ntrês\nQUATRO\n')
    await settle([mac!, win!])
    expect(mac!.files.text('n.md')).toBe('UM\ndois\ntrês\nQUATRO\n')
    expect(win!.files.text('n.md')).toBe('UM\ndois\ntrês\nQUATRO\n')
  })

  it('mesma linha nos dois: uma versão fica, a outra vira cópia de conflito, nada some', async () => {
    const {
      devices: [mac, win],
    } = await setup()
    await mac!.files.setText('n.md', 'linha\n')
    await settle([mac!, win!])
    await mac!.files.setText('n.md', 'do mac\n')
    await win!.files.setText('n.md', 'do win\n')
    await settle([mac!, win!])
    const all = (d: typeof mac) => [...d!.files.files.keys()].map((p) => d!.files.text(p)).join('|')
    expect(all(mac)).toContain('do mac')
    expect(all(mac)).toContain('do win')
    expect([...mac!.files.files.keys()].sort()).toEqual([...win!.files.files.keys()].sort())
    expect([...mac!.files.files.keys()].some((p) => p.includes('(conflito'))).toBe(true)
  })

  it('renomear num e editar no outro: as duas coisas valem', async () => {
    const {
      devices: [mac, win],
    } = await setup()
    await mac!.files.setText('a.md', 'x\n')
    await settle([mac!, win!])
    await mac!.files.move('a.md', 'Pasta/b.md')
    await win!.files.setText('a.md', 'x\ny\n')
    await settle([mac!, win!])
    for (const d of [mac!, win!]) {
      expect(d.files.text('Pasta/b.md')).toBe('x\ny\n')
      expect(d.files.text('a.md')).toBeUndefined()
    }
  })

  it('apagar num e editar no outro: a edição vence e o arquivo volta', async () => {
    const {
      devices: [mac, win],
    } = await setup()
    await mac!.files.setText('a.md', 'x\n')
    await settle([mac!, win!])
    await mac!.files.remove('a.md')
    await win!.files.setText('a.md', 'x\neditado\n')
    await settle([mac!, win!])
    expect(mac!.files.text('a.md')).toBe('x\neditado\n')
  })

  it('apagar sem conflito apaga em todos', async () => {
    const {
      devices: [mac, win],
    } = await setup()
    await mac!.files.setText('a.md', 'x\n')
    await settle([mac!, win!])
    await win!.files.remove('a.md')
    await settle([mac!, win!])
    expect(mac!.files.text('a.md')).toBeUndefined()
  })

  it('arquivo grande: uma mudança pequena sobe poucos pedaços', async () => {
    const {
      server,
      crypto,
      devices: [mac, win],
    } = await setup()
    const big = new Uint8Array(24 * MIN_CHUNK)
    for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24
    await mac!.files.write('manual.pdf', big)
    await settle([mac!, win!])
    const before = server.chunks.size
    const edited = big.slice()
    edited.set([1, 2, 3, 4, 5], 12 * MIN_CHUNK)
    await mac!.files.write('manual.pdf', edited)
    await settle([mac!, win!])
    expect(server.chunks.size - before).toBeLessThanOrEqual(2)
    // Compared by hash: a deep equality over 24 MB would eat the test runner alive.
    expect(crypto.hash(await win!.files.read('manual.pdf'))).toBe(crypto.hash(edited))
  })

  it('binário editado nos dois vira cópia de conflito', async () => {
    const {
      devices: [mac, win],
    } = await setup()
    await mac!.files.write('f.png', new Uint8Array([1]))
    await settle([mac!, win!])
    await mac!.files.write('f.png', new Uint8Array([2]))
    await win!.files.write('f.png', new Uint8Array([3]))
    await settle([mac!, win!])
    const values = [...mac!.files.files.values()].map((f) => f.bytes[0]).sort()
    expect(values).toEqual([2, 3])
  })
})

describe('simulação', () => {
  it.each([7, 42, 1234, 99, 2026])(
    'três aparelhos, operações aleatórias, semente %i: todos convergem',
    async (start) => {
      let seed = start
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31
        return seed / 2 ** 31
      }
      const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!
      const { devices } = await setup(['a', 'b', 'c'])
      const tokens = new Map<string, Set<string>>() // file stem -> tokens written
      let n = 0

      for (let step = 0; step < 160; step++) {
        const device = pick(devices)
        const paths = [...device.files.files.keys()].filter((p) => !p.includes('(conflito'))
        const roll = random()
        if (roll < 0.25 || paths.length === 0) {
          const path = `n${Math.floor(random() * 8)}.md`
          if (!device.files.files.has(path)) await device.files.setText(path, `t${++n}\n`)
          tokens.set(path, new Set([...(tokens.get(path) ?? []), `t${n}`]))
        } else if (roll < 0.75) {
          const path = pick(paths)
          const token = `t${++n}`
          const lines = (device.files.text(path) ?? '').split('\n').filter(Boolean)
          lines.splice(Math.floor(random() * (lines.length + 1)), 0, token)
          await device.files.setText(path, lines.join('\n') + '\n')
        } else if (roll < 0.85) {
          const path = pick(paths)
          const to = `m${Math.floor(random() * 4)}/${path.slice(path.lastIndexOf('/') + 1)}`
          if (!device.files.files.has(to)) await device.files.move(path, to)
        } else if (roll < 0.9) {
          await device.files.remove(pick(paths))
        }
        if (random() < 0.4) await device.engine.syncUntilQuiet()
      }
      await settle(devices)
      await settle(devices)

      const snapshot = (d: (typeof devices)[number]) =>
        [...d.files.files.keys()]
          .sort()
          .map((p) => p + '=' + d.files.text(p))
          .join('\n')
      expect(snapshot(devices[1]!)).toBe(snapshot(devices[0]!))
      expect(snapshot(devices[2]!)).toBe(snapshot(devices[0]!))
      expect(devices[0]!.files.files.size).toBeGreaterThan(0)
    },
  )
})

describe('vault grande', () => {
  const text = (value: string) => new TextEncoder().encode(value)

  it('envia muitos arquivos novos de uma vez e o outro aparelho recebe todos', async () => {
    const { devices } = await setup()
    const [mac, win] = devices
    for (let i = 0; i < 40; i++) await mac!.files.write(`Pasta/Nota ${i}.md`, text(`nota ${i}`))
    const report = await mac!.engine.syncUntilQuiet()
    expect(report.pushed).toBe(40)
    await win!.engine.syncUntilQuiet()
    const got = (await win!.files.list()).map((stat) => stat.path).sort()
    expect(got).toHaveLength(40)
    expect(new TextDecoder().decode(await win!.files.read('Pasta/Nota 7.md'))).toBe('nota 7')
  })

  it('para em vez de apagar tudo quando a pasta aparece vazia', async () => {
    const { server, devices } = await setup()
    const [mac, win] = devices
    for (let i = 0; i < 12; i++) await mac!.files.write(`n${i}.md`, text(String(i)))
    await settle(devices)
    for (let i = 0; i < 12; i++) await mac!.files.remove(`n${i}.md`)
    await expect(mac!.engine.sync()).rejects.toThrow(/vazia/)
    await win!.engine.syncUntilQuiet()
    expect(await win!.files.list()).toHaveLength(12)
    void server
  })

  /** Files the server has now, by id: the newest entry of each, not deleted. */
  const live = (server: MemoryServer) => {
    const latest = new Map<string, boolean>()
    for (const entry of server.log) latest.set(entry.fileId, entry.deleted)
    return [...latest.values()].filter((deleted) => !deleted).length
  }

  it('um envio que cai no meio não deixa o mesmo arquivo duas vezes no servidor', async () => {
    const server = new MemoryServer()
    const crypto = await VaultCrypto.create(await createVaultKey())
    const files = new MemoryFiles()
    const remote = server.remote('pc')
    let commits = 0
    const engine = new SyncEngine({
      files,
      store: new MemoryStore(),
      remote: {
        ...remote,
        commit: async (commit) => {
          if (++commits === 5) throw new Error('Failed to fetch')
          await new Promise((done) => setTimeout(done, 1))
          return remote.commit(commit)
        },
      },
      crypto,
      deviceName: 'pc',
    })
    for (let i = 0; i < 30; i++) await files.write(`n${i}.md`, text(String(i)))
    await expect(engine.sync()).rejects.toThrow(/fetch/)
    const after = commits
    await new Promise((done) => setTimeout(done, 20))
    // Nothing keeps sending once the pass is over.
    expect(commits).toBe(after)
    await engine.syncUntilQuiet()
    expect(live(server)).toBe(30)
  })

  it('apaga no servidor as cópias repetidas de um arquivo e deixa o arquivo', async () => {
    const { server, devices } = await setup()
    const [mac] = devices
    await mac!.files.write('a.md', text('oi'))
    await settle(devices)
    // What a version before 0.14.1 left: the same file sent again under new ids.
    const first = server.log[0]!
    const other = server.remote('mac')
    await other.commit({ fileId: 'copia-1', parent: null, meta: first.meta, deleted: false })
    await other.commit({ fileId: 'copia-2', parent: null, meta: first.meta, deleted: false })
    expect(live(server)).toBe(3)
    await settle(devices)
    expect(live(server)).toBe(1)
    for (const device of devices) {
      expect(new TextDecoder().decode(await device.files.read('a.md'))).toBe('oi')
      expect(await device.files.list()).toHaveLength(1)
    }
  })

  it('conta o progresso da rodada inteira, sem recomeçar nem diminuir o total', async () => {
    const server = new MemoryServer()
    const crypto = await VaultCrypto.create(await createVaultKey())
    const files = new MemoryFiles()
    const seen: { done: number; total: number }[] = []
    const engine = new SyncEngine({
      files,
      store: new MemoryStore(),
      remote: server.remote('pc'),
      crypto,
      deviceName: 'pc',
      onProgress: (p) => p.direction === 'upload' && seen.push({ done: p.done, total: p.total }),
    })
    for (let i = 0; i < 20; i++) await files.write(`n${i}.md`, text(String(i)))
    await engine.syncUntilQuiet()
    expect(seen.at(-1)).toEqual({ done: 20, total: 20 })
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.done).toBeGreaterThanOrEqual(seen[i - 1]!.done)
      expect(seen[i]!.total).toBeGreaterThanOrEqual(seen[i - 1]!.total)
    }
  })
})
