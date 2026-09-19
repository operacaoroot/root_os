# Status do executor Luna — 19/09/2026

Estado: **E0/E1 concluídos; E2a implementada e validada localmente; E2b aguardando checkpoint de desenho.**

## Limites observados

- Usei apenas o workspace `volute` e o alias remoto `vps-root` (`2.25.223.180`, hostname `srv1983380`).
- Não usei o alias `vps`, não escrevi na VPS, não fiz backup/restore, não alterei rede, painel,
  containers, papéis, banco, imagem, branch ou tag.
- G0 permanece fechado em `a98b8d3`/`retomada-rls-g0-20260918`; não foi reconstruído nem repetido.
- As alterações preexistentes em `docs/operacao/madrugada-2026-09-17/STATUS-CLAUDE.md` e
  `docs/PLANO-CONDUCAO-HOJE-2026-09-17.md` permanecem intactas.

## G1 — configuração efetiva encontrada

Evidência obtida em 19/09, 16:09 -03 (19:09 UTC), por labels/inspeção Docker e leitura de caminhos:

- A homologação que está rodando é o projeto Compose `root_rootos-homologacao`, em
  `/srv/rootos/homologacao/repo`, com compose efetivo
  `/srv/rootos/homologacao/repo/docker-compose.yml` + `/srv/rootos/homologacao/override.yml` e
  env-file `/srv/rootos/homologacao/.env`.
- Serviços efetivos: `rootos_homolog_api`, `rootos_homolog_web`, `rootos_homolog_db`,
  `rootos_homolog_redis`, `rootos_homolog_minio`; API/web estão na imagem
  `rootos-app:madrugada-v5-61ff10bb1461`.
- Bind/portas observados no override: web `172.16.0.1:4100→4000`, API
  `172.16.0.1:4101→4001`, DB `172.16.0.1:5443→5432`, Redis `172.16.0.1:6391→6379`,
  MinIO `172.16.0.1:9012/9013→9000/9001`.
- API monta `/srv/rootos/homologacao/vault` em `/vault` somente leitura; DB/Redis/MinIO usam
  volumes nomeados da homologação. O projeto tem arquivo `ferramentas/` não versionado no clone,
  que deve continuar preservado.
- As chaves efetivamente injetadas no container incluem `TENANT_MODO`, `DB_APP_USER`/senha,
  `DATABASE_URL`/`APP_DATABASE_URL`, `ROOTOS_VERSION`/`ROOTOS_COMMIT`, origem web e timers.
  Valores foram deliberadamente omitidos; nenhum segredo ou dado de cliente foi copiado.
- Não existe `/etc/easypanel/projects/root/rootos-homologacao`. Só existem projetos de painel
  `root/landing` e `root/marketing-os` nesse diretório. A fonte efetiva observável da homologação
  é, portanto, o Compose em `/srv/rootos/homologacao`, enquanto o dono/configuração de Deploy do
  easyPanel ainda não foi localizado.
- `rootos_homolog_web` está apenas na rede bridge `rootos-homologacao-net`; não tem labels
  `traefik.*`. O Traefik está apenas na rede overlay `easypanel`, sem ligação à rede da
  homologação. Não há referência a `homolog.operacaoroot.com` nos arquivos acessíveis de
  Traefik/painel.
- `homolog.operacaoroot.com` não resolve DNS nem na máquina local nem na VPS no momento da
  consulta; HTTPS/HTTP não puderam ser validados. Isso deixa a rota pública e o vínculo
  easyPanel como **portão real de G1**, não como configuração presumida.

Conclusão G1: a configuração runtime da homologação está identificada; a configuração efetiva
do painel/rota ainda não. Nenhuma troca remota pode ser proposta como pronta antes de descobrir o
projeto/Deploy que governa o domínio e de confirmar a ligação mínima web→Traefik.

## Lacunas P2/P3 verificadas no código

1. `packages/mcp/src/client.ts:5-25` autentica por `POST /auth/login` usando a conta compartilhada
   `mcp@marketing-os.local` + `MCP_SERVICE_PASSWORD`; não há token opaco por pessoa/empresa, hash
   persistido, escopo por token, expiração/revogação imediata ou dispositivo.
2. `packages/mcp/src/server.ts:21+` registra 35 tools read-only de dashboard, leads, finanças,
   Google, Meta e knowledge. Isso é catálogo amplo de permissões RBAC, não o recorte P2 mínimo
   (`memoria_buscar`/`memoria_ler`) por consentimento de fonte/campo.
