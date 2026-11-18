/**
 * `npm run release`: puts out the version in the code, built on this computer.
 *
 * The Windows installers and the phone's APK are compiled here, where the
 * caches are warm (a minute or two, against a quarter of an hour on GitHub's
 * machines). Only the Mac bundle goes to GitHub, since Windows cannot build
 * one: release.yml adds it to the same release and takes the release out of
 * draft. Until then the desktop update stays hidden, so no app is offered a
 * `latest.json` naming a file that does not exist yet. The phone's release is
 * public at once.
 *
 * Needs, on this computer: the updater key in ~/.tauri (docs/releases.md), the
 * Android keystore in apps/mobile/android/local.properties, and `gh` logged in.
 *
 *   npm run release              everything
 *   npm run release -- --only android
 *   npm run release -- --only desktop
 */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = join(root, 'apps', 'desktop')
const mobile = join(root, 'apps', 'mobile')
const android = join(mobile, 'android')
const windows = process.platform === 'win32'
const REPO = 'megomes/markdown-viewer'

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null
const doDesktop = only !== 'android'
const doAndroid = only !== 'desktop'

function fail(message) {
  console.error('\n' + message)
  process.exit(1)
}

function run(command, args, cwd = root, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    // npx and gradlew.bat need a shell on Windows; git and gh do not, and
    // without one, arguments with spaces (the notes) arrive whole.
    shell: windows && (command === 'npx' || command.endsWith('.bat')),
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) fail(`Parou em: ${command} ${args.join(' ')}`)
}

function out(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim()
}

function step(text) {
  console.log(`\n== ${text}`)
}

// ---- Before compiling anything: is this a version that can go out?

step('Conferindo')
const version = JSON.parse(
  readFileSync(join(desktop, 'src-tauri', 'tauri.conf.json'), 'utf8'),
).version
const mobileVersion = JSON.parse(readFileSync(join(mobile, 'app.json'), 'utf8')).expo.version
if (version !== mobileVersion)
  fail(`O tauri.conf.json diz ${version} e o app.json diz ${mobileVersion}.`)
const tag = `v${version}`

