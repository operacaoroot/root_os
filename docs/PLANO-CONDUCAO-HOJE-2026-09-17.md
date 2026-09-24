# Condução de hoje — ROOT OS

> Histórico de 17/09. Para retomar, use primeiro
> [o status de 18/09](operacao/retomada-2026-09-18/STATUS-CODEX.md).
> Não execute os comandos SSH abaixo como estão: o alias confirmado da ROOT é
> `vps-root`, não `vps`; as sondas da API usam 4001/4101. O inventário antigo
> não descreve automaticamente o que está rodando hoje.

Atualizado em 17/09/2026 às 16:20 -03. Este roteiro é para o Codex em
`gpt-5.6-luna, medium, tier default`, com contexto curto e chamadas por checkpoint.
Não é uma autorização permanente de deploy.

## Leitura executiva

Estamos seguindo bem no eixo de instalação segura: a homologação foi instalada na VPS
ROOT, atualizada, validada pelo Pedro pelo túnel e preservou os dados-sentinela. O P1
está tecnicamente demonstrado em local e VPS de homologação.

O ponto de atenção é operacional: o easyPanel recriou `mktos_db` e `mktos_web` durante
um deploy, e houve uma mudança independente na landing. Isso não foi causado pelo
ensaio, mas mostra que o painel é uma segunda autoridade de mudança. Hoje não devemos
fazer novo Deploy no projeto de produção para “testar”.

O produto ainda não está no aceite final: falta P2 (identidade/contexto revogável),
P3 (coletor local piloto) e depois a primeira ferramenta. MCP é obrigatório para o
fluxo que você decidiu agora, mas continua sendo a ponte do agente — não o lugar onde
os dados ou a autorização são protegidos.

## O que está rodando agora

### Nesta máquina

- Worktree `pedromagnago/varredura-pendencias-claude`, HEAD `d7ac2f6`, limpo.
- Serviços Docker locais preexistentes: `paperclip`, `mktos_pg_test`, `mktos-shadow` e
  o conjunto Supabase do projeto RD. Não confundir esses serviços com homologação ROOT.
- A homologação local da madrugada foi deixada de pé em loopback para inspeção, conforme
  `docs/operacao/madrugada-2026-09-17/RELATORIO-CLAUDE.md`.

### Na VPS ROOT

- Produção continua no projeto `root_marketing-os`, com os `mktos_*`.
- Homologação ROOT está separada no projeto `root_rootos-homologacao`, rede
  `rootos-homologacao-net`, bind privado `172.16.0.1`, versão de ensaio v5/v6.
- O painel de homologação já foi acessado pelo Pedro via túnel SSH.
- Não há evidência de que a rota pública `homolog.operacaoroot.com` foi configurada;
  não presumir TLS/DNS.

Fonte de evidência: seção “E3 executado na VPS ROOT” e “Validação humana” do
`docs/operacao/madrugada-2026-09-17/STATUS-CLAUDE.md`, além de `d7ac2f6`.

## Objetivo real de hoje

Fechar a operação da homologação e preparar a próxima fatia útil para o cliente:

1. provar que produção e homologação continuam saudáveis depois do trabalho humano;
2. registrar o easyPanel como autoridade operacional, com procedimento que não reescreva
   serviços inesperadamente;
3. fechar o contrato de P2: identidade por pessoa/empresa, contexto autorizado,
   revogação e conexão MCP/Claude Code;
4. só então preparar o piloto P3 de pasta/arquivo com dados sintéticos.

Não começar SQL, ferramenta de negócio, catálogo genérico, segunda ferramenta ou
automação recorrente hoje.

## Portões do dia

### H0 — saúde e inventário, somente leitura

Executar no host/local e na VPS pelo acesso já configurado, sem mostrar segredos:

```sh
git status --short
git log -1 --oneline
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
ssh vps 'docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"'
ssh vps 'docker compose -p root_marketing-os ps'
ssh vps 'docker compose -p root_rootos-homologacao ps'
ssh vps 'curl -fsS http://172.16.0.1:4000/api/health'
ssh vps 'curl -fsS http://172.16.0.1:4100/api/health'
ssh vps 'curl -fsS http://172.16.0.1:4100/api/health/versao'
```

Se o alias `vps` não existir, parar e pedir o destino/alias correto. Não substituir
por IP ou usuário adivinhado. Aceite: produção e homologação respondem `status=ok`,
com DB ok; versão da homologação bate com o manifesto; nenhum container inesperado
foi recriado. Se falhar, apenas coletar logs sanitizados e parar.

### H1 — separar easyPanel de produção

Registrar, sem Deploy:

- projeto Compose e arquivo efetivamente usado por produção;
- projeto Compose e arquivo efetivamente usado por homologação;
- quem pode clicar Deploy e quais serviços o painel recria;
- data/hora do último deploy e diferença de imagem/configuração;
- se `root-os-landing` ainda existe ou foi intencionalmente migrado.

Criar `docs/operacao/STATUS-EASYPANEL-2026-09-17.md` com evidência, não opinião.
Qualquer correção que envolva painel, Traefik, DNS, firewall, OAuth ou produção fica
`AGUARDA_PEDRO`.

