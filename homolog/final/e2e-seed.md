# Provas e2e com o SEED na imagem final (F6, 19/10/2026)

> Roteiro: `docs/comercial/RODADA-FINAL-20261019.md`, F6 ("os nossos 5 roteiros e2e (trabalho,
> implantacao, painel, ux-painel, jornada) verdes na imagem final com o seed").
> Imagem: `rootos-final-app:final2` (sha256:f75b31a0…, construída 20/10 00:16 UTC).
> Só dado fictício do seed. Nenhuma stack existente foi tocada (rootos-comercial, rootos-copia, rootos-final).

## 1. O ambiente

Stack temporária própria, projeto compose `rootos-final-seed`, arquivo `homolog/docker-compose.final-seed.yml`
(cópia do `docker-compose.final.yml` com nomes, volumes, rede e portas próprios), env `homolog/.env.final-seed`
(fora do git, coberto por `.env.*` no `.gitignore`; segredos gerados com `node:crypto`).

| Serviço | Endereço (só 127.0.0.1) |
|---|---|
| web | 3031 |
| api | 4031 |
| db (pgvector pg16, banco `rootos_final_seed_homolog`, NOVO) | 5444 |
| redis | 6394 |
| dublê Asaas | 4032 |
| dublê ZapSign | 4033 |
| dublê das propostas antigas | só rede interna |

Diferenças deliberadas em relação ao `final.yml`, todas para casar com a `rootos-comercial`, onde os roteiros foram provados:

- `ROTINAS_CRON=on`: a jornada espera a M3 da véspera preparada pelo tique de 1 minuto da rotina `comercial.relogio`. Nada chama fora mesmo assim (LLM stub, WhatsApp simulado, Asaas e ZapSign nos dublês, sem chave de provedor).
- `COMERCIAL_SEED_DEMONSTRACAO=sim` e `QUADRO_DE_CUSTOS_EXEMPLO` (fixture dentro da imagem), como na homologação.
- Os dublês do Asaas e da ZapSign publicados em 127.0.0.1 (a jornada paga o Pix e assina a partir do host).
- O nome do banco casa `/homolog/` de propósito: o `seed-comercial` recusa banco que não pareça de homologação.

Semeadura, dentro do container `api` (o `tsx` vem na imagem), na ordem:

```
docker exec rootos_final_seed_api sh -c "pnpm exec tsx prisma/seed.ts"
docker exec rootos_final_seed_api sh -c "pnpm exec tsx prisma/seed-politica.ts"
docker exec rootos_final_seed_api sh -c "pnpm exec tsx prisma/seed-comercial.ts"
```

- `seed.ts`: empresa `root`, `admin@marketing-os.local` com a `ADMIN_PASSWORD` do env.
- `seed-politica.ts`: banco novo, então só criação (77 capacidades criadas, 0 atualizadas); nenhuma assinatura `POLITICA_*` exigida.
- `seed-comercial.ts` (com `NODE_ENV=production` do container, liberado por `COMERCIAL_SEED_DEMONSTRACAO=sim`): mesa e sócio, as 8 empresas de demonstração (8 leads, 139 eventos, 8 salas, 6 decisões, 3 cobranças, 1 documento), pastas e listas do Trabalho, ata de exemplo e 7 reações. Rodado duas vezes: a segunda passada não mudou nenhuma contagem e devolveu os mesmos 8 links.

As migrations subiram no `command` da api sobre o banco vazio, sem erro; nenhuma linha `ERROR` no log da api durante as provas.

Variáveis da execução (Git Bash):

```
UX_WEB=http://127.0.0.1:3031  UX_API=http://127.0.0.1:4031/api  UX_PW=C:/Users/User/dev/pw-tools
JORNADA_API=http://127.0.0.1:4031/api  JORNADA_WEB=http://127.0.0.1:3031
JORNADA_ASAAS=http://127.0.0.1:4032  JORNADA_ZAPSIGN=http://127.0.0.1:4033
HOMOLOG_ENV=<repo>/homolog/.env.final-seed  PROVAS_PREFIXO=final-seed-
UX_SALA_ALICERCE=<token da sala da Alicerce impresso pelo seed>
UX_RAIZ=site            (só ux-painel; ver §3)
T7_ESPERAR_VENCIDA=1    (só trabalho; ver §3)
```

