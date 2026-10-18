# Cockpit do lead · módulo comercial

> Escrito em 13/10/2026 na homologação do Predator (branch `comercial/cockpit-homolog`). O desenho completo está em `docs/comercial/mapa-da-operacao.html`; o estado da entrega e as pendências, em `homolog/RESULTADO.md`.

## O que existe

Do primeiro contato do lead à gestão do contrato, com o mínimo de ação humana que a régua R0 a R5 permite.

- **O fio do lead.** Todo fato é um `LeadEvent` com tipo do catálogo `comercial/eventos.ts` e id derivado (idempotente). A ficha (`ComercialFicha`, 1:1 com `Lead`) é PROJEÇÃO dos eventos: nenhuma tela grava campo à mão. `Lead.status` é derivado da etapa por mapa fixo, para as telas antigas.
- **Etapas e portões.** Enum `ComercialEtapa` (E1 novo lead a E9 fechado; saídas desqualificado, geladeira, perdido, parceiro). `comercial/portoes.ts` recusa avançar com a lista exata do que falta. Quem move a etapa é a reação a um evento, nunca um PATCH de tela. Desde a rodada do painel (P5, 18/10/2026) uma PESSOA pode mover o cartão adiante no funil (arraste ou menu "Mover para"): vira pedido do recurso `lead`, outra pessoa assina em /atendimento e quem pediu conclui com o token (`POST /comercial/lead/:id/mover`, mesma proteção do `PATCH /leads/:id`). Com portão em aberto a mudança executa, grava `etapa.movida_com_pendencia` e o cartão mostra o balão até os fatos chegarem. E8 e E9 não aceitam mover; conta de máquina e agente seguem barrados pelos portões.
- **Reações e relógio.** `fio.service.ts` roda as reações K02 de cada evento, idempotentes por `(eventoId, reacao)`; o retry do relógio espera 15 min por reação em curso e para em 4 tentativas com erro. A rotina `comercial.relogio` (tique de 1 min) cuida do que depende de tempo: véspera, follow-up, janela de veto, vencimento de decisão, régua de cobrança, marcos do contrato, vigia das 08:00 e relator da quinta 18:00.
- **Fila de decisões.** `ComercialDecisao` com opções, padrão escrito e prazo. Vencida sem resposta, aplica o padrão e grava o fato. Sem prazo configurado (`decisaoExpiraHoras` nulo), só sai com resposta. Responder pede `leads.editar` e `aprovacoes.decidir`.
- **Sala do cliente.** `/s/<token>`, pública, o mesmo token do primeiro contato ao kickoff. Token só em hash (e cifrado para reescrever o link). Rotas `/api/sala/:token/*` com limite por origem. Depois do aceite, os dados do contratante e o pedido de ajuste deixam de ser aceitos.
- **WhatsApp por porta.** `simulado` (padrão na homologação, com a tela `/comercial/simulador`), `evolution` e o esqueleto `meta`. Textos M1 a M8 versionados em `comercial/textos-das-mensagens.ts`. O link da sala nunca fica em claro no texto guardado nem nos argumentos assinados (vai um marcador; só o provedor recebe o link).
- **Inteligência.** `LLM_PROVIDER` `stub` (testes e seed), `ponte` (CLI do Claude Code no host, só demonstração) ou `anthropic`. Leitor de ata para diagnóstico com minuto, construtor e revisor de proposta (preço só da tabela de 04/10), assistente da dúvida (só responde ao cliente o que é literal da proposta; o resto vai a uma pessoa), relator e vigia.
- **Dinheiro e assinatura por porta.** Cobrança (`asaas`) e assinatura (`zapsign`), com dublês na homologação. A cobrança leva o devedor nos argumentos assinados. O pagamento da 1ª parcela vira `pix.pago`, `boleto.pago` ou `cartao.pago` conforme a forma; estorno e chargeback tiram a parcela de paga (`parcela.estornada`) e seguram o fechamento. O link de assinar pela Root só existe cifrado e só sai ao signatário titular cadastrado, com a senha.
- **Fechamento.** `fechamento.service.ts` com chave `fech-<leadId>-v<n>`: cliente, contrato, cobrança, kit e trilho do onboarding, grupo do WhatsApp com M8. Rodar de novo reaproveita e não duplica. Só vai à fila com a 1ª parcela paga e as duas assinaturas.
- **Leituras.** Contrato vivo (tela 11), torre das automações (tela 12, com autonomia A0 a A3 por automação), relatório da semana (tela 13).

