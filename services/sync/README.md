# services/sync

O servidor do sync (seção 6.5 de `docs/spec.md`). Depois do `npm run deploy`, o
endereço do Worker vai em `VITE_SYNC_SERVER` (app) e `MARKDOWN_VIEWER_SYNC_URL` (scripts).

- **Worker** (`src/index.ts`): encaminha `/v/<vault>/…` para o Durable Object do vault.
- **Durable Object** `Vault` (`src/vault.ts`), um por vault, com SQLite próprio: o log de
  versões, a versão mais nova de cada arquivo, os aparelhos, os pedaços já guardados e os
  pareamentos pendentes. Avisa os aparelhos por WebSocket quando entra uma versão.
- **R2** `markdown-viewer-sync`: os pedaços dos arquivos, já criptografados, em
  `<vault>/<id>`.

O servidor nunca vê caminho, nome ou conteúdo. Vê o id estável de cada arquivo, o número
de cada versão, qual aparelho mandou e o tamanho dos blobs.

## Código de configuração

Cria o vault e admite aparelhos quando não há outro aparelho para parear. Fica fora do
git, em `~/.markdown-viewer/sync-setup-code.txt`. O Worker guarda só o SHA-256 dele, no
secret `SETUP_HASH`.

## Código de recuperação

`PUT /v/<vault>/keys/recovery`, de um aparelho autenticado, troca só a metade da
recuperação da chave embrulhada; a da senha fica como está. O teste de ponta a ponta,
contra o `wrangler dev`:

```bash
npx tsx packages/sync/scripts/check-recovery.ts --server http://localhost:8788 --setup-code <código local>
```

## Publicar

```bash
npm run deploy -w @markdown-viewer/sync-service
```

## Testar com cópias do vault

```bash
npm run sync:device -- create <pasta A> <vault> --name mac --password "..."
npm run sync:device -- pair <pasta A>
npm run sync:device -- join <pasta B> <vault> <código> --name win
npm run sync:device -- sync <pasta B>
```
