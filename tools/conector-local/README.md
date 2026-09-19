# Conector local — prévia e importação consentida

Cliente Python 3 sem dependências externas. A seleção começa sempre como prévia
de metadados; somente uma aprovação explícita, com a fonte lógica e destino
`agente_externo` exibidos, pode iniciar uma importação. A sincronização contínua
(`modo=sincronizacao`) permanece bloqueada: E3b.2b.1 oferece somente snapshots
manuais, sem daemon, agendamento ou descoberta em segundo plano.

## Prévia, pulso e aprovação

```sh
ROOTOS_JOB="$(mktemp -d)"
ROOTOS_JOB="$(cd "$ROOTOS_JOB" && pwd -P)"
chmod 700 "$ROOTOS_JOB"
echo "Guarde este diretório para retomada: $ROOTOS_JOB"
python3 tools/conector-local/cli.py --api https://operacao.example --state "$ROOTOS_JOB/device-state.json" pair \
  --org-id ORG_ID --pairing-id PAIRING_ID --name "Este dispositivo"
python3 tools/conector-local/cli.py --api https://operacao.example --state "$ROOTOS_JOB/device-state.json" preview ./docs \
  --recursive --exclude 'privado/**' --output "$ROOTOS_JOB/preview.json"
python3 tools/conector-local/cli.py --api https://operacao.example --state "$ROOTOS_JOB/device-state.json" pulse \
  --device-id DEVICE_ID --output "$ROOTOS_JOB/pulso.json"
python3 tools/conector-local/cli.py --api https://operacao.example approve \
  --root "$PWD/docs" --preview-json "$ROOTOS_JOB/preview.json" --source-json "$ROOTOS_JOB/pulso.json" \
  --output "$ROOTOS_JOB/consent-1.json" --org-id ORG_ID --device-id DEVICE_ID \
  --source-id SOURCE_ID --scope-version 3 --mode importacao
python3 tools/conector-local/cli.py --api https://operacao.example --state "$ROOTOS_JOB/state-1.json" sync \
  --consent "$ROOTOS_JOB/consent-1.json" --device-id DEVICE_ID
# Nova seleção exige nova prévia/consentimento e estado separado; o estado-1 não é apagado.
python3 tools/conector-local/cli.py --api https://operacao.example preview ./docs \
  --recursive --exclude 'privado/**' --output "$ROOTOS_JOB/preview-2.json"
python3 tools/conector-local/cli.py --api https://operacao.example approve \
  --root "$PWD/docs" --preview-json "$ROOTOS_JOB/preview-2.json" --source-json "$ROOTOS_JOB/pulso.json" \
  --output "$ROOTOS_JOB/consent-2.json" --org-id ORG_ID --device-id DEVICE_ID \
  --source-id SOURCE_ID --scope-version 3 --mode importacao
python3 tools/conector-local/cli.py --api https://operacao.example --state "$ROOTOS_JOB/state-2.json" sync \
  --consent "$ROOTOS_JOB/consent-2.json" --device-id DEVICE_ID
```

O diretório temporário físico é privado e não deve ser apagado enquanto houver
retomada pendente; não use `/tmp` existente, symlink ou diretório compartilhado.
O CLI não recebe bearer em argumento, não grava token nem
conteúdo no estado e usa Keychain do macOS ou Secret Service (`secret-tool`) no
Linux; sem cofre do sistema a operação falha fechada. O código de pareamento é
digitado com prompt oculto. Não use caminhos reais ou segredos nos testes.

O leitor POSIX abre raiz, ancestrais e arquivo por descritores sem seguir links,
verifica identidade/versão/hash bruto e recusa FIFO, traversal, troca de arquivo
ou extensão fora do contrato. Windows mantém prévia, mas não envia até existir
leitor equivalente validado. A hash enviada é calculada sobre UTF-8 normalizado
com as regras de `String.trim`/CRLF do receptor. `*`, `**`, `**/` e `?` seguem o
glob lógico do servidor; ampliar filtro, destino, fonte, versão ou conjunto de
arquivos exige novo consentimento.

HTTP exige HTTPS e não segue redirecionamentos. HTTP só pode ser habilitado
explicitamente para o literal `127.0.0.1` em fixtures. Limites locais são 2 MiB
por arquivo, 10 MiB por lote e 12 MiB no wire. A chave da remessa é persistida
antes da abertura; timeout deixa recibo pendente para retomada idempotente, sem
marcar sucesso antes de todos os lotes e do fim confirmado pelo servidor.

## Snapshot manual (sincronização sob demanda)

`preview-snapshot` percorre e lê localmente os bytes da fonte inteira com a configuração recebida no pulso,
para congelar tamanho/versão/hash no manifesto (não é a prévia genérica só de metadados):
não aceita subpasta, filtro mais estreito ou `complete=true` inventado pelo chamador.
Link, tamanho excedido, erro de leitura, limite e mudança da árvore tornam o
manifesto incompleto; nenhum desses casos vira ausência arquivável. Um snapshot
vazio só é válido quando a cobertura integral foi comprovada. A aprovação congela
raiz, destino, empresa, dispositivo, fonte, escopo e filtros; arquivos novos e
alterados exigem confirmações separadas. A regra de ausência (`ignorar` ou
`arquivar`) precisa ser a mesma da fonte. Antes do fim e em cada retomada a árvore
é varrida novamente; descoberta nova nunca é incorporada ao estado antigo. O
manifesto não guarda conteúdo/segredo e nenhum byte é enviado à rede antes do
consentimento; a prévia não chama provider nem faz upload.

Exemplo de prévia (o JSON do pulso é somente metadado local):

```sh
python3 tools/conector-local/cli.py --api https://operacao.example preview-snapshot \
  --root "$PWD/docs" --source-json "$ROOTOS_JOB/pulso.json" --source-id SOURCE_ID \
  --output "$ROOTOS_JOB/snapshot.json"
```

O modo manual não equivale a sincronização agendada. Windows falha fechado até
existir leitor ancorado equivalente; não há seletor Tk obrigatório nem coleta
quando a prévia ou o consentimento são cancelados.

## Testes

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s tools/conector-local -p 'test_*.py' -v
```

Os testes usam somente diretórios temporários, transportes sintéticos e cofre em
memória injetado. Não acessam Keychain/Secret Service, pastas pessoais, API real,
VPS ou provedor externo. Não há agendamento nesta fatia.
