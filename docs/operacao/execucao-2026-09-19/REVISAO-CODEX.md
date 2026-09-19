# Revisão da execução Luna — 19/09/2026

## R0 — diagnóstico e passagem para implementação

Fontes: `STATUS-LUNA.md`, `PLANO-PRODUTO.md`, ADR-014/015 e leitura direta de
`auth.service.ts`, `jwt-auth.guard.ts`, `permissions.guard.ts`,
`contexto.interceptor.ts`, `contexto-de-plataforma.ts`, `memoria.controller.ts`,
schema Prisma e cliente MCP. O inventário remoto é evidência reportada pelo Luna,
não uma segunda medição independente do coordenador.

Decisão: iniciar E2a local. Não ampliar o diagnóstico remoto nem considerar
DNS/painel ausentes uma licença para recriar infraestrutura. Não declarar P2
concluído apenas por haver autenticação individual.

## Critérios de revisão E2a

- Token de agente não é JWT de sessão: guard e rotas separados, sem permitir
  emissão de tokens, gestão de usuários ou outras rotas humanas pelo PAT.
- Empresa/usuário não vêm do corpo do pedido. Um seletor público no formato do
  token, se houver, não autentica ninguém; a validação completa do segredo deve
  preceder qualquer resposta com dados. Nenhuma policy global de leitura de
  tokens é liberada por conveniência.
- Segredo aleatório de pelo menos 256 bits, hash persistido, resposta única na
  emissão. Listagem, auditoria e erros não contêm segredo nem hash.
- Autoridade no uso e na emissão deriva do usuário/papel atual, com interseção
  dos escopos. JWT de sessão antigo não permite emitir privilégio já revogado.
- Revogação, expiração e desativação valem na próxima autenticação, sem cache
  positivo que preserve acesso. Escopo vazio/desconhecido falha fechado.
- RLS FORCE, integridade usuário/empresa, negação entre dois tenants e rotas
  corretas precisam de teste real em banco descartável com papel restrito.
- Unitários não comprovam injeção do Nest. A integração final exige HTTP do
  artefato compilado, com rotas registradas e modo `impor`.
- Declarar prefixos novos no contrato de módulos. A catraca estática e a rota
  compilada precisam ser verificadas; não confiar só no middleware global.
- Sem modificação de dados/papéis de produção, credenciais reais, fontes do
  cliente ou execução paga para demonstrar o comportamento.

## Limites do aceite

E2a é infraestrutura de identidade, não fronteira de conteúdo. ADR-015 segue
obrigatório em E2b/c: nenhuma fonte/campo vai ao modelo por padrão. A existência
de 35 tools legadas não autoriza conceder a todas elas um token novo. O fluxo de
MCP precisa de testes de revogação e isolamento de conteúdo antes de aceite P2.

Revisão de diff/testes E2a: **pendente de entrega do executor**.

## R1 — revisão durante a implementação E2a

O primeiro diff trouxe tabela `AgentToken`, segredo de 32 bytes, hash SHA-256,
seletor público de empresa/id, guard separado e rotas de sessão próprias.
O seletor foi aceito para roteamento da consulta, sem autorização implícita:
nenhuma nova leitura global de tokens é necessária.

Achados enviados ao Luna e já ajustados no diff parcial (ainda sem aceite de
testes): identidade inicialmente herdava todos os privilégios do usuário;
guard não exigia escopo da rota; limite de emissão tinha corrida entre count e
create; auditoria não era atômica com a mutação. A revisão pediu projeção mínima,
negação sem escopo declarado, lock transacional por usuário e auditoria na mesma
transação. A catraca de imports de plataforma também precisa reconhecer apenas
o helper seguro de empresa resolvida, sem liberar a sentinela de plataforma.

Baseline independente, antes de alterar o MCP: `pnpm --filter @mktos/mcp
typecheck`, exit 0. Isso não valida a nova implementação da API nem substitui
teste integrado.

## R2 — correção operacional do ambiente de teste

O coordenador observou `rootos-e2a-pg` publicado em `0.0.0.0:55439` e `[::]`.
Parou exclusivamente esse container descartável (`docker stop`, exit 0), sem
remover volume/dados. Orientou o Luna a recriar o bind em `127.0.0.1` antes de
prosseguir; reiniciar o container com o bind antigo não é permitido. Nenhum
serviço preexistente do usuário foi alterado. Eventuais testes interrompidos por
essa parada devem ser registrados e repetidos no ambiente corrigido.

