# E4a — molde e staging de ferramentas

`pnpm criar-ferramenta <slug>` gera uma pasta própria em `ferramentas/<slug>`.
O comando só cria contrato e arquivos de molde; não ativa tenant, política,
capability, rota ou publicação.

`pnpm preparar-ferramentas` valida todos os manifestos e produz um inventário
ordenado com SHA-256, `toolHash` e staging determinístico. O precheck trata
TypeScript, Next e SQL como arquivos: não importa nem executa código. O hook de
build materializa o staging em `apps/api/src/ferramentas-geradas` e nas páginas
`apps/web/src/app/ferramentas/<slug>` antes de `build`, `typecheck`, `dev` e
`test`. Saídas existentes só são substituídas/removidas quando o marcador
comprova que foram produzidas pelo próprio preparador; qualquer arquivo extra,
symlink ou staging sem marcador é recusado.

O módulo API gerado é código TypeScript próprio da ferramenta: exporta `list` e
`create` com nome de tabela literal e valores parametrizados por `Prisma.sql`.
Um índice estático tipado é o único ponto que o núcleo importa; não há
hotloader, catálogo genérico ou execução de TypeScript pelo precheck. A página
gerada é uma casca para o componente estável do painel e só aparece depois que
a empresa tiver a chave `ferramentas:<slug>` ativada.

O molde contém tabela direta `id`/`orgId`, `ENABLE/FORCE ROW LEVEL SECURITY`,
fixture sintética A/B e query parametrizada. A capability fica como proposta
R5 inativa. Integração de autorização, gateway, registro, inventário de
migrations do núcleo e publicação são etapas posteriores.

Exemplo de ensaio em diretório temporário (sem tocar o repositório):

```sh
pnpm criar-ferramenta exemplo --root /caminho/temporario
pnpm preparar-ferramentas --root /caminho/temporario --stage /caminho/temporario/stage
```
