/**
 * The sync Worker: routes `/v/<vault>/…` to that vault's Durable Object, which
 * does the rest (`vault.ts`). Open to any origin because every call carries a
 * device token; there are no cookies to steal.
 */

import { Vault, type Env } from './vault'

export { Vault }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const url = new URL(req.url)
    const match = /^\/v\/([A-Za-z0-9_-]{1,64})\//.exec(url.pathname)
    if (!match) return new Response('markdown-viewer sync', { status: 404, headers: CORS })
    const stub = env.VAULT.get(env.VAULT.idFromName(match[1]!))
    const response = await stub.fetch(req)
    if (response.status === 101) return response
    const headers = new Headers(response.headers)
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
    return new Response(response.body, { status: response.status, headers })
  },
} satisfies ExportedHandler<Env>
