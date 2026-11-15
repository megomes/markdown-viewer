/**
 * Metro, with two redirections that let the phone reuse code written for the
 * desktop instead of keeping a copy of it:
 *
 * - The note reader (a DOM component) imports the desktop's CodeMirror setup,
 *   which speaks of `~/…`. `~/platform` becomes the phone's file access; the
 *   rest is the desktop's own source.
 * - `@markdown-viewer/crypto` imports libsodium as `libsodium-wrappers-sumo`, a
 *   WebAssembly build that Hermes cannot run. On the phone it is the native
 *   libsodium, the same functions under the same names.
 */

const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const desktopSrc = path.resolve(__dirname, '../desktop/src')
const platformShim = path.resolve(__dirname, 'src/dom/platform.ts')
const nativeSodium = path.resolve(__dirname, 'src/vault/sodium.ts')

const upstream = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'libsodium-wrappers-sumo' && platform !== 'web') {
    return { type: 'sourceFile', filePath: nativeSodium }
  }
  if (moduleName === '~/platform') return { type: 'sourceFile', filePath: platformShim }
  if (moduleName.startsWith('~/')) {
    return context.resolveRequest(context, path.join(desktopSrc, moduleName.slice(2)), platform)
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = config
