# Como sai uma versão

O app se atualiza sozinho. Quem já instalou não precisa voltar ao GitHub: na
abertura o app pergunta se há versão nova, e se houver, oferece instalar.

## Como funciona

Cada release publica, além dos instaladores, um arquivo `latest.json` que diz
qual é a versão mais recente e onde está o pacote de cada sistema. O app
consulta esse arquivo em
`https://github.com/megomes/markdown-viewer/releases/latest/download/latest.json`.

Cada pacote vai assinado. O app carrega a chave pública e recusa qualquer
pacote assinado com outra chave, e é isso que impede que alguém no meio do
caminho troque o instalador.

A chave privada existe em dois lugares, o Windows e o Mac do Matheus, os dois em
`~/.tauri`. Nunca no código, nunca no GitHub.

## Preparo, uma vez só

São três passos, e depois deles toda release sai com um comando.

### 1. Gerar o par de chaves

```bash
npm run tauri signer generate -- -w ~/.tauri/markdown-viewer.key
```

O comando pede uma senha e escreve dois arquivos: `markdown-viewer.key`, que é
a chave privada, e `markdown-viewer.key.pub`, que é a pública.

**Guarde os dois arquivos e a senha num gerenciador de senhas.** Sem a chave
privada, nenhuma versão futura consegue se apresentar como continuação das que
já saíram. Todo mundo que já instalou fica parado na versão que tem, e só sai
de lá baixando o instalador na mão.

### 2. Pôr a chave pública no app

Cole o conteúdo de `~/.tauri/markdown-viewer.key.pub` no campo `pubkey` de
`apps/desktop/src-tauri/tauri.conf.json`, dentro de `plugins.updater`.

### 3. Levar a chave ao Mac

A mesma chave (`markdown-viewer.key`, `.key.pub` e `.key.password`) vai para
`~/.tauri` no Mac. Com outra chave, o Mac publica pacotes que o app recusa.

## Publicar uma versão

1. Suba a versão (`tauri.conf.json`, `Cargo.toml`, `apps/mobile/app.json` e os outros
   lugares de sempre) e faça o commit na `main`, já enviado ao GitHub.
2. No Windows, na raiz:

```bash
npm run release
```

Tudo compila nas máquinas do Matheus, **nunca no GitHub** (2026-11-18: a fila das
máquinas macOS do GitHub chegou a 15 minutos sem começar, e os minutos do Actions de um
repositório privado acabam rápido). O GitHub só guarda o código e os arquivos da release,
que é de onde os apps baixam as atualizações. Não há workflows no repositório.

- **Windows e APK:** neste computador, com os caches quentes.
- **Mac:** no Mac do Matheus, por SSH (host `mac` no `~/.ssh/config`;
  `scripts/mac-build.mjs`). O script manda por SSH o `git archive` do commit lançado para
  `~/.markdown-viewer-release` no Mac, compila lá e traz o `.dmg` e o `.app.tar.gz`. A
  pasta de build guarda `node_modules` e o `target` do Cargo entre uma versão e outra.

Tudo compila antes de qualquer coisa ser publicada. Depois o script marca a tag `v0.X.Y`,
publica o APK e publica a release do desktop com o `latest.json` completo.

**Com o Mac fora da rede**, a versão sai para Windows e Android, e o `latest.json` fica sem
o Mac: o app do Mac simplesmente não vê a atualização ainda. Quando o Mac voltar:

```bash
npm run release -- --only mac
```

Isso compila o Mac a partir da tag já lançada, junta os arquivos dele à mesma release e
acrescenta as entradas dele no `latest.json`.

Variações: `npm run release -- --only android` solta só um APK novo (sem tag nem
desktop); `--only desktop` pula o celular.

O script precisa da chave do atualizador em `~/.tauri` (`markdown-viewer.key` e
`markdown-viewer.key.password`), do `apps/desktop/.env.local` com os servidores de
produção e da keystore do Android em `apps/mobile/android/local.properties`.

