# RESULTADO da rodada do painel · a ata de 18/10 vira sistema

> Rodada 1, de 17:06 de 18/10/2026 até o fechamento. Branch `comercial/cockpit-homolog`, sobre a entrega `comercial-ux-20261013`. Tag `painel-entrega-20261018`. Bundle em `C:\Users\User\dev\rootos-comercial.bundle` (`main..comercial/cockpit-homolog`).
> Roteiro: `docs/comercial/RODADA-PAINEL-20261018.md`. Registro linha a linha: `homolog/progresso.md` (linhas "Rodada do painel"). Laudo da revisão adversarial: `homolog/revisao/painel-20261018.md`.
> Só homologação. Nada foi à produção; o merge na `main` é rito da quinta com o Pedro.

## 1. O que entrou, lane por lane

| Lane | O pedido do Rodrigo | O que entrou |
|---|---|---|
| P0 menu | Contexto desce; cortar Temas do ClickUp, Banco de ideias, Estratégia; tirar Leads e Funil antigos | Ordem nova das seções (dia, trabalho, marketing, comercial, financeiro, IA, contexto, resultados, apoio). Os cinco itens saem do menu como `oculto: true`, com entrada em `ROTAS_ABSORVIDAS` (telas vivas, rota com dono, módulo preservado). Nenhuma chave de seção mudou. |
| P1 caixa de entrada | Inbox "como a do ClickUp" no Dia a dia, limpar atividade, quadro das minhas tarefas | `/caixa` com duas abas. **Atividade**: o que outras pessoas mudaram nas suas tarefas (status, responsável, vencimento, título, comentário), com Limpar e Limpar tudo; o limpo fica no histórico. **Minhas tarefas**: tabela com filtros (lista ou pasta, status, vencimento, responsável), colunas ocultáveis guardadas no navegador e comentários num clique, sem sair da tela. A atividade é LIDA do registro que já existia (`AuditLog` com antes e depois, `WorkComment`); a única escrita nova é a marca de "limpo" de cada pessoa (`CaixaVisto`, RLS FORCE). |
| P2 Trabalho | Pastas como no ClickUp; quadro e lista viram uma coisa só; implantação dentro do Trabalho | As pastas reusam `WorkFolder` (já existia; tabela nova seria segunda verdade). Estrutura sugerida idempotente (`POST /trabalho/estrutura/sugerida`): Administrativa, Gestão, Clientes, e dentro de Clientes as listas Esteira de clientes, Onboarding de cliente (modelo novo com as cinco fases do trilho) e Execução; aplicada na homologação. Chips de pasta no topo da tela, Quadro · Lista sobre a mesma fonte, mover lista de pasta. `/tarefas` saiu do menu e redireciona para a visão de lista. O item virou "Tarefas", com Implantação de clientes e Atas pendurados. O cartão do cliente linka o trilho só quando o vínculo existe no banco (`OnboardingTrilho.cardId`). |
| P3 banco de atas | Atas visíveis no Trabalho, gerando sugestões de tarefa | `/trabalho/atas`: atas do vault (pasta `80-Reunioes`, configurável) e atas coladas, gravadas pela memória (ADR-011). "Sugerir tarefas" pede ao modelo, sob o teto e com `orgId`, com a ata cercada no prompt; o servidor confere cada trecho INTEIRO contra a ata, aceita vencimento só com a data no trecho e dono só quando a ata o cita. Rascunho até alguém aceitar; aceitar cria uma tarefa só, pelo caminho do botão "Nova tarefa", com dono e vencimento editáveis antes. Tabela `AtaSugestao` (RLS FORCE). Na homologação a vault não está indexada: o caminho demonstrável é colar a ata. |
| P4 aprovações | "Uma confusão": enxergar o que cada um tem de clicar | `/atendimento` em três grupos (Depende de você · Aguardando outra pessoa · Decididas e vencidas), um pedido por linha em português ("Mover Construtora Alicerce para Reunião agendada", "Enviar WhatsApp para Marina Duarte"), nível em palavras, há quanto tempo e quando vence, contadores, filtro por tipo e estados vazios que explicam. O botão da linha só ABRE; quem executa fica dentro, ao lado do conteúdo exato e do que a assinatura pede. Nenhuma regra mudou. |
| P5 funil vivo | Mover o cartão, com balão de pendência; rolagem por coluna; barra de status; dica nas etiquetas | Arrasto HTML5 e menu "Mover para". **Mover tem a mesma proteção que a mudança manual de etapa já tinha** (`PATCH /leads/:id`: escrita sensível, token de uso único, segunda pessoa): quem arrasta pede, outra pessoa assina em `/atendimento`, quem pediu conclui no cartão. Com portão em aberto a etapa muda e o cartão ganha o balão "movido com pendências" com a lista exata, que some quando a pendência é sanada. E8 e E9 não aceitam arrasto (acontecem sozinhas, com o porquê no menu); voltar é recusado; saída leva ao registro com motivo. Agente e conta de máquina seguem barrados. Colunas com rolagem própria, chips com contagem que levam à coluna, explicação de cada etiqueta (texto no shared). |
| P6 WhatsApp | Layout do FinOps; texto fugindo dos quadros; mobile e desktop | O simulador virou tela de atendimento: lista de conversas, conversa e contexto do lead (três colunas a partir de 1280 px, duas no meio, uma por vez no celular, com voltar). Varredura com textos longos em 9 telas e 3 larguras: 329 elementos vazando e 18 telas com rolagem horizontal antes, zero depois. O código do FinOps5.0 não está nesta máquina: a referência foi `docs/finops-ref/`. O motor não mudou. |
| P7 provas | Roteiro novo, fotos, resultado | `homolog/e2e/painel.mjs` (seção 3) e as fotos `homolog/provas/painel-*.png`. |

