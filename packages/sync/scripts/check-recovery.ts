/**
 * The recovery code, end to end against a real server (wrangler dev): a vault is
 * created, its password and recovery code are checked, the recovery code is
 * replaced, and a new device comes in with the new one.
 *
 *   npx tsx packages/sync/scripts/check-recovery.ts --server http://localhost:8788 --setup-code …
 *
 * It creates a vault with a random name. Run it against a local server only.
 */

import {
  createVault,
  joinVault,
  opensVault,
  renewRecoveryCode,
  requireServer,
} from '../src/http-remote'

function flag(name: string): string | undefined {
  const at = process.argv.indexOf('--' + name)
  return at > 0 ? process.argv[at + 1] : undefined
}

const server = requireServer(flag('server'))
const setupCode = flag('setup-code')
if (!setupCode) throw new Error('Falta --setup-code.')
if (!/localhost|127\.0\.0\.1/.test(server)) throw new Error('Só contra um servidor local.')

let failed = 0
function expect(what: string, got: unknown, want: unknown): void {
  const ok = got === want
  if (!ok) failed++
  console.log((ok ? 'ok   ' : 'FALHA') + ' ' + what + (ok ? '' : ` (veio ${String(got)})`))
}

const vault = 'recuperacao-' + Math.random().toString(36).slice(2, 10)
const password = 'uma senha comprida'
const created = await createVault({ server, vault, setupCode, password, deviceName: 'primeiro' })
const { connection, key } = created
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i])

expect('a senha certa abre', await opensVault(connection, key, 'password', password), true)
expect('a senha errada não abre', await opensVault(connection, key, 'password', 'outra'), false)
expect(
  'o código de recuperação abre',
  await opensVault(connection, key, 'recovery', created.recoveryCode),
  true,
)
expect(
  'digitado em minúsculas e sem traços, abre',
  await opensVault(
    connection,
    key,
    'recovery',
    created.recoveryCode.toLowerCase().replaceAll('-', ' '),
  ),
  true,
)

const renewed = await renewRecoveryCode(connection, key)
expect('o código novo é outro', renewed !== created.recoveryCode, true)
expect('o código novo abre', await opensVault(connection, key, 'recovery', renewed), true)
expect(
  'o código antigo não abre mais',
  await opensVault(connection, key, 'recovery', created.recoveryCode),
  false,
)
expect('a senha continua abrindo', await opensVault(connection, key, 'password', password), true)

const byRecovery = await joinVault({
  server,
  vault,
  secret: setupCode,
  deviceName: 'segundo',
  recoveryCode: renewed,
})
expect('aparelho novo entra com o código novo', same(byRecovery.key, key), true)
const byPassword = await joinVault({
  server,
  vault,
  secret: setupCode,
  deviceName: 'terceiro',
  password,
})
expect('aparelho novo entra com a senha', same(byPassword.key, key), true)
let refused = false
try {
  await joinVault({
    server,
    vault,
    secret: setupCode,
    deviceName: 'quarto',
    recoveryCode: created.recoveryCode,
  })
} catch {
  refused = true
}
expect('aparelho novo não entra com o código antigo', refused, true)

const bad = await fetch(`${server}/v/${vault}/keys/recovery`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ alg: 'x', salt: 'x', nonce: 'x', cipher: 'x' }),
})
expect('sem aparelho autenticado, o servidor recusa trocar', bad.status, 401)
expect(
  'e o código novo segue valendo',
  await opensVault(connection, key, 'recovery', renewed),
  true,
)

console.log(failed ? `\n${failed} falharam` : '\ntudo certo, vault ' + vault)
process.exit(failed ? 1 : 0)
