/** What the search and the index read from an HTML page: its text and its title. */

/** Visible text of an HTML page, for the search: no tags, scripts or styles. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** The page's own title, from `<title>` or the first `<h1>`. */
export function htmlTitle(html: string): string | null {
  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ??
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
  return title ? htmlText(title).trim() || null : null
}
