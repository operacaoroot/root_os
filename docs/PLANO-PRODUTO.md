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
- **Trabalho de 16/09, commitado em `f72529b`** (ver diário): as três escritas
  internas mais sensíveis passaram pela `PortaDoOperador` — `financeiro.lancamento.criar` (R3),
  `financeiro.lancamento.excluir` (R5, responde 403 com o preparo), `usuario.permissao.alterar` (R4)
  — com `argsSchema` fechado, efeitos inscritos pelo dono do dado, telas tratando retenção e suíte
  própria. Medido: API 1721/1721 com banco, web 382/382, policy 74/74, typechecks limpos.
- **Quatro ADRs aceitos em 17/09** (`docs/adr/ADR-012..015`, commit `0890357`): caso piloto; código chega
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

**Homologação × produção:** tenants distintos isolam registros, mas não isolam código, migrations,
processos nem indisponibilidade da API compartilhada. Desenvolvimento de ferramentas roda em
ambiente separado, com banco e credenciais de teste. Usar dois tenants da mesma instância serve
para validar permissões, não como fronteira de execução de código. O agente de desenvolvimento
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

**A fonte** tem dois lados: o painel declara o destino e o alcance permitido no servidor;
o cliente escolhe e autoriza LOCALMENTE o arquivo/pasta e seus filtros. O pulso pode revogar ou
estreitar esse alcance, nunca autorizar uma pasta nova, remover exclusões ou ampliar tipos de
arquivo sozinho. Mudança que amplia alcance exige nova prévia e consentimento local. A raiz
absoluta e as credenciais SQL não viajam para a VPS. Configuração lógica:
`{ id, tipo: pasta|arquivo|sql, raizLogica, incluir[], excluir[], tiposPermitidos[], modo:
importacao|sincronizacao, regraDeExclusao: ignorar|arquivar, tamanhoMaximo }`.

**O item:** `{ caminhoRelativo, hashConteudo, tamanho, modificadoEm, mime, textoExtraido? }`.
A **prévia** é local, sem conteúdo, mostrada antes do primeiro envio. Na importação o cliente
aprova a lista. Na sincronização também escolhe explicitamente se novos arquivos dentro do
escopo poderão entrar; ampliar escopo sempre exige nova aprovação. Uma prévia incompleta não
autoriza envio. Antes de ler/enviar, revalidar caminho, tipo, limites e versão: impedir symlinks,
junctions e troca de caminho entre prévia e leitura de alcançar algo fora da seleção.

**Identidade e remessas:** token é vinculado a dispositivo, empresa e fontes autorizadas;
identidade da empresa vem do token, nunca do corpo. Pareamento tem limite de tentativas e segredo
suficientemente imprevisível; o código curto não vira uma senha adivinhável. Revogação é conferida
em cada lote, não apenas no pulso. Hash é calculado e conferido pelo servidor. Repetir a mesma
requisição não cria outra versão, mas mudar A → B → A precisa criar a versão do retorno a A:
deduplicação global pelo hash histórico não serve. Ordem/revisão por item evita lote antigo
sobrescrever conteúdo novo. Nenhuma destas garantias está implementada só por constar no contrato.

**Finalização e exclusões:** `itensVistos` como contagem não identifica o que desapareceu. Arquivar
ausências requer manifesto completo das chaves vistas, remessa de snapshot concluída sem erros e
escopo/filtros estáveis. Remessa interrompida, parcial ou com erro não arquiva ausências nem marca
sincronização completa. Registrar tentativa e sucesso separadamente; remoção de fonte/revogação
interrompe coleta/envio, mas não apaga automaticamente conteúdo já recebido.

**No servidor:** valida (fonte autorizada, tipo permitido, tamanho, remessa aberta) → organiza
(memória da empresa, `sourceType: conector`, `sourceRef: <fonte>/<caminho>`, `colhidoEm`, hash) →
expõe frescor por fonte (`ultimaRemessaEm`, `itens`, `vencido`). Item já visto com o mesmo hash não
gera versão; hash novo gera versão nova. **Exclusão na origem nunca apaga na VPS por si**: a regra da
fonte decide entre ignorar e arquivar, e arquivar é reversível.

