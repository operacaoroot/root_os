# Resultado — ensaio isolado na VPS ROOT

**APROVADO nos testes; não é deploy nem ativação da homologação existente.**
Autorização: Pedro respondeu “sim” à pergunta do manifesto nesta sessão;
aceite registrado às 14:55 -03 de 18/09/2026. Preflight às 14:54:49 -03.
O escopo executado foi somente o [manifesto](MANIFESTO-ENSAIO-VPS.md).

## Resultado observado

| Checkpoint | Evidência |
| --- | --- |
| Destino | `vps-root`, `2.25.223.180`, `srv1983380`, Linux x86_64 |
| Recursos antes | 86 GB livres, 6.282 MiB disponíveis; nomes do ensaio livres |
| Transferência | `imagem.tar` conferido por SHA-256; mesmo hash do manifesto |
| Imagem carregada | `rootos-app:retomada-rls-20260918-8339f7579116`, `linux/amd64`; ID igual ao local |
| Banco do zero | 40 migrations aplicadas; política base v1 e 62 capacidades |
| Papel da aplicação | `mktos_app`, LOGIN, sem SUPERUSER ou BYPASSRLS |
| RLS | 86 tabelas com RLS e FORCE; aplicação sem permissão para `app_rls_desligar()` |
| Teste HTTP compilado, 14:57:38 -03 | `SMOKE_RESTRITO_OK`, exit 0, sem OOM |
| Entrada real `node dist/main.js`, 14:58:22 -03 | saúde `ok/ok`, tag e commit esperados; modo `impor`; papel restrito conferido pela URL resolvida do código |
| Isolamento operacional | rede `--internal`, sem portas publicadas, sem mounts na API, sem credenciais reais |
| Limites | API 1 CPU/1 GiB; banco 0,5 CPU/512 MiB; zero reinícios/OOM |

Código da imagem: `8339f75791167ab05dd2b9bb9567e6a4b54ff90d`.
ID local e remoto:
`sha256:ac9c1b8e345b2eb0b538cca6069b2bec7c98d99235bb7cff4a0b2ba2df3b59df`.
Nenhum build na VPS, push, merge, acesso a dados reais ou chamada a provedor de IA.

O smoke usou PostgreSQL real e dois tenants sintéticos: cadastro, login válido e
inválido, carga de contexto, acesso à própria memória, bloqueio cruzado (404),
orgId do corpo sem substituir a identidade autenticada, provisionamento indevido
recusado (403), integridade e varredura de reservas. Não é uma repetição das
2.237 asserções locais; é o teste HTTP compilado rodando nativamente na VPS.

Avisos esperados: serviços sem credenciais ficam desativados e rotinas estão
desligadas. No banco vazio, provisionamento avisou `rastro-sem-ordenante`:
não existia empresa anterior para guardar a intenção; o nascimento permanece
registrado na empresa criada. Não houve erro de teste ou de migration.

## Serviços existentes preservados

Saúde `ok/ok` antes (14:54:49), durante (14:55:50, 14:57:13, 14:58:23)
e após o ensaio (14:59:13). Os quatro containers abaixo mantiveram ID, imagem e contador
de reinícios **0**. Isso mede essas sondas, não garante ausência de toda variação
de latência nem substitui teste de navegação/DNS/TLS.

| Container | ID (prefixo) | Imagem (prefixo SHA-256) |
| --- | --- | --- |
| `mktos_api` | `92f9a8b4b583` | `b56dd8bb30da` |
| `mktos_web` | `7e2e51e86d5b` | `b56dd8bb30da` |
| `rootos_homolog_api` | `ad8e880abaa3` | `5dd43baca371` |
| `rootos_homolog_web` | `c902ee04902e` | `5dd43baca371` |

Não foram executados compose, atualização de serviço, alteração de env existente,
mudança de senha em cluster existente, firewall/DNS/Traefik/easyPanel, checkout ou
limpeza do clone da homologação. A homologação continua com sua imagem anterior;
este resultado **não** significa que ela agora usa o papel restrito.

## Comandos executados — resumo sanitizado

1. `ssh -G vps-root`, hostname, memória/disco, `docker inspect` seletivo e sondas
   HTTP internas. Nenhum dump de variáveis de ambiente/credenciais existentes.
2. `scp` do tar para o diretório exclusivo; `sha256sum -c` e `docker load -i`.
3. `docker network create --internal`, volume dedicado e `docker run` com nome,
   label, limites e `--env-file` sintético. PostgreSQL fixado no ID do manifesto.
4. Na imagem candidata, `pnpm db:deploy && pnpm db:seed:politica` com conexão dona
   do banco novo. `ALTER ROLE mktos_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ...`
   por stdin no cluster do ensaio; segredo aleatório não registrado em comando/log.
5. `node scripts/smoke-restrito.cjs`, pela rede do banco novo; depois remoção do
   container encerrado e execução separada de `node dist/main.js`. Consultas via
   `docker exec` a `/api/health`, `/api/health/versao` e ao papel resolvido por
   `urlDaAplicacao()`; todas com asserções de resultado.
6. Teardown de recursos exatos do ensaio, após conferir labels e mounts; sem prune
   ou comandos destrutivos em coleções amplas. Segredos sintéticos descartados.

## Encerramento e material preservado

Concluído às **14:59:13 -03**. Removidos, após confirmação de label e mounts:
`rootos_rls_ensaio_20260918_api`, `rootos_rls_ensaio_20260918_db`,
`rootos-rls-ensaio-20260918-net` e `rootos-rls-ensaio-20260918-pg`.
Consultas por label retornaram zero containers/redes/volumes remanescentes.
Dados exclusivamente sintéticos descartados sem backup; podem ser recriados.
Removidos os cinco arquivos de segredo: `db.env`, `owner.env`, `app.env`,
`smoke.env`, `papel.sql`, somente dentro do diretório do ensaio.

Mantidos na VPS: imagem candidata e `/srv/rootos/ensaios/rls-20260918/`
(diretório modo `0700`) com `imagem.tar`, `migrations-seed.log`, `smoke.log`,
`entrada-real.json` e `entrada-real.log`. Não há aplicação de ensaio rodando.
Após teardown: 83 GB livres e 6.271 MiB de memória disponível.

## Limite da conclusão

Provado: o artefato inicia e executa esse fluxo sob RLS no servidor real, num
banco novo e sem dependências externas. Não provado: migração/compatibilidade com
dados atuais da homologação, OAuth externo, IA paga, interface no navegador,
MCP com token individual, coleta local integrada ou instalação por outra pessoa.

Próximo passo remoto possível: preparar manifesto próprio para atualizar a
homologação, com backup/restauração, preservação de customizações, credenciais,
compatibilidade e recuperação. **Não autorizado por este aceite.** P2/P3 continuam
no plano de produto; nenhuma implementação adicional foi inferida desta aprovação.
