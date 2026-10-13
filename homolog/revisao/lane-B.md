# Revisão adversarial · Lane B (sala e canal)

Lane G, 13/10/2026. Revisor: Opus 5.5, sem ter escrito o código. Escopo: `sala.service.ts`, `sala.controller.ts`, `sala-token.ts`, `sala-projecao.ts`, `whatsapp.service.ts`, `mensagens.ts`, `mensagens.controller.ts`, `simulador.controller.ts`, `canais/*`, `apps/web/src/app/s/[token]/page.tsx` e `apps/web/src/app/comercial/simulador/`. Nada foi consertado nesta passada.

Testes que provam os achados (afirmam o certo, estão VERMELHOS e por isso ficaram fora do commit): `apps/api/test/comercial-revisao-canal.test.ts` e `apps/api/test/comercial-revisao-puro.test.ts` (segundo caso).

## P1

### B-1 · O token da sala fica em claro no banco e no RASTRO
- **Onde:** o M1, o M3, o M4 e o M6 levam `{linkDaSala}` no texto (`whatsapp.service.ts:468,515,490,286`); o texto vai inteiro aos argumentos da porta (`whatsapp.service.ts:381`, `ArgsDoEnvio.texto`), ao `ComercialMensagem.texto` e ao payload do `whats.enviada` (`whatsapp.service.ts:438`).
- **Defeito:** a regra da sala é "token só em hash; cifrado só para reescrever o link". O link com o token cru acaba em três tabelas sem cifra.
- **Evidência:** contagem no banco da homologação (`rootos_comercial`), regex `/s/[A-Za-z0-9_-]{43}`: `ToolCall.args` 17 de 29 chamadas de `comercial.whatsapp.enviar`; `LeadEvent` `whats.enviada` 17 de 46; `ComercialMensagem.texto` 17 de 35. `EventLog` e `AuditLog`: 0 (lá o conteúdo sai em resumo). **Confirmado.**
- **Cenário:** quem lê `ToolCall` (tela de rastro, `/atendimento`, um dump de banco, o MCP que lista chamadas) abre a sala de qualquer lead, vê a proposta e o preço, sobe arquivo, troca os dados do aceite e aceita a proposta em nome do cliente.
- **Conserto:** o texto que vai aos argumentos e ao fio leva um marcador (`{linkDaSala}`) e o efeito troca pelo link decifrado só na hora do envio; o hash do texto aprovado é calculado sobre o texto com o marcador. Apagar ou cifrar o que já está gravado.

### B-2 · O M6 escrito por uma pessoa vai à porta em nome do sistema, e quem escreveu libera o próprio envio
- **Onde:** `whatsapp.service.ts:280-289` (`completarM6` chama `this.submeter(atual)` sem `quem`) e `simulador.controller.ts:246-252` (a rota não passa o usuário).
- **Defeito:** a novidade é texto livre de 10 a 400 caracteres escrito por uma pessoa; a aprovação nasce com `propostoPorTipo = system`, `propostoPorId = 'comercial'`. A invariante 7 (quem propôs não aprova) deixa de valer: a mesma pessoa escreve e libera.
- **Evidência:** `comercial-revisao-canal.test.ts`, caso 1: `expected 'system' to be 'user'`. **Confirmado.** Contraste: `pedirEnvio` (`whatsapp.service.ts:298-306`) faz certo e passa `quem`.
- **Conserto:** `completarM6(orgId, id, novidade, quem)` e `submeter(atual, new Date(), quem)`; a rota passa `{ id: user.sub }`.

## P2

### B-3 · O telefone de destino não está preso à aprovação
- **Onde:** `whatsapp.service.ts:74-80` (args sem telefone) e `:358-367,418` (o efeito relê `Lead.phone` na hora de enviar).
- **Cenário:** a M1 (com o link da sala) espera na fila; alguém troca o telefone do lead; a liberação de outra pessoa manda o link para o número novo.
- **Evidência:** `comercial-revisao-canal.test.ts`, caso 2: o provedor espião recebeu `5511999990000`. **Confirmado.**
- **Conserto:** o destino normalizado (ou o jid) entra nos argumentos e no `argsSchema`; o efeito recusa se o destino de agora for outro.

### B-4 · O simulador fica montado em qualquer provedor e contorna a permissão da fila
- **Onde:** `simulador.controller.ts:228-234` (`POST /comercial/simulador/mesa/responder` pede só `leads.editar`), contra `comercial.controller.ts:96` (a mesma resposta pede `leads.editar` + `aprovacoes.decidir`). E `simulador.controller.ts:157-179` (`lead/:leadId/responder`).
- **Cenário 1:** `analista` ou a conta de máquina `ia_acao` (têm `leads.editar`, não têm `aprovacoes.decidir`) respondem `veto_de_fechamento`, `ponto_zero` e `pedido_de_ajuste` pelo simulador.
- **Cenário 2:** com `WHATSAPP_PROVEDOR=evolution` ou `meta`, a rota do "celular do lead" continua aceitando que um funcionário escreva como se fosse o lead (formulário, escolha de horário, texto), e o fio grava o fato com o provedor real no payload, indistinguível de uma resposta verdadeira.
- **Confirmado** por leitura de código (permissões em `packages/shared/src/permissions.ts`).
- **Conserto:** o controller inteiro só existe com o provedor `simulado` (ou responde 404 fora dele), e `mesa/responder` pede `aprovacoes.decidir` como a rota da fila.

