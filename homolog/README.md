# Homologação do cockpit comercial (Predator)

Ambiente de homologação do módulo comercial do ROOT OS: projeto Docker próprio (`rootos-comercial`), sem rede, volume ou porta compartilhados com outro projeto da máquina. Não é produção.

O estado da entrega, as pendências e a lista do que depende do Rodrigo estão em `homolog/RESULTADO.md`. O painel do lead e a passada de UX (lane UX, 13/10) estão em `homolog/RESULTADO-UX.md`; a prova no navegador é `node homolog/e2e/ux-painel.mjs`. O registro linha a linha está em `homolog/progresso.md`. Os laudos da revisão adversarial estão em `homolog/revisao/`.

## 1. Subir do zero

Pré-requisitos: Docker Desktop, Node 22+, `corepack enable` e `corepack prepare pnpm@9.15.9 --activate`, `pnpm install` na raiz.

1. Copie `homolog/.env.homolog.example` para `homolog/.env.homolog` (o arquivo é ignorado pelo git) e gere um valor diferente para cada segredo:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Segredos: `DB_PASSWORD`, `JWT_SECRET`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD`, `ASAAS_WEBHOOK_TOKEN`, `ZAPSIGN_WEBHOOK_TOKEN`, `PONTE_MODELO_TOKEN`. O compose recusa subir sem os dois tokens de webhook.

2. Suba:

   ```
   docker compose -p rootos-comercial -f homolog/docker-compose.comercial.yml --env-file homolog/.env.homolog up -d --build
   ```

   As migrations rodam no arranque da API. MinIO é opcional (perfil `storage`).

3. Semeie, nesta ordem, com `DATABASE_URL` apontando para o banco da homologação (porta 5440, banco `rootos_comercial`):

   ```
   pnpm --filter @mktos/api db:seed            # empresa root, admin@marketing-os.local com a ADMIN_PASSWORD
   pnpm --filter @mktos/api db:seed:politica   # catálogo da régua (capacidade nova pede POLITICA_CAPACIDADE_NOVA_*)
   pnpm --filter @mktos/api db:seed:comercial  # mesa e sócio, configuração de homologação e as oito empresas
   ```

   O `db:seed:comercial` recusa `NODE_ENV=production` e empresa que não seja `root`. É idempotente: a segunda passagem não duplica e devolve os mesmos links. No fim ele imprime os oito links `/s/<token>` das salas (o token só existe em hash e cifrado no banco: guarde a saída).

4. Confira: `curl http://127.0.0.1:4010/api/health` e `docker compose -p rootos-comercial -f homolog/docker-compose.comercial.yml ps` (tudo `Up`).

## 2. Endereços e logins

| O quê | Endereço |
|---|---|
| Cockpit | `http://100.95.41.124:3010` (Tailscale) ou `http://127.0.0.1:3010` |
| Celulares simulados (lead e mesa) | `/comercial/simulador` |
| Sala do cliente | `/s/<token>` |
| API | `http://127.0.0.1:4010/api` |
| Dublê do Asaas (simular Pix) | `http://100.95.41.124:4011` |
| Dublê da ZapSign (simular assinatura) | `http://100.95.41.124:4012` |

Logins pelo caminho de e-mail e senha em `/login`, todos com a `ADMIN_PASSWORD`:

- `admin@marketing-os.local`: administrador.
- `mesa@root.homolog`: alçada responsável (libera R3).
- `socio@root.homolog`: titular (assina R4 com senha e motivo; recebe o link de assinar pela Root quando for o signatário cadastrado).

## 3. Demonstrar em 10 minutos

1. Entre como `mesa@root.homolog`. `/comercial` é a fila de decisões (tela 03).
2. `/comercial/funil` (tela 04): as oito empresas por etapa. Arrastar mostra o portão e o que falta.
3. Abra a Construtora Alicerce (tela 05): o fio do primeiro contato à proposta lida.
4. Rode a jornada inteira num lead novo: `node homolog/e2e/jornada-docker.mjs`. Ela cria o lead pelo simulador e passa por formulário, horário, ata, diagnóstico, proposta, leitura, ajuste, aceite, Pix e assinatura nos dublês, fechamento e contrato vivo. Imprime os toques humanos e grava `homolog/provas/jornada-docker.json`. A M3 (confirmação de véspera) só sai na véspera: rode depois das 10h de São Paulo num dia que antecede dia útil.
5. `/comercial/contratos` (tela 11), `/comercial/torre` (tela 12), `/comercial/relatorio` (tela 13).
6. `/atendimento`: as liberações R3 e R4 que a régua reteve.

## 4. Ponte de modelo (opcional)

Sem chave da Anthropic, a homologação roda com `LLM_PROVIDER=stub` (determinístico, lê `homolog/fixtures/stub`). Para a demonstração com modelo de verdade pela assinatura do Claude Code desta máquina:

```
node homolog/ponte-modelo/ponte.mjs
```

e `LLM_PROVIDER=ponte` no `.env.homolog`, recriando a API (`up -d --no-build api`). A ponte só escuta em loopback, exige o `PONTE_MODELO_TOKEN`, abre o CLI sem shell, sem ferramentas, sem MCP e sem configurações de usuário. Sessão do Claude Code expirada = a chamada cai no stub com aviso na tela. Custo gravado 0 com `custoDesconhecido`.

## 5. Testes

- Banco de teste: `rootos_comercial_test` (e `rootos_comercial_test_rls` para o isolamento), com migrations e `db:seed:politica`. `TEST_DATABASE_URL` no `.env.homolog`.
- Suíte da API: `pnpm --filter @mktos/api test` (com `TEST_DATABASE_URL`); isolamento: `pnpm --filter @mktos/api test:isolamento` com `TENANT_DATABASE_URL` do papel restrito.
- Web: `pnpm --filter @mktos/web test`. Política: `pnpm --filter @mktos/policy test`.
- Suítes do comercial: `apps/api/test/comercial-*.test.ts`.

## 6. Derrubar

- Parar sem perder dados: `docker compose -p rootos-comercial -f homolog/docker-compose.comercial.yml --env-file homolog/.env.homolog down`
- Zerar (apaga os volumes do projeto, só dele): o mesmo com `down -v`. Decisão de quem opera a máquina.
- Nunca `docker system prune`: há outros projetos na máquina.
