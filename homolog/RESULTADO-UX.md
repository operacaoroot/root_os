# RESULTADO da lane UX · o cockpit do lead sem sair da tela

> Rodada 6, de 21:30 às 22:30 de 13/10/2026. Imagem final construída do commit 7159330 (o fechamento só acrescenta este documento e o README). Branch `comercial/cockpit-homolog`, sobre a entrega `comercial-entrega-20261013`. Tag `comercial-ux-20261013`. Bundle em `C:\Users\User\dev\rootos-comercial.bundle` (`main..comercial/cockpit-homolog`).
> Roteiro: `docs/comercial/UX-COCKPIT.md`. Registro linha a linha: `homolog/progresso.md` (linhas "Lane UX"). Só o web mudou, mais um build arg no `Dockerfile` e no compose da homologação. A API, o shared e a política não mudaram: nenhuma rota nova, nenhum contrato alterado.

## 1. O painel do lead

Pedido do Rodrigo: agir num lead abre um painel por cima da tela, em vez de levar a outra subseção.

- **Um componente só**, em `apps/web/src/app/comercial/_painel/`. O provedor mora no layout de `/comercial` (`comercial/layout.tsx`), então fila, funil, contratos, torre, relatório e simulador abrem o mesmo painel.
  - **Desktop:** painel à direita, `min(720px, 90vw)`.
  - **Celular:** folha de baixo para cima, na tela inteira.
- **As abas:**
  - **Fio** (era a tela 05): ficha projetada, próxima ação, portão, o fio do mais recente para o primeiro contato, "ligado a", saída com motivo.
  - **Sessão** (era a 06): ata, diagnóstico com minuto, aprovar, proposta, laudo, segurar, liberar, versões.
  - **Dinheiro** (eram as 08, 10 e 11): aceite e cobrança, parcelas e régua, documento e assinaturas com "Assinar pela Root", as cinco escritas do fechamento e o contrato vivo.
  - **Decisões** (era a 03): as abertas do lead com os botões de um toque e as já fechadas.
  - As abas chamam as mesmas rotas de antes. Nenhuma grava etapa nem contorna portão.
- **Estado na URL:** `?lead=<id>&aba=fio|sessao|dinheiro|decisoes`.
  - Abrir por clique empilha uma entrada no histórico; trocar de aba substitui.
  - Fechar volta quando o painel veio de um clique e, se não veio, só limpa a query. O resto da query (o filtro do funil) fica.
  - O voltar do navegador fecha o painel.
  - Os links são links de verdade: o botão do meio e o Ctrl abrem em outra aba.
  - O histórico é escrito com estado `null`, o que faz o Next 15 sincronizar o `useSearchParams` (conferido em `next/dist/client/components/app-router.js`).
- **As rotas antigas redirecionam, no servidor:**

  | Rota antiga | Destino |
  |---|---|
  | `/comercial/lead/[id]` | `/comercial/funil?lead=<id>&aba=fio` |
  | `/sessao` | `aba=sessao` |
  | `/fechamento` | `aba=dinheiro` |
  | `/comercial/contratos/[leadId]` | `/comercial/contratos?lead=<id>&aba=dinheiro` |

- **Acessibilidade:**
  - O painel é `role="dialog"` com `aria-modal` e `aria-labelledby` apontando para o nome do lead, que é o único `h2` do painel; as seções descem para `h3`.
  - As abas são `tablist`/`tab`/`tabpanel`, com setas, Home e End.
  - O foco entra no título, fica preso dentro e volta a quem abriu.
  - A página de trás fica `inert` e sem rolagem, sem salto de layout (a largura da barra de rolagem é compensada).
  - `Esc`, o clique no fundo, o botão fechar, o voltar do navegador e a troca de aba perguntam antes de perder texto digitado e não salvo. Sem texto pendente, não perguntam.
  - O corpo da aba rola pelo teclado.
  - Depois de uma ação que some com o botão focado, o foco vai ao título do painel.
- **Ação e retorno dentro do painel:**
  - O resultado aparece no lugar: o chip muda e o fio ganha a linha.
  - Um aviso curto no canto traz o texto da API (o efeito da opção, por exemplo). Com o painel aberto, os avisos moram dentro do diálogo e não seguram o toque.
  - Erro de ação mostra a frase e o código da API ao lado do botão. O botão em andamento fica desligado com "…".
