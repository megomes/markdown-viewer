# Design system

Referência: uma interface escura de assistente ("Query"), azul-índigo profundo, em que cada
região é um cartão flutuando sobre uma moldura preta. O código está em
[`apps/desktop/src/ui/design-system.css`](../apps/desktop/src/ui/design-system.css), uma
camada importada depois de `styles.css`: `styles.css` diz o que cada peça é e como se
organiza, `design-system.css` diz a aparência.

## Princípios

1. **Moldura e cartões.** O fundo da janela é quase preto. A barra lateral, a área de
   trabalho, diálogos e menus são cartões com raio de 16px, um fio de borda branco a 7% e
   uma luz que vem de cima (realce interno de 1px no topo e sombra longa embaixo).
2. **Duas cores, cada uma com um papel.** Índigo é a marca e a luz atrás dos painéis, nunca
   estado. Coral vermelho é o que está escolhido ou pede atenção: o espaço ativo, a marca de
   não salvo, tags, o cursor.
3. **Verde só significa ligado.** Interruptores ligados são verdes e nada mais usa verde de
   interface.
4. **Uma ação primária por tela, branca.** O botão principal é branco com texto escuro (o
   "enviar" e o "Invite teammates" da referência). Os outros botões são vidro índigo.
5. **Hierarquia por luminosidade.** Itens inativos ficam apagados; o escolhido fica branco e,
   na árvore, ganha um pequeno cartão próprio com borda.

## Tokens

| Papel                                    | Escuro                        | Claro                         |
| ---------------------------------------- | ----------------------------- | ----------------------------- |
| Moldura (`--bg-app`)                     | `#050508`                     | `#dfe3ec`                     |
| Barra lateral (`--bg-sidebar`)           | `#0c0c17`                     | `#f7f7fb`                     |
| Área de trabalho (`--bg-content`)        | `#0a0a14`                     | `#ffffff`                     |
| Superfícies 1 a 3                        | `#11111e` `#161627` `#1c1c31` | `#fafafd` `#f2f2f8` `#eaeaf3` |
| Texto primário / secundário / terciário  | `#f4f4f8` `#a7a7b9` `#6e6e82` | `#12121a` `#4d4d5e` `#7b7b8e` |
| Acento coral (`--accent`)                | `#ff4d4f`                     | `#e5383b`                     |
| Coral como texto (`--accent-text`)       | `#ff7b7d`                     | `#c42a2d`                     |
| Marca índigo (`--brand`, `--brand-deep`) | `#6b68f5` a `#3b39a8`         | `#5552e6` a `#3b39a8`         |
| Brilho (`--glow`)                        | índigo a 20%                  | índigo a 10%                  |
| Ligado (`--positive`)                    | `#34d27b`                     | `#1fae5f`                     |
| Ação primária (`--primary-bg`)           | `#f4f4f8`, texto `#0b0b12`    | `#12121a`, texto branco       |

Materiais compostos:

- **Painel** (`--panel-bg`, `--panel-border`, `--panel-highlight`, `--panel-shadow`):
  gradiente de cima para baixo, fio de borda, realce no topo, sombra longa.
- **Vidro índigo** (`--field-bg`, `--field-border`): campos de busca, botões secundários,
  pílulas de espaço inativas, o selo "Salvo".
- **Escolhido** (`--chosen-bg`, `--chosen-border`): a linha ativa da árvore.

Raios: 8, 10, 12 e 16px, e pílula. Transição padrão: 160ms com curva de saída suave.

## Tipografia

Inter variável. Títulos em peso 600 com espaçamento -0,01em a -0,02em. Rótulos de seção em
caixa alta, 10px, peso 500, espaçamento 0,08em, cor terciária ("FEATURES", "CHAT HISTORY").
Corpo em cinza secundário; o texto só fica branco quando é título ou está escolhido.

## Componentes

- **Abas** (documentos e o painel Sumário/Links/Comentários): texto apagado; a ativa fica
  branca com uma barra branca de 3px e pontas arredondadas embaixo. As do painel lateral
  são em caixa alta, como "TOOLS / FILES".
- **Espaços** (vault, outras pastas, Arquivos): pílulas de vidro; a ativa tem contorno e
  texto coral, como o seletor "Query 3.5".
- **Chips de atenção**: coral com borda tracejada (tags e aliases do frontmatter, o selo de
  não salvo), como "3D Object" e "Documentation".
- **Árvore**: linhas-guia verticais nas pastas abertas; a linha ativa vira cartão.
- **Estado vazio**: o único lugar com o céu estrelado da referência, atrás do cartão. Nunca
  atrás de texto sendo lido.
- **Logo**: quadrado com gradiente índigo e o M branco.

## O que ficou de fora de propósito

- Estrelas atrás do editor: atrapalham a leitura.
- Fotos de perfil, convite de equipe e integrações: o app é de uma pessoa só.
- A tela de Feedback tem tokens próprios (`feedback.css`) e não foi tocada.
