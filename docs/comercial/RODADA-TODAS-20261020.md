# Ajuste do "Todas" no Trabalho — 20/10/2026 (noite)

> Pedido do Rodrigo (20/10, ~19h55), olhando o menu novo: "não faz o menor sentido ter a opção Todas as tarefas assim, pode excluir. Quero que tenha a subseção Tarefas, e nela a gente tenha condições de marcar a opção **Todas**, assim a gente consegue ver todas as tarefas e **todos os possíveis status das pastas**. A visão tem que ser completa. Adequa isso e já pode mandar para a produção."
> Branch: **`homolog/final-20261019`** (continua nela, sobre a tag `interface-entrega-20261020`).
> Ambiente: SÓ homologação no Predator. Nada em produção aqui (a virada é do Mac, pelo `VIRADA-PRODUCAO.md`).
> Encerramento: `homolog/RESULTADO-TODAS.md` (curto) + tag `interface-todas-20261020` + bundle delta `C:\Users\User\dev\todas-delta.bundle` (`homolog/final-20261019` e a tag, `^interface-entrega-20261020`) + `rootos-final` (3030) e `rootos-final-seed` (3031) de pé com a imagem nova + `VIRADA-PRODUCAO.md` apontando para a tag nova.

## V1 — o menu

- O item `trabalho-todas` ("Todas as tarefas") **sai do menu**: `oculto: true` e entrada em `ROTAS_ABSORVIDAS` (`/trabalho/todas` → `/trabalho?pasta=todas`, porquê: "o Todas é uma opção dentro de Tarefas, não uma subseção"). Nenhum `NavItem` é apagado.
- A página `apps/web/src/app/trabalho/todas/page.tsx` vira **redirecionamento** para `/trabalho?pasta=todas`, preservando a query (`segmento`, `visao`, filtros). Rota viva.
- Trabalho fica com: Tarefas · Implantação de clientes · Atas. `nav.test.ts` e os testes do shared atualizados (contagens: visíveis 46, ocultos 11, absorvidas 12, ou o que der; registrar).

## V2 — o "Todas" dentro de Tarefas, completo

Em `/trabalho` já existe o chip **Todas** na linha das pastas (`trabalho-pasta-todas`, `?pasta=todas`). Ele é a opção que o Rodrigo quer marcar. O que muda é o que ela mostra:

- **O quadro de "Todas" passa a ter as colunas reais**: hoje são três colunas virtuais por TIPO (`tipo:open`, `tipo:custom`, `tipo:closed`, em `COLUNAS_POR_TIPO`), que escondem os status de verdade. Passam a ser **a união dos status de todas as listas no recorte** (todas as listas da empresa, ou só as do segmento escolhido), uma coluna por **nome normalizado** de status (sem acento, sem caixa, sem espaço duplo), inclusive as **vazias**: a visão é completa, mostra todos os status possíveis das pastas. Ordem: pelo tipo (abertos → em andamento → concluídos) e, dentro do tipo, pela ordem da primeira lista em que o status aparece; cor = a do primeiro status com aquele nome. Id virtual da coluna: `nome:<nome normalizado>`. Cada coluna mostra a contagem e, no cabeçalho, em quantas listas o status existe (ex.: "Kickoff marcado · 2 listas"). Largura fixa das colunas com **rolagem lateral** (nunca espremer), como o Rodrigo pediu em 19/10 para o kanban.
- **Soltar um cartão numa coluna de "Todas"**: se a lista da tarefa tem um status com aquele nome, move para ele (o `PATCH` de sempre, com versão); senão, se a lista tem um status do mesmo TIPO da coluna, move para o primeiro desse tipo e a tela avisa "Movida para <status real> (a lista <nome> não tem a etapa <coluna>)"; senão, aviso com o motivo e nada muda. O comportamento de hoje (`moverPorTipo`) é o caso de queda.
- **"Ocultar concluídas"** continua escondendo as colunas de tipo `closed`. Os segmentos (`?segmento=`), a Lista (`?visao=lista`), o Calendário, os filtros, as vistas salvas e o lote continuam como estão; a Lista já mostra o nome do status.
- O chip **Todas** fica em destaque na linha das pastas (primeiro da linha, como já está), com `aria-pressed` quando marcado. Nada de rota nova.
- Agrupamento por lista continua disponível no painel de filtros para quem quiser ver por lista dentro de Todas.
- Sem migration, sem mudança de API (a API já devolve `statusId`, `statusName`, `statusType` e as `statuses` de cada lista na estrutura). Se a estrutura não trouxer os status de alguma lista, completar a leitura pela rota que já existe, sem rota nova.

## V3 — provas e fechamento

- Testes de tela: `trabalho-filtros-e-todas` ajustado (colunas reais, coluna vazia aparece, cartão cai no status de mesmo nome, queda por tipo com aviso, ocultar concluídas); `nav` e `menu` com as contagens novas; `rotas-movidas` com o redirecionamento de `/trabalho/todas`.
- `homolog/e2e/interface.mjs`: o passo do balão clica em "Tarefas" e marca o chip Todas; o passo de Todas confere que as colunas são os status reais (soma das contagens = total; existe ao menos uma coluna que não é "A fazer/Em andamento/Concluídas") e que os segmentos continuam. `final.mjs` na cópia (3030) continua 17/17; `trabalho.mjs` e `painel.mjs` verdes.
- Capturas (escuro e 390 px): Tarefas com o chip Todas marcado e as colunas reais com rolagem lateral.
- Imagem nova nas duas stacks (`--no-build` nos serviços api e web, sem perder os dados da 3030). `organizar.mjs --simular` na 3030: zero mudanças.
- `docs/comercial/VIRADA-PRODUCAO.md`: toda menção à tag `interface-entrega-20261020` passa a `interface-todas-20261020` (cabeçalho, tabela de valores, passo "Antes de começar", conferências); a linha do checklist "Trabalho › Todas as tarefas" vira "Trabalho › Tarefas › chip Todas: todas as tarefas, com as colunas dos status reais de todas as pastas e os segmentos". `final.bundle` refeito com a tag nova. Registrar que nada mais muda (sem migration, variável, capacidade ou permissão nova além do que a rodada da interface já listou).
- `homolog/RESULTADO-TODAS.md`: o pedido, o que mudou, as contagens do menu, as provas, "apagar depois" (herda). Tag, bundle delta, linha "Todas 20/10" no progresso.

## Regras duras

As de sempre (`PASSAGEM-PREDATOR-COMERCIAL.md` §0, `CLAUDE.md`). Nenhum `NavItem` apagado; rota viva; nada de dado de cliente no git; nada em produção; texto em português no padrão da casa. Uma lane só (ou duas: V1+V2 numa, V3 depois); revisor curto no fim: o Todas não mostra tarefa de outra empresa, não repete cartão, e soltar numa coluna nunca move para status que não existe na lista da tarefa.
