# Importação seletiva do contexto editorial

Este comando leva as sete páginas do documento editorial ClickUp e o guia de marca v2.0 para a Memória do ROOT OS. Os corpos vêm dos arquivos locais; o comando não produz nem reescreve conteúdo. A escrita passa por `MemoriaService.criar`, que cria a versão e registra o evento no RASTRO. Não há módulo Nest nem agendamento.

## Fontes e escopo

- Exportação privada do documento ClickUp `8ckpuuy-36293`, workspace `9013259102`, com as sete páginas selecionadas no código.
- Arquivo da vault `Root/40-marca-e-conteudo/root-fundamentos-da-marca-e-guia-de-expressao.md`, versão declarada `2.0`.
- Empresa ROOT identificada por UUID na opção `--org-id`; o comando confere `slug=root` e `isActive=true` no banco.

O corpo de cada página ClickUp entra como Markdown original. No guia, o frontmatter fica na fonte e o corpo entra na mesma forma usada pelo indexador da vault: sem frontmatter e com espaços externos aparados. A versão `2.0` e o SHA-256 do corpo ficam no `sourceRef` e no motivo da primeira versão. O SHA-256 dos bytes de cada arquivo aparece no plano. Guarde os arquivos de origem fora do Git.

## Ensaio local ou QA

Execute a partir de `apps/api`. Use `node --import tsx` para evitar o socket local aberto pelo executável `tsx` em alguns sandboxes. Substitua os caminhos pelos arquivos privados disponíveis na máquina. Nunca ponha `DATABASE_URL` na linha de comando ou no histórico do shell; carregue-a pelo mecanismo de ambiente já usado no QA.

```sh
node --import tsx prisma/import-editorial-context.ts \
  --offline --only ambos \
  --docs-json /caminho/privado/editorial-docs.json \
  --marca-md /caminho/privado/root-fundamentos-da-marca-e-guia-de-expressao.md
```

O resultado offline deve ter oito entradas e os hashes dos dois arquivos. Depois, com `DATABASE_URL` do banco QA e o UUID da empresa ROOT:

```sh
node --import tsx prisma/import-editorial-context.ts \
  --only ambos --org-id UUID_DA_ROOT \
  --docs-json /caminho/privado/editorial-docs.json \
  --marca-md /caminho/privado/root-fundamentos-da-marca-e-guia-de-expressao.md
```

Esse é o dry-run com banco. Ele devolve `criar`, `igual`, `reusar-vault`, `conflito` ou `evento-pendente` por chave. `conflito` e `evento-pendente` impedem o apply inteiro. Se a nota canônica da vault para o guia já existir com corpo idêntico, o comando retorna `reusar-vault` e não cria duplicata. Se for diferente, retorna `conflito`.

Só depois de conferir o plano, execute com os hashes exibidos nele:

```sh
node --import tsx prisma/import-editorial-context.ts \
  --apply --only ambos --org-id UUID_DA_ROOT \
  --docs-json /caminho/privado/editorial-docs.json \
  --marca-md /caminho/privado/root-fundamentos-da-marca-e-guia-de-expressao.md \
  --expect-docs-sha256 HASH_DO_DRY_RUN \
  --expect-marca-sha256 HASH_DO_DRY_RUN
```

Pode-se usar `--only clickup` ou `--only marca`; nesse caso, informe apenas o arquivo e o hash da fonte escolhida. Na primeira execução em banco vazio, o resultado esperado é oito `criado`. A segunda execução deve devolver oito `igual`, ou sete `igual` e `reusar-vault` se o guia já estava na vault. A CLI nunca chama `alterar` ou `arquivar` e não sobrescreve uma edição feita no OS.

## Falhas e retomada

`MemoriaService` grava a nota e o evento em commits separados. Se o evento falhar, a versão recebe `semEventoPorque=falha_ao_registrar`; a CLI interrompe o lote e, na reexecução, mostra `evento-pendente`. O item já criado permanece. Não apague a linha nem repita a importação com outra chave para ocultar a falha. Confira `/memoria/integridade` e o histórico da nota no QA antes de decidir a correção. A CLI não faz reparo automático do RASTRO.

Outra falha após parte do lote pode deixar algumas notas criadas. Refaça o dry-run: notas intactas aparecem `igual` e as ausentes `criar`. O apply continua só com as ausentes se não houver conflito. Como há versões e eventos associados, eventual retirada de uma nota deve passar pelo arquivamento normal da Memória após revisão; esta CLI não apaga dados.

Os logs da CLI contêm chaves, IDs, hashes e referências de origem; não contêm os corpos. Trate esses logs como privados. Não rode o apply em produção antes de reproduzir o ensaio no QA e conferir versão e evento de cada nota.
