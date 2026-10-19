# Cópia dos cartões do Lucas no nosso ambiente — 19/10/2026

> Decisões do Rodrigo (19/10, ~16h, com o modo manual ligado):
> 1. Usar **cópias dos cartões do Lucas** e trazer para o nosso ambiente, para ver como se comportam. **Tarefas, listas e pastas de teste: apagar** (não copiar).
> 2. Copiar **comercial e gestão**. **Marketing não**: fica só em produção.
> 3. **O nosso código é a verdade** no nosso ambiente. NÃO há merge de código do Lucas nesta rodada (o Rodrigo acerta os merges e a produção com ele).
> 5–6. A cópia de produção vai ao Predator **por exceção**; está no backlog **apagar tudo daqui depois** (ver fim).
> Código: branch **`homolog/copia-lucas-20261019`**, a partir de `comercial/cockpit-homolog` (tag `trabalho-entrega-20261020`). Só entram scripts de importação e provas. `comercial/cockpit-homolog` não muda.
> Encerramento: `homolog/RESULTADO-COPIA.md` + tag `copia-entrega-20261020` + bundle `main..homolog/copia-lucas-20261019` + stack nova de pé.

## Insumo

- **`C:\Users\User\dev\producao\producao-root-20261019.dump`** — `pg_dump -Fc` do banco de produção do ROOT OS, 19/10 ~16h, sha256 `5a13ccd6…5449`. **Dado real de cliente.** Esquema = o da branch `root-os/tarefas` do Lucas (produção roda `10939e1`), com as migrations dele até `20261019220000_tarefas_varios_responsaveis` (inclui `WorkArea`, `WorkList.natureza`, `WorkTask.areaId`, `WorkTask.clienteId` → **outra WorkTask** de lista `cadastro`, `WorkTask.outrosResponsaveisIds`).
- O que há lá (levantado): 1 empresa, 8 usuários, 0 leads em `Lead`, 199 tarefas em 16 listas:
  - pasta **CRM**: Gestão de Leads (10), Contratos dos clientes (6) → **copiar**;
  - soltas: **Operação (48), Comercial (14), Administrativo (6), Financeiro (3), Jorge Tabeliao (1)** → **copiar**;
  - pasta **Demandas internas / Marketing** (Copy 52, Design & Gravação 35, Demandas gerais 17, Rotina de stories 3, Análise 0, Calendário de conteúdo 0, Gestão de Temas 0) e a lista solta **Marketing (1)** → **NÃO copiar**;
  - **Teste teste (3)** e qualquer tarefa/lista/pasta que seja claramente teste → **NÃO copiar** (é o "apagar" do Rodrigo: na cópia, não existem).

## Regras duras

- **Nosso código e nosso modelo são a verdade.** Cliente da tarefa = `Partner` (T4); pastas = as nossas (Administrativa · Gestão · Clientes [Esteira de clientes · Onboarding de cliente · Execução]); funil = tabela `Lead` do cockpit. Os conceitos do Lucas que não existem no nosso código (áreas, natureza cadastro, vários responsáveis) **não viram esquema aqui**: viram dado onde couber (ver C3) e o resto fica registrado.
- **Nada volta à produção, nada vai ao git, nada é publicado.** Esta máquina não tem acesso à VPS da Root, de propósito.
- **O dump nunca é restaurado num banco que uma API leia.** Ele vai para um banco de *staging* só de leitura do importador; o app da stack nova lê só o banco de destino, que recebe os dados já convertidos para o nosso esquema.
- Tokens, segredos e credenciais da produção **não são importados** (cofre, contas Google/Meta/Instagram/YouTube, webhooks, chaves em tabela, hashes de senha). Usuários entram com nome, e-mail e papel; o login da homologação é um só, criado para o Rodrigo (senha guardada no `.env` da stack, nunca em log). Rotinas que chamam fora: desligadas na stack (`ROTINAS_CRON=off`), provedores nos dublês.
- Títulos e textos de cliente **só** em arquivos fora do git (`homolog/copia/`, no `.gitignore`); RESULTADO e progresso só com contagens.
- Commits ≤30 min; linha em `homolog/progresso.md` por marco ("Cópia do Lucas"); bundle refeito nos 10 primeiros minutos de cada rodada; revisor adversarial antes do fechamento (vazamento de segredo da produção, RLS, staging isolado, nada de dado de cliente no git).

## Lanes

