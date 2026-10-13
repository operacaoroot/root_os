# RESULTADO · Cockpit do lead (módulo comercial) · homologação no Predator

> Estado: **FINAL da rodada 5**, escrito às 19:30 e atualizado às 20:25 de 13/10/2026 (depois dos P3). Branch `comercial/cockpit-homolog`, tag `comercial-entrega-20261013`, base `main` 5260924. Bundle em `C:\Users\User\dev\rootos-comercial.bundle` (`main..comercial/cockpit-homolog`).
> Registro linha a linha em `homolog/progresso.md`. Laudos da revisão adversarial em `homolog/revisao/lane-*.md`. Como subir e operar: `homolog/README.md`. O que o módulo é: `docs/comercial/COCKPIT.md`.

## 1. O que funciona

### Por lane

| Lane | Estado | O que entrega |
|---|---|---|
| 0 · Contrato | pronta | `packages/shared/src/comercial.ts` (etapas, saídas, eventos, decisões, schemas, projeções); `comercial/eventos.ts` e `comercial/portoes.ts` puros; migrations aditivas com RLS; `db:diff` limpo |
| A · Espinha | pronta, revisada | ficha projetada do fio (nenhuma tela grava campo), configuração por empresa, fila de decisões que aplica o padrão escrito ao vencer, reações idempotentes, rotina `comercial.relogio`, `Lead.status` derivado |
| B · Sala e canal | pronta, revisada | sala `/s/[token]` (token só em hash e cifrado), rotas `/sala/*` com limite por origem, WhatsApp por porta (`simulado`, `evolution`, esqueleto `meta`), simulador, textos M1 a M8 versionados |
| C · Cockpit | pronta, revisada | telas 03, 04, 05, 06, 10, 11, 12 e 13; NAV; escuro, claro e 390 px |
| D · Dinheiro e assinatura | pronta, revisada | portas Asaas e ZapSign com dublês e página de simular, fechamento com chave (5 escritas, não duplica), contrato vivo, régua de cobrança |
| E · Inteligência | pronta, revisada | `stub`, `ponte` e `anthropic`; leitor de ata, construtor e revisor de proposta, assistente da dúvida, vigia das 08:00, relator da quinta, autonomia A0 a A3 com efeito |
| F · Dados e provas | pronta | `db:seed:comercial` com as oito empresas (idempotente), roteiro HTTP da jornada, 35 screenshots, `homolog/README.md`, `docs/comercial/COCKPIT.md` |
| G · Revisão adversarial | feita e consertada | todos os P1 e P2 dos cinco laudos consertados, cada um com prova em teste (seção 6) |

### Por tela

| Tela | Rota | O que faz |
|---|---|---|
| 03 fila de decisões | `/comercial` | decisões com opções, padrão escrito e prazo; "sem prazo" quando o prazo está desligado; responder pede `aprovacoes.decidir` |
| 04 funil | `/comercial/funil` | leads por etapa, próxima ação, arraste bloqueado que mostra o portão e o que falta |
| 05 fio do lead | `/comercial/lead/[id]` | o fio de eventos legível, por dia, com dia e hora de São Paulo |
| 06 depois da sessão | `/comercial/lead/[id]/sessao` | sobe a ata (até 400 mil caracteres, aviso acima do teto), diagnóstico com minuto, aprovação da mesa sobre a versão lida, proposta e o seu estado |
| 09 celulares simulados | `/comercial/simulador` | o celular do lead e da mesa; só existe com o provedor simulado |
| 10 fechamento | `/comercial/lead/[id]/fechamento` | as cinco escritas e "rodar de novo" |
| 11 contrato vivo | `/comercial/contratos` | parcelas, régua de cobrança, entregas, marcos; saúde nula até a fórmula existir |
| 12 torre | `/comercial/torre` | automações com autonomia, acerto de 30 dias, premissa conferida (ou "não conferida"), custo de IA honesto ("sem medida" para stub e ponte) |
| 13 relatório | `/comercial/relatorio` | funil, conversão, perdas, propostas vencendo, leitura do relator sem número escrito pelo modelo |
| sala | `/s/[token]` | conversa, diagnóstico (só o aprovado), proposta com leitura por bloco, dúvida, ajuste (até o aceite), aceite, pagamento, contrato, começo |
| /atendimento | `/atendimento` | as liberações R3 e R4; a proposta tem cartão próprio com o conteúdo que o hash prende |

## 2. Como demonstrar em 10 minutos