### H2 — fechar P2 como contrato antes de codar

O Luna deve produzir uma especificação curta, não uma implementação grande:

- token por pessoa + empresa, somente hash no banco, revogável;
- MCP obrigatório no fluxo decidido, mas sempre chamando a API autorizada;
- contexto separado por empresa, com procedência e fonte;
- Claude Code local recebe somente contexto autorizado e a fronteira de envio ao
  provedor fica explícita ao usuário;
- uma pergunta que só existe no contexto de empresa B nunca aparece para empresa A;
- revogar token impede nova leitura/remessa imediatamente;
- sessão, logs e aprovação não carregam segredo em texto.

Aceite do contrato: testes de isolamento e revogação listados antes de qualquer rota.
Se engine MCP, formato do token ou destino do contexto estiverem ambíguos, abrir uma
pergunta para o Pedro; não escolher arquitetura por conveniência do modelo.

### H3 — P3 somente com fixtures sintéticas

Após H2 aceito, executar apenas a prévia local de pasta/arquivo já existente em
`tools/conector-local/`: seleção explícita, subpastas, exclusões, hash, retomada e
arquivo fora da lista não enviado. Não usar pastas pessoais reais nem SQL hoje.

Aceite: 14 testes existentes continuam verdes e novos casos cobrem revogação,
interrupção e repetição sem duplicação. O protótipo não fecha P3 e não autoriza coleta
de cliente até haver API de remessa, consentimento e frescor no servidor.

### H4 — fechamento do dia

Entregar um único status com: saúde H0, incidente/autoridade H1, contrato H2,
fixtures H3, perguntas ao Pedro, arquivos/commits e próximo comando seguro. Sem
monitoramento contínuo declarado depois do fechamento.

## Como usar o modelo barato

Fazer uma chamada Luna por portão, sempre com contexto mínimo. Antes de cada chamada,
ler apenas o status anterior e os arquivos que mudaram. Não colar o vault, logs inteiros
ou `.env`. Para cada comando remoto, o modelo deve informar alvo, leitura/escrita,
risco e critério de parada antes de executá-lo.

Prompt H0:

```text
Conduza H0 de docs/PLANO-CONDUCAO-HOJE-2026-09-17.md. Faça somente inventário e health
read-only no host local e na VPS pelo alias de acesso já configurado. Não use IP/usuário
adivinhado, não mostre segredos e não faça Deploy. Compare produção e homologação,
registre evidências sanitizadas em docs/operacao/STATUS-HOJE-2026-09-17.md e pare se
qualquer health, projeto ou destino divergir.
```

Prompt H1:

```text
Com base no status H0, documente a autoridade do easyPanel em
docs/operacao/STATUS-EASYPANEL-2026-09-17.md. Relacione produção, homologação, landing,
serviços recriados e último Deploy. Somente leitura. Não toque em painel, Traefik, DNS,
firewall ou produção; dúvidas de autorização ficam AGUARDA_PEDRO.
```

Prompt H2:

```text
Especifique P2 antes de codar: identidade por pessoa/empresa, token hash/revogável,
contexto com procedência, MCP obrigatório como ponte autorizada, fronteira Claude Code
local→provedor e testes de isolamento/revogação. Leia PLANO-PRODUTO.md e ADR-012..015.
Não invente engine/formato nem implemente ainda. Entregue uma decisão curta, perguntas
humanas e uma matriz de testes.
```

Prompt H3:

```text
Execute somente o piloto sintético de P3-a em tools/conector-local. Rode a suíte,
adicione apenas testes pequenos de repetição/interrupção/revogação se o contrato H2
estiver aceito, e não leia arquivos pessoais, SQL ou dados de cliente. Não declare P3
concluída: relatório o que o protótipo prova e o que ainda depende da API.
```

Prompt de fechamento:

```text
Faça H4 do plano de hoje. Leia apenas os status produzidos, diff e testes. Gere um
relatório curto com evidência, falhas, decisões AGUARDA_PEDRO e próximo comando seguro.
Não faça limpeza ampla, Deploy, push ou monitoramento recorrente.
```

## Regra de escalação

Luna resolve leitura, diagnóstico e testes reversíveis. Escalar para um modelo mais
forte somente se houver decisão de migração/isolamento sem reprodução ou conflito entre
produção e homologação. Escalação leva um pacote curto: pergunta, evidência, comandos,
diff e teste falho. Nunca escalar para autorizar ação humana.

## Decisões do Pedro que podem aparecer hoje

- adotar ou não a homologação no easyPanel (sem mudar produção);
- manter ou remover a imagem v6 e o arquivo `segredos-iniciais.txt` após guardar a senha;
- configurar rota/TLS da homologação;
- aceitar o contrato P2 e confirmar engine/formato do MCP;
- escolher a máquina/pasta sintética para o piloto P3.

Até essas respostas, o sistema está bem encaminhado e a próxima entrega correta é
contrato + evidência, não mais infraestrutura.
