/**
 * The vault's end-to-end encryption.
 *
 * - One random 256-bit key per vault. It never leaves a device in the clear.
 * - The server keeps it only wrapped: once by the vault password, once by the
 *   recovery code, each through Argon2id. A new device unwraps one of them, or
 *   receives the key from a paired device.
 * - Content is sealed with XChaCha20-Poly1305 under a subkey, with a random
 *   nonce per message.
 * - A chunk's id is a keyed BLAKE2b of its plaintext under another subkey: equal
 *   chunks get equal ids, so they upload once, and the server learns nothing it
 *   could compare with anything outside this vault.
 *
 * libsodium is the same library on the desktop, the web and the phone.
 */

import sodiumModule from 'libsodium-wrappers-sumo'

type Sodium = typeof sodiumModule
let ready: Promise<Sodium> | null = null

export function sodium(): Promise<Sodium> {
  ready ??= sodiumModule.ready.then(() => sodiumModule)
  return ready
}

const CONTEXT = 'mdvvault' // 8 bytes, as crypto_kdf requires
const SUBKEY_SEAL = 1
const SUBKEY_CHUNK_ID = 2

export interface WrappedKey {
  alg: 'argon2id13+xchacha20poly1305'
  salt: string
  nonce: string
  cipher: string
  opslimit: number
  memlimit: number
}

const b64 = (s: Sodium, bytes: Uint8Array) =>
  s.to_base64(bytes, s.base64_variants.URLSAFE_NO_PADDING)
const unb64 = (s: Sodium, text: string) => s.from_base64(text, s.base64_variants.URLSAFE_NO_PADDING)

export async function createVaultKey(): Promise<Uint8Array> {
  const s = await sodium()
  return s.crypto_kdf_keygen()
}

/** Wraps the vault key with a password or a recovery code. */
export async function wrapKey(key: Uint8Array, secret: string): Promise<WrappedKey> {
  const s = await sodium()
  const salt = s.randombytes_buf(s.crypto_pwhash_SALTBYTES)
  const opslimit = s.crypto_pwhash_OPSLIMIT_INTERACTIVE
  const memlimit = s.crypto_pwhash_MEMLIMIT_INTERACTIVE
  const kek = s.crypto_pwhash(
    32,
    secret.normalize('NFKC'),
    salt,
    opslimit,
    memlimit,
    s.crypto_pwhash_ALG_ARGON2ID13,
  )
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const cipher = s.crypto_aead_xchacha20poly1305_ietf_encrypt(key, null, null, nonce, kek)
  return {
    alg: 'argon2id13+xchacha20poly1305',
    salt: b64(s, salt),
    nonce: b64(s, nonce),
    cipher: b64(s, cipher),
    opslimit,
    memlimit,
  }
}

/** The vault key back, or an error when the secret is wrong. */
export async function unwrapKey(wrapped: WrappedKey, secret: string): Promise<Uint8Array> {
  const s = await sodium()
  const kek = s.crypto_pwhash(
    32,
    secret.normalize('NFKC'),
    unb64(s, wrapped.salt),
    wrapped.opslimit,
    wrapped.memlimit,
    s.crypto_pwhash_ALG_ARGON2ID13,
  )
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      unb64(s, wrapped.cipher),
      null,
      unb64(s, wrapped.nonce),
      kek,
    )
  } catch {
    throw new Error('Senha ou código de recuperação errado.')
  }
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Eight groups of five, from an alphabet with no 0/O or 1/I to confuse. */
export async function generateRecoveryCode(): Promise<string> {
  const s = await sodium()
  const groups: string[] = []
  for (let g = 0; g < 8; g++) {
    let group = ''
    for (let i = 0; i < 5; i++)
      group += RECOVERY_ALPHABET[s.randombytes_uniform(RECOVERY_ALPHABET.length)]
    groups.push(group)
  }
  return groups.join('-')
}

/** Typed by hand: case, spaces and the dashes do not matter. */
export function normalizeRecoveryCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.match(/.{1,5}/g)?.join('-') ?? ''
}

export class VaultCrypto {
  private constructor(
    private readonly s: Sodium,
    private readonly sealKey: Uint8Array,
    private readonly idKey: Uint8Array,
  ) {}

  static async create(key: Uint8Array): Promise<VaultCrypto> {
    const s = await sodium()
    return new VaultCrypto(
      s,
      s.crypto_kdf_derive_from_key(32, SUBKEY_SEAL, CONTEXT, key),
      s.crypto_kdf_derive_from_key(32, SUBKEY_CHUNK_ID, CONTEXT, key),
    )
  }

  /** The id a chunk is stored under: keyed, so only this vault can compute it. */
  chunkId(plain: Uint8Array): string {
    return this.s.to_hex(this.s.crypto_generichash(32, plain, this.idKey))
  }

  /** Nonce followed by ciphertext and tag. */
  seal(plain: Uint8Array): Uint8Array {
    const nonce = this.s.randombytes_buf(this.s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
    const cipher = this.s.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plain,
      null,
      null,
      nonce,
      this.sealKey,
    )
    const out = new Uint8Array(nonce.length + cipher.length)
    out.set(nonce)
    out.set(cipher, nonce.length)
    return out
  }

  open(sealed: Uint8Array): Uint8Array {
    const n = this.s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
    try {
      return this.s.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        sealed.subarray(n),
        null,
        sealed.subarray(0, n),
        this.sealKey,
      )
    } catch {
      throw new Error('Não deu para abrir: dado corrompido ou de outro vault.')
    }
  }

  sealJson(value: unknown): string {
    return b64(this.s, this.seal(new TextEncoder().encode(JSON.stringify(value))))
  }

  openJson<T>(text: string): T {
    return JSON.parse(new TextDecoder().decode(this.open(unb64(this.s, text)))) as T
  }

  /** A plain hash of content, kept inside the sealed metadata to spot changes. */
  hash(plain: Uint8Array): string {
    return this.s.to_hex(this.s.crypto_generichash(32, plain, null))
  }
}

export function toBase64(s: Sodium, bytes: Uint8Array): string {
  return b64(s, bytes)
}

export function fromBase64(s: Sodium, text: string): Uint8Array {
  return unb64(s, text)
}
