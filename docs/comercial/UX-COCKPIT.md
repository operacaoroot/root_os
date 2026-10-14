# Lane UX · o cockpit do lead sem sair da tela

> Pedido do Rodrigo em 13/10/2026, no primeiro teste da homologação: "nas tarefas dos leads eu quero que abra uma espécie de popup em vez de me levar para outra subseção; isso dificulta muito a interação". E: "quero UI e UX nesse módulo".
> Esta lane entra depois da entrega `comercial-entrega-20261013` e muda só o **web** (`apps/web`), salvo o que a própria tela provar que precisa da API.

## 0. Regras que continuam valendo

- As regras duras do `PASSAGEM-PREDATOR-COMERCIAL.md` §0 (branch, identidade, Docker próprio, régua, nunca inventar dado, nunca pular teste, texto no padrão da casa).
- **Dependência nova é decisão humana** (CLAUDE.md): o painel é feito com o que o web já tem (React, Next App Router, Tailwind, o `<dialog>` nativo ou componente próprio). Nada de biblioteca de modal.
- Nenhuma tela grava etapa à mão nem contorna portão. O painel só chama as rotas que as telas já chamam.
- O que a tela mostra continua vindo do fio; o que não existe aparece como "ausente", nunca inventado.

## 1. O princípio: a pessoa não sai de onde está

Hoje, agir num lead manda a pessoa para `/comercial/lead/[id]`, `/comercial/lead/[id]/sessao`, `/comercial/lead/[id]/fechamento` e `/comercial/contratos/[leadId]`: quatro subpáginas, cada uma uma viagem de ida e volta. A regra nova:

**Toda ação sobre um lead abre um painel sobreposto à tela em que a pessoa está** (fila, funil, contratos, relatório). No desktop, um painel lateral à direita, largo (cerca de 720 px, nunca mais de 90% da largura); no celular, uma folha que sobe de baixo e ocupa a tela inteira. A tela de trás continua visível e volta ao foco quando o painel fecha, **sem recarregar e sem perder filtro, rolagem ou seleção**.

## 2. O painel do lead (`LeadPainel`)

Um componente só, em `apps/web/src/app/comercial/_painel/`, com abas que correspondem às telas de hoje:

| Aba | O que mostra | Vem de |
|---|---|---|
| **Fio** | a ficha como projeção dos eventos, próximas ações automáticas, portão para a próxima etapa, "ligado a" | tela 05 (`lead/[id]/page.tsx`) |
| **Sessão** | ata, diagnóstico com minuto, proposta (versões, laudo do revisor, segurar/liberar), dúvidas do cliente | tela 06 (`lead/[id]/sessao/page.tsx`) |
| **Dinheiro** | aceite, cobrança e parcelas, documento e assinaturas (inclusive assinar pela Root, só para quem a API deixar), fechamento com as cinco escritas, contrato vivo | telas 08/10/11 (`lead/[id]/fechamento`, `contratos/[leadId]`) |
| **Decisões** | as decisões abertas deste lead com os botões de um toque (as mesmas da fila) | tela 03 |

Regras do painel:
- **Estado na URL**: `?lead=<id>&aba=fio|sessao|dinheiro|decisoes`. Abrir, trocar de aba e fechar atualizam a URL (`router.replace`, sem empilhar histórico a cada aba; fechar faz `history.back()` se o painel veio de um clique, senão limpa a query). Um link com `?lead=` abre a tela com o painel já aberto: é assim que a fila, o WhatsApp da mesa e o relatório apontam para um lead.
- **As rotas antigas continuam existindo** para quem tem o link: `/comercial/lead/[id]` redireciona para `/comercial/funil?lead=<id>&aba=fio`; `/sessao` para `aba=sessao`; `/fechamento` e `/comercial/contratos/[leadId]` para `aba=dinheiro`. Nada de 404.
- **Acessibilidade de verdade**: `role="dialog"`, `aria-modal`, `aria-labelledby` com o nome do lead, foco entra no painel ao abrir e volta ao elemento que o abriu ao fechar, foco preso dentro enquanto aberto, `Esc` fecha, clique no fundo fecha (com confirmação só se houver texto digitado e não salvo). Sem salto de layout na página de trás (a rolagem do fundo trava enquanto o painel está aberto).
- **Cabeçalho fixo** com nome da empresa, pessoa, etapa (chip), saúde, dono, e os botões "abrir sala" e "WhatsApp" (os mesmos da tela 05). Abas logo abaixo. Corpo rola sozinho.
- **Ação dentro do painel, retorno dentro do painel**: aprovar diagnóstico, segurar/liberar proposta, decidir, propor cobrança, assinar pela Root etc. mostram o resultado no mesmo lugar (chip muda, linha nova no fio) e um aviso curto no canto (toast) com o texto da API. Erro mostra a frase e o código da API ao lado do botão, sem caixa vermelha genérica. Botão em andamento fica desabilitado com "…".
- **Recarregar só o que mudou**: depois de uma ação, o painel relê o lead (uma chamada), e a tela de trás relê a lista (fila/funil) sem piscar: mantém o que já tem na tela até a resposta chegar.
- **Celular**: folha de baixo para cima, altura total, cabeçalho com "fechar"; abas roláveis na horizontal; botões com 44 px de altura mínima.

