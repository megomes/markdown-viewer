# Spec: substituir o Obsidian

Data: 2026-10-04. Escrita a partir da entrevista com o Matheus nesta data.

## 1. Objetivo

Um app de notas que funciona em todos os aparelhos do Matheus, abre o vault que hoje
vive no Obsidian sem quebrar nada, e sincroniza sozinho, criptografado, sem limite de
tamanho de arquivo. Quando ele estiver pronto, a assinatura do Obsidian Sync (US$ 5 por
mês, 1 GB, 5 MB por arquivo, um mês de histórico) é cancelada.

Dois fatos do uso real moldam o produto:

- **O Claude escreve a maior parte das notas.** O Claude Code abre a pasta do vault e
  o app do Claude edita os arquivos direto. O app precisa conviver com isso e ajudar.
- **O Matheus trabalha mais em HTML do que em Markdown.** HTML é formato de primeira
  classe, não anexo.

## 2. Princípios

1. **O arquivo em disco é a verdade.** O vault continua sendo uma pasta comum, na
   mesma estrutura que o Obsidian usa. A nuvem só transporta. Se o app falhar, a pasta
   continua abrindo no Obsidian, que é grátis.
2. **Nunca perder uma linha.** Diante de qualquer dúvida o sync guarda as duas versões.
   Toda decisão de merge pode ser desfeita pelo histórico.
3. **A nuvem não lê nada.** Conteúdo, nomes de arquivo e pastas saem do aparelho
   criptografados.
4. **Sem limite de tamanho.** Um PDF de 2 GB sincroniza pelo mesmo caminho que uma nota.
5. **Rápido.** A criptografia e o sync não podem ser sentidos no uso. Os números estão
   na seção 9.

## 3. Aparelhos

| Aparelho              | Sistema    | App                  | Quando          |
| --------------------- | ---------- | -------------------- | --------------- |
| MacBook Pro M5 Pro    | macOS      | Tauri (o atual)      | Antes do corte  |
| Desktop Ryzen 5800X3D | Windows 11 | Tauri (o atual)      | Antes do corte  |
| Galaxy S25 Ultra      | Android    | Expo                 | Antes do corte  |
| Galaxy Tab S10 FE     | Android    | Expo, layout tablet  | Antes do corte  |
| Galaxy Watch 8        | Wear OS    | Módulo nativo Kotlin | Depois do corte |
| Qualquer navegador    | Web        | Next.js na Vercel    | Depois do corte |

O Expo não gera app de Wear OS, então o relógio é um módulo nativo dentro do projeto
mobile, que conversa com o celular.

## 4. O que o vault mostrou

Levantamento de `C:\Users\mathe\Documents\Obsidian Notes` em 2026-10-04.

**Tamanho.** 1,3 GB no total. 945 MB são 154 PDFs (manuais de Flight Sim, o maior com
140 MB), 156 MB são imagens, e as 844 notas `.md` somam 11,8 MB. Os PDFs grandes não
aparecem hoje no celular por causa do limite de 5 MB do Sync Standard.

**Outros arquivos.** 82 HTML (três deles nos favoritos, os trackers de treino, que
guardam progresso no `localStorage`), mais `.py`, `.lua`, `.json`, `.txt`, `.xlsx`,
`.docx`, `.pem` e arquivos de backup gerados por script.

**Sintaxe em uso**, em número de notas:

| Recurso                   | Notas | Observação                                                                                                               |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| Frontmatter               | 704   | Chaves: `tags`, `tipo`, `done`, `aliases`, `updated`, `type`, `status`, `resumo`, `autor`, `repo`                        |
| Tags no frontmatter       | 609   | Tag solta no texto aparece em só 12 notas                                                                                |
| Wiki link `[[ ]]`         | 441   |                                                                                                                          |
| `aliases`                 | 206   | O link precisa achar a nota pelo alias                                                                                   |
| Callout                   | 194   | `warning`, `info`, `abstract`, `note`, `important`, `tip`, `question`, `danger`, `success`, `update`, `check`, `example` |
| Tabela                    | 186   |                                                                                                                          |
| Link Markdown `[](...)`   | 147   |                                                                                                                          |
| Embed `![[ ]]`            | 115   | 124 imagens, 17 notas, alguns xlsx e docx                                                                                |
| Tarefa `- [ ]`            | 43    |                                                                                                                          |
| Mermaid                   | 7     |                                                                                                                          |
| Referência de bloco `^id` | 2     |                                                                                                                          |
| Bases (`.base`)           | 3     | Biblioteca, Media, 3D Printing. Filtro, fórmula, agrupamento                                                             |

**Sem uso:** notas diárias, Canvas, fórmula matemática, Dataview.

