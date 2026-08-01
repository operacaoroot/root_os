# Root Central — a biblioteca da comunidade dentro do OS

> Absorvida do repo `operacaoroot/root-central` em 01/08/26. O app standalone era
> Next 15 SSG sem backend; aqui virou uma superfície do `mktos_web`, com os dados
> ainda em arquivo e os eventos ligados ao pixel do próprio OS.

Modelo de conteúdo (o que é um material, quais blocos existem, como escrever um
novo): [`CENTRAL_MODELO_CONTEUDO.md`](CENTRAL_MODELO_CONTEUDO.md).
Regras de acessibilidade herdadas: [`CENTRAL_ACESSIBILIDADE.md`](CENTRAL_ACESSIBILIDADE.md).

---

## 1. O que é

Cada material tem um **código de resgate** — a palavra que se comenta no reel.
`/central/r/CODIGO` é o link de uma palavra pra colar em bio, comentário e story:
resolve o código e joga direto no material. Código que não existe cai na
biblioteca com o termo já preenchido na busca.

Além disso: busca em 3 camadas (código exato → vocabulário → texto e problema),
biblioteca com filtros na URL, trilhas com progresso, favoritos e vistos
recentemente — os três guardados **no navegador de quem acessa**, sem conta e
sem nuvem.

## 2. Onde vive

| | |
|---|---|
| Superfície pública | `os.operacaoroot.com/central` (o mesmo `mktos_web`) |
| Rotas | `src/app/central/**` — biblioteca, material, trilhas, favoritos, sobre |
| Resto do módulo | `src/central/**` — components, data, hooks, lib, types |
| Testes | `apps/web/tests/` — 58, rodam com `pnpm --filter @mktos/web test` |

Fica **fora do `AppShell`** (entrada em `PUBLICAS`, junto com a bio e os textos
legais): quem abre `/central` não vê sidebar nem topbar, e não precisa de login.

O prefixo `/central` vive num lugar só, `src/central/lib/rotas.ts`. Mover a
Central pra um domínio próprio — como a bio tem — é trocar `BASE` por `""` e
reescrever o host no middleware, igual `bio.operacaoroot.com` já faz.

## 3. Adicionar ou mudar material

Os materiais são **arquivo versionado**, não banco: `src/central/data/materiais/*.ts`,
agrupados por categoria. Isso é deliberado — `src/central/data/index.ts` valida
tudo com Zod **no import**, então dado inválido derruba o `build`, não a produção.
O que ele garante:

- `codigo` único no catálogo inteiro (sem isso dois materiais disputam o mesmo reel)
- `slug` e `id` únicos
- `categoriaId` existente, `relacionados` apontando pra material que existe
- toda trilha referenciando material que existe

Fluxo: edita o arquivo da categoria → `pnpm --filter @mktos/web test` → commit.
O build quebra com a mensagem exata (`material X: campo — motivo`) se algo não fecha.

## 4. Telemetria — o que a absorção acrescentou

O root-central emitia eventos num `CustomEvent` esperando "um provedor futuro".
O provedor virou o pixel do próprio OS: `src/central/lib/analytics.ts` despacha
para `POST /api/events/track`, o mesmo endpoint público do `public/pixel.js`.

- Todo evento entra como `PixelEvent` com o prefixo **`central_`**
  (`central_busca_feita`, `central_material_aberto`, `central_prompt_copiado`…),
  visível em `/pixels` sem se misturar com a landing.
- O **resgate** é registrado no servidor (`src/central/lib/resgate.ts`), chamado
  pelo Route Handler `/central/r/[codigo]`. Tem que ser server-side: o resgate é
  um redirect, a página some antes de qualquer JS rodar. Registra também o código
  que **não** existe (`metadata.encontrado: "nao"`) — saber que estão comentando
  código morto vale tanto quanto saber qual material converte.
- Identificação: as mesmas chaves do `pixel.js` (`mktos_aid` em localStorage,
  `mktos_sid` em sessionStorage). Quem chegou por uma landing com o pixel e depois
  abriu a Central é **um** visitante, não dois. Nada de dado pessoal sai daqui.

Nenhuma migração de banco foi necessária — `PixelEvent` já dedupa por `event_id`.

## 5. O que mudou em relação ao repo original

| Original | Aqui | Por quê |
|---|---|---|
| Tailwind v4 (`@theme` sobre `:root`) | v3.4 com tokens `central-*` | é a versão do `apps/web`; migrar o painel inteiro pra v4 seria o risco maior da absorção |
| CSS global (`html`, `body`, `::selection`, `:focus-visible`) | tudo escopado em `.central-root` | o painel divide o mesmo documento — sem escopo, o verde-limão vazaria pras telas autenticadas |
| Rotas na raiz (`/materiais`) | prefixadas por `rotas.ts` | a raiz do domínio é o painel |
| `/r/[codigo]` como página SSG | Route Handler dinâmico | como página o redirect saía por `<meta refresh>` com **1s de espera** (o `loading.tsx` abre um Suspense boundary e o Next já não pode mandar `Location`); e evento que só dispara no build não é evento |
| `robots.ts` do app | `src/app/robots.ts` na raiz | `robots.txt` só vale na raiz do domínio. A regra é invertida: nega tudo, libera `/central` — o painel não tem por que ser rastreado |
| `trackEvent` → só CustomEvent | CustomEvent **+** pixel do OS | ver §4 |

## 6. O que ficou de fora

- **E2E do Playwright** (`e2e/fluxos.spec.ts`, 83 linhas) — o `apps/web` não tem
  Playwright montado. Os 58 testes de unidade e componente vieram todos.
- **`brand/`** (guia em PDF, logos) — a fonte canônica da marca já é
  `~/.maquina-carrossel/marcas/root/brand.json`.
- **`reference/`** e os docs de história do projeto (`architecture.md`,
  `implementation-report.md`, `reference-analysis.md`) — ficam no repo de origem.
