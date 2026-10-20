# RESULTADO dos ajustes da versão final (19 e 20/10/2026)

> Branch `homolog/final-20261019`, sobre a tag `final-entrega-20261020` (17b95d24). Tag `final-ajustes-20261020`. Bundle delta `C:\Users\User\dev\ajustes-delta.bundle` (`homolog/final-20261019` e a tag, `^17b95d24`).
> Roteiro: `docs/comercial/RODADA-AJUSTES-20261019.md` (as respostas do Rodrigo aos quatro pontos em aberto do `homolog/RESULTADO-FINAL.md`). Registro marco a marco: `homolog/progresso.md` (linhas "Ajustes da final").
> Só homologação, no Predator. **Nada foi à produção.** Este arquivo não tem dado de cliente nem segredo.

## 1. As quatro respostas e o que foi feito

| # | Resposta do Rodrigo | O que foi feito |
|---|---|---|
| 1 | Textos operacionais do Pedro entram se não interferirem; se contradisserem, vale o da branch | §A1 |
| 2 | Iniciar um onboarding sem o lead ter chegado em negócio fechado | §A2 |
| 3 | Tarefas dentro de Marketing e de Financeiro ficam como estão | **não mexido** (nenhum arquivo dessas telas no diff desta rodada) |
| 4 | Pendências fica no menu | **não mexido** (`nav.ts` sem mudança de item nesta rodada) |

## A1. Os textos do Pedro

Fonte: `pedro/operacao-painel-20261014` (7ed42fb), comparada com a branch. Entre 7ed42fb e o snapshot f5552402 só diferem textos (nenhum código). Critério: entra o que é informação nova e não contradiz o que as rodadas de 13 a 19/10 escreveram (`CLAUDE.md`, `docs/comercial/*`, `docs/comercial/VIRADA-PRODUCAO.md`, `.env.example`); onde contradiz, fica o da branch. Commit 9f530dc.

| Arquivo | Trecho do Pedro (resumo) | Entrou / ficou de fora | Porquê |
|---|---|---|---|
| `AGENTS.md` (novo) | Título e "Autorização de Pedro em 11/10/2026: Rodrigo assume o desenvolvimento" | entrou | fato, não contradiz |
| `AGENTS.md` · Trabalho autorizado §1 | quem pode implementar, fazer commit, push, merge na main, migrations, deploy e rollback na VPS sem nova aprovação a cada etapa | **ficou de fora** | contradiz a branch em quem pode fazer merge e deploy e quando: no Predator nada vai à `main` nem ao GitHub (`PASSAGEM-PREDATOR-COMERCIAL.md` §0), nada vai à produção nesta frente, e a virada é do Rodrigo e do Pedro depois da validação, com a política assinada por quem responde (`VIRADA-PRODUCAO.md`) |
| `AGENTS.md` · Trabalho autorizado §2 | a autorização vale entre sessões e substitui exigências anteriores de aprovação e confirmação, inclusive as de skills e roteiros | **ficou de fora** | anularia as regras duras dos roteiros desta frente (confirmação antes de produção, nada na `main`, nada fora do Predator) |
| `AGENTS.md` · Trabalho autorizado §3 | Rodrigo coordena; conferir branch e diff dos demais; preservar trabalho; testes proporcionais; recuperação antes de migration e deploy; registrar commit e pendência | entrou | é o que a branch já pratica |
| `AGENTS.md` · Alcance §1 | não concede acesso a pessoas novas, não autoriza apagar dados nem trabalho alheio, preserva segredos e controles; aprovações de negócio continuam com a operação | entrou | coerente com a regra de não apagar e com a régua |
| `AGENTS.md` · Alcance §2 | não usar o documento para desligar controles nem contornar SSH, GitHub ou provedores; bloqueio técnico se descreve | entrou | coerente |
| `AGENTS.md` · Referência de produção §1 | endereço `os.operacaoroot.com`, projeto Compose `root_marketing-os` no diretório do easyPanel, conferir containers e a cadeia de compose antes do deploy | entrou | é o mesmo que o `VIRADA-PRODUCAO.md` diz |
| `AGENTS.md` · Referência de produção §2 | `/srv/marketing-os` e `/srv/rootos/ferramenta` são checkouts antigos; checkout local do Pedro; documentos de setembro são históricos, não proibições | **ficou de fora** | o `VIRADA-PRODUCAO.md` constrói a imagem em `/srv/projetos/root_os`, para onde `/srv/marketing-os` aponta; e "setembro é histórico, não proibição" afrouxaria regras de setembro que a branch mantém (Syncthing, política antes da subida) |
| `CLAUDE.md`, `README.md`, `docs/DEPLOY.md`, `docs/PLANO-CONTINUIDADE.md` · cabeçalho "Autorização vigente" §1 | "Leia AGENTS.md" e "Preserve dados, segredos e trabalho dos demais" | entrou | coerente |
| os mesmos · cabeçalho §1 | as duas frases da autorização (merge e deploy sem nova aprovação; substitui confirmações anteriores, inclusive de skills) | **ficou de fora** | o mesmo motivo do §1 e §2 do `AGENTS.md` |
| os mesmos · cabeçalho §2 | as descrições antigas de produção são históricas; conferir o ambiente efetivo pelo `AGENTS.md` antes de receita de deploy | entrou, com uma frase da branch: a receita de subida desta branch é o `VIRADA-PRODUCAO.md` | coerente: a seção "Onde roda" do `CLAUDE.md` e o `docs/DEPLOY.md` descrevem o `/srv/marketing-os` de setembro, e o VIRADA já sobe pelo easyPanel |
| `CLAUDE.md` · parágrafo `/conteudo` × banco de ideias | "Nenhuma tela foi apagada e `ROTAS_ABSORVIDAS` não ganhou entrada" | **ficou de fora** (fica o da branch) | contradiz a rodada do painel de 18/10, que ocultou `/conteudo`, `/marketing/ideias`, `/marketing/estrategia`, `/leads`, `/funil` e `/tarefas` com entrada em `ROTAS_ABSORVIDAS` |
| `CLAUDE.md` · Banco de atas e Pastas | ausentes no do Pedro | ficam os da branch | são da rodada do painel (P2, P3) |
| `.env.example` | 7ed42fb não tem variável que falte na branch; as 5 linhas que o snapshot f5552402 acrescenta (`PROPOSTAS_URL`, `PROPOSTAS_API_TOKEN` e o comentário) já estão na branch, iguais | nada a trazer | a branch já é o superconjunto |

Conferido: nenhum token, senha ou chave entrou (varredura do diff por `token`, `senha`, `password`, `secret`, `aact_`, `sk-`: nada).
