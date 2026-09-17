# Plano de produto — ROOT OS: base na VPS do cliente, conector local, agente do cliente

> **Este é o fio.** Um arquivo só, com o estado de cada etapa: ✅ com data e commit quando o portão
> fechar. Revisão de 17/09/2026, coordenada pelo Codex a pedido do Pedro, incorporando as decisões
> confirmadas abaixo. Substitui, como plano vigente, o `PLANO-CONTINUIDADE.md` (histórico e fonte das
> fatias já fechadas). Nada aqui foi executado além do que a seção 0 registra.

## 0. O que já existe e fica preservado

- **A base do OS**, em produção na VPS ROOT desde 17/09: régua R0–R5 em runtime, porta única
  (`gateway/`), cofre por empresa, RLS forçado nas 72 tabelas, rastro encadeado, aprovação com segunda
  pessoa e alçada, rotinas, memória versionada por empresa, onboarding autônomo, provisionamento
  idempotente. `origin/main` = `e0e7431` contém `root-os/frente-0` e `root-os/controle-agentes`.
- **Trabalho de 16/09, não commitado** (12 arquivos alterados, 7 novos; ver diário): as três escritas
  internas mais sensíveis passaram pela `PortaDoOperador` — `financeiro.lancamento.criar` (R3),
  `financeiro.lancamento.excluir` (R5, responde 403 com o preparo), `usuario.permissao.alterar` (R4)
  — com `argsSchema` fechado, efeitos inscritos pelo dono do dado, telas tratando retenção e suíte
  própria. Medido: API 1721/1721 com banco, web 382/382, policy 74/74, typechecks limpos.
- **Quatro ADRs propostos** (`docs/adr/ADR-012..015`), aguardando decisão: caso piloto; código chega
  por `git pull` de tag; ferramenta = pasta própria; fronteira do dado que vai ao provedor do modelo.
- `docs/VARREDURA-MODULOS-ROOT-OS-2026-09-16.md` — a varredura dos 15 módulos, fonte da manutenção.

## 1. Decisões confirmadas (Pedro, 17/09/2026)

1. **Instalação padrão na VPS de cada cliente**: dados compartilhados, API, ferramentas publicadas,
   acessos e backups. O agente do cliente cria e evolui ferramentas sobre essa base.
2. **Conector local**, sem instalar o OS inteiro na máquina: inicia conexões **de saída** e envia à
   VPS só o dado autorizado. **Credenciais SQL ficam locais.** Seleciona pastas, subpastas e arquivos
   avulsos, além de consultas/views SQL autorizadas.
3. **Importação pontual ≠ sincronização.** Prévia antes do envio; filtros e exclusões; procedência;
   atualização; retomada idempotente; revogação; **exclusão só com regra explícita**.
4. **Máquina desligada interrompe a coleta; a VPS continua servindo os últimos dados com frescor
   visível.** Execução sem sessão humana **depende do modelo de autenticação da origem — não presumir.**
5. **Ingestão local coleta; a VPS recebe, valida e organiza.**
6. **MCP é opcional**, não requisito. Hospedar apps na VPS **não** obriga hospedar o Claude Code lá.
7. **Segurança por permissões, isolamento e API** — não por prompt.
8. Ferramentas novas seguem padrão: autenticação, autorização, ambiente de teste, publicação,
   recuperação. **Núcleo, contexto/dados e customizações separados.**
9. **Claude Code local não é inferência local.** O que o agente consulta vai ao provedor do modelo; o
   que pode ir é decisão do cliente, escrita (ADR-015). Isso se diz na venda, não se descobre depois.

## 2. Arquitetura