Rechecagem: bind confirmado em `127.0.0.1:55439`. Testes independentes do
coordenador em 19/09, 16:34 -03: API `typecheck` e `typecheck:test` exit 0;
`test/agent-token.test.ts`, **14/14**, exit 0. São unitários com mocks. O Luna
reportou 293 casos do isolamento genérico; falta ainda a prova do ciclo do
serviço real (emissão/autenticação/revogação/concorrência) no banco restrito.

## R3 — passagem E2a → E2b

Luna entregou evidência do ciclo real em `impor`, emissão concorrente mantendo
5 tokens totais, rollback ao falhar auditoria e HTTP compilado (401 sem JWT,
201 na emissão, sem hash na resposta). Essas execuções foram reportadas pelo
executor; a verificação independente do coordenador continua sendo o diff,
tipos e 14 unitários acima. O teste que limita a isenção de import a
`{comEmpresaResolvida}` foi conferido no diff final.

Decisão: autorizar commit local focado de E2a e prosseguir E2b. Solicitei corrigir
o cabeçalho desatualizado de STATUS, informar logs/scripts das provas e tornar a
integração reaproveitável/versionada. Ausência de integração MCP e consentimento
significa que P2 permanece aberto. Nenhuma publicação remota está autorizada.

E2b deve filtrar fonte/campo antes da busca/limite, não apenas retirar `body` do
JSON final: buscar/rankear em campo proibido também permite inferir conteúdo.
Concessão tenant não substitui RBAC e não amplia o token; sem grant não há fallback
para vault ROOT ou memória integral. Nada de vetorização paga no recorte local.

## R4 — limitação do smoke E2a e correção exigida

Na conferência posterior, o executor confirmou uso direto de
`node apps/api/dist/main.js` no host. Esse entrypoint lê credenciais em
`~/.config/root/*.env` e inicializa os schedulers. O processo foi encerrado;
“nenhuma chamada externa observada” é relato do executor, **não prova de ausência
de tráfego externo**. O coordenador pediu entrypoint/porta, toggles usados e
eventos de inicialização, sem imprimir segredos nem consultar serviços externos.

A prova HTTP E2a demonstra rotas, mas não isolamento do ensaio. Antes de aceite
integrado, repetir em container sem mounts pessoais/credenciais ou em harness
compilado de módulos mínimos, bind loopback e timers desligados. Não repetir
`main.js` diretamente no host nem mudar `$HOME` para simular isolamento. A execução
E2b local de código não depende desse boot; continua, com esta correção obrigatória.

## R5/R6 — bloqueadores encontrados no primeiro diff E2b

- A consulta fazia união dos campos concedidos a todas as fontes e devolvia as
  colunas de cada linha sem conferir o grant daquela fonte. `A: body` + `B:
  title` poderia devolver `body` de B. Exigida projeção SQL por fonte e uma
  segunda conferência na saída, com teste negativo misturando os dois grants.
- ContextBuilder mantinha MemoriaService opcional com fallback para Obsidian,
  alegadamente para preservar testes antigos. Recusado: injeção obrigatória,
  atualizar fixtures dos testes e nenhuma volta ao vault em ausência/erro de
  consentimento. Comentário dizendo “sem fallback” não é evidência.
- Consentimento não pode declarar provedor `nenhum` enquanto autoriza envio ao
  agente externo; referência exata deve suportar nomes normais com `_`, sem
  interpretação de wildcard. Vetorização de `title + body` não pode ser liberada
  por consentimento apenas de body; neste recorte deve permanecer desabilitada.

E2b permanece **sem aceite/sem commit autorizado** até correções e negativas
reprodutíveis. Esses achados são do diff em elaboração, não de produção.

## R7/R8 — revisão adicional e prova ainda necessária

O helper novo `comTenantResolvido` inicialmente aceitava ids sentinela; exigida
recusa explícita de `__*`, preservando isolamento de contexto A/B e correlação.
Também exigida dependência obrigatória `AgentDataGrantService` no grafo, não
injeção opcional para poupar alterações de fixtures. As duas correções foram
vistas no diff subsequente; testes ainda precisam ser conferidos.

Revisor somente leitura `/root/luna_revisao_coletor` identificou um bypass de
memória adicional: `EfeitosService` registrava `contexto.memoria.buscar` chamando
`ObsidianService.search` diretamente. Orientado a passar pela memória autorizada
e cobrir a capacidade real em teste. O MCP legado `/knowledge` é outro caminho
a substituir em E2c; não está coberto por haver grant no endpoint novo. Efeitos
legados de finanças/leads não são declarados cobertos por esta fronteira de memória.

## R9 — fechar a lacuna entre teste nominal e comportamento real