- Cockpit: `http://100.95.41.124:3010` (Tailscale) ou `http://127.0.0.1:3010`, `/login` por e-mail e senha.
- Logins, todos com a `ADMIN_PASSWORD` de `homolog/.env.homolog` (fica só na máquina):
  - `mesa@root.homolog`: alçada responsável, libera R3 e decide na fila.
  - `socio@root.homolog`: titular, assina R4 com senha e motivo.
  - `admin@marketing-os.local`: administrador; nas jornadas é o sócio da conta e o signatário cadastrado pela Root.
- Links das salas: os oito links `/s/<token>` das empresas de demonstração foram impressos pela semente desta rodada em `homolog/.tmp/seed-r5.log` (pasta fora do git, de propósito: o token é a chave da sala). Rodar `db:seed:comercial` de novo devolve os mesmos links. O link da sala do lead criado pela jornada sai no fim de `node homolog/e2e/jornada-docker.mjs`.
- Dublês: Asaas `http://100.95.41.124:4011` (simular Pix), ZapSign `http://100.95.41.124:4012` (simular assinatura).

Sequência:

1. Entre como `mesa@root.homolog`. `/comercial`: a fila de decisões. As duas decisões da semente (Studio Lume, ponto zero; Construtora Alicerce, pedido de 8%) já venceram em 4 h (valor de homologação) e o relógio aplicou o padrão escrito, que aparece no fio de cada lead. Para ver a fila com decisões abertas, rode a jornada do passo 4 (ela abre e responde as suas) ou semeie num banco zerado com `COMERCIAL_SEED_DECISAO_HORAS=72`.
2. `/comercial/funil`: as empresas por etapa. Tente arrastar um cartão: o portão diz o que falta.
3. Abra a Construtora Alicerce: o fio do primeiro contato à proposta lida, com a decisão que levou à liberação a proposta com o quadro de exemplo.
4. No terminal: `node homolog/e2e/jornada-docker.mjs` (10 a 90 s). Um lead novo percorre do "oi" ao contrato vivo e o roteiro imprime cada toque humano.
5. `/comercial/contratos`, `/comercial/torre`, `/comercial/relatorio` (troque 7 e 30 dias e gere de novo).
6. `/atendimento`: o cartão da proposta mostra o conteúdo que a liberação prende.

## 3. Números do e2e (rodada 5, imagem final, `homolog/provas/jornada-docker.json`)

- **13 toques humanos**, 10 ações do cliente, 29 de 53 fatos automáticos (15 sozinhos pelas reações e pelo relógio, 14 efeitos liberados por uma pessoa), funil +1 fechado por execução. Tempo: 9,2 s a 104 s (o maior valor é a véspera esperando o tique de 1 min do relógio). Última execução na imagem final: 104,3 s, funil 7 → 8.
- Os 13 toques:
  1. mesa libera a M1 (R3);
  2. titular assina a M2 (R4 pelo sinal `volume_atipico`, várias jornadas na mesma hora);
  3. titular assina a M3 (idem);
  4. sócio conduz a sessão e sobe a ata (humano por desenho);
  5. mesa aprova o diagnóstico;
  6. **mesa leva à liberação a proposta com o quadro de custos de exemplo (novo nesta rodada, E-3: some com o dado real de custos do cliente)**;
  7. titular assina a publicação da proposta;
  8. titular assina a M4;
  9. mesa decide o pedido de ajuste;
  10. titular assina a cobrança (R4);
  11. titular assina o envio do contrato (R4);
  12. sócio assina o contrato pela Root (ZapSign);
  13. titular assina o fechamento (R4).
- Meta do desenho: 2 toques (conduzir a sessão e assinar pela Root) mais as decisões de um toque. A distância é a régua: R3 e R4 não saem sem outra pessoa. Os toques 2, 3 e 8 voltam a R3 (mesa) fora do sinal `volume_atipico`.
- `apps/api/test/comercial-jornada-e2e.test.ts`: 10 casos verdes, toques fixados por chave.

## 4. Capacidades e níveis

Delta do produto em `packages/policy/politica-marketing-os.json`, **versão 1.8.1** (semeada em `rootos_comercial`, `rootos_comercial_test` e `rootos_comercial_test_rls`). Nenhuma regra afrouxada.

| Capacidade | Nível | Observação |
|---|---|---|
| `whatsapp.mensagem.enviar` | R3 | já existia |
| `comercial.whatsapp.enviar` | R3 | a mensagem escrita por pessoa vai à porta em nome dela; o link da sala nunca em claro nos argumentos |
| `comercial.proposta.publicar` | R3 | o cartão de /atendimento mostra o conteúdo inteiro e confere o hash |
| `comercial.cobranca.criar` | R4 | argumentos levam o devedor (documento, razão social, e-mail); o efeito recusa divergência |
| `comercial.contrato.enviar` | R4 | campos do cliente escapados no contrato |
| `comercial.fechamento.executar` | R4 | só com a 1ª parcela paga e as duas assinaturas da versão aceita |

