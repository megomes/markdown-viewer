/**
 * `npm run phone`: builds the release APK on this computer and installs it on
 * the phone plugged in (USB or wireless debugging), without GitHub.
 *
 * It is signed with the same key as the APKs of the releases, so it installs
 * over the one on the phone and keeps its vault. Its build number is the
 * minutes since 2026, the count the release workflow uses too: the next release
 * still comes in as an update on top of it.
 *
 * With more than one device connected, name one: `npm run phone -- <serial>`
 * (as `adb devices` lists it).
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobile = join(dirname(fileURLToPath(import.meta.url)), '..')
const android = join(mobile, 'android')
const windows = process.platform === 'win32'

function fail(message) {
  console.error('\n' + message)
  process.exit(1)
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: windows,
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) fail(`Parou em: ${command} ${args.join(' ')}`)
}

function adb(serial, ...args) {
  return execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
}

// Which device, before the minutes of compiling.
let devices
try {
  devices = execFileSync('adb', ['devices'], { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
} catch {
  fail('Não achei o adb. Ele vem com o Android SDK (platform-tools) e precisa estar no PATH.')
}
const wanted = process.argv[2]
const serial = wanted ?? (devices.length === 1 ? devices[0] : null)
if (!serial || !devices.includes(serial)) {
  fail(
    devices.length === 0
      ? 'Nenhum aparelho conectado. Ligue o celular no cabo, ou pareie pela depuração sem fio\n' +
          '(Opções do desenvolvedor > Depuração sem fio > Parear com código: adb pair IP:PORTA,\n' +
          'depois adb connect IP:PORTA).'
      : `Escolha um aparelho: npm run phone -- <serial>\n  ${devices.join('\n  ')}`,
  )
}
const abi = adb(serial, 'shell', 'getprop', 'ro.product.cpu.abi')

const props = join(android, 'local.properties')
// Brings the native project up to date with app.json and the plugins, in
// place: recreating it would throw away the compiled native code that makes
// the next build quick, and local.properties with the signing key.
run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', '--no-clean'], mobile)
if (!existsSync(props) || !readFileSync(props, 'utf8').includes('release.keystore')) {
  fail(
    'Falta a chave em android/local.properties (release.keystore e release.password ou\n' +
      'release.passwordFile). Sem ela o APK sai com a chave de debug e não instala por cima.',
  )
}

const code = String(Math.floor((Date.now() / 1000 - 1767225600) / 60))
console.log(`Compilando o build ${code} para ${abi} (${serial})...`)
run(
  join(android, windows ? 'gradlew.bat' : 'gradlew'),
  [
    'assembleRelease',
    `-PreactNativeArchitectures=${abi}`,
    '--build-cache',
    '-x',
    'lintVitalRelease',
  ],
  android,
  { VERSION_CODE: code },
)

const apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
console.log('Instalando...')
run('adb', ['-s', serial, 'install', '-r', apk], mobile)
console.log(`Pronto: build ${code} instalado em ${serial}.`)
