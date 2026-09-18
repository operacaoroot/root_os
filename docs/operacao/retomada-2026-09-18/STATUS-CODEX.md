# Retomada — 18/09/2026

Estado: **correção local concluída e commitada; não publicada nem ativada na VPS**.
Workspace: `volute`, branch `pedromagnago/varredura-pendencias-claude`,
HEAD inicial `0b5cf6253a85f9dcaf2cbf12fdfa53f663b8ee70`.
Código validado: **`8339f75791167ab05dd2b9bb9567e6a4b54ff90d`**.
Sem push, merge ou deploy. Alterações preexistentes em `STATUS-CLAUDE.md` foram preservadas.

## Continuação autorizada — resultado final local

Pedro pediu “pode continuar até o final”. As pendências locais 1 e 2 da primeira
rodada abaixo foram resolvidas, sem transformar esse pedido em autorização de VPS.

- Varredura de IA enumera empresas sob plataforma e lê/escreve reservas dentro
  de cada empresa. Arranque respeita expiração, preserva reservas recentes e as
  parcelas em voo no processo. A seleção trava a linha para impedir liberação
  duplicada por varreduras concorrentes. Não ampliou nenhuma policy.
- Limite explícito: saldo agregado não é lease distribuído. Manter **uma instância
  executora**; não usar esta correção como aprovação de múltiplas réplicas de IA.
- Provisionamento autenticado relê empresa, usuário ativo e permissão no banco
  antes de abrir a descoberta global. Recusa cliente, operador desativado,
  permissão revogada e reconfiguração via HTTP, com auditoria da recusa.
- Cadastro, roster, carga de contexto, memória e rastro funcionam sob papel restrito.
- Teste repetível da API compilada por HTTP em loopback:
  `apps/api/scripts/smoke-restrito.cjs`. Executa com ambiente limpo, credenciais
  sintéticas e banco local; recusa URL remota, banco não descartável ou papel igual ao dono.
- CI agora cobra 17 casos da plataforma e executa o teste HTTP compilado.
- Divergência de MCP no plano resolvida conforme decisão registrada do Pedro:
  **um conector MCP obrigatório como entrega**, sem transferir autorização para ele.

| Validação final local (Node 22.15.0 / pnpm 9.15.9) | Resultado |
| --- | --- |
| API padrão | 1.783/1.783 |
| Isolamento do banco | 287/287 |
| Rotas públicas com RLS | 53/53 |
| Cofre com RLS | 97/97 |
| Plataforma, reservas e onboarding com RLS | 17/17 |
| API compilada por HTTP | `SMOKE_RESTRITO_OK` |
| Imagem `linux/amd64`: mesmo smoke HTTP | `SMOKE_RESTRITO_OK`, exit 0 |
| Imagem: entrada real `node dist/main.js` | saúde `ok/ok`, versão/commit conferidos, zero reinícios |
| Tipos da API/testes, build, YAML e diff | passaram |

Nenhum caso pulado nessas execuções. Relatórios temporários:
`/tmp/rootos-continuacao-{api,isolamento,publicas,cofre,plataforma-final}.json`
e `/tmp/rootos-continuacao-smoke-final.log`.
A sequência de suítes também expôs uma fixture `root` deixada por outra suíte:
o teste novo passou a criar/remover apenas seu próprio operador, sem renomear
nem apagar a empresa preexistente; foi reexecutado com sucesso nesse estado.

### Pacote de entrega local

Tag anotada **`retomada-rls-20260918`**, no código `8339f75`, sem publicação.
Imagem **`rootos-app:retomada-rls-20260918-8339f7579116`** construída de
`git archive` do commit (sem incluir arquivos pessoais/não versionados), para
**Linux/amd64**, com build completo de API, web e MCP. ID local:
`sha256:ac9c1b8e345b2eb0b538cca6069b2bec7c98d99235bb7cff4a0b2ba2df3b59df`.

Em **18/09 às 12:36 -03**, o container iniciado pela entrada real respondeu
`status=ok`, `db=ok`, versão `retomada-rls-20260918`, commit completo esperado;
consulta pela conexão da aplicação confirmou `mktos_app`, `rolsuper=false`,
`rolbypassrls=false`, `TENANT_MODO=impor`. Sem portas publicadas, limite de
1 CPU/1 GiB, zero reinícios. Antes disso, o smoke completo passou nessa mesma
imagem compartilhando apenas a rede do banco sintético.