**Configuração.** Anexos vão para a pasta `Files`. `alwaysUpdateLinks` está ligado, então
renomear atualiza os links. O plugin Iconize põe ícone nas pastas. Cada área (`Personal
Notes`, `Reasset Notes`) tem `CLAUDE.md` e uma pasta `_meta` com índices que o Claude
mantém.

## 5. Escopo

### Antes do corte

- Compatibilidade total com o vault da seção 4.
- HTML com visualização, estado sincronizado e abrir no navegador.
- Leitor de PDF e de código.
- Bases em modo leitura.
- Sync criptografado entre os quatro aparelhos, sem limite de tamanho.
- Histórico de versões sem prazo para texto.
- MCP do vault para o Claude.
- Comentários para o Claude, no desktop e no celular, com o Revisor Visual embutido.
- Feedback do app, igual à tela Notes do DailyFlow.
- App Android de leitura, no celular e no tablet.

### Depois do corte, em ordem provável

- Acesso pela web (seção 6.10).
- Edição no celular e no tablet.
- Widgets. O Matheus tem planos próprios e complexos para eles, que serão especificados
  à parte.
- Galaxy Watch.
- Tarefas, lembretes e agenda.
- Claude no app do celular, usando o desktop como ponte (ver 6.6).
- Bases com edição.

### Fora

- Sistema de plugins.
- Publish.
- Canvas, grafo, notas diárias.
- Verificador de convenções do vault e botão "abrir no Claude Code" (propostos e
  recusados na entrevista).
- Marcação de "o que o Claude mudou" (proposta e recusada).

## 6. Funcionalidades

### 6.1 Compatibilidade com o vault

O critério é simples: toda nota que abre certa no Obsidian abre certa aqui.

- **Callouts** com a lista completa do Obsidian, inclusive os apelidos (`summary` e `tldr`
  são `abstract`, `caution` é `warning`, e assim por diante), tipo desconhecido caindo no
  estilo de `note`, e callout dobrável com `[!tipo]-` e `[!tipo]+`. Hoje o app só conhece
  os cinco do GitHub.
- **Frontmatter** como painel de propriedades, com os tipos que o Obsidian usa: texto,
  lista, número, checkbox, data.
- **Resolução de links** igual à do Obsidian: pelo nome mais curto que não seja ambíguo,
  pelo caminho, e pelo `aliases`. `[[nota#título]]`, `[[nota#^bloco]]` e `[[nota|texto]]`.
- **Embeds**: `![[imagem.png]]` procurando na pasta de anexos e no vault, com
  `![[imagem.png|300]]` para largura; `![[nota]]` e `![[nota#título]]` como transclusão;
  outros tipos como cartão que abre o arquivo.
- **Renomear e mover atualizam os links** em todo o vault, como o `alwaysUpdateLinks`.
- **Tags** do frontmatter e do texto, juntas, no painel de tags e na busca.
- **Mermaid** renderizado.
- Realce `==texto==`, comentário `%% %%` escondido na leitura, nota de rodapé,
  referência de bloco `^id`.
- **Ícones de pasta** lidos da configuração do Iconize, para a árvore ficar igual.
- **Favoritos** lidos do `bookmarks.json` na primeira abertura.

Teste de aceite: um script percorre o vault inteiro e lista link, embed e alias que não
resolvem. O número tem que ser igual ao que já está quebrado no Obsidian.

### 6.2 HTML

- **Visualização dentro do app**, num frame isolado do resto do app. Carrega CSS, imagem
  e script relativos à pasta do arquivo, e roda o JavaScript da página.
- **Estado sincronizado.** O app substitui o `localStorage` da página por um que grava em
  `.markdown-viewer/state/<caminho do arquivo>.json`. Esse arquivo sincroniza e é
  criptografado como qualquer outro. Os trackers atuais passam a sincronizar sem mudar
  uma linha.
- **Ver código**, só leitura, com realce. O app não edita HTML: quem edita é o Claude.
- **Abrir no navegador.** O estado no navegador fica separado do estado no app, e o app
  avisa isso.
- **HTML com os mesmos direitos de uma nota**: entra na busca pelo texto visível, aceita
  `[[link]]` apontando para ele, aparece nos backlinks e nos favoritos.

### 6.3 PDF, código e outros

- **PDF** com pdf.js: rolagem contínua, busca no texto, zoom, abrir na página. Um PDF de
  140 MB abre sem travar.
- **Código** (`.py`, `.lua`, `.json`, `.js`, `.css`...) em leitura, com realce.
- **Imagem** em visualizador próprio.
- O resto (`.xlsx`, `.docx`, `.zip`...) abre no app padrão do sistema.

### 6.4 Bases, em leitura

- Lê os arquivos `.base` e mostra a visão de tabela, com as views que o arquivo define.
- Suporta pelo menos o que as três bases atuais usam: filtro com `and`, `file.hasTag`,
  fórmula com `if`, `displayName`, `groupBy`, ordenação por propriedade e por fórmula.
