# Adendo da rodada de produção 1 — 21/10/2026 (madrugada)

> Pedidos do Rodrigo depois que a rodada começou, olhando a árvore de pastas de Tarefas na produção. Continua na branch `homolog/final-20261019`, sobre a tag `producao-21-20261021` (a entrega da rodada principal). Só homologação; a publicação é do orquestrador do Mac.
> Encerramento: `homolog/RESULTADO-PRODUCAO-21B.md` (curto, com a seção "Para publicar" atualizada para as duas rodadas juntas) + tag `producao-21b-20261021` + bundle delta `C:\Users\User\dev\producao21b-delta.bundle` (`homolog/final-20261019` e a tag, `^producao-21-20261021`) + stacks 3030 e 3031 na imagem nova.

## O que ele disse

1. "Gestão" é uma **pasta dentro de Tarefas** (a árvore de pastas do Trabalho), não uma seção do menu. "Só quero uma subdivisão mais coesa." (A rodada principal já fez isso no P3; conferir que nada virou item de menu.)
2. "**Comercial são leads, vai para dentro do Funil vivo.**" (A lista solta "Comercial" da produção.)
3. "**Pode apagar o do Jorge.**" (A lista solta "Jorge Tabeliao", 1 cartão de lixo.)
4. "Quero uma **forma fácil de editar essas pastas: apagando, editando e criando novas**."

A árvore que ele espera ver em Tarefas depois da importação:

```
DEMANDAS INTERNAS / MARKETING  (as 7 listas de hoje)
GESTÃO      Administrativo · Financeiro · Pessoas
CLIENTES    Esteira de clientes · Onboarding de cliente · Execução
SEM PASTA   Operação
```

## A1 — A lista Comercial vai para o Comercial

O que há nela na produção (lido em 21/10 00h; sem nomes aqui): 15 tarefas (13 "A fazer", 2 "Feito"), nenhuma subtarefa. **São tarefas do comercial, não leads**: cerca de 10 citam um lead ou uma proposta pelo nome no título (FUP, proposta, marcar reunião, cobrar preenchimento, indicação) e 5 são internas da máquina comercial (atualizar o pipe, entrar num grupo de networking, checar uma integração, estudar a rede de contatos, colher feedback dos clientes).

- **Tarefa que cita um lead**: vira **tarefa ligada ao lead** no Comercial (aparece no painel do lead e no cartão do funil, como a próxima ação quando for a mais antiga aberta). O lead é achado pelas mesmas regras de dedupe do importador (nome normalizado da empresa ou do contato contra os leads importados da Gestão de Leads e os que já existem); **lead que não existe é criado em Qualificação** (origem `cartao:<id>`). Se o modelo do Comercial não tiver "tarefa do lead", use o que existir (`WorkTask` com vínculo ao lead, a próxima ação da ficha, ou a tarefa do fio) e diga qual no RESULTADO; não crie tabela nova sem necessidade.
- **Tarefa interna (sem lead)**: entra no Comercial como **tarefa do comercial sem lead**, visível num bloco **"Tarefas do comercial"** no Funil vivo (recolhível, no topo ou na lateral, com contagem, filtro por responsável do painel de Filtros valendo para ele, e "+ tarefa"). Por baixo pode continuar sendo uma `WorkTask` numa lista de natureza própria do comercial que **não aparece na árvore do Trabalho**; o que importa é ela morar e ser editada no Comercial.
- Tarefa "Feito" vai como concluída (histórico), sem virar próxima ação.
- A decisão de qual tarefa cita qual lead é do importador, pelo título, com a regra escrita no código (sem nomes); o que ficar ambíguo vai para as sobras do plano (`--detalhe`) e entra como tarefa interna, nunca ligado ao lead errado.
- Depois de tudo importado, a lista "Comercial" fica sem tarefa ativa e é **arquivada** (some da árvore, como a pasta CRM).
- Tudo dentro do mesmo `importar-crm` (`--simular` / `--valer`, idempotente, auditoria `importacao.crm`, cartão de origem arquivado com o link).

## A2 — Jorge Tabeliao sai

No importador, junto com a limpeza: arquivar o único cartão e **excluir a lista** (a mesma regra da Teste teste). Listada no plano.

## A3 — Editar as pastas com facilidade

Na árvore de pastas de Tarefas (a coluna da esquerda do Trabalho), direto onde a pessoa está olhando, para quem tem `tarefas.editar`:

- **Criar pasta**: "+ nova pasta" no fim da árvore (ao lado do "+ nova lista"), nome inline, Enter salva.
- **Renomear pasta e lista**: duplo clique no nome ou menu "⋯" › Renomear, inline, Enter salva, Esc desfaz; nome repetido no mesmo nível é recusado com a frase.
- **Apagar pasta**: menu "⋯" › Apagar. Pasta vazia: confirmação simples. Pasta com listas: o diálogo oferece **mover as listas para outra pasta (ou Sem pasta) e apagar**, nunca apaga lista junto sem dizer; pasta com lista que tem tarefa ativa não some sem a pessoa escolher o destino das listas.
- **Apagar lista**: a regra do P3 (vazia ou só arquivadas, com o nome digitado); com tarefa ativa, o diálogo oferece "mover as tarefas para outra lista" ou "arquivar todas e apagar".
- **Mover lista entre pastas**: arrastar a lista para outra pasta na árvore, além do seletor que já existe.
- **Ordem**: arrastar pasta e lista para reordenar (`order`), com teclado (Alt+↑/↓) também.
- As pastas e listas protegidas continuam protegidas (a lista "Onboarding de cliente" da porta única da Implantação não se renomeia nem se apaga; a pasta Clientes não se apaga enquanto a tiver), com a frase do porquê no menu.
- Toda mudança vai pela API que já existe (ou rotas novas no `work`), com auditoria, sob o cadeado `work-arvore:<empresa>`, sem migration se der.
- Testes de tela e de API: criar, renomear (com repetido recusado), apagar vazia, apagar com listas movendo, apagar lista com escolha, arrastar entre pastas, reordenar, protegidas.

## A4 — Provas e fechamento

- `importar-crm` provado de novo no banco descartável da cópia de 19/10 (a lista Comercial e a Jorge Tabeliao existem nela? se não, fixture sintética com a mesma forma): `--simular`, `--valer`, `--valer`, `--simular` = zero; contagens no RESULTADO.
- e2e `producao21.mjs` ganha os passos da árvore (criar, renomear, apagar, mover) e do bloco "Tarefas do comercial" no funil.
- Imagem nova nas duas stacks; suítes sem vermelho novo; revisor curto: apagar nunca leva tarefa ativa sem a pessoa escolher; importador não liga tarefa ao lead errado; nada de nome no git.
- "Para publicar" atualizado: as migrations e variáveis das duas rodadas e a sequência do importador.