- **Recarregar só o que mudou:**
  - Depois da ação, o painel relê o lead (uma chamada) e as decisões.
  - A tela de trás relê a lista sem piscar.
  - `useCarregar` passou a deixar só o pedido mais recente escrever, para o tique periódico não pôr estado velho de volta.

## 2. O que mudou tela a tela

| Tela | O que mudou |
|---|---|
| 03 fila (`/comercial`) | O cartão é o `CartaoDeDecisao` comum (`comercial/_decisao.tsx`). "<lead> · ver o lead" abre o painel na aba Decisões. Decidir tira o cartão com uma transição curta e um aviso com o efeito. O vazio diz quantas ações rodaram sozinhas hoje. "Rodou sozinho hoje" abre o lead no painel. Erro com "tentar de novo". |
| 04 funil | Clicar no cartão abre a aba Fio. As setas andam entre cartões (cima e baixo na coluna, para os lados entre colunas) e Enter abre. O arraste continua bloqueado, com o portão. Filtros e "mover" com 44 px no celular. O texto do topo explica como abrir. |
| 11a contratos | A linha abre a aba Dinheiro. |
| 12 torre | Os leads das premissas quebradas abrem no painel. Datas como "ter 13/10 · 20h12". Erro com "tentar de novo". |
| 13 relatório | "Propostas vencendo" abre a aba Sessão. O topo diz em uma linha o que a tela é. "Gerar agora" no imperativo. Datas curtas. |
| simulador | No celular da mesa, "abrir no cockpit" leva à fila com o painel aberto na aba Decisões. `?conversa=<id>` abre a conversa (é o destino do botão WhatsApp do painel). A etapa aparece pelo rótulo da casa. Botões "Liberar envio", "Abrir na fila", "Vetar". |
| todas | Datas como "qui 15/10 · 10h" (`quandoCurtoSP`). Prazos em palavras (`prazoEmPalavras`: "em 4 h", "vence hoje 18h"; a sentinela 9999 vira "sem prazo"). `tabular-nums` nos números. Esqueleto de carregamento do tamanho do conteúdo. Erro com frase, código e "tentar de novo". O nível da régua vindo da API ganha o que ele pede ("R3: pede uma segunda pessoa", "R4: pede a titular, com senha"). A chave de sistema no fio vira o nome da casa ("Proposta → Follow-up", "pedido de ajuste", "kit e trilho"). Botões com 44 px no celular. |
| tema claro | O `--os-tx3` (legenda) dava 4,47:1 sobre o fundo e passou a cerca de 5,1:1. Vale para o OS inteiro no tema claro; o escuro já dava 4,67:1 e não mudou. |
| topbar | O título é o da tela de fundo (o pathname não muda mais para as subpáginas). O painel leva o nome do lead no próprio cabeçalho. |
| raiz `/` | Com `NEXT_PUBLIC_RAIZ=login` (build arg no `Dockerfile` e no compose da homologação), `/` abre o `/login`. Em produção o arg fica vazio e a raiz continua no site. |

## 3. Provas

| Prova | Resultado |
|---|---|
| `pnpm --filter @mktos/web typecheck` | limpo |
| Suíte do web | 67 arquivos, 884/884 (antes dos últimos ajustes de layout; as três suítes do comercial, 41/41, depois deles) |
| `tests/component/comercial-painel.test.tsx` | 17 casos: abre pela URL; abrir empilha uma entrada e trocar de aba substitui; Esc fecha e o foco volta; o fundo fecha (com confirmação só com texto); o foco fica preso; decidir no painel relê o lead uma vez e o fio ganha a linha sem navegar; o voltar fecha; troca de aba e voltar com texto perguntam; só um `h2`; `useCarregar` na ordem; funil pelo teclado; as quatro rotas antigas |
| `tests/unit/comercial-painel-estado.test.ts` | 8 casos (query, rotas antigas, WhatsApp, datas, prazos, nível da régua, chaves) |
| `homolog/e2e/ux-painel.mjs` contra o Docker | PASSA na imagem final, 13 passos em 22,1 s (ver abaixo). Prova em `homolog/provas/ux-painel.json` |
| Screenshots | `homolog/provas/ux-*.png`: fila com o painel (Decisões), funil com o painel (Fio), Sessão, Dinheiro da Alicerce, contratos com o painel (Dinheiro de um lead fechado), celular com a folha, cada um em escuro e claro |
| `homolog/e2e/jornada-docker.mjs` | PASSA na imagem final: 13 toques humanos, 19,3 s, funil 10 → 11 (na imagem anterior, 30,4 s, 29 de 53 automáticos) |
| Revisão adversarial do painel | Um subagente, só leitura, com 18 achados (1 P1, 7 P2, 10 P3). Todos consertados, exceto: o P3-16 foi consertado no tema e não no componente; o P2-7 e o P2-6 ficaram com o texto honesto em vez de rota nova (seção 4) |

