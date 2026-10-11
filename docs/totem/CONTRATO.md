# Módulo Totem — contrato de construção (Sr. aGranel)

Versão 1, 11/10/2026. Este arquivo é a fonte única para quem constrói o módulo.
Quem mudar uma decisão daqui muda o arquivo no mesmo commit.

## 1. O que o módulo faz

O módulo `totem` serve uma rede de lojas a granel (Sr. aGranel: 22 lojas, de 1 a
3 totens cada, número que cresce ou encolhe sem custo para o sistema).

- O **totem** é um site em `/totem`, aberto num navegador travado. Não exige
  instalar nada e funciona sem internet depois da primeira sincronização. O
  cliente busca um produto pelo nome e vê a ficha nutricional, a composição, os
  alergênicos, os selos, o **lote**, a **data de reposição** e a **validade**.
- O **preço** existe no modelo e no painel, mas fica desligado por padrão. Com a
  chave desligada a API pública nunca devolve preço.
- O **lote** nasce na produção central. O CD registra o lote e a remessa para a
  loja, e a loja confirma a reposição. Quando a loja não confirma, o totem
  mostra o lote da última remessa, marcado como presumido.
- A **etiqueta com QR** aponta para `/p/<codigo>`, que abre a ficha do produto e
  do lote no celular do cliente.
- O **cadastro** do cliente (CPF, telefone e consentimento) gera um cupom de uma
  campanha. A política de privacidade fica em `/totem/privacidade`.
- O **painel** (`/totem-gestao`) atende o dono da rede, que vê tudo, o CD, o
  gerente de cada loja, que vê só a loja dele, e o operador da loja.
- O ingestor do Director (ERP/PDV da Processa) vem depois. O campo
  `codigoDirector` já existe para ele.

Fora do escopo desta entrega: integração com o Director, envio de SMS ou
WhatsApp, impressão direta em ESC/POS ou ZPL (a etiqueta sai por impressão do
navegador) e cobrança.

## 2. Decisões de banco

1. **Toda tabela Totem é `escopo: 'tenant'`**, com `orgId String` obrigatório,
   **sem default**, FK para `Org` e gravado explicitamente pelo serviço. É o
   padrão de 70 tabelas do schema. Nenhuma tabela Totem usa a sentinela `''`
   nem o gatilho `mktos_orgid_do_pai`, e nenhuma entra em
   `FILHOS_COM_ORGID_REDUNDANTE`.
2. **O pai é conferido no serviço.** Antes de gravar um filho (por exemplo um
   `TotemLote` de um `TotemProduto`), o serviço lê o pai pelo id dentro do
   contexto do tenant, com RLS ligada. Se o pai não aparece, a resposta é 404.
   Isso cobre o cruzamento de empresa que a FK sozinha não cobre. A limitação
   fica registrada na `nota` de cada entrada de `ALVOS`, como já acontece com
   `FinanceTransaction`.
3. **Se algum teste existente exigir o padrão de gatilho** para estas tabelas,
   adote o padrão do repositório (sentinela, gatilho, `FILHOS_COM_ORGID_REDUNDANTE`,
   `LINHA_DE_FILHO`, `REF_DA_SEMENTE` e a contagem do `toBe(23)`) e anote aqui.
4. **Policies.** Uma migration só, no formato de
   `apps/api/prisma/migrations/20260924010000_onboarding_do_cliente/migration.sql`:
   cabeçalho com o desenho e o CAMINHO DE VOLTA, `app_rls_aplicar_policies` por
   tabela, `GRANT ... TO mktos_app` condicionado à existência do papel e o
   bloco `DO` final que confere RLS, FORCE e policies.
   - Padrão: `'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'`
     para leitura e escrita.
   - `TotemDispositivo` e `TotemEtiqueta` recebem na **leitura**
     `... OR public.app_resolucao_publica()`, como `OnboardingConvite`, porque
     os resolvers públicos as consultam sob a sentinela.
   - Toda expressão nova precisa estar no conjunto declarado que o caso "toda
     expressão de policy está no conjunto declarado" confere.