## 5. Interruptores (K08) e padrões

Em `ComercialConfig`, por empresa. Mudar pede `aprovacoes.decidir`, recusa conta de máquina e grava `comercial.config.alterada` no RASTRO com o antes e o depois.

- `envioAutomatico` (K08-1): **falso**. Ligado, abre a janela de veto antes dos oito textos; o R3 continua indo à fila (a régua não deixa R3 sair sem aprovação).
- `fechamentoAutomatico` (K08-2): **falso**. Ligado, o fechamento vai à porta no fim da janela de veto, salvo veto; o R4 continua.
- `silencioAprova` (K08-3): **falso**. Ligado, a proposta dentro da tabela com laudo limpo é agendada; a ida à porta continua R3.
- `autonomia` por automação, agora com 12 automações (entrou `assistente_da_proposta`): padrão = degrau vigente; A0 pula e registra (no assistente, A0 manda a dúvida à pessoa); R3 e R4 param em A2.
- Números da régua (`janelaDeVetoMinutos`, `fupLeuDias`, `fupSilencioDias`, `prazoDiagnosticoDiasUteis`, `validadePropostaDias`, `leadParadoDias`, `decisaoExpiraHoras`, `horaPublicacaoProposta`, `cobrancaSemWebhookDias`, `efeitoRetidoHoras`): nulo = `[a decidir]` = desligado; a homologação preenche no seed com `valoresDeHomologacao: true`.
- Variáveis só da homologação: `QUADRO_DE_CUSTOS_EXEMPLO` (sem ela a proposta sai sem quadro e o revisor aponta), `PONTE_MODELO_TOKEN` (a ponte não sobe sem ele), `WHATSAPP_PROVEDOR=simulado`.

## 6. Revisão adversarial: o que foi consertado

Todos com prova em teste e commit próprio (a lista completa com hora está em `homolog/progresso.md`).

- **P1:** B-1, B-2, D-3 (rodadas anteriores); **D-1/C-1** link de assinar pela Root só cifrado e só ao signatário titular com senha; **D-2** devedor nos argumentos da cobrança; **E-1** ponte sem shell, sem ferramentas, sem MCP e com token (ensaio contra o CLI real: a injeção não roda e o prompt de sistema chega inteiro); **E-2** a resposta da dúvida só vai direto quando é frase do sistema tirada da proposta, o resto vai a uma pessoa pela decisão `aprovacao_de_envio`; **E-3** quadro de exemplo só com a variável de homologação e como apontamento.
- **P2:** A-1, A-2, B-3, B-4, B-5, B-6, B-7, C-2 a C-9, D-4, D-5, D-6, D-7, E-4 a E-13, E-15. E-14 resolvido pelo A-2.
- **P3 consertados (depois das 19:30):** A-3, A-4 (régua ganhou `geladeiraVoltaDias`, nulo = [a decidir]: a próxima ação pede a data a uma pessoa), A-5, A-7 (onde a empresa está à mão), B-10, B-11, C-10 a C-18, C-19, C-20 (API e tela), C-23, D-10 (estorno e chargeback; o fato da 1ª parcela tem o nome da forma: `pix.pago`, `boleto.pago`, `cartao.pago`), D-12, E-17 a E-20, E-22, E-23, E-24, E-26. Migration nova `20261013300000_comercial_geladeira_volta` (uma coluna anulável), aplicada nos três bancos.
- **P3 não tratados:** A-6 (ficou coberto por E-24), B-8 (teto por origem atrás do Traefik: medir), B-9 e B-12 (texto aprovado do M3 e o glifo da sala: decisão da mesa), B-13 (registro), C-21 (dois funis no menu: decisão de produto), C-22 (fins de linha: registro), D-8, D-9 (variáveis do compose de produção), D-11, E-21 (coberto por C-5), E-25 (teto da ponte já entrou no E-1); A-7 ainda sem empresa em `aceiteDoLead`, `aceiteDaCobrancaAprovada`, `tiposNoFio` e `manifesto`; B-11 ainda escreve no GET para visita de gente (a página não tem POST de visita); B-10 sem teto de data do kickoff ([a decidir]).

## 7. Pendências com estado exato

