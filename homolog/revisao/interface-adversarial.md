# Revisão adversarial curta · Rodada da interface (20/10/2026)

Diff revisado: `git diff final-ajustes-20261020..HEAD -- apps packages docker-compose.yml .env.example` (branch `homolog/final-20261019`, HEAD `722b88a`).
Método: leitura do diff e do código em volta. Rodei `balao-da-area` e `botao-de-filtros` (web): 18/18 verdes. Não rodei a suíte da API com banco.

**Veredito: fecha com ressalvas.** Nada bloqueia. Dois itens para corrigir antes de abrir o DigiSac a empresa cliente ou de usar "negócio fechado à mão" com lead que tem sala ativa (achados 1 e 2).

## Corrigir

1. **SSRF pelo endereço do DigiSac (corrigir, prioridade alta).** `baseDoDigisac` aceita `http://` para qualquer host sem ponto (`apps/api/src/gateway/canais/digisac.conector.ts`, `const local = ... || !u.hostname.includes('.')`) e `https://` para qualquer host, inclusive IP privado. Um admin (`admin.usuarios`) de empresa cliente salva `http://minio:9000` ou `https://10.x.x.x` em `PUT /integrations/digisac/credencial`. Depois, `GET /integrations/digisac/servicos` e a sonda de saúde fazem a requisição de dentro da rede dos containers e devolvem até 200 caracteres do corpo (`DigisacRespondeuErro` → `BadGatewayException` e a mensagem de saúde). O teste fixa esse comportamento: `comercial-canal-digisac.test.ts:126` (`http://digisac-mock:4013`).
   Conserto: liberar http só em loopback, ou sem ponto só com uma variável de homologação explícita, e recusar IP literal ou privado (ou exigir `*.digisac.me` com exceção por variável), como já faz o `urlSeguraDoFornecedor`.

2. **"Negócio fechado à mão" abre o Começo na sala do cliente (corrigir).** `estagioDaSala` usa `e.ficha?.etapa === 'fechado'` (`apps/api/src/comercial/sala-projecao.ts:169`). Antes da U4, o mover não chegava em E9. Agora um mover à mão passa a sala para `comeco`: o cliente vê o começo e pode marcar o kickoff (`sala.service.ts:463`), e isso grava `kickoff.marcado`, que reage em `fechamento.m8` e `espinha.projetar`. Nenhuma das escritas proibidas nasce disso, mas é efeito visível ao cliente a partir de um gesto que a tela descreve como "só a etapa mudou".
   Conserto: a sala vai a `comeco` só com `clienteAtivoEm` ou com o fato `cliente.ativo`, nunca pela etapa. Vale a mesma revisão para `seloDoCard` (`card-da-implantacao.ts:119`), que diz "fechado no comercial" só pela etapa.

3. **Balão: o Esc no próprio ícone deixa uma marca presa (corrigir, baixo).** Em `fecharBalao(true)`, `focoDevolvido.current = true` e depois `icone.focus()` (`Sidebar.tsx`). Se o foco já está no ícone (Esc no ícone), não dispara evento de foco, então a marca fica ligada e o próximo ícone que receber foco não abre o balão. O teste `balao-da-area.test.tsx:151` não cobre o Tab seguinte.
   Conserto: só ligar a marca quando `document.activeElement !== icone`, ou zerá-la num `requestAnimationFrame`.

4. **Balão aberto por hover não fecha com Esc se o foco está fora dele (corrigir, baixo).** O Esc só é tratado no `onKeyDown` do ícone e do balão (`BalaoDaArea.tsx`, `aoTeclar`). Com o mouse parado sobre o ícone e o foco no conteúdo principal, o balão fica aberto até o mouse sair. Isso fere o "dispensável sem mover o ponteiro" (WCAG 1.4.13).
   Conserto: com o balão aberto, ouvir `keydown` Escape no `document`.

5. **Filtros: o foco cai no body depois de limpar (corrigir, baixo).** O "limpar" de um filtro some ao ser clicado (`ativo` passa a falso), e o "Limpar tudo" fica `disabled` (`BotaoDeFiltros.tsx`). Nos dois casos o elemento focado sai e o foco vai para o body, com o painel `aria-modal` aberto. O leitor de tela perde a posição, e a trava de Tab só compara com o primeiro e o último controle.
   Conserto: depois de limpar, focar o próprio campo; depois do "Limpar tudo", focar o primeiro campo.

## Registrar