5. **Teste de isolamento.** Cada tabela nova entra em `ALVOS` de
   `apps/api/test/tenant-isolation.test.ts` e recebe semente nas duas empresas
   dentro de `semear(c, rotulo, vec)`.
6. **Ids** são `String @id @default(uuid())`. Datas de auditoria seguem
   `criadoEm DateTime @default(now())` e `atualizadoEm DateTime @updatedAt`.
   Toda tabela tem `@@index([orgId])`.

## 3. Os models

Nomes de coluna em português, como o resto do domínio recente. `?` = opcional.

| Model | Campos |
|---|---|
| `TotemConfig` | `orgId @unique`; `nomeExibicao`; `corPrimaria`; `corFundo`; `logoUrl?`; `precoLigado Boolean @default(false)`; `cadastroLigado Boolean @default(true)`; `tempoOciosoSeg Int @default(60)`; `controladorNome`; `controladorDocumento?`; `controladorEndereco?`; `encarregadoNome?`; `encarregadoContato?`; `politicaVersao String`; `mensagemBoasVindas?` |
| `TotemLoja` | `codigo` (`@@unique([orgId, codigo])`); `nome`; `cidade?`; `endereco?`; `ativa Boolean @default(true)`; `exemplo Boolean @default(false)` |
| `TotemUsuarioLoja` | `userId` (FK User); `lojaId` (FK TotemLoja); `@@unique([orgId, userId, lojaId])`. É o vínculo que restringe o gerente e o operador às lojas deles |
| `TotemDispositivo` | `lojaId`; `nome`; `codigoAtivacaoHash String? @unique`; `ativacaoExpiraEm DateTime?`; `tokenHash String? @unique`; `ativadoEm?`; `revogadoEm?`; `vistoEm?`; `versaoApp?`; `catalogoVersao?`; `userAgent?` |
| `TotemProduto` | `codigo` (`@@unique([orgId, codigo])`); `codigoDirector?`; `nome`; `nomeBusca` (minúsculo, sem acento, mantido pelo serviço); `categoria?`; `composicao?`; `beneficios?`; `alergenicos?`; `porcaoG Decimal?`; `porcaoDescricao?`; `nutricional Json` (lista `{nutriente, quantidade, unidade, vd}`); `selos String[]`; `validadeDiasPadrao Int?`; `precoCentavos Int?`; `unidadePreco String?` (`kg`, `100g`, `un`); `imagemUrl?`; `ativo Boolean @default(true)`; `exemplo Boolean @default(false)`; `fonteNutricional?` |
| `TotemLote` | `produtoId`; `codigo` (`@@unique([orgId, produtoId, codigo])`); `fabricadoEm DateTime?`; `validadeEm DateTime`; `origem String` (`producao_central` ou `manual_loja`); `lojaOrigemId String?` (quando manual); `observacao?`; `criadoPor?` |
| `TotemRemessa` | `lojaId`; `status String` (`enviada`, `recebida`, `cancelada`); `enviadaEm`; `recebidaEm?`; `recebidaPor?`; `observacao?`; `criadoPor?` |
| `TotemRemessaItem` | `remessaId` (cascade); `loteId`; `produtoId`; `quantidade Decimal?`; `unidade String?` |
| `TotemReposicao` | `lojaId`; `produtoId`; `loteId`; `repostoEm DateTime`; `origem String` (`remessa`, `manual`); `registradoPor?` |
| `TotemEtiqueta` | `lojaId`; `produtoId`; `loteId?`; `codigo String @unique` (10 caracteres base32 Crockford, aleatório, sem relação com ids); `impressaEm?`; `quantidade Int @default(1)`; `revogadaEm?` |
| `TotemCampanha` | `nome`; `chamada`; `tipoBeneficio String` (`percentual`, `valor`, `brinde`); `valorBeneficio Decimal?`; `descricaoBeneficio?`; `validadeDias Int`; `inicioEm`; `fimEm?`; `ativa Boolean`; `lojaIds String[]` (vazio = todas) |
| `TotemCliente` | `cpfHash` (`@@unique([orgId, cpfHash])`); `cpfMascarado`; `telefone` (E.164); `nome?`; `lojaOrigemId?`; `canalOrigem String` (`totem`, `qr`); `aceitaCampanhas Boolean`; `anonimizadoEm?` |
| `TotemConsentimento` | `clienteId`; `politicaVersao`; `finalidades String[]` (`cupom`, `campanhas`); `canal`; `lojaId?`; `dispositivoId?`; `aceitoEm`; `revogadoEm?` |
| `TotemCupom` | `campanhaId`; `clienteId`; `codigo` (`@@unique([orgId, codigo])`, 8 caracteres base32 Crockford); `status String` (`emitido`, `usado`, `expirado`, `cancelado`); `emitidoEm`; `validoAte`; `usadoEm?`; `usadoLojaId?`; `usadoPor?`; `@@unique([orgId, campanhaId, clienteId])` |
| `TotemEvento` | `lojaId?`; `dispositivoId?`; `tipo String` (`busca`, `busca_sem_resultado`, `ver_produto`, `cadastro`, `sincronizou`, `qr_aberto`); `produtoId?`; `termo?` (até 80 caracteres); `ocorridoEm`; `@@index([orgId, ocorridoEm])` |

