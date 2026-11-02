# Revisão adversarial · Agenda v2 (29/10/2026)

Diff revisado: `git diff 16a92871..HEAD` na branch `agenda-v2/20261029`. Só leitura de código; nada foi executado contra banco.

## Veredito: fecha com ressalvas

Nada crítico encontrado. As travas centrais se sustentam no código:
- `naTela` só nasce em `escrita.controller.ts:38`, e é conferido três vezes: o guarda pelo token, `ehGente` no banco por empresa e `aprovacaoR2DaTela` na porta (`tool-gateway.service.ts:1539`).
- `aprovacaoR2Ligada` é lida por empresa, sem cache (`policy.service.ts:511`), e só vale para R2 (`escada.ts:160`). A sobrescrita só se grava por CLI.
- Nenhum DELETE chega ao Google: cancelar e desmarcar são `PATCH status=cancelled`.
- `chamarAgenda` barra `..` e `%2e`, e o host é fixo.
- As sete tabelas têm RLS FORCE, quatro policies e grant.
- O token do convite tem 256 bits; o hash cobre o orgId; o 404 é o mesmo em todos os casos.

Dois achados altos pedem conserto antes de abrir o link a cliente.

## Achados

### Alto

**A1. O convite do link morre calado em 15 min e o cliente não pode escolher de novo.**
- Onde: `apps/api/src/agenda/convite/convite.service.ts:257-310` e `packages/policy/src/escada.ts:70` (R2 `validadeSegundos: 900`).
- Cenário: o cliente confirma, o `marcar` fica R2 na fila e o convite fica `usadoEm`. A página diz "chega assim que a Root confirmar". Se ninguém confirmar em 15 min, ou se a aprovação for recusada, o pedido expira. Nenhum código relê o `AgendaConvite`: `grep agendaConvite` só acha o próprio módulo. O convite fica "escolhido" para sempre, o evento nunca nasce e o cliente não recebe nada nem pode escolher outro horário.
- Conserto: ao expirar ou recusar a aprovação do `link-de-escolha`, devolver o uso (ou marcar o convite como "caiu") e avisar a casa. A página deve dizer que é pedido, não reserva.

**A2. `marcar` desceu de R3 para R2 declarando um efeito que não é o real.**
- Onde: `packages/policy/politica-marketing-os.json` (bloco `agenda.reuniao.marcar`, `reversibilidade: manual → automatica`, `exposicaoExterna: false`) e `apps/api/src/google/agenda-escrita.google.ts:186` (`sendUpdates=all`).
- Cenário: o marcar manda o convite do Google por e-mail aos `convidados` externos (o cliente), e o desmarcar não "desmanda" esse e-mail. Pela escada (`escada.ts:95-97`), `exposicaoExterna: true` daria R3. A declaração atual baixa o nível para TODOS os atores: a alçada do agente cai de `responsavel` para `operador`, e com a sobrescrita o envio ao cliente sai no clique, sem segunda pessoa. O mesmo vale para `alterar`/`cancelar` com `sendUpdates=all`.
- Conserto: declarar `exposicaoExterna: true` quando houver convidado de fora da casa. Ou manter o marcar com convidado externo em R3 e deixar R2 só para o sem convidado externo (bloqueio, pessoal, interna). A decisão 2 pode continuar valendo, mas com o efeito declarado como ele é.

### Médio

**M1. Com o espelho atrasado e o Google fora, a régua fica toda verde.**
- Onde: `apps/api/src/agenda/espelho/espelho.service.ts:623-624`.
- Cenário: o espelho fica mais de 10 min sem passar, e `motivoParaNaoLer` devolve motivo (conector desligado, sessão expirada ou sonda em `erro`). Aí `periodo` devolve `eventos: []`, não o espelho velho. Consequências:
  - `ReguaService.livres` oferece no link público horários já ocupados.
  - `avaliar` dá verde para a escrita na tela.
  - O ramo `catch` logo abaixo já cai no espelho; este ramo não.