- Clicar numa linha abre a nota.

Teste de aceite: as três bases mostram as mesmas linhas, na mesma ordem e nos mesmos
grupos que no Obsidian.

### 6.5 Sync

**Infraestrutura, toda na Cloudflare, no plano grátis:**

| Peça                         | Papel                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Worker                       | Encaminha cada chamada para o Durable Object do vault                                                                                   |
| Durable Object, um por vault | Autentica o aparelho, guarda o log no SQLite dele, serializa os commits, lê e grava os pedaços no R2 e avisa os aparelhos por WebSocket |
| R2                           | Guarda os pedaços criptografados dos arquivos. 10 GB grátis, sem custo de download                                                      |

O Durable Object por vault resolve de graça o problema mais difícil de um sync, que é
ordenar os commits de vários aparelhos sem corrida. Ele cabe no plano grátis (SQLite
em Durable Object faz parte do Workers Free), e o D1 não foi necessário.

**Arquivos em pedaços.** Cada arquivo é quebrado em pedaços de tamanho variável, em
torno de 4 MB, por chunking definido pelo conteúdo. Cada pedaço é criptografado e sobe
pelo Durable Object para o R2, numa requisição de no máximo 8 MB. URL assinada exigiria
chaves de acesso ao R2 guardadas no servidor, e não foi preciso. Isso:

- acaba com o limite de tamanho, porque nenhuma requisição passa de alguns MB;
- faz uma edição pequena num PDF enorme subir só o pedaço que mudou;
- deixa upload e download retomarem de onde pararam.

O identificador de cada pedaço é um HMAC do conteúdo com uma chave do vault. Assim
pedaços iguais não sobem duas vezes, e o servidor não descobre nada sobre o conteúdo.

**Modelo de dados.** Cada arquivo tem um identificador estável, que sobrevive a renomear
e mover. Cada versão registra, criptografado: caminho, tamanho, data de modificação,
hash e a lista de pedaços. O servidor só vê o identificador, o número de sequência, o
aparelho de origem e o tamanho dos blobs.

**Fluxo.**

1. O aparelho detecta a mudança: pelo editor, pelo observador de arquivos do sistema, ou
   por varredura ao abrir (o Claude Code edita com o app fechado).
2. Sobe os pedaços que o R2 ainda não tem.
3. Faz o commit no Durable Object dizendo em qual versão a edição se baseou.
4. O Durable Object avisa os outros aparelhos conectados, que buscam a mudança na hora.
   Aparelho desconectado pede tudo desde o último número de sequência que viu.

**Conflito.**

- **Texto** (`.md`, `.txt`, `.html`, código): merge de três vias, linha a linha, usando
  como base a última versão que os dois aparelhos tinham em comum. Trechos diferentes se
  juntam sozinhos. Só quando os dois mexeram no mesmo trecho nasce uma cópia de conflito
  ao lado (`Nota (conflito S25 2026-10-04 1532).md`), e o app avisa.
- **Binário**: vence a versão mais nova, e a outra fica no histórico.
- **Renomear contra editar**: os dois se aplicam, porque o identificador é estável.
- **Apagar contra editar**: a edição vence e o arquivo volta.
- O estado dos HTML (`.markdown-viewer/state/`) é JSON e tem merge por chave.

**Histórico.** Texto guarda todas as versões, sem prazo. Binário guarda as últimas cinco
versões ou um ano, o que for maior, para caber nos 10 GB. O app mostra o histórico de
cada arquivo com diferença lado a lado e restaura qualquer versão. Arquivo apagado fica
recuperável pelo histórico.

**Criptografia.**

- libsodium em todos os aparelhos: XChaCha20-Poly1305 para conteúdo, Argon2id para
  derivar chave de senha. A mesma biblioteca no desktop e no Expo.
- Uma chave mestra aleatória por vault. Ela fica no servidor só embrulhada: uma vez pela
  senha do vault, outra pelo código de recuperação.
- Cada aparelho guarda a chave no cofre do sistema: Keychain no macOS, DPAPI no Windows,
  Keystore no Android.
- **Aparelho novo**: escaneia um QR mostrado por um aparelho já pareado, ou digita a
  senha do vault.
- O código de recuperação é gerado na criação do vault e precisa ser guardado fora dos
  aparelhos.

**Autenticação.** Não existe conta nem login com Google. Cada aparelho recebe um token
no pareamento. O app mostra a lista de aparelhos e permite revogar um. A web tem uma
senha própria, descrita na seção 6.10.

**O que sincroniza.** Tudo dentro da pasta, inclusive `.obsidian/` (assim o Obsidian
continua funcionando como reserva em qualquer aparelho). Ficam de fora `.git/`,
`node_modules/`, `.DS_Store`, `.trash/` e o que estiver num arquivo
`.markdown-viewer/ignore`, no formato do `.gitignore`.

