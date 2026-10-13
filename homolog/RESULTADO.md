# RESULTADO · Cockpit do lead (módulo comercial) · homologação no Predator

> Estado: **PROVISÓRIO**, escrito às 18:30 de 13/10/2026 no começo da rodada 5. Ele é reescrito no fim da rodada; se a sessão for cortada, este é o retrato fiel até o commit `a12ad71` mais o que estiver na seção "Rodada 5" abaixo.
> Branch `comercial/cockpit-homolog`. Base `main` 5260924. Registro linha a linha em `homolog/progresso.md`; laudos da revisão adversarial em `homolog/revisao/lane-*.md`.

## 1. O que funciona, por lane

| Lane | Estado | O que entrega |
|---|---|---|
| 0 · Contrato | pronta (tag `comercial-onda-0`) | `packages/shared/src/comercial.ts` (etapas, saídas, eventos, decisões, schemas das rotas, tipos das projeções); `comercial/eventos.ts` e `comercial/portoes.ts` puros; migration aditiva com RLS; `db:diff` limpo |
| A · Espinha | pronta | `ComercialFicha` projetada dos `LeadEvent` (nenhuma tela grava campo), `ComercialConfig`, `ComercialDecisao` (vence e aplica o padrão escrito), reações K02 idempotentes por `(eventoId, reacao)`, rotina `comercial.relogio`, `Lead.status` derivado da etapa |
| B · Sala e canal | pronta | `SalaDoCliente` (token só em hash e cifrado), rotas `/sala/*` com rate limit, página `/s/[token]` com os cinco estágios, porta WhatsApp (`simulado`, `evolution`, esqueleto `meta`), `/comercial/simulador`, textos M1 a M8 versionados |
| D · Dinheiro e assinatura | pronta | portas de cobrança (Asaas) e assinatura (ZapSign), dublês `homolog/mocks/asaas` e `homolog/mocks/zapsign` com página de simular e webhook, `fechamento.service.ts` com chave `fech-<leadId>-v<n>` (5 escritas, roda duas vezes sem duplicar), contrato vivo e régua de cobrança |
| E · Inteligência | pronta (fases 1 e 2) | providers `stub` e `ponte`; leitor de ata → diagnóstico com minuto; construtor e revisor de proposta; assistente da proposta; torre (`GET /comercial/torre`, vigia das 08:00); relatório da semana (relator da quinta 18:00); autonomia A0 a A3 com efeito |
| C · Cockpit | pronta | telas 03 fila, 04 funil (arraste bloqueado), 05 fio, 06 pós-sessão, 10 fechamento, 11 contrato vivo, 12 torre, 13 relatório em `/comercial/*`; NAV; escuro, claro e 390 px; 35 screenshots em `homolog/provas/` |
| F · Dados e provas | parcial | `db:seed:comercial` com as oito empresas fictícias (idempotente, recusa produção); roteiro HTTP da jornada `homolog/e2e/jornada-docker.mjs`; screenshots. **Falta** `homolog/README.md` e `docs/comercial/COCKPIT.md` |
| G · Revisão adversarial | feita sobre A, B, C, D, E | P1 B-1, B-2, D-3 consertados e commitados; D-1/C-1 em conserto (sem commit no início da rodada 5); D-2, E-1, E-2, E-3 abertos no início da rodada 5 |

## 2. Como demonstrar em 10 minutos

Endereços (Tailscale; trocar por `127.0.0.1` na própria máquina):

- Cockpit: `http://100.95.41.124:3010` → `/login`, caminho por e-mail e senha.
- Logins: `admin@marketing-os.local` (admin), `mesa@root.homolog` (alçada responsável), `socio@root.homolog` (titular). Senha: `ADMIN_PASSWORD` de `homolog/.env.homolog` (fica só na máquina).
- Celulares simulados: `http://100.95.41.124:3010/comercial/simulador`.
- Sala do cliente: `http://100.95.41.124:3010/s/<token>`. Os oito links das empresas de demonstração saem impressos no fim de `pnpm --filter @mktos/api db:seed:comercial` (idempotente; a segunda passagem devolve os mesmos links). Token só existe em hash e cifrado no banco: não há como lê-lo por SQL.
- Dublês: Asaas `http://100.95.41.124:4011` (simular Pix), ZapSign `http://100.95.41.124:4012` (simular assinatura).

Sequência:

1. Entrar como `mesa@root.homolog` e abrir `/comercial` (fila de decisões, tela 03): Studio Lume (ponto zero) e Construtora Alicerce (pedido de 8%).
2. `/comercial/funil` (tela 04): as oito empresas por etapa; tentar arrastar mostra o portão e o que falta.
3. Abrir a Construtora Alicerce (tela 05, o fio): eventos do primeiro contato à proposta lida três vezes.
4. Jornada nova de ponta a ponta: `node homolog/e2e/jornada-docker.mjs` (14 a 84 s; grava `homolog/provas/jornada-docker.json`) cria um lead, passa por formulário, horário, ata, diagnóstico, proposta, leitura, ajuste, aceite, Pix e assinatura nos dublês, fechamento e contrato vivo.
5. `/comercial/contratos` (tela 11), `/comercial/torre` (tela 12), `/comercial/relatorio` (tela 13).