A revisão independente do Luna confirmou que o primeiro teste de integração
não reproduzia o vazamento entre duas fontes do mesmo tenant: usava uma fonte
por empresa. Exigidos dois grants diferentes dentro da mesma empresa, uma fonte
sem grant mais recente, busca exclusiva no campo proibido e `LIMIT 1`. O teste
de permissão também precisa remover a permissão entre chamadas, não somente
executar concessão/revogação com um administrador ainda autorizado.

A suíte dedicada deve validar estritamente o banco descartável, sem aceitar
`PERMITIR_BANCO_NAO_TESTE`, e entrar sequencialmente na CI com piso de casos e
zero pulados. O smoke compilado seguro precisa exercer JWT/PAT/grants pela
rota real. Auditoria deve preservar ator/correlação, sem usar slug de agente
como id de credencial, e sem consulta, conteúdo ou segredo no payload.

Verificação independente em 19/09, 17:04 -03: boundary **2 pass**,
adversarial **54 pass / 12 skip**, resposta-sem-fonte **26 pass / 6 skip**;
total **82 pass / 18 skip**, exit 0. Os pulados são os trechos dependentes de
banco dessa execução. Isso não comprova integração SQL nem HTTP.

E2b segue em execução pelo escritor único. O revisor Luna prepara em paralelo
somente o mapa de extensão do MCP/painel para E2c, sem editar código.

## R10 — entrega E2b e correção de aceite E2b.1

Luna entregou `ed84dfc` com 296 casos de isolamento SQL e 3 de integração
ADR-015 reportados, além de smoke compilado seguro. O commit local preserva o
trabalho, mas **não equivale a aceite**: faltavam CI dedicada, trava estrita de
banco e negativas de revogação/PAT entre tenants no HTTP. Correção E2b.1 enviada
ao mesmo escritor, sem reverter o commit e sem ampliar escopo.

Checagem independente às 17:15 -03: arquitetura, módulos, boundary e token:
**144 pass / 9 skip**, exit 0. Os nove pulados pertencem aos cenários de banco
de módulos; não são evidência de isolamento SQL nesta execução. As duas
exceções obsoletas de arquitetura foram removidas e a catraca passou.

E2b.1 aprovada após conferir o diff incremental: a alternativa de criar o Pool
somente com a flag dedicada também impede conexão sem a validação estrita;
fora dela o teste falha fechado. CI inclui a suíte com piso 3 e zero pulados.
O smoke prova PAT B com fonte própria sem acesso à A, revogação do grant de
body e PAT revogado retornando 401. Luna reportou execução 3/3 e smoke verde;
o coordenador conferiu diff/check e sintaxe do harness (`node --check`, exit 0),
sem rodar outra suíte simultânea no banco compartilhado de teste.

Commit incremental autorizado; E2c enviado ao mesmo escritor. A CI foi alterada
localmente, não executada no GitHub (nenhum push autorizado).

Baseline independente web antes de E2c (17:21 -03):
`pnpm --filter @mktos/web test`, **382/382**, 28 arquivos, exit 0. Há warning
preexistente de React `act` em custo-ia, sem falha. O commit E2b.1 é `683888e`.

## R11 — revisão em andamento E2c

- MCP: corrigir retry legado recursivo sem limite; timeout precisa cobrir o corpo,
  não apenas headers. Exigir erros de parse sanitizados e não seguir redirect
  com bearer. Knowledge legado deve recusar a consulta, sem escapar dos grants.
- Painel: o primeiro componente usava enums inexistentes (`manual/connector`).
  Orientado a selecionar fontes já carregadas na memória, com referência exata,
  e explicar a concessão obrigatória de procedência (`sourceRef`).
- Consentimento deve conter aviso fixo de saída do conteúdo da VPS ao provedor
  do agente, sem possibilidade de apagá-lo pelo campo livre. Token não deve
  persistir em storage e resultados tardios de outra sessão devem ser descartados:
  limpar state no logout não basta se o POST de emissão ainda está pendente.
- Revisor Luna conferiu código/testes MCP e UI somente por leitura, sem executar.
  Emissão pendente seguida de troca de sessão requer teste com promessa controlada.

Conferência independente da instrução de instalação: `claude mcp add --help`,
exit 0, no CLI instalado. Confirmou sintaxe `name -e KEY=value -- node path` e
`--scope local`. Nenhum servidor foi adicionado à configuração real do Claude.
E2c ainda não aceita; executor segue implementação e provas.

## R12 — aceite local E2c e transição para o conector

