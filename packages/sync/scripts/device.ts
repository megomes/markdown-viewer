/**
 * Um aparelho de sync na linha de comando, para testar com cópias do vault.
 *
 *   npm run sync:device -- create <pasta> <vault> --name mac --password "..."
 *   npm run sync:device -- pair <pasta>                 mostra um código de pareamento
 *   npm run sync:device -- join <pasta> <vault> <código> --name win
 *   npm run sync:device -- sync <pasta>                 uma passada
 *   npm run sync:device -- watch <pasta>                passadas a cada aviso do servidor
 *
 * O estado fica em <pasta>.sync/ (fora da pasta). A chave do vault fica nesse
 * estado em claro: isto é ferramenta de teste, não o app.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { SyncEngine } from '../src/engine'
import {
  createVault,
  requireServer,
  httpRemote,
  joinVault,
  listen,
  startPairing,
  type Connection,
} from '../src/http-remote'
import { FileStore, NodeFiles } from '../src/node-device'

const [command, folder, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const at = rest.indexOf('--' + name)
  return at >= 0 ? rest[at + 1] : undefined
}
if (!command || !folder) {
  console.log('uso: create|pair|join|sync|watch <pasta> …')
  process.exit(1)
}
const stateDir = folder.replace(/[\\/]+$/, '') + '.sync'
const server = requireServer(flag('server') ?? process.env.MARKDOWN_VIEWER_SYNC_URL)

interface Saved {
  connection: Connection
  key: string
  name: string
}

async function save(saved: Saved) {
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, 'device.json'), JSON.stringify(saved, null, 2))
}

async function load(): Promise<Saved> {
  return JSON.parse(await readFile(join(stateDir, 'device.json'), 'utf8')) as Saved
}

async function engine(saved: Saved) {
  const crypto = await VaultCrypto.create(Buffer.from(saved.key, 'base64'))
  return new SyncEngine({
    files: new NodeFiles(folder!, join(stateDir, 'trash')),
    store: new FileStore(stateDir),
    remote: httpRemote(saved.connection),
    crypto,
    deviceName: saved.name,
  })
}

async function pass(saved: Saved) {
  const started = Date.now()
  const report = await (await engine(saved)).syncUntilQuiet()
  console.log(
    `[${saved.name}] ${report.pulled} recebidos, ${report.pushed} enviados em ${Date.now() - started} ms` +
      (report.events.some((e) => e.kind === 'conflict' || e.kind === 'merged')
        ? ': ' +
          report.events
            .filter((e) => e.kind === 'conflict' || e.kind === 'merged')
            .map((e) => `${e.kind} ${e.path}`)
            .join(', ')
        : ''),
  )
}

if (command === 'create') {
  const vault = rest[0]!
  const setupCode = (
    await readFile(join(homedir(), '.markdown-viewer', 'sync-setup-code.txt'), 'utf8')
  ).trim()
  const { connection, key, recoveryCode } = await createVault({
    server,
    vault,
    setupCode,
    password: flag('password') ?? 'senha de teste',
    deviceName: flag('name') ?? 'cli',
  })
  await save({ connection, key: Buffer.from(key).toString('base64'), name: flag('name') ?? 'cli' })
  console.log('vault criado. código de recuperação:', recoveryCode)
} else if (command === 'pair') {
  const saved = await load()
  const { code } = await startPairing(saved.connection, Buffer.from(saved.key, 'base64'))
  console.log(code)
} else if (command === 'join') {
  const [vault, secret] = rest
  const { connection, key } = await joinVault({
    server,
    vault: vault!,
    secret: secret!,
    deviceName: flag('name') ?? 'cli',
    password: flag('password'),
  })
  await save({ connection, key: Buffer.from(key).toString('base64'), name: flag('name') ?? 'cli' })
  console.log('entrou no vault', vault)
} else if (command === 'sync') {
  await pass(await load())
} else if (command === 'watch') {
  const saved = await load()
  await pass(saved)
  let busy = false
  listen(saved.connection, () => {
    if (busy) return
    busy = true
    void pass(saved).finally(() => (busy = false))
  })
  setInterval(() => void pass(saved), 30_000)
}
