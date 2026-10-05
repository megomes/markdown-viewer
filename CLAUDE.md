# markdown-viewer

App de notas que substitui o Obsidian e o Obsidian Sync em todos os aparelhos do Matheus.
O plano inteiro, com as etapas, está em [docs/spec.md](docs/spec.md). Como sai uma versão
do desktop está em [docs/releases.md](docs/releases.md).

- Responda em pt-BR. **Nunca use travessão nem meia-risca (U+2014 e U+2013)**, em lugar nenhum: chat, docs,
  comentários de código, mensagens de commit.
- Monorepo com npm workspaces: `apps/desktop` (Tauri + React + CodeMirror),
  `packages/core` (dialeto Markdown, sistema de arquivos, índice), `services/feedback`
  (Worker + D1 da Cloudflare).
- Antes de commitar: `npm run verify` e `npm run format:check` na raiz.
- A etapa em construção fica em `STAGE`, em `apps/desktop/src/app/client-context.ts`.
  Atualize ao começar uma etapa nova da spec.

## Feedback do app: fila de trabalho do Matheus

O Matheus escreve comentários sobre o app na tela **Feedback** (botão de balão na barra
lateral, ou `⌘⇧B`/`Ctrl+Shift+B`). Cada nota tem id sequencial (`#1`, `#2`…, nunca
reutilizado). Quando ele pedir "faz os ids 2, 3, 4 e 5", é dessa fila que se trata. Os
dados ficam no D1 `markdown-viewer-feedback`, tabelas `notes` e `note_log` (ver
`services/feedback/migrations/`).

- **Ler:** `npm run feedback -- list 2 3 4 5` (sem ids, lista tudo o que não está
  arquivado). Uma nota com contexto e histórico completos: `npm run feedback -- show 3`.
  O MCP da Cloudflare também lê: `d1_database_query` com
  `select id, kind, status, body, resolution, created_at from notes where id in (2,3,4,5) and deleted = 0`.
- **Contexto para debug:** `notes.context` guarda onde a nota foi escrita: `device`
  (kind phone/tablet/desktop, os, webview, surface `desktop-tauri`|`browser`, layout,
  toque, memória), `screen` (viewport, tela, dpr, orientação, tema), `network`, `locale`,
  `app` (versão, etapa, tela de origem, estado do sync), `server` (user agent, país,
  região, cidade e colo da Cloudflare, build) e `queuedOffline`. A tela de origem
  (`notes.screen`) diz o tipo de visualização e a extensão do arquivo aberto, nunca o
  caminho. Edições e reaberturas guardam o mesmo em `note_log.detail.context`.
- **Estados:** `open` (o Matheus pode editar/excluir) → `discussing` → `in_progress` →
  `done` | `ignored` → o Matheus testa: 👍 = `archived` (log `confirmed`); 👎 = volta
  para `open` com comentário (log `rejected`, texto em `note_log.message`). O texto
  (`body`) é do Matheus: nunca altere. Nunca arquive você mesmo: só o 👍 dele arquiva.
- **Nota reaberta com 👎:** leia o comentário antes de refazer (está no `show`). Ao
  entregar de novo, envie a lista `done` completa (a anterior mais o que mudou) e
  explique na mensagem o que foi corrigido em resposta ao comentário.
- **Atualizar sempre pelo script** (muda status, mescla a resolução e grava no histórico
  numa instrução só, pela tabela `note_claude`):
  - começar a discutir: `npm run feedback -- 3 discussing "Perguntei X; aguardando decisão"`
  - começar: `npm run feedback -- 3 in_progress "Começando: …"`
  - progresso sem mudar status: `npm run feedback -- 3 - "Feito o passo X"`
  - concluir (depois do commit e da release):
    `npm run feedback -- 3 done "Implementado e publicado" '{"summary":"…","done":["…"],"ignored":["…"],"decisions":["…"],"follow_ups":["…"],"commits":["<sha>"],"deployed":"v0.5.0"}'`
  - decidir não fazer: `npm run feedback -- 3 ignored "Motivo…" '{"summary":"…","ignored":["…"],"decisions":["…"]}'`
- A resolução é mesclada por chave: ao atualizar uma lista, envie a lista completa.
- Seja exato: o que foi feito, o que ficou de fora e por quê, decisões tomadas, commits
  (sha curto) e em que versão saiu. É isso que o Matheus lê no app.
- Mudanças relevantes de escopo também vão para `docs/spec.md`.