## 2. O que as provas acharam e a rodada consertou

A integração e a revisão adversarial acharam defeitos que as lanes não viam sozinhas. Todos consertados:

- **Pedido novo sumia de `/atendimento`.** A fila lia as 100 aprovações vivas mais ANTIGAS; com mais de 100 pendentes vencidas (ninguém chama `expirarVencidas`), todo pedido novo ficava fora da tela. A leitura passou a pôr primeiro o que ainda vale. Só leitura: total, corte e estado não mudam.
- **O pedido de mover aparecia como "agente".** A superfície antiga de aprovação gravava todo proponente como IA. Ganhou o tipo do proponente como parâmetro opcional (padrão IA, a rota pública não o aceita do corpo); o mover passa "pessoa".
- **PA-1 (P1 da revisão): quem assinava o mover lia o texto livre de quem pediu, e o hash travava só o destino.** Com `POST /approvals` dava para assinar "E3" e mover para E7. Agora a fila recalcula o destino real pelo hash e o mostra ("Destino conferido"); texto que diverge vira impedimento e o servidor recusa a confirmação; `POST /approvals` não cria mais pedido de mover.
- **PA-2 e PA-3: o banco de atas alargava acesso.** Ler ata do vault passou a exigir `obsidian.ver`; colar exige `obsidian.editar`, a mesma permissão de escrever na memória; conta de máquina não cola, não gera e não aceita.
- **PA-4 e PA-5: dado inventado e segredo.** Vencimento só com a data no trecho, dono só citado na ata, trecho só inteiro; a ata do vault passa pela mesma varredura de segredos da colada.
- **PA-6: ata longa caía em 413.** O corpo grande vale só no `POST /trabalho/atas`, só com sessão válida.
- **PA-7 e PA-8: o ciclo do mover era frágil e a confirmada vencida ocupava a fila.** O cartão relê o pedido e acende "concluir a mudança" quando a assinatura chega, diz que o pedido vive só nesta aba e até que hora vale; a confirmada vencida vai para "vencidas". O prazo de 10 minutos não mudou.
- E os P3 de acessibilidade e texto (foco que volta, 44 px no celular, Esc, travessão e "não é X, é Y" fora do texto de tela). O que ficou de fora está na seção 5.

## 3. Provas

| Prova | Resultado |
|---|---|
| `homolog/e2e/painel.mjs` contra o Docker | PASSA na imagem final: 16 passos em 36,7 s, 25 fotos. Prova em `homolog/provas/painel.json` |
| `homolog/e2e/ux-painel.mjs` | PASSA: 13 passos em 19,1 s (a conferência do botão de 44 px passou a arredondar ao décimo: a altura saía 43,999996 px por subpixel) |
| `homolog/e2e/jornada-docker.mjs` | PASSA: 13 toques humanos, 99,3 s, funil 12 → 13 |
| Suíte do web | 75 arquivos, 998/998 |
| Suíte da API inteira | 4271 verdes, 71 vermelhos, 5 pulados. Os 71 são todos de antes da rodada: o baseline do Windows (permissão 0600 e symlink, `homolog/.tmp/baseline-falhas-api.txt`) e `pauta-episodio` MD2, vermelho desde 13/10 pelo alinhamento do `schema.prisma` |
| Política | 101/101 |
| Isolamento (`rootos_comercial_test_rls`, papel restrito) | 416/416 (CaixaVisto e AtaSugestao no inventário) |
| Typecheck da API, dos testes da API e do web | limpo |
| Smoke da API compilada | OK (rotas da caixa registradas) |
| Fotos | `homolog/provas/painel-*.png`: caixa (atividade e tarefas), Trabalho (pastas e lista), atas, aprovações, funil e WhatsApp, cada uma em escuro, claro e 390 px; nenhuma rola na horizontal no celular |

Os passos do `painel.mjs`:

1. Mesa, sócio e admin entram pela API.
2. Preparação: o admin cria uma tarefa da mesa e comenta nela; uma lista solta; um lead novo pelo simulador.
3. Na caixa da mesa, Atividade mostra o comentário do admin.
4. "Limpar" tira o item da caixa e ele continua no histórico.
5. Minhas tarefas mostra a tarefa e os comentários abrem no lugar.
6. Uma pasta nova pela tela.
7. A lista vai para a pasta pelo seletor e o chip da pasta a mostra.
8. Quadro e Lista alternam sobre a mesma lista.
9. A ata colada pela tela entra no banco de atas, pela memória.
10. "Sugerir tarefas" traz rascunhos conferidos contra a ata.
11. Aceitar com um clique cria a tarefa no Trabalho.
12. O admin pede para mover o lead novo de E1 para E3 pelo menu do cartão.
13. A mesa encontra o pedido em "Depende de você", em português.
14. A mesa confirma pela tela nova, com as condições à vista antes do clique.
15. O admin conclui no cartão: o lead está em E3 com o balão de pendências.
16. Fotos de cada tela mexida, escuro, claro e 390 px.