**SQL entra como adaptador do mesmo contrato**, depois: a "fonte" é uma consulta/view autorizada, o
"item" é uma linha com chave de negócio; engine e autenticação **a confirmar por origem** (seção 5).
No primeiro adaptador, consultas/views são cadastradas e autorizadas localmente; o servidor não
envia SQL arbitrário para execução. Filtros sintáticos são defesa adicional, não prova de somente
leitura: a conta do banco deve ter privilégios restritos e a consulta deve usar parâmetros.
Arrendamento de jobs remotos não é requisito desse primeiro adaptador de coleta programada.

## 4. Etapas

Cada etapa termina num portão medido e se divide em fatias verificáveis; não há estimativa de que
uma etapa inteira caiba numa sessão. Dependência de aceite permanece aberta até ser demonstrada.
**Manutenção (M) e produto (P) são trilhos separados.**

### Trilho M — manutenção já iniciada

| # | Etapa | Evidência de aceite | Estado |
|---|---|---|---|
| M1 | As três escritas internas pela porta | suíte com banco: R3 retida, R5 recusada sem efeito, R4 retida, argumento inválido sem queimar aprovação | ✅ commit `f72529b` |
| M2 | As que faltam: `credencial.rotacionar` (R5, `PUT /integrations/:key`), `financeiro.pagamento.baixar` (R5) | mesma suíte, casos novos | ☐ |
| M3 | Rastro e Linha do tempo leem o mesmo `EventLog` | um fato aparece igual nas duas telas | ☐ |
| M4 | `/fluxos` fora do menu; `/ferramentas` nasce do catálogo que existe | o menu não anuncia módulo sem página | ☐ |
| M5 | `ia-acao@` sem senha utilizável (ou apagada) — **[decisão]** | semente não cria credencial viva sem dono | ☐ |

### Trilho P — o produto

