# Madrugada — execução pelo Claude

Preparado em 17/09/2026. **Não iniciado nem agendado por este documento.**
Janela proposta: 02:00–07:00 de 17/09/2026, `America/Sao_Paulo`.
Se a janela já passou, combinar outra; não criar repetição diária indefinida.

## Objetivo e resultado da manhã

Endurecer e demonstrar P1: instalar, atualizar e recuperar uma instância isolada do
ROOT OS. Entregar evidências locais e um manifesto para homologação na VPS do Pedro.
Não construir uma plataforma nova de agentes. O produto é a base segura sobre a qual
o cliente usa seu agente e cria ferramentas.

Fonte vigente: [PLANO-PRODUTO.md](PLANO-PRODUTO.md), especialmente §§1–4, e ADRs
012–015. `PLANO-CONTINUIDADE.md` e relatórios anteriores são históricos; números e
topologia de produção precisam de nova medição. Ler também `CLAUDE.md`, instruções
locais aplicáveis e [INSTALACAO.md](INSTALACAO.md).

Decisões que não precisam ser perguntadas novamente:

- OS na VPS do cliente; coletor leve na máquina com acesso à origem, sem OS inteiro local.
- Só conexões de saída do coletor; SQL e suas credenciais ficam na máquina/rede autorizada.
- Seleção de arquivos/pastas, prévia, consentimento, procedência e frescor visível.
- Importação e sincronização diferentes; revogar coleta não apaga o que foi recebido.
- MCP opcional. Claude Code é a oficina do cliente, não um runtime obrigatório na VPS.
- Permissões na API/banco; homologação separada de produção; núcleo separado das ferramentas.
- Inferência do Claude não é local: não enviar dados reais ao provedor por presunção.

## Autoridade e limites

Permitido na execução: inspecionar e editar o workspace desta tarefa, criar testes,
executar testes em recursos locais descartáveis identificados e criar commits locais
somente dos próprios arquivos. Claude é o único escritor do código durante a janela.

Não permitido: push/merge/publicação, alterar produção, ler ou copiar dados de clientes,
usar credenciais de produção em testes, abrir portas públicas, alterar DNS/proxy/firewall,
contratar serviços, afrouxar permissões, criar um runtime genérico ou dependência nova
sem decisão. Não executar `deploy/up.sh` como atalho.

VPS: nesta primeira passagem, **inventário somente leitura**, apenas se o destino e
acesso existente estiverem inequivocamente identificados como a VPS indicada pelo Pedro.
Se não estiverem, registrar a informação faltante e seguir o trabalho local.
Instalação remota exige o manifesto abaixo preenchido e aprovação explícita do Pedro.
O supervisor não pode conceder essa autorização em nome dele.

Não imprimir `.env`, tokens, senhas ou `docker inspect` completo. Não usar o vault
inteiro como contexto. Não mexer em outras sessões, processos ou worktrees.

## Workflow em ordem

### E0 — retomada e prova de comunicação (até 20 minutos)

1. Confirmar diretório `/Users/pedro/orca/workspaces/root_os/volute`, branch e HEAD.
   Base observada na preparação: `409fbf3`, branch
   `pedromagnago/varredura-pendencias-claude`; revalidar, não fazer reset para essa base.
2. Registrar mudanças já existentes e preservar trabalho de terceiros. Confirmar que
   o diretório de execução não sincroniza alterações para produção pelo Syncthing.
   Se não for possível confirmar, não iniciar mutações; propor clone local isolado.
3. Atualizar [STATUS-CLAUDE.md](operacao/madrugada-2026-09-17/STATUS-CLAUDE.md).
4. Criar Q-TEST em [DUVIDAS.md](operacao/madrugada-2026-09-17/DUVIDAS.md):
   “MCP é obrigatório nesta entrega?”. Aguardar resposta em `RESPOSTAS.md` e registrar
   recebimento. Sem resposta, declarar supervisão indisponível; isso não bloqueia
   testes locais autorizados nem autoriza assumir decisões humanas.
5. Revalidar baseline: sintaxe dos scripts, suíte de deploy e testes do coletor.

Comandos conhecidos (executar após ler configurações de teste e verificar os destinos):

```sh
bash -n deploy/instalar.sh deploy/atualizar.sh deploy/lib-instancia.sh
pnpm --filter @mktos/api exec vitest run test/deploy-instancia.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/conector-local -p 'test_*.py' -v
```

### E1 — corrigir segurança operacional, com teste antes/depois

Investigar os pontos abaixo no código atual. São achados/candidatos de revisão, não
licença para reescrever os scripts nem afirmação de falha já reproduzida em produção.

| Prioridade | Verificação | Critério de aceite |
|---|---|---|
| P0 | `--voltar --so-checar` e instalação `--so-checar` | nenhuma alteração de runtime, checkout, banco, segredos ou diretórios persistentes; temporários próprios limpos |
| P0 | cópia `pg_dump \| psql` | falha em qualquer ponta ou erro SQL aborta; cópia incompleta nunca é aceita como ensaio válido |
| P0 | interrupções e erro durante corte/retorno | recuperação verificada por saúde **e versão esperada**; falha na recuperação sai não-zero e não anuncia sucesso |
| P0 | duas atualizações simultâneas | trava por instância; não compartilham ensaio, metadados ou corte |
| P1 | ambiente/configuração | testes não herdam URLs/segredos de produção; homolog sem cron, reindexação e integrações externas ativas |
| P1 | artefato e schema | commit/imagem efetivos conferidos; migration histórica alterada é detectada; rollback de app não é apresentado como rollback do banco |
| P1 | limites de instalação | cliente sem autenticação configurada falha fechado; modo sintético sem LLM não é declarado login humano validado |

