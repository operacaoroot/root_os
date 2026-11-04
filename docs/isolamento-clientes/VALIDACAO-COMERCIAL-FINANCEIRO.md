# Validação do lote 4 — Comercial e Financeiro

Data: 04/11/2026. Coordenação: Terra high (API/TDD), Sol high (UI/TDD), Astra high (revisão/paridade) e coordenador (integração/CI/publicação).

## Evidências concluídas antes da publicação

- API nova: 22 testes de domínio e HTTP/Nest/Postgres, com RED antes da implementação. Incluem outra organização, A/B, NULL, cliente interno, carteira vazia, relações divergentes, totais, revogação de permissão e de vínculo e reclassificação concorrente.
- Interface completa: 2.300 testes em 196 arquivos, zero falhas e zero skips. Typecheck web aprovado. QA sintético de Comercial e Financeiro em 1280 e 390 px, incluindo SELECTED e ALL.
- Artefato compilado: build da API e Next concluído; 51 testes focais e 38 verificações HTTP do AppModule compilado. As verificações incluem os oito GETs, totais, exclusão de dados alheios, bloqueio legado e revogação com o mesmo JWT.
- Prisma: replay integral e diff vazio; o schema descreve as constraints existentes. Nenhuma migration nova.
- Runner TypeScript: regressões para cobertura das raízes, erros no primeiro/último lote, declarações globais incompatíveis, resolução implícita de pacotes @types e limpeza do arquivo temporário. Todos os arquivos continuam sendo verificados.

## Diagnóstico da regressão da API

A execução ampla no container de teste como root registrou 6.646 casos aprovados, duas falhas de ambiente e 16 skips por ausência de configuração específica. Também encontrou uma falha de limpeza após os testes do onboarding. Esse resultado não foi tratado como suíte integral aprovada.

As duas falhas de ambiente foram reproduzidas e resolvidas sem retirar as asserções: um arquivo chmod 000 exige usuário sem privilégios, e um config temporário do compilador dentro de apps era alcançado pelo scanner de arquitetura. As duas suítes passaram juntas com usuário node e banco novo (34 casos). A limpeza do onboarding agora remove primeiro os perfis/vínculos das próprias fixtures e a suíte passou com 15 casos.

Os 16 casos condicionais exigem preparação explícita no CI: bancos descartáveis do cofre e do hash da Agenda, arquivo de conexão privado e papel restrito para a sessão do usuário. O resultado final deve ser lido no run do GitHub correspondente ao SHA, incluindo zero skips no conjunto padrão e prova nominativa do caso RLS no job de isolamento. Inferência llama.cpp real fica no comando separado `test:nativo` e não foi executada nesta rodada.

## Publicação e limites

Release: `/srv/rootos/releases/clientes-comercial-financeiro-20261104`. Os arquivos `build-final.exit`, `qa-final.exit`, `qa-http.exit` e `ci-final.exit` devem valer zero antes do deploy. O relatório de publicação registra o SHA, a imagem anterior e a nova, saúde, backup, rotas e preservação do depósito da JUMA. A leitura autenticada pós-deploy usa uma conta ALL já existente; não cria concessões reais. A prova SELECTED é feita no Postgres sintético.

Não há ativação do papel restrito em produção neste lote. As mutações comerciais e financeiras continuam fechadas para SELECTED. Os totais representam os títulos elegíveis de todos os períodos, sem saldo bancário inicial. O custo de consultar a carteira duas vezes ainda precisa de medição em volume real. Ver `REVISAO-COMERCIAL-FINANCEIRO.md`.
