/**
 * The filesystem plugin's functions, with dot names let in as they come.
 *
 * On macOS and Linux the plugin's scope does not reach a name that starts with
 * a dot, even inside a folder the person opened, and a vault has them at any
 * depth (`.markdown-viewer`, `Notas/.claude/skills`), some arriving later with
 * the sync. A call refused with "forbidden path" asks the app to let that path
 * in (`allow_inside`, which only does so inside an opened folder) and is tried
 * once more. On Windows nothing is ever refused this way, and nothing changes.
 */

import { invoke } from '@tauri-apps/api/core'
import * as fs from '@tauri-apps/plugin-fs'

function refused(error: unknown): boolean {
  return /forbidden path/i.test(error instanceof Error ? error.message : String(error))
}

async function letIn<T>(paths: (string | URL)[], work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (!refused(error)) throw error
    for (const path of paths) await invoke('allow_inside', { path: String(path) })
    return work()
  }
}

export const readFile: typeof fs.readFile = (path, options) =>
  letIn([path], () => fs.readFile(path, options))
export const writeFile: typeof fs.writeFile = (path, data, options) =>
  letIn([path], () => fs.writeFile(path, data, options))
export const writeTextFile: typeof fs.writeTextFile = (path, data, options) =>
  letIn([path], () => fs.writeTextFile(path, data, options))
export const mkdir: typeof fs.mkdir = (path, options) =>
  letIn([path], () => fs.mkdir(path, options))
export const readDir: typeof fs.readDir = (path, options) =>
  letIn([path], () => fs.readDir(path, options))
export const stat: typeof fs.stat = (path, options) => letIn([path], () => fs.stat(path, options))
export const remove: typeof fs.remove = (path, options) =>
  letIn([path], () => fs.remove(path, options))
export const rename: typeof fs.rename = (from, to, options) =>
  letIn([from, to], () => fs.rename(from, to, options))
export const copyFile: typeof fs.copyFile = (from, to, options) =>
  letIn([from, to], () => fs.copyFile(from, to, options))
export const watch: typeof fs.watch = (paths, callback, options) =>
  letIn(Array.isArray(paths) ? paths : [paths], () => fs.watch(paths, callback, options))
