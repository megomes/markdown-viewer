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
  checkSecret,
  devices,
  forgetRecoveryCode,
  joinExistingVault,
  leaveVault,
  newRecoveryCode,
  pairNewDevice,
  restoreVersion,
  revoke,
  setUpVault,
  startSync,
  syncAvailable,
  syncNow,
  useSync,
  versionsOf,
  type SyncConfig,
  type Version,
} from '~/app/sync'
import { onApple } from './shortcuts'
import { getVault } from '~/app/spaces'
import { pickFolder, readSetupCode } from '~/platform/sync-tauri'

interface Props {
  bases: Base[]
  activePath: { baseId: string; path: string } | null
  /** The sync was set up on this folder: it becomes the vault. */
  onVault: (folder: string) => void
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

export function SyncPanel({ bases, activePath, onVault, onClose }: Props) {
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
        ) : sync.recovery ? (
          // Before anything else: this code is shown once, and the form that
          // made it is gone the moment the vault exists.
          <FreshRecovery code={sync.recovery} config={sync.config} />
        ) : sync.config ? (
          <Configured activePath={activePath} />
        ) : (
          <Setup bases={bases} onVault={onVault} />
        )}
      </div>
    </div>
  )
}

const SETUP_FILE = '~/.markdown-viewer/sync-setup-code.txt'
const SAVED_KEY = (vault: string) => `markdown-viewer.sync.backup-saved:${vault}`

function backupSaved(vault: string): boolean {
  try {
    return localStorage.getItem(SAVED_KEY(vault)) === '1'
  } catch {
    return false
  }
}

/** Everything that brings the vault back, as one note for the password manager. */
function backupText(config: SyncConfig, setupCode: string | null, recovery: string | null): string {
  return [
    'markdown-viewer: chaves do sync',
    '',
    `Servidor: ${config.server}`,
    `Vault: ${config.vault}`,
    `Código de configuração: ${setupCode ?? `(está em ${SETUP_FILE}, no computador que criou o vault)`}`,
    'Senha do vault: (a que você criou; escreva aqui)',
    `Código de recuperação: ${recovery ?? '(o que o app mostrou ao criar o vault, ou gere um novo em Sincronização > Backup e recuperação)'}`,
    '',
    'Para recuperar num computador novo:',
    '1. Instale o markdown-viewer e abra Sincronização > Entrar num vault.',
    '2. Escolha uma pasta vazia e digite o nome do vault acima.',
    '3. No campo do código, cole o código de configuração.',
    '4. Digite a senha do vault. Sem a senha, use o código de recuperação.',
    'Sem a senha e sem o código de recuperação, ninguém abre as notas do servidor.',
  ].join('\n')
}

function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="viewer-action"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setState('done'),
          () => setState('failed'),
        )
      }
      onBlur={() => setState('idle')}
    >
      {state === 'done' ? 'Copiado' : state === 'failed' ? 'Não deu para copiar' : label}
    </button>
  )
}

/** A recovery code made a moment ago: shown until the person says it is put away. */
function FreshRecovery({ code, config }: { code: string; config: SyncConfig | null }) {
  const [setupCode, setSetupCode] = useState<string | null>(null)
  useEffect(() => {
    void readSetupCode().then(setSetupCode)
  }, [])
  return (
    <div className="sync-body">
      <p className="sync-strong">Código de recuperação do vault</p>
      <p className="sync-code">{code}</p>
      <p className="sync-note">
        Abre o vault se a senha se perder. <b>Aparece só agora</b>: guarde no gerenciador de senhas
        antes de fechar. Se perder, dá para gerar outro em Backup e recuperação, enquanto algum
        aparelho ainda estiver no vault.
      </p>
      <div className="sync-actions">
        <CopyButton text={code} label="Copiar o código" />
        {config && (
          <CopyButton text={backupText(config, setupCode, code)} label="Copiar tudo para guardar" />
        )}
      </div>
      <button
        type="button"
        className="sync-primary"
        onClick={() => void forgetRecoveryCode().then(() => startSync())}
      >
        Guardei o código
      </button>
    </div>
  )
}