## 4. Decisões que a rodada expôs (para a mesa)

- **Mover pela tela pede duas pessoas.** É a régua que já protegia a mudança manual de etapa; numa empresa com uma pessoa só, mover pela tela fica impossível, como já era o `PATCH /leads/:id`. Trocar isso é decisão da régua, não da tela. [a decidir]
- **Registrar saída é mais fraco que mover.** `POST /comercial/lead/:id/saida` muda etapa e `Lead.status` só com `leads.editar`, sem aprovação. Não mexi. [a decidir]
- **A régua do funil para agente** continua a de antes (barrado pelos portões): o aviso no lugar da trava é só para gente, como o roteiro manda.
- **Quem cola ata precisa de `obsidian.editar`.** A mesa da homologação (`gestor_marketing`) não tem; no roteiro, quem cola é o admin. Se a operação quiser que quem tem `tarefas.editar` cole ata, é permissão nova no papel. [a decidir]
- **O sócio da homologação não tem `leads.editar` nem `tarefas.editar`.** Por isso o roteiro pede o mover como admin. [a decidir] se o perfil titular deve ter essas.
- **`expirarVencidas` continua sem chamador.** A fila agora desenha certo, mas o banco segue com pendentes vencidas para sempre. Ligar um agendador é decisão (ela muda estado). [a decidir]
- **Apagar de vez as telas cortadas, a tabela `Task` e unificar `Task` com `WorkTask`** continuam com o Pedro (ROOT-10).
- **WhatsApp de produção** (Evolution, Cloud API ou Digisac) e o número: a rodada trabalhou no simulado.

## 5. Ficou de fora, com o estado exato

- **Vault na homologação:** nenhuma nota indexada; a fonte (a) do banco de atas está pronta e testada, mas a demonstração é pela colagem.
- **Caixa:** o selo do menu ainda conta aprovações e tarefas paradas, não a atividade nova; a atividade lê até as 1.000 tarefas suas mudadas por último (a resposta avisa quando bate no teto); mudanças de campo personalizado, descrição e checkout de agente não aparecem; `POST /caixa/limpar` não confere se o evento existe (só incha a tabela do próprio usuário).
- **Atas:** aceitar cria a tarefa fora da transação da sugestão (uma queda no meio deixa "aceita" sem tarefa); ata por link ou PDF ainda não (só texto e .md/.txt).
- **Funil:** o balão aparece no funil; o painel do lead recebe o dado e ainda não o mostra. O RASTRO do CONSUMO do token do mover ainda diz `ai`; o hash do mover não prende a etapa de origem (o portão confere a de agora).
- **WhatsApp:** a lista da API não traz a última mensagem nem não lidas; a prévia aparece só nas conversas abertas na visita.
- **`motivoDoBloqueio`** (`apps/web/src/lib/cockpit.ts`) virou código morto; não apaguei (regra da casa).
- **Bundle:** o lançador pedia refazê-lo nos primeiros 10 minutos; foi refeito depois das lanes (registrado), e de novo no fechamento.
- **Docker Desktop sem AutoStart** continua [a decidir] (RESULTADO-UX §4).

## 6. Como testar em 5 minutos

1. `http://100.95.41.124:3010/` (Tailscale) ou `http://127.0.0.1:3010/`; entre como `mesa@root.homolog` (ou `admin@marketing-os.local`) com a `ADMIN_PASSWORD` de `homolog/.env.homolog`.
2. O menu: Dia a dia, Trabalho (Tarefas, com Implantação e Atas dentro), Marketing, Comercial (sem Leads e Funil antigos), Financeiro, IA, Contexto, Resultados.
3. **Pendências** (`/caixa`): Atividade e Minhas tarefas; limpe um item, ligue "ver também os já limpos".
4. **Tarefas** (`/trabalho`): os chips de pasta no topo, Quadro · Lista, mova uma lista de pasta.
5. **Atas** (`/trabalho/atas`), como admin: "Colar ata" com o texto de `homolog/fixtures/ata-trabalho-exemplo.md`, "Sugerir tarefas", aceite uma.
6. **Funil** (`/comercial/funil`), como admin: "mover" num lead de E1 para E3; como mesa, em **Aprovações**, abra o pedido ("Destino conferido") e confirme; de volta ao cartão, "concluir a mudança": o balão aparece.
7. **WhatsApp** (`/comercial/simulador`), também com a janela em 390 px.
8. Prova automática: `node homolog/e2e/painel.mjs` (cerca de 40 s, Playwright de `C:\Users\User\dev\pw-tools`).