```
   MÁQUINA / REDE DO CLIENTE                       VPS DO CLIENTE
 ┌───────────────────────────────┐  HTTPS de     ┌──────────────────────────────────────┐
 │ conector local                │  saída, só    │ API (identidade, permissão, régua,   │
 │  · pastas · arquivos · SQL    │──────────────▶│   porta, rastro)                     │
 │  · credenciais ficam aqui     │               │ recepção: valida → organiza → memória│
 │  · prévia · remessa · retomada│               │ ferramentas publicadas (por tenant)  │
 └───────────────────────────────┘               │ backups · versão · frescor visível   │
 ┌───────────────────────────────┐               └──────────────────────────────────────┘
 │ Claude Code (a oficina)       │  token por pessoa           ▲
 │  lê contexto autorizado,      │────────────────────────────┘
 │  constrói em homologação,     │  MCP ou CLI: ponte opcional; quem decide é a API
 │  envia para publicação        │
 └───────────────────────────────┘
```

**Três coisas separadas, e a atualização respeita a separação:**

| Camada | Onde mora | A atualização do núcleo… |
|---|---|---|
| Núcleo ROOT | o repositório, por tag | substitui |
| Contexto e dados do cliente | banco (memória, rastro, aprovações), `.env`, vault, backups | **nunca toca**, além de `migrate deploy` |
| Customizações | `ferramentas/<nome>/` (ADR-014) | **nunca toca** |

**O que varia por cliente:** o adaptador de acesso à fonte e o dicionário. **O que é constante:** o
contrato conector↔API, a procedência e o padrão de ferramenta.

**Homologação × produção** são dois tenants da mesma instância (já existe). O agente de desenvolvimento
não recebe credencial de produção por padrão; publicar é a fronteira.

## 3. Contrato mínimo conector ↔ API

Cinco chamadas, todas iniciadas pelo conector. Nenhuma faz a VPS pedir conteúdo fora do que a fonte
declarou.

| Chamada | Quem | O quê |
|---|---|---|
| `POST /conector/pareamento` | sem token | troca **código curto** (painel, 15 min, uso único) por token opaco; o servidor guarda só o hash |
| `POST /conector/pulso` | token | `{versao, so, usuarioLocal, relogio}` → `{revogado, fontes[], intervaloMs}`. **Revogado aqui vale também para a coleta programada**: sem resposta, o conector não coleta |
| `POST /conector/remessa` | token | abre uma remessa `{fonteId, modo}` → `{remessaId}` |
| `POST /conector/remessa/:id/lote` | token | `{itens[]}` — idempotente por `(fonteId, caminhoRelativo, hashConteudo)` |
| `POST /conector/remessa/:id/fim` | token | `{itensVistos, itensEnviados, erros[]}` → o servidor aplica a **regra de exclusão** e atualiza o frescor |

**A fonte** (configurada no painel, puxada pelo pulso — o conector nunca inventa alcance):
`{ id, tipo: pasta|arquivo|sql, raizLogica, incluir[], excluir[], tiposPermitidos[], modo:
importacao|sincronizacao, regraDeExclusao: ignorar|arquivar, tamanhoMaximo }`.

**O item:** `{ caminhoRelativo, hashConteudo, tamanho, modificadoEm, mime, textoExtraido? }`.
A **prévia** é a mesma listagem sem `textoExtraido`, mostrada antes do primeiro envio; o cliente
aprova a lista, não uma pasta.

**No servidor:** valida (fonte autorizada, tipo permitido, tamanho, remessa aberta) → organiza
(memória da empresa, `sourceType: conector`, `sourceRef: <fonte>/<caminho>`, `colhidoEm`, hash) →
expõe frescor por fonte (`ultimaRemessaEm`, `itens`, `vencido`). Item já visto com o mesmo hash não
gera versão; hash novo gera versão nova. **Exclusão na origem nunca apaga na VPS por si**: a regra da
fonte decide entre ignorar e arquivar, e arquivar é reversível.

**SQL entra como adaptador do mesmo contrato**, depois: a "fonte" é uma consulta/view autorizada, o
"item" é uma linha com chave de negócio; engine e autenticação **a confirmar por origem** (seção 5).

## 4. Etapas

Cada etapa é pequena o bastante para uma sessão, termina num portão medido e não abre a seguinte
com o anterior em aberto. **Manutenção (M) e produto (P) são trilhos separados.**

### Trilho M — manutenção já iniciada

