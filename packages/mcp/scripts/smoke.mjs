/**
 * Conversa com o servidor como o Claude conversaria: sobe o dist/server.mjs por
 * stdio e chama as ferramentas de leitura. Nunca chama `rename`.
 *
 *   node packages/mcp/scripts/smoke.mjs "<vault>"
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

const vault = process.argv[2]
const server = fileURLToPath(new URL('../dist/server.mjs', import.meta.url))
const client = new Client({ name: 'smoke', version: '0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, vault] }))

const tools = await client.listTools()
console.log('ferramentas:', tools.tools.map((t) => t.name).join(', '))

const call = async (name, args) => {
  const started = Date.now()
  const result = await client.callTool({ name, arguments: args })
  const text = result.content[0].text
  console.log(`\n## ${name} ${JSON.stringify(args)} (${Date.now() - started} ms)`)
  console.log(text.length > 900 ? text.slice(0, 900) + '\n…' : text)
}

await call('search', { query: 'checklist partida #dcs', limit: 3 })
await call('resolve_link', { link: '[[Christen Eagle II]]' })
await call('get_note', { note: 'Patches', include_content: false })
await call('query_base', { base: 'Biblioteca', view: 'Lidos' })
await call('list_properties', { name: 'tipo' })
await client.close()