Artefatos locais **temporários** em `/tmp/rootos-release-rls-20260918.n0Ll10/`:
`codigo.bundle` (verificado, histórico completo) e `imagem.tar` (aprox. 475 MiB).
Hashes e plano de transferência estão no [manifesto](MANIFESTO-ENSAIO-VPS.md).
Logs: `/tmp/rootos-continuacao-imagem.log` e
`/tmp/rootos-continuacao-smoke-imagem.log`. Nada foi enviado à VPS/registry.

Limpeza local concluída: removidos apenas os containers de API/banco
`rootos-continuacao-20260918-{api,db}` e o volume exclusivamente sintético do
banco, após conferir label e mounts. O container de smoke se removeu ao terminar.
Nenhum container/volume preexistente foi removido. A imagem e os artefatos de
entrega foram mantidos; dados de teste descartados são recriáveis, sem backup.

Inventário remoto repetido às **12:21 -03**: produção/homologação saudáveis,
zero reinícios nos quatro containers API/web consultados, 86 GB livres e
6.288 MiB disponíveis. Homologação usa efetivamente **`rootos` superusuário,
`TENANT_MODO=observar`**. `mktos_app` existe, sem login/superuser/bypass; 86
tabelas têm RLS e FORCE. Logo, RLS existe mas é inerte para essa API remota.
O clone remoto contém `?? ferramentas/`: preservar; não limpar/resetar.

Próximo portão: **aprovação explícita do manifesto do ensaio remoto** em
`MANIFESTO-ENSAIO-VPS.md`. O ensaio proposto é efêmero e separado; não atualiza
produção nem a homologação existente. Não há supervisor recorrente em execução.

## Onde paramos

P1 tem evidências de instalação, atualização, recuperação e acesso humano na
homologação da ROOT. Isso não equivale ao aceite por outra pessoa em VPS limpa.
P2 (identidade/contexto/ponte do agente) e P3 (coleta local integrada) seguem pendentes.
O protótipo local de seleção de arquivos não fecha P3.

Antes de avançar, havia sete caminhos sem contexto de plataforma: a API recusava
iniciar com papel restrito do banco. Esta retomada corrigiu esses caminhos,
sem ampliar policies, desligar RLS ou acrescentar dependências.

## VPS — inventário somente leitura

Consulta em 18/09 às 11:24 -03 (14:24 UTC), no destino confirmado no manifesto anterior:

- Alias correto: **`vps-root`**, host `2.25.223.180`, hostname `srv1983380`.
  **`vps` aponta para outra máquina**; não usar o roteiro antigo literalmente.
- Produção: `http://172.16.0.1:4001/api/health` → `status=ok`, `db=ok`.
- Homologação: `http://172.16.0.1:4101/api/health` → `status=ok`, `db=ok`.
- Versão da homologação: `madrugada-v5`, commit
  `61ff10bb1461f7fa8deeb7b01fcf2100cc0f3ea5`.
- `rootos_homolog_web` estava apenas em `rootos-homologacao-net`, sem rede
  externa `easypanel`. A correção local `0b5cf62` não estava refletida nessa rede.
- Produção, homologação, landing, easyPanel e Traefik estavam em execução.

Essas sondas não provam o login pelo navegador, DNS/TLS nem o papel usado pela API.
Nenhuma instalação, recriação, alteração de configuração ou deploy remoto foi feito.

## Alterações da primeira rodada (histórico)

- Login por senha e descoberta no Google: leitura com contexto de plataforma;
  emissão de sessão, `lastLoginAt` e auditoria na empresa encontrada.
- `comEmpresaResolvida`: rejeita sentinela e troca de empresa já autenticada;
  mantém ator e correlação do contexto externo.
- Provisionamento: somente a descoberta por slug usa plataforma. A escrita ainda
  exige o contexto/autorização do chamador; não ganhou acesso global.
- ClickUp: descoberta inicial declara plataforma; execução mantém contexto da empresa.
- Financeiro: enumera empresas ativas e lê conexões dentro de cada empresa;
  saúde da integração fica na empresa correspondente, não fixada em `root`.
- Políticas e saúde: leituras de arranque/sonda declaram contexto explícito.
- Lista de chamadores e trava de cobertura mantidas; oito caminhos agora declarados.
- Nova suíte `apps/api/test/plataforma-restrita.test.ts` e passo na CI com piso de
  nove testes, para não passar quando a seção RLS deixa de ser registrada.
- Teste de provisionamento atualizado para provar que descoberta não libera escrita.
- Teste da memória: desativação temporária da RULE, exclusão sintética e reativação
  passaram a uma transação única. Corrige disputa entre workers, não muda o produto.