Relações `onDelete`: filhos de remessa em cascata; o resto `Restrict`, para não
perder histórico de lote por engano. Lojas e produtos se desativam e não se
apagam.

## 4. Regras de negócio

- **Lote vigente de um produto numa loja**, nesta ordem:
  1. a `TotemReposicao` mais recente daquela loja e produto, com `presumido=false`;
  2. o item da `TotemRemessa` `recebida` mais recente, com `presumido=false` e
     `repostoEm` igual a `recebidaEm`;
  3. o item da `TotemRemessa` `enviada` mais recente, com `presumido=true` e o
     texto "lote recebido em DD/MM" (a data é `enviadaEm`).
  Sem nenhum dos três, o produto aparece sem lote e o painel o lista como
  pendência. A função é única: `loteVigentePorProduto(tx, lojaId, produtoIds?)`
  em `apps/api/src/totem/lote/lote-vigente.ts`, devolvendo
  `Map<produtoId, { loteId, codigo, fabricadoEm, validadeEm, repostoEm, presumido, origem }>`.
  `origem` é a coluna `TotemLote.origem` (`producao_central` ou `manual_loja`),
  e não o caminho pelo qual o lote foi achado; esse caminho já está em
  `presumido`. Quem roda dentro do Nest usa `LoteVigenteService`
  (`lote/lote-vigente.service.ts`, exportado por `TotemLoteModule`), que só
  embrulha a função com o `PrismaService`; teste chama a função direto com o
  client.
- **Validade**: lote vencido aparece no totem com o aviso "consulte um atendente"
  e entra no painel como alerta. Lote a 15 dias ou menos de vencer entra no
  painel como atenção.
- **Preço**: com `precoLigado=false`, `precoCentavos` e `unidadePreco` não saem
  em nenhuma resposta pública (catálogo, `/p`, eventos). Isso tem teste.
- **CPF**: valida dígitos verificadores. Grava `cpfHash = HMAC-SHA256(TOTEM_CPF_PEPPER, cpf só dígitos)`
  em hex e `cpfMascarado = ***.456.789-**`. O CPF em claro nunca é gravado nem
  registrado em log. Sem `TOTEM_CPF_PEPPER` no ambiente a API sobe, e o cadastro
  responde 503 com mensagem clara.
- **Telefone**: celular brasileiro, normalizado para `+55DDNNNNNNNNN`.
- **Cupom**: um por cliente por campanha. Cadastro repetido com o mesmo CPF
  devolve o mesmo cupom se ainda vale, sem mostrar telefone nem dado guardado.
  Código sem caracteres ambíguos.
- **Consentimento**: caixa de seleção explícita e desmarcada para a política.
  Campanhas é uma segunda caixa, opcional. Sem a primeira, nada é gravado.