## 3. As telas que abrem o painel

- **Fila (03, `/comercial`)**: o cartão da decisão tem os botões de um toque como hoje; o nome do lead e "ver o lead" abrem o painel na aba Decisões. Depois de decidir, o cartão sai da fila com uma transição curta e o aviso diz o que aconteceu.
- **Funil (04, `/comercial/funil`)**: clicar no cartão abre o painel na aba Fio. Setas do teclado andam entre cartões da coluna; `Enter` abre. O arraste continua bloqueado (quem move é o evento), e a tela diz isso quando alguém tenta.
- **Contratos (11a, `/comercial/contratos`)**: a linha abre o painel na aba Dinheiro.
- **Relatório (13)** e **Torre (12)**: onde houver nome de lead, abre o painel.
- **Simulador**: o celular da mesa, ao mostrar uma decisão, tem "abrir no cockpit" que leva à fila com o painel aberto.

## 4. Passada de UX nas telas (além do painel)

Com o painel pronto, uma passada em cada tela com este crivo, corrigindo o que falhar:
1. **Primeiro olhar**: a tela diz em uma linha o que ela é e o que pede da pessoa. Vazio tem texto de vazio ("nenhuma decisão sua agora; 31 ações rodaram sozinhas hoje"), nunca tabela em branco.
2. **Números**: `tabular-nums`, moeda em R$ com separador de milhar, datas como "qui 16/10 · 10h" (fuso de São Paulo, nunca ISO cru), prazos como "em 4 h" ou "vence hoje 18h", nunca sentinela ("2,9 milhões de dias" é defeito).
3. **Estados**: carregando (esqueleto do mesmo tamanho), erro (frase + código, botão tentar de novo), parcial ("ausente" quando o dado não existe).
4. **Hierarquia**: uma ação principal por cartão; secundárias discretas; o padrão da decisão destacado e nomeado como padrão.
5. **Copy**: português curto, verbo de comando no botão ("Aprovar 5%", "Segurar"), sem jargão de sistema (nada de "approval", "payload", "R3" sem explicação: "pede uma segunda pessoa" ao lado do nível).
6. **Tema**: escuro e claro com o mesmo cuidado; contraste legível; nada definido só num tema.
7. **Celular (390 px)**: sem rolagem horizontal da página; tabelas largas em container próprio; menus e abas alcançáveis com o polegar.
8. **Topbar**: o título das telas do lead (hoje "Decisões do comercial" por causa do href do NAV) passa a ser o da tela de fundo, e o painel leva o nome do lead no próprio cabeçalho.
9. **Raiz da homologação**: `/` abre `/login` quando o build tiver `NEXT_PUBLIC_RAIZ=login` (homologação); em produção continua mandando para o site. Variável no `Dockerfile` (ARG + ENV) e no compose da homologação.

## 5. Provas (sem elas a lane não fecha)

1. `pnpm --filter @mktos/web typecheck` e `test` verdes; testes de componente do painel: abre pela URL, troca de aba atualiza a URL, `Esc` e fundo fecham, foco volta, ação dentro do painel atualiza o fio sem navegar, rotas antigas redirecionam.
2. **Playwright contra o Docker da homologação** (`homolog/e2e/ux-painel.mjs`): da fila, abrir a Alicerce, decidir "manter o preço" no painel, ver o cartão sair e o fio ganhar a linha, tudo sem mudar de página (a URL muda só na query); do funil, abrir pelo teclado; no celular (390 px), abrir e fechar a folha. Prova em `homolog/provas/ux-painel.json`.
3. Screenshots novos em `homolog/provas/ux-*.png`: fila com painel aberto (Decisões), funil com painel (Fio), painel na aba Sessão e Dinheiro, celular com a folha, nos dois temas.
4. `homolog/e2e/jornada-docker.mjs` continua verde depois da mudança (nada da API mudou de contrato).
5. Imagem reconstruída, homologação de pé, `homolog/RESULTADO-UX.md` com o que mudou tela a tela, o que ficou `[a decidir]` e como testar em 5 minutos.
6. Commit a cada marco; tag `comercial-ux-20261013` no fim; bundle de volta.
