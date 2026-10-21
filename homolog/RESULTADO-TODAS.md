# RESULTADO do ajuste do Todas no Trabalho (20/10/2026, noite)

> Branch `homolog/final-20261019`, sobre a tag `interface-entrega-20261020`. Tag `interface-todas-20261020`. Bundle delta `C:\Users\User\dev\todas-delta.bundle` (`homolog/final-20261019` e a tag, `^interface-entrega-20261020`); `C:\Users\User\dev\final.bundle` refeito.
> Roteiro: `docs/comercial/RODADA-TODAS-20261020.md`. Registro: `homolog/progresso.md` (linha "Todas 20/10").
> Só homologação, no Predator. **Nada foi à produção.** Este arquivo não tem dado de cliente nem segredo.

## O pedido

Rodrigo, 20/10 às 19h55, olhando o menu novo: "Todas as tarefas" como subseção não faz sentido. Ele quer a subseção Tarefas e, dentro dela, marcar **Todas** para ver todas as tarefas e **todos os possíveis status das pastas**: "a visão tem que ser completa".

## O que mudou

**V1 · o menu** (259359b)
- `trabalho-todas` ficou `oculto: true` e entrou em `ROTAS_ABSORVIDAS` (`/trabalho/todas` vai para `/trabalho?pasta=todas`). Nenhum `NavItem` foi apagado.
- `apps/web/src/app/trabalho/todas/page.tsx` virou redirecionamento no servidor, como `/tarefas` e `/onboarding`. A query é preservada, `pasta` vira `todas` e `lista` sai (`destinoDeTodas` em `apps/web/src/lib/rotas-movidas.ts`). A rota continua viva.
- O Trabalho ficou com Tarefas · Implantação de clientes · Atas. Contagens do menu: **visíveis 47 → 46, ocultos 10 → 11, absorvidas 11 → 12**, fixadas no `nav.test`.

**V2 · o Todas dentro de Tarefas** (259359b, 127963c)
- O quadro de "Todas" saiu das três colunas por tipo (`tipo:open`, `tipo:custom`, `tipo:closed`). Agora mostra **a união dos status reais das listas do recorte**: todas as listas da empresa, ou só as do segmento escolhido.
  - Uma coluna por nome normalizado (sem acento, sem caixa, sem espaço duplo), com id `nome:<nome>`. As vazias também aparecem.
  - Ordem pelo tipo (abertos, em andamento, concluídos) e, dentro do tipo, pela primeira lista em que o status aparece. A cor e o tipo são os do primeiro status com aquele nome.
  - O cabeçalho diz em quantas listas o status existe ("Kickoff marcado · 1 lista").
  - Largura fixa e rolagem lateral, como no resto do quadro.
  - A regra mora em `apps/web/src/components/trabalho/colunas-de-todas.ts`, sem React.
- **Soltar** (e o seletor "Mover etapa" do cartão):
  - Se a lista da tarefa tem um status com aquele nome, a tarefa vai para ele, pelo `PATCH` de sempre com versão.
  - Senão, vai para o primeiro status do mesmo tipo, e a tela avisa: "Movida para <status> (a lista <nome> não tem a etapa <coluna>)".
  - Sem nenhum dos dois, a tela avisa "Nada mudou: …" e nada é gravado.
  - O destino é sempre um status da lista da própria tarefa.
- **"Ocultar concluídas"** continua escondendo as colunas de tipo concluído, com uma exceção vinda da revisão: a coluna fica se ainda tem tarefa aberta. Caso real: o mesmo nome é etapa aberta numa lista e concluída noutra.
- Continuam como estavam:
  - segmentos, Lista, Calendário, filtros e vistas salvas;
  - o lote, que segue pelo tipo da etapa;
  - o chip Todas como primeiro da linha das pastas, com `aria-pressed`.
- Sem migration, sem mudança de API, sem variável, capacidade ou permissão nova.

## As provas

- **Testes de tela.**
  - `trabalho-filtros-e-todas` tem 15 casos. Os novos cobrem: colunas reais com as vazias e "N listas", soma igual ao total e sem cartão repetido, recorte por segmento, soltar no status de mesmo nome, queda por tipo com aviso, "nada mudou" sem PATCH, ocultar concluídas e a exceção da tarefa aberta, e a união por nome normalizado.
  - `trabalho-final-f4` teve o caso do quadro reescrito para as colunas reais.
  - `nav`, `menu`, `navegacao-modulos` e `rotas-movidas` estão com as contagens novas e o redirecionamento (106/106 na lane V1).
- **Web inteiro: 1410 verdes e 78 vermelhos**, todos nos mesmos 9 arquivos da linha de base (agentes, conexões, financeiro, pauta). Nenhum vermelho é do Trabalho. Typecheck do web limpo.
- **Imagem `rootos-final-app:todas2`** nas duas stacks. Foi `up -d --no-build api web`, e o health ficou 200/200.
  - A primeira tentativa de build caiu no `next/font`, que baixa as fontes do Google. Na segunda passou.
  - A `todas1` foi construída antes do conserto da revisão e não subiu.
