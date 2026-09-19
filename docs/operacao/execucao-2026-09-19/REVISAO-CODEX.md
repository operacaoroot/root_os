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
