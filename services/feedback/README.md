# services/feedback

O backend da tela de Feedback do app (seção 6.9 de `docs/spec.md`): um Worker da
Cloudflare com D1, publicado em `https://markdown-viewer-feedback.megomes.workers.dev`.

## Código de acesso

O app manda o código como `Authorization: Bearer`. O Worker guarda só o SHA-256 dele, no
secret `ACCESS_HASH`. O código fica fora do git, em
`~/.markdown-viewer/feedback-access-code.txt`, e é colado uma vez em cada aparelho, na
própria tela de Feedback.

Para trocar o código:

```bash
node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))' > ~/.markdown-viewer/feedback-access-code.txt
node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1],"utf8")).digest("hex"))' ~/.markdown-viewer/feedback-access-code.txt | npx wrangler secret put ACCESS_HASH
```

## Publicar

```bash
npm run deploy -w @markdown-viewer/feedback-service
```

Aplica as migrações pendentes no D1 e publica o Worker.

**Nos gatilhos, `BEGIN` e `END` vão em maiúsculas.** O D1 remoto não reconhece o corpo
do gatilho escrito em minúsculas e responde `incomplete input`, embora o local aceite.

## Rodar local

```bash
npm run dev -w @markdown-viewer/feedback-service
```

Sobe em `http://localhost:8787` com um D1 local. O código de teste vai em
`services/feedback/.dev.vars` (`ACCESS_HASH=<sha-256 em hex>`), e o app aponta para o
Worker local com `VITE_FEEDBACK_URL=http://localhost:8787` num
`apps/desktop/.env.development.local`. Os dois arquivos ficam fora do git.
