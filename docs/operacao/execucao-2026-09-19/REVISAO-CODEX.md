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
