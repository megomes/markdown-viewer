import { describe, expect, it } from 'vitest'
import { pickUpdate, type Release } from './releases'

const OTA = {
  repo: 'megomes/markdown-viewer',
  tagPrefix: 'android-v',
  asset: String.raw`markdown-viewer-(\d+)\.apk`,
}

const android = (version: string, code: number, extra: Partial<Release> = {}): Release => ({
  tag_name: `android-v${version}-${code}`,
  draft: false,
  prerelease: false,
  body: `Versão ${version}`,
  assets: [
    {
      name: `markdown-viewer-${code}.apk`,
      browser_download_url: `https://x/${code}.apk`,
      size: 10,
    },
  ],
  ...extra,
})

const desktop: Release = {
  tag_name: 'v0.8.1',
  draft: false,
  prerelease: false,
  body: null,
  assets: [{ name: 'latest.json', browser_download_url: 'https://x/latest.json', size: 1 }],
}

describe('pickUpdate', () => {
  it('acha a release do Android mais nova entre as do desktop', () => {
    const update = pickUpdate([desktop, android('0.8.1', 12), android('0.8.0', 9)], 9, OTA)
    expect(update).toMatchObject({ code: 12, label: '0.8.1 (12)', url: 'https://x/12.apk' })
  })

  it('não oferece a versão instalada nem uma mais velha', () => {
    expect(pickUpdate([android('0.8.0', 9)], 9, OTA)).toBeNull()
    expect(pickUpdate([android('0.7.0', 3)], 9, OTA)).toBeNull()
  })

  it('ignora rascunho, que ainda não tem o APK inteiro', () => {
    expect(pickUpdate([android('0.9.0', 20, { draft: true })], 9, OTA)).toBeNull()
  })

  it('sem versão instalada conhecida, qualquer build é novo', () => {
    expect(pickUpdate([android('0.8.0', 1)], 0, OTA)?.code).toBe(1)
  })
})
