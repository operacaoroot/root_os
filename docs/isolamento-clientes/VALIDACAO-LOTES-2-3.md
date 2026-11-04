# Trabalho e arquivos por cliente — validação de 04/11/2026

Publicado às **13h50 BRT**, revisão funcional `6fea2fdb1477b00686ad4ea00d25265e1b429c1c`. API e web usam `rootos-official:clientes-trabalho-6fea2fd`, digest `sha256:17109801d391543ad6afee8bd174581b63aa65a44bceaf07b4a489ae06a58b29`. A base incorporada foi a publicação `2c45bf4465618f63bf6ad8b23be09893180edc9e`, preservando as Etapas 6–8 e a Bio.

## Comportamento entregue

A carteira restrita passa a consultar suas tarefas, subtarefas e contadores, criar tarefas em listas já acessíveis, criar subtarefas no cliente do pai, editar título/descrição e outros campos simples autorizados, e comentar. A API valida lista, status e hierarquia; recusa mudança de cliente, pai ou lista pelo PATCH restrito. Criação em listas especiais e mudança de etapa de tarefa recorrente continuam contidas. A interface oferece as ações autorizadas pelo servidor.

Anexos nativos e arquivos migrados têm autorização por tarefa antes da leitura e conferência após a abertura. Downloads com perda de acesso ou mudança de cliente são recusados. Metadados de cópias e contagem de arquivos respeitam o cliente da tarefa. A área Clientes mostra somente o estado das pastas da carteira.

Trocar cliente ou conta cancela consultas, remove detalhes e descarta rascunhos e downloads atrasados. Pessoas com visão ampla mantêm a interface anterior. Nenhuma pessoa real recebeu acesso novo nem teve a carteira alterada nesta entrega.

## Testes anteriores ao código e revisão

Foram executados testes em vermelho antes dos recortes de tarefas, arquivos, pastas, comentários, criação/edição e interface. Os testes de arquivos inicialmente falharam nos seis casos; os de pastas falharam nos dois. A interface restrita começou com seis falhas por ausência do fluxo; criação/edição e anexos tiveram ciclos adicionais.

A regressão HTTP N23 de atividade revelou um defeito real após introduzir leitura consistente: uma revogação ocorrida durante o snapshot não era percebida pela rechecagem interna. O teste foi instrumentado para comprovar que a revogação aconteceu; falhou antes da correção. Lista e detalhe agora revalidam papel e carteira fora do snapshot antes de devolver dados. O detalhe também confere novamente cliente e pai. A suíte passou depois.

Terra implementou o backend de Trabalho; Sol implementou e verificou a interface; Astra revisou autorização e escreveu o aceite HTTP/Postgres; o coordenador integrou arquivos/pastas, executou build, regressão e publicação. A revisão independente foi repetida após a correção do snapshot.

## Evidências

| Verificação | Resultado |
| --- | --- |
| API no artefato final, com Postgres descartável na VPS | **332 testes passaram em 34 arquivos**, sem skips; inclui Trabalho, núcleo de carteira, anexos/pastas, cofre e depósito |
| Atividade e revogação no clone descartável local exigido pela suíte, porta 55582 | **32 testes passaram**, sem skips |
| Interface Trabalho/Clientes e regressão das telas com visão ampla | **396 testes passaram em 33 arquivos** |
| Interface do cofre e depósito | **11 testes passaram em 2 arquivos** |
| Aceite HTTP/Nest/JWT/Postgres independente, incluído nos 332 | **12 testes passaram**; A/B, legado, cliente interno, outra organização, perfis ausentes, hierarquia, criação/edição, arquivos e revogação |
| Concorrência real | Comentário aguarda lock, confirmado em `pg_stat_activity`; reclassificação concorrente A→B retorna 409 sem gravar comentário |
| Aplicação compilada | AppModule completo em `NODE_ENV=production`, somente credenciais sintéticas e cron desligado; cofre, Trabalho e revogação verificados por HTTP |
| Build e tipos do produto | API, web e shared compilaram; typecheck web passou; o typecheck do monorepo também passou no CI |
| QA visual sintética | Desktop 1280×900 e celular 390×844; sem overflow, troca de cliente limpa dados/formulários, sem chamadas às áreas organizacionais nas telas restritas |
| Runtime publicado | Saúde e banco OK; `/trabalho`, `/clientes`, `/cofre` e `/entregar-acessos` HTTP 200; imagem/digest de API e web conferidos |

