# Organizar as tarefas reais no lugar (versão final, 19/10/2026)

Roteiro: `docs/comercial/RODADA-FINAL-20261019.md`, lane F5 e decisão 5.
Esta pasta é ignorada pelo git, menos três arquivos sem dado de cliente: este README,
`organizar.mjs` e `neutralizar-copia.mjs`. Todo o resto aqui (mapas, plano, sobras,
contagens, inventário da neutralização) tem título ou nome e fica só na máquina.

## Os dois scripts

| Script | Onde roda | O que faz |
|---|---|---|
| `organizar.mjs` | homologação **e** virada de produção (o mesmo arquivo) | organiza no lugar, pela API: estrutura nossa, listas para as pastas, tarefas para Clientes, cartões de lead para o Funil vivo (cartão arquivado com o link), testes arquivados, cliente em toda tarefa. Marketing não é tocado. |
| `neutralizar-copia.mjs` | **só** numa cópia da produção restaurada para homologação | troca as senhas e anula tokens e segredos cifrados logo depois do `pg_restore`. Recusa banco sem nome de homologação. **Nunca em produção.** |

## Como rodar o organizador

Depois das migrations do merge (a de conciliação já trocou o `WorkTask.clienteId` do
Lucas para `Partner`). Sempre `--simular` primeiro.

```
node homolog/organizar/organizar.mjs --api <url>/api --web <url da web> \
  --mapas <mapa-crm.json>,<mapa-gestao.json>,<mapa-novos.json> \
  [--env <arquivo com as variáveis>] [--saida <pasta fora do git>] --simular --detalhe
# conferido o plano.md:
node homolog/organizar/organizar.mjs ...(os mesmos argumentos, sem --simular)
# de novo, para provar a idempotência (nada muda):
node homolog/organizar/organizar.mjs ...
```

Variáveis (ambiente ou `--env`): `ORGANIZAR_PEDE_EMAIL`/`ORGANIZAR_PEDE_SENHA` (quem
escreve e pede o movimento de etapa) e `ORGANIZAR_CONFERE_EMAIL`/`ORGANIZAR_CONFERE_SENHA`
(outra pessoa, com alçada, que confirma com reautenticação). Opcionais:
`ORGANIZAR_API_URL`, `ORGANIZAR_WEB_URL`, `ORGANIZAR_MAPAS`, `ORGANIZAR_SAIDA`. A passada
que escreve exige `--producao` ou `--homologacao`, em qualquer endereço. As duas contas
precisam ter SENHA (conta só de Google não reautentica), `tarefas.editar`, `leads.editar`,
`financeiro.ver` e `financeiro.editar`, e quem confere precisa de alçada.

Travas da revisão adversarial (19/10): antes de qualquer escrita o script confere que a API
é a da versão final (`GET /comercial/propostas`), que a lista de `Partner` veio (sem ela,
aborta: nada de cliente duplicado) e que nenhuma tarefa ainda aponta para card (conciliação
aplicada). Pelo nome, só casa `Partner` que já é cliente. O cliente da casa só vai para
tarefa que está nos mapas; tarefa nova sem cliente vira sobra.

Saídas em `--saida` (padrão: a pasta do script): `contagens-simular.json` ou
`contagens-organizar-<instante>.json` (antes, depois e o que foi feito, por destino),
`sobras.md` (o que ficou onde estava, com o porquê), `plano.md` (simulação com
`--detalhe`) e `feito.md` (passada de verdade). O console só leva contagens.

## Regras que o script segue

- **No lugar, nunca cópia.** É o mesmo banco: a lista de origem vai para a pasta nossa
  (mover a lista preserva as tarefas e os ids); a tarefa cujo destino é uma lista da
  estrutura (Clientes › Execução etc.) é movida com a etapa equivalente.
- **Leads.** Cartão de lead → `POST /leads/entrada` (origem `manual`, ref `cartao:<id>`, o
  mesmo lead em toda passada) → movimento de etapa pela régua (uma conta pede, a outra
  confirma) → comentário no cartão com o link `/comercial/lead/<id>` → cartão arquivado.
  `contrato` e `fechado` são etapas de sistema: o lead fica em `proposta`.
- **Clientes.** `Partner` achado por CNPJ, senão pelo nome normalizado (o do mapa ou o
  título do cartão de origem), senão pelo que a conciliação já ligou às tarefas; só cria o
  que falta. Cliente já ligado pela conciliação é mantido (divergência com o mapa só é
  contada). Tarefa ativa sem cliente em Administrativa ou Gestão recebe o cliente da casa
  (`interno`); em Clientes, vira sobra.
- **A porta da implantação** (regra nossa) recusa cartão solto em Clientes › Onboarding de
  cliente: o que o mapa pede lá vai para Execução, como na cópia.
- **Testes são arquivados**, com um comentário do porquê. Nada é apagado.
- **Marketing fica onde está**: a pasta de marketing e a lista Marketing não são lidas para
  escrita, nem quando um mapa citar uma tarefa de lá.
- **Sobras**: tudo sem destino claro fica onde está e entra em `sobras.md`.

## EXCEÇÕES (SQL direto)

- `organizar.mjs`: **nenhuma**. Toda leitura e escrita é pela API.
- `neutralizar-copia.mjs`: SQL direto por `docker exec … psql`, numa transação, porque não
  há rota para trocar hash de senha de outra conta, anular segredo cifrado ou pausar rotina
  em lote. Só existe para a cópia de homologação.

## Neutralização da cópia de 19/10 (resumo, sem dado)

Dump `producao-root-20261019b.dump`, restaurado direto no banco da stack `rootos-final`.
Inventário completo (nomes de tabela e coluna, contagens) em `neutralizacao.md`, nesta pasta.

| O quê | Linhas |
|---|---|
| `User.passwordHash`: segredo descartado | 6 |
| `User.passwordHash`: Rodrigo e Lucas com senha nova (no `.env.final`) | 2 |
| `GoogleAccount` tokens | 1 |
| `BioConexao`, `BioCredencialApp`, `BioOauthState` | 1, 1, 6 |
| `SegredoDeConector.valorCifrado` (e revogado) | 3 |
| Cofre da empresa: `CofreItem` (cifrados), `CofreSenha`, `CofreSessao` (vencida) | 8, 1, 1 |
| `OnboardingConvite` (o link enviado ao cliente não abre aqui) | 3 |
| `Approval.tokenHash` | 2 |
| `Rotina` desligada e pausada | 4 |

Varredura por formato de credencial em toda coluna de texto do banco: 2 achados antes, 0
depois. A `ENCRYPTION_KEY` e o `JWT_SECRET` da stack são novos.
