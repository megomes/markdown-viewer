import { describe, expect, it } from 'vitest'
import {
  createVaultKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  unwrapKey,
  VaultCrypto,
  wrapKey,
} from './vault-crypto'

describe('chave do vault', () => {
  it('embrulha e desembrulha com a senha, e recusa a senha errada', async () => {
    const key = await createVaultKey()
    const wrapped = await wrapKey(key, 'cavalo correto bateria grampo')
    expect(await unwrapKey(wrapped, 'cavalo correto bateria grampo')).toEqual(key)
    await expect(unwrapKey(wrapped, 'outra')).rejects.toThrow(/errad/)
  })

  it('o código de recuperação tem 8 grupos e aceita digitação solta', async () => {
    const code = await generateRecoveryCode()
    expect(code).toMatch(/^([A-HJ-NP-Z2-9]{5}-){7}[A-HJ-NP-Z2-9]{5}$/)
    expect(normalizeRecoveryCode(code.toLowerCase().replaceAll('-', ' '))).toBe(code)
  })
})

describe('conteúdo', () => {
  it('sela e abre, e cada selagem sai diferente', async () => {
    const crypto = await VaultCrypto.create(await createVaultKey())
    const plain = new TextEncoder().encode('Checklist de partida do A-10C')
    const a = crypto.seal(plain)
    const b = crypto.seal(plain)
    expect(a).not.toEqual(b)
    expect(crypto.open(a)).toEqual(plain)
  })

  it('recusa conteúdo alterado ou de outro vault', async () => {
    const one = await VaultCrypto.create(await createVaultKey())
    const two = await VaultCrypto.create(await createVaultKey())
    const sealed = one.seal(new Uint8Array([1, 2, 3]))
    expect(() => two.open(sealed)).toThrow()
    sealed[sealed.length - 1]! ^= 1
    expect(() => one.open(sealed)).toThrow()
  })

  it('id de pedaço é estável no vault e diferente entre vaults', async () => {
    const key = await createVaultKey()
    const a = await VaultCrypto.create(key)
    const b = await VaultCrypto.create(key)
    const other = await VaultCrypto.create(await createVaultKey())
    const plain = new Uint8Array([9, 9, 9])
    expect(a.chunkId(plain)).toBe(b.chunkId(plain))
    expect(a.chunkId(plain)).not.toBe(other.chunkId(plain))
  })

  it('JSON selado vai e volta', async () => {
    const crypto = await VaultCrypto.create(await createVaultKey())
    const meta = { path: 'Notas/Painel.md', size: 10 }
    expect(crypto.openJson(crypto.sealJson(meta))).toEqual(meta)
  })
})
