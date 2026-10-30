# RESULTADO da rodada da Agenda v2 (29 e 30/10/2026)

> Roteiro: `docs/comercial/RODADA-AGENDA-V2-20261029.md` (o Rodrigo, 29/10: "aprimorar a agenda do ROOT OS e levar para lá todos os mecanismos", as quatro decisões e "pode executar"). Desenho: `docs/agenda-v2/desenho/`.
> Branch **`agenda-v2/20261029`**, sobre **`16a92871`** (a produção viva). Tag **`agenda-v2-entrega-20261030`**. Bundle: `C:\Users\User\dev\agenda-v2-delta.bundle` (branch e tag, `^16a92871`). Stacks 3030 e 3031 na imagem `rootos-final-app:agenda-v2`.
> Só homologação, no Predator. **Nada foi à produção.** Este arquivo não tem nome de cliente, e-mail nem dado real: só contagens e ids curtos. Quem publica é o orquestrador do Mac (§7).

## 1. O que entrou (ondas 1, 2 e 3)

| Lane | Pedido | O que foi feito | Onde |
|---|---|---|---|
| G0 | Base e contrato | `docs/AGENDA.md` com as quatro decisões (data e porquê); o contrato no shared (`agenda-v2.ts`: tipos do espelho, regras, régua, conflitos, escrita, link; gramática nova `Fechado <Nome>`, `<Nome> Fora - <motivo>`, `Pessoal - <Nome>`, feriado pelo nome exato); migration aditiva; política 1.13.0; `GoogleService.chamarAgenda` (destino fixo, só `/calendar/v3/`); esqueletos | `packages/shared/src/agenda-v2.ts`, `apps/api/prisma/migrations/20261029230000_agenda_v2` |
| G1 | Espelho e sincronia | `AgendaEvento` + `AgendaSincronia`. Rotina `agenda.sincronizar` (`*/2`, só na casa, nasce ligada só com o Google conectado): `events.list` com `syncToken` pela porta (R0); 410 refaz a janela (-30 a +180 dias); cancelado no Google vira `status: cancelado`, nunca linha apagada; o que sumiu na janela completa vira cancelado. FreeBusy das agendas pessoais (decisão 3) vira `Fechado <Nome>` sem título, sem descrição, sem local (CHECK no banco). Espelho atrasado mais de 10 min: a tela avisa e lê direto do Google; Google fora do ar com espelho velho: mostra o velho com o aviso. O vigia AG-01 e o cartão da implantação passaram a ler do espelho | `apps/api/src/agenda/espelho/`, `google/agenda-espelho.google.ts` |
| G2 | A régua | Motor puro no shared (`avaliarNaRegua`, `sugerirHorarios`, `horariosLivres`): janela de trabalho, intervalo, trajeto antes de presencial, teto por dia, bloqueio fixo, Fechado (Fechado contra Fechado não é choque), Fora (fecha o dia), feriado (nacional fecha, facultativo ligado avisa, municipal cadastrável), rito (pergunta ou bloqueia), a mesma pessoa em dois lugares; o próprio evento fora da conta ao editar. Tabelas `AgendaRegraPessoa`, `AgendaRito`, `Feriado`, `AgendaRegraTexto`, semeadas na primeira leitura da casa com os valores do desenho. Aba Regras, edição só com `agenda.regras` (nova, Admin Master), auditada | `packages/shared/src/agenda-regua.ts`, `apps/api/src/agenda/regua/`, `abas/AbaRegras.tsx` |
| G3 | A tela | Abas Semana e dia · Lista · Mês · Conflitos (com o número) · Relatórios · Regras; colunas por dia, Quem, 1/3/5 dias, Calendário, altura (− auto + e Ctrl + roda, guardada), linha do agora, faixas de Fora e feriado, até três em terços e "+N"; painel de marcar fixo (folha de baixo abaixo de 860 px): atalho por frase sem IA, tipo (Cliente, Interna, Bloqueio, Pessoal, Fora), modalidade, cliente com busca no Funil e em Clientes (ficha: etapa, contato, vezes na agenda), responsáveis, quando, duração, título pela mesma função do servidor, semáforo, Marcar, "Marcar assim mesmo" com motivo, "Mandar link de escolha", rascunho na sessão; detalhe com Editar, arrastar, esticar, Cancelar com motivo e "avisar os convidados", histórico; Lista com a linha do agora e "entrar no Meet"; Mês. Os temas do app funcionam | `apps/web/src/app/agenda/`, `packages/shared/src/agenda-frase.ts`, `apps/api/src/agenda/busca/` |
| G4 | Escrita no Google | Decisão 2 inteira (§2). Efeitos `marcar` (mudou de casa), `alterar`, `cancelar`, `desmarcar`, `reabrir`: título sempre pela gramática, id do evento pela chave do pedido (repetir não duplica), Meet na online, cliente e responsáveis convidados com `sendUpdates=all` (e-mail do sócio pela Equipe; sem e-mail, o convite sai sem ele e a resposta diz), propriedades privadas do OS no evento, conferência do "antes" contra o Google, **nunca DELETE**. `POST /agenda/escritas` passa pela régua antes da porta (vermelho sem motivo não sai) e devolve o pedido que desfaz. Histórico lido do registro da porta (`ToolCall`), sem tabela nova. Cartão de leitura em Configurações | `google/agenda-escrita.google.ts`, `apps/api/src/agenda/escrita/`, `abas/Historico.tsx`, `config/CartaoDaAgendaR2.tsx` |
| G5 | Conflitos e Relatórios | Conflitos dos próximos 60 dias (choque, janela, trajeto, intervalo, teto, Fora, rito sem gente, feriado, sem Meet) mais o que o vigia achou fora do padrão, numa lista só por urgência, filtros por tipo e sócio, séries agrupadas; cada cartão com o pedido pronto (empurrar para o primeiro verde, passar ao sócio livre, remarcar, criar Meet, trocar modalidade, aplicar título, "não é reunião", confirmado com o cliente, levar o do feriado ao dia útil seguinte, pular a ocorrência do rito), pela mesma porta. Relatórios: por sócio e tipo, sem Meet, responsável sem e-mail, marcados assim mesmo (com motivo), criados direto no Google (só contagem) | `apps/api/src/agenda/regua/conflitos*`, `abas/AbaConflitos.tsx`, `abas/AbaRelatorios.tsx` |
| G6 | Link de escolha | `AgendaConvite` (token `<orgId>.<32 bytes>`, só o sha256 no banco, validade até 30 dias, uso único condicionado, auditado ao criar e revogar). Página pública `/agendar/<token>`: só horários verdes de `horariosLivres` (14 dias), manhã e tarde, e-mail obrigatório na online, nome do lead quando há; 404 igual para errado, vencido, revogado e usado; teto por IP; horário pedido por outro convite pendente sai da lista; confirmar vai à fila do link (decisão 2) e o pedido vencido ou recusado devolve o link para nova escolha, com aviso na página; Google Agenda e `.ics` depois de confirmar | `apps/api/src/agenda/convite/`, `apps/web/src/app/agendar/` |
| G7 | Cópia diária | Rotina `agenda.copia` às 03:00 (só na casa): JSON e ICS do espelho (-30 a +180) no storage da empresa, chave `agenda/copia/AAAA-MM-DD.*`, 30 dias guardados (só apaga as próprias cópias); sem storage, `pulada` com o motivo | `apps/api/src/agenda/espelho/copia-da-agenda*` |
| G8 | Provas e entrega | Dublê do Google (`homolog/mocks/google`), e2e `homolog/e2e/agenda-v2.mjs`, capturas, revisão adversarial e consertos, imagem, stacks, este RESULTADO, `publicar-na-vps.sh` | §4, §5, §7 |