- **Escopo do gerente**: quem tem `totem.rede` vê todas as lojas; os demais veem
  só as lojas de `TotemUsuarioLoja`. A função é única:
  `escopoDeLojas(tx, user)` em `apps/api/src/totem/comum/escopo.ts`, devolvendo
  `'todas'` ou a lista de ids. Todo endpoint que recebe `lojaId` confere contra
  ela e responde 404 (não 403) quando a loja está fora do escopo.
- **Dispositivo**: o gerente gera no painel um código de ativação de 8
  caracteres, válido por 30 minutos, mostrado uma vez. O totem troca o código
  por um token de 32 bytes (base64url). Só o SHA-256 do código e do token é
  gravado. Revogar no painel derruba o totem na sincronização seguinte (401), e
  ele volta para a tela de ativação.

## 5. Permissões e papéis

Em `packages/shared/src/permissions.ts`, no formato `dominio.acao`:

| Chave | Para quê |
|---|---|
| `totem.ver` | abrir o painel |
| `totem.rede` | ver e gerir todas as lojas |
| `totem.lojas` | criar e editar lojas, vincular usuários a lojas, editar a configuração |
| `totem.produtos` | catálogo, ficha nutricional e preço |
| `totem.dispositivos` | ativar, renomear e revogar totens (no escopo de lojas) |
| `totem.lotes` | lotes e remessas (CD) |
| `totem.reposicao` | confirmar recebimento, registrar reposição e lote manual na loja |
| `totem.etiquetas` | gerar e imprimir etiquetas |
| `totem.campanhas` | campanhas |
| `totem.clientes` | ver clientes e consentimentos (dado pessoal) |
| `totem.cupons` | consultar e dar baixa em cupom |

Papéis novos em `ROLES`: `totem_rede` (todas as `totem.*`), `totem_cd`
(`ver`, `lotes`, `etiquetas`, `rede`), `totem_gerente` (`ver`, `dispositivos`,
`reposicao`, `etiquetas`, `cupons`) e `totem_operador` (`ver`, `reposicao`,
`cupons`). `admin_master` já recebe todas. `diretor` recebe todas as `totem.*`.
Ritual depois de mudar: `pnpm --filter @mktos/shared build`, depois
`db:sync-permissions` no banco local, depois login de novo.

## 6. Módulo, rotas e prefixos

- `MODULOS` (em `packages/shared/src/nav.ts`) ganha `'totem'`.
- Prefixos de controller, todos em `MODULO_POR_PREFIXO` como `totem`:

| Prefixo | Dono | Autenticação | Conteúdo |
|---|---|---|---|
| `totem-gestao` | frente A | JWT + permissão | lojas, vínculos, dispositivos, produtos, configuração, resumo do painel, eventos |
| `totem-lotes` | frente C | JWT + permissão | lotes, remessas, reposições, etiquetas, pendências de lote |
| `totem-campanhas` | frente D | JWT + permissão | campanhas, clientes, consentimentos, cupons |
| `totem-publico` | frente B | token do dispositivo (`X-Totem-Token`) e ativação | ativar, catálogo, eventos em lote, batimento |
| `totem-etiqueta` | frente C | código da etiqueta | dados públicos de `/p/<codigo>` |
| `totem-cadastro` | frente D | token do dispositivo ou código de etiqueta | cadastro, cupom, texto da política |

- O gate de módulos deixa requisição anônima passar. Por isso todo serviço
  público confere que `Org.modulos` contém `totem` e responde 404 se não
  contiver. Helper único: `exigirModuloTotem(tx, orgId)` em
  `apps/api/src/totem/comum/modulo.ts`.
- Resolvers novos em `apps/api/src/common/tenant-publico.ts`, no molde de
  `resolverTenantDoConvite`: `resolverTenantDaAtivacao(prisma, codigoHash)`,
  `resolverTenantDoTotem(prisma, tokenHash)` e
  `resolverTenantDaEtiqueta(prisma, codigo)`. A lista exata cobrada em
  `apps/api/test/rotas-publicas-tenant.test.ts` (perto da linha 208) ganha os três.
- Limite por IP e hora em toda rota pública, no padrão `TetoPorOrigem` de
  `apps/api/src/onboarding/trilho/link-publico.controller.ts`: ativação 20/h,
  cadastro 30/h, `/p` 600/h, catálogo e eventos 1200/h por dispositivo.
