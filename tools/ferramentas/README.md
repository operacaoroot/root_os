# E4a — molde e staging de ferramentas

`pnpm criar-ferramenta <slug>` gera uma pasta própria em `ferramentas/<slug>`.
O comando só cria contrato e arquivos de molde; não ativa tenant, política,
capability, rota ou publicação.

`pnpm preparar-ferramentas` valida todos os manifestos e produz um inventário
ordenado com SHA-256 e staging determinístico. O precheck trata TypeScript,
Next e SQL como arquivos: não importa nem executa código. Saídas existentes só
são substituídas/removidas quando o marcador comprova que foram produzidas pelo
próprio preparador; staging sem marcador é recusado.

O módulo API gerado nesta subfatia é somente um descriptor de tabela/query SQL
parametrizada, não um módulo Nest funcional; a página é um molde não ativado.

O molde contém tabela direta `id`/`orgId`, `ENABLE/FORCE ROW LEVEL SECURITY`,
fixture sintética A/B e query parametrizada. A capability fica como proposta
R5 inativa. Integração de autorização, gateway, registro, inventário de
migrations do núcleo e publicação são etapas posteriores.

Exemplo de ensaio em diretório temporário:

```sh
pnpm criar-ferramenta exemplo --root /caminho/temporario
pnpm preparar-ferramentas --root /caminho/temporario --stage /caminho/temporario/stage
```