**Por aparelho:**

- Desktop: baixa tudo, sempre. Sincroniza com a janela fechada, pela bandeja.
- Celular e tablet: baixam todo texto, HTML e imagem pequena. **PDF e arquivo grande
  só baixam quando abertos**, e ficam em cache. Dá para marcar uma pasta como "sempre
  offline".

**Regra de transição.** Nunca dois motores de sync na mesma pasta. Enquanto o Obsidian
Sync estiver ligado, o sync novo é testado numa cópia do vault. A troca acontece num dia
só (ver seção 8).

### 6.6 MCP do vault

Um servidor MCP local, registrado no Claude Code e no app do Claude no desktop. Ele lê
o vault direto do disco e não depende do app estar aberto. Usa o mesmo índice do app,
então já resolve alias, backlink e Base.

O Claude continua editando os arquivos direto, como hoje. O MCP não substitui isso: dá
ao Claude o que ele não consegue sozinho com busca de texto.

| Ferramenta                     | O que faz                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `search`                       | Busca no texto de notas e HTML, com filtro por tag, propriedade, pasta e tipo |
| `get_note`                     | Conteúdo, propriedades, links de saída resolvidos e backlinks                 |
| `resolve_link`                 | Diz para qual arquivo um `[[nome]]` aponta, considerando alias                |
| `backlinks`                    | Quem aponta para um arquivo                                                   |
| `query_base`                   | Roda uma `.base` e devolve as linhas                                          |
| `list_tags`, `list_properties` | Vocabulário do vault, com contagem e valores                                  |
| `rename`                       | Renomeia ou move um arquivo e atualiza todos os links                         |
| `comments_list`                | Itens de revisão pendentes, no formato do "Copiar tudo" do Revisor            |
| `comment_applied`              | Marca um item como aplicado, com nota opcional                                |

Os índices em `_meta/` continuam existindo. O MCP não os substitui.

**Depois do corte:** o app do Claude no celular não consegue usar um MCP local, e um
MCP remoto na nuvem quebraria a criptografia. A saída é o desktop Windows servir de
ponte quando estiver ligado. Fica para depois.

### 6.7 Comentários para o Claude