- `SMOKE_ROTAS` padrão em `apps/api/scripts/smoke-boot.mjs` ganha uma rota de
  cada prefixo acima.
- Todo corpo de requisição é validado com Zod. Os schemas ficam em
  `packages/shared/src/totem/` e saem por `packages/shared/src/index.ts`.
- **Rotas provisórias da base**, uma por prefixo, para o smoke e para cada
  frente ter onde começar (todas respondem 501 "Em construção." depois das
  conferências):

| Rota | Antes do 501 |
|---|---|
| `GET /api/totem-gestao/resumo` | JWT, `totem.ver` |
| `GET /api/totem-lotes/pendencias` | JWT, `totem.ver` |
| `GET /api/totem-campanhas` | JWT, `totem.campanhas` |
| `GET /api/totem-publico/catalogo` | teto `catalogo`; sem `X-Totem-Token` no formato, 401 |
| `GET /api/totem-etiqueta/:codigo` | teto `etiqueta`; código fora do formato, 400 |
| `GET /api/totem-cadastro/politica` | teto `cadastro`; sem token nem etiqueta no formato, 401 |

  O smoke pede `/api/totem-etiqueta/x` e conta com o **400 do formato**: quem
  substituir o controller mantém a validação do código antes de qualquer
  consulta, senão o smoke passa a ver 404 e acusa módulo fora do `AppModule`.
- **Credencial do QR no cadastro**: o celular que veio pela etiqueta manda o
  código no cabeçalho `X-Totem-Etiqueta` (`TOTEM_CABECALHO_ETIQUETA`), nunca em
  query string, para o código não ficar em log de acesso nem no histórico.

## 7. Web

| Rota | Dono | Pública | O que é |
|---|---|---|---|
| `/totem` | B | sim | PWA do quiosque; sem token mostra a ativação |
| `/totem/privacidade` | D | sim | política do Sr. aGranel (controlador) com a Root como operadora |
| `/p/[codigo]` | C | sim | ficha do produto e do lote pela etiqueta, com chamada para o cadastro |
| `/totem-gestao` | A | não | resumo, lojas, produtos, dispositivos, configuração, usuários |
| `/totem-gestao/lotes`, `/remessas`, `/reposicoes`, `/etiquetas` | C | não | operação de lote e etiqueta |
| `/totem-gestao/campanhas`, `/clientes`, `/cupons` | D | não | cadastro e cupom |

- `PUBLICAS` em `apps/web/src/components/AppShell.tsx` ganha `'/totem'` e `'/p'`.
  O casamento é exato ou por prefixo com barra, então `/totem` não abre
  `/totem-gestao`.
- `NAV` ganha um item `Totem` (`href: '/totem-gestao'`, `icon: 'MonitorSmartphone'`,
  `permission: 'totem.ver'`, `modulo: 'totem'`, seção de módulo `execucao`).
- O layout de `/totem-gestao` (frente A) tem a navegação interna com todas as
  subpáginas, inclusive as das frentes C e D.
- **Offline**: o service worker fica em `apps/web/public/totem/sw.js` (escopo
  `/totem/`) e guarda o shell e os assets de `/_next/static`. O catálogo vai
  para IndexedDB. A busca roda no aparelho, sem acento e sem diferença de
  maiúscula, tolerando erro de digitação simples. A sincronização acontece a
  cada 5 minutos e na volta da rede. Eventos ficam numa fila local e sobem em
  lote. O cadastro exige rede: sem rede o botão some e aparece o aviso de usar o
  QR da etiqueta no celular.
- **Quiosque**: tela cheia no primeiro toque, sem menu de contexto, sem seleção
  de texto, sem zoom de pinça, teclado virtual próprio (ligado por padrão),
  volta à tela inicial depois de `tempoOciosoSeg` sem toque e nenhum link para
  fora de `/totem`. Um gesto escondido (5 toques no canto superior esquerdo)
  abre a tela de manutenção com loja, nome do aparelho, última sincronização e
  o botão "sincronizar agora".
