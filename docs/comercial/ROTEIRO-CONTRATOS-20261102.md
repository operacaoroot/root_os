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

## O que continua sendo dos sócios

Plano de API e tokens da ZapSign, webhook cadastrado, quem assina pela Root, CNPJ que fatura, provedor de IA em produção.
