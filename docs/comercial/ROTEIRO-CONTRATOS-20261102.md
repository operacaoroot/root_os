# Módulo de contratos no ROOT OS: roteiro de construção (02/11/2026)

Fonte: `Root/90-sistema/projetos/contratos-para-os/spec.md` (Pedro, 29/10/2026) e o mockup
https://claude.ai/artifact/1hd91ys5PjTtPn9krttUHz. Rodrigo autorizou a execução em 02/11/2026.
Branch `contratos/20261102`, a partir de `origin/main` b890e221. Contrato compartilhado:
`packages/shared/src/comercial-contratos.ts`.

## Decisões tomadas para seguir

| # | Decisão | Motivo |
|---|---|---|
| D1 | Portar só o que falta | recomendação da spec |
| D2 | Documento vai à ZapSign como PDF gerado pelo OS, com timbre | recomendação da spec |
| D2b | O PDF sai do TEXTO da minuta, por um gerador próprio sem dependência nova, e não do .docx | a imagem não tem LibreOffice; dependência nova é decisão humana; o texto dos moldes é o mesmo. Fonte Times em vez de Cambria: não dá para embutir sem dependência |
| D3 | Sem token da ZapSign nada sai, e a tela diz | quem contrata o plano é decisão dos sócios, fora do código |
| D4 | Quem assina pela Root é escolhido no contrato, entre gente titular; sem escolha, o envio é recusado | "primeiro admin" deixa de valer para o fluxo novo |
| D5 | Nasce genérico por empresa e liga só onde há ZapSign configurada | a porta já é por empresa |
| D6 | CNPJ que fatura é campo do contrato; vazio recusa o envio | a spec pede decisão dos sócios, o código não adivinha |
| D7 | Testemunha não existe; assinatura conjunta sim | regra da skill root-contrato |

## Regras duras

- Nada de escrita fora do OS sem passar pela porta. Enviar é R4 (`comercial.contrato.enviar`).
- Arrastar nunca marca como assinado. Assinatura muda só por webhook ou por `consultarEstado`.
- Migration aditiva, com sentinela + gatilho de filha e RLS, e `FILHOS_COM_ORGID_REDUNDANTE`.
- Sem dependência nova, sem deploy, sem tocar em produção.
- Só `git add` explícito, nunca `-A`. Commit na branch; quem faz push é a coordenação.
- Texto de tela segue a skill `root-escrita`: sem travessão, data absoluta, nunca luz verde falsa.
- Nenhum dado, nome ou marca do escritório Cardozo & Saggioro.

## Fases

F1 registro e signatários · F2 minuta vira PDF · F3 conferir, cancelar, reenviar · F4 quadro, aditivo, distrato · F5 ferramentas MCP.

## Backend F1 e F3 (02/11/2026): decisões que ficaram no código

- `comercial.contrato.cancelar` e `comercial.contrato.reenviar` são R3 pela escada. No cancelar, `destruicao` é falso porque só sai o documento pendente: o efeito recusa documento todo assinado, e registro, hash, signatários e fio ficam no OS. Com `destruicao: true` a escada daria R5 e a porta recusaria o botão. O DELETE da ZapSign não foi testado no sandbox (só no dublê): a spec pede confirmar se ele cancela ou apaga antes de ligar em produção.
- Reenviar não dispara e-mail da ZapSign (`disable_signer_emails`). Ele prepara a M7 para quem do cliente falta, e a M7 é `comercial.whatsapp.enviar`: são duas aprovações, a do reenvio e a da mensagem.
- `external_id` novo em todo documento (`cliente:1`, `cliente:2`, `root:1`). Os signatários vão em paralelo: a ordem não vira sequência obrigatória na ZapSign. O papel só conta como assinado quando todos daquele papel assinaram.
- "Um contrato vivo por lead" é regra do serviço, sob cadeado: índice único derrubaria o backfill, porque há lead com dois documentos.
- Encerrar pelo registro grava o mesmo `contrato.concluido` da rota antiga, e a rota antiga fecha o registro. `contrato.desativado` não fecha: é a coluna "A encerrar". Reabrir (`contrato.reaberto`) anula o fim na lista de contratos vivos e na régua dos importados.
- Para publicar: `db:seed:politica` ANTES da subida, com as duas assinaturas, `POLITICA_CAPACIDADE_NOVA_*` (as duas capacidades) e `POLITICA_REBAIXAMENTO_*` (`contratoId` no esquema de `comercial.contrato.enviar`).

## F2 e F5 (02/11/2026): decisões que ficaram no código