### B-5 · A sala mostra ao cliente o diagnóstico que o sócio ainda não aprovou
- **Onde:** `sala-projecao.ts` (bloco `diagnóstico`, usa o último `diagnostico.pronto` sem olhar `aprovadoEm`); o leitor de ata grava `diagnostico.pronto` com `aprovadoEm: null` (`diagnostico.service.ts:102`).
- **Cenário:** a ata sobe, o modelo escreve as dores, e o cliente anônimo já as lê na sala e vê "Diagnóstico com os seus números" marcado como feito, antes da revisão do sócio.
- **Evidência:** `comercial-revisao-puro.test.ts`, segundo caso. **Confirmado.**
- **Conserto:** a projeção usa só o `diagnostico.pronto` com `aprovadoEm`.

### B-6 · A sala aceita ajuste, dúvida e dados do aceite depois do aceite
- **Onde:** `sala.service.ts:319-346` (`duvida`, `ajuste`, `aceiteDados` só exigem proposta publicada).
- **Cenário:** depois de `proposta.aceita`, o cliente manda `aceite/dados` com outro CNPJ (vira `aceite.dados` novo, chave = hash do conteúdo) ou pede ajuste (abre `pedido_de_ajuste`, que pode gerar a v2). Isso alimenta os defeitos D-2 e D-4 da lane D.
- **Confirmado** por leitura de código.
- **Conserto:** depois do aceite, `aceiteDados` e `ajuste` respondem 409 (mudar dado do contratante passa a ser pedido à mesa).

### B-7 · O efeito do envio não toma a mensagem antes de mandar
- **Onde:** `whatsapp.service.ts:408-436` (lê `estado`, envia, depois grava `enviada`, sem escrita condicionada) e `completarM6` (`:280-288`, lê `rascunho` e atualiza sem condição).
- **Cenário:** dois cliques simultâneos em "novidade" criam duas aprovações para a mesma mensagem; liberadas juntas, os dois efeitos leem `na_fila` e os dois mandam.
- **Plausível** (não exercitado).
- **Conserto:** `updateMany({ where: { id, estado: { in: ['na_fila','rascunho','falhou'] } }, data: { estado: 'enviando' } })` antes do provedor; quem não tomar não envia.

## P3

- **B-8** `sala.controller.ts:39-51`: o balde zera para todos quando passa de 5000 origens (quem roda muitos endereços IPv6 limpa o teto de todo mundo); e, se a sala passa pelo proxy do Next, a origem vista pela API pode ser a do container `web` (balde único para todos os clientes). Plausível; medir atrás do Traefik.
- **B-9** `mensagens.ts:94`: o M3 promete "O link da chamada abre na sua sala 10 minutos antes", e a sala não tem link de chamada (a projeção não tem o campo).
- **B-10** `sala.service.ts:388-396` e `fechamento.service.ts:276`: o kickoff aceita qualquer data futura e mais de uma marcação; o M8 tem chave `M8:<jid>`, então a remarcação não atualiza o horário que vai ao grupo.
- **B-11** `GET /sala/:token` escreve (`acessos`, `sala.visitada`): leitura com efeito, inclusive a pré-visualização de link do WhatsApp, que conta como visita.
- **B-12** `apps/web/src/app/s/[token]/page.tsx:133`: o plano de ação usa o glifo "✓". É tipográfico, não emoji; registro só para a mesa decidir.
- **B-13** A capacidade nova `comercial.whatsapp.enviar` substitui a `whatsapp.mensagem.enviar` que o roteiro (§2.7) mandava reaproveitar; o nível ficou o mesmo (R3), então não é afrouxamento, só divergência do roteiro a registrar.

## O que foi verificado e está bom

- Token de 32 bytes, só o sha256 na coluna de busca, cifra AES-256-GCM com o id da sala como dado associado e chave derivada com prefixo próprio; resolução pela sentinela com consulta mínima; inexistente, malformado, vencido e revogado respondem o mesmo 404.
- Todas as rotas anônimas rodam em `comTenantPublico` com a empresa da sala; erros devolvidos ao cliente são frases da casa, sem detalhe interno.
- O aceite congela versão e hash, recusa versão velha (409) e segunda escolha diferente; a alternativa usa o preço da tabela de 04/10 (Imersão 10×297, Operação 3×3.999), conferida em `packages/shared/src/comercial.ts`.
- Toda mensagem vai à porta como R3 e espera outra pessoa; a janela de veto só acrescenta espera antes da porta; o efeito recusa texto mudado e mensagem vetada.
- Textos M1 a M8: sem travessão, sem emoji, sem a construção "não é X, é Y"; vocativo cai inteiro quando não há nome.