| # | Etapa | Evidência de aceite | Estado |
|---|---|---|---|
| M1 | As três escritas internas pela porta | suíte com banco: R3 retida, R5 recusada sem efeito, R4 retida, argumento inválido sem queimar aprovação | ✅ 16/09 (não commitado) |
| M2 | As que faltam: `credencial.rotacionar` (R5, `PUT /integrations/:key`), `financeiro.pagamento.baixar` (R5) | mesma suíte, casos novos | ☐ |
| M3 | Rastro e Linha do tempo leem o mesmo `EventLog` | um fato aparece igual nas duas telas | ☐ |
| M4 | `/fluxos` fora do menu; `/ferramentas` nasce do catálogo que existe | o menu não anuncia módulo sem página | ☐ |
| M5 | `ia-acao@` sem senha utilizável (ou apagada) — **[decisão]** | semente não cria credencial viva sem dono | ☐ |

### Trilho P — o produto

| # | Etapa | Entregas | Evidência de aceite | Estado |
|---|---|---|---|---|
| P0 | **Decisões** | ADR-012..015 aceitos ou reescritos | os quatro com "Situação: aceita" | ⏳ propostos |
| P1 | **Base instalável e atualizável** | `deploy/instalar.sh` (VPS limpa: segredos gerados, o que ninguém gera perguntado, `migrate deploy`, `db:seed:politica`, tenants de produção e homologação, smoke); `deploy/atualizar.sh` (tag de rollback, seed de política **antes** do `up`, `up -d --no-build`; nunca toca `ferramentas/`, `.env`, vault, dados); `GET /health/versao`; `apps/api/.env.example`; QUICKSTART reescrito | alguém que não é o Pedro sobe uma VPS limpa, atualiza para tag nova com contexto/`.env`/ferramentas intactos; `backup-db.sh --restore-test` restaura; cronometrado | ☐ |
| P1-b | **Bootstrap local sem seed destrutivo** | `pnpm bootstrap` cria admin, política e permissões e **preserva o que existe**. O `deleteMany` de `prisma/seed.ts:141` sai do caminho automático e vira `db:seed:demo`, que **só roda com flag explícita e nome de banco descartável** (`/test\|dev\|local\|staging\|shadow/i`, a mesma trava de `banco-de-teste.ts`) | rodar `bootstrap` duas vezes não apaga nada; `db:seed:demo` recusa banco cujo nome não é descartável | ☐ |
| P2 | **Identidade e contexto por empresa** | token por usuário e empresa (prefixo no texto, hash no banco, só estreita o papel, revogável no painel) substitui a conta de serviço compartilhada; `ContextBuilder` busca na **memória da empresa** (`MemoriaService.buscar`) — **a pasta ROOT nunca é reindexada para outro tenant**; resultado vazio cai para textual e o traço distingue "não achei" de "sem vetor"; teste de isolamento entre duas empresas. Ponte para o Claude Code: o `packages/mcp` que existe, com `memoria_buscar`/`memoria_ler` e o token novo — **um cliente, opcional** | outra pessoa conecta o Claude Code, pergunta algo que só existe no contexto de uma empresa que não é a `root`, recebe com fonte, e revoga — em < 10 min | ☐ |
| P3 | **Conector local — uma pasta/arquivo (o piloto)** | pareamento; fontes puxadas pelo pulso; prévia; remessa idempotente por hash; importação e sincronização; regra de exclusão; frescor e saúde no painel; revogação que vale para a coleta programada. Python + PyInstaller `--onedir`, escopo de usuário. **Se a coleta programada roda sem sessão humana depende de como a origem autentica — medir na máquina do piloto, não presumir** | o cliente seleciona uma pasta, vê a prévia, envia; **interromper e reenviar não duplica**; uma pergunta no Claude Code cita o documento; **um arquivo fora da lista não sai**; revogar para a coleta | ☐ |
| P4 | **A primeira ferramenta** | um molde mínimo (`pnpm criar-ferramenta <nome>`: módulo com prefixo declarado, página, permissão, migration com RLS, teste, capacidade classificada) — **não é catálogo genérico**; o procedimento escrito (homologação → prévia → publicar → voltar); publicar = habilitar no tenant de produção pela porta, com rastro; voltar = desabilitar | numa VPS limpa, uma ferramenta publicada com acesso para duas pessoas, construída pelo procedimento por alguém no papel do cliente | ☐ |
| P5 | **A segunda ferramenta e a prova inteira** | mesma base, mesmo padrão, sem interferir na primeira; uma atualização do núcleo e uma restauração de backup no meio; assistido, anotando cada intervenção do Pedro | **o aceite final da seção 6** | ☐ |
| P6 | **Conector SQL como adaptador** | as sete travas (login só-leitura declarado; validação sintática que recusa `INTO`, `EXEC`, `xp_`, múltiplos comandos, malformado; teto de linhas e timeout; log com hash; homologação por padrão); contrato de job/resultado com `sql_sha256`; publicar consulta é R3; recepção com arrendamento; procedência em toda leitura. **Engine e autenticação confirmadas por origem antes de codar** | linhas do piloto em tempo medido; reenvio não duplica; job volta à fila; o número confere contra o relatório que a casa já confia | ☐ |