## 2. As decisões aplicadas

1. **Espelho como cache** (decisão 1). O Google segue sendo A agenda; o espelho é só de leitura e a sincronia nunca apaga nada no Google (nenhum DELETE no código: cancelar e desmarcar são PATCH de status, e o Google guarda o evento cancelado).
2. **Marcar pela tela sai no clique, pelo caminho honesto** (decisão 2). Nenhum nível foi escrito mais baixo para passar: `agenda.reuniao.marcar` passou a declarar reversibilidade automática porque ganhou um desfazer **implementado** (`agenda.reuniao.desmarcar`, com rota), e a escada calcula R2. O mesmo para `alterar` (desfaz a si mesma), `cancelar` e `desmarcar` (desfeitos por `reabrir`, que é R3 e fecha a cadeia). A porta lê `aprovacaoR2Ligada` (coluna nova de `PolicyVersion`, gravada só pela sobrescrita assinada) **só** com ator `user` + `naTela` (posto apenas pelo controlador de `POST /agenda/escritas`, depois de reler no banco que é gente da empresa, ativa e sem papel de máquina) + a versão ativa da empresa com a aprovação desligada. Agente, rotina, WhatsApp, link público, conta de máquina e a rota antiga `POST /google/calendar/reuniao` seguem na fila. **Nenhuma capacidade ficou presa em R3 por recusa da escada.**
3. **Fechado pelo freeBusy** (decisão 3), sem OAuth novo: e-mail pessoal por sócio em Regras, opcional; o OS nunca vê o título.
4. **Ondas 1, 2 e 3 entregues; a onda 4 ficou fora.** O motor está pronto para ela: as funções puras no shared (`agenda-v2.ts`, `agenda-regua.ts`, `agenda-frase.ts`) servem ao WhatsApp do grupo e às ferramentas `agenda_livre`/`agenda_marcar` sem duplicar regra.