## 2. Placar

| Roteiro | Resultado | Passos | Tempo | Provas |
|---|---|---|---|---|
| `ux-painel.mjs` | **PASSA** | 13 | 21,4 s | `final-seed-ux-painel.json`, `final-seed-ux-*.png` (12) |
| `painel.mjs` | **PASSA** | 16 | 45,3 s | `final-seed-painel.json`, `final-seed-painel-*.png` (25) |
| `jornada-docker.mjs` com `JORNADA_PARAR_NO_R4=1` | **PASSA** (para no R4 da cobrança, como pedido) | 16 de 23 | 30,3 s | saída no terminal (o roteiro não grava JSON quando para no R4) |
| `jornada-docker.mjs` inteira (dentro do `implantacao.mjs` e uma vez solta, para dar contrato vivo ao T8) | **PASSA** | 23 | 24,8 s | `final-seed-jornada-docker.json` (13 toques humanos, fechamento com 6 escritas) |
| `implantacao.mjs` | **PASSA** | 14 | 76,9 s | `final-seed-implantacao.json`, `final-seed-implantacao-*.png` (17) |
| `trabalho.mjs` (com t7 e t1b dentro) | **PASSA** | 24 | 711 s (10 min são a espera da vencida do T7) | `final-seed-trabalho.json`, `final-seed-trabalho-*.png` (23) |
| `trabalho-t7.mjs` | **PASSA** | 6 | 627 s | `final-seed-trabalho-t7.json`, `final-seed-trabalho-t7-*.png` (6): R3 na linha com um clique, R4 com senha no lugar (o R4 da cobrança deixado pela jornada), vencida "Pedir de novo" recriada em nome de quem clicou, fila sem rolagem lateral a 390 px |
| `trabalho-t1b.mjs` | **PASSA sem storage** (como na rodada do Trabalho) | 1 | 32,5 s | `final-seed-trabalho-t1b.json`, 2 fotos: o registro recusa ANTES de gravar e nenhum lead nasce; o caminho completo segue provado pela suíte `comercial-fechado-fora` |

Os 5 roteiros verdes na imagem final com o seed.

## 3. O que mudou em cada roteiro, e por quê

Comum a todos (`trabalho`, `trabalho-t1b`, `trabalho-t7`, `implantacao`, `painel`, `ux-painel`, `jornada-docker`):
duas variáveis opcionais, sem mudar nenhuma conferência. `HOMOLOG_ENV` aponta o arquivo de onde a senha é lida
(padrão continua `homolog/.env.homolog`); `PROVAS_PREFIXO` prefixa o nome dos JSON e das fotos (padrão vazio),
para as provas desta stack não sobrescreverem as da homologação.

