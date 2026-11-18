/**
 * The Mac bundle, built on Matheus's own Mac over SSH (the `mac` host in
 * ~/.ssh/config), so a release does not wait for GitHub's macOS machines.
 *
 * The code goes over as `git archive` of the exact commit being released, into
 * a build folder of its own on the Mac (~/.markdown-viewer-release), so the Mac
 * needs no access to GitHub and none of its own clones is touched. That folder
 * keeps node_modules and Cargo's target between releases, which is what keeps
 * a build to a couple of minutes.
 *
 * Needs on the Mac: Node and Rust in a login shell, the Xcode command line
 * tools, and the same updater key as this computer in ~/.tauri.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const CONFIG = join(homedir(), '.markdown-viewer', 'release.json')
const BUILD = '.markdown-viewer-release'

/** The SSH host of the Mac: `mac`, or `macHost` in ~/.markdown-viewer/release.json. */
export function macHost() {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8')).macHost ?? 'mac'
  } catch {
    return 'mac'
  }
}

/** Whether the Mac answers over SSH right now, without asking for anything. */
export function macReachable(host = macHost()) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', host, 'true'], {
    stdio: 'ignore',
  })
  return result.status === 0
}

function ssh(host, script, label) {
  // The script goes in on stdin to a login shell: Homebrew's Node and rustup's
  // Cargo are on the PATH there, and nothing has to be quoted twice.
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', host, 'zsh -l -s'], {
    input: script,
    stdio: ['pipe', 'inherit', 'inherit'],
    maxBuffer: 1 << 30,
  })
  if (result.status !== 0) throw new Error(`No Mac, parou em: ${label}`)
}

function scp(from, to) {
  const result = spawnSync('scp', ['-q', '-o', 'BatchMode=yes', from, to], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Não deu para copiar ${from} para ${to}.`)
}

/**
 * Builds the Mac bundle of `sha` and brings it here. Resolves to the paths of
 * the files to publish, named as the releases have always named them.
 */
export function buildOnMac({ root, sha, version, host = macHost() }) {
  console.log(`\n== Compilando o desktop para Mac em ${host}`)
  const archive = execFileSync('git', ['archive', '--format=tar', sha], {
    cwd: root,
    maxBuffer: 1 << 30,
  })
  const sent = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', host, `mkdir -p ~/${BUILD} && tar -x -C ~/${BUILD}`],
    { input: archive, stdio: ['pipe', 'inherit', 'inherit'], maxBuffer: 1 << 30 },
  )
  if (sent.status !== 0) throw new Error('Não deu para mandar o código para o Mac.')
  const envLocal = join(root, 'apps', 'desktop', '.env.local')
  if (!existsSync(envLocal)) throw new Error('Falta apps/desktop/.env.local com os servidores.')
  scp(envLocal, `${host}:${BUILD}/apps/desktop/.env.local`)

  const bundle = `~/${BUILD}/apps/desktop/src-tauri/target/release/bundle`
  ssh(
    host,
    `set -e
cd ~/${BUILD}
npm install --no-audit --no-fund --loglevel=error
cd apps/desktop
# Bundles from an earlier version are cleared, so the one found below is this one.
rm -rf ${bundle}/dmg ${bundle}/macos
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/markdown-viewer.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(tr -d '\\r\\n' < ~/.tauri/markdown-viewer.key.password)"
# Ad hoc signature, as release.yml did: not Apple's notarisation.
export APPLE_SIGNING_IDENTITY=-
npx tauri build --bundles app,dmg
`,
    'tauri build',
  )

  const out = join(tmpdir(), `markdown-viewer-${version}-mac`)
  mkdirSync(out, { recursive: true })
  const found = execFileSync(
    'ssh',
    ['-o', 'BatchMode=yes', host, `ls ${bundle}/dmg/*.dmg ${bundle}/macos/*.app.tar.gz`],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
  const dmgRemote = found.find((path) => path.endsWith('.dmg'))
  const tarRemote = found.find((path) => path.endsWith('.app.tar.gz'))
  if (!dmgRemote || !tarRemote) throw new Error('O Mac terminou sem o .dmg ou o .app.tar.gz.')

  const dmg = join(out, `markdown-viewer_${version}_aarch64.dmg`)
  const tar = join(out, 'markdown-viewer_aarch64.app.tar.gz')
  scp(`${host}:${dmgRemote}`, dmg)
  scp(`${host}:${tarRemote}`, tar)
  scp(`${host}:${tarRemote}.sig`, tar + '.sig')
  return { dmg, tar, sig: tar + '.sig' }
}

/** The Mac's entries in latest.json, the same ones tauri-action wrote. */
export function macEntries({ repo, tag, tar }) {
  const entry = {
    signature: readFileSync(tar + '.sig', 'utf8').trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/markdown-viewer_aarch64.app.tar.gz`,
  }
  return { 'darwin-aarch64': entry, 'darwin-aarch64-app': entry }
}
