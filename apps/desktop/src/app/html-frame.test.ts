// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { frameDocument, htmlText, htmlTitle, isFrameMessage } from './html-frame'

describe('frameDocument', () => {
  it('põe a base e o script logo depois do <head>, antes de tudo da página', () => {
    const out = frameDocument(
      '<!doctype html><html><head><title>T</title><script>x()</script></head></html>',
      {
        baseHref: 'http://asset.localhost/C%3A/v/',
        storage: {},
      },
    )
    const base = out.indexOf('<base href="http://asset.localhost/C%3A/v/">')
    expect(base).toBeGreaterThan(out.indexOf('<head>'))
    expect(base).toBeLessThan(out.indexOf('<title>'))
    expect(out.indexOf('localStorage')).toBeLessThan(out.indexOf('x()'))
  })

  it('cria o <head> quando a página não tem, e aceita fragmento', () => {
    expect(frameDocument('<html><body>a</body></html>', { baseHref: null, storage: {} })).toMatch(
      /^<html><head><script>/,
    )
    expect(frameDocument('<p>a</p>', { baseHref: null, storage: {} })).toMatch(/^<script>/)
  })

  it('não deixa o estado fechar o script', () => {
    const out = frameDocument('<p></p>', { baseHref: null, storage: { k: '</script><b>' } })
    expect(out.match(/<\/script>/g)).toHaveLength(1)
  })

  it('o localStorage trocado guarda, lê e avisa o app', () => {
    const out = frameDocument('<p></p>', { baseHref: null, storage: { a: '1' } })
    const code = /<script>([\s\S]*)<\/script>/.exec(out)![1]!
    const post = vi.fn()
    const win = window as unknown as { parent: { postMessage: typeof post } }
    const original = window.parent
    Object.defineProperty(window, 'parent', { value: { postMessage: post }, configurable: true })
    new Function(code)()
    expect(window.localStorage.getItem('a')).toBe('1')
    window.localStorage.setItem('b', '2')
    expect(post).toHaveBeenLastCalledWith({ __mdv: 'storage', storage: { a: '1', b: '2' } }, '*')
    expect(window.localStorage.length).toBe(2)
    expect((window.localStorage as unknown as Record<string, string>).b).toBe('2')
    window.localStorage.removeItem('a')
    expect(post).toHaveBeenLastCalledWith({ __mdv: 'storage', storage: { b: '2' } }, '*')
    Object.defineProperty(window, 'parent', { value: original, configurable: true })
    void win
  })
})

describe('texto e título de HTML', () => {
  it('tira tags, scripts e estilos', () => {
    expect(htmlText('<style>a{}</style><h1>Oi</h1><p>um &amp; dois</p><script>x</script>')).toBe(
      'Oi\num & dois',
    )
  })

  it('acha o título', () => {
    expect(htmlTitle('<title> A-10C  Progress </title>')).toBe('A-10C Progress')
    expect(htmlTitle('<h1>Só h1</h1>')).toBe('Só h1')
    expect(htmlTitle('<p>nada</p>')).toBeNull()
  })

  it('reconhece só as mensagens do app', () => {
    expect(isFrameMessage({ __mdv: 'open', href: 'a' })).toBe(true)
    expect(isFrameMessage({ type: 'x' })).toBe(false)
  })
})
