# markdown-viewer

App de notas que substitui o Obsidian e o Obsidian Sync em todos os aparelhos do Matheus.
O plano inteiro, com as etapas, está em [docs/spec.md](docs/spec.md). Como sai uma versão
do desktop está em [docs/releases.md](docs/releases.md).

- Responda em pt-BR. **Nunca use travessão nem meia-risca (U+2014 e U+2013)**, em lugar nenhum: chat, docs,
  comentários de código, mensagens de commit.
- Monorepo com npm workspaces: `apps/desktop` (Tauri + React + CodeMirror),
  `packages/core` (dialeto Markdown, sistema de arquivos, índice), `packages/sync`,
  `services/sync`.
- Antes de commitar: `npm run verify` e `npm run format:check` na raiz.
- A etapa em construção fica em `STAGE`, em `apps/desktop/src/app/client-context.ts`.
  Atualize ao começar uma etapa nova da spec.

## Feedback do app: fila de trabalho do Matheus

O feedback deste app é o **feedback-kit** (`~/Code/feedback-kit`, repositório
`megomes/feedback-kit`), o mesmo de todos os apps do Matheus, com o app `markdown-viewer`
(`feedback-kit.json` na raiz). Quando ele pedir "faz os ids 2, 3, 4 e 5", é dessa fila:
**use a skill `feedback-kit`**, que tem as regras (estados, 👍/👎, conversa, resolução,
versão) e o CLI. Atalho daqui: `npm run feedback -- list 2 3`, `npm run feedback -- show 3`,
`npm run feedback -- 3 in_progress "…"`.

O que é só deste app:

- O painel abre pelo botão de balão na barra lateral ou `⌘⇧B`/`Ctrl+Shift+B`, por cima
  do editor ([Feedback.tsx](apps/desktop/src/ui/Feedback.tsx)). Os tokens do tema vão
  para os `--fb-*` em [feedback.css](apps/desktop/src/ui/feedback.css).
- A tela de origem (`screen`) diz o tipo de visualização e a extensão do arquivo aberto,
  nunca o caminho. O `context.app` leva a versão e a `STAGE`.
- Mudanças relevantes de escopo também vão para `docs/spec.md`.

## Versão (sempre informar)

- A versão do app é `version` em `apps/desktop/src-tauri/tauri.conf.json` (`0.X.Y`), a
  mesma da tag da release. Aparece na barra de status.
- **Suba a versão a cada entrega de notas, antes do commit da release:** o **minor**
  (0.4.0 → 0.5.0) quando entrega notas ou funcionalidades novas, o **patch**
  (0.5.0 → 0.5.1) para correção pequena de algo já entregue.
- **Ao terminar, diga ao Matheus a versão lançada (`v0.X.Y`)** e registre-a no
  `deployed` da nota. Sem isso a entrega não está completa.
