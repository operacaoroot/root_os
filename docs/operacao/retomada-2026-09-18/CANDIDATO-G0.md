# Candidato G0 — histórico da homologação preservado

Estado: **G0 concluído e validado localmente; nenhuma autorização de atualização remota**.
Pedro autorizou a correção e validação local nesta sessão.

## Mudança fechada

Código: `a98b8d33437af6e6954dd86198f3cd92167d4ca1`.
Apenas dois arquivos de código/teste mudaram desde o candidato `8339f75`:

- `apps/api/prisma/migrations/20260917110000_madrugada_vps_noop/migration.sql`:
  recuperada byte a byte do commit remoto
  `6ce4a40795304f6624300530bc1943954ddfc333` (`madrugada-v6`).
  SHA-256 `dd4ce3a6be8f741622f6fd3a7b3a2fb94579d9a8015fa323d9f623d39f835b8e`.
  Comentário original e `SELECT 1;`; nenhuma mudança de schema/dados.
- `apps/api/test/deploy-instancia.test.ts`: trava de hash/conteúdo e prova de que
  o atualizador recusa perder a migration aplicada e aceita histórico completo,
  sem pendências nem mutação durante `--so-checar`.

Não foi feito merge da tag histórica. Nenhuma edição de `_prisma_migrations`,
`migrate resolve`, alteração de política, seed de demo ou mudança de runtime.
Preservar o checksum impede acrescentar explicações no SQL; a explicação fica aqui.

## Evidências concluídas

- Consulta somente leitura ao histórico da homologação: **41 nomes/checksums
  iguais ao candidato local; zero ausentes, divergentes ou pendentes**.
- Banco local novo: 41 migrations aplicadas; segunda aplicação sem pendências;
  `migrate status` atualizado. Schema conferido em banco sombra exclusivo:
  `No difference detected`, exit 0.
- Suíte de instalação/atualização: **36/36**, sem pulados. Tipos dos testes: verde.
- Plataforma restrita: **17/17**; isolamento entre tenants: **287/287**.
- HTTP compilado local sob papel restrito: `SMOKE_RESTRITO_OK`.
- Imagem Linux/amd64: build completo API/web/MCP e teste HTTP restrito passaram.
- Upgrade real de banco sintético preparado pela imagem anterior: **40 → 41**,
  somente a migration histórica aplicada; hash do registro sentinela antes/depois
  `3cb1808ddf1314bf928ddcbfd33d4358`, conferido por asserção SQL.
- Entrada real `node dist/main.js` da imagem, **18/09/2026 às 16:09 -03**:
  saúde `ok/ok`, versão/commit corretos; conexão resolvida `mktos_app`, sem
  superuser/bypass, modo `impor`, zero reinícios/OOM, nenhuma porta publicada.

Foram executados **340 testes de suíte** nesta rodada (36 + 17 + 287), além das
provas de migration/schema/HTTP/boot. A suíte padrão completa anterior não foi
repetida; não interpretar os 2.237 testes da rodada anterior como nova execução.

Foi corrigido um erro na montagem do teste novo: a busca de uma tag da fixture
muda suas refs Git. A prova de não mutação agora compara antes/depois da checagem,
com a preparação explícita da fixture fora desse intervalo. Nenhuma guarda do
atualizador foi removida ou afrouxada.

A primeira execução adicional de plataforma, paralela a build/typecheck, teve
16/17: o caso de onboarding terminou como falha em 5.144 ms (limite padrão de
5 segundos; JSON registrou `STACK_TRACE_ERROR`). A repetição sem typecheck
concorrente passou 17/17, com esse caso em 1.477 ms, sem alterar timeout ou
asserções. Contenção local é a hipótese, não defeito funcional demonstrado.

## Artefato e encerramento

- Tag anotada local: **`retomada-rls-g0-20260918`**, no commit `a98b8d3`.
  A tag anterior não foi movida. Nenhum push/merge.
- Imagem **`rootos-app:retomada-rls-g0-20260918-a98b8d33437a`**, `linux/amd64`,
  construída de `git archive` do commit, sem incluir arquivos não versionados.
- ID/índice OCI:
  `sha256:b135fe5810920044214ac6cb8ca3cd5d46858f05f2ab9c1d2256cf047ef98277`.
- Digest de configuração:
  `sha256:f3771672f46e0f243c17753a2391afc57a2afc9473160ed9bf406791860baf0c`.
- Pacote **temporário**, somente no Mac: `/tmp/rootos-release-g0-20260918.pkHwDy/`.

| Arquivo | SHA-256 |
| --- | --- |
| `codigo.bundle` (histórico completo, verificado) | `3d48c45bfd66e4a6ba0b2607f86cf515bb282b500b2d6e998a180dff154e2b11` |
| `imagem.tar` | `d4e10d0d4b51494d27c50f71b88bff90d99d0c97b0486afc221a567fd47462f7` |

Nada foi transferido/carregado na VPS nesta rodada. Preservar artefatos até a
próxima etapa; se desaparecerem, gerar novamente e conferir novos hashes.

Limpeza local: removidos apenas `rootos-g0-20260918-api`,
`rootos-g0-20260918-db` e seu volume sintético, após conferir labels e mounts;
smoke/upgrade se removeram ao encerrar. Os bancos de teste/upgrade/sombra são
recriáveis e foram descartados sem backup. Imagem, bundle e tar preservados.
Nenhum container/volume preexistente foi removido.

## Limites e próximo portão

G0 não substitui G1 do [plano](PLANO-ATUALIZACAO-HOMOLOGACAO.md): ainda é necessário
fechar a configuração efetiva do painel/rota e preencher o manifesto da janela.
Backup/restauração de dados existentes, troca de imagens, habilitação de papel
e alterações no painel da VPS **não foram autorizados nem executados** nesta rodada.
O ensaio remoto anterior validou o candidato antigo em banco sintético, não este
novo artefato nem a cópia dos dados da homologação.

Relatórios de trabalho locais: `/tmp/rootos-g0-*`. São temporários; este documento
é o registro persistente do resultado. Nenhum dado/segredo de cliente foi copiado
da VPS. As alterações anteriores de `STATUS-CLAUDE.md` e o roteiro não versionado
de condução permanecem fora dos commits desta tarefa.