**O que ainda retém marcar na tela, mesmo com a sobrescrita** (medido no e2e noturno): todo sinal sobe um degrau. Fora da janela da política (08h a 20h de São Paulo, `fora_da_janela`) o marcar vira R3 e vai para a fila; com rajada acima de três vezes a média por hora da capacidade (`volume_atipico`), também. É a régua de toda escrita do OS; a agenda não abre exceção.

## 3. As lanes

| Lane | Commits |
|---|---|
| G0 · contrato (orquestrador) | `cb8bbc32`, `d99d529f`, `d6126f4c`, `c333f764` |
| A · G1 e G7 | `e83bc099`, `2f7fd11d`, `68329cd5`; merge `615ab936` |
| B · G2 e G5 | `d884d75d`, `4c791dae`, `813c4791`, `09575f94`, `3c129e27`; merge `58d4ad2b`; integração `0fdbaf62` (as propriedades do OS no evento) |
| D · G4 e G6 | `37486487`, `f2278fee`, `c0b36ee8`, `ac5cd651`; merge `8d0186b7` |
| C · G3 | seis commits até `a3c2f03f`; merge `d8a6d801` |
| E · consertos da revisão | `dd5a035a`, `1a1bd6b9`, `6200eaff`, `6ffbe23f`, `9fffe9b3`, `5857ee50`, `334957b2`, `d7f33678`, `9b3163ba`; merge `f751500e` |
| Integração (orquestrador) | `8ed594b2` (o link público num controlador só dele, para a catraca de módulos), `5254ff2e` (a chave do pedido da tela em base32hex: o Marcar pela tela era recusado como "pedido inválido"; o Meet repetido no semáforo), `3d0a32f6` (meia-risca), `192194a6` (o e2e não lê credencial de máquina), docs |

Os worktrees nasceram na `main` (`5260924b`); cada lane voltou o seu para a ponta da branch antes de começar.

## 4. Provas

**Suítes** (Postgres descartável na 5440, migrado do zero, política 1.13.0 semeada), contra a **linha de base medida em `16a92871`** no mesmo ambiente:

