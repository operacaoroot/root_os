# Atualização segura da homologação — plano de execução

Estado: **PLANO PREPARADO; NÃO AUTORIZA EXECUÇÃO REMOTA**.
Atualização: **G0 concluído localmente** no candidato `a98b8d3`, tag
`retomada-rls-g0-20260918`; evidências e hashes em [CANDIDATO-G0.md](CANDIDATO-G0.md).
G1 (configuração efetiva do painel/rota) segue pendente, antes do manifesto final.
Pedido do Pedro: preparar o plano, sem atualizar serviços. Em 18/09/2026,
15:29–15:32 -03, foram feitas apenas consultas na VPS. Nenhum backup, restore,
alteração de papel, configuração, checkout ou recriação foi executado nesta etapa.

Objetivo: deixar a homologação pronta para validar o caminho do cliente:
onboarding → contexto autorizado → Claude Code (P2) → coleta de uma pasta (P3).
Não inclui produção, novas funcionalidades, SQL do cliente ou gastos com IA.

## 1. Estado confirmado e trava descoberta

| Item | Estado observado |
| --- | --- |
| Destino | `vps-root`, `2.25.223.180`, `srv1983380` |
| Instância | `/srv/rootos/homologacao`, projeto Compose `root_rootos-homologacao` |
| Serviços a trocar futuramente | somente `rootos_homolog_api` e `rootos_homolog_web` |
| Banco a preservar | `rootos_homolog_db`, banco `rootos_homologacao`, dono `rootos` |
| Volume do banco | `root_rootos-homologacao_mktos_db_data` |
| Vault/customizações | `/srv/rootos/homologacao/vault`; `repo/ferramentas/` não versionado |
| Imagem atual | `rootos-app:madrugada-v5-61ff10bb1461` |
| Código atual | `61ff10bb1461f7fa8deeb7b01fcf2100cc0f3ea5` |
| Imagem de recuperação | `sha256:5dd43baca371c30bd65b3072bfff3c7231629b731fb6482072903be0ffc17cd7` |
| Bind atual | somente `172.16.0.1`: web `4100`, API `4101`, PostgreSQL `5443` |
| Isolamento atual | `TENANT_MODO=observar`, `DB_APP_USER` vazio; `mktos_app` NOLOGIN, sem superuser/bypass |
| Banco, só contagens | 13.982.743 bytes; 1 empresa, 3 usuários, 0 notas `ContextItem`, 1 política |
| Rotinas medidas | `ROTINAS_CRON=off`, ClickUp/Pluggy/Obsidian com intervalo `0` |
| Navegador pretendido | `https://homolog.operacaoroot.com` (origem configurada, acesso ainda não validado nesta rodada) |

**Bloqueio G0: 41 migrations no banco versus 40 no candidato `8339f75`.**
As 40 comuns têm checksum idêntico, nenhuma migration inconclusa no banco.
A extra aplicada é `20260917110000_madrugada_vps_noop`:

- Fonte recuperável: commit remoto/tag `madrugada-v6`,
  `6ce4a40795304f6624300530bc1943954ddfc333`.
- SQL conferido: comentário de ensaio e `SELECT 1;`, sem alteração de schema.
- SHA-256 conferido contra `_prisma_migrations`:
  `dd4ce3a6be8f741622f6fd3a7b3a2fb94579d9a8015fa323d9f623d39f835b8e`.
- Ausente no checkout e na imagem v5 hoje em execução. Logo, trocar só a imagem
  de volta anteriormente não desfez o histórico aplicado do banco.

Não apagar linha de `_prisma_migrations`, não editar checksum, não usar
`migrate resolve` para esconder essa diferença. `atualizar.sh` recusaria o
candidato atual por histórico incompleto, corretamente. O ensaio anterior num
banco novo continua válido, mas não provava compatibilidade com este histórico.

## 2. G0 — preparar um candidato compatível, localmente

Roteiro original; itens 1–4 concluídos posteriormente mediante autorização local
do Pedro, conforme `CANDIDATO-G0.md`. Item 5 aguarda G1 e não autoriza a VPS:

1. Recuperar somente o SQL original acima, byte a byte, para o mesmo caminho
   da migration em uma correção local focada; verificar o hash. Não fazer merge
   da tag inteira nem incorporar outros arquivos do ensaio histórico.
2. Registrar que é uma migration histórica sem efeito, preservada por já ter
   sido aplicada na homologação. Não há autorização para aplicá-la em produção.
3. Novo commit e nova tag, sem mover `retomada-rls-20260918`; construir novo
   artefato Linux/amd64 de fonte commitada. Repetir migrations do zero, smoke
   HTTP restrito, boot real e verificação da identidade/arquivo exportado.
4. Comparar novamente o inventário do banco com o candidato: **41 nomes e
   checksums iguais, zero pendentes/divergentes**. Havendo mudanças reais de
   schema/política, este plano deixa de valer e exige nova análise.