- **Testes vermelhos do baseline** neste Windows, iguais aos da `main` 5260924, não consertados: `documentacao`, `import-clickup-normalize`, `import-clickup-reconciliar`, `import-clickup-work`, `pauta-episodio`, `root-midia`, `vault-colecao`, `vault-pertenca` (permissão de arquivo, link simbólico, git).
- **Suíte inteira da API, rodada sozinha na máquina às 20:17** (863 arquivos, 4228 casos): **4152 verdes, 5 pulados (os de sempre), 71 vermelhos, todos do baseline acima**. Com outra carga na máquina (build da imagem, outra suíte), casos longos estouram prazo: as três suítes do comercial que percorrem a jornada ganharam prazo de 30 s; `pauta-lote-da-semana` e `pauta-dm-automatica` (fora do comercial) ainda podem cair sob carga e passam sozinhas. Web 65 arquivos 857/857, política 101/101, isolamento 412/412 com o papel restrito, `db:diff` sem diferença, `typecheck` e `typecheck:test` limpos, smoke OK (a primeira tentativa do smoke caiu com o código de falha 0xC0000409 do Windows; a segunda passou limpa).
- **Relatório da semana** regenerado na imagem final: 7 dias, 13 leads e 8 fechados; 30 dias, 17 leads e 8 fechados. Vigia: 13 premissas conferidas, 0 quebradas.
- **Comentário desatualizado** em `apps/api/src/integrations/conectores.ts:247-251`: diz que o grupo sai por `comercial.whatsapp.enviar`; hoje ele sai no efeito do fechamento, consultando o interruptor do WhatsApp (D-6).
- **v2 aceita sobre cobrança da v1:** `criarCobrancaDoAceite` responde "reaproveitada"; o D-4 impede o fechamento errado, mas esse lead não fecha até alguém tratar na mesa.
- **Trava da cobrança (D-7):** a transação que a segura fica aberta enquanto o Asaas responde, até 180 s.
- **Notas do vigia e do relatório (E-13):** levam selo HMAC; nota editada à mão vira ausente. As notas gravadas antes do selo leem ausente até a próxima passagem.
- **M7** (link de assinatura ao cliente) fica na fila R3 na jornada; a sala já mostra o link.
- **Sinal `volume_atipico`:** várias jornadas na mesma hora sobem as mensagens a R4 (titular, senha e motivo); numa demonstração ao vivo a mesa deixa de liberar sozinha.
- **Sócio titular sem `leads.editar`:** o papel `diretor` não sobe ata nem opera o cockpit; a jornada usa o admin como sócio da conta.
- **A jornada em Docker** depende de horário: a M3 só sai na véspera (rode depois das 10h de São Paulo num dia que antecede dia útil).
- **Commit `aa06b49`**: é o commit automático do lançador quando o limite da conta cortou uma lane; a mensagem diz D-1/C-1, mas o conteúdo é o E-15 em curso, completado depois em `42fb604`. O histórico não foi reescrito.
- **Worktree temporária** `C:/Users/User/dev/mos-d2wt` (lane D-2) ficou na máquina; `git worktree remove C:/Users/User/dev/mos-d2wt` a remove (não apagada pela regra da casa).
- **Screenshots** em `homolog/provas/` refeitos às 20:20 contra a imagem final em Docker (33 arquivos: escuro, claro e 390 px). As telas 06c e 06d (sessão exercida pela tela) são da rodada 3.

## 8. Falta do Rodrigo

- Chave Anthropic válida (hoje `stub`; a `ponte` serve à demonstração pela assinatura do Claude Code desta máquina).
- Conta Asaas sandbox e conta ZapSign com API (hoje os dublês).
- Número de WhatsApp e API da Meta (Cloud API e Flows), ou a instância Evolution da Root.
- Modelo de contrato da Root (hoje `homolog/fixtures/contrato-modelo.md`, com lacunas `[a decidir]`: razão social, CNPJ e endereço da Root, escopo, multa e juros, vigência, rescisão, LGPD, foro, quem assina pela Root).
- Quadro de custos de terceiros real por cliente (hoje o exemplo do mapa, R$ 180 e R$ 340, marcado e apontado).
- Decisões K08: os três interruptores e a autonomia de cada automação.
- Números da régua: dias do follow-up, prazo do diagnóstico, validade da proposta, prazo das decisões, janela de veto, hora de publicação, prazo sem webhook, efeito retido.
- Fórmula da saúde do cliente, taxa da previsão do mês, câmbio para o custo de IA em reais.
- Preço do Fable 5.1 em `preco.ts` (hoje a ponte grava custo 0 com `custoDesconhecido`).
- Quem assina pela Root, quem entra no grupo do cliente, texto dos avisos de cobrança, agenda real da Root.
- Papel do sócio no comercial (`diretor` com ou sem `leads.editar`).