O Matheus lê, marca um trecho e escreve o que quer mudado. O Claude aplica, e o
Matheus confere na própria página se ficou. É o ciclo do
[Revisor Visual](https://github.com/megomes/revisor-visual), trazido para dentro do app e
para todos os aparelhos.

**O Revisor continua sendo um projeto próprio**, no repositório dele, e anda no ritmo
dele. O app não copia o código: roda o arquivo que cada release do Revisor publica.

**O que o Revisor já tem e o app herda:** sessões de revisão, numeração corrida entre
páginas, âncora por texto com caminho CSS para desempatar, marcador cinza quando o
ponto some, foto de cada item no momento em que foi marcado, histórico de sessões, a
conferência item a item (ficou ou não ficou) e o "Copiar tudo" no formato que o Claude
já entende.

**O contrato entre os dois.** O Revisor passa a aceitar um anfitrião, que faz por ele o
que hoje a extensão faz. A extensão vira um anfitrião, e o app vira outro:

| O anfitrião fornece     | Na extensão             | No app                                                 |
| ----------------------- | ----------------------- | ------------------------------------------------------ |
| Identidade da página    | URL                     | Caminho no vault, igual em todos os aparelhos          |
| Estado da sessão        | `chrome.storage.local`  | Arquivo em `.markdown-viewer/revisor/`, sincronizado   |
| Histórico e conferência | IndexedDB               | Arquivos em `.markdown-viewer/revisor/`, sincronizados |
| Foto do item            | `captureVisibleTab`     | Captura do visualizador feita pelo app                 |
| Ligar e desligar        | Botão da barra e atalho | Botão do visualizador                                  |
| Contador                | Badge do ícone          | Badge do app                                           |
| Exportar                | Área de transferência   | Área de transferência e fila do MCP                    |
| Modo de entrada         | Mouse com Alt           | Mouse com Alt no desktop, toque no celular             |

O formato dos dados tem versão e pertence ao Revisor. As sessões ficam gravadas no
vault por tempo indefinido, então cada release do Revisor sabe ler as anteriores. A
migração mora no Revisor, junto de quem muda o formato.

**Cada release do Revisor publica um `revisor-embed.js`**, ao lado dos pacotes da
extensão, gerado do mesmo código e sem nenhuma chamada a `chrome.*`. O arquivo declara a
versão do contrato que implementa.

**Atualização, só quando o Matheus pede.** Em Configurações, um botão "Atualizar
Revisor" busca o `revisor-embed.js` da última release pública no GitHub. O app:

1. confere se a versão do contrato é compatível com a dele, e recusa a que não for;
2. grava o arquivo em `.markdown-viewer/revisor/`, de onde ele sincroniza para os outros
   aparelhos, de modo que um clique atualiza todos;
3. guarda a versão anterior, com um botão para voltar a ela.

Cada versão do app também traz uma cópia do Revisor embutida, usada quando não há
versão baixada ou quando a baixada é incompatível com aquele aparelho.

**Onde se comenta:**

- **HTML**: o Revisor dentro do visualizador.
- **Markdown**: selecionando o trecho na nota, no editor do desktop e no leitor do
  celular. O item entra na mesma sessão, no mesmo formato e no mesmo "Copiar tudo" dos
  itens de HTML, com o título da seção no lugar do caminho CSS.
- **No toque**: um botão liga o modo revisão, e nele o toque anota (o modo "clique
  simples anota" que o Revisor já tem).

**O Claude no ciclo.** Pelo MCP ele lista os itens pendentes, lê no formato do "Copiar
tudo", aplica e marca cada item como aplicado, com uma nota curta quando não conseguiu
ou decidiu diferente. A conferência continua sendo do Matheus. A nota do Claude é um
campo novo, opcional, a propor no formato do Revisor.

### 6.8 App Android de leitura

Celular e tablet, só leitura nesta primeira versão.

- Parear com o vault por QR.
- Árvore de arquivos, abertura rápida por nome, busca local, tags, favoritos, backlinks,
  sumário da nota.
- Leitura de Markdown com a mesma renderização do desktop.
- HTML com estado sincronizado, PDF baixado sob demanda, Bases, imagens, código.
- Comentários, com o Revisor no toque.
- Feedback do app (seção 6.9).
- Funciona offline com o que já foi baixado.
- No tablet, árvore e nota lado a lado.

### 6.9 Feedback do app

> **Desde 2026-10-06 o feedback é o feedback-kit** (`github.com/megomes/feedback-kit`,
> privado), compartilhado por todos os apps do Matheus: um Worker com D1 para todos, o
> painel como Web Component (`<feedback-panel>`) carregado do Worker, e a skill e o CLI
> do Claude. O comportamento abaixo continua valendo; o que mudou é onde ele mora. O
> `services/feedback` saiu deste repositório, as notas foram para o banco do kit com os
> mesmos números, e este app só abre o painel, mapeia os tokens do tema nos `--fb-*` e
> informa versão e etapa. Melhorias no painel ou nas regras da fila se fazem no kit e
> chegam a todos os apps. O "Seu retorno" abaixo virou a conversa inteira embaixo da
> nota (cada 👎 e cada entrega, em ordem), como no DailyFlow.

Uma tela para relatar bug, ideia, problema de UX ou dúvida **sobre o próprio app**, no
momento em que a coisa acontece, de qualquer aparelho. O Claude que trabalha neste
repositório lê a fila, implementa e registra exatamente o que fez. O Matheus testa e
confirma com 👍 ou reabre com 👎 e um comentário.

Não confundir com os comentários da seção 6.7: aqueles são sobre o **conteúdo do vault**
e quem trata é o Claude que trabalha no vault. O feedback é sobre o **app**, e quem trata
é o Claude que trabalha neste repositório.

**A referência é a tela Notes do DailyFlow, e ela deve ser reproduzida exatamente**:
mesmo layout, mesmos componentes, mesmos estados, mesmo comportamento, mesmos atalhos e
o mesmo modelo de dados. A implementação de referência é o commit `3fd41c3` de
`github.com/megomes/dailyflow`:

| Arquivo no DailyFlow                                                    | O que define                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `web/src/app/(app)/notes/page.tsx`                                      | A tela inteira: compositor, filtros, cartão, verificação, histórico |
| `web/src/app/api/notes/route.ts`                                        | Listar com histórico, criar                                         |
| `web/src/app/api/notes/[id]/route.ts`                                   | Editar, confirmar, reabrir, excluir, e o 409 quando não pode        |
| `web/db/schema.sql`, tabelas `notes` e `note_log`, função `note_claude` | O modelo de dados e a entrada do Claude                             |
| `web/src/lib/clientContext.ts`                                          | O contexto do aparelho gravado em cada nota                         |
| `web/src/i18n/en.ts`, bloco `notes`                                     | Os textos                                                           |
| `web/src/app/globals.css`, regras de `.notes-page` a `.note.s-archived` | O visual                                                            |
| `CLAUDE.md`, seção "Notas do app"                                       | Como o Claude trabalha a fila                                       |

**O que a tela faz**, resumido do DailyFlow:

- **Compositor** no topo: caixa de texto, tipo (Bug, Ideia, UX, Pergunta, com Ideia
  como padrão), atalho `⌘↵`/`Ctrl+↵` para adicionar. A dica do atalho some em tela de
  toque.
- **Filtros** em botões segmentados com contagem: Todas, Abertas (inclui Em discussão),
  Em andamento, Feitas, Ignoradas. Botão "Arquivadas · N" à direita, que troca a lista
  pelas confirmadas, com "Voltar".
- **Cartão** de cada nota: `#id`, pílula do tipo, pílula do status, data, e uma linha
  com o resumo do aparelho onde foi escrita. Enquanto aberta, "Editar" e "Excluir";
  excluir pede um segundo clique em até 4 segundos.
- **Resolução** escrita pelo Claude: o que foi feito, feito, decidido não fazer,
  decisões, próximos passos, commits como links e quando foi publicado.
- **Verificação** quando a nota está Feita ou Ignorada: "Testou?" com 👍 Funciona, que
  arquiva, e 👎 Ainda não, que pede um comentário e reabre.
- **Seu retorno**: o último comentário do 👎 aparece em destaque até o Claude entregar
  de novo.
- **Histórico** recolhível com cada evento, quem fez (Você ou Claude), o texto anterior
  nas edições, e o "Debug info" com o contexto completo em JSON.
- **Offline**: a nota fica numa fila local, aparece tracejada com "Aguardando conexão",
  e sobe quando a conexão volta, marcada com `queuedOffline`.
- **Regras**: id sequencial que nunca se reutiliza, exclusão lógica, editar e excluir só
  com a nota aberta (senão 409 e o aviso de que precisa reabrir), o texto é do usuário e
  o Claude nunca altera, e só o 👍 do usuário arquiva.

**As únicas adaptações**, porque o ambiente é outro:

| No DailyFlow                      | Aqui                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Nome "Notes"                      | "Feedback", porque "nota" aqui é nota do vault                                                                                     |
| Textos em inglês                  | Em português, como o resto do app, traduzidos um a um do bloco `notes`                                                             |
| Página no menu de navegação       | Botão fixo na barra lateral no desktop e na barra inferior no celular, mais atalho, para abrir de qualquer tela sem perder o lugar |
| Neon e rotas da Vercel            | Worker da Cloudflare com D1 (`services/feedback`), mesmo schema em SQLite                                                          |
| Função `note_claude` no Postgres  | Script `npm run feedback -- <id> <status ou -> "<mensagem>" '<resolução json>'`, que faz o mesmo numa transação do D1              |
| Contexto: `pwa` ou `browser`      | `desktop-tauri` ou `android-expo`, com versão do app, sistema, aparelho, tela, rede, estado do sync e a tela de origem             |
| Tela de origem (rota)             | Tipo de visualização (editor, HTML, PDF, Base, configurações) e extensão do arquivo aberto, **sem o caminho**                      |
| Commits linkando para o dailyflow | Linkando para `megomes/markdown-viewer`                                                                                            |
| "Deployed" com data da Vercel     | Versão da release em que a correção saiu                                                                                           |
| Acesso por código + aparelho      | Token do aparelho; depois da etapa 6, o mesmo do pareamento do sync                                                                |

O visual usa os tokens de tema deste app no lugar das variáveis do DailyFlow, mantendo
a mesma estrutura, espaçamentos e cores relativas (vermelho para bug, amarelo para
ideia, roxo para UX, ciano para pergunta).

**Sem criptografia de ponta a ponta, de propósito.** O Claude precisa ler a fila de
qualquer sessão neste repositório, e o conteúdo é sobre o app, não sobre o vault. Por
isso o contexto grava o tipo de tela e a extensão, mas nunca o caminho nem o nome do
arquivo que estava aberto.

O `CLAUDE.md` deste repositório ganha a seção "Feedback do app", espelho da seção
"Notas do app" do DailyFlow, trocando o SQL do Neon pelo D1 e pelo script.

### 6.10 Web

As notas também abrem num navegador qualquer, num app Next.js publicado na Vercel pela
integração Git dela, com deploy a cada commit na `main`.

**O que faz.** O mesmo que o app Android de leitura (seção 6.8): árvore, busca, leitura
de Markdown, HTML, PDF, Bases, comentários e feedback. O leitor é o mesmo código dos
DOM components do Expo, que já é web.

**Como a criptografia continua de pé.** A Vercel só entrega a página. O navegador baixa
os blobs criptografados direto da Cloudflare e decifra localmente. Nem a Vercel nem a
Cloudflare leem nada.

**Duas camadas, de propósito:**

1. **Senha da web.** Uma só, longa e gerada aleatoriamente, sem cadastro nem gestão de
   usuário. Ela abre a sessão no Worker. Guardada no Worker só como hash Argon2id.
2. **Chave do vault no navegador.** Na primeira vez em cada navegador, ele é pareado
   como qualquer aparelho: QR mostrado pelo celular ou desktop, ou o código de
   recuperação. A chave fica no IndexedDB como chave WebCrypto não exportável. Dali em
   diante, só a senha.

As duas camadas são separadas para que **"esqueci a senha" funcione sem quebrar a
criptografia**. Se a senha da web também fosse a chave do vault, ninguém conseguiria
redefini-la por e-mail sem que o servidor pudesse ler as notas.

**Esqueci a senha.** Um botão na tela de login manda um link de uso único, válido por
15 minutos, para o e-mail do Matheus, fixo na configuração do Worker. O link gera uma
senha nova, mostra uma vez e invalida as sessões abertas. A chave do vault nos
navegadores já pareados não muda. O envio usa o Resend no plano grátis, que manda para
o próprio e-mail da conta sem precisar de domínio.

**Proteções.** Limite de tentativas de login por IP, sessão em cookie `HttpOnly` com
validade de 30 dias, e cabeçalhos que impedem a página de ser embutida em outro site.

**Arquivos grandes e HTML.** PDF e anexo grande baixam sob demanda, como no celular. O
HTML abre num frame isolado, e um service worker entrega os arquivos relativos (CSS,
imagens) decifrados do cache local.

## 7. Arquitetura

**Monorepo**, com npm workspaces:

| Pasta                   | Conteúdo                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/desktop`          | O app Tauri atual                                                                                                |
| `apps/web`              | O app Next.js da web, publicado na Vercel (seção 6.10)                                                           |
| `apps/mobile`           | O app Expo. O editor e o leitor entram como DOM components (`"use dom"`), reaproveitando o CodeMirror do desktop |
| `packages/core`         | Dialeto Markdown do Obsidian, índice, resolução de links, Bases                                                  |
| `packages/sync`         | Motor de sync: chunking, merge, fila, protocolo                                                                  |
| `packages/crypto`       | Chaves e criptografia sobre libsodium                                                                            |
| `packages/revisor-host` | O anfitrião do Revisor Visual no app. O Revisor em si vem das releases dele (seção 6.7)                          |
| `packages/mcp`          | O servidor MCP do vault                                                                                          |
| `services/sync`         | Worker e Durable Object da Cloudflare                                                                            |

O motor de sync e o índice são TypeScript puro, sem depender de Tauri nem de Expo. Cada
app fornece só a camada de arquivo, de cofre de chave e de rede.

**Armazenamento local:**

- Desktop: a pasta do vault, mais um SQLite com o estado do sync e o índice.
- Android: os arquivos na área privada do app e um SQLite (expo-sqlite) com o estado do
  sync e o índice. Chave no `expo-secure-store`.

**Pasta `.markdown-viewer/`** na raiz do vault: estado dos HTML, sessões e versão baixada
do Revisor, regras de ignorar. O Obsidian esconde pastas que começam com ponto. O nome muda quando o app ganhar
nome (ver seção 11).

## 8. A linha de corte

O Obsidian Sync é cancelado quando estas cinco condições forem verdade:

1. **Vault inteiro abre sem quebrar.** O script da seção 6.1 não acha nada quebrado além
   do que já está quebrado no Obsidian, e as três Bases batem.
2. **Sync sem perda por 14 dias seguidos**, com os quatro aparelhos, no vault real. O
   período inclui edição offline em dois aparelhos, edição do Claude Code com o app
   fechado e um PDF de mais de 100 MB.
3. **No celular** dá para ler, buscar, abrir os trackers HTML com o progresso
   sincronizado, abrir um manual de 140 MB e deixar comentário.
4. **Histórico testado**: restaurar uma nota antiga e um arquivo apagado.
5. **Recuperação testada**: instalar num aparelho do zero usando só o código de
   recuperação.

**O dia da troca:**

1. Desligar o Obsidian Sync em todos os aparelhos.
2. Ligar o sync novo no vault real, a partir do Windows.
3. Começar a contar os 14 dias com a assinatura ainda ativa. O vault remoto do Obsidian
   fica como reserva nesse período.
4. Nos 14 dias, se qualquer condição falhar, volta-se ao Obsidian Sync, corrige-se e
   recomeça a contagem.
5. Passados os 14 dias, cancelar.

## 9. Números que não podem piorar

| Medida                                                | Alvo     |
| ----------------------------------------------------- | -------- |
| Abrir o app até a última nota aparecer, desktop       | < 1 s    |
| Abrir o app até a última nota aparecer, celular       | < 1,5 s  |
| Edição num aparelho aparecer em outro, os dois online | < 5 s    |
| Busca no vault inteiro                                | < 100 ms |
| Abrir nota de 1 MB                                    | < 200 ms |
| Montar o índice do vault do zero (844 notas, 82 HTML) | < 3 s    |
| Primeira página de um PDF de 140 MB já baixado        | < 1 s    |

## 10. Etapas

Cada etapa entrega uma funcionalidade inteira, usável no dia a dia, e termina com o
teste de aceite dela.

### Etapa 1: monorepo

Reorganizar o repositório na estrutura da seção 7, sem mudar comportamento. Extrair do
código atual o que vira `packages/core`. CI rodando lint, tipos e testes de todos os
pacotes.

**Aceite:** o app desktop funciona igual a antes, e a release sai pelo workflow atual.

### Etapa 2: feedback do app

Seção 6.9 no desktop: `services/feedback` no ar, a tela igual à do DailyFlow, o script
do Claude e a seção no `CLAUDE.md`. Vem logo no começo para que todas as etapas
seguintes já sejam relatadas e corrigidas por ela.

**Aceite:** comparação lado a lado com a tela do DailyFlow, item a item da seção 6.9. Um
ciclo completo: o Matheus relata do Mac, o Claude implementa e entrega, o Matheus
confirma com 👍 do Windows. Uma nota escrita offline sobe quando a rede volta.

### Etapa 3: vault compatível no desktop

Tudo da seção 6.1.

**Aceite:** o script de links não acha nada novo quebrado. As 20 notas mais abertas do
Matheus, escolhidas por ele, abrem iguais ao Obsidian.

### Etapa 4: HTML, PDF, código e Bases

Seções 6.2, 6.3 e 6.4. O estado dos HTML já é gravado em `.markdown-viewer/state/`,
pronto para sincronizar na etapa 6.

**Aceite:** os três trackers favoritos funcionam e guardam progresso. Os manuais de
140 MB abrem. As três Bases batem com o Obsidian.

### Etapa 5: MCP do vault

Seção 6.6, menos as ferramentas de comentário, que chegam na etapa 7. Registro no
Claude Code e no app do Claude.

**Aceite:** numa sessão real, o Claude acha uma nota pelo alias, roda uma Base e
renomeia uma nota com os links atualizados.

### Etapa 6: sync criptografado entre Mac e Windows

Seção 6.5 inteira, nos dois desktops, numa **cópia** do vault.

Inclui um teste de simulação: vários aparelhos virtuais fazendo edições, renomeações e
exclusões aleatórias, offline e online, verificando ao fim que todos convergem e que
nenhum texto sumiu. Esse teste roda no CI.

**Aceite:** uma semana de uso real na cópia, sem perda. Os casos de conflito da seção
6.5 testados à mão. Um PDF de 140 MB sincronizado.

### Etapa 7: comentários

Duas partes, nesta ordem.

**No repositório do Revisor:** o contrato do anfitrião, a extensão passando a usá-lo
sem mudar de comportamento, o `revisor-embed.js` publicado em cada release, e o campo
opcional da nota do Claude.

**Neste app, no desktop:** o anfitrião da seção 6.7, o Revisor dentro do visualizador
de HTML, comentário em Markdown, o botão "Atualizar Revisor" em Configurações e as
ferramentas de comentário no MCP.

**Aceite:** um ciclo completo. O Matheus comenta um HTML e uma nota, o Claude Code lê
pelo MCP, aplica e marca, e o Matheus confere no app. Depois, uma release nova do
Revisor chega ao app pelo botão, sem release nova do app.

### Etapa 8: Android de leitura

Seção 6.8, no S25 Ultra e no Tab S10 FE, com comentários no toque.

**Aceite:** as condições 1, 3 e 5 da linha de corte verdadeiras.

### Etapa 9: a troca

O dia da troca da seção 8 e os 14 dias de observação.

**Aceite:** as cinco condições da linha de corte. **Cancelar o Obsidian Sync.**

### Etapa 10: web

Seção 6.10: `apps/web` na Vercel, login com a senha gerada, "esqueci a senha" pelo
Resend, pareamento do navegador por QR.

**Aceite:** abrir o vault num navegador recém-instalado, parear pelo QR do celular, ler
uma nota, um tracker HTML e um PDF grande. Redefinir a senha pelo e-mail e entrar de
novo sem parear outra vez.

### Depois do corte

Cada item ganha spec própria quando chegar a vez: edição no mobile, widgets, Galaxy
Watch, tarefas e lembretes, Claude no celular pela ponte do desktop, Bases com edição.

## 11. Em aberto

- **Nome do app.** Decide o nome da pasta `.markdown-viewer/`, do pacote Android e do
  identificador `ai.artell.markdown-viewer`. Melhor decidir antes da etapa 6, porque
  depois do sync ligado a pasta já está em todos os aparelhos.
- **Limites grátis do Durable Object**, conferidos no início da etapa 6.
- **Master Arm.** O estado sincronizado dos HTML cobre parte do que o Master Arm faz com
  os trackers. Decidir se os dois convivem ou se um absorve o outro.