- **O fim do esqueleto `contrato-modelo.ts` NÃO aconteceu nesta etapa, e isso desvia da spec (F2).** `proporAceite` continua igual: o aceite segue propondo o contrato do esqueleto, em markdown, pelo caminho antigo, sem `contratoId`. Motivo: a spec manda os testes `comercial-dinheiro*` passarem sem mudança de comportamento, a ZapSign está sem token em produção e a minuta depende de campos que só uma pessoa preenche; trocar agora deixaria o fechamento pelo aceite sem caminho. O fim do esqueleto fica para quando os sócios ligarem a ZapSign. Até lá convivem dois pedidos: o do esqueleto e o do registro. **Ao ligar a ZapSign, apagar o esqueleto antes de qualquer aceite real**: a titular que aprovar os dois gera dois documentos para o mesmo lead.
- O efeito de `comercial.contrato.enviar` com `contratoId` (`efeitoDoRegistro`) REGERA o PDF do que está gravado agora e confere o hash. Nada lê o congelado: `dadosDoContrato.congelado` é registro do pedido, não fonte. Mudou minuta, signatário, CNPJ que fatura, campo ou aceite, o hash muda e nada sai.
- O hash de `comercial.contrato.enviar` no caminho novo é o do PDF. O recurso da aprovação é `<contratoId>:<16 do hash>`: o segundo clique com o mesmo conteúdo cai na mesma fila, e conteúdo diferente é outro pedido (o velho cai na conferência do efeito).
- **Campos escritos no contrato (`dadosDoContrato.campos`, `PATCH registro/:id`): acréscimo que a spec não pede.** Os moldes pedem objeto, entregas, prazos, encontros, qualificação da contratada e outros dados que o aceite não tem. Sem um lugar para escrever, toda minuta nasceria com lacuna para sempre. O aceite manda no que ele diz (escrever `valor_total` por cima não vale).
- Entrada e saldo não vêm do aceite (ele diz total e número de parcelas, não a divisão): quem escreve é a pessoa. Não há inferência de "2x = entrada e saldo".
- Grave no laudo é crítica ou alta. O revisor (CO-14) reprova sozinho: não há botão de "seguir mesmo assim". Se o modelo apontar alto sem razão, hoje só resolve rodar de novo.
- **O CPF de quem representa a empresa não é mais "documento divergente".** A regra do revisor comparava todo documento do parágrafo da qualificação com o da ficha: com o molde real, a qualificação PJ traz o CPF e nenhum contrato passaria.
- A IA continua no molde (CO-13), mas com trava nova: se a resposta mudar qualquer trecho literal do molde, ela é descartada e fica o preenchimento do sistema, com aviso. Trocar marca é permitido, mudar cláusula não.
- Sem nota, ou com o Drive falhando, a minuta do REGISTRO sai do molde. A rota antiga `POST /comercial/lead/:id/minuta` recusa como sempre quando o lead não tem contrato aberto (não há modalidade para escolher), e não vincula: quem vincula é a rota do registro.
- **Aditivo e distrato: texto simples, a ser revisado por Rodrigo.** Só partes, referência ao pai, o que muda ou a data de encerramento, e "as demais cláusulas seguem válidas". Sem IA e sem revisão de valor da proposta. O distrato assinado não encerra o contrato pai sozinho: encerrar continua sendo um ato próprio. Aditivo ou distrato de contrato importado sem aceite no fio não sai: `versao` é mínimo 1 no esquema.
- A proposta como anexo é escrita a partir de `proposta.publicada` da versão aceita, porque o OS não guarda a proposta como texto corrido. Sem a publicada daquela versão (fechado fora), o PDF sai sem anexo, com aviso.
- Mais de um signatário pela Root: todos vão à ZapSign, mas `assinaPelaRoot` e `linkRoot` guardam só o primeiro. Os demais assinam pelo link que a ZapSign der; o OS não entrega o deles pela tela do link da Root.
- A M7 sai uma por signatário do cliente, cada uma com o link dela, e cada uma vai à fila como toda mensagem.
- Do mockup Emitir ficaram de fora "Baixar .docx" e "Editar minuta" (D2b: não há .docx no OS; corrigir é mudar o campo e gerar de novo), "Receita confere" (nada confere a Receita no OS, e selo sem conferência seria luz verde falsa) e o item CNAE do laudo.
- F5: as três ferramentas estão em `packages/mcp`, e `apiPost` entrou no cliente só para a de propor. **A rota `enviar` é só de gente, e a conta de serviço deste pacote é máquina: por aqui a ferramenta responde 403.** Ela vale quando o servidor autenticar como pessoa; o servidor separado `~/root-os-mcp` já alcança a rota com `MCP_OPERADOR_*`. Nenhuma capacidade nova: o `comercial.contrato.enviar` é o mesmo, e as duas leituras não entraram no catálogo de `ferramenta` da política, que é o do runtime de agentes (o teste `cobre as 36 ferramentas` conta esse catálogo, não `registerTool`).

## O que continua sendo dos sócios

Plano de API e tokens da ZapSign, webhook cadastrado, quem assina pela Root, CNPJ que fatura, provedor de IA em produção.
