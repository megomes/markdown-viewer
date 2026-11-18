/**
 * An HTML page of the vault, ready for the phone's web view. View only: what the
 * page keeps in `localStorage` starts from what the desktop saved in the vault
 * (`.markdown-viewer/state/<caminho>.json`) and is not written back.
 *
 * The page is loaded with its own file as the base address, so its CSS, images
 * and scripts load from its folder on the device, and a link to `#seção` stays
 * on the page.
 */

import { normalizePath } from '@markdown-viewer/core/resolver'

/** Where the desktop keeps what a page put in `localStorage`. */
export function htmlStatePath(path: string): string {
  return `.markdown-viewer/state/${path}.json`
}

/** The `localStorage` in a state file, or nothing when it cannot be read. */
export function storageOf(text: string | null): Record<string, string> {
  if (!text) return {}
  try {
    const data = JSON.parse(text) as { localStorage?: unknown }
    return data.localStorage && typeof data.localStorage === 'object'
      ? (data.localStorage as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/** The width a page is laid out at in "modo computador". */
export const DESKTOP_WIDTH = 1280

function shim(initial: Record<string, string>): string {
  // Plain ES5: it runs inside whatever page this is. The storage lives in
  // memory, starting from the vault's copy; the phone only shows the page.
  return `(function () {
  var data = ${JSON.stringify(initial).replace(/</g, '\\u003c')};
  function store(map) {
    var api = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[String(k)] = String(v); },
      removeItem: function (k) { delete map[String(k)]; },
      clear: function () { for (var k in map) delete map[k]; },
      key: function (i) { var keys = Object.keys(map); return i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(map).length; }
    };
    return new Proxy(api, {
      get: function (t, p) { return p in t ? t[p] : (typeof p === 'string' && Object.prototype.hasOwnProperty.call(map, p) ? map[p] : undefined); },
      set: function (t, p, v) { if (p in t) return false; api.setItem(p, v); return true; }
    });
  }
  try { Object.defineProperty(window, 'localStorage', { value: store(data), configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: store({}), configurable: true }); } catch (e) {}
})();`
}

const VIEWPORT = /<meta\b[^>]*name\s*=\s*["']?viewport["']?[^>]*>/gi

/**
 * The page with the storage and the viewport put in front of everything. On the
 * phone the page's own viewport stands (or one is added so it fits the screen);
 * in "modo computador" it is laid out as wide as a desktop window and shrunk to fit.
 */
export function pageDocument(
  html: string,
  options: { storage: Record<string, string>; desktop: boolean },
): string {
  const hasViewport = VIEWPORT.test(html)
  VIEWPORT.lastIndex = 0
  let page = html
  let viewport = ''
  if (options.desktop) {
    page = html.replace(VIEWPORT, '')
    viewport = `<meta name="viewport" content="width=${DESKTOP_WIDTH}">`
  } else if (!hasViewport) {
    viewport = '<meta name="viewport" content="width=device-width, initial-scale=1">'
  }
  const head = viewport + `<script>${shim(options.storage)}</script>`

  const headTag = /<head(\s[^>]*)?>/i.exec(page)
  if (headTag) {
    const at = headTag.index + headTag[0].length
    return page.slice(0, at) + head + page.slice(at)
  }
  const htmlTag = /<html(\s[^>]*)?>/i.exec(page)
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length
    return page.slice(0, at) + '<head>' + head + '</head>' + page.slice(at)
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(page)
  const at = doctype ? doctype[0].length : 0
  return page.slice(0, at) + head + page.slice(at)
}

/**
 * The vault files the page loads by itself: images, scripts and stylesheets
 * next to it. The phone downloads only notes and small images up front, so the
 * rest is fetched before the page is shown. Links to other pages are left out:
 * they are opened when tapped, not loaded with this one.
 */
export function relativeAssets(html: string, path: string): string[] {
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const found = new Set<string>()
  const add = (raw: string) => {
    const target = raw.trim().split(/[?#]/)[0]!
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return
    let decoded = target
    try {
      decoded = decodeURIComponent(target)
    } catch {
      // A stray % in a name: taken as written.
    }
    found.add(
      decoded.startsWith('/') ? normalizePath(decoded) : normalizePath(folder + '/' + decoded),
    )
  }
  for (const match of html.matchAll(/\b(?:src|poster)\s*=\s*["']([^"']+)["']/gi)) add(match[1]!)
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1]
    if (href) add(href)
  }
  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(match[1]!)
  return [...found]
}

/**
 * The vault path a `file://` address points at, when it is inside the vault's
 * folder on the device (`root`, the folder's own address).
 */
export function vaultPathOf(url: string, root: string): string | null {
  const base = root.endsWith('/') ? root : root + '/'
  const clean = url.split('#')[0]!.split('?')[0]!
  if (!clean.startsWith(base)) return null
  try {
    return normalizePath(decodeURIComponent(clean.slice(base.length)))
  } catch {
    return null
  }
}
