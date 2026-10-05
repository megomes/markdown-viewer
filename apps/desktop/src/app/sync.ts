/**
 * The sync, as the rest of the app sees it: the state is always at hand, the
 * engine (libsodium included) is loaded the first time something needs it.
 */

export {
  syncAvailable,
  useSync,
  type SyncConfig,
  type SyncStatus,
  type SyncView,
} from './sync-state'
export type { Version } from './sync-runtime'

const runtime = () => import('./sync-runtime')

export const startSync = () => runtime().then((m) => m.startSync())
export const stopSync = () => runtime().then((m) => m.stopSync())
export const syncNow = () => runtime().then((m) => m.syncNow())
export const nudgeSync = (delay?: number) => runtime().then((m) => m.nudgeSync(delay))
export const setUpVault = (o: Parameters<typeof import('./sync-runtime').setUpVault>[0]) =>
  runtime().then((m) => m.setUpVault(o))
export const joinExistingVault = (
  o: Parameters<typeof import('./sync-runtime').joinExistingVault>[0],
) => runtime().then((m) => m.joinExistingVault(o))
export const leaveVault = () => runtime().then((m) => m.leaveVault())
export const pairNewDevice = () => runtime().then((m) => m.pairNewDevice())
export const devices = () => runtime().then((m) => m.devices())
export const revoke = (id: string) => runtime().then((m) => m.revoke(id))
export const versionsOf = (path: string) => runtime().then((m) => m.versionsOf(path))
export const restoreVersion = (v: import('./sync-runtime').Version) =>
  runtime().then((m) => m.restoreVersion(v))