- Conserto: no ramo do motivo, devolver `doEspelho(...)` com o `erro` anotado, como faz o `catch`.

**M2. Dois convites, ou um convite e uma escrita na fila, marcam o mesmo horário.**
- Onde: `convite.service.ts:249-253` e `regua.service.ts:204` (`eventos` = só o espelho).
- Cenário: o `marcar` retido na fila não aparece no espelho. Um segundo convite do mesmo sócio vê o mesmo horário verde e confirma. As duas aprovações ficam na fila, e o efeito (`agenda-escrita.google.ts:marcar`) não reconfere a régua ao executar: confirmar as duas dá dupla marcação, com convite enviado a dois clientes.
- Conserto: contar `AgendaConvite` escolhido e ainda sem `eventoId` (e os `ToolCall` de marcar retidos) como ocupado em `livres`/`avaliar`. Ou reavaliar a régua no efeito antes do `POST`.

**M3. Criar e revogar link público não deixa auditoria.**
- Onde: `convite.service.ts:107-170` (`criar`, `revogar`).
- Cenário: quem cria um link que marca na agenda da casa, e quem o revoga, não fica em `AuditLog`. A confirmação anônima só aparece no `ToolCall` da porta. A régua, por comparação, audita cada escrita (`regua.service.ts:250`).
- Conserto: `auditLog.create` na mesma transação (`agenda.convite.criar` e `agenda.convite.revogar`, com quem, sócio e validade, sem o token).

**M4. O nome digitado no link entra cru na gramática do título.**
- Onde: `convite.service.ts:338-340`, `packages/shared/src/agenda.ts:99-104` (o `limpar` só junta espaços) e `SEPARADOR_LIDO` em `agenda-v2.ts:64`.
- Cenário: num convite sem lead nem cliente, o anônimo digita `Promedical - Lucas`. O título vira `Reunião Online - Promedical - Lucas - Rodrigo`. A leitura (`lerCompromisso`) pode atribuir cliente ou responsável errado, e a régua e os conflitos passam a ler a reunião como de outra pessoa ou outro cliente.
- Conserto: tirar do nome digitado os separadores ` - `, ` – `, ` — `, `·` e `|` antes de montar o título (ou recusar com 400).

**M5. Leitura anônima que dispara leitura direta do Google e escreve no RASTRO.**
- Onde: `agendar.controller.ts:66-70`, `espelho.service.ts:626-633` e `convite-puro.ts:126-141`.
- Cenário: com o espelho atrasado, cada `GET /agendar/<token>` válido chama o Google pela porta, gravando `ToolCall`, `PolicyDecision` e evento. O teto é de 300 por hora por endereço. Em IPv6 basta trocar de endereço na mesma /64, e acima de 5000 baldes o mapa inteiro é zerado (`baldes.clear()`), o que devolve a cota a todo mundo.
- Conserto: agrupar IPv6 por /64, não zerar o mapa (expulsar o mais velho) e, no link público, ler só o espelho, sem leitura direta.

### Baixo

**B1. O dublê do Google aceita IPv6 público.**
- Onde: `apps/api/src/google/dubles-do-google.ts:25`.
- Cenário: `!host.includes('.')` aceita `http://[2606:4700::1111]` (e `[::ffff:808:808]`). Um nome sem ponto também pode resolver para fora pelo `search` do resolv.conf. Nada disso depende de `NODE_ENV`. Com a variável posta por engano, o token, o refresh token e o `client_secret` (o `/token` também é trocado) saem da casa. A variável não está no compose de produção, só no de homologação.
- Conserto: recusar IP literal que não seja loopback, exigir `NODE_ENV !== 'production'` e checar o IP resolvido com `endereco-de-dentro.ts`.

**B2. A CLI da sobrescrita R2 aceita qualquer usuário ativo como autor.**
- Onde: `apps/api/src/agenda/sobrescrita-r2-da-agenda.cli.ts:81`.
- Cenário: `--como` aceita conta de máquina e quem não é `admin_master`, para um afrouxamento da empresa inteira.
- Conserto: exigir pessoa (`temPapelDeMaquina` falso) com alçada de titular.

