import { describe, expect, it } from 'vitest'
import { pageDocument, relativeAssets, storageOf, vaultPathOf } from './html-page'

describe('página HTML no celular', () => {
  it('põe o armazenamento antes de tudo e cabe na tela quando a página não diz nada', () => {
    const out = pageDocument('<html><head><title>x</title></head><body></body></html>', {
      storage: { feito: '1' },
      desktop: false,
    })
    expect(out.indexOf('width=device-width')).toBeLessThan(out.indexOf('<title>'))
    expect(out).toContain('"feito":"1"')
  })

  it('mantém o viewport da própria página fora do modo computador', () => {
    const html = '<head><meta name="viewport" content="width=500"></head>'
    const out = pageDocument(html, { storage: {}, desktop: false })
    expect(out).toContain('width=500')
    expect(out).not.toContain('device-width')
  })

  it('no modo computador troca o viewport pela largura de uma janela', () => {
    const html = '<head><meta name="viewport" content="width=device-width"></head>'
    const out = pageDocument(html, { storage: {}, desktop: true })
    expect(out).toContain('width=1280')
    expect(out).not.toContain('device-width')
  })

  it('acha as imagens, os scripts e o CSS ao lado da página', () => {
    const html = `<link rel="stylesheet" href="estilo.css">
      <img src="_capturas/tela%201.png"><script src="../comum/app.js"></script>
      <div style="background: url('fundo.jpg')"></div>
      <img src="https://exemplo.com/x.png"><a href="outra.html">outra</a>`
    expect(relativeAssets(html, 'Projetos/P/_project.html').sort()).toEqual([
      'Projetos/P/_capturas/tela 1.png',
      'Projetos/P/estilo.css',
      'Projetos/P/fundo.jpg',
      'Projetos/comum/app.js',
    ])
  })

  it('reconhece um link para outro arquivo do vault', () => {
    const root = 'file:///data/user/0/app/files/vault/'
    expect(vaultPathOf(root + 'Reasset%20Notes/a.md#x', root)).toBe('Reasset Notes/a.md')
    expect(vaultPathOf('file:///outro/lugar.md', root)).toBeNull()
  })

  it('lê o localStorage salvo pelo desktop', () => {
    expect(storageOf('{"version":1,"localStorage":{"a":"b"}}')).toEqual({ a: 'b' })
    expect(storageOf('quebrado')).toEqual({})
    expect(storageOf(null)).toEqual({})
  })
})
