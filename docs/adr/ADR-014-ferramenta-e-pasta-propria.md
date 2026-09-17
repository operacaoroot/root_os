# ADR-014 · Uma ferramenta do cliente é uma pasta própria dentro do repositório

- **Data:** 16/09/2026
- **Situação:** **aceita** em 17/09/2026 — o Pedro decidiu seguir a recomendação ("siga conforme as boas práticas e sua recomendação"). Proposta em 16/09 (etapa P0 de `docs/PLANO-PRODUTO.md`)
- **Origem da pergunta:** o produto promete que o cliente "segue criando ferramentas para o próprio
  negócio de forma segura e estruturada" e que a base é "atualizada sem sobrescrever o que é do
  cliente". As duas promessas só se cumprem juntas se estiver decidido **onde** a ferramenta mora.

## Contexto

Duas formas de uma ferramenta construída pelo agente do cliente existir:

| | Módulo dentro do núcleo | Pasta própria (`ferramentas/<nome>/`) |
|---|---|---|
| Travas de arranque (prefixo, RLS, catálogo, catraca) | valem de graça | valem de graça — roda no mesmo processo |
| Atualizar o núcleo | `git merge`, com conflito | regra de diretório: a atualização **não toca** `ferramentas/` |
| Publicar | deploy | habilitar o módulo no tenant de produção (`Org.modulos`, ADR-002) |
| Risco | o agente do cliente edita o núcleo | o agente do cliente só escreve dentro da pasta dele |

## Decisão

**Pasta própria**, carregada por convenção, **nunca tocada** pela atualização do núcleo. As travas que
já existem — prefixo de rota não declarado lança, tabela nova sem RLS aborta, capacidade sem
classificação vale R5, catraca de arquitetura com cinco frentes — continuam valendo porque o código
roda no mesmo processo. Um `pnpm criar-ferramenta <nome>` gera o molde com tudo que as travas cobram
já preenchido; o agente só consegue construir **dentro** do padrão.

## Consequências

- `deploy/atualizar.sh` nasce com a regra: nunca toca `ferramentas/`, `.env`, o vault nem o banco além
  de `migrate deploy`.
- Publicar = ação pela porta (com rastro) que habilita a ferramenta no tenant de produção; desfazer =
  desabilitar. Sem deploy por ferramenta.
- O agente de desenvolvimento **não recebe** credencial de produção por padrão: constrói no tenant de
  homologação, e a publicação é a fronteira.
- Migration de ferramenta é migration como qualquer outra — e portanto passa pelo mesmo `command` do
  container. Ferramenta com migration quebrada derruba a API; é o preço de rodar no mesmo processo, e
  o molde tem de deixar isso dito.
