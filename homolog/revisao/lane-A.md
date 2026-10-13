# Revisão adversarial · Lane A (espinha)

Lane G, 13/10/2026. Revisor: Opus 5.5, sem ter escrito o código. Escopo: `fio.service.ts`, `ficha.service.ts`, `portoes.ts`, `decisoes.service.ts`, `config.service.ts`, `reacoes-da-espinha.ts`, `relogio-da-espinha.ts`, `comercial.controller.ts`, a migration `20261013000000_cockpit_comercial`, `tenants/modulos.ts` e o delta 1.8.0 da política. Nada foi consertado nesta passada.

## P1

Nenhum P1 confirmado nesta lane.

## P2

### A-1 · Os interruptores da mesa (K08) e a autonomia mudam com `leads.editar`, sem rastro
- **Onde:** `apps/api/src/comercial/comercial.controller.ts:110-114` (`PUT /comercial/config`, `@RequirePermissions('leads.editar')`) e `config.service.ts:131-146` (`upsert` direto, sem evento, sem `AuditLog`).
- **Defeito:** quem tem `leads.editar` grava `envioAutomatico`, `fechamentoAutomatico`, `silencioAprova`, `janelaDeVetoMinutos`, `decisaoExpiraHoras`, os dias do follow-up e a `autonomia` (A0 desliga uma automação inteira). O papel `analista` e a conta de máquina `ia_acao` têm `leads.editar` (`packages/shared/src/permissions.ts`).
- **Cenário:** um analista (ou um agente com a conta `ia_acao`) manda `PUT /comercial/config {"decisaoExpiraHoras":1,"autonomia":{...:"A0"}}` → a fila passa a vencer em 1 h aplicando o padrão escrito (o ponto zero manda o lead à geladeira), e o freio A0 cala o relógio; ninguém fica sabendo quem mudou, porque não há linha no RASTRO.
- **Confirmado** por leitura de código (rota, permissão e escrita).
- **Conserto:** permissão de mesa para escrever (`aprovacoes.decidir` no mínimo, ou papel titular), conta de máquina recusada, e a escrita como evento do RASTRO com o antes e o depois.

### A-2 · O retry das reações roda em paralelo com a reação viva e repete erro para sempre
- **Onde:** `fio.service.ts:159-186` com `relogio-da-espinha.ts:49,84` (`REACAO_PARADA_MS = 2 min`).
- **Defeito:** `reexecutarPendentes` pega também `em_curso` com mais de 2 minutos e roda de novo; não há teto de tentativas nem espera crescente para `erro`.
- **Cenário 1:** a reação do leitor de ata pela ponte (`claude -p`) ou a `dinheiro.propor` presa num provedor lento passa de 2 min → o relógio a toma e roda a segunda cópia enquanto a primeira ainda corre. As travas por estado (`aprovacaoViva`, contagem de cobrança) são leitura seguida de escrita, então as duas cópias podem propor duas vezes.
- **Cenário 2:** `dinheiro.propor` recusada pela porta (conector desligado) vira `erro` e volta a cada passagem: uma `ToolCall` recusada a cada 2 minutos, para sempre, e o sinal `volume_atipico` sobe tudo o mais da empresa a R4.
- **Plausível** (código lido; não exercitado).
- **Conserto:** `em_curso` só volta com prazo bem maior que a reação mais longa (ou com marca de vida), e `erro` com contador e espera crescente até parar e virar decisão na fila.

## P3

- **A-3** `decisoes.service.ts:303-315`: a reação à decisão roda depois da transição `aberta → tomada` e, se lança, só vai ao log. Não há linha de trava nem retry; o fato "decidido" fica sem efeito. O `veto_de_fechamento` é coberto pelo `dinheiro.repropor`; `ponto_zero` e `lead_parado` não.
- **A-4** `reacoes-da-espinha.ts:252-262`: a geladeira decidida pela fila nasce com `voltaEm: null`, então `voltasDaGeladeira` nunca a devolve, enquanto a rota de saída recusa geladeira sem data (`ficha.service.ts:418`). O padrão do ponto zero é exatamente essa geladeira.
- **A-5** `ficha.service.ts:361-378`: a etapa, o `Lead.status` e o `etapa.mudou` são três escritas sem transação; queda entre elas deixa a etapa nova sem o fato no fio (o fio é a fonte da ficha).
- **A-6** `ficha.service.ts:483`: `socioDaConta` volta com `id = nome` (achado da lane F, confirmado).
- **A-7** `dinheiro.service.ts:198` (vizinho da espinha): `comercialFicha.findUnique({ where: { leadId } })` sem `orgId`, padrão que se repete em `fechamento.service.ts` (`updateMany({ where: { leadId } })`). Hoje o `leadId` sempre vem de linha já conferida, mas com o RLS inerte em produção (conexão dona) a guarda é só a origem do id.

## O que foi verificado e está bom

- Migration: as nove tabelas com RLS, FORCE, leitura e escrita separadas; os oito filhos com o gatilho `mktos_orgid_do_pai('Lead','leadId')`; conferência final que aborta a subida; leitura pela sentinela só em `SalaDoCliente` (e, na migration seguinte, `ComercialCobranca`/`ComercialDocumento`), escrita sempre presa à empresa resolvida.
- O fio: id do evento derivado de `(orgId, leadId, tipo, chave)`, `createMany skipDuplicates`, reação com trava `(eventoId, reacao)` gravada antes de rodar.
- Portões: só `mudarEtapa` escreve a etapa (busca por escrita em `ComercialFicha.etapa` não achou outro caminho), escrita condicionada à etapa lida, avanço de um passo com a única exceção nomeada (proposta direta), saída com `podeSair`.
- Decisões: resposta condicionada a `aberta` (409 no segundo toque), `propostoPor` barra quem pediu, prazo nulo = sem vencimento, padrão sempre entre as opções.
- Política 1.8.0: as cinco capacidades `comercial.*` em R3/R4, sem ferramenta, com `additionalProperties: false`; o mapa de conector cobre as cinco. Os interruptores nascem falsos e os números nascem nulos (desligados).
- `modulos.ts`: `comercial` e `sala` declarados como `leads`.