| # | Etapa | Entregas | Evidência de aceite | Estado |
|---|---|---|---|---|
| P0 | **Decisões** | ADR-012..015 aceitos ou reescritos | os quatro com "Situação: aceita" | ✅ `0890357` |
| P1 | **Base instalável e atualizável** | `deploy/instalar.sh` (VPS limpa: segredos gerados, o que ninguém gera perguntado, `migrate deploy`, `db:seed:politica`, tenants de produção e homologação, smoke); `deploy/atualizar.sh` (tag de rollback, seed de política **antes** do `up`, `up -d --no-build`; nunca toca `ferramentas/`, `.env`, vault, dados); `GET /health/versao`; `apps/api/.env.example`; QUICKSTART reescrito | alguém que não é o Pedro sobe uma VPS limpa, atualiza para tag nova com contexto/`.env`/ferramentas intactos; `backup-db.sh --restore-test` restaura; cronometrado | ☐ |
| P1-b | **Bootstrap local sem seed destrutivo** | `pnpm bootstrap` cria admin, política e permissões e **preserva o que existe**. O `deleteMany` saiu do caminho automático e virou `db:seed:demo`, que **só roda com flag explícita e nome de banco descartável** (`/test\|dev\|local\|staging\|shadow/i`) | seed repetido preserva módulos, papéis, permissões e senha; demo exige duas travas; bootstrap real conclui duas vezes no banco de teste | ✅ `f74ef23` |
| P2 | **Identidade e contexto por empresa** | token por usuário e empresa (prefixo no texto, hash no banco, só estreita o papel, revogável no painel) substitui a conta de serviço compartilhada; `ContextBuilder` busca na **memória da empresa** (`MemoriaService.buscar`) — **a pasta ROOT nunca é reindexada para outro tenant**; resultado vazio cai para textual e o traço distingue "não achei" de "sem vetor"; teste de isolamento entre duas empresas. Ponte para o Claude Code: o `packages/mcp` que existe, com `memoria_buscar`/`memoria_ler` e o token novo — **um cliente, opcional** | outra pessoa conecta o Claude Code, pergunta algo que só existe no contexto de uma empresa que não é a `root`, recebe com fonte, e revoga — em < 10 min | ☐ |
| P3 | **Conector local — uma pasta/arquivo (o piloto)** | pareamento; fontes puxadas pelo pulso sem ampliar o consentimento local; prévia; remessa idempotente com revisão e hash; importação e sincronização; regra de exclusão; frescor e saúde no painel; revogação que vale para a coleta programada. Protótipo Python; empacotamento e instalação por usuário a validar. **Se a coleta programada roda sem sessão humana depende de como a origem autentica — medir na máquina do piloto, não presumir** | o cliente seleciona uma pasta, vê a prévia, envia; **interromper e reenviar não duplica**; uma pergunta no Claude Code cita o documento; **um arquivo fora da lista não sai**; revogar para a coleta | ☐ |
| P4 | **A primeira ferramenta** | um molde mínimo (`pnpm criar-ferramenta <nome>`: módulo com prefixo declarado, página, permissão, migration com RLS, teste, capacidade classificada) — **não é catálogo genérico**; procedimento homologação isolada → prévia → artefato versionado → publicação com rastro; recuperação compatível com schema e ensaiada, não apenas desabilitar módulo | numa VPS limpa, uma ferramenta publicada com acesso para duas pessoas, construída pelo procedimento por alguém no papel do cliente | ☐ |
| P5 | **A segunda ferramenta e a prova inteira** | mesma base, mesmo padrão, sem interferir na primeira; uma atualização do núcleo e uma restauração de backup no meio; assistido, anotando cada intervenção do Pedro | **o aceite final da seção 6** | ☐ |
| P6 | **Conector SQL como adaptador** | as sete travas (login só-leitura declarado; validação sintática que recusa `INTO`, `EXEC`, `xp_`, múltiplos comandos, malformado; teto de linhas e timeout; log com hash; homologação por padrão); contrato de job/resultado com `sql_sha256`; publicar consulta é R3; recepção com arrendamento; procedência em toda leitura. **Engine e autenticação confirmadas por origem antes de codar** | linhas do piloto em tempo medido; reenvio não duplica; job volta à fila; o número confere contra o relatório que a casa já confia | ☐ |

**Ordem:** P0 → P1/P1-b → P2 → P3 → P4 → P5 → P6. Trilho M corre em paralelo e não bloqueia; M2 sai
da fila (R5 direta é risco vivo).

Partes puramente locais, sem banco nem envio, podem ser construídas antes das dependências do
aceite integrado. **P3-a: prévia CLI em `tools/conector-local/`**, somente metadados e fixtures
sintéticas, é uma dessas partes. Não fecha P3, não autoriza coleta e não substitui o seletor visual.

**Correção do aceite P4:** desabilitar um módulo não desfaz código nem migration. Publicação requer
artefato versionado, verificação em homologação e procedimento de recuperação compatível com o
schema. Voltar a imagem só é seguro se ela ler o schema corrente; restore envolve dados e tem
ensaio separado. A geração de ferramentas não pode introduzir migrations diretamente em produção.

**Distribuição P3:** Python é usado no protótipo local por não exigir dependências. PyInstaller é
uma opção de empacotamento a avaliar, não decisão validada. Seletor visual, instalação por usuário,
armazenamento de segredos do SO e agendamento exigem validação no sistema operacional do piloto.

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
| D1 | ADR-012..015 aceitos em `0890357`; fronteira concreta de dados continua definida por cliente | resolvida para P0 | Pedro |
| D2 | N-9 executada: `.stignore` ignora `.git` **no mesmo commit** em que a VPS vira clone — nunca antes. Até lá, nenhum checkout de branch no Mac com o Syncthing ligado | P1 | Pedro |
| D3 | Deploy key de leitura por instância (repo fechado, ADR-006) | P1 | Pedro |
| D4 | Validar distribuição do conector com a TI do piloto. Assinatura pode ser necessária, mas não garante aceite do EPP; preço/fornecedor só após avaliação. Não bloqueia protótipo local sem distribuição | empacotamento P3 | Pedro e TI do cliente |
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