6. **O mover à mão não acorda nada que crie cobrança, contrato, card, Partner, trilho ou grupo.** Ninguém se inscreve em `etapa.mudou` nem em `etapa.movida_a_mao` (grep em `apps/api/src`). A saída à mão grava `saida.registrada`, que aciona `espinha.saida` (sem efeito: a etapa já é aquela) e `implantacao.aviso-de-saida`, que só comenta no card que já existe (`onboarding-antecipado.service.ts:352`). A rota exige `leads.editar` e passa pelo `SoGenteGuard`, e `exigirGente` relê ativo, papel e permissão no banco (`mover.service.ts`). O `PATCH /leads/:id` não mudou. Os pedidos antigos ficam impedidos no confirm (`destino-do-mover.ts`, `PEDIDO_DE_MOVER_NA_FILA_APOSENTADO`) e o repedir responde 410. Está correto. Ressalva menor: o `etapa.mudou` do mover à mão (fonte `sistema`) aparece em "rodou sozinho hoje" (`decisoes.service.ts:366-374`).
7. **Vistas e filtros no endereço não vazam.** `vistas.service.ts` filtra toda leitura e escrita por `orgId` e `userId`, e nenhuma tela lê o id de vista da URL. O `segmentoId` lê as pastas só da empresa da sessão: pasta de fora vira conjunto vazio (`work.service.ts`, `pastaComSubpastas`). A migration `20261020100000` é aditiva. Os filtros do funil vão no `where` com `orgId`.
8. **Granola: transcrição, `state` e cofre ok, com três observações.**
   - A transcrição bruta não é gravada: só o hash e a contagem vão para a ata, a auditoria e a ficha.
   - O mascaramento (`varrerSegredos`) acontece antes do prompt, e o prompt cerca o texto com `blocoExterno`.
   - O `state` é JWT de 10 min com `typ: estado-granola`, conferido antes do banco. O token fica só no cofre. O retorno roda sob `comTenantPublico`. Revogar queima tokens, cliente e verificador.
   - Observação 1: os trechos de até 400 caracteres de cada sugestão são citação persistida em `AtaSugestao` e no corpo. É decisão declarada, mas é transcrição parcial guardada.
   - Observação 2: o token é de UMA pessoa (OAuth por pessoa) e fica no escopo da empresa. Todo mundo com `tarefas.ver` lista as reuniões dela, e com `tarefas.editar` + `obsidian.editar` gera a ata de qualquer reunião dela. É decisão de produto, e precisa estar dita na tela de conectar.
   - Observação 3: o `state` não está preso à sessão do navegador (não há cookie de nonce). Um admin de outra empresa pode induzir alguém a consentir e levar o token dessa pessoa para a empresa dele.
9. **O `obsidian.editar` do "Reprocessar" é conferido pelo token.** `atas.controller.ts` usa `u.permissions`, sem reler no banco, diferente do mover.
10. **O DigiSac atende o que foi pedido, com uma ressalva.** A comparação é em tempo constante (`segredoDigisacConfere`, `timingSafeEqual`). Segredo ausente ou errado dá o mesmo 404. O segredo é lido do cofre da empresa da URL (o AAD prende `orgId`). `isFromMe` e `isFromBot` são ignorados. O token não volta à tela (`conexao()` devolve só booleanos e a URL). O fallback do ambiente vale só para slug `root`, e a credencial revogada não cai para ele.
    - Ressalva: o segredo viaja em `?segredo=` (limitação do DigiSac, já declarada) e fica no log de acesso do Traefik. Quem lê esse log ganha a entrada.
11. **`GRANOLA_MCP_URL` e `GRANOLA_REDIRECT_URI` não estão no bloco `environment:` do `docker-compose.yml` nem no `.env.example`.** Hoje só aparecem em `homolog/docker-compose.final-seed.yml`. Os padrões funcionam, mas em produção não dá para sobrescrever pelo `.env`, e a regra da casa pede os dois lugares.
12. **Os comentários de `granola-direto.service.ts` falam em "três ferramentas de LEITURA", mas o `revogar` chama `sign_out`.** A catraca já fixa as quatro (`arquitetura.test.ts:1786`). É só o texto que precisa acompanhar.

## Itens 6 e 7 do pedido

- **Segredos e dados reais no diff:** nada encontrado. Busquei chaves, `Bearer` com valor, JWT, `grn_`, contas `*.digisac.me`, e-mails e telefones. Os números dos testes (`5532911112222`, `5532988880001` e parecidos), `suaconta.digisac.me`, `minhaconta.digisac.me` e `avulsa@gmail.com` são fictícios. Cardozo & Saggioro só aparece em comentários que dizem que nada do escritório entra.
- **Regras de texto:** os 8 travessões das linhas novas estão todos em comentário de código, nenhum em texto de tela. Nenhum emoji nas linhas novas.
