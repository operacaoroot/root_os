# Handoff: o módulo de marketing do ROOT OS (frente MK)

> Passagem do Pedro para o Lucas, em 28/09/2026. Quem continua: o Lucas, na máquina e na conta
> dele. Branch: `root-os/marketing-interno` (sai do `main` `e988cbd`, que está em produção).

## De onde vem

- A **máquina de conteúdo** (frente MC) está em produção em `os.operacaoroot.com` desde 28/09/2026:
  pauta, curadoria, episódios, voz, semana de posts, aprovação em lote e publicação (desligada).
  Guia: `docs/GUIA-MAQUINA-DE-CONTEUDO.md`. Plano: `docs/PLANO-MAQUINA-DE-CONTEUDO.md`. Registro e
  ordem de deploy: `docs/ESTADO-DA-EXECUCAO.md`.
- O **Marketing OS do Lucas** (`conteudo.operacaoroot.com`, serviço `/opt/marketing-os` na VPS da Root)
  foi o protótipo. Decisão do Pedro: ele vira o **módulo de marketing do ROOT OS, para uso interno da
  Root**. O que era da cliente (Dra. Patrícia) fica de fora: aprovação pela cliente, textos para a
  cliente, auditoria de perfil de clientes, regras do CFM, dados dela.

## As três decisões do Pedro

1. **A organização segue o app do Lucas, não a do OS de hoje.** O marketing do OS está espalhado
   (`/pauta`, `/referencias`, `/bio`, `/conteudo`, `/instagram`, `/campanhas`, `/funil`, `/leads`).
   Revisar e reorganizar tudo num bloco "Marketing" com a navegação do app do Lucas (agenda do mês,
   banco de ideias, estratégia, performance, marca/perfil, linha do tempo, relatório, concorrentes),
   encaixando nele o que o OS já tem (pauta/curadoria, episódios, semana, voz, referências). O que
   ficar repetido vai numa lista para o Pedro decidir se sai.
2. **O visual do motor de marketing segue o do app do Lucas.** Vale para as telas do bloco
   "Marketing"; o resto do OS mantém a identidade atual.
3. **Nada do OS é apagado sem a lista de repetidos aprovada pelo Pedro.** Tudo o que existe é
   reaproveitado (agenda, aprovação em lote, voz, Radar/Apify, conector Meta de leitura, rotinas).

## As fatias

| # | Entrega | Pronto quando |
|---|---|---|
| MK0 | Especificação em `docs/especificacoes/MK-modulo-de-marketing.md`: inventário do app do Lucas (cada tela e dado: já existe no OS / entra / fica de fora) e o mapa da nova navegação | doc commitado e ligado no PLANO |
| MK1 | **Marca e pilares**: quem somos, como falamos, o que queremos, o que rejeitamos, público, diretrizes; pilares com nome, cor e descrição. Entram nos prompts da pauta ao lado da voz (ponto único, como `VozService.bloco`) | prompts com o bloco, provado em teste |
| MK2 | **Concorrentes com números**: perfis raspados pelo Apify existente (views, curtidas, comentários, duração, legenda, data), mediana por perfil, índice de cada post, análise (o que rende, aberturas, assuntos, CTAs) e dossiê por IA. Texto raspado é dado não confiável no prompt | índice testado; dossiê com dublê de LLM |
| MK3 | **Banco de ideias** por pilar (título, gancho de fala e de tela, roteiro, legenda, CTA, porquê, fontes, formato, prioridade, status e histórico). A IA propõe; ideia aprovada vira `PautaPeca` na mesma agenda e na mesma aprovação da semana | ideia aprovada aparece na Semana |
| MK4 | **Estratégia do mês**: pilares da vez, cadência, metas, apostas, o que parar; gerada pela IA e editável, um por mês | documento do mês salvo e editado |
| MK5 | **Performance**: snapshot mensal da conta da Root pelo conector Meta de leitura e desempenho de cada post contra a mediana própria; sem Instagram, a tela diz como conectar | snapshot com dublê da Meta |
| MK6 | **Relatório do mês** em markdown (o que foi ao ar, decisões, performance, próximos passos, estratégia), com rotina mensal desligada por padrão | relatório gerado com dublês |
| MK7 | **Reorganização do menu e visual** do bloco Marketing no estilo do app do Lucas, com a lista de telas repetidas para o Pedro | navegação nova a 375px; lista entregue |

## Regras do repositório (as que mais pegam)

Ler o `CLAUDE.md` do repo antes. Resumo: tabela nova com `orgId` e RLS FORCE (e semente em
`apps/api/test/tenant-isolation.test.ts`); enum espelhado em `packages/shared`; migration com
`db:diff` limpo; escrita para fora do OS só por capacidade da política e efeito por registro
(`arquitetura.test.ts` fiscaliza); nada que use injeção do Nest roda sob vitest; LLM sempre com
`orgId`; pisos de teste do CI sobem no mesmo commit; texto da UI em português sem jargão.

## Ambiente e verificação

- Postgres de teste: `docker run -d --name mktos-test-db -e POSTGRES_USER=mkt -e POSTGRES_PASSWORD=mkt -e POSTGRES_DB=marketing_os_test -p 5432:5432 pgvector/pgvector:pg16`, depois `pnpm install`, `pnpm --filter @mktos/shared --filter @mktos/policy build`, `pnpm --filter @mktos/api db:generate`, `db:deploy` e `db:seed:politica` (com as assinaturas de teste descritas em `apps/api/prisma/seed-politica.ts`).
- Bateria: `pnpm typecheck`; `NODE_OPTIONS=--max-old-space-size=5120 pnpm --filter @mktos/api typecheck:test`; suíte da api com `TEST_DATABASE_URL`; web; policy; `db:diff`; `test:isolamento`; `build` + `smoke`.
- Linha de base no `main` `e988cbd`: api 3068, web 635, policy 97, porta 61, isolamento 358.

## Estado real da produção (não prometer o que não roda)

A chave do OpenRouter está morta (a IA do OS parou; a OpenAI responde), não há `APIFY_TOKEN`, o
Instagram não está conectado e o WhatsApp (Evolution) não está configurado. O código novo tem de
degradar com mensagem clara quando falta cada peça.

## Entrega

PR para o `main` com a CI verde. O deploy fica com o Pedro, pelo `deploy/mc/vps.sh` (seção
"Deploy da frente MC" do ESTADO mostra o caminho real: easyPanel, bundle, `compose -p root_marketing-os`).