**Ordem:** P0 → P1/P1-b → P2 → P3 → P4 → P5 → P6. Trilho M corre em paralelo e não bloqueia; M2 sai
da fila (R5 direta é risco vivo).

## 5. O primeiro piloto

- **Cliente:** ProMedical (ADR-012, proposto). VPS própria, contrato fechado, decisão de instância única
  já tomada em 11/09. **Nenhuma fonte real é acessada nesta revisão.**
- **Fonte 1 — uma pasta ou arquivo**, escolhida com o cliente entre o que já é contexto de trabalho
  dele (o vault de 139 notas é candidato natural). Modo importação primeiro; sincronização depois de
  a prévia e a retomada estarem provadas.
- **Fonte 2 — SQL**, só depois de P5. Protheus em SQL Server, banco `DADOSV12`, login `Pro_Reader`.
  **A confirmar antes de codar:** engine (pymssql × pyodbc), se a autenticação depende da sessão do
  usuário `alexandre` (sem admin; DPAPI por usuário exige tarefa com o mesmo usuário), e o que o EPP
  WatchGuard faz com tarefa agendada e binário não assinado (já apagou duas vezes).
- **Fora do piloto:** Dispropan (caso provado de método) e Custeio (segundo caso, N clientes).

## 6. Aceite final do produto

O cliente, sem o Pedro: **provisiona a VPS** (P1) → **conecta uma fonte local** (P3) → **entrega a
primeira ferramenta útil** (P4) → **cria a segunda com o mesmo padrão sem afetar a primeira** (P5).
No caminho, provado: **interrupção e reenvio não duplicam**; **fonte não autorizada não sai**; **o
backup restaura**; **a atualização não sobrescreve** contexto, `.env` nem ferramentas.

## 7. Fora do caminho obrigatório — só volta por caso real validado

Cada item só entra com uma frase escrita na tarefa: *"no cliente X, na etapa Y, faltou isto."*

- Heartbeat interno por evento (A6 do controle de agentes), metas hierárquicas (A5), contratação e
  delegação (A8) — recolocam o OS como executor; o trabalho executa no agente do cliente.
- Múltiplos clientes MCP, catálogo genérico de ferramentas, fila/orquestração própria.
- Degrau 3 do coletor (contêiner por cliente na VPS com a VPN e a credencial do cliente) — obriga a
  ROOT a guardar segredo de terceiro.
- Configuração pela tela do que hoje exige terminal (dono/pilar, teto diário, criação de rotina,
  Console como pulso) — só quando um administrador de cliente esbarrar nisso.
- Vetorização de fonte grande — só com a conta passando pelo teto de custo por empresa.

## 8. Riscos e decisões realmente pendentes

