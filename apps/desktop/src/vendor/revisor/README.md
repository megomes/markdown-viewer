# Revisor Visual embutido

Cópia de `shared.js` e `content.js` de
[megomes/revisor-visual](https://github.com/megomes/revisor-visual), no commit em
`VERSION`. É a versão que o app usa quando o vault ainda não tem uma baixada pelo botão
"Atualizar Revisor" (Ajustes). Não edite aqui: o Revisor é desenvolvido no repositório
dele.

O app roda esses arquivos dentro do frame isolado do visualizador de HTML, sem extensão
por perto. Nesse modo o Revisor guarda a sessão no `localStorage` (chave `rv_state`), que
o app grava em `.markdown-viewer/state/<caminho>.json`.

Esta cópia tem aplicada a mudança do PR
[megomes/revisor-visual#1](https://github.com/megomes/revisor-visual/pull/1): com
`window.__rvEmbedded = true`, o frame vira dono do painel. Quando o PR entrar numa
release, o botão "Atualizar Revisor" passa a aceitar a versão do GitHub.