## Telas

| Tela | Rota |
|---|---|
| 03 fila de decisões | `/comercial` |
| 04 funil | `/comercial/funil` |
| 05 fio do lead | `/comercial/lead/[id]` |
| 06 depois da sessão | `/comercial/lead/[id]/sessao` |
| 09 celulares simulados | `/comercial/simulador` |
| 10 fechamento | `/comercial/lead/[id]/fechamento` |
| 11 contrato vivo | `/comercial/contratos`, `/comercial/contratos/[leadId]` |
| 12 torre | `/comercial/torre` |
| 13 relatório | `/comercial/relatorio` |
| 02, 07, 08 sala do cliente | `/s/[token]` |

Variáveis da API no ambiente (nos dois lugares, `docker-compose.yml` e `.env`): `ASAAS_WEBHOOK_TOKEN`, `ZAPSIGN_API_TOKEN`, `ZAPSIGN_BASE_URL`, `ZAPSIGN_WEBHOOK_TOKEN`, `WHATSAPP_PROVEDOR` (padrão `simulado`). `PONTE_MODELO_*` e `QUADRO_DE_CUSTOS_EXEMPLO` são só da homologação e não entram no compose de produção.

Prefixos de API `comercial` e `sala`, governados pelo módulo `leads`. Permissões existentes: `leads.ver`, `leads.editar`, `aprovacoes.ver`, `aprovacoes.decidir`. Nenhuma permissão nova.

## Capacidades e níveis

Declaradas no delta do produto (`packages/policy/politica-marketing-os.json`), classificadas pela escada. Nenhuma regra afrouxada.

| Capacidade | Nível | Quem libera |
|---|---|---|
| `whatsapp.mensagem.enviar` | R3 | segunda pessoa com alçada responsável |
| `comercial.whatsapp.enviar` | R3 | idem; a mensagem escrita por pessoa vai à porta em nome dela |
| `comercial.proposta.publicar` | R3 | idem |
| `comercial.cobranca.criar` | R4 | titular, com senha e motivo |
| `comercial.contrato.enviar` | R4 | titular |
| `comercial.fechamento.executar` | R4 | titular |

Os sinais da régua (`fora_da_janela`, `volume_atipico`) sobem um degrau: numa demonstração com várias jornadas na mesma hora, as mensagens passam a R4.

## Interruptores e padrões

Em `ComercialConfig`, por empresa. Mudar pede `aprovacoes.decidir`, recusa conta de máquina e grava `comercial.config.alterada` no RASTRO com o antes e o depois.

| Campo | Padrão | O que faz ligado |
|---|---|---|
| `envioAutomatico` (K08-1) | falso | abre a janela de veto antes de mandar os oito textos; o R3 continua indo à fila |
| `fechamentoAutomatico` (K08-2) | falso | o fechamento vai à porta no fim da janela de veto, salvo veto; o R4 continua |
| `silencioAprova` (K08-3) | falso | proposta dentro da tabela com laudo limpo é agendada; a ida à porta continua R3 |
| `autonomia` por automação | degrau vigente | A0 pula e registra; A3 roda e só avisa quebra; R3 e R4 param em A2 |
| números da régua (inclui `geladeiraVoltaDias`) | nulo = `[a decidir]` = desligado | a homologação preenche no seed com `valoresDeHomologacao`; sem `geladeiraVoltaDias`, a geladeira decidida pela fila pede a data de volta a uma pessoa |

## O que depende da mesa (K08)

1. Virar os três interruptores (envio, fechamento, silêncio aprova) e a autonomia de cada automação.
2. Os números da régua: dias do follow-up, prazo do diagnóstico, validade da proposta, prazo das decisões, janela de veto, hora de publicação.
3. A fórmula da saúde do cliente e a taxa da previsão do mês.
4. Quem assina pela Root, quem entra no grupo, o texto dos avisos de cobrança.
5. O papel do sócio no comercial (hoje o `diretor` não tem `leads.editar`).