| # | O quê | Trava | Quem |
|---|---|---|---|
| D1 | Aceitar ou reescrever ADR-012..015 | P0 | Pedro |
| D2 | N-9 executada: `.stignore` ignora `.git` **no mesmo commit** em que a VPS vira clone — nunca antes. Até lá, nenhum checkout de branch no Mac com o Syncthing ligado | P1 | Pedro |
| D3 | Deploy key de leitura por instância (repo fechado, ADR-006) | P1 | Pedro |
| D4 | Certificado de assinatura de código (~R$ 1,5–3k/ano) — sem ele o EPP apaga o conector de novo | P3 | Pedro |
| D5 | Engine e autenticação do SQL do piloto; se há sessão humana na coleta programada | P6 | medir na máquina do piloto |
| D6 | `PATCH /finance/transactions/:id` ganha capacidade (R3)? É capacidade nova — exige assinatura | M2 | Pedro |
| D7 | `ia-acao@`: sem senha utilizável ou apagada | M5 | Pedro |
| D8 | Base única com o repo do Rodrigo — aberta desde 01/09; contamina qualquer item da seção 7 que volte | 7 | Pedro e Rodrigo |
| R1 | Suítes em paralelo no mesmo banco se destroem — um banco por execução; a CI já faz isso | todas | — |
| R2 | Matriz de versões da frota: instância única por cliente tem custo marginal > 0. Regra: no máximo duas versões vivas | P1+ | — |
| R3 | A vetorização chama a API de embedding fora do teto por empresa (~US$ 50–60/mês medido no vault grande). Fonte grande no conector antes de fechar isso é cheque em branco | P3, P6 | — |

## 9. Diário

### 16/09/2026 — M1: as três escritas internas mais sensíveis passam pela porta

- `POST /finance/transactions` (`financeiro.lancamento.criar`, R3), `DELETE /finance/transactions/:id`
  (`financeiro.lancamento.excluir`, R5) e `PATCH /users/:id` (`usuario.permissao.alterar`, R4) deixaram
  de chamar o serviço direto: o controlador virou tradutor para a `PortaDoOperador`, como o do Google.
- Efeitos inscritos pelo dono do dado (`FinanceService`, `UsersService`), a mesma função na hora e
  depois da aprovação. **A exclusão (R5) responde 403 com o preparo, sempre.** A tela nunca a chamava.
- As três ganharam `argsSchema` fechado. **Antes de subir: `db:seed:politica`** — não pediu assinatura
  (apertar não é afrouxar), mas a política que vale é a do banco.
- Tela do financeiro e aba de pessoas tratam `aguardando_aprovacao` em vez de dar sucesso falso.
- Suíte nova `apps/api/test/escritas-internas-pela-porta.test.ts`; a varredura de efeitos de
  `escritas-pela-porta.test.ts` cobre os dois serviços (piso 21 → 24).
- Duas suítes existentes precisaram do conserto que a onda 7 já fez uma vez: `politica-por-tenant`
  (capacidade "sem esquema" trocada por `relatorio.gerar`) e `alcada-reautenticacao`
  (`{ userId, papel }` → `{ id, roles }`). `memoria.test.ts` piscou na primeira rodada completa e
  passou sozinho e na segunda — interação de suítes no mesmo banco, não defeito.
- **Medido num processo só, contra `marketing_os_test` com a política v2 semeada:** API 1721/1721 em
  45 arquivos; web 382/382; policy 74/74; `typecheck`, `typecheck:test` e web limpos.
- **Não commitado.** Ficam diretas, declaradas: `PATCH /finance/transactions/:id` (sem capacidade),
  `financeiro.pagamento.baixar` e `credencial.rotacionar` (R5) → M2.

### 17/09/2026 — revisão do plano (esta)

- Decisões confirmadas incorporadas (seção 1). Trilhos M e P separados. Heartbeat, metas e delegação
  fora do caminho obrigatório. Bootstrap sem seed destrutivo automático (P1-b). Reindexação da pasta
  ROOT **não** se amplia a tenants (P2). Um cliente MCP, opcional. Contrato mínimo conector↔API
  (seção 3). Piloto: uma pasta/arquivo primeiro; SQL depois, com engine e autenticação a confirmar.
- Nenhum código, VPS, credencial ou fonte de cliente foi tocado nesta revisão.