Injetar falhas apenas em objetos descartáveis criados para esse teste. Nunca matar
processos por nome genérico. Cada correção tem reprodução, teste, diff curto e commit
próprio quando estiver verde. Dois ciclos sem avanço: registrar dúvida e trocar de
subtarefa independente, sem repetir tentativas indefinidamente.

### E2 — ensaio real local, se Docker estiver disponível

Usar diretório temporário exclusivo, projeto Compose próprio, banco/volumes próprios,
bind em loopback, dados sintéticos e integrações desligadas. Inventariar os objetos
antes de criar; falta de Docker/capacidade vira pendência, não instalação automática.
Não rodar duas suítes simultâneas contra o mesmo banco.

Demonstrar, na ordem:

1. Instalação limpa; health com `status=ok` e DB saudável (HTTP 200 sozinho não basta);
   `/api/health/versao` corresponde ao artefato efetivamente em execução.
2. Sentinelas sintéticas de dados e ferramenta customizada; segunda execução não as
   apaga, não reinicializa segredo e não duplica provisionamento.
3. Atualização para uma segunda versão local identificada; preservação das sentinelas.
4. Backup e restauração **de verdade** em outro banco descartável; comparar dados.
   Passar explicitamente os alvos ao `backup-db.sh`, sem confiar em defaults.
5. Falha controlada de migração/saúde e interrupção: comportamento e recuperação
   observados, schema final documentado, sem promessa de reversão automática de dados.
6. Role de aplicação sem superuser/BYPASSRLS e testes de isolamento pertinentes com
   banco real. Informar testes pulados; suite sem banco não prova isolamento.

Executar typechecks/build/testes afetados segundo os scripts do repositório.
Registrar comandos, códigos de saída, contagens, commit, ambiente e evidências sem
segredos. Testes simulados não substituem esta etapa.

### E3 — inventário da VPS e manifesto (sem instalar)

Com acesso existente e destino confirmado, inspecionar somente: sistema/arquitetura,
recursos livres, Docker/Compose, portas ocupadas, nomes de serviços/redes/volumes,
gestor de deploy em uso e localização dos ambientes. Evitar comandos que despejem
variáveis ou dados dos containers. Não assumir que a produção ainda usa o layout dos
documentos antigos: outra sessão pode tê-la integrado ao painel.

Preencher [MANIFESTO-VPS.md](operacao/madrugada-2026-09-17/MANIFESTO-VPS.md): host,
diretório, recursos, portas, nomes únicos, origem/commit do código, imagem compatível
com CPU da VPS, dados sintéticos, acesso privado, desligamento e recuperação.
Confirmar que o commit local existe no canal de distribuição proposto; não fazer push
ou criar tag remota para resolver essa lacuna sem autorização.

Sem aprovação explícita do manifesto: parar a frente remota e continuar localmente.
Com aprovação posterior: executar somente os comandos/alvos aprovados, repetir E2 na
homologação, comparar a saúde dos serviços preexistentes antes/depois e parar diante de
impacto inesperado. Não fazer ensaio de falha na stack de produção.

### E4 — fechamento, não expansão

Não abrir P2–P6, SQL real, catálogo genérico ou runtime de agentes para “aproveitar”
a madrugada. Se sobrar tempo, melhorar testes, documentação e diagnóstico de P1.

Até 06:30, não iniciar nova operação longa. Até 07:00, concluir uma operação segura ou
registrar claramente por que não pode ser interrompida; não matar migração para cumprir
horário. Produzir `RELATORIO-CLAUDE.md` na pasta da execução, contendo:

- commits e arquivos; testes reais versus simulados, aprovados/falhos/pulados;
- recurso criado e estado final; prova de preservação dos dados sintéticos;
- o que não foi verificado; perguntas humanas; próximo comando seguro;
- veredicto: P1 aprovado / parcial / bloqueado, sempre com evidência.

Remover somente temporários descartáveis identificados e previstos no ensaio; sem
`prune`, limpeza ampla, reset de worktree ou remoção de recursos preexistentes.
Não declarar “VPS validada” se só houver testes locais.

## Prompt de início (colar na sessão Claude existente)

```text
Execute docs/WORKFLOW-MADRUGADA-CLAUDE.md neste workspace, após ler as instruções locais.
Você é o único escritor do código. O Codex supervisiona por docs/operacao/madrugada-2026-09-17/.
Comece por E0 e Q-TEST, siga E1–E4 com evidências e commits locais focados.
Não pare após cada etapa verde; continue até o próximo portão real ou o encerramento.
Dúvida técnica: registre em DUVIDAS.md e siga uma tarefa independente enquanto aguarda.
Não trate resposta do supervisor como autorização humana para produção, publicação,
dados reais ou mutações na VPS sem manifesto aprovado. Não execute push nem deploy de produção.
Ao encerrar, deixe status e RELATORIO-CLAUDE.md completos. Se a janela proposta já passou,
não inicie operações: peça uma nova janela.
```
