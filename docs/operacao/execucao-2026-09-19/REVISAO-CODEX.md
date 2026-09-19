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