**B3. A senha do Postgres vai na linha de comando no publicar.**
- Onde: `homolog/agenda-v2/publicar-na-vps.sh:107-109` e `123`.
- Cenário: `docker run -e DATABASE_URL=postgresql://…:$DBPASS@…` deixa a senha visível em `ps` no host enquanto o contêiner roda.
- Conserto: passar por `--env-file` temporário com `chmod 600`, ou ler a senha dentro do contêiner.

**B4. Nomes de clientes reais em testes, e2e e desenho.**
- Onde: `apps/api/test/agenda-conflitos.test.ts`, `agenda-regua.test.ts`, `agenda-escrita.test.ts`; `apps/web/tests/unit/agenda-v2-grade.test.ts` e outros; `homolog/e2e/agenda-v2.mjs`; `docs/agenda-v2/desenho/*.dc.html`.
- Cenário: Promedical, Campo Bom, Juma, Papeleira Santa Rita, Custeio e Andrade Peças estão em `apps/api/prisma/data/crm-root-2026-10-18.json`, isto é, são clientes reais. `marcos@andradepecas.com.br` (domínio real) aparece em `docs/agenda-v2/desenho/Link.dc.html` e `Main.dc.html`. A prática já existia no repositório, mas a rodada a amplia.
- Conserto: trocar por nomes fictícios e e-mail `.invalid`.

**B5. As sete tabelas novas não estão no inventário de cruzamento de empresa.**
- Onde: `apps/api/test/tenant-isolation.test.ts` (nenhuma `Agenda*` nem `Feriado` na lista de tabelas).
- Cenário: a conferência da migration (`migration.sql:267-286`) prova RLS, FORCE e policies, mas nenhum teste mede, com o papel restrito, que a empresa A não lê nem escreve o convite ou o espelho da B.
- Conserto: incluir as sete na lista (escopo `tenant`).

**B6. O comentário da migration descreve o mecanismo antigo.**
- Onde: `migration.sql:239-241`.
- Cenário: o comentário diz que o convite é "resolvido pelo hash como o onboarding". O código resolve pela empresa no token (`convite-puro.ts:9-21`).
- Conserto: corrigir o comentário.

**B7. Meia-risca no texto de tela.**
- Onde: `apps/web/src/app/agenda/DetalheDoCompromisso.tsx:90`, `GradeDeHoras.tsx:331`, `GradeDeHoras.tsx:387`, `GradeDeHoras.tsx:416` e `page.tsx:496`.
- Cenário: os intervalos de hora usam `–`. Não há travessão em texto corrido nem emoji nos arquivos novos. Os travessões de `MarcarReuniao.tsx` são anteriores à rodada.
- Conserto: se a regra de tela valer aqui, usar ` a ` ou `-`.

## Conferido e sem defeito
- **Link público.** O hash é do token inteiro, então trocar o orgId dá 404. O formato inválido não consulta o banco, e o resto cai no mesmo `NotFoundException`. O teto lê `req.ips` sob `trust proxy 1`, e não um cabeçalho forjável. O uso único é escrita condicionada. Horário fora de `livres` dá 409. O `.ics` não leva e-mail nem nome do cliente e escapa `;`, `,` e `\n`. O link do Google Agenda usa `URLSearchParams`.
- **Escrita.** O agente, a rotina, o MCP e o link chamam sem `naTela`. `ehGente` e `lerAprovador` filtram por `orgId`. `reabrir` é R3 com aprovação `sempre`. Nenhuma rota HTTP grava `aprovacaoR2Ligada`.
- **Google.** Não há DELETE. O espelho só apaga as próprias linhas `livre_ocupado`. `caminhoDoEvento` usa `encodeURIComponent`.
- **Banco.** A busca do cliente filtra `orgId` em todas as consultas. Os `findUnique` novos usam chave composta com `orgId`. O único `$executeRaw` é o advisory lock.
- **Segredos.** Não há token nem senha real no diff. Os valores do dublê são fictícios.
