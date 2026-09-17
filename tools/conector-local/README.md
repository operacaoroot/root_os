# Conector local — primeira fatia: prévia sem envio

Protótipo de linha de comando em Python 3, sem dependências externas. Seleciona
explicitamente uma pasta ou arquivo e mostra metadados em JSON. Não lê o conteúdo
dos documentos, não acessa SQL, não usa credenciais, não se conecta à rede e não
envia dados. Nenhuma prévia equivale a autorização de envio.

```sh
python3 tools/conector-local/preview.py /caminho/escolhido
python3 tools/conector-local/preview.py /caminho/escolhido --recursive --exclude 'privado/*'
python3 tools/conector-local/preview.py /caminho/documento.md
```

- Subpastas só entram com `--recursive`; exclusões usam glob relativo à seleção.
- Por padrão: `.md`, `.txt`, `.csv`; outros formatos ficam explicitamente de fora.
  `--extension .md --extension .txt` substitui essa lista. Não há extração de PDF/OCR.
- Arquivos ocultos, nomes conhecidos de credenciais e extensões de chaves são
  excluídos mesmo quando pedidos. Isso **não** detecta segredos em documentos:
  a pessoa ainda precisa revisar o conteúdo que decidir compartilhar.
- Symlinks e junctions encontrados na seleção são excluídos. Outros reparse points do
  Windows, como placeholders de arquivos sob demanda, não são confundidos com links.
  Arquivos com o atributo `hidden` também são excluídos. Os testes foram executados no
  macOS com metadados do Windows simulados; a validação em Windows real continua pendente.
- Exclusões são insensíveis a maiúsculas no Windows e sensíveis no macOS/Linux. Isso é uma
  regra explícita desta ferramenta; não tenta inferir se o volume macOS foi formatado como
  case-sensitive ou case-insensitive.
- Há limites de tamanho, quantidade de entradas e profundidade. Erros de leitura
  de metadados, limites de percurso e fonte ausente produzem `complete: false` e
  código de saída 3. Erros de uso do CLI mantêm o código 2. Arquivos filtrados aparecem
  em `skipped`. `--max-depth` permite reduzir explicitamente o limite de profundidade.
- O relatório não inclui raiz absoluta nem conteúdo. Nomes de arquivos podem
  ser sensíveis: mantenha a prévia local e fora do Git.

## Verificação sem dados reais

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/conector-local -p 'test_*.py' -v
```

## Próxima fronteira

Esta fatia prova a seleção e a prévia em CLI, não o conector instalável final.
Faltam seletor gráfico, aprovação local persistida, identidade de dispositivo,
pareamento, envio, extração, agendamento e integração com a VPS. Antes de qualquer
envio, o processo deve revalidar a seleção e abrir os arquivos sem seguir links,
comparar conteúdo/versão com o aprovado e recusar ampliação remota de alcance.
Uma troca de arquivo ou pasta entre prévia e envio não pode ampliar o acesso.
Consentimento para sincronizar novos arquivos deve ser separado de aprovar uma
lista pontual. A prévia de metadados não resolve essas fronteiras sozinha.