function Setup({ bases, onVault }: { bases: Base[]; onVault: (folder: string) => void }) {
  const [mode, setMode] = useState<'join' | 'create'>('join')
  // The folder of the vault, chosen in the system's picker. On the desktop a
  // base is known by its absolute path, so the path is also its id. The open
  // base, if there is exactly one, comes suggested.
  const [folder, setFolder] = useState<string | null>(() => {
    const vault = getVault()
    if (vault) return fileSystem().absolutePath(vault, '') ?? vault
    return bases.length === 1 ? fileSystem().absolutePath(bases[0]!.id, '') : null
  })
  const [codeFromFile, setCodeFromFile] = useState(false)
  const [vault, setVault] = useState('principal')
  const [deviceName, setDeviceName] = useState(onApple() ? 'mac' : 'windows')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Joining with no other device at hand and the password forgotten.
  const [forgot, setForgot] = useState(false)

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
        // The recovery code it hands back goes to the sync's state, and the
        // panel shows it from there.
        await setUpVault({ vault, setupCode: code.trim(), password, deviceName, baseId, folder })
        onVault(folder)
      } else {
        await joinExistingVault({
          vault,
          secret: code.trim(),
          ...(usesSetupCode ? (forgot ? { recoveryCode: password } : { password }) : {}),
          deviceName,
          baseId,
          folder,
        })
        onVault(folder)
        await startSync()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
      {mode === 'create' && codeFromFile ? (
        <div className="sync-field">
          <span>Código de configuração</span>
          <p className="sync-note">
            Lido deste computador ({SETUP_FILE}). É a senha do <b>servidor</b>: prova que é você
            quem cria o vault. Não é a senha do vault e você não precisa digitar nada aqui.
          </p>
        </div>
      ) : (
        <label className="sync-field">
          <span>
            {mode === 'create'
              ? 'Código de configuração'
              : 'Código de pareamento ou de configuração'}
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={
              mode === 'create'
                ? `Cole o conteúdo de ${SETUP_FILE}`
                : 'ABCDE-FGHIJ, mostrado no outro aparelho'
            }
          />
          <small className="sync-hint">
            {mode === 'create'
              ? `A senha do servidor, que está em ${SETUP_FILE} no computador onde o servidor foi configurado. Não é a senha do vault.`
              : 'Com outro aparelho já no vault: o código curto de "Parear outro aparelho". Sem nenhum: o código de configuração, e aí o app pede a senha do vault.'}
          </small>
        </label>
      )}
      {(mode === 'create' || usesSetupCode) && (
        <label className="sync-field">
          <span>{mode === 'join' && forgot ? 'Código de recuperação' : 'Senha do vault'}</span>
          <input
            type={mode === 'join' && forgot ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'create' && (
            <small className="sync-hint">
              Você inventa agora, com 10 caracteres ou mais. É ela que cifra as notas, e o servidor
              nunca a vê. Guarde no gerenciador de senhas: o app não a mostra depois.
            </small>
          )}
        </label>
      )}
      {mode === 'join' && usesSetupCode && (
        <button
          type="button"
          className="sync-leave"
          onClick={() => {
            setForgot(!forgot)
            setPassword('')
          }}
        >
          {forgot ? 'Usar a senha do vault' : 'Esqueci a senha: usar o código de recuperação'}
        </button>
      )}
      {mode === 'create' && (
        <label className="sync-field">
          <span>A senha de novo</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      )}
      {mode === 'create' && (
        <p className="sync-note">
          Ao criar, o app mostra o código de recuperação, que abre o vault se a senha se perder.
        </p>
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
  const [backup, setBackup] = useState(false)
  const config = sync.config!
  const [saved, setSaved] = useState(() => backupSaved(config.vault))
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
          : sync.status === 'off'
            ? 'Parado. Use Sincronizar agora para ligar.'
            : sync.lastSync
              ? `Sincronizado ${ago(sync.lastSync)}`
              : 'Ligado, esperando a primeira passada.'

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
        <button
          type="button"
          className="viewer-action"
          aria-expanded={backup}
          onClick={() => setBackup(!backup)}
        >
          Backup e recuperação
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

      {!saved && !backup && (
        <p className="sync-warning">
          Você ainda não confirmou que guardou as chaves deste vault. Sem elas, não há como voltar
          às notas do servidor se os aparelhos se perderem.{' '}
          <button type="button" className="sync-leave" onClick={() => setBackup(true)}>
            Ver o que guardar
          </button>
        </p>
      )}

      {backup && (
        <Backup
          config={config}
          saved={saved}
          onSaved={(value) => {
            try {
              if (value) localStorage.setItem(SAVED_KEY(config.vault), '1')
              else localStorage.removeItem(SAVED_KEY(config.vault))
            } catch {
              // storage blocked: the reminder stays
            }
            setSaved(value)
          }}
        />
      )}

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

/** A value too sensitive to leave on screen: hidden until asked for. */
function Hidden({ value }: { value: string }) {
  const [shown, setShown] = useState(false)
  return (
    <span className="sync-backup-value">
      <code>{shown ? value : '•'.repeat(Math.min(value.length, 24))}</code>
      <button type="button" className="viewer-action" onClick={() => setShown(!shown)}>
        {shown ? 'Ocultar' : 'Mostrar'}
      </button>
      <CopyButton text={value} />
    </span>
  )
}

type Checked = { state: 'idle' | 'busy' | 'ok' | 'wrong' } | { state: 'failed'; why: string }

/** Tries a password or a recovery code against the vault, without changing anything. */
function Check({ kind }: { kind: 'password' | 'recovery' }) {
  const [value, setValue] = useState('')
  const [result, setResult] = useState<Checked>({ state: 'idle' })
  const run = () => {
    setResult({ state: 'busy' })
    checkSecret(kind, value).then(
      (ok) => setResult({ state: ok ? 'ok' : 'wrong' }),
      (e: unknown) =>
        setResult({ state: 'failed', why: e instanceof Error ? e.message : String(e) }),
    )
  }
  return (
    <>
      <span className="sync-backup-value">
        <input
          type={kind === 'password' ? 'password' : 'text'}
          value={value}
          placeholder={
            kind === 'password' ? 'Digite a senha para conferir' : 'Cole o código para conferir'
          }
          onChange={(e) => {
            setValue(e.target.value)
            setResult({ state: 'idle' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value) run()
          }}
        />
        <button
          type="button"
          className="viewer-action"
          disabled={!value || result.state === 'busy'}
          onClick={run}
        >
          {result.state === 'busy' ? 'Conferindo…' : 'Conferir'}
        </button>
      </span>
      {result.state === 'ok' && <span className="sync-ok">Confere: abre este vault.</span>}
      {result.state === 'wrong' && <span className="sync-error">Não abre este vault.</span>}
      {result.state === 'failed' && <span className="sync-error">{result.why}</span>}
    </>
  )
}

/**
 * What has to be kept outside this computer to get the notes back, each thing
 * shown or checked, and how to use them on the day they are needed.
 */
function Backup({
  config,
  saved,
  onSaved,
}: {
  config: SyncConfig
  saved: boolean
  onSaved: (saved: boolean) => void
}) {
  const [setupCode, setSetupCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void readSetupCode().then(setSetupCode)
  }, [])

  const renew = () => {
    if (
      !window.confirm(
        'Gerar um código de recuperação novo? O código antigo deixa de funcionar. A senha do vault não muda.',
      )
    )
      return
    setBusy(true)
    setError(null)
    // The new code is shown by the panel itself, in place of everything else.
    newRecoveryCode()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <section className="sync-backup" aria-label="Backup e recuperação">
      <p className="sync-strong">Guarde no gerenciador de senhas</p>
      <p className="sync-note">
        As notas ficam cifradas no servidor. Com estes cinco itens você volta a elas em qualquer
        computador, mesmo perdendo todos os aparelhos.
      </p>
      <dl>
        <dt>1. Servidor</dt>
        <dd>
          <span className="sync-backup-value">
            <code>{config.server}</code>
            <CopyButton text={config.server} />
          </span>
        </dd>
        <dt>2. Nome do vault</dt>
        <dd>
          <span className="sync-backup-value">
            <code>{config.vault}</code>
            <CopyButton text={config.vault} />
          </span>
        </dd>
        <dt>3. Código de configuração</dt>
        <dd>
          <small>A senha do servidor. Deixa um aparelho entrar sem outro para parear.</small>
          {setupCode ? (
            <Hidden value={setupCode} />
          ) : (
            <small>
              Não está neste computador. Está em {SETUP_FILE}, no computador onde o servidor foi
              configurado.
            </small>
          )}
        </dd>
        <dt>4. Senha do vault</dt>
        <dd>
          <small>A que você criou. O app não a guarda, então não tem como mostrar.</small>
          <Check kind="password" />
        </dd>
        <dt>5. Código de recuperação</dt>
        <dd>
          <small>
            Abre o vault sem a senha. Aparece só quando é criado. Não guardou? Gere outro.
          </small>
          <Check kind="recovery" />
          <button type="button" className="viewer-action" disabled={busy} onClick={renew}>
            {busy ? 'Gerando…' : 'Gerar um código novo'}
          </button>
        </dd>
      </dl>
      {error && <p className="sync-error">{error}</p>}
      <div className="sync-actions">
        <CopyButton text={backupText(config, setupCode, null)} label="Copiar tudo como uma nota" />
      </div>

      <p className="sync-strong">Como recuperar</p>
      <ol>
        <li>
          <b>Ainda tem um aparelho no vault?</b> Nele, use "Parear outro aparelho" e digite o código
          curto no aparelho novo. Não precisa de mais nada.
        </li>
        <li>
          <b>Perdeu todos?</b> Instale o app, abra Sincronização, "Entrar num vault", escolha uma
          pasta vazia, digite o nome do vault, cole o código de configuração e a senha do vault.
        </li>
        <li>
          <b>Esqueceu a senha?</b> No mesmo lugar, escolha "Esqueci a senha" e use o código de
          recuperação.
        </li>
      </ol>
      <p className="sync-note">
        Sem a senha <b>e</b> sem o código de recuperação, ninguém abre as notas do servidor, nem
        você. As notas que já estão na pasta de um aparelho continuam nele.
      </p>

      <details className="sync-activity">
        <summary>Para publicar versões novas do app</summary>
        <p className="sync-note">
          Não abrem as notas, mas sem eles o app para de se atualizar sozinho. Guarde os arquivos e
          as senhas: a chave do desktop (~/.tauri/markdown-viewer.key e
          markdown-viewer.key.password) e a keystore do Android
          (~/.android/daily-motion-release.jks).
        </p>
      </details>

      <label className="sync-check">
        <input type="checkbox" checked={saved} onChange={(e) => onSaved(e.target.checked)} />
        Já guardei os cinco itens fora deste computador
      </label>
    </section>
  )
}
