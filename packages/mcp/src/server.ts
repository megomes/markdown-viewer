#!/usr/bin/env node
/**
 * The vault's MCP server, over stdio.
 *
 *   node packages/mcp/dist/server.mjs "C:\Users\mathe\Documents\Obsidian Notes"
 *
 * Or with VAULT_PATH set. It reads the vault straight from disk and does not need
 * the app to be open. Claude keeps editing files directly, as before: this gives
 * it what a text search cannot, which is the vault's own idea of links, aliases,
 * tags, properties and Bases.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { Vault } from './vault'

const root = process.argv[2] ?? process.env.VAULT_PATH
if (!root) {
  console.error('uso: vault-mcp <pasta do vault>  (ou VAULT_PATH)')
  process.exit(1)
}

const vault = new Vault(root)
vault.watch()
// The first question would wait for the whole vault to be read; start now.
void vault.ready().catch(() => {})

const server = new McpServer({ name: 'vault', version: '0.1.0' })

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
})

server.registerTool(
  'search',
  {
    title: 'Buscar no vault',
    description:
      'Busca em notas e páginas HTML do vault. Todas as palavras precisam aparecer (sem ligar para acento e caixa). ' +
      'Aceita "frase exata", #tag (inclui tags aninhadas), tag:nome, path:pasta e -excluir. ' +
      'Devolve os arquivos com o título e as linhas onde achou.',
    inputSchema: {
      query: z.string().describe('A busca, por exemplo: dcs "checklist de partida" #flight-sim'),
      limit: z.number().int().min(1).max(200).optional().describe('Máximo de arquivos (padrão 30)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, limit }) => {
    const results = await vault.search(query, limit ?? 30)
    return json(
      results.map((r) => ({
        path: r.path,
        title: r.title,
        lines: r.matches.map((m) => `${m.line + 1}: ${m.preview}`),
      })),
    )
  },
)

server.registerTool(
  'get_note',
  {
    title: 'Ler nota',
    description:
      'Uma nota ou página do vault, pelo caminho ou por um link como se escreve numa nota (nome, alias ou caminho parcial). ' +
      'Devolve propriedades, aliases, tags, títulos, links de saída já resolvidos, backlinks e o conteúdo.',
    inputSchema: {
      note: z
        .string()
        .describe(
          'Caminho no vault ou link, por exemplo "A-10C" ou "Personal Notes/Música/Patches.md"',
        ),
      include_content: z.boolean().optional().describe('Incluir o texto (padrão true)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ note, include_content }) => {
    const path = await vault.locate(note)
    if (!path) return fail(`Nada no vault responde por "${note}".`)
    const { file, backlinks } = await vault.note(path)
    const content =
      include_content === false ? undefined : (await vault.text(path)).slice(0, 200_000)
    return json({
      path,
      title: file?.title,
      aliases: file?.aliases ?? [],
      tags: file?.tags ?? [],
      properties: file?.properties ?? {},
      headings: file?.headings.map((h) => '#'.repeat(h.level) + ' ' + h.text) ?? [],
      links: file?.links ?? [],
      backlinks,
      content,
    })
  },
)

server.registerTool(
  'resolve_link',
  {
    title: 'Resolver link',
    description:
      'Para qual arquivo um [[link]] aponta, do jeito do Obsidian (nome mais curto, caminho parcial, relativo, alias). ' +
      'Use antes de escrever um link numa nota, para não criar link quebrado.',
    inputSchema: {
      link: z.string().describe('O alvo do link, com ou sem [[ ]]'),
      from: z
        .string()
        .optional()
        .describe('Caminho da nota onde o link está, para links relativos'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ link, from }) => {
    const path = await vault.locate(link, from ?? '')
    return json({ link, resolves_to: path })
  },
)

server.registerTool(
  'backlinks',
  {
    title: 'Backlinks',
    description: 'Quais notas apontam para um arquivo.',
    inputSchema: { note: z.string().describe('Caminho ou link do arquivo') },
    annotations: { readOnlyHint: true },
  },
  async ({ note }) => {
    const path = await vault.locate(note)
    if (!path) return fail(`Nada no vault responde por "${note}".`)
    return json({ path, backlinks: await vault.backlinks(path) })
  },
)

server.registerTool(
  'query_base',
  {
    title: 'Rodar uma Base',
    description:
      'Roda um arquivo .base do Obsidian e devolve as linhas da visão, já filtradas, ordenadas e agrupadas.',
    inputSchema: {
      base: z.string().describe('Caminho ou nome do .base, por exemplo "Biblioteca.base"'),
      view: z.string().optional().describe('Nome da visão; sem ele, a primeira'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ base, view }) => {
    const path = await vault.locate(base.endsWith('.base') ? base : base + '.base')
    if (!path) return fail(`Base "${base}" não encontrada.`)
    return json({ path, ...(await vault.queryBase(path, view)) })
  },
)

server.registerTool(
  'list_tags',
  {
    title: 'Tags do vault',
    description: 'Todas as tags, do front matter e do texto, com quantas notas têm cada uma.',
    annotations: { readOnlyHint: true },
  },
  async () => json(await vault.tags()),
)

server.registerTool(
  'list_properties',
  {
    title: 'Propriedades do vault',
    description:
      'Sem nome: todas as propriedades de front matter usadas no vault, com contagem. ' +
      'Com nome: os valores que essa propriedade assume, com contagem. Use para seguir o vocabulário que já existe.',
    inputSchema: { name: z.string().optional().describe('Uma propriedade, por exemplo "tipo"') },
    annotations: { readOnlyHint: true },
  },
  async ({ name }) => json(await vault.properties(name)),
)

server.registerTool(
  'rename',
  {
    title: 'Renomear ou mover',
    description:
      'Renomeia ou move um arquivo ou pasta do vault e atualiza todos os links que apontavam para ele, ' +
      'como o Obsidian faz. Use isto em vez de mover pelo terminal, que deixa links quebrados. Não sobrescreve.',
    inputSchema: {
      from: z.string().describe('Caminho atual no vault'),
      to: z.string().describe('Caminho novo no vault'),
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async ({ from, to }) => {
    try {
      return json(await vault.rename(from, to))
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  },
)

server.registerTool(
  'comments_list',
  {
    title: 'Pedidos de revisão pendentes',
    description:
      'Os comentários que o Matheus deixou nas páginas HTML (pelo Revisor Visual) e nas notas, ainda sem resposta. ' +
      'Devolve a lista e o texto no formato do "Copiar tudo" do Revisor, com o caminho de cada arquivo: ' +
      'ache cada trecho pela âncora, confirme pelo caminho e aplique o pedido. Depois marque com comment_applied.',
    inputSchema: {
      file: z.string().optional().describe('Só os de arquivos cujo caminho contém isto'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ file }) => json(await vault.comments(file)),
)

server.registerTool(
  'comment_applied',
  {
    title: 'Marcar pedido como feito',
    description:
      'Marca um item de revisão como aplicado, ou como recusado com o motivo. A conferência (ficou ou não ficou) é do Matheus, no app.',
    inputSchema: {
      file: z.string().describe('Caminho do arquivo no vault, como veio em comments_list'),
      item: z.union([z.string(), z.number()]).describe('O id ou o número do item'),
      status: z.enum(['applied', 'declined']).optional().describe('applied (padrão) ou declined'),
      note: z.string().optional().describe('Uma nota curta: o que mudou, ou por que não'),
    },
  },
  async ({ file, item, status, note }) => {
    try {
      return json(await vault.markComment(file, item, status ?? 'applied', note))
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  },
)

await server.connect(new StdioServerTransport())