3. `apps/api/src/agents/context-builder.service.ts:961-1015` injeta `ObsidianService.search`;
   o contrato P2 exige `MemoriaService.buscar` e fonte `ContextItem` por empresa. O runtime
   (`agent-runtime.service.ts:481-518`) passa só `orgId`, pedido e agente, sem escopo de dados
   autorizado ao provedor.
4. `apps/api/src/obsidian/obsidian.service.ts:472-508` faz descoberta global de empresas para
   o cron e vetoriza a memória de cada uma. A consulta leva `orgId`, mas não há consentimento de
   fonte/campo do ADR-015; o cron não deve ser usado como prova de fronteira do agente.
5. `apps/api/src/obsidian/obsidian.service.ts:958-1002` filtra `KnowledgeNote` por `orgId` e
   inclui `content`/snippet, porém não existe projeção de campos autorizados para o modelo.
   `ContextItem` tem `sourceType/sourceRef`, mas o schema não tem uma concessão de fronteira
   por usuário/token/fonte/campo.
6. `tools/conector-local/README.md:40-49` confirma que a fatia local atual só faz prévia CLI de
   metadados. Pareamento, identidade de dispositivo, consentimento persistido, remessa, hash,
   retomada e revogação ainda não existem.

## Desenho concreto para E2a (antes de escrever)

Objetivo único: substituir a autenticação MCP compartilhada por credencial individual vinculada a
usuário + empresa, sem ampliar a autoridade do usuário e sem fingir que isso resolve ADR-015.

Arquivos prováveis, a confirmar no follow-up:

- `apps/api/prisma/schema.prisma` + migration: entidade de credencial de agente/MCP com `orgId`,
  `userId`, nome/dispositivo, prefixo público, **hash** do segredo, escopos mínimos, emissão,
  expiração, `revokedAt`, último uso e índices. RLS/FORCE e gatilho pai-filho devem seguir o
  padrão existente; não editar histórico de migrations.
- `apps/api/src/auth/agent-token.service.ts` e módulo Auth: gerar segredo opaco uma única vez,
  armazenar somente hash, mostrar apenas prefixo/metadados depois, validar hash em cada chamada,
  exigir usuário ativo/empresa ativa, expiração e revogação imediata; revogar registra auditoria
  com ator humano e nunca imprime o segredo.
- Guard/interceptor de autenticação MCP, separado do JWT de sessão: `Authorization: Bearer` do
  token opaco resolve `orgId`/`userId` no servidor. A autoridade efetiva é a interseção entre
  permissões atuais do usuário e escopos gravados no token; token não pode elevar papel nem trocar
  empresa pelo corpo/query.
- Rotas autenticadas de painel para criar/listar/revogar credenciais, com autorização humana
  explícita e teste de revogação no request seguinte. Não criar endpoint anônimo nem aceitar token
  de sessão/reauth como token MCP.
- `packages/mcp/src/client.ts`: aceitar token opaco individual (sem senha/conta compartilhada),
  limpar respostas de erro sem refletir bearer; `server.ts`: fatia inicial mínima com
  `memoria_buscar`/`memoria_ler`, e não declarar P2 completo enquanto a fonte/campo do ADR-015
  não for aplicado.

Testes obrigatórios de E2a/E2b antes de qualquer aceite:

- emissão devolve segredo uma única vez e banco não contém plaintext;
- token expirado, revogado, usuário desativado e empresa desativada falham fechados;
- token com escopo reduzido não acessa permissão/rota não concedida, mesmo que o papel do usuário
  seja mais alto; rebaixamento/revogação do papel é observado no request seguinte;
- token de empresa A não lê empresa B por id, query, path ou corpo; dois tokens do mesmo usuário
  podem ter escopos diferentes; JWT de sessão não é aceito pelo guard MCP;
- auditoria identifica usuário/empresa/token sem registrar segredo;
- `memoria_buscar` retorna somente fontes concedidas; `memoria_ler` recusa fonte/campo não
  consentido e registra procedência. Busca vazia distingue textual de indisponível.

## Portões humanos/reais

- E1: Pedro/operador precisa confirmar o dono do Deploy easyPanel, domínio DNS e ligação web à
  rede Traefik; somente leitura atual não autoriza alteração.
- E2: ADR-015 foi aceito em 17/09/2026 e autoriza implementar localmente a opção fail-closed
  (token+MCP não ampliam fonte/campo). O aceite humano/real do produto sobre fontes/campos e a
  substituição operacional da conta de serviço continuam portões posteriores; sem isso token+MCP
  não fecha P2.