- Texto de interface em português do Brasil, frase inteira, sem jargão.
  Datas em DD/MM/AAAA.

## 8. Pacotes compartilhados entre frentes (criados pela base)

A base cria estes arquivos com a assinatura final e corpo provisório. A frente
dona substitui o corpo e mantém a assinatura.

| Arquivo | Dono do corpo | Assinatura |
|---|---|---|
| `apps/api/src/totem/lote/lote-vigente.ts` | C | `loteVigentePorProduto(tx, lojaId, produtoIds?)` (seção 4) |
| `apps/api/src/totem/comum/escopo.ts` | base (completo) | `escopoDeLojas(tx, user)`, `exigirLojaNoEscopo(tx, user, lojaId)` |
| `apps/api/src/totem/comum/modulo.ts` | base (completo) | `exigirModuloTotem(tx, orgId)` |
| `apps/api/src/totem/comum/segredos.ts` | base (completo) | `hashToken`, `gerarCodigo(n)` (base32 Crockford), `gerarToken()` |
| `apps/web/src/components/totem/CadastroCupom.tsx` | D | `<CadastroCupom origem="totem"|"qr" credencial={{ token } | { etiqueta }} aoConcluir={fn} aoCancelar={fn} />` |
| `apps/web/src/lib/totem/api-publica.ts` | base (completo) | cliente `fetch` das rotas públicas, com `X-Totem-Token` |
| `packages/shared/src/totem/*.ts` | cada frente no seu arquivo | `comum.ts` (base), `gestao.ts` (A), `publico.ts` (B), `lote.ts` (C), `cadastro.ts` (D) |

## 9. Arquivos por frente (sem sobreposição)

- **Base**: `apps/api/prisma/schema.prisma`, a migration, `tenant-isolation.test.ts`,
  `rotas-publicas-tenant.test.ts`, `tenant-publico.ts`, `permissions.ts`,
  `nav.ts`, `modulos.ts`, `app.module.ts`, `smoke-boot.mjs`, `AppShell.tsx`,
  `packages/shared/src/index.ts`, `apps/api/src/totem/comum/**`, os stubs da
  seção 8, os quatro módulos Nest vazios (`TotemGestaoModule`,
  `TotemPublicoModule`, `TotemLoteModule`, `TotemCadastroModule`) registrados no
  `AppModule`, `apps/api/prisma/seed-totem.ts` e o script `db:seed:totem`, e
  este contrato.
- **Frente A (painel)**: `apps/api/src/totem/gestao/**`, `packages/shared/src/totem/gestao.ts`,
  `apps/web/src/app/totem-gestao/{layout.tsx,page.tsx,lojas,produtos,dispositivos,configuracao,usuarios}/**`.
- **Frente B (quiosque)**: `apps/api/src/totem/publico/**`, `packages/shared/src/totem/publico.ts`,
  `apps/web/src/app/totem/**` exceto `privacidade`, `apps/web/public/totem/**`,
  `apps/web/src/components/totem/**` exceto `CadastroCupom.tsx`,
  `docs/totem/TRAVAMENTO.md`.
- **Frente C (lote e etiqueta)**: `apps/api/src/totem/lote/**`, `apps/api/src/totem/etiqueta/**`,
  `packages/shared/src/totem/lote.ts`, `apps/web/src/app/p/**`,
  `apps/web/src/app/totem-gestao/{lotes,remessas,reposicoes,etiquetas}/**`. É a
  única frente que pode acrescentar dependência ao `apps/web/package.json` (QR).
- **Frente D (cadastro)**: `apps/api/src/totem/cadastro/**`, `packages/shared/src/totem/cadastro.ts`,
  `apps/web/src/components/totem/CadastroCupom.tsx`, `apps/web/src/app/totem/privacidade/**`,
  `apps/web/src/app/totem-gestao/{campanhas,clientes,cupons}/**`, o texto da
  política em `packages/shared/src/totem/politica.ts`.

Precisou mexer em arquivo de outra frente ou da base? Não mexa: anote no
relatório final o que precisa e por quê. A junção resolve.

## 10. Bancos de teste (Postgres local descartável)