### 17/09/2026 — coordenação ativa e primeira fatia do conector

- Divisão comunicada ao Claude `root-os-architecture`: Claude implementa P1-b e testes; Codex
  revisa este plano e implementa `tools/conector-local/`. Sem testes concorrentes no banco dele.
- Corrigidas fronteiras de consentimento local, idempotência A → B → A, snapshot antes de
  arquivamento, revogação por lote, ambiente de homologação e recuperação de código/schema.
- P3-a implementada: prévia de uma pasta ou arquivo, subpastas opcionais, filtros, limites,
  bloqueio de links/junctions e nomes protegidos, saída sem conteúdo ou raiz absoluta. Após
  revisão cruzada do Claude, foram diferenciados reparse points de arquivos sob demanda,
  adicionados atributo `hidden`, glob sem diferença de caixa no Windows, `--max-depth` e código
  próprio para prévia incompleta. Quatorze testes com fixtures sintéticas passaram. P3 permanece
  aberto: a etapa não envia, não pareia e não persiste consentimento.
- Não houve envio à VPS, leitura de fontes reais ou uso de credenciais no protótipo.

#### Revisão independente P1-b — fechada

Em 17/09, 00:28 (America/Sao_Paulo), Codex executou, **sem banco**:

```sh
env -u TEST_DATABASE_URL -u DATABASE_URL pnpm --filter @mktos/api exec vitest run test/seed-sem-destruicao.test.ts test/banco-descartavel.test.ts
```

A primeira rodada encontrou três falhas nos testes sem banco. Claude corrigiu as três e consolidou
P1-b em `f74ef23`. Codex repetiu a validação: **22 passaram e 1 teste de banco foi corretamente
pulado** sem `TEST_DATABASE_URL`; depois repetiu contra `marketing_os_test`: **23/23 passaram**, incluindo
execuções reais do seed sobre módulos, papéis, permissões e senha personalizados, com restauração
do estado anterior no `finally`.

Correções verificadas:

1. `scripts/bootstrap.sh`: carregar `.env` terminava com status falso quando a última atribuição
   não é `DATABASE_URL`; `set -e` encerra silenciosamente. Reprodução sem acesso ao banco:
   `env -u DATABASE_URL BOOTSTRAP_ENV_FILE=apps/api/.env.example bash scripts/bootstrap.sh --so-checar`.
   Foi corrigido com retorno explícito; o modo `--so-checar` foi exercitado sem tocar no banco.
2. O teste da trava do demo confundia menção em comentário com uso de
   `PERMITIR_BANCO_NAO_TESTE`; a varredura passou a ignorar comentários sem enfraquecer a trava.
3. O teste do comando seed rejeitava `--filter` do próprio pnpm como se fosse argumento destrutivo
   do seed; a asserção agora identifica o comando `db:seed` puro.
4. O teste funcional agora restaura hash e papéis exatos capturados antes da alteração.

A comunicação pelo Orca foi restabelecida. Claude confirmou o recebimento, concluiu P1-b e fez
revisão somente leitura de P3-a. Codex incorporou os achados aplicáveis nesta etapa; a proteção
contra troca de arquivo entre prévia e leitura pertence ao emissor futuro e segue como requisito
explícito da próxima fronteira.

**Coordenação desta execução:** P1-b foi concluída por Claude e validada novamente por Codex; P3-a
foi implementada por Codex e revisada por Claude. Push, deploy, acesso a dados reais e alteração de
credenciais não fizeram parte desta fatia. Não há monitoramento automático depois que a execução
do Codex terminar.