## 3. Números do e2e (rodada 3, `homolog/provas/jornada-docker.json`)

- **12 toques humanos**, 10 ações do cliente, 28 de 51 fatos automáticos (14 sozinhos, 14 efeitos liberados pela fila), funil +1 fechado por execução, 14 a 84 s por execução (a espera é o tique de 1 min do relógio para a M3).
- Meta do desenho: 2 toques (conduzir a sessão e assinar pela Root) mais as decisões de um toque. Os toques a mais são as liberações da fila exigidas pela régua (R3 do WhatsApp e da proposta, R4 da cobrança, do contrato e do fechamento); a lista por chave está em `apps/api/test/comercial-jornada-e2e.test.ts`.

## 4. Capacidades e níveis

| Capacidade | Nível | Observação |
|---|---|---|
| `whatsapp.mensagem.enviar` | R3 | já existia |
| `comercial.whatsapp.enviar` | R3 | envio ao lead pela porta, agente prepara e pessoa libera |
| `comercial.proposta.publicar` | R3 | |
| `comercial.cobranca.criar` | R4 | titular, senha e motivo |
| `comercial.contrato.enviar` | R4 | |
| `comercial.fechamento.executar` | R4 | só com a 1ª parcela paga e as duas assinaturas no fio |

O sinal `volume_atipico` sobe as mensagens a R4 quando a jornada roda várias vezes na mesma hora.

## 5. Interruptores (K08) e padrões

Todos em `ComercialConfig`, padrão = regra vigente (desligado). A virada é decisão da mesa.

- `envioAutomatico` (K08-1): falso. Ligado, abre a janela de veto; o R3 continua indo à fila.
- `fechamentoAutomatico` (K08-2): falso.
- `silencioAprova` (K08-3): falso. Ligado, o silêncio só agenda a ida à porta; o R3 é mantido.
- `janelaDeVetoMinutos`, `fupLeuDias`, `fupSilencioDias`, `prazoDiagnosticoDiasUteis`, `validadePropostaDias`, `leadParadoDias`, `decisaoExpiraHoras`, `horaPublicacaoProposta`, `cobrancaSemWebhookDias`, `efeitoRetidoHoras`: nulo = `[a decidir]` = desligado; a homologação preenche no seed com `valoresDeHomologacao: true` (fup 3 e 7 dias, diagnóstico 1 dia útil, decisão 4 h, parado 3 dias, validade 8 dias, veto 10 min).
- `autonomia` por automação (A0 a A3): padrão = degrau vigente pela régua; R3 e R4 param em A2.

## 6. Pendências com estado exato (início da rodada 5)

- **D-1 / C-1 (P1)**: link de assinar pela Root entregue a qualquer `leads.editar`. Conserto escrito e sem commit: link cifrado (`comercial/link-da-root.ts`), entrega só ao signatário cadastrado, titular relido no banco, com senha; telas ajustadas; script `db:conserto:link-da-root` para o que já estava em claro.
- **D-2 (P1)**: devedor fora dos argumentos da cobrança R4. Aberto.
- **E-1 (P1)**: ponte de modelo com `shell: true`, ferramentas e MCP. Aberto.
- **E-2 (P1)**: resposta da dúvida vai ao cliente sem gente. Aberto.
- **E-3 (P1)**: quadro de custos de exemplo entra em proposta real. Aberto.
- P2 dos laudos: A-1, A-2, B-3 a B-7, C-2 a C-9, D-4 a D-7, E-4 a E-15 (detalhe nos laudos).
- Testes do baseline vermelhos neste Windows desde a `main` (não consertados): console-da-plataforma, documentacao, finance-contrato-e-empresa, import-clickup, mapa-publico, pauta-episodio, root-midia, vault (permissão de arquivo, link simbólico, git).

## 7. Falta do Rodrigo

- Chave Anthropic válida (hoje `stub`; `ponte` só para demonstração).
- Conta Asaas sandbox e conta ZapSign com API.
- Número de WhatsApp e API da Meta (Cloud API e Flows).
- Modelo de contrato da Root (hoje `homolog/fixtures/contrato-modelo.md` com lacunas `[a decidir]`).
- Decisões K08 (os três interruptores e a autonomia).
- Preço do Fable 5.1 em `preco.ts` (hoje a ponte grava custo 0 com `custoDesconhecido`).
- Números da régua (fup, prazo do diagnóstico, validade, decisão, veto), fórmula da saúde, taxa da previsão, quem assina pela Root, quem entra no grupo, textos dos avisos de cobrança ao cliente.
- Papel do sócio titular: hoje o `diretor` não tem `leads.editar` e não sobe ata nem decide na fila.