Os 13 passos do `ux-painel.mjs`:

1. A mesa entra pela API.
2. A Alicerce pede 8% pela sala e a decisão abre na fila.
3. Na fila, "ver o lead" abre o painel na aba Decisões. A URL só muda na query e um marcador no `window` prova que a página não recarregou.
4. "Manter o preço" dentro do painel mostra o aviso no canto.
5. O cartão sai da fila de trás.
6. O fio ganha a linha da decisão.
7. Esc fecha, a URL volta e o foco volta.
8. No funil, as setas chegam à Alicerce e Enter abre o painel na aba Fio.
9. A lista de contratos abre a aba Dinheiro.
10. A rota antiga do lead cai no funil com o painel aberto.
11. A rota antiga `/sessao` abre a aba Sessão.
12. `/` abre o `/login`.
13. No celular (390 px), a folha ocupa 390×844, não há rolagem horizontal e "fechar" tem 44 px.

## 4. [a decidir] e pendências com estado exato

- **Link da sala fora do provedor simulado:** hoje só a rota do simulador reescreve o link. Com outro provedor, o cabeçalho diz "sala aberta, link indisponível" em vez de inventar ou dizer "ausente". Expor o link a quem tem `leads.ver` por uma rota própria é decisão, porque o token é a chave da sala. [a decidir]
- **Decisões por lead:** a API não filtra por lead e para em 200 por empresa. O painel pede as abertas com `?estado=aberta` e, quando a lista geral bate em 200, avisa que as fechadas podem estar incompletas. Um `?leadId=` na API resolveria. Não entrou porque a lane só muda o web, salvo prova de necessidade, e o aviso cobre o caso.
- **Sala do cliente (`/s/[token]`) fora da passada:** é a tela do cliente, da lane B. A passada do §4 cobriu as telas do cockpit.
- **Dois funis no menu (C-21):** continua decisão de produto; o NAV não mudou.
- **Dependência:** o web já tinha `@radix-ui/react-dialog` no `package.json`. O painel não a usa: é componente próprio, como o roteiro pede.
- **A decisão da 1ª execução do roteiro** (a que parou no `h2` repetido antes de decidir) não ficou aberta: o fio da Alicerce a mostra tomada às 22h09 por "Admin Root (simulado)", o canal do simulador da mesa. Esta lane não registrou quem a respondeu. A fila terminou vazia.
- **O roteiro escreve na Alicerce:** cada execução do `ux-painel.mjs` registra na Alicerce da semente um pedido de ajuste e a decisão "manter". Isso entra no fio dela, como a jornada faz com os leads que cria.
- Os pontos de antes da lane (baseline vermelho no Windows, chaves e contas do Rodrigo, números da régua) seguem como estão em `homolog/RESULTADO.md` §7 e §8.

## 5. Como testar em 5 minutos

1. Abra `http://100.95.41.124:3010/` (Tailscale) ou `http://127.0.0.1:3010/`. A raiz abre o login. Entre como `mesa@root.homolog` com a `ADMIN_PASSWORD` de `homolog/.env.homolog`.
2. Em `/comercial`, clique em "<lead> · ver o lead" num cartão: o painel abre por cima da fila na aba Decisões. Responda com um toque. O aviso aparece no canto e o cartão sai da fila de trás. Na aba Fio, a linha nova aparece no topo.
3. Feche com `Esc`: a fila está como estava.
4. Em `/comercial/funil`, ligue um filtro, clique num cartão e troque de aba. Repare que a URL só ganha `?lead=&aba=` e que, ao fechar, o filtro continua lá. Pelo teclado: Tab até um cartão, setas, Enter.
5. Cole na barra um link antigo, `/comercial/lead/<id>`: ele cai no funil com o painel aberto.
6. No celular (ou com a janela em 390 px), abra um cartão: a folha sobe na tela inteira, as abas rolam na horizontal e "fechar" fica no alto.
7. Para a prova automática: `node homolog/e2e/ux-painel.mjs` (cerca de 20 s, com o Playwright de `C:\Users\User\dev\pw-tools`).