Correções do transporte e das sessões foram vistas no diff final. O coordenador
executou às 17:43: web **386/386**, 29 arquivos, exit 0; MCP `smoke:e2c`, exit 0;
`git diff --check`, exit 0. Após o último ajuste de JSON malformado (erro genérico,
não retorno nulo de sucesso), repetiu o smoke MCP com exit 0. Luna entregou
integração SQL 3/3, arquitetura 40/40, tipos/builds e `SMOKE_RESTRITO_OK`.

Aceite local E2c concedido e commit focado autorizado. A nova CI não foi rodada
remotamente e a conexão humana com Claude continua sem aceite. P3/P4/P5 também
continuam abertos: a frase do executor “pendentes somente revisão/aceite humano”
é relativa ao recorte E2c, não ao projeto inteiro.

E3a.1 enviada ao Luna: pareamento/pulso/fontes/dispositivo. Remessas ficam para
E3a.2, porque a memória atual grava projeção e evento em transações separadas.
O receptor terá de demonstrar retomada e rastreabilidade sem prometer atomicidade
que a composição atual não fornece. Nenhuma coleta real foi autorizada.

Baseline independente do coletor antes de E3: `PYTHONDONTWRITEBYTECODE=1 python3
-m unittest discover -s tools/conector-local -p 'test_*.py' -v`, **14/14**, exit 0.
São testes de prévia de metadados com fixtures; não provam leitura segura do
conteúdo, envio, seleção visual ou funcionamento no Windows real.

## R13 — revisão E3a.1 em elaboração

- Trigger novo restringia `search_path`, mas consultava tabelas sem `public.`;
  exigida qualificação explícita, sem reabrir o search path.
- Pareamento deve reler usuário emissor/empresa ativos e ambas as permissões
  no momento de trocar o código. Expiração e hash não bastam se o emissor
  perdeu autoridade. Testes de downgrade e empresa inativa adicionados.
- Tentativas erradas devem persistir: lançar dentro da transação que incrementa
  contador desfaria o limite. A implementação devolve negação e só lança depois
  do commit; o teste exige contador 5 e recusa subsequente do código correto.
- Revisor Luna não encontrou outro bypass de tenant/credenciais no diff parcial.
  HTTPS continua requisito de cliente/deploy. Isso não equivale a aceite remoto.
- Exigido smoke bidirecional: JWT/PAT não são dispositivo, e dispositivo não é
  sessão humana nem PAT de memória. Código de pareamento é a única troca pública.

Provas independentes às 17:59 -03: API typecheck exit 0. Arquitetura, módulos,
rotas públicas e modelos globais: **166 pass / 29 skip / 1 fail**, exit 1.
Falha: `ConnectorDeviceSource` usa a sentinela de orgId, mas faltava no catálogo
de filhos herdados. Enviado para correção e inclusão das novas fixtures no
isolamento genérico. E3a.1 permanece sem aceite.

## R14 — aceite local E3a.1

Correções conferidas. Reexecução independente às 18:02 -03 do mesmo conjunto:
**168 pass / 29 skip**, exit 0, diff check limpo. Luna reportou **9/9** na suíte
dedicada, **309/309** no isolamento, 44 migrations do zero em banco separado
descartável (removido após ensaio), tipos/build e HTTP restrito verdes. CI dedicada
com piso 9 foi revisada, mas não executada no GitHub.

Aceite local e commit focado autorizados. Enviada E3a.2 ao mesmo escritor:
remessas/lotes/finalização, idempotência e ordem, projeção com rastro e exclusões
somente em snapshot completo. Sem acesso a fonte real nem autorização remota.

## R15 — revisão intermediária E3a.2

O receptor ainda está em elaboração, sem aceite ou autorização de commit.
Achados enviados ao escritor para corrigir e demonstrar com testes:

- O lock individual da remessa não serializa duas remessas da mesma fonte.
  A ordem atribuída na abertura deve impedir também caminho antigo ainda não
  visto e finalização antiga que arquive dados novos ou regrida o frescor.
- O guard de estado aberto tornava inalcançável o retorno idempotente de `fim`.
  Repetir o fechamento deve devolver o recibo sem novos efeitos, mantendo a
  verificação de revogação. Reutilização da chave com fonte/modo distintos é erro.
- Arquivamento de ausências pertence apenas a sincronização completa. Manifesto
  e contadores precisam corresponder ao recebido; um booleano do cliente não é
  prova suficiente. Importação não deve arquivar outros documentos.
- Revisor Luna identificou vínculos de `ContextItem` sem garantia de empresa/
  procedência no banco, colisão de chave que podia alterar nota de outra origem,
  ausência do limite configurado da fonte e contagem de fim confiada ao cliente.
