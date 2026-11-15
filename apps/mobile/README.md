# apps/mobile

O app Android de leitura (etapa 8, seção 6.8 de `docs/spec.md`). Expo, com o editor do
desktop dentro de um DOM component para ler as notas.

## Rodar no emulador

```bash
npx expo run:android --device emulator-5554
```

As pastas `android/` e `ios/` são geradas pelo Expo e ficam fora do git.

### No Windows, uma vez

O Reanimated (que vem com o expo-router) compila arquivos C++ com caminhos acima de 260
caracteres, e o ninja 1.10 do CMake 3.22 do Android SDK não aceita isso, mesmo com
`LongPathsEnabled` ligado. O que funcionou:

1. Instalar o CMake 3.31.4 pelo SDK Manager (`sdkmanager "cmake;3.31.4"`).
2. Trocar o `ninja.exe` dele por um 1.12 ou mais novo (o original fica como
   `ninja-1.10.2.exe`).
3. Em `android/local.properties`: `cmake.dir=C:/Users/<você>/Android/Sdk/cmake/3.31.4`.

A `react-native-libsodium` também quebrava no Windows por causa das barras invertidas no
caminho do `node_modules`. Isso já vem corrigido em `patches/`, aplicado pelo
`postinstall` da raiz.

## Testar com um servidor local

```bash
npx wrangler dev --port 8788 --ip 0.0.0.0        # em services/sync, com SETUP_HASH no .dev.vars
npm run sync:device -- create <pasta> teste --name mac --password "…" --setup-code <código>
npm run sync:device -- pair <pasta>
```

No app, em "Digitar o código": servidor `http://10.0.2.2:8788` (o computador, visto do
emulador), vault `teste` e o código mostrado.