5. Preencher um manifesto de execução com novo commit/tag, imagem/digest/hash,
   caminhos exatos dos recursos temporários, janela, operador e recuperação.
   Só então pedir aprovação remota. O candidato antigo não fica liberado.

## 3. G1 — fechar a configuração de execução e do painel

O atualizador existente não serve literalmente para esta janela: ele faz fetch
do `origin` (aqui é `/srv/rootos/bundles/madrugada.bundle`), checkout, build na
VPS e ensaio no mesmo cluster. A proposta é usar a **imagem pronta e validada**,
sem rebuild nem checkout do repositório com customizações.

- Compose observado: `repo/docker-compose.yml` + `override.yml`; o compose base
  não mudou entre v5 e o candidato testado. Usar projeto, diretório e env-file
  explícitos; nunca compose genérico nem `deploy/up.sh --vps`.
- Preservar checkout v5 e registrar separadamente a release realmente em
  execução, seu código/bundle e `ROOTOS_VERSION/COMMIT/IMAGE`. Não afirmar que
  HEAD do host representa a imagem. Essa divergência exige instrução operacional
  persistente: futuros comandos devem respeitar o manifesto, não rebuildar v5.
- Inventariar sem revelar valores sensíveis a configuração **efetiva** de API/web,
  flags de todos os timers, mounts, redes, portas e origem do painel. Proibir
  alteração de banco/Redis/MinIO ao renderizar a configuração proposta.
- `ROOTOS_PAINEL=root/rootos-homologacao` está configurado e há um compose gerado
  em `painel/docker-compose.yml`, mas os diretórios esperados em
  `/etc/easypanel/projects/root/rootos-homologacao` não existem. Isso **não prova**
  ausência do serviço: confirmar no painel/API qual configuração governa o Deploy.
- O web hoje não está na rede externa `easypanel`. Confirmar a rota/domínio
  realmente usada antes de propor mudança. Se precisar de ligação, o manifesto
  deve nomear **apenas** web da homologação, rede e alias
  `root_rootos-homologacao_web`; não reconectar API/banco à rede do painel.
- Evitar duas fontes de configuração divergentes: o manifesto precisa incluir
  atualização/backup da configuração específica de homologação no painel **se
  ela existir**. Não basta alterar `.env` local e deixar o próximo Deploy voltar
  imagem/credenciais antigas. Não tocar no projeto de produção.

## 4. G2 — backup e restauração antes do corte (exige aprovação)

Janela sugerida: 30–45 minutos, incluindo até 10 minutos de indisponibilidade
da homologação; validar com Pedro. Uma única execução, trava por instância.
Preflight: destino correto, serviços saudáveis, nomes temporários livres,
disco >10 GB e memória disponível >2 GiB; qualquer divergência interrompe.

1. Fechar escrita de usuários, agentes e jobs da **homologação**, sem produção.
   Parar somente sua API durante a captura se não houver manutenção verificável.
   Não confundir cron desligado com ausência de escrita humana/external.
2. Backup completo do banco e cópias protegidas de `.env`, override, configurações
   do painel, metadados de versão, vault e `ferramentas/`; incluir inventário de
   mounts/objetos MinIO e demais persistências. Mesmo que não sejam modificados,
   registrar o que a recuperação cobre e como comprovar preservação.
   Não rotacionar JWT, AUTH, chaves de cifra, OAuth ou credenciais existentes.
3. Diretório de backup exclusivo, fora de repositório/sincronização, `0700`,
   arquivos sensíveis `0600`; nenhum conteúdo de cliente/segredo no Git, chat
   ou Mac. Registrar apenas checksums, tamanho, horário e resultado. Não podar
   backups anteriores nesta janela. `backup-db.sh` pode gerar o dump com
   `BACKUP_DB_CONTAINER=rootos_homolog_db`, usuário/banco explícitos e diretório
   novo; limpar variáveis herdadas de conexão antes de executar.
4. Restaurar esse dump em **PostgreSQL separado**, volume/rede privados, sem
   portas nem saída externa. `backup-db.sh --restore-test` usa o cluster de
   origem por padrão: **não chamar assim**. Preparar roles mínimas compatíveis
   no cluster novo, sem copiar senhas/globals do cluster existente. Restore com
   erro fatal (`ON_ERROR_STOP`/`--exit-on-error`, conforme o formato).
5. Provar inventário/checksums das 41 migrations, schema, RLS/FORCE, contagens por
   tabela e integridade do rastro/memória na cópia. Tabela legitimamente vazia
   (como `ContextItem`) deve continuar vazia; não “corrigir” criando dados reais.
6. Na cópia, executar candidato com papel restrito e modo `impor`, ambiente
   sintético mínimo, sem `.env`/vault/chaves reais. O dump contém dados sensíveis:
   fica só na VPS e não ganha saída de rede. Rodar smoke HTTP com fixtures
   exclusivas e confirmar que não remove dados preexistentes; depois provar boot
   da imagem anterior com sua configuração de conexão original na mesma cópia.