Container `sragranel-pg-test` em `127.0.0.1:55433`, usuário `mkt`. A senha fica
num arquivo fora do repositório, lido assim e nunca impresso:

```bash
PW=$(cat "$SP/pg-test-senha")
```

(`SP` é o scratchpad da sessão, passado no prompt de cada agente.)

| Uso | Banco |
|---|---|
| base e junção, suíte padrão | `marketing_os_test` |
| base e junção, isolamento | `marketing_os_test_rls` (papel `mktos_app` com a mesma senha) |
| frente A | `marketing_os_test_fa` e `marketing_os_test_rls_fa` |
| frente B | `marketing_os_test_fb` e `marketing_os_test_rls_fb` |
| frente C | `marketing_os_test_fc` e `marketing_os_test_rls_fc` |
| frente D | `marketing_os_test_fd` e `marketing_os_test_rls_fd` |
| sombra do `migrate diff` | `marketing_os_shadow` |

Os bancos das frentes são criados pela base, por `CREATE DATABASE ... TEMPLATE`,
depois que a migration e a semente de política estão aplicadas.

## 11. Portões

Toda frente só termina com os seis verdes, no próprio worktree e nos próprios
bancos:

1. `pnpm typecheck` na raiz.
2. `TEST_DATABASE_URL=... pnpm --filter @mktos/api test` (com o `pretest`; nunca
   `vitest` direto, que pula o gerado das ferramentas).
3. `TEST_DATABASE_URL=..._rls TENANT_DATABASE_URL=postgresql://mktos_app:...@.../..._rls pnpm --filter @mktos/api test:isolamento`.
4. `pnpm --filter @mktos/web test`.
5. `pnpm --filter @mktos/api build` e depois
   `DATABASE_URL=<banco da frente> pnpm --filter @mktos/api smoke`.
6. `pnpm --filter @mktos/web build`.

Baseline medida em 11/10/2026 antes de qualquer mudança: 85 arquivos e 3.183
testes verdes na suíte padrão; 386 verdes no isolamento; typecheck limpo.

Regras do repositório que valem aqui: nada que dependa de injeção do Nest roda
sob vitest (lógica testável vai para função pura ou recebe o client Prisma por
parâmetro); `prisma migrate deploy` roda no arranque do container, então
migration quebrada derruba a API; variável de ambiente nova vai para o
`environment:` do compose e para o `.env.example`.

## 12. Variáveis de ambiente novas

| Variável | Para quê | Obrigatória |
|---|---|---|
| `TOTEM_CPF_PEPPER` | chave do HMAC do CPF (32 bytes aleatórios) | não; sem ela o cadastro responde 503 |
| `TOTEM_ORG_SLUG` | empresa alvo da semente `db:seed:totem` | só na semente |
| `TOTEM_SEED_SAIDA` | arquivo (chmod 600) onde a semente grava os logins de teste que gerou | só na semente |

## 13. Semente `db:seed:totem`

Idempotente. Para a empresa de `TOTEM_ORG_SLUG`: liga o módulo `totem`, cria a
configuração com o controlador "Sr. aGranel (razão social a confirmar)", três
lojas `exemplo=true`, uns 30 produtos `exemplo=true` de granel (castanhas,
grãos, farinhas, chás, temperos, frutas secas) com ficha nutricional de
referência da TACO 4ª edição e `fonteNutricional` dizendo que é referência a
conferir com o rótulo, lotes com validade espalhada (vencido, vencendo e
folgado), remessas enviadas e recebidas, uma campanha de boas-vindas e quatro
usuários de teste (um por papel: rede, CD, gerente da loja 1 e operador da
loja 1) com senha aleatória gravada em `TOTEM_SEED_SAIDA`. Nenhuma senha vai
para o stdout.

**Como ficou (base, 11/10/2026).** Arquivo `apps/api/prisma/seed-totem.ts`,
catraca de fonte em `apps/api/test/totem-semente.test.ts`.