São **364 testes de API** e **407 de interface** nas baterias descritas, sem somar de novo as repetições nem o aceite HTTP já incluído no artefato. As provas autenticadas de carteira usam dados sintéticos; o runtime produtivo foi conferido por imagem, saúde e rotas públicas. Não foi criada conta sintética em produção nem emitida sessão real para essa conferência.

## CI geral e limites

O [CI da revisão funcional](https://github.com/operacaoroot/root_os/actions/runs/41870652234) terminou com falhas fora das baterias acima:

- Isolamento entre organizações: 581 passaram e 2 falharam. O catálogo não tem fixtures de cinco tabelas de Marketing (`MarketingIdeiaCard`, `MarketingMaquinaAjuste`, `MarketingNota`, `MarketingPost`, `MarketingRegua`); o chamador de plataforma em `marketing-estudio/memoria-do-marketing.service.ts` não consta do registro esperado.
- Migrations: aplicação do zero e status passaram; comparação com o schema apontou divergências de relações/defaults, incluindo Contexto e CommercialExerciseDecision.
- Tipos das suítes API: processo encerrou com falta de memória do Node, código 134. Não houve resultado conclusivo dessa checagem. O código de produção compilou.

Schema, migrations, registro de isolamento e o arquivo de Marketing citados estão iguais aos da base publicada `2c45bf44`; estes lotes não editaram nem executaram migrations. Nenhum desses checks foi desativado. Não se declara o CI geral aprovado.

Houve um 500 em leitura ALL na primeira execução local de nove casos, sem stack capturada. As repetições e o artefato final passaram, mas a causa dessa ocorrência não foi confirmada. No primeiro teste do AppModule completo, a organização sintética estava sem o módulo Trabalho habilitado e recebeu 404; a fixture foi corrigida para habilitá-lo, preservando a regra do produto.

Permanecem contidos para SELECTED: estrutura organizacional, exclusão/lixeira, horas, fontes de contexto, atas, implantação completa, delegação/agentes, upload com cópia ao Drive, criação de pasta, Comercial, Financeiro e jobs não adaptados. O plano exige validação de propriedade e ator antes de liberar esses caminhos. Produção continua com superusuário e `TENANT_MODO=observar`; não se declara RLS produtivo por cliente.

## Preservação e recuperação

Release na VPS ROOT: `/srv/rootos/releases/clientes-trabalho-arquivos-20261104/`. Contém fonte, Dockerfile, logs, `REPORT.json`, `deploy.py`, `rollback.py`, cadeia Compose anterior e backup de **163.601.512 bytes**, protegido. O backup teve seu índice conferido por `pg_restore --list`; isso não é teste de restauração integral.

O deploy comparou a configuração Compose e aceitou somente mudança das imagens de API/web. Conferiu a imagem anterior antes de publicar e recusaria mudanças concorrentes de base. Não houve migration. A recuperação aponta para `rootos-official:bio-ritmo-2c45bf4`, que já contém o núcleo de autorização por carteira; voltar apenas recolhe os novos métodos adaptados.

O depósito JUMA foi conferido antes e depois: token, cliente, prazo e conteúdo cifrado preservados; um item mantido; link público válido. Validade permanece **10/11/2026 às 21h01 BRT**. Nenhuma senha foi decifrada ou exibida. Snapshot protegido de metadados/fingerprints e backup permanecem somente na VPS e não devem ser anexados à PR.

Código e plano: [PR 47](https://github.com/operacaoroot/root_os/pull/47), `PLANO.md`, `CONTINUACAO.md` e `REVISAO-LOTES.md`.