| Roteiro | Falhou em | Mudança | Decisão que a justifica |
|---|---|---|---|
| `trabalho.mjs` (T6) | "o menu comercial devia ser Funil · Contratos · Simulador · Torre · Relatório (veio /comercial)" | A conferência passou a ler as abas da área Comercial (`nav[aria-label="Abas de Comercial"]`) e exige a ORDEM INTEIRA nova: `/comercial` (Painel geral), `/comercial/funil` (Funil vivo), `/propostas`, `/leads` (Lista de leads), `/comercial/contratos`, `/comercial/simulador`, `/comercial/torre`, `/comercial/relatorio`, com os rótulos "Painel geral", "Funil vivo" e "Lista de leads" conferidos e Decisões fora. `/comercial` agora tem de FICAR em `/comercial`, mostrar o quadro "Funil geral" e marcar a aba Painel geral como atual (antes tinha de redirecionar ao Funil). | `homolog/final/enxugamento.md` §2 (Motor Comercial, ordem do roteiro F2) e §3 (colisão de `/comercial`: é o Painel geral do Lucas e deixa de redirecionar); menu por áreas da produção (abas por área, links sem `title`). |
| `trabalho.mjs` (T1) | o clique em `nav a[title="Implantação de clientes"]` (os links do menu não têm mais `title`) | Clica a área "Trabalho" na barra e depois a aba "Implantação de clientes" em `nav[aria-label="Abas de Trabalho"]`; o resto do T1 (kanban, `/onboarding` redireciona, 7 colunas numa linha) igual. | Barra por ÁREAS da produção (enxugamento §1 e §2, Trabalho com Tarefas · Implantação de clientes · Atas). |
| `trabalho.mjs` (T2/T9) e `painel.mjs` | "a atividade da tarefa não chegou à caixa da mesa" | A tarefa da prova é criada com `assigneeUserId` da mesa além do nome. | Versão final F1 (commit c4c8282): "Minhas tarefas pela conta (assigneeUserId e outros responsáveis), como a produção"; o texto do responsável sozinho não põe a tarefa na caixa de ninguém. |
| `ux-painel.mjs` (passo da raiz) | `page.waitForURL(/\/login|\/painel/)`: a raiz manda a `https://operacaoroot.com/` | Com `UX_RAIZ=site` o passo confere ESSE comportamento (resposta 3xx com `Location` `https://operacaoroot.com` (com ou sem a barra final), sem seguir para fora da máquina); sem a variável segue exigindo o login. | A imagem final é construída sem o build arg da homologação `NEXT_PUBLIC_RAIZ=login` (`apps/web/src/app/page.tsx`), como a da produção. As stacks `rootos-final` (3030) e esta (3031) fazem o mesmo; a `rootos-comercial` (3010) vai ao `/login`. Não é defeito de código; ver §4. |

Precondições de dado de um banco novo (nenhuma conferência mudou, só a ordem e as variáveis já previstas no roteiro):

- **T7, vencida "Pedir de novo"**: banco novo não tem aprovação vencida; usei `T7_ESPERAR_VENCIDA=1`, que o próprio roteiro oferece (cria um pedido de mover e espera os 10 min do prazo).
- **T8, contrato concluído**: cada execução conclui o primeiro contrato ativo sem parcela em aberto. O banco novo só tem os fechados das jornadas; a primeira execução completa do `trabalho.mjs` consumiu o da jornada do `implantacao.mjs` e a seguinte parou em "nenhum contrato vivo ativo na homologação". Rodei a jornada inteira uma vez antes (um fechamento a mais) e o T8 passou. Quem repetir o `trabalho.mjs` nesta stack precisa de uma jornada inteira antes de cada execução.
- **ux-painel, aba Dinheiro pela lista de contratos**: o passo só existe quando há lead fechado (é condicional no roteiro); por isso a primeira execução teve 12 passos e a final, depois das jornadas, 13.

## 4. Defeitos de código achados

**Nenhum.** Todas as falhas tinham causa em mudança declarada da versão final (§3) ou em precondição de dado do banco novo.

Para o orquestrador decidir (configuração, não código):

- **`NEXT_PUBLIC_RAIZ`**: a `rootos-final-app:final2` foi construída sem `NEXT_PUBLIC_RAIZ=login`. Para a imagem que vai à produção é o certo (a raiz manda ao site); se a stack `rootos-final` for usada pelo Rodrigo como homologação, a raiz não abre o login, abre o site público.
- **`ROTINAS_CRON`**: o `final.yml` liga `off`; com ele a jornada não passa da véspera (M3 é do relógio). Esta stack liga `on`, como a `rootos-comercial`.

## 5. Estado deixado

- Stack `rootos-final-seed` de pé (7 containers), para o orquestrador decidir. Derrubar sem perder dado:
  `docker compose -p rootos-final-seed -f homolog/docker-compose.final-seed.yml --env-file homolog/.env.final-seed down` (com `-v` apaga os volumes `rootos_final_seed_*`, só desta stack).
- No banco ficaram os dados das provas (leads "Construtora Alicerce Homolog NNNN", "Prova Painel NNNN", tarefas e pastas "da prova", 2 contratos concluídos, decisões tomadas), todos fictícios.
