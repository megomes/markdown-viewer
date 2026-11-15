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

A chave privada existe em dois lugares, o seu computador e os secrets do
repositório. Nunca no código.

## Preparo, uma vez só

São três passos, e depois deles toda release sai só com uma tag.

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

### 3. Dar a chave privada ao CI

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/markdown-viewer.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

O `gh` pergunta a senha na segunda linha e não a mostra na tela.

## Publicar uma versão

1. Suba o campo `version` de `apps/desktop/src-tauri/tauri.conf.json`. **A tag e esse campo
   têm que dizer o mesmo número**, e o workflow reprova antes de compilar se
   discordarem.
2. Faça o commit e marque:

```bash
git tag v0.2.0 && git push origin main --tags
```

O workflow faz o resto. Ele compila para macOS Apple Silicon, macOS Intel,
Linux e Windows, assina cada pacote, monta o `latest.json` e só então publica a
release.

O workflow cria a release como rascunho de propósito. Enquanto os quatro
sistemas compilam, o `latest.json` já existe e já nomeia pacotes que ainda não
subiram. Um app que perguntasse nessa janela receberia a oferta de uma versão
que não tem como baixar. O rascunho fecha essa janela, porque a release só fica
visível quando o último pacote chegou.

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

A mesma tag `v0.X.Y` também solta o APK do celular, pelo workflow
`.github/workflows/android-release.yml`. É o modelo do runbook "Update OTA de app Android
pelo GitHub Releases", no vault, com três diferenças:

- **Sem token.** O repositório é público, então o app lê as releases sem autenticação.
  Um token dentro de um APK que qualquer um baixa seria de qualquer um.
- **Releases separadas da do desktop.** A do celular sai como `android-v0.X.Y-<run>`, com o
  asset `markdown-viewer-<run>.apk`, e nunca é marcada como latest: o atualizador do
  desktop lê `releases/latest`. O passo que publica o desktop marca a dele como latest de
  propósito.
- **Sai pela tag, não a cada push.** Para soltar um APK sem versão nova, há o botão Run
  workflow em Actions > Release Android.

O `versionCode` é o número da execução do workflow, então cresce sozinho e nunca repete.
A tag tem que bater com `version` em `apps/mobile/app.json`, além do `tauri.conf.json`.

**Assinatura.** A keystore é a compartilhada por todos os apps Android do Matheus
(`~/.android/daily-motion-release.jks`, alias `dailymotion`), nos secrets `KEYSTORE_B64` e
`KEYSTORE_PASSWORD`. O plugin `apps/mobile/plugins/with-release-signing.js` lê do ambiente
no CI e de `apps/mobile/android/local.properties` (`release.keystore`,
`release.passwordFile`) no computador.

**No celular.** O app procura versão nova ao abrir e mostra um aviso no topo do vault;
em Ajustes há "Buscar atualização". Atualizar baixa o APK e abre o instalador do Android
(um toque). Na primeira vez, o Android pede para liberar "Instalar apps desconhecidos"
para o app.

**A primeira instalação** é à mão: baixar o `.apk` da release no próprio celular, ou
`adb install`. Um APK de desenvolvimento (`expo run:android`) é assinado com a chave de
debug e não aceita update por cima: desinstale antes de instalar o da release.
