/**
 * The sync, from the person's side: create the vault or join it, see that it is
 * working, pair another device, revoke one, and bring back an old version of the
 * file that is open.
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { Base } from '@markdown-viewer/core/fs'
import { fileSystem } from '~/platform'
import {
  devices,
  joinExistingVault,
  leaveVault,
  pairNewDevice,
  restoreVersion,
  revoke,
  setUpVault,
  startSync,
  syncAvailable,
  syncNow,
  useSync,
  versionsOf,
  type Version,
} from '~/app/sync'
import { onApple } from './shortcuts'
import { pickFolder, readSetupCode } from '~/platform/sync-tauri'

interface Props {
  bases: Base[]
  activePath: { baseId: string; path: string } | null
  onClose: () => void
}

function ago(at: number | null): string {
  if (!at) return 'ainda não'
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 60) return 'agora há pouco'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `há ${minutes} min`
  return new Date(at).toLocaleString('pt-BR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const EVENT_LABEL: Record<string, string> = {
  pulled: 'recebido',
  pushed: 'enviado',
  merged: 'juntado',
  conflict: 'conflito',
  deleted: 'apagado',
  moved: 'movido',
}

export function SyncPanel({ bases, activePath, onClose }: Props) {
  const sync = useSync()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="sync-panel"
        role="dialog"
        aria-label="Sincronização"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sync-head">
          <h2>Sincronização</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        {!syncAvailable() ? (
          <p className="sync-note">
            O sync roda no app de desktop. Aqui no navegador não há como chegar à pasta.
          </p>
        ) : sync.config ? (
          <Configured activePath={activePath} />
        ) : (
          <Setup bases={bases} />
        )}
      </div>
    </div>
  )
}

function Setup({ bases }: { bases: Base[] }) {
  const [mode, setMode] = useState<'join' | 'create'>('join')
  // The folder of the vault, chosen in the system's picker. On the desktop a
  // base is known by its absolute path, so the path is also its id. The open
  // base, if there is exactly one, comes suggested.
  const [folder, setFolder] = useState<string | null>(
    bases.length === 1 ? fileSystem().absolutePath(bases[0]!.id, '') : null,
  )
  const [codeFromFile, setCodeFromFile] = useState(false)
  const [vault, setVault] = useState('principal')
  const [deviceName, setDeviceName] = useState(onApple() ? 'mac' : 'windows')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<string | null>(null)

  const baseId = folder ?? ''

  // Creating happens on the machine that has the setup code file: fill it in.
  useEffect(() => {
    if (mode !== 'create' || code) return
    let cancelled = false
    void readSetupCode().then((found) => {
      if (cancelled || !found) return
      setCode(found)
      setCodeFromFile(true)
    })
    return () => {
      cancelled = true
    }
  }, [mode, code])
  const usesSetupCode = mode === 'create' || code.trim().length > 20

  const submit = async () => {
    setError(null)
    if (!folder) return setError('Escolha a pasta do vault.')
    if (mode === 'create' && password !== confirm) return setError('As duas senhas não batem.')
    if (mode === 'create' && password.length < 10)
      return setError('Use uma senha de pelo menos 10 caracteres.')
    setBusy(true)
    try {
      if (mode === 'create') {
        setRecovery(
          await setUpVault({ vault, setupCode: code.trim(), password, deviceName, baseId, folder }),
        )
      } else {
        await joinExistingVault({
          vault,
          secret: code.trim(),
          ...(usesSetupCode ? { password } : {}),
          deviceName,
          baseId,
          folder,
        })
        await startSync()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (recovery) {
    return (
      <div className="sync-body">
        <p className="sync-strong">Vault criado. Este é o código de recuperação:</p>
        <p className="sync-code">{recovery}</p>
        <p className="sync-note">
          Ele abre o vault se a senha se perder. Guarde no gerenciador de senhas, fora deste
          computador. Ele não aparece de novo.
        </p>
        <button type="button" className="sync-primary" onClick={() => void startSync()}>
          Guardei o código, começar a sincronizar
        </button>
      </div>
    )
  }

  return (
    <div className="sync-body">
      <div className="viewer-seg" role="group">
        <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>
          Entrar num vault
        </button>
        <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>
          Criar o vault
        </button>
      </div>

      <p className="sync-warning">
        Enquanto o Obsidian Sync estiver ligado numa pasta, não ligue este sync nela: dois motores
        na mesma pasta brigam. Teste numa cópia do vault até o dia da troca (seção 8 da spec).
      </p>

      <div className="sync-field">
        <span>Pasta</span>
        <div className="sync-folder">
          <span className={folder ? 'sync-folder-path' : 'sync-folder-path is-empty'}>
            {folder ?? 'Nenhuma pasta escolhida'}
          </span>
          <button
            type="button"
            className="viewer-action"
            onClick={() =>
              void pickFolder()
                .then((picked) => picked && setFolder(picked))
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
            }
          >
            Escolher pasta…
          </button>
        </div>
      </div>
      <label className="sync-field">
        <span>Vault</span>
        <input
          value={vault}
          onChange={(e) => setVault(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))}
        />
      </label>
      <label className="sync-field">
        <span>Este aparelho</span>
        <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
      </label>
      <label className="sync-field">
        <span>
          {mode === 'create' ? 'Código de configuração' : 'Código de pareamento ou de configuração'}
        </span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={
            mode === 'create'
              ? 'Cole o conteúdo de ~/.markdown-viewer/sync-setup-code.txt'
              : 'ABCDE-FGHIJ, mostrado no outro aparelho'
          }
          type={mode === 'create' ? 'password' : 'text'}
        />
      </label>
      {(mode === 'create' || usesSetupCode) && (
        <label className="sync-field">
          <span>Senha do vault</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      {mode === 'create' && (
        <label className="sync-field">
          <span>A senha de novo</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      )}
      {codeFromFile && mode === 'create' && (
        <p className="sync-note">O código foi lido do arquivo deste computador.</p>
      )}
      {error && <p className="sync-error">{error}</p>}
      {!busy && (!folder || !code.trim()) && (
        <p className="sync-note">
          Falta {!folder ? 'escolher a pasta' : ''}
          {!folder && !code.trim() ? ' e ' : ''}
          {!code.trim() ? (mode === 'create' ? 'o código de configuração' : 'o código') : ''}.
        </p>
      )}
      <button
        type="button"
        className="sync-primary"
        disabled={busy || !code.trim() || !folder}
        onClick={() => void submit()}
      >
        {busy ? 'Um momento…' : mode === 'create' ? 'Criar e guardar a chave' : 'Entrar'}
      </button>
    </div>
  )
}

function Configured({ activePath }: { activePath: { baseId: string; path: string } | null }) {
  const sync = useSync()
  const [pairing, setPairing] = useState<{ code: string; expires: number; qr: string } | null>(null)
  const [list, setList] = useState<Awaited<ReturnType<typeof devices>> | null>(null)
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const config = sync.config!
  const relevantPath = activePath && activePath.baseId === config.baseId ? activePath.path : null

  const pair = async () => {
    setError(null)
    try {
      const result = await pairNewDevice()
      const qr = await QRCode.toDataURL(
        JSON.stringify({ server: result.server, vault: result.vault, code: result.code }),
        { margin: 1, width: 220 },
      )
      setPairing({ code: result.code, expires: result.expires, qr })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const label =
    sync.status === 'syncing'
      ? 'Sincronizando…'
      : sync.status === 'error'
        ? 'Parou: ' + (sync.message ?? 'erro')
        : sync.status === 'offline'
          ? 'Sem conexão. Sincroniza quando voltar.'
          : `Sincronizado ${ago(sync.lastSync)}`

  return (
    <div className="sync-body">
      <p className={'sync-status is-' + sync.status}>{label}</p>
      <p className="sync-note">
        Vault <b>{config.vault}</b>, pasta {config.folder}, aparelho {config.deviceName}.
      </p>
      <div className="sync-actions">
        <button type="button" className="sync-primary" onClick={() => void syncNow()}>
          Sincronizar agora
        </button>
        <button type="button" className="viewer-action" onClick={() => void pair()}>
          Parear outro aparelho
        </button>
        <button
          type="button"
          className="viewer-action"
          onClick={() => void devices().then(setList)}
        >
          Aparelhos
        </button>
        {relevantPath && (
          <button
            type="button"
            className="viewer-action"
            onClick={() => void versionsOf(relevantPath).then(setVersions)}
          >
            Versões do arquivo aberto
          </button>
        )}
      </div>
      {error && <p className="sync-error">{error}</p>}

      {pairing && (
        <div className="sync-pairing">
          <img src={pairing.qr} alt="QR de pareamento" />
          <div>
            <p className="sync-code">{pairing.code}</p>
            <p className="sync-note">
              No outro aparelho, em Sincronização, entre no vault <b>{config.vault}</b> com este
              código. Vale por 10 minutos e uma vez só. Ele já leva a chave: não precisa de senha.
            </p>
          </div>
        </div>
      )}

      {list && (
        <ul className="sync-list">
          {list.map((device) => (
            <li key={device.id}>
              <span>
                {device.name} {device.revoked ? '(revogado)' : ''}
                <small> visto {ago(device.lastSeen)}</small>
              </span>
              {!device.revoked && (
                <button
                  type="button"
                  className="viewer-action"
                  onClick={() => void revoke(device.id).then(() => devices().then(setList))}
                >
                  Revogar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {versions && (
        <ul className="sync-list">
          {versions.length === 0 && <li>Nenhuma versão no servidor ainda.</li>}
          {versions.map((version, i) => (
            <li key={version.seq}>
              <span>
                {new Date(version.at).toLocaleString('pt-BR')} {version.deleted ? '(apagado)' : ''}
                <small> {version.meta ? Math.round(version.meta.size / 1024) + ' KB' : ''}</small>
              </span>
              {i > 0 && version.meta && (
                <button
                  type="button"
                  className="viewer-action"
                  onClick={() => void restoreVersion(version)}
                >
                  Restaurar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sync.events.length > 0 && (
        <details className="sync-activity">
          <summary>Atividade recente</summary>
          <ul>
            {sync.events.slice(0, 50).map((event, i) => (
              <li key={i} className={'is-' + event.kind}>
                <span>{EVENT_LABEL[event.kind] ?? event.kind}</span> {event.path}
                {event.detail && <small> {event.detail}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <button type="button" className="sync-leave" onClick={() => void leaveVault()}>
        Desligar o sync neste aparelho
      </button>
    </div>
  )
}
