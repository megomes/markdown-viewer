/**
 * Spaces: the vault, other folders opened on their own, and "Arquivos", the files
 * opened from outside any folder. Each has its own tree and its own tabs, and
 * switching spaces brings back the tabs that were open there.
 *
 * The vault is one folder, chosen once (it is also the folder the sync carries).
 * Search, quick open, Bases and links look only at the space in use.
 *
 * An environment (`app/environments.ts`) is a space too: a folder at the root of
 * the vault, with the vault's base and its own tabs. The vault's own space is
 * then the whole of it, and holds the tabs that are in no environment.
 */

import { useSyncExternalStore } from 'react'
import type { Base } from '@markdown-viewer/core/fs'
import { isDraft } from './drafts'
import { environmentOfPath } from './environments'
import type { Tab } from './store'

export type SpaceId = 'vault' | 'files' | `folder:${string}` | `env:${string}`

export interface Space {
  id: SpaceId
  kind: 'vault' | 'env' | 'folder' | 'files'
  /** The base it shows: the vault's or the folder's. None for "Arquivos". */
  baseId: string | null
  /** The folder of the base its tree starts at: an environment's own, '' otherwise. */
  root: string
  name: string
  /** Shown on hover: the folder on disk. */
  label: string
}

const VAULT_KEY = 'markdown-viewer.vault'
const listeners = new Set<() => void>()
let vaultFolder: string | null = read()

function read(): string | null {
  try {
    return localStorage.getItem(VAULT_KEY)
  } catch {
    return null
  }
}

/** The vault's base id: on the desktop a base is known by its folder's path. */
export function getVault(): string | null {
  return vaultFolder
}

export function setVault(baseId: string | null): void {
  vaultFolder = baseId
  try {
    if (baseId) localStorage.setItem(VAULT_KEY, baseId)
    else localStorage.removeItem(VAULT_KEY)
  } catch {
    // storage blocked
  }
  for (const listener of listeners) listener()
}

export function useVault(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => vaultFolder,
  )
}

/** Which space a tab lives in. Drafts belong to the vault, where they will be saved. */
export function spaceOfTab(tab: Tab, vault: string | null, environments: string[] = []): SpaceId {
  if (isDraft(tab)) return 'vault'
  if (tab.path === '') return 'files'
  if (vault && tab.baseId === vault) {
    const environment = environmentOfPath(tab.path, environments)
    return environment ? `env:${environment}` : 'vault'
  }
  return `folder:${tab.baseId}`
}

/** Whether a space is the vault or a part of it. */
export function inVault(space: Space): boolean {
  return space.kind === 'vault' || space.kind === 'env'
}

export function spacesOf(
  bases: Base[],
  tabs: Tab[],
  vault: string | null,
  environments: string[] = [],
): Space[] {
  const vaultBase = bases.find((base) => base.id === vault)
  const spaces: Space[] = [
    {
      id: 'vault',
      kind: 'vault',
      baseId: vaultBase?.id ?? null,
      name: vaultBase?.name ?? 'Vault',
      label: vaultBase?.label ?? 'Escolha a pasta do vault',
      root: '',
    },
  ]
  if (vaultBase) {
    for (const folder of environments) {
      spaces.push({
        id: `env:${folder}`,
        kind: 'env',
        baseId: vaultBase.id,
        name: folder,
        label: vaultBase.label + '/' + folder,
        root: folder,
      })
    }
  }
  for (const base of bases) {
    if (base.id === vault) continue
    spaces.push({
      id: `folder:${base.id}`,
      kind: 'folder',
      baseId: base.id,
      name: base.name,
      label: base.label,
      root: '',
    })
  }
  if (tabs.some((tab) => tab.path === '' && !isDraft(tab))) {
    spaces.push({
      id: 'files',
      kind: 'files',
      baseId: null,
      name: 'Arquivos',
      label: 'Arquivos abertos de fora do vault',
      root: '',
    })
  }
  return spaces
}
