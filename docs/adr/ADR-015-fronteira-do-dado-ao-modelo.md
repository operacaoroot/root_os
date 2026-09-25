# ADR-015 · O que pode ser devolvido ao agente é decisão do cliente, escrita no onboarding

- **Data:** 16/09/2026
- **Situação:** **aceita** em 17/09/2026 — o Pedro decidiu seguir a recomendação ("siga conforme as boas práticas e sua recomendação"). Proposta em 16/09 (etapa P0 de `docs/PLANO-PRODUTO.md`)
- **Origem da pergunta:** o Codex, na sessão de 16/09: *"Claude Code instalado localmente não
  significa inferência local. Consultar dados pelo Claude Code pode levá-los ao computador e ao
  provedor do modelo."*

## Contexto

"O acesso sempre parte da máquina do cliente" tem dois sentidos, e o produto atende só um deles por
desenho: **quem inicia a conexão** é o computador do cliente, e a VPS nunca entra nele. O outro
sentido — **os dados nunca saem da VPS** — não é verdade: tudo o que o agente consulta vai ao provedor
do modelo, junto com o prompt.

Isso não é defeito do desenho; é a natureza de usar um modelo hospedado. Mas vira problema de venda e
de contrato se for descoberto pelo cliente em vez de dito pela ROOT.

## Decisão

1. **A fronteira é declarada por cliente, por escrito, no onboarding**: quais fontes e quais campos
   podem ser devolvidos ao agente; o resto a API não devolve, independentemente de quem pergunta.
2. **A promessa comercial é delimitada:** o ROOT controla e registra o que passa pela integração dele;
   conectar o Claude Code não dá controle sobre o que ele faz por outros caminhos.
3. **O RASTRO já cobre a metade que é nossa:** `sensibilidade: confidencial|restrita` faz o rastro
   redigir o conteúdo, e o envelope de procedência diz de onde cada dado veio. O que falta é a lista
   de permissão de campos, por fonte, que hoje não existe.

## Consequências

- O onboarding ganha um passo obrigatório: a fronteira do dado, assinada pelo cliente.
- A API passa a aplicar a lista (campo fora da lista não sai), e o rastro registra a decisão.
- Cliente cuja política proíba dado em provedor externo precisa de modelo em ambiente próprio — e isso
  fica declarado como fora do produto padrão, não como promessa.
