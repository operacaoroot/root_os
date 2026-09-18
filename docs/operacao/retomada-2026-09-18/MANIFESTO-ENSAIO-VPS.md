# Manifesto — ensaio isolado de RLS na VPS ROOT

Estado: **APROVADO PELO PEDRO — ENSAIO CONCLUÍDO COM SUCESSO EM 18/09/2026**.
Janela: 14:54–14:59 -03. Recursos de execução e segredos sintéticos removidos;
imagem e logs mantidos. Evidências: [RELATORIO-ENSAIO-VPS.md](RELATORIO-ENSAIO-VPS.md).
Preparado em 18/09/2026. Responsável pela autorização: Pedro Magnago.
Executor: a sessão que receber a aprovação e reler este manifesto.
O pedido “pode continuar até o final” autorizou a conclusão local, não este ensaio remoto.

## Objetivo e fronteira

Provar o candidato já validado no Mac em Linux/amd64 nativo, com PostgreSQL novo,
papel sem superuser/bypass, `TENANT_MODO=impor` e HTTP real. Não atualizar nem
recriar produção, homologação, easyPanel ou Traefik. Não ativar RLS na API da
homologação existente. Não alterar DNS, firewall, portas publicadas ou redes desses serviços.
Não fazer push, merge, build na VPS, nem usar dados/credenciais reais de clientes.

Este ensaio não fecha P2/P3, OAuth externo, IA paga, navegador/DNS/TLS ou o aceite
de onboarding por outra pessoa em VPS limpa. O teto de IA continua limitado a
uma instância executora; saldo agregado não é lease distribuído.

## Destino e estado medido

- SSH: **`vps-root`**, endereço **`2.25.223.180`**, hostname **`srv1983380`**.
  O alias `vps` aponta para outra máquina: **proibido neste roteiro**.
- Inventário somente leitura em 18/09 às 12:21 -03: produção e homologação com
  saúde `ok/ok`, zero reinícios nos quatro containers API/web; 86 GB livres,
  6.288 MiB disponíveis; host de 2 vCPU.
- Sondas internas existentes: produção `http://172.16.0.1:4001/api/health`;
  homologação `http://172.16.0.1:4101/api/health`.
- Homologação: imagem `rootos-app:madrugada-v5-61ff10bb1461`, commit
  `61ff10bb1461f7fa8deeb7b01fcf2100cc0f3ea5`; conexão efetiva `rootos`, superusuário,
  `TENANT_MODO=observar`. `mktos_app` está NOLOGIN; 86 tabelas têm RLS e FORCE.
  **Não mudar esse papel, senha, banco, arquivo de ambiente ou container.**
- Clone `/srv/rootos/homologacao/repo` contém `?? ferramentas/`: preservar.
  Não usar checkout/reset/clean, nem substituir esse clone.
- Diretório, rede, volume e prefixo de containers abaixo estavam livres às
  aproximadamente 12:30 -03. Revalidar todos imediatamente antes de criar.

## Artefatos fechados localmente

- Código: **`8339f75791167ab05dd2b9bb9567e6a4b54ff90d`**.
- Tag anotada local: **`retomada-rls-20260918`**. Não publicada.
- Imagem: **`rootos-app:retomada-rls-20260918-8339f7579116`**, `linux/amd64`.
- ID observado no Docker local:
  `sha256:ac9c1b8e345b2eb0b538cca6069b2bec7c98d99235bb7cff4a0b2ba2df3b59df`.
- Digest de configuração da imagem:
  `sha256:b360e8b44f8430cf999ab919e8830e4b125390807136f1e8a6feec7040e51a46`.
  O ID apresentado por engines com armazenamento clássico pode ser o digest da
  configuração, em vez do índice OCI. Não aceitar identidade divergente sem
  conferir a estrutura do arquivo exportado e esses digests.
- Construída de `git archive` desse commit, não da árvore com arquivos não
  versionados. Build completo API/web/MCP; nenhuma credencial pessoal montada.