if (out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('Release só sai da main.')
if (out('git', ['status', '--porcelain'])) fail('Há mudanças sem commit. Commite antes de lançar.')
run('git', ['fetch', '--quiet', 'origin', 'main', '--tags'])
if (out('git', ['rev-list', '--count', 'HEAD..origin/main']) !== '0')
  fail('A main do GitHub tem commits que não estão aqui.')
const tagged = out('git', ['tag', '--list', tag])
if (doDesktop && tagged) fail(`A ${tag} já saiu. Suba a versão antes de lançar.`)
const sha = out('git', ['rev-parse', 'HEAD'])
const subject = out('git', ['log', '-1', '--format=%s'])
console.log(`Versão ${version}, commit ${sha.slice(0, 7)}: ${subject}`)

// The build number of the APK: minutes since 2026, the count `npm run phone`
// and android-release.yml use too, so it only grows, whoever builds.
const code = String(Math.floor((Date.now() / 1000 - 1767225600) / 60))

// ---- Compile both before publishing anything: a failure leaves no half release.

let apk = null
if (doAndroid) {
  step(`Compilando o APK (build ${code})`)
  const props = join(android, 'local.properties')
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', '--no-clean'], mobile)
  if (!existsSync(props) || !readFileSync(props, 'utf8').includes('release.keystore')) {
    fail('Falta a chave em apps/mobile/android/local.properties (release.keystore e a senha).')
  }
  // The S25 Ultra and the Tab S10 FE are both arm64.
  run(
    join(android, windows ? 'gradlew.bat' : 'gradlew'),
    [
      'assembleRelease',
      // The web pages of the app (the note, the Base) are bundled by this task,
      // and Gradle does not count their CSS as its input: a change to a CSS
      // file alone shipped the old one. Always run it.
      'createBundleReleaseJsAndAssets',
      '--rerun',
      '-PreactNativeArchitectures=arm64-v8a',
      '--build-cache',
      '-x',
      'lintVitalRelease',
    ],
    android,
    { VERSION_CODE: code },
  )
  // An APK whose number did not take never installs over the one on the
  // phone ("App não instalado"): checked here, before anything goes out.
  const built = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  const tools = join(process.env.ANDROID_HOME ?? join(homedir(), 'Android', 'Sdk'), 'build-tools')
  const aapt = join(tools, readdirSync(tools).sort().at(-1), windows ? 'aapt2.exe' : 'aapt2')
  const badging = execFileSync(aapt, ['dump', 'badging', built], { encoding: 'utf8' })
  const numbered = /versionCode='(\d+)'/.exec(badging)?.[1]
  if (numbered !== code)
    fail(`O APK saiu com o número ${numbered}, e não ${code}. Nada foi publicado.`)
  apk = join(tmpdir(), `markdown-viewer-${code}.apk`)
  copyFileSync(built, apk)
}

const windowsFiles = []
let latest = null
if (doDesktop) {
  if (!windows)
    fail('O pacote de desktop daqui é o do Windows; rode num Windows, ou use --only android.')
  step('Compilando o desktop para Windows')
  const keyDir = join(homedir(), '.tauri')
  const key = join(keyDir, 'markdown-viewer.key')
  const password = join(keyDir, 'markdown-viewer.key.password')
  if (!existsSync(key) || !existsSync(password))
    fail(`Falta a chave do atualizador em ${keyDir} (docs/releases.md).`)
  if (!existsSync(join(desktop, '.env.local')))
    fail('Falta apps/desktop/.env.local com os servidores (.env.example).')
  run('npx', ['tauri', 'build', '--bundles', 'nsis,msi'], desktop, {
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8').trim(),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: readFileSync(password, 'utf8').trim(),
  })

  const bundle = join(desktop, 'src-tauri', 'target', 'release', 'bundle')
  const find = (folder, ending) => {
    const name = readdirSync(join(bundle, folder)).find(
      (file) => file.includes(`_${version}_`) && file.endsWith(ending),
    )
    if (!name) fail(`Não achei o ${ending} da ${version} em ${join(bundle, folder)}.`)
    return join(bundle, folder, name)
  }
  const nsis = find('nsis', '-setup.exe')
  const msi = find('msi', '.msi')
  windowsFiles.push(nsis, nsis + '.sig', msi, msi + '.sig')

  // The same entries tauri-action writes; the Mac job adds its own to this file.
  const entry = (file) => ({
    signature: readFileSync(file + '.sig', 'utf8').trim(),
    url: `https://github.com/${REPO}/releases/download/${tag}/${file.split(/[\\/]/).pop().replaceAll(' ', '.')}`,
  })
  const dir = join(tmpdir(), `markdown-viewer-${version}`)
  mkdirSync(dir, { recursive: true })
  latest = join(dir, 'latest.json')
  writeFileSync(
    latest,
    JSON.stringify(
      {
        version,
        notes: 'Baixe abaixo o pacote do seu sistema.',
        pub_date: new Date().toISOString(),
        platforms: {
          'windows-x86_64': entry(msi),
          'windows-x86_64-msi': entry(msi),
          'windows-x86_64-nsis': entry(nsis),
        },
      },
      null,
      2,
    ),
  )
}

// ---- Publish.

if (doAndroid) {
  step('Publicando o APK')
  // Never "latest": that is the desktop's, whose updater reads releases/latest.
  run('gh', [
    'release',
    'create',
    `android-v${version}-${code}`,
    apk,
    '--repo',
    REPO,
    '--target',
    sha,
    '--title',
    `Android ${version} (${code})`,
    '--notes',
    subject,
    '--latest=false',
  ])
}

if (doDesktop) {
  step(`Marcando a ${tag} e subindo o Windows`)
  run('git', ['tag', tag, sha])
  run('git', ['push', 'origin', tag])
  run('gh', [
    'release',
    'create',
    tag,
    ...windowsFiles,
    latest,
    '--repo',
    REPO,
    '--verify-tag',
    '--draft',
    '--title',
    `Markdown Viewer ${version}`,
    '--notes',
    'Baixe abaixo o pacote do seu sistema.',
  ])
  step('Pedindo o pacote do Mac ao GitHub')
  run('gh', ['workflow', 'run', 'release.yml', '--repo', REPO, '--ref', 'main', '-f', `tag=${tag}`])
  console.log(
    `\nO APK já está no ar. O desktop sai do rascunho quando o Mac terminar:\n` +
      `  gh run watch --repo ${REPO} $(gh run list --repo ${REPO} --workflow release.yml -L 1 --json databaseId -q ".[0].databaseId")`,
  )
} else if (doAndroid) {
  console.log('\nPronto: o APK está no ar.')
}