- Homologação: manifesto de release/backup/restore, papel `mktos_app`, `TENANT_MODO=impor`, troca
  apenas API/web e recuperação exigem aprovação específica posterior; produção fica fora.
- Aceite P2/P3/P4/P5 continua humano: outra pessoa deve conectar Claude Code, consultar contexto
  de uma empresa, revogar; selecionar/enviar pasta sem duplicar; publicar duas ferramentas e
  restaurar/atualizar sem perder contexto, `.env` ou customizações.

## E2a — prova local

E2a está implementado localmente: migration/modelo `AgentToken`, RLS FORCE com gatilho
`User → AgentToken`, serviço/guard separado do JWT, rotas humanas próprias e testes unitários.
Migration + suíte de isolamento (293 testes) passaram em PostgreSQL `pgvector/pg16` sintético,
com prova de leitura cruzada vazia e derivação de `orgId` pelo pai. O primeiro container de teste
chegou a ser criado com bind amplo em `55439`; foi parado imediatamente ao detectar o risco. A
recriação deve usar somente `127.0.0.1:55439:5432`, credenciais sintéticas e sem tocar containers
ou bancos preexistentes.

E2b permanece separado: concessão por fonte/campo e troca `ContextBuilder → MemoriaService`. E2c
só então reduz/integrará o MCP. Não tocar na VPS nem reexecutar G0.

### Evidências E2a

- `pnpm --filter @mktos/api typecheck` e `typecheck:test`: exit 0.
- `vitest test/agent-token.test.ts`: 14 testes unitários com mocks; `modelos-globais.test.ts`: 21
  testes; todos verdes. Esses unitários não substituem a autenticação real em banco abaixo.
- `prisma db:deploy` em PostgreSQL `pgvector/pg16` descartável: migration nova aplicada. Catálogo
  confirmou `AgentToken` com 4 policies, RLS/ FORCE ligados e trigger `AgentToken_orgId_do_pai`.
- `test:isolamento` com papel restrito `mktos_app`: 293/293; 87 tabelas com RLS+FORCE, 84 alvos,
  0 sem RLS e 0 sem FORCE. Consulta escopada viu 1 linha própria e 0 da outra empresa; INSERT sem
  `orgId` derivou o pai; cruzamento de usuário/empresa foi recusado pelo trigger.
- Serviço real via `criarPrismaService` + `TENANT_MODO=impor`: 8 emissões concorrentes para o
  mesmo usuário produziram 4 sucessos/4 recusas, mantendo o limite total em 5 (1 fixture + 4
  novas) e 4 auditorias. Ciclo real em seguida emitiu, autenticou, revogou, recusou o request
  seguinte e listou sem hash (`issuedOnce=true,resolved=true,revoked=true,listedHasNoHash=true`).
- Falha sintética do INSERT de auditoria dentro do banco fez a emissão falhar e deixou 0 linha
  `AgentToken` (`audit_failed`, contagem 0), provando rollback da transação; trigger sintético foi
  removido antes de encerrar o banco.
- Artefato compilado (`pnpm --filter @mktos/api build`) subiu localmente em `TENANT_MODO=impor`;
  o boot registrou as três rotas `/api/auth/agent-tokens*`. HTTP sem JWT retornou 401; POST com
  JWT sintético retornou 201 e a resposta tinha token uma vez, sem `tokenHash`. O processo foi
  encerrado; nenhum serviço remoto foi tocado.

Arquivos versionados que materializam as provas: `apps/api/test/agent-token.test.ts` (14 unitários
com mocks), `apps/api/test/tenant-isolation.test.ts` (RLS/trigger/isolamento real),
`apps/api/src/auth/agent-token.service.ts` e `agent-token.guard.ts` (serviço exercitado por
`tsx`), além de `apps/api/dist/main.js` gerado pelo build para o smoke HTTP. Os logs transitórios
de migration/seed usados no ensaio foram `/tmp/rootos-e2a-db-deploy.log`,
`/tmp/rootos-e2a-seed.log`, `/tmp/rootos-e2a-role.log` e `/tmp/rootos-e2a-audit-trigger.log`;
não contêm credenciais reais. O banco `rootos-e2a-pg` foi removido ao fim.

Limitações ainda explícitas: não há integração MCP/ContextBuilder nem consentimento fonte/campo
(E2b/c), e não há aceite humano real. E2a não declara P2 completo.