| Suíte | Agenda v2 (em `3d0a32f6`) | Linha de base (`16a92871`) |
|---|---|---|
| API inteira | 6145 casos: 5797 verdes, 312 vermelhos | 5986: 316 vermelhos (57 arquivos) |
| Web inteira | 2202: 2130 verdes, 72 vermelhos | 1997: 72 vermelhos (11 arquivos) |
| Política | 114/114 | 110/110 |
| Isolamento (papel restrito `mktos_app`, banco próprio) | 552/554, com as sete tabelas novas no inventário (+14 casos; piso do `ci.yml` de 281 para 293). Os 2 vermelhos são de antes e fora da agenda: as cinco tabelas `Marketing*` sem registro na suíte e o `memoria-do-marketing.service.ts` abrindo contexto de plataforma sem declarar | (a suíte nem rodava: a semente do `FrotaCasa` violava o CHECK; consertada) |
| `tsc` | limpo na API e no web | |

**Nenhum vermelho novo.** Comparado arquivo a arquivo: os únicos que sobem são `comercial-tarefas` (1), que falha igual no worktree da base quando roda de novo no mesmo banco (depende do estado), e nenhum da agenda. `agenda-vigia` (5, R4 onde espera R3: o teste depende da hora do dia, fora das 08h–20h) e `pauta-agenda`, `arquitetura` (1), `modulos-por-tenant` (cronologia: duas migrations da base com o mesmo carimbo `20261027010000`) são da base.

Testes da rodada (todos verdes): API `agenda-espelho` 27, `agenda-espelho-duble` 6, `agenda-copia` 9, `agenda-regua` 14, `agenda-conflitos` 19, `agenda-escrita` 30, `agenda-r2-na-tela` 21 (humano na tela com a aprovação desligada = no clique; sem ela = fila; agente, rotina, conta de máquina e `naTela` vindo de fora = fila; R3 nunca no clique), `agenda-convite` 25, `agenda-busca` 8; web `agenda-regua` 61, `agenda-gramatica-v2` 19, `agenda-frase` 39, `agenda-v2-grade` 23, `agenda-v2-arrastar` 10, `agenda-v2-painel` 21, `agenda-v2-pagina` 11, `agenda-v2-chave` 1, `agenda-abas-*` 20; política +4 casos da agenda v2.

**E2E** `homolog/e2e/agenda-v2.mjs` na 3031, com o dublê do Google:

| Rodada | Resultado |
|---|---|
| Noite (01:10, fora da janela) · `homolog/provas/noite-agenda-v2.json` | **PASSA 15/15**: a frase preenche o painel; marcar pela tela vai à fila com `fora_da_janela` (R3) e nada chega ao Google sem aprovação; a rota antiga vai à fila; o choque aparece em Conflitos com o "empurrar" pronto; feriado (Finados) bloqueia; Fora fecha o dia; Fechado conta; arrastar respeita a régua (o próprio evento fora da conta); o link mostra só livres (nenhum título ou cliente na resposta), token errado = 404, confirma, vai à fila do link, a mesa libera e o convite chega ao cliente, `.ics` sai, segunda escolha recusada; o histórico; 23 capturas sem rolagem lateral a 390 px |
| Dia (dentro da janela) · `homolog/provas/agenda-v2.json` | (a rodar depois das 08h) |

**Regressão pelos e2e das rodadas anteriores** (3031): `producao22c` 12/18, `producao22b` 13/14 e `producao22` com o passo M1 vermelho, **idênticos** na imagem da agenda v2 e numa imagem construída de `16a92871` (a produção), rodados um depois do outro na mesma stack: os passos que falham (22C: 04, 06 a 09, 11; 22B: 08, o menu da tarefa agora com nove ações; 22: M1, o cartão Implantação do Dia a dia) vêm das mudanças da produção depois da 22C, não desta rodada. A mesma troca provou a **volta segura**: a imagem da base subiu saudável sobre o banco que já tem a migration da agenda v2.

**Capturas** em `homolog/provas/agenda-v2-*.png` e `noite-agenda-v2-*.png`: cada aba em escuro, claro e 390 px, o painel com a frase, o link público (escuro e 390 px). Comparadas com o desenho: Semana com Fechado tracejado, faixas de Fora e feriado no topo, choque em magenta e fora do padrão em âmbar; Conflitos com os cartões, filtros e o histórico ao lado; o link público com dia, manhã e tarde.

