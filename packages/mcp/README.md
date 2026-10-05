# packages/mcp

O servidor MCP do vault (seção 6.6 de `docs/spec.md`). Lê o vault direto do disco,
com o mesmo índice do app, e não precisa do app aberto.

| Ferramenta        | O que faz                                                          |
| ----------------- | ------------------------------------------------------------------ |
| `search`          | Busca em notas e HTML, com `#tag`, `path:`, `"frase"` e `-excluir` |
| `get_note`        | Propriedades, aliases, tags, títulos, links, backlinks e conteúdo  |
| `resolve_link`    | Para onde um `[[link]]` aponta, do jeito do Obsidian               |
| `backlinks`       | Quem aponta para um arquivo                                        |
| `query_base`      | Roda um `.base` e devolve as linhas                                |
| `list_tags`       | Tags com contagem                                                  |
| `list_properties` | Propriedades com contagem, ou os valores de uma                    |
| `rename`          | Renomeia ou move e atualiza todos os links. Não sobrescreve        |

## Instalar

```bash
npm run build -w @markdown-viewer/mcp
```

No Claude Code, uma vez por máquina:

```bash
claude mcp add vault --scope user -- node "C:\Users\mathe\Code\markdown-viewer\packages\mcp\dist\server.mjs" "C:\Users\mathe\Documents\Obsidian Notes"
```

No app do Claude (desktop), em `claude_desktop_config.json`, dentro de `mcpServers`:

```json
"vault": {
  "command": "node",
  "args": [
    "C:\Users\mathe\Code\markdown-viewer\packages\mcp\dist\server.mjs",
    "C:\Users\mathe\Documents\Obsidian Notes"
  ]
}
```

No Mac, troque os dois caminhos pelos de lá.

## Conferir

```bash
node packages/mcp/scripts/smoke.mjs "C:\Users\mathe\Documents\Obsidian Notes"
```

Sobe o servidor e chama as ferramentas de leitura. Nunca chama `rename`.