- Diretório local **temporário**: `/tmp/rootos-release-rls-20260918.n0Ll10/`.
  Preservar os arquivos até a execução. Se sumirem, reconstruir e registrar os
  novos hashes antes de autorizar; não presumir build bit a bit idêntico.

| Arquivo | SHA-256 |
| --- | --- |
| `codigo.bundle` (4,3 MiB; histórico completo, bundle verificado) | `716188cf500f167997c666828d3a8877ea93acebdd2f1cbeac3bc8c6491653f0` |
| `imagem.tar` (aprox. 475 MiB; `docker image save`) | `220b15c60fd26e65efc6d440e078173ebd533d9af6705f46874b11c8e268be74` |

O bundle é evidência/recuperação de código; este ensaio transporta a imagem pronta,
sem importar o bundle no clone existente. Relatório local em `STATUS-CODEX.md`.

## Recursos novos, exclusivos e descartáveis

| Recurso | Identificador fechado |
| --- | --- |
| Diretório remoto | `/srv/rootos/ensaios/rls-20260918` |
| Rede Docker privada | `rootos-rls-ensaio-20260918-net` |
| Volume PostgreSQL | `rootos-rls-ensaio-20260918-pg` |
| Container PostgreSQL | `rootos_rls_ensaio_20260918_db` |
| Container de smoke/API (execuções sequenciais) | `rootos_rls_ensaio_20260918_api` |
| Label de propriedade | `rootos.task=ensaio-rls-20260918` |
| Banco / dono / aplicação | `rootos_rls_ensaio_test` / `rootos_ensaio` / `mktos_app` |

PostgreSQL: imagem já presente na VPS `pgvector/pgvector:pg16`, ID inventariado
`sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`.
Fixar esse ID para o ensaio; não atualizar a tag nem puxar outra imagem em silêncio.
`mktos_app` aqui pertence ao **cluster novo**, nunca ao cluster existente.

Nenhum `-p`, porta pública, domínio, montagem de pasta pessoal ou socket Docker.
API/teste compartilha apenas o namespace de rede do banco NOVO
(`--network container:rootos_rls_ensaio_20260918_db`), permitindo URLs
`127.0.0.1:5432` e as guardas locais do smoke. Rede nova sem ligação ao easyPanel.
Limites propostos: banco **0,5 CPU / 512 MiB**, API **1 CPU / 1 GiB**; nenhum
restart automático. Risco residual: disco, CPU e daemon são compartilhados com
o host; isolamento não significa impacto zero. Observar saúde dos serviços existentes.

Segredos únicos gerados para o ensaio, fora de Git, arquivos modo `0600` em
diretório `0700`; passar via `--env-file` e SQL por stdin, não argumentos/logs.
Docker/root do host continuam capazes de ler o ambiente: não usar segredos reais.
Aplicação com `APP_DATABASE_URL` restrita e `TENANT_MODO=impor`; dono apenas para
migrations, seed e fixtures/limpeza do teste. Sem chaves de IA, OAuth ou conectores.
`ROTINAS_CRON=off`, `CLICKUP_SYNC_INTERVAL_MIN=0`, `PLUGGY_SYNC_INTERVAL_MIN=0`,
`OBSIDIAN_REINDEX_MIN=0`; o smoke define suas próprias variáveis sintéticas.

## Workflow após a aprovação — uma tarefa por checkpoint

1. **Preflight, sem escrita:** confirmar alias/IP/hostname; saúde e reinícios
   atuais de produção/homologação; identidade das imagens; nomes livres; disco
   livre maior que 10 GB e RAM disponível maior que 2 GiB. Registrar horário.
   Se qualquer nome existir ou premissa divergir, parar e reconciliar; não apagar.