- Confere tudo antes da primeira escrita: a empresa existe e está ativa, os
  quatro papéis `totem_*` existem nela, nenhum e-mail de teste é de outra
  empresa e, se houver usuário a criar, `TOTEM_SEED_SAIDA` está definida e fica
  **fora** do repositório (caminho relativo conta a partir de `apps/api`). Falhou
  qualquer uma, sai com código 1 sem gravar nada.
- Preservação, como o `db:seed`: loja, produto e lote pelo código, remessa pela
  observação, campanha pelo nome, usuário pelo e-mail. O que existe fica como
  está; a única alteração em linha existente é acrescentar `totem` a
  `Org.modulos`. Nada é apagado.
- A configuração nasce com `cadastroLigado=false`: o controlador ainda é "razão
  social a confirmar" e o texto da política está em revisão. Quem liga é o
  painel, depois disso. Cores do design system provisório da Sr. aGranel
  (`#28371D` e `#F5F3EC`), nome de exibição "Senhor aGranel".
- 32 produtos `EX001`…`EX032` em 7 categorias. 22 têm ficha **por 100 g** da TACO
  (energia, carboidratos, proteínas, gorduras totais, fibra e sódio, com %VD da
  IN 75/2020); as frutas secas, os chás e os temperos (10) não estão na TACO e
  saem com a ficha vazia e a fonte mandando preencher pelo rótulo. Sem preço,
  sem `codigoDirector`, sem benefícios. Nenhum produto leva o selo "sem glúten":
  a loja fraciona farinha de trigo no mesmo ambiente.
- Lotes: `-A` (fabricado há 60 dias; validade vencida, a 10 dias ou a 120 dias,
  de três em três produtos), `-B` (fabricado há 5 dias, validade pelo padrão do
  produto) e um `EX002-M` de origem `manual_loja` na loja 2. Remessas: loja 1
  recebeu os produtos 1–20 (lote A) e tem enviada, não recebida, a dos 21–32
  (lote B, o caso presumido); loja 2 recebeu os de número ímpar; loja 3 não
  recebeu nada (tudo pendência). Reposições confirmadas dos produtos 1–10 na
  loja 1 e a reposição manual do `EX002-M` na loja 2.
- Usuários `totem.<rede|cd|gerente|operador>@<slug>.exemplo.invalid` (domínio
  reservado, nenhuma mensagem sai). Gerente e operador vinculados à loja 1. A
  senha (18 bytes aleatórios em base64url, bcrypt custo 10) é gravada no
  arquivo ANTES da criação no banco, em modo de acréscimo, `chmod 600`, uma
  linha por usuário: e-mail, senha e papel separados por tabulação. Usuário
  que já existe não tem a senha trocada e o arquivo nem é aberto.

**Fluxo provado num banco vazio** (`marketing_os_dev_bancada`, 11/10/2026),
com `U=postgresql://mkt:<senha>@localhost:55433/marketing_os_dev_bancada`:

```sh
docker exec sragranel-pg-test psql -U mkt -d postgres -c "CREATE DATABASE marketing_os_dev_bancada"
DATABASE_URL="$U" pnpm --filter @mktos/api db:deploy
DATABASE_URL="$U" pnpm --filter @mktos/api db:seed:politica
pnpm --filter @mktos/shared build
pnpm --filter @mktos/api build
DATABASE_URL="$U" pnpm --filter @mktos/api provisionar sragranel --nome "Sr. aGranel" --modulos totem
DATABASE_URL="$U" pnpm --filter @mktos/api db:sync-permissions
DATABASE_URL="$U" TOTEM_ORG_SLUG=sragranel TOTEM_SEED_SAIDA=/fora/do/repo/logins.txt \
  pnpm --filter @mktos/api db:seed:totem   # duas vezes: a segunda diz "Nada mudou"
```

O provisionamento sem `--admin` deixa a empresa sem dono (aviso
`papel-inicial-sem-ninguem`); na bancada isso basta, porque quem entra são os
usuários de teste. Em instalação real, `--admin <e-mail>` entra pelo Google.
Dentro do container da API, o arquivo de saída fica fora de `/app` (por
exemplo `/tmp/logins.txt`) e sai por `docker cp`.

## 14. Commits

Commits locais em português, frase inteira no padrão do histórico, terminando
com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nada de push.
