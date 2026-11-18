/**
 * Turns an HTML file into the document the viewer's frame shows.
 *
 * Two things are put in before anything the page has:
 * - `<base href>`, pointing at the file's folder, so the page finds its CSS,
 *   scripts and images where it always did;
 * - a script that replaces `localStorage` and `sessionStorage` (the frame is
 *   sandboxed and has none) and intercepts clicks on links. Every change to
 *   `localStorage` goes to the app in a message; a click on a link to another
 *   vault file asks the app to open it instead of loading it inside the frame.
 *
 * The page is never changed on disk.
 */

/** Messages from the frame. The `__mdv` key keeps them apart from the page's own. */
export type FrameMessage =
  { __mdv: 'storage'; storage: Record<string, string> } | { __mdv: 'open'; href: string }

function shim(initial: Record<string, string>): string {
  // Kept as plain ES5-ish code: it runs inside whatever page this is.
  return `(function () {
  // Tells an embedded Revisor Visual that this frame is the whole page.
  window.__rvEmbedded = true;
  var data = ${JSON.stringify(initial).replace(/</g, '\\u003c')};
  function store(persist) {
    var map = persist ? data : {};
    function report() { if (persist) parent.postMessage({ __mdv: 'storage', storage: map }, '*'); }
    var api = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[String(k)] = String(v); report(); },
      removeItem: function (k) { delete map[String(k)]; report(); },
      clear: function () { for (var k in map) delete map[k]; report(); },
      key: function (i) { return Object.keys(map)[i] ?? null; },
      get length() { return Object.keys(map).length; }
    };
    return new Proxy(api, {
      get: function (t, p) { return p in t ? t[p] : (typeof p === 'string' && Object.prototype.hasOwnProperty.call(map, p) ? map[p] : undefined); },
      set: function (t, p, v) { if (p in t) return false; api.setItem(p, v); return true; },
      deleteProperty: function (t, p) { api.removeItem(p); return true; },
      has: function (t, p) { return p in t || Object.prototype.hasOwnProperty.call(map, p); },
      ownKeys: function () { return Object.keys(map); },
      getOwnPropertyDescriptor: function (t, p) {
        return Object.prototype.hasOwnProperty.call(map, p) ? { value: map[p], enumerable: true, configurable: true, writable: true } : undefined;
      }
    });
  }
  try { Object.defineProperty(window, 'localStorage', { value: store(true), configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: store(false), configurable: true }); } catch (e) {}
  // The app turns the Revisor on and off from its own toolbar.
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== parent || !data || data.__mdv !== 'revisor') return;
    if (window.__rv && window.__rv.setActive) window.__rv.setActive(!!data.active);
  });
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || /^javascript:/i.test(href)) return;
    if (href.charAt(0) === '#') {
      // A section of this same page. The <base> points at the file's folder,
      // so left alone "#branches" would load the folder itself: a blank frame.
      // The hash of this document is set instead, which scrolls there and lets
      // the page's own hashchange code run.
      event.preventDefault();
      if (href.length > 1) location.hash = href.slice(1);
      return;
    }
    event.preventDefault();
    parent.postMessage({ __mdv: 'open', href: href }, '*');
  }, true);
})();`
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** The page, with the base and the shim in front of everything else. */
export function frameDocument(
  html: string,
  options: { baseHref: string | null; storage: Record<string, string>; revisor?: string },
): string {
  const withRevisor = options.revisor ? appendRevisor(html, options.revisor) : html
  return inject(withRevisor, options)
}

/**
 * The Revisor Visual goes in last, after everything the page has, as a content
 * script would. `</script` inside its code is broken so it cannot close the tag.
 */
function appendRevisor(html: string, code: string): string {
  const tag = '<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script>'
  const end = html.search(/<\/body\s*>/i)
  return end < 0 ? html + tag : html.slice(0, end) + tag + html.slice(end)
}

function inject(
  html: string,
  options: { baseHref: string | null; storage: Record<string, string> },
): string {
  const head =
    (options.baseHref ? `<base href="${escapeAttribute(options.baseHref)}">` : '') +
    `<script>${shim(options.storage)}</script>`

  // Right after <head>, or after <html>, or at the very top of a fragment.
  const headTag = /<head(\s[^>]*)?>/i.exec(html)
  if (headTag) {
    const at = headTag.index + headTag[0].length
    return html.slice(0, at) + head + html.slice(at)
  }
  const htmlTag = /<html(\s[^>]*)?>/i.exec(html)
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length
    return html.slice(0, at) + '<head>' + head + '</head>' + html.slice(at)
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  const at = doctype ? doctype[0].length : 0
  return html.slice(0, at) + head + html.slice(at)
}

/** Whether a message really came from the page in this frame, and is ours. */
export function isFrameMessage(data: unknown): data is FrameMessage {
  return (
    !!data && typeof data === 'object' && typeof (data as { __mdv?: unknown }).__mdv === 'string'
  )
}

export { htmlText, htmlTitle } from '@markdown-viewer/core/html'