2. **Transferência:** criar somente o diretório fechado acima; copiar `imagem.tar`,
   conferir SHA-256 antes de `docker load`. Conferir arquitetura e identidade
   carregadas; não sobrescrever tags usadas por serviços existentes. Não executar
   build remoto e não tocar no checkout da homologação.
3. **Banco novo:** criar rede privada, volume e PostgreSQL com label e limites.
   Gerar credenciais sintéticas protegidas; aplicar as 40 migrations e
   `db:seed:politica` usando o dono **apenas desse banco**. Não executar seed demo
   nem sync-permissions. Habilitar LOGIN/senha de `mktos_app` apenas nesse cluster,
   mantendo NOSUPERUSER/NOBYPASSRLS e grants das migrations. Confirmar atributos
   do papel, RLS/FORCE e conexões antes do teste.
4. **Teste compilado na imagem:** executar `node scripts/smoke-restrito.cjs`
   com `TEST_DATABASE_URL` dona e `TENANT_DATABASE_URL` restrita, ambas locais,
   mesmo banco descartável e usuários diferentes. Exigir exit 0 e
   `SMOKE_RESTRITO_OK`; registrar saída sem segredos. O smoke cria dois tenants,
   faz cadastro/login/carga, verifica autoria e bloqueio de acesso cruzado,
   recusa provisionamento indevido e limpa apenas suas fixtures.
5. **Entrada real:** após remover só o container de smoke encerrado e confirmar
   sua label, reutilizar seu nome para iniciar `node dist/main.js` com o mesmo
   banco e papel restrito. Sem portas publicadas. Consultar de dentro do container
   `/api/health`, `/api/health/versao` e `current_user`/atributos pela conexão da
   aplicação. Exigir saúde `ok/ok`, versão/tag/commit acima, papel sem superuser
   ou bypass, modo `impor`, zero reinícios. Encerrar essa API de ensaio.
6. **Encerramento:** repetir sondas/reinícios de produção e homologação e comparar.
   Registrar comandos sanitizados, horários, identidades, resultados e falhas em
   relatório novo nesta pasta. Remover **somente** containers, rede e volume
   sintético deste manifesto, após conferir labels e mounts. Remover arquivos de
   credenciais do ensaio após o teardown; manter imagem, tar e relatório para revisão.
   Atualizar `STATUS-CODEX.md`. Não avançar para ativação da homologação existente.

Estimativa: 5–15 minutos após transferência, não compromisso de duração.
Prazo máximo desta janela: 45 minutos; timeout/falha é portão, não motivo para
ampliar recursos ou permissões automaticamente.

## Interrupção e recuperação

Parar se destino/artefato divergir, houver colisão de recursos, saúde dos serviços
existentes degradar, reinício inesperado, exposição de porta, falta de RAM/disco,
erro de migration, erro de isolamento ou timeout. Interromper containers **do
ensaio** identificados pela label; nunca parar serviços existentes. Em falha de
teste, manter o volume sintético e logs sanitizados para análise, anotando
explicitamente o que ficou. Segredos permanecem protegidos até o descarte.

Não há rollback de produção/homologação neste escopo: seus serviços, bancos e
configurações não são modificados. A recuperação é retirar os recursos novos.
Não rodar `docker system prune`, `volume prune`, compose genérico ou
`deploy/papel-app.sh --vps`: esse script não seleciona esta instância isolada.
Ativação do papel restrito na homologação e ligação de rede do easyPanel exigem
outro manifesto, janela e aprovação; não estão embutidas neste aceite.

## Aprovação a registrar antes da primeira escrita remota

Pergunta: **“Aprova o ensaio isolado deste manifesto na VPS ROOT, sem alterar
produção nem a homologação existente?”**

Resposta: **“sim”**, nesta sessão, em resposta direta à pergunta acima.
Aceite registrado em **18/09/2026 às 14:55 -03** (horário do registro, não
timestamp fornecido pela mensagem). Escopo permanece exclusivamente o ensaio
isolado; nenhuma autorização de alteração da homologação existente ou produção.
