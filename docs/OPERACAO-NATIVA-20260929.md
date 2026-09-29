# Operação nativa — lote Marketing e caminhos de UX

Status: implementação em revisão; não aplicada em produção.
Execution gate: autorizado por Pedro após o plano 25. Publicação condicionada aos critérios abaixo.

## Problema e resultado pretendido

O ClickUp contém a operação editorial, mas o quadro interno do OS não contém seus fluxos e materiais. A rotina de coleta não mostra onde configurar insumos e a entrada pública do OS diverge do site institucional.

Este lote prepara a importação verificável de sete listas de Marketing, preserva materiais e identidade externa, permite continuar o mesmo card no quadro, liga as telas de insumos/produção e melhora a exploração do contexto. Não representa paridade completa com ClickUp nem conclusão da migração dos outros processos.

## Escopo entregue no código

- Importador CLI com allowlist de sete IDs, dry-run padrão, criação idempotente, manifesto e reversão conservadora. Nenhuma migration de schema.
- Normalizador do snapshot específico, hashes e cópia local dos vinte anexos; dados reais ficam fora do Git.
- Arquivos servidos por rota autenticada, permissão `tarefas.ver`, conferência da organização/tarefa/índice, tamanho e SHA-256. HTML é download com sandbox, nunca injetado na página.
- Trabalho abre lista/card por URL, mostra materiais e dependências e preserva o card ao mudar de lista.
- Rotinas e Pauta oferecem caminhos para Radar, captura manual e trabalho editorial; Referências aceita hash da aba.
- Contexto ganha diretório pesquisável, nomes completos e foco nas relações declaradas do registro selecionado. Não são criadas relações de negócio fictícias.
- Raiz pública redireciona ao institucional; mapa anterior fica em `/mapa-publico`, com acesso público preservado. Login e links internos continuam nas rotas atuais.

## Critérios antes de aplicar ou publicar

- [x] Export de sete listas, 70 tarefas, vinte anexos e dez relações de dependência normalizado; contrato offline sem erros. Ordem nativa/arquivamento não fornecidos pelo conector permanecem como lacunas explícitas.
- [x] Bytes dos vinte anexos conferidos por tamanho e SHA-256.
- [x] Testes locais de contrato/idempotência/conflito, download privado e interface; builds e typechecks locais.
- [ ] Ensaio em PostgreSQL isolado: dry-run sem escrita, apply, repetição sem duplicatas, edição nativa preservada e rollback/recovery.
- [ ] Reconciliação do delta final do ClickUp e documentos editoriais associados.
- [ ] Conferência final independente do commit e CI.
- [ ] Snapshot/índice/arquivos em armazenamento persistente privado, backup do banco e versões anteriores dos serviços registrados.
- [ ] Download autenticado real com hash, recusa anônima e de outra organização; UI com teclado/móvel/temas e acesso às versões ROOT-001–015.
- [ ] Publicação e verificação das rotas. Alteração mínima do CTA institucional preparada separadamente; conferir hash antes de aplicar.

## Continuação e limites

O primeiro apply é somente Marketing da ROOT, organização `63cdd80e-0435-488d-98b5-c2653d235e50`. Conferir novamente origem, versão da aplicação e escritores concorrentes antes de qualquer publicação. Não executar `seed-trabalho.ts`: a semente histórica pode sobrescrever registros migrados.

Preparação privada local: `/private/tmp/root-os-migration-20260929` (0700). Fonte bruta, snapshots local/VPS, vinte binários e índice de arquivos. Runbook detalhado: `apps/api/prisma/import-clickup-work.md`.

A infraestrutura atual usa imagens diferentes para web e API; ambas precisam de backup e revisão explícita antes de publicar este lote. O comando usual da API executa migrations no boot: para um lote sem schema, preparar comando de inicialização sem migration e comparar o compose efetivo, sem alterar credenciais. Não restaurar o banco inteiro por cima de trabalho posterior.

Pendente do plano maior: outros vinte fluxos/listas, checklist/dependências com edição nativa, aprovação editorial ligada à versão e calendário unificado, importação dos documentos/acervo da marca, configuração dos provedores ausentes e grafo por áreas com relações operacionais persistidas. O diretório deste lote é uma melhoria de navegação, não a implementação completa desse grafo. Não houve avaliação humana de usabilidade.