**Stacks**: imagem `rootos-final-app:agenda-v2` (`5953ba876953`) nas duas. **3030** (a cópia da produção): Lead 19, User 8, Partner 18, WorkTask 202, ComercialFicha 19, Org 1 antes e depois; migrations 120 → 134 (as da produção que a cópia não tinha, mais a da agenda v2); política 1.13.0 semeada (89 capacidades). **3031**: com o dublê do Google (`google_duble`, 127.0.0.1:4035), a sobrescrita da decisão 2 aplicada pelo CLI e a política 1.13.0.

## 5. Revisão adversarial

Laudo: `homolog/revisao/agenda-v2-adversarial.md`. Veredito **fecha com ressalvas**; nada crítico. As travas se sustentam: `naTela` nasce só no controlador da tela e é conferido três vezes; a aprovação de R2 é lida por empresa, sem cache, e só vale para R2; nenhum DELETE no Google; `chamarAgenda` não sai do Calendar; RLS FORCE e quatro policies nas sete tabelas; token de 256 bits com 404 igual.

Consertados com teste (lane E): **A1** o pedido do link que vence ou é recusado na fila prendia o convite (agora o link reabre com aviso e auditoria); **M1** Google fora com espelho velho devolvia lista vazia (o link ofereceria horário ocupado); **M2** dois convites podiam confirmar o mesmo horário; **M3** criar e revogar link sem auditoria; **M4** o nome digitado no link mexia na gramática do título; **B1** o dublê aceitava IPv6 público; **B2** a sobrescrita aceitava conta de máquina como autor, e o CLI não terminava; **B4** nomes de clientes reais em testes e placeholders (trocados por fictícios; os desenhos do Rodrigo não foram mexidos); **B5** as tabelas novas fora da suíte de isolamento; **B3** a senha do banco na linha de comando do script de publicação; **B7** meia-risca nos intervalos de hora.

Ficam registrados: **A2** (§8, decisão do Rodrigo); **M5** a leitura anônima do link, com o espelho atrasado, lê o Google pela porta e grava rastro (o teto por IP limita; contornável trocando de endereço IPv6); **B6** o comentário da migration diz que o convite é resolvido só pelo hash (o código resolve pela empresa que vem no token; não editei a migration para não mudar o checksum); M2 cobre sobreposição sem o intervalo do sócio, e não conta pedidos da tela retidos na fila.

## 6. O que fica de fora, com o estado exato

- **Onda 4** (WhatsApp do grupo marcando, MCP `agenda_livre`/`agenda_marcar`): não começou, por decisão.
- **"Passar a quinta para quarta 19:30"** (cartão de rito no desenho): falta o dia de destino no desenho; o cartão oferece "Manter sem o Pedro" e "Pular esta ocorrência".
- **"Outro cliente…"** no cartão do vigia: o cartão oferece "Remarcar…".
- **`atendimento/frase-do-pedido.ts`** não descreve alterar, cancelar, desmarcar e reabrir na fila de aprovação (aparecem com o nome da capacidade).
- **Quem pediu**, gravado no evento, é quem executou: na escrita que sai da fila, é quem aprovou.
- **Corrida conhecida**: "sincronizar agora" junto com o tique da rotina pode rodar duas passagens ao mesmo tempo (os upserts são idempotentes).
- **MinIO na 3031**: nenhuma imagem do MinIO baixa nesta máquina (o registro recusa); a cópia diária responde `pulada` (sem armazém) na 3031 e está provada pela suíte (9 casos).
- `MarcarReuniao.tsx` e `GradeDaSemana.tsx` ficaram sem uso na página (não apagados).

## 7. Para publicar

**Pré-condição.** A produção tem de estar em `16a92871`. O script confere e, se não estiver, PARA e diz qual commit juntar (o Lucas publica direto).