- Exigidos testes de glob recursivo e exclusões, integridade da cadeia/eventos
  e `MemoriaService.conferirElos` após criar, alterar, arquivar e restaurar.
  A referência textual existente coincide com o helper canônico; não foi
  apresentada como bug. O payload e a atribuição do ator precisam manter o
  contrato de memória, sem fingir que o dispositivo é um agente cadastrado.

O coordenador prepara E3b em paralelo à implementação. Não houve coleta real,
teste com diretórios pessoais ou autorização adicional para a VPS nesta etapa.

Prova independente sem banco às 18:29 -03: `rastro-por-nivel`,
`rastro-retencao` e `memoria` somaram **38 pass / 54 skip / 1 fail**, exit 1.
A falha é a asserção textual antiga de módulo com controlador/export únicos,
incompatível com os membros acrescentados em E2b/c. Enviada ao executor para
preservar a intenção de registro no grafo sem exigir exclusividade. Os testes
unitários de rastro passaram; os casos SQL pulados não são prova de integridade.

Conferência HTTP do diff também exigiu guards nas três novas rotas e prova de
arquivo acima de 100 KiB, para não anunciar teto de 2 MiB com parser default
menor. O helper transacional de eventos deve preservar montagem/redação sem
expor atalho público para payload já montado. Essas verificações não executaram
`main.js` nem usaram credenciais reais.

Reexecução independente às 18:33 -03 após correção da asserção de registro:
**39 pass / 54 skip**, exit 0, nos mesmos três arquivos sem banco. Isso fecha
apenas a regressão unitária. A revisão seguinte manteve pendentes proveniência
exata dos vínculos SQL e isolamento do parser maior às rotas de remessa; ampliar
o parser global e retirar o de formulários não faz parte do contrato do receptor.

Às 18:39 -03, conferência independente: `typecheck` exit 0; arquitetura,
módulos, rotas públicas e modelos globais **168 pass / 29 skip**, exit 0.

### Portão de aceite E3a.2 — checklist de encerramento

- [ ] Escrita do conector coordenada com o lock da memória humana; caminho
  repetido com conteúdos diferentes no mesmo lote/snapshot é recusado.
- [ ] Helper público transacional do EventLog não permite pular montagem/redação.
- [ ] HTTP real com documento acima de 100 KiB; teto de wire fechado e restrito
  a remessa, demais JSON/formulários preservados; segredo errado recusado.
- [ ] SQL direto de ambos os vínculos para memória de outra empresa/fonte ou
  origem forjada é recusado; colisão de chave não altera a nota anterior.
- [ ] Lote/fim repetidos não duplicam; concorrência real, lote antigo de caminho
  inédito e fim antigo não alteram conteúdo/frescor recentes.
- [ ] Arquivar e restaurar mantêm versões/elos/cadeia; `ignorar` e importação não
  arquivam ausências. Teste com esse nome precisa exercitar esses dois caminhos.
- [ ] Manifesto completo omisso/desconhecido e contador falso recusados;
  parcial com erro não arquiva nem marca sucesso; revogação interrompe o ciclo.
- [ ] Falha induzida desfaz conteúdo, versão, evento e recibo; retry bem-sucedido
  mantém contagem exata. `conferirElos.ok` e cadeia verificados após o ciclo.
- [ ] CI dedicada, isolamento genérico, migration do zero e build compilado
  repetidos sobre o diff final, com resultados atualizados no STATUS-LUNA.

Lista de provas, não autorização para commit ou publicação. Não inclui testes
contra diretórios/credenciais reais nem execução de CI remota.

### Regressão ampla sem banco, 18:45 -03

O coordenador executou o conjunto padrão completo com URLs de banco removidas:
**1264 pass / 539 skip / 1 fail**, 48 arquivos aprovados, 4 ignorados, exit 1.
Única falha: inventário explícito do que uma assinatura suspensa alcança,
`assinatura.test.ts:1716`, passou a encontrar as três rotas de gestão de PAT em
`auth`. Não é autorização para apenas aumentar a lista: a justificativa de
gestão de credenciais deve ficar explícita e o consumo de memória continuar
sujeito à suspensão.

Solicitada também prova da identidade de dispositivo perante os interceptores
globais. O guard põe `connectorDevice`, enquanto suspensão procura empresa no
contexto/`request.user`; o vínculo autenticado não pode desaparecer entre as
duas camadas e liberar coleta como se fosse uma rota pública sem empresa.
Isso preserva o gate existente, sem redesenhar política de cobrança.
