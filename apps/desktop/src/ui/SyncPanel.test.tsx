// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SyncView } from '~/app/sync'

const state = vi.hoisted(() => ({
  view: null as unknown as SyncView,
  checkSecret: vi.fn(),
  newRecoveryCode: vi.fn(),
  forgetRecoveryCode: vi.fn(),
  startSync: vi.fn(),
  setUpVault: vi.fn(),
  joinExistingVault: vi.fn(),
}))

vi.mock('~/app/sync', () => ({
  useSync: () => state.view,
  syncAvailable: () => true,
  checkSecret: state.checkSecret,
  newRecoveryCode: state.newRecoveryCode,
  forgetRecoveryCode: state.forgetRecoveryCode,
  startSync: state.startSync,
  setUpVault: state.setUpVault,
  joinExistingVault: state.joinExistingVault,
  devices: vi.fn(),
  leaveVault: vi.fn(),
  pairNewDevice: vi.fn(),
  restoreVersion: vi.fn(),
  revoke: vi.fn(),
  syncNow: vi.fn(),
  versionsOf: vi.fn(),
}))
vi.mock('~/platform/sync-tauri', () => ({
  pickFolder: vi.fn(),
  readSetupCode: () => Promise.resolve('codigo-do-servidor-com-mais-de-vinte'),
}))
vi.mock('~/platform', () => ({ fileSystem: () => ({ absolutePath: () => null }) }))
vi.mock('~/app/spaces', () => ({ getVault: () => 'C:/notas' }))

const { SyncPanel } = await import('./SyncPanel')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const config = {
  server: 'https://sync.exemplo.dev',
  vault: 'principal',
  baseId: 'C:/notas',
  folder: 'C:/notas',
  deviceName: 'windows',
}
const idle: SyncView = {
  status: 'idle',
  config,
  lastSync: null,
  message: null,
  events: [],
  recovery: null,
  download: null,
  upload: null,
}

let root: Root | null = null
const text = () => document.body.textContent ?? ''
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!
const settle = () => act(() => new Promise<void>((done) => setTimeout(done, 0)))

async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(<SyncPanel bases={[]} activePath={null} onVault={() => {}} onClose={() => {}} />),
  )
  await settle()
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  state.forgetRecoveryCode.mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('o código de recuperação', () => {
  // The vault existing is what used to hide it: the form that held the code
  // was replaced by the panel of a configured sync before it was ever drawn.
  it('aparece logo depois de criar o vault, com o sync já configurado', async () => {
    state.view = { ...idle, recovery: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH' }
    await mount()
    expect(text()).toContain('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH')
    expect(text()).not.toContain('Sincronizar agora')
  })

  it('some só quando a pessoa diz que guardou, e aí o sync liga', async () => {
    state.view = { ...idle, recovery: 'AAAAA-BBBBB' }
    await mount()
    act(() => button('Guardei o código').click())
    await settle()
    expect(state.forgetRecoveryCode).toHaveBeenCalledOnce()
    expect(state.startSync).toHaveBeenCalledOnce()
  })
})

describe('backup e recuperação', () => {
  beforeEach(() => {
    state.view = idle
  })

  it('mostra as barras de download e upload enquanto uma passada anda', async () => {
    state.view = {
      ...idle,
      status: 'syncing',
      download: {
        direction: 'download',
        done: 3,
        total: 12,
        bytesDone: 0,
        bytesTotal: 0,
        path: 'a.md',
      },
      upload: {
        direction: 'upload',
        done: 1,
        total: 4,
        bytesDone: 5 * 1024 * 1024,
        bytesTotal: 20 * 1024 * 1024,
        path: 'Files/video.mp4',
      },
    }
    await mount()
    expect(text()).toContain('Baixando 3 de 12')
    expect(text()).toContain('Enviando 1 de 4 · 5,0 MB de 20 MB')
    expect(text()).toContain('25%')
    expect(document.querySelectorAll('[role=progressbar]')).toHaveLength(2)
  })

  it('avisa enquanto as chaves não foram guardadas', async () => {
    await mount()
    expect(text()).toContain('ainda não confirmou que guardou as chaves')
  })

  it('mostra o servidor e o vault, e esconde o código de configuração até pedirem', async () => {
    await mount()
    act(() => button('Backup e recuperação').click())
    await settle()
    expect(text()).toContain('https://sync.exemplo.dev')
    expect(text()).toContain('principal')
    expect(text()).not.toContain('codigo-do-servidor-com-mais-de-vinte')
    act(() => button('Mostrar').click())
    expect(text()).toContain('codigo-do-servidor-com-mais-de-vinte')
    expect(text()).toContain('Como recuperar')
  })

  it('confere a senha contra o vault', async () => {
    state.checkSecret.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await mount()
    act(() => button('Backup e recuperação').click())
    await settle()
    const input = document.querySelector<HTMLInputElement>('.sync-backup input[type=password]')!
    await type(input, 'errada')
    act(() => button('Conferir').click())
    await settle()
    expect(state.checkSecret).toHaveBeenCalledWith('password', 'errada')
    expect(text()).toContain('Não abre este vault')
    await type(input, 'a certa')
    act(() => button('Conferir').click())
    await settle()
    expect(text()).toContain('Confere: abre este vault')
  })

  it('só gera um código novo depois de confirmar que o antigo deixa de valer', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    state.newRecoveryCode.mockResolvedValue('NOVO')
    await mount()
    act(() => button('Backup e recuperação').click())
    await settle()
    act(() => button('Gerar um código novo').click())
    expect(state.newRecoveryCode).not.toHaveBeenCalled()
    act(() => button('Gerar um código novo').click())
    await settle()
    expect(state.newRecoveryCode).toHaveBeenCalledOnce()
    confirm.mockRestore()
  })

  it('para de avisar depois de marcado como guardado, e lembra disso', async () => {
    await mount()
    act(() => button('Backup e recuperação').click())
    await settle()
    act(() => document.querySelector<HTMLInputElement>('.sync-check input')!.click())
    act(() => button('Backup e recuperação').click())
    expect(text()).not.toContain('ainda não confirmou')
    expect(localStorage.getItem('markdown-viewer.sync.backup-saved:principal')).toBe('1')
  })
})

describe('entrar num vault sem outro aparelho', () => {
  it('aceita o código de recuperação no lugar da senha', async () => {
    state.view = { ...idle, config: null }
    state.joinExistingVault.mockResolvedValue(undefined)
    await mount()
    const fields = () => [...document.querySelectorAll<HTMLInputElement>('.sync-field input')]
    // Vault, device, code.
    await type(fields()[2]!, 'codigo-do-servidor-com-mais-de-vinte')
    act(() => button('Esqueci a senha').click())
    await type(fields()[3]!, 'aaaaa bbbbb')
    act(() => document.querySelector<HTMLButtonElement>('.sync-primary')!.click())
    await settle()
    expect(state.joinExistingVault).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: 'codigo-do-servidor-com-mais-de-vinte',
        recoveryCode: 'aaaaa bbbbb',
      }),
    )
    expect(state.joinExistingVault.mock.calls[0]![0]).not.toHaveProperty('password')
  })
})