**Migration** (uma, **aditiva**): `20261029230000_agenda_v2`. Sete tabelas novas com RLS FORCE e quatro policies cada, grant ao `mktos_app`, CHECKs; coluna `PolicyVersion.aprovacaoR2Ligada BOOLEAN NOT NULL DEFAULT true` (padrão = a regra de hoje); a permissão `agenda.regras` no Admin Master. A imagem anterior ignora tudo isso (volta segura). A conferência no fim da migration aborta se alguma tabela ficar sem isolamento.

**Política 1.13.0** (seed **antes** da subida; sem ele as rotas novas respondem 403 "não está no catálogo"):

| Capacidade | Nível | Desfazer |
|---|---|---|
| `comunicacao.agenda.sincronizar` | R0 (nova) | — |
| `comunicacao.agenda.livre_ocupado` | R0 (nova) | — |
| `agenda.reuniao.alterar` | R2 (nova) | ela mesma |
| `agenda.reuniao.cancelar` | R2 (nova) | `agenda.reuniao.reabrir` |
| `agenda.reuniao.desmarcar` | R2 (nova) | `agenda.reuniao.reabrir` |
| `agenda.reuniao.reabrir` | R3 (nova) | — (terminal) |
| `agenda.reuniao.marcar` | **R3 → R2** (reversibilidade automática, desfazer `desmarcar`; esquema aceita `bloqueio`, `pessoal`, `fora`, `responsaveis`, `motivo`, `chave`, `leadId`, `clienteId`, `forcado`) | `agenda.reuniao.desmarcar` |

São **duas assinaturas** (capacidade nova e rebaixamento: o marcar desce de nível e o esquema dele aceita mais):

```bash
POLITICA_CAPACIDADE_NOVA_AUTOR='<quem assina>' \
POLITICA_CAPACIDADE_NOVA_MOTIVO='agenda v2 29/10/2026: espelho (sincronizar, livre_ocupado), alterar, cancelar, desmarcar, reabrir' \
POLITICA_REBAIXAMENTO_AUTOR='<quem assina>' \
POLITICA_REBAIXAMENTO_MOTIVO='agenda v2 29/10/2026, decisão 2: marcar ganha o desfazer implementado agenda.reuniao.desmarcar e a escada o calcula R2; o esquema do marcar aceita bloqueio, pessoal, fora, responsaveis, chave e forcado' \
  pnpm db:seed:politica
```

**Sobrescrita assinada da casa** (decisão 2; depois de subir, quando o Rodrigo decidir ligar):

```bash
# dentro do container da API (compilado). Simula por padrão:
node dist/agenda/sobrescrita-r2-da-agenda.cli.js --org root
node dist/agenda/sobrescrita-r2-da-agenda.cli.js --org root --valer \
  --como <e-mail do Rodrigo no OS> \
  --motivo "2026-10-30: agenda v2, decisão 2 do Rodrigo (29/10): marcar, alterar, cancelar e desmarcar pela tela saem no clique para gente da casa, cada um com desfazer no OS; agente, rotinas, WhatsApp e link de escolha seguem na fila; reabrir (R3) segue pedindo outra pessoa"
# voltar a reter: --religar --valer --como ... --motivo "..."
```

O autor tem de ser gente (usuário ativo sem papel de máquina). Conferir em Configurações, cartão "Agenda".

**Variáveis.** Nenhuma nova em produção. `GOOGLE_API_DUBLE_URL` é só da homologação e **não pode** entrar no compose da produção (o código recusa domínio de fora, mas a variável não tem uso lá). As rotinas usam o storage que a produção já tem (`S3_*`).

**Permissão.** `agenda.regras` entra pela migration (não rode `db:sync-permissions`); **todos saem e entram** (a permissão viaja no JWT).

**Dados.** Nenhum passo manual de semente: na primeira abertura de `/agenda` na empresa da casa nascem as regras dos três sócios (valores do desenho), os ritos, os feriados nacionais e facultativos de 2026 e 2027 e as três regras em frase, e as rotinas `agenda.sincronizar` (ligada se o Google estiver conectado) e `agenda.copia`. A primeira passagem lê a janela inteira (-30 a +180 dias).