- **A 3030 tem as mesmas contagens antes e depois:** 202 tarefas, 19 leads, 18 `Partner`, 8 usuários, 19 listas, 5 pastas, 84 status e 99 migrations. A 3031 também não mudou: 61, 44, 11, 5, 9, 8, 35 e 99.
- **`organizar.mjs --simular` na 3030 depois da imagem: zero mudanças.**
  - Nada a criar, mover nem arquivar.
  - 71 tarefas e 4 listas já no lugar, 19 leads já feitos, 4 testes já arquivados, 108 de marketing intocadas, 4 sobras.
  - A saída está em `homolog/organizar/todas-final/`, fora do git.
- **Roteiros e2e:**
  - `interface.mjs` na 3031 **PASSA, 17 passos**.
    - O balão do Trabalho traz Tarefas · Implantação de clientes · Atas, sem "Todas as tarefas". Clicar em Tarefas e marcar o chip Todas funciona.
    - `/trabalho/todas?visao=board` cai em `/trabalho?pasta=todas&visao=board`.
    - O quadro tem **16 colunas reais (12 vazias)**, por exemplo "Qualificação", "Kickoff marcado" e "Imersão", e nenhuma `tipo:`. A soma das colunas é igual ao total (61), nenhum cartão aparece repetido, todas as colunas têm a mesma largura e a rolagem lateral mede 3480 px para 916 px visíveis.
    - Os segmentos continuam somando Todas.
    - A 390 px nada rola de lado.
  - `final.mjs` na cópia (3030): **17/17**.
  - `painel.mjs` na 3031: **PASSA, 13 passos**.
  - `trabalho.mjs` na 3031: **OK, com os avisos de sempre** (T1b sem storage, R3 sem pedido próprio desde o mover livre, nenhuma decisão pendente). T7 com o R4 aprovado com senha no lugar, pela jornada parada no R4.
  - Depois do `trabalho.mjs`, o `interface.mjs` rodou de novo para a foto do quadro a 390 px: **PASSA, 17 passos**, ainda com 16 colunas, agora com 70 tarefas.
- **Capturas** em `homolog/provas/`: `todas-interface-trabalho-todas-colunas-escuro.png` (o chip Todas marcado e as colunas reais com a barra lateral), `todas-interface-todas-390.png` e `todas-interface-todas-quadro-390.png`.
- **Revisão curta (adversarial)**, sobre as três perguntas do roteiro:
  - O Todas não mostra tarefa de outra empresa. A tela só mudou de forma: a consulta `todas=1` e o recorte por empresa da API são os mesmos, e o PATCH confere o status contra a lista e a empresa.
  - Nenhum cartão aparece repetido.
  - Soltar nunca vai para status fora da lista da tarefa.
  - Um achado de corrigir, o cartão aberto que sumia com "Ocultar concluídas", foi consertado em 127963c, com teste.

## Registrado (sem mexer)

- As colunas saem de todas as listas da estrutura. A API exclui do Todas as listas de natureza `cadastro`, mas a estrutura não expõe a natureza da lista, e o roteiro proíbe mudar a API. Uma lista de cadastro pode, então, acrescentar colunas vazias e inflar o "N listas". Soltar numa dessas colunas segue a regra (mesmo nome ou mesmo tipo, com aviso).
- Soltar um cartão sobre outro de outra lista, dentro da mesma coluna, grava a ordem manual da coluna. Isso já acontecia nas colunas por tipo.
- A prop `aoSairDeTodas` do `TrabalhoView` ficou sem uso, porque a página virou redirecionamento. Ficou no lugar para o ajuste ser cirúrgico.
- `trabalho.mjs` e `painel.mjs` apontam por padrão para a stack antiga (3010). Contra a 3031 precisam de `UX_WEB`, `UX_API`, `HOMOLOG_ENV=homolog/.env.final-seed` e, para a jornada do T7, de `JORNADA_API`, `JORNADA_WEB`, `JORNADA_ASAAS` (4032) e `JORNADA_ZAPSIGN` (4033).

## Apagar depois

Herda a lista do `homolog/RESULTADO-INTERFACE.md`. Desta rodada:
- a imagem `rootos-final-app:todas1`, construída antes do conserto e nunca usada;
- `homolog/organizar/todas-final/`, com as fotos do `final.mjs` sobre a cópia e a contagem do organizador. Tem dado real e está fora do git.

Para voltar: `rootos-final-app:interface2` segue no Docker. Troque a tag nos dois `docker-compose.final*.yml` e rode `up -d --no-build api web`.