### C1 — a stack da cópia
- Projeto compose **`rootos-copia`**, portas próprias e livres (sugestão: web **3020**, api **4020**, db 5441, redis 6392, minio 9014-9015 — conferir antes), em 127.0.0.1 e 100.95.41.124, `restart: unless-stopped`, mesma imagem de `comercial/cockpit-homolog` (a da `trabalho-entrega-20261020`). **A `rootos-comercial` (3010/4010) não é tocada**: o Rodrigo compara as duas.
- Banco de destino migrado do zero com o NOSSO esquema + `db:seed:politica` + a empresa Root (tenant 001, mesmo nome e apelido da produção) + a estrutura sugerida do Trabalho (`POST /trabalho/estrutura/sugerida`). **Sem o seed fictício** (nada de Alicerce/Marina): é o ambiente real-de-mentira.
- Banco de staging `producao_staging` no mesmo Postgres (ou num container à parte), com o dump restaurado, acessível só ao importador.

### C2 — o importador
- `homolog/importar-copia/importar.mjs` (e o que precisar), idempotente (rodar duas vezes não duplica: chave de origem `prod:<id>` guardada no destino), lendo do staging e escrevendo no destino **pela API ou pelos serviços do nosso código** (para valer RLS, auditoria, gatilhos e regras), não por INSERT cru no destino — exceção só para o que a API não expõe, justificada no RESULTADO.
- Usuários: os 8, mapeados por e-mail para usuários do destino (os sócios Rodrigo, Pedro, Lucas e os demais). Responsável da tarefa mapeado por esse vínculo.

### C3 — os cartões, cada um no seu lugar
- **Gestão de Leads (10) → leads no Funil vivo** (entrada idempotente, etapa correspondente ao status de origem, dono mapeado, histórico e comentários no fio). Lead com contrato assinado vira cliente pelo caminho "Registrar cliente já fechado" quando houver os dados; senão fica na etapa e o motivo vai ao mapa.
- **Contratos dos clientes (6) → cliente (`Partner`) + card em Clientes › Onboarding de cliente ou Execução** conforme o status de origem; Contratos vivos quando houver dado de contrato.
- **Cartões de lista `cadastro` do Lucas** (o "cliente = cartão" dele) → **`Partner`** (dedupe por CNPJ quando houver campo, senão nome normalizado); toda tarefa que apontava para o cartão aponta para o `Partner`.
- **Administrativo, Financeiro → Administrativa. Comercial → Gestão** (o que for lead de fato vai ao funil). **Operação, Jorge Tabeliao → Clientes › Execução** ligados ao cliente (operação interna da casa vai a Gestão).
- Toda tarefa copiada: título, descrição (a "descrição própria" dele incluída), etapa mapeada pelo significado para a etapa da lista de destino (sem equivalente: primeira etapa aberta + nota no mapa), vencimento, prioridade, criada em (preservar a data original), responsável principal, **outros responsáveis** dele escritos num comentário "Também com: …" (o nosso código tem um responsável só), **área** dele escrita como etiqueta, comentários com autor e data, e um primeiro comentário de procedência "Copiado da produção em 19/10/2026 · lista de origem: X".
- **Cliente sempre** (T4): o do vínculo dele convertido, o identificável pelo conteúdo, ou "Root (interno)" para o que é da casa.
- Tarefa concluída em produção entra concluída; nada é apagado no destino além do que nem foi copiado (teste, marketing).
- Entregar **`homolog/copia/mapa-das-tarefas.md`** (fora do git): tarefa → lista de origem → destino → cliente → etapa → motivo.

### C4 — provas e fechamento
- Roteiro `homolog/e2e/copia.mjs` contra a stack `rootos-copia`: login da homologação; contagens por pasta/lista batendo com o mapa; Implantação mostra os cards dos clientes copiados; Funil vivo mostra os leads copiados; um card abre no pop-up com cliente `Partner`, procedência e comentários; Minhas tarefas do Rodrigo lista as dele; nenhuma tarefa de marketing nem de teste existe. Fotos `copia-*.png` (escuro/claro/390), **com dado real: ficam em `homolog/copia/`, fora do git**.
- `homolog/RESULTADO-COPIA.md` (no git, só contagens): o que entrou por destino, o que ficou de fora e por quê, o que o modelo do Lucas tinha que o nosso não representa (áreas, vários responsáveis, natureza cadastro) e como ficou na cópia, e os [a decidir].
- Tag `copia-entrega-20261020`; bundle; stack `rootos-copia` de pé (health 200); `rootos-comercial` intacta.

## Backlog — APAGAR DEPOIS (pedido do Rodrigo)
Quando o Rodrigo terminar de olhar, apagar do Predator: o dump `C:\Users\User\dev\producao\`, o banco `producao_staging`, o banco de destino e os volumes da stack `rootos-copia`, a pasta `homolog/copia/` (mapa e fotos com dado real) e os bundles que tiverem os scripts. O RESULTADO-COPIA traz a lista exata do que foi criado, para a limpeza não deixar nada para trás.