**Conferências depois de subir.** `/api/health` 200; a migration `20261029230000_agenda_v2` aplicada; as 6 capacidades novas no catálogo do banco; RLS nas 7 tabelas; a permissão `agenda.regras`; abrir `/agenda` e ver "sincronizado há N s" depois de 2 minutos; Conflitos e Regras carregam; `POST /api/agenda/sincronia/agora` devolve `ok`. O script grava essas conferências em `conferencias.txt`.

**O script** `homolog/agenda-v2/publicar-na-vps.sh` (**não rodado daqui**). Na receita das releases: pasta `/srv/rootos/releases/agenda-v2-<hash7>-<data>/`; confere a base `16a92871`; `cadeia-antes.txt` lida do label `com.docker.compose.project.config_files` do `mktos_api` vivo; backup do banco com sha256; imagem `rootos-official:agenda-v2-<hash7>` com os build args da viva; ensaio da migration e da política num banco descartável restaurado do backup (sem `VALER=1`, para aqui); com `VALER=1`: migration à parte, seed da política, `docker compose --project-name root_marketing-os $(cat cadeia-depois.txt) up -d --no-deps --no-build api web` (a cadeia de antes mais uma sobreposição da release que só troca a imagem); guarda de 3 min que volta sozinha para a cadeia de antes; `REPORT.txt`. A senha do banco vai por arquivo de ambiente com 600, nunca na linha de comando.

## 8. O que fica para o Rodrigo

- **[a decidir] A2, o convite ao cliente no clique.** Com a sobrescrita ligada, marcar uma reunião de cliente pela tela manda o convite do Google ao cliente por e-mail sem segunda pessoa, e o desmarcar cancela o evento (o Google avisa o cliente do cancelamento) mas não desfaz o e-mail que já saiu. O catálogo declara `exposicaoExterna: false` para as escritas da agenda desde antes desta rodada (decisão da mesa); com `true`, a escada daria R3. O desenho aprovado mostra exatamente isso ("sai no clique · convite ao cliente por e-mail"), então não mudei. A alternativa pronta para quem preferir: R2 só para o que não tem convidado de fora (interna, bloqueio, pessoal, Fora) e o marcar com cliente em R3.
- **Cada sócio compartilhar a agenda pessoal** com `operacao.root@gmail.com` como "ver só livre/ocupado" e escrever o e-mail dela em Regras (a regra do Rodrigo nasce com o Fechado ligado e sem e-mail).
- **Conferir as regras e os ritos semeados**: janela, intervalo, trajeto, teto, bloqueio de quinta e substituto de cada sócio; **[a decidir] o horário da reunião de terça** (semeada às 08:00 com a marca `[a decidir]`: nada no repositório confirma; salvar o horário na tela tira a marca); limiares que o desenho não fixa e foram escolhidos na lane (teto: acima do limite é bloqueio e as duas últimas antes dele são atenção; fora da janela de trabalho e fim de semana são atenção); facultativos com um interruptor só.
- **Ligar a sobrescrita da decisão 2** (§7) e decidir se a **janela da política** (08h a 20h) deve valer também para a agenda: fora dela, marcar pela tela vai para a fila.
- **[a decidir] `volume_atipico` na agenda.** Medido na homologação em 30/10: depois de algumas rodadas de uso, três ou quatro marcações na mesma hora já passam do triplo da média por hora da capacidade, e a régua sobe o marcar (e o alterar) de R2 para R3: vai para a fila mesmo na tela e com a sobrescrita ligada. Numa manhã de agenda cheia isso acontece. É a régua de toda escrita do OS (`policy/sinais.service.ts`); se a casa quiser o clique valendo em rajada, é ajuste de política (o limite de volume ou a média que ele usa), não da agenda.
- **Onda 4.**
- **Feriados de 2028** em diante: só 2026 e 2027 foram semeados.