7. Somente com restauração e dois boots verdes seguir. Em falha, voltar a API
   anterior se parada e encerrar sem corte. Cópias sensíveis temporárias devem
   ser descartadas após análise; manter o backup protegido, nunca publicar logs
   com conteúdo ou credenciais. Se reabrir escrita entre backup e corte, capturar
   novo backup consistente antes da troca.

## 5. G3 — troca da homologação e ativação do papel restrito

Executar apenas depois do manifesto preenchido e aprovado e G0–G2 verdes.

- Guardar configuração anterior e atributos de `mktos_app`. Por estar NOLOGIN
  hoje, nenhum login ativo depende dele; revalidar na janela. Habilitar senha
  exclusiva e LOGIN **somente no cluster da homologação**, sem SUPERUSER/BYPASS.
  Não usar `deploy/papel-app.sh --vps`, que não seleciona esta instância.
- Alterações permitidas devem ser enumeradas no manifesto: três marcas de versão,
  `DB_APP_USER=mktos_app`, senha nova protegida, `TENANT_MODO=impor`. Conferir
  `APP_DATABASE_URL`: ela tem precedência; se não estiver vazia, resolver a
  divergência antes do corte, nunca ignorar silenciosamente.
- Preservar todas as outras chaves, portas, volumes e customizações. Cron e
  conectores permanecem desligados conforme baseline; não ativar chamadas pagas.
- Migrations já devem estar todas aplicadas e política inalterada: não executar
  seed de demo, sync-permissions, alterações de política ou migrations novas.
  A inicialização do compose contém `migrate deploy`: conferir que será no-op
  com o histórico reconciliado; qualquer pendência aborta **antes** do up.
- Renderizar configuração em arquivo protegido e comparar campos permitidos.
  Trocar somente `api web`, com `--no-deps --no-build`, projeto/arquivos/env
  explícitos. Nunca `down`, `down -v` ou `up` sem nomes de serviços.
- Aplicar apenas a ligação de rede e sincronização de painel já resolvidas em
  G1 e autorizadas no manifesto; sem clique em Deploy de produção.

## 6. Aceite, recuperação e encerramento

Aceite mínimo antes de encerrar:

- Saúde `ok/ok`, versão/commit/digest esperados; conexão resolvida realmente em
  `mktos_app`, sem superuser/bypass, modo `impor`, sem falhas no boot.
- Navegador da homologação: HTTPS, login e leitura do contexto sem 5xx; Pedro
  usa suas próprias credenciais. Não redefinir senha de usuário para testar.
- Isolamento negativo já provado na cópia; não rodar smoke destrutivo/fixtures
  no banco ativo. Qualquer novo tenant sintético ativo exige autorização própria.
- Produção conserva IDs/imagens/reinícios/saúde; banco/Redis/MinIO da homologação
  não foram recriados. Conferir hashes de vault/ferramentas e chaves não permitidas
  sem mostrar valores. Nenhuma promessa de prontidão P2/P3 apenas com `/health`.

Falha após corte: interromper novas escritas, restaurar `.env`/override/painel
anteriores e recriar **só API/web** com a imagem anterior, conferindo saúde e
identidade. A versão antiga deve voltar com a **conexão dona e modo anteriores**;
voltar apenas a imagem mantendo `impor`/papel restrito pode impedir seu boot.
Restituir `mktos_app` a NOLOGIN e remover sua senha recém-criada somente após
retirar a API candidata e confirmar que não surgiu outro consumidor.

Não há mudança de schema prevista: rollback de runtime não deve apagar dados.
Se houver corrupção/perda, não restaurar dump sobre o banco ativo automaticamente:
parar escritas, preservar o estado para diagnóstico e pedir aprovação específica
para recuperação de dados, explicitando o que foi escrito desde o backup.

Limpeza: apenas recursos temporários identificados no manifesto; guardar backup
anterior, imagem anterior e evidências. Sem prune. Registrar horário, responsável,
comandos sanitizados, checks e mudanças reais; atualizar STATUS-CODEX.md.

## Próximo comando de trabalho para a sessão executora

> Prepare localmente o candidato compatível do G0: recupere somente a migration
> histórica `20260917110000_madrugada_vps_noop` do commit remoto `6ce4a40`, confira
> o SHA-256 registrado, adicione teste de compatibilidade e repita a validação
> da imagem. Não altere a VPS. Depois feche G1 por inventário somente leitura e
> preencha o manifesto com o novo artefato e recursos exatos. Pare para aprovação
> explícita antes de backup/restore, habilitação de papel ou troca de serviços.

**Handoff atualizado após G0:** não repetir a correção nem reconstruir o artefato
sem necessidade. Conferir o candidato fechado em `CANDIDATO-G0.md`, fazer apenas
o inventário de G1 e fechar o manifesto antes de qualquer pedido de execução remota.

Esse texto é um handoff, não uma autorização já concedida. Ao concluir a preparação,
perguntar a Pedro pela janela e escopo fechado. Não pedir aprovação genérica para
um artefato ainda não produzido ou para uma configuração do painel desconhecida.
