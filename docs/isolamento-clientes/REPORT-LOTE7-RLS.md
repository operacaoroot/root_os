# Lote 7 — integração com o banco restrito

Data: 04/11/2026, São Paulo. Issue [#53](https://github.com/operacaoroot/root_os/issues/53). Entrega em checkout isolado; nenhum deploy ou efeito externo real nesta rodada. O resultado do CI e o SHA final são registrados no corpo do PR desta branch, junto a este relatório.

## Base e coordenação

- Checkout: `/Users/pedro/Library/Projetos/root-os-lote7-rls`, branch `codex/isolamento-clientes-lote7-rls`.
- Base: `830e7e41`, correspondente à publicação restrita da API `d8c0453b`. Merge `d5e150bd` incorpora a pilha até `81d94068`, incluindo dependências dos lotes 5/6. Os checkpoints anteriores permanecem preservados.
- Sol: Sala, aprovação e concorrência por token. Terra: emissão, documento vinculado e callback. Astra: revisão independente. Coordenador: integração, preflight comum, migrations, gate de CI, tipos, build e boot.
- Conferência somente leitura na VPS: API `sha256:bbceb623bbdd9d16bb2ce79bf41c994f6533fd1d9da68969e35ec3f376eed910`, `mktos_app`/`impor`, 98 arquivos Compose. O checkout de Lucas não foi alterado. Frontend, MCP e infraestrutura Prisma/Bio/tenants da base restrita não receberam mudanças.

## Correções após testes negativos

1. Novo clique da Sala reutilizava uma aprovação confirmada mesmo após revogação do aprovador. Agora revalida a aprovação inteira; se perdeu validade, cria outro pedido pendente. Reativar a pessoa não restaura a autoridade do pedido substituído.
2. Emissão por registro podia reutilizar documento de outra aprovação. A origem precisa corresponder à aprovação persistida, inclusive no retorno idempotente.
3. A divergência de origem agora é recusada antes do consumo, com ou sem documento já vinculado ao registro. A aprovação permanece confirmada e sem `consumidoEm`.
4. A correção também preserva a repetição legítima: havendo vínculo, confere o documento exato do registro. Outro documento de mesmo hash não o substitui nem bloqueia essa repetição. Sem vínculo, a busca por conteúdo continua conservadora diante de origem divergente.

Cada correção teve RED antes do código e GREEN depois. O gate de CI também foi testado contra ausência/duplicação de arquivos, pulos, redução de casos, totais incoerentes e remoção das cinco regressões obrigatórias.

A primeira execução completa do CI (`41949654004`, commit `fb20aacd`) passou isolamento, migrations e tipos, mas revelou uma asserção instável em `work-estrutura-sugerida.test.ts`: os mesmos três IDs chegaram em ordem diferente, pois a consulta não tinha ordenação. O teste agora ordena por ID único e compara todas as colunas das etapas, inclusive a posição, depois de mover a lista e repetir a operação. O arquivo passou 11/11 no PostgreSQL local; não houve mudança no código do produto por essa falha.

## Provas locais

| Prova | Resultado | Registro em `/tmp/root-clientes-lote7-rls/` |
| --- | --- | --- |
| Sala e emissão com papel real | 23/23, sem pulos; duas empresas, RLS/FORCE, SQL e serviços reais | `lote7-rls-final.log`, `lote7-rls-final.json` |
| Guardas e automações dependentes | 144/144 em 10 arquivos | `dependencias-regressao.log` |
| Regressões comerciais finais | 209/209 em 12 arquivos | `comercial-regressao-final.log` |
| Estrutura sugerida após falha no CI | 11/11; preservação completa das etapas nas duas chamadas | `work-estrutura-sugerida-red-ci.log`, `work-estrutura-sugerida-green.log` |
| Gate da suíte RLS | 8/8 | `gate-final.log` |
| Tipos focais e dependências transitivas | exit 0 | `types-final.log` |
| Build API | exit 0 | `build-final.log` |
| Boot compilado | papel sem SUPERUSER/BYPASSRLS, guarda injetada, saúde 200, sete rotas 401 e consulta sem tenant negada | `boot-final.log` |
| Migrations | aplicadas do zero e sobre a base restrita; schema sem diferença | `migration-empty.log`, `migration-upgrade.log`, `schema-upgrade-diff.log` |

Os conjuntos têm sobreposição; não somar os números como casos únicos. A conexão dona foi usada para dados sintéticos e limpeza; comportamentos novos foram executados pelo papel restrito. Provedores foram simulados e o boot usou ambiente sem credenciais externas, com rede de saída bloqueada. A prova HTTP de boot verifica saúde e autenticação; as provas de publicação/emissão usam os serviços reais e banco real, sem certificar uma integração externa.

O teste concorrente da Sala consumiu um token uma só vez e atribuiu a publicação ao aprovador persistido. Após revogação, a recusa preservou o token; restaurado o acesso, o mesmo token pôde seguir o caminho autorizado. O webhook público resolveu a empresa, registrou o fato legítimo após revogação e restaurou o contexto externo. Outra organização permaneceu isolada. A revisão independente não encontrou P1/P2 restante no diff final.

## Limites e próxima integração

- A pilha 5/6/7 ainda não foi publicada. Antes disso, conferir novamente o estado de Lucas, preservar a cadeia efetiva, ensaiar backup/restauração da nova release e atualizar o catálogo pelo procedimento de autoria do seed. O catálogo de produção não foi alterado.
- M7 com links de assinatura permanece suspensa até transportar proveniência própria. Escritas SELECTED continuam contidas.
- Não houve assinatura, cobrança, mensagem, upload, nova permissão real ou criação de acesso externo.
- A cópia derivada para Drive mantém testes simulados do lote 6; esta rodada não certifica esse percurso completo sob RLS nem integração real com ZapSign/Drive.
- O consumo real por botão/token foi coberto na Sala. A emissão foi coberta pela guarda pré-consumo e pelo efeito com aprovação persistida; não há nova prova ponta a ponta do botão/token de emissão nesta rodada.
- Decisões/retries comerciais, régua de contratos importados, WhatsApp derivado, contexto/busca e ampliação de MCP continuam como recortes posteriores.
- As provas são isoladas. Não constituem aceite em produção nem encerram o programa de isolamento por cliente.
