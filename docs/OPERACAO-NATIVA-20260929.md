# Operação nativa — lote Marketing e caminhos de UX

Status: código verificado em QA; publicação da interface em preparação. Importação de produção aguarda ponto de corte estável da origem.
Execution gate: autorizado por Pedro após o plano 25. Publicação condicionada aos critérios abaixo.

## Problema e resultado pretendido

O ClickUp contém a operação editorial, mas o quadro interno do OS não contém seus fluxos e materiais. A rotina de coleta não mostra onde configurar insumos e a entrada pública do OS diverge do site institucional.

Este lote prepara a importação verificável de sete listas de Marketing, preserva materiais e identidade externa, permite continuar o mesmo card no quadro, liga as telas de insumos/produção e melhora a exploração do contexto. Não representa paridade completa com ClickUp nem conclusão da migração dos outros processos.

## Escopo entregue no código

- Importador CLI com allowlist de sete IDs, dry-run padrão, criação idempotente, manifesto e reversão conservadora. Nenhuma migration de schema.
- Normalizador do snapshot específico, hashes e cópia local de todos os anexos conciliados; dados reais ficam fora do Git.
- Arquivos servidos por rota autenticada, permissão `tarefas.ver`, conferência da organização/tarefa/índice, tamanho e SHA-256. HTML é download com sandbox, nunca injetado na página.
- Trabalho abre lista/card por URL, mostra materiais e dependências e preserva o card ao mudar de lista. Painel modal com Escape, foco contido e retorno ao acionador; quadro e tabela acessíveis pelo teclado.
- Importador seletivo de sete páginas editoriais e guia de marca v2.0 pela Memória, com versão/evento e procedência. Dry-run padrão, hashes obrigatórios no apply e bloqueio de conflito ou evento ausente. Dados fora do Git.
- Rotinas e Pauta oferecem caminhos para Radar, captura manual e trabalho editorial; Referências aceita hash da aba.
- Contexto ganha diretório pesquisável, nomes completos e foco nas relações declaradas do registro selecionado. Não são criadas relações de negócio fictícias.
- Raiz pública redireciona ao institucional; mapa anterior fica em `/mapa-publico`, com acesso público preservado. Login e links internos continuam nas rotas atuais.

## Critérios antes de aplicar ou publicar

- [x] Primeiro export de sete listas, 70 tarefas, 20 anexos e dez relações de dependência normalizado; contrato offline sem erros. A origem mudou durante a retomada; esse snapshot não autoriza apply. Ordem nativa/arquivamento não fornecidos pelo conector permanecem como lacunas explícitas.
- [x] Bytes dos vinte anexos conferidos por tamanho e SHA-256.
- [x] Testes locais de contrato/idempotência/conflito, download privado e interface; builds e typechecks locais.
- [x] Ensaio do baseline em PostgreSQL isolado: dry-run sem escrita, 651 criações, repetição sem duplicatas, edição nativa preservada, rollback e recuperação dos dois intervalos de falha. Repetir com a fonte final antes do apply.
- [ ] Reconciliação do delta final do ClickUp e documentos editoriais associados.
- [ ] Conferência final independente do commit e CI. O diff da interface foi revisado por dois agentes; falta a CI do commit final.
- [ ] Snapshot/índice/arquivos em armazenamento persistente privado, backup do banco e versões anteriores dos serviços registrados.
- [ ] Download autenticado real com hash, recusa anônima e de outra organização; UI com teclado/móvel/temas e acesso às versões ROOT-001–015.
- [ ] Publicação e verificação das rotas. Alteração mínima do CTA institucional preparada separadamente; conferir hash antes de aplicar.

## Continuação e limites

O primeiro apply é somente Marketing da ROOT, organização `63cdd80e-0435-488d-98b5-c2653d235e50`. Conferir novamente origem, versão da aplicação e escritores concorrentes antes de qualquer publicação. Não executar `seed-trabalho.ts`: a semente histórica pode sobrescrever registros migrados.

Os testes de navegador com fixtures passaram em 375, 768, 1024 e 1440px nos três temas; isso não equivale a validação humana ou produção. A sessão administrativa expirou na retomada e precisa de novo login para verificação visual autenticada.

Preparação privada local: `/private/tmp/root-os-migration-20260929` (0700). Fonte bruta, snapshots local/VPS, vinte binários e índice de arquivos. Runbook detalhado: `apps/api/prisma/import-clickup-work.md`.

A infraestrutura atual usa imagens diferentes para web e API; ambas precisam de backup e revisão explícita antes de publicar este lote. O comando usual da API executa migrations no boot: para um lote sem schema, preparar comando de inicialização sem migration e comparar o compose efetivo, sem alterar credenciais. Não restaurar o banco inteiro por cima de trabalho posterior.

Pendente do plano maior: outros vinte fluxos/listas, checklist/dependências com edição nativa, aprovação editorial ligada à versão e calendário unificado, conciliação e importação do restante do acervo da marca, configuração dos provedores ausentes e grafo por áreas com relações operacionais persistidas. O diretório deste lote é uma melhoria de navegação, não a implementação completa desse grafo. Não houve avaliação humana de usabilidade.

## Atualização durante o dia

A segunda captura encontrou 104 tarefas e 71 anexos (52.765.884 bytes). A origem continuou mudando durante a leitura: uma tarefa ganhou nova data de atualização e o documento editorial passou a sete páginas. Arquivos preservados em `root-os-migration-20260929-refresh`, explicitamente marcados como não estáveis. Não aplicar essa captura como se fosse um corte conciliado.

O importador de contexto passou em PostgreSQL isolado: oito notas, versões e eventos; repetição sem duplicação; edição nativa bloqueada; guia canônico igual reutilizado e guia diferente recusado. Testes reais de falha EventLog e concorrência entre importadores não foram executados.

A interface pode ser publicada separadamente: links de listas ausentes mostram aviso, sem abrir outra lista por engano. Publicar a interface não declara migração dos dados concluída.