## Evidências da primeira rodada (antes da continuação)

Banco exclusivamente sintético em container dedicado
`rootos-retomada-20260918-db`, imagem `pgvector/pgvector:pg16`, bind
`127.0.0.1:55439`. Não foram usados dados nem credenciais reais de cliente.
Ao encerrar, esse container e seu volume sintético foram removidos; nenhum
container preexistente foi removido. Para repetir, recrie um banco descartável,
aplique migrations e seed, e configure as URLs dona/restrita dos testes.

| Verificação | Resultado |
| --- | --- |
| Migrations do zero | 40 aplicadas |
| Seed da política | base v1 e 62 capacidades |
| Suíte padrão da API | 1.783/1.783, zero falhas/pulados |
| Isolamento com papel restrito | 287/287, zero falhas/pulados |
| Plataforma com papel restrito | 9/9, zero falhas/pulados |
| `typecheck`, `typecheck:test`, `build` da API | passaram |
| Sintaxe YAML da CI e `git diff --check` | passaram |
| AppModule compilado, `TENANT_MODO=impor` | iniciou e saúde retornou `ok/ok` |

Relatórios JSON desta execução no Mac:

- `/tmp/rootos-retomada-suite-20260918-verificada.json`
- `/tmp/rootos-retomada-isolamento-20260918.json`
- `/tmp/rootos-retomada-plataforma-20260918.json`

A primeira regressão falhou por falta do seed de política. Após semear, a única
falha foi a expectativa antiga de provisionamento. Na repetição apareceu a disputa
de RULE da memória; após as correções acima, a suíte padrão passou inteira.
Os JSON em `/tmp` são temporários; os números acima são o registro persistente.

O ensaio de arranque usou `NestFactory.createApplicationContext(AppModule)` do
`dist`, em diretório temporário e ambiente limpo, sem carregar `.env` pessoal.
Não abriu porta HTTP, não chamou provedor de IA nem conector externo. Exercitou
o grafo de injeção, hooks de início e `HealthController.check()`, não o OAuth real.
O login testado usa os serviços reais e PostgreSQL restrito; o financeiro usa
resposta externa simulada, mas leituras/gravações reais no banco.

## Pendências da primeira rodada — situação após a continuação

1. **RESOLVIDA LOCALMENTE — varredura de reservas de IA:** o boot inicial revelou que
   `TetoDeCustoIaService.liberarReservasPresas` consultava
   `GastoDeIaNoDia` sem empresa. O serviço avisava e mantinha liberação sob demanda.
   Foi corrigido na continuação. Não bastava acrescentar o arquivo à lista:
   a policy não permite ler essa tabela como plataforma. A solução passou a
   descobrir empresas e operar dentro delas: implementada e testada para reservas
   em voo no processo, arranque, expiração e concorrência, sem leitura global.
2. **RESOLVIDA LOCALMENTE —** onboarding/provisionamento com papel restrito,
   incluindo cadastro, carga/memória e recusas. OAuth externo e a primeira pergunta
   ao provedor de IA não foram ensaiados; não houve uso de credenciais reais.
3. Artefato versionado e plano/manifesto de ensaio remoto preparados,
   incluindo recuperação. **Aprovação explícita do Pedro antes de mudança remota.**
   Não reutilizar aprovação antiga como autorização permanente de deploy.
4. Ligação de rede do easyPanel e ativação na homologação existente ficam para
   outra janela/manifesto/aprovação; **não fazem parte do ensaio isolado proposto**.
   Não clicar Deploy no projeto de produção para testar homologação.

## Continuação do produto

Depois desse portão, P2: token por pessoa/empresa, hash no banco, escopo mínimo,
revogação imediata, contexto com fonte e ponte para o Claude Code. P3 depois:
seleção e prévia local, consentimento, remessa idempotente e frescor na VPS.
SQL continua dependendo da autenticação real da origem na máquina do cliente.

Resolvida a divergência documental: `PLANO-PRODUTO.md` agora reflete a resposta
do Pedro em `madrugada-2026-09-17/DUVIDAS.md`, 17/09 às 09:51, que define MCP
como entregável obrigatório. A ponte não substitui
autorização da API nem exige executar Claude Code na VPS.

Para condução econômica, use o roteiro curto por checkpoint, sem pressupor
monitoramento de outra sessão: estado observado → uma tarefa delimitada →
comando → evidência → próximo portão. Escalar revisão de autorização/RLS antes
de permitir mudanças remotas. Esta sessão não instalou supervisor recorrente
nem alterou o seletor de modelo do usuário.