Linux e Mac Intel saíram da lista na 0.14: nenhum aparelho usa.

## Testar no celular sem lançar

Com o celular conectado (cabo, ou depuração sem fio: Opções do desenvolvedor >
Depuração sem fio > Parear com código, depois `adb pair IP:PORTA` e `adb connect IP:PORTA`):

```bash
npm run phone
```

Compila o APK de release aqui e instala por cima do app, mantendo o vault. Ele usa a
mesma chave e a mesma conta do número do build (minutos desde 2026) que as releases, então a
próxima release continua chegando como atualização.

## Quando dá errado

**O app não oferece nada.** Abra o `latest.json` no navegador. Se ele responde
404, a release ficou em rascunho, porque algum sistema falhou na compilação. Se
ele responde e mesmo assim o app ignora, compare a `version` de dentro dele com
a versão que o app já tem: só uma versão maior é oferecida.

**"Signature verification failed".** O pacote foi assinado com uma chave
diferente da que o app carrega. Acontece depois de gerar um par novo sem
atualizar o `pubkey`. A correção é atualizar o `pubkey` e publicar de novo.

**O `npm run build:desktop` local parou de funcionar.** O projeto agora produz
pacote de atualização, e pacote de atualização precisa de assinatura. Exporte
as duas variáveis antes de compilar:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/markdown-viewer.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="a senha"
```

## O que ainda não está resolvido

O app não é assinado com Developer ID da Apple. Na primeira instalação, baixada
pelo navegador, o macOS põe o arquivo em quarentena e o Gatekeeper recusa abrir
no clique duplo. Quem instala precisa abrir pelo menu de contexto uma vez.

Falta saber o que o Gatekeeper faz **depois** de uma atualização entregue pelo
próprio app, que não passa pelo navegador. Matheus confere isso na primeira
release e escreve aqui o que aconteceu. A assinatura descrita neste documento é
a do Tauri, que é a que o app confere antes de instalar, e ela não substitui a
da Apple.

## O app Android

O `npm run release` também solta o APK do celular, compilado neste computador. É o
modelo do runbook "Update OTA de app Android
pelo GitHub Releases", no vault, com três diferenças:

- **Sem token.** O repositório é público, então o app lê as releases sem autenticação.
  Um token dentro de um APK que qualquer um baixa seria de qualquer um.
- **Releases separadas da do desktop.** A do celular sai como `android-v0.X.Y-<build>`, com o
  asset `markdown-viewer-<build>.apk`, e nunca é marcada como latest: o atualizador do
  desktop lê `releases/latest`. O passo que publica o desktop marca a dele como latest de
  propósito.
- **Sai com a versão, não a cada push.** Para soltar um APK sem versão nova:
  `npm run release -- --only android`.

O `versionCode` são os minutos desde 1/1/2026, a mesma conta no `release` e no `phone`:
cresce sozinho. A versão em `apps/mobile/app.json` tem que bater
com a do `tauri.conf.json`.

**Assinatura.** A keystore é a compartilhada por todos os apps Android do Matheus
(`~/.android/daily-motion-release.jks`, alias `dailymotion`). O plugin
`apps/mobile/plugins/with-release-signing.js` lê de `apps/mobile/android/local.properties`
(`release.keystore`, `release.passwordFile`).

**No celular.** O app procura versão nova ao abrir e mostra um aviso no topo do vault;
em Ajustes há "Buscar atualização". Atualizar baixa o APK e abre o instalador do Android
(um toque). Na primeira vez, o Android pede para liberar "Instalar apps desconhecidos"
para o app.

**A primeira instalação** é à mão: baixar o `.apk` da release no próprio celular, ou
`adb install`. Um APK de desenvolvimento (`expo run:android`) é assinado com a chave de
debug e não aceita update por cima: desinstale antes de instalar o da release.
