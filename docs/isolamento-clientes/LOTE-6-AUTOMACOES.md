# Lote 6 — origem das automações por cliente

04/11/2026. Continuação autorizada de fechamento, contratos e recebimento de arquivos, com testes antes do código. Base: `3c58de10888b427afa512ca31ba249234cccd02d` (PR #48). Branch própria: `codex/isolamento-clientes-lote6`, no checkout `/Users/pedro/Library/Projetos/root-os-clientes-contexto`. Nenhuma publicação ou alteração no checkout de Lucas faz parte deste lote.

## Tarefas e modelos

| Tarefa | Responsável | Critério |
| --- | --- | --- |
| Mapear fontes persistidas | Explorador | Sala, mensagem/conversa, documento e aprovação exata; telefone ou evento solto não bastam |
| Fechamento, produtores e transporte da aprovação | GPT-6.1 Sol, high | Preservar proponente, recusar conversão de humano em sistema, permitir retry verificável |
| Guardas de pasta/arquivo e integração da Porta | GPT-6.1 Terra, high | Revalidar origem antes de consumo e efeitos, inclusive revogação e veto |
| Recibos, migration, integração e CI | Coordenador Codex | Provas em PostgreSQL descartável, build e boot; conferir SHA final |
| Revisão independente | GPT-6 Astra, high | Procurar troca de origem, cliente ou capacidade, e permissões perdidas após aprovação |

## Contrato implementado

- Fechamento transmite a referência da aprovação R4 consumida. A pasta recupera o originador de Approval/ToolCall, confere hash, lead, versão, cliente e veto atual. Uma tentativa humana expirada exige nova iniciativa humana; não vira uma proposta automática.
- O documento emitido conserva `origemApprovalId`, inclusive pelo caminho de token. O ID e o aprovador usados no efeito vêm do consumo real; um ID de aprovação enviado pelo chamador é descartado. Uma aprovação de outra capacidade ou abaixo de R4 não pode ser usada para emitir contrato ou fechar.
- `OrigemArquivoCliente` registra fonte, organização, lead/cliente conhecidos, conteúdo e snapshot versionado. A prova é imutável; a revogação é definitiva. O recibo não concede autorização de envio.
- Sala confere a geração do token, validade e revogação. WhatsApp exige mensagem e conversa persistidas, instância atual, entrada recebida e vínculo canônico; documentos e imagens são aceitos. Contrato exige documento/provedor/ID externo/assinaturas e aprovação original antes do download.
- Origem humana mantém usuário ativo, perfil ALL e permissões atuais. Origem externa não recebe um usuário fictício. Cliente conhecido não muda; lead ainda sem cliente resolve a ficha atual, e o destino fica assinado na aprovação R3.
- Arquivista relê a prova no recebimento, classificação, fila, retry, resposta idempotente e efeito. A aprovação individual R3 continua obrigatória. Mudança concorrente não pode sobrescrever origem ou destino.
- Sala aguarda o resultado da cópia e registra seu estado, conservando o arquivo recebido no OS. Falha de ingestão do WhatsApp permite reentrega; ausência de ID persistido ou vínculo canônico impede arquivamento automático.

## Testes antes das correções

As reproduções negativas cobriram download de documento com ID externo divergente ou assinatura ausente; humano expirado reproposto como sistema; sistema sem prova; aprovação parent abaixo de R4; token de outra capacidade; perda da referência pelo caminho de token; veto após a proposta de pasta; e fluxo anterior de Sala/WhatsApp sem recibo.

Os testes de integração usam PostgreSQL real, guardas e Porta reais, com Drive, storage e provedores simulados. A integração de efeitos semeia a aprovação R4 consumida; os testes de produtores e de token cobrem separadamente o transporte dessa referência. Isso não comprova uma operação em produção com provedores reais.

Validação local final: 304 testes em 17 arquivos; checagem de tipos dos novos testes e código transitivo; build da API; boot do Nest compilado com seis rotas respondendo 401; migrations aplicadas do zero e comparação com schema sem diferenças. Evidências em `/tmp/root-clientes-lote6/`: `focal-final.log`, `parent-types.log`, `api-build-final.log`, `api-boot.log` e `migration-diff.log`. A revisão estática independente não identificou bloqueio restante após as correções de R4, transporte do token e veto.

O primeiro CI encontrou três erros de tipagem na fixture de `pasta-fechamento-escopo`: mock sem argumentos e inferência restrita a `user`. Após corrigir as assinaturas da fixture, a checagem conjunta dos 13 arquivos de teste alterados passou, assim como seus três casos focais (`all-changed-types.log`, `pasta-types-green.log`). A correção não muda o runtime.

## Migration e publicação futura

A migration é aditiva: cria a tabela de recibos com RLS e acrescenta a origem da emissão ao documento. Não preenche registros legados com identidade presumida. Documentos antigos sem origem continuam impedidos de cópia automática até um procedimento explícito de recuperação.

O catálogo acrescenta os argumentos de proveniência sem reduzir R3/R4. Em ambiente já semeado, a atualização de catálogo deve seguir a decisão registrada pelo seed; o ensaio local usa somente banco descartável e autoria de QA identificada. CI usa banco vazio.

Antes de publicar, reconciliar o SHA e os arquivos atuais de Lucas, conferir interseções em Comercial, preparar recuperação da migration e atualizar o catálogo efetivo. Não substituir uma imagem recente pela base antiga deste checkout. Reverter somente a imagem não apaga recibos; remover a tabela perderia evidência e não faz parte do plano.

PostgreSQL e provedores externos não formam uma transação única. Revogação pode impedir a próxima operação; não desfaz uma operação já iniciada. CI, SHA final e evidências de build/boot serão registrados no PR, que permanece em rascunho.
