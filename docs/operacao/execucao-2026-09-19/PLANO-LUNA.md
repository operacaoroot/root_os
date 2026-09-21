# ROOT OS — execução conduzida pelo Luna, 19/09/2026

Estado: **RETOMADO EM 21/09 — E2/E3 aceitas no recorte local; E4a.1 aceita; E4a.2/E4b em validação pelo Sol**.
Pedido: Pedro quer um plano que o modelo Luna execute, não uma lista de prompts
para ele repassar manualmente. Meta temporal: avançar até o aceite do projeto
hoje, sem prometer concluir etapas que ainda não foram implementadas ou aceitas.

## Papéis e mecanismo real

- Executor inicial: **`/root/luna_executor`**, modelo **`gpt-5.6-luna`**, esforço
  `high`, criado nesta sessão a pedido explícito do Pedro. Interrompido durante
  a recuperação de E3b.2a, sem apagar suas alterações.
- Segundo executor: **`/root/luna_fechamento`**, **`gpt-5.6-luna`**, esforço
  `medium`, contexto reduzido e tarefa delimitada. É o único escritor de código
  durante seu recorte; o executor anterior não deve retomar sem nova passagem
  explícita da exclusividade. A transferência evita manter uma rodada longa sem
  checkpoint verificável e preserva o pedido de execução pelo Luna.
- Executor atual: **`/root/luna_ferramentas`**, **`gpt-5.6-luna`**, esforço
  `high`, contexto novo e tarefa de integração delimitada. Recebeu exclusividade
  após `70ee6b9`; `luna_fechamento` foi interrompido depois do commit e não pode
  escrever em paralelo. Continua sendo Luna; o modelo da conversa principal não
  foi alterado. O primeiro despacho é fechar proposta breve, depois implementar
  integração com build/autorização, sob revisão.
- Retomada atual: **`/root/sol_finalizador`**, **`gpt-5.6-sol`**, esforço `high`,
  criado em 21/09 após o Luna atingir seu limite de uso. Recebeu exclusividade
  sobre código e a árvore suja preservada, começando pela auditoria das mudanças
  E4a.2/E4b. Os executores Luna permanecem parados e não podem editar em paralelo.
  Depois do aceite de E4b, o mesmo Sol segue sequencialmente por E4c/E5/E6; E7/E8
  continuam condicionadas a manifesto, autorização remota específica e pessoa
  no papel do cliente.
- Coordenador: esta sessão; escreve o plano/registro, revisa diffs e evidências,
  envia as tarefas e esclarece dúvidas do Luna. Não implementa código em paralelo.
- Apoio pontual: `/root/luna_revisao_coletor`, também `gpt-5.6-luna`, esforço
  `medium`, somente leitura. Preparou recorte P3 e revisou caminhos de memória
  enquanto o executor implementava E2b. Não altera arquivos nem cria recursos.
- Pedro: aprova fronteiras remotas, uso de dados/provedores e participa dos aceites
  que precisam de usuário real. O cliente/terceiro executa o aceite independente.
- Cada tarefa termina com diff, testes, riscos e próximo passo. O coordenador
  fornece o próximo trabalho ao Luna sem exigir que Pedro copie prompts.
- Luna não foi configurado como daemon ou monitor fora da sessão. O modelo desta
  conversa principal não foi alterado. Uma interrupção precisa retomar deste
  arquivo e dos registros, sem fingir que houve execução durante a pausa.

Usamos orquestração por checkpoints e revisão de menor privilégio. Para economizar:
um executor Luna, contexto por tarefa, testes focados durante implementação e
regressão completa nos marcos; não reconstruir imagens a cada ajuste documental.
Decisões de autorização, RLS e recuperação sempre passam pela revisão do coordenador.

## Base que não deve ser refeita

G0 fechado em `a98b8d3`, tag local `retomada-rls-g0-20260918`, imagem Linux/amd64
validada; 41 migrations reconciliadas. Fonte de identidade/hashes:
`../retomada-2026-09-18/CANDIDATO-G0.md`. Pacote local verificado como presente
em 19/09 às 16:08 -03: `/tmp/rootos-release-g0-20260918.pkHwDy/`.
O checksum deve ser revalidado antes de qualquer transporte futuro.

Não misturar a validação local com ativação remota: homologação estava em v5,
com conexão dona e `observar`. O ensaio remoto aprovado ontem foi descartável,
com a imagem anterior, não autorização permanente de deploy.

## Sequência de execuções

| Ordem | Trabalho do Luna | Saída verificável / portão |
| --- | --- | --- |
| E0 | Ler instruções/estado, conferir árvore e identificar lacunas reais de P2/P3 | mapa de arquivos/testes e tarefa seguinte delimitada; preservar alterações alheias |
| E1 | G1: inventariar painel/rota da homologação por leitura | dono efetivo da configuração, domínio, rede, fonte de env; preencher manifesto ou registrar o dado que falta |
| E2a | Identidade individual do agente: token opaco, hash, escopo mínimo, revogação, empresa/usuário ativos | testes de emissão, autorização, expiração/revogação, isolamento; nenhuma elevação pelo token |
| E2b | Contexto da empresa e fronteira de dados do ADR-015 | memória por tenant, fontes/campos autorizados, procedência, fallback textual; negar dados sem consentimento aplicável |
| E2c | MCP existente integrado com essa identidade/contexto e painel mínimo | `memoria_buscar`/`memoria_ler`, emissão/revogação pelo usuário autorizado, instrução curta de onboarding; CI e prova compilada |
| E3a | Recepção mínima de uma pasta/arquivo | pareamento, pulso, remessa/lotes/fim, limites, revisão/hash, idempotência, rastreabilidade, frescor, revogação |
| E3b | Conector local integrado à recepção | seleção/prévia/consentimento, envio só de arquivos autorizados, interrupção/reenvio sem duplicação; não enviar raiz absoluta ou credenciais |
| E4 | Molde de uma ferramenta, sem catálogo genérico | prefixo, autorização, tabela com RLS, testes, capacidade classificada; customizações fora do núcleo e execução isolada de produção |
| E5 | Segunda ferramenta e prova de preservação | primeira continua funcionando; atualização preserva dados/env/ferramentas; backup restaurado em ambiente isolado |
| E6 | Release integrada local | regressões API/web/policy/MCP/conector, tipos, migrations do zero/upgrade, teste HTTP do artefato e recuperação; hashes/relatório |
| E7 | Homologação real, somente após manifesto e autorização | backup/restore, troca restrita de API/web, RLS real, saúde/identidade e acesso humano; produção intocada |
| E8 | Aceite final com pessoa no papel do cliente | instalar/conectar fonte/criar duas ferramentas sem Pedro executar por ela; registrar intervenções e pendências, não simular aceite humano |

E1 pode encontrar um portão remoto sem bloquear E2–E6 **locais**. A homologação
não será recriada repetidamente para cada fatia: consolidar uma release quando
os testes locais estiverem verdes. Se E2+ acrescentar schema, o manifesto G0
antigo não cobre o novo artefato: refazer análise de compatibilidade/recuperação.

P6 (SQL) não entra por pressa: engine/autenticação e máquina do piloto precisam
ser confirmadas. Não acrescentar monitor de agentes, catálogo genérico, orquestrador
próprio, outros MCPs ou automações sem caso de uso. O pulso do conector definido
no contrato P3 permanece necessário para revogação. Trilho M permanece separado; risco de
segurança encontrado no caminho é registrado e escalado, não ignorado pelo prazo.

## Contrato de cada tarefa enviada ao Luna

O coordenador envia: objetivo único → arquivos/limites → resultado esperado →
testes → ações proibidas → formato da evidência. Luna responde:

1. O que implementou/mediu e arquivos alterados.
2. Comandos rodados, exit codes, número de casos/falhas/pulados e logs sintéticos.
3. O que não foi provado, incluindo mocks, timeout e aceite humano.
4. Diff/commit focado e próximo impedimento real.

Não pedir confirmação ao Pedro após cada teste verde. Após revisão aprovada,
seguir para a próxima fatia local. Uma falha recebe diagnóstico e correção focada;
duas tentativas sem progresso escalam ao coordenador antes de aumentar escopo.
Não aumentar timeouts, afrouxar RLS/política ou desabilitar testes para obter verde.

## Limites obrigatórios

- VPS: somente `vps-root` (`2.25.223.180`, `srv1983380`), nunca alias `vps`.
- Não fazer escrita remota, backup/restore, papel, rede, painel ou recriação antes
  de manifesto completo e aprovação específica. “Finalizar hoje” não substitui isso.
- Sem push, merge, deploy de produção, checkout/reset/clean amplo ou prune.
- Um banco descartável exclusivo por execução; não compartilhar testes que alteram
  RLS nem tocar nos containers preexistentes. Segredos não entram em Git/logs.
- Recursos de teste só em rede interna ou bind explícito `127.0.0.1`. Nunca
  publicar banco/API sintética em `0.0.0.0` ou `[::]` por omissão do Docker.
- Fontes reais do cliente, envio a provedor, OAuth real ou gasto pago dependem
  de consentimento específico. Usar fixtures sintéticas por padrão.
- Preservar `docs/operacao/madrugada-2026-09-17/STATUS-CLAUDE.md` modificado e
  `docs/PLANO-CONDUCAO-HOJE-2026-09-17.md` não versionado.

## Critério de encerramento

Só declarar **projeto concluído** se o aceite da seção 6 de `PLANO-PRODUTO.md`
for demonstrado. Código verde significa **implementação local validada**;
homologação verde significa **validado em homologação**; nenhum dos dois equivale
ao cliente independente concluir o fluxo. Se o dia terminar ou houver portão
humano/remoto, registrar exatamente o entregue e a próxima ação, sem selar etapas
faltantes como completas.

## Registro de execução

- 19/09, aproximadamente 16:08 -03: candidato G0 presente, árvore sem código novo;
  Luna iniciado para E0/E1 e diagnóstico das próximas fatias. Nenhuma mutação remota.
- Próximos resultados entram em `STATUS-LUNA.md` e nas revisões do coordenador.
- E0/E1: Luna identificou o Compose efetivo e as lacunas de P2/P3. O domínio de
  homologação não resolveu DNS no inventário e a ligação ao painel/Traefik não
  está comprovada. Inventário encerrado sem mutações remotas; isso bloqueia a
  publicação, não a implementação local.
- E2a autorizada: modelo/migration, credencial individual, guard exclusivo e
  rotas humanas de emissão/listagem/revogação próprias. MCP e ContextBuilder
  ficam para E2b/c, depois da fronteira de dados. Emissão e uso relerão autoridade
  atual; nenhum PAT será aceito genericamente nas rotas de sessão.
- E2a entregue: código revisado, 14 unitários e tipos verificados pelo coordenador;
  Luna reportou isolamento SQL, ciclo real da credencial, concorrência, rollback
  de auditoria e HTTP compilado. Commit local autorizado, sem declarar P2 completo.
- E2b autorizada: memória por empresa + grants de fonte exata/campos, default deny,
  autorização humana atual, projeção/consulta limitada e procedência; MCP/painel
  entram depois. Provas de integração devem ficar reutilizáveis no repositório.
- E2b entregue em `ed84dfc`; correção E2b.1 aprovada pelo coordenador após revisar
  trava estrita, CI dedicada e negativas HTTP de PAT/grant/tenant. Luna reportou
  3/3 integração e `SMOKE_RESTRITO_OK`; commit incremental autorizado. Isso não
  substitui regressão integrada E6 nem execução real do workflow remoto de CI.
- E2c enviada ao Luna: leitura por id, cliente MCP exclusivo de PAT e controles
  mínimos no painel; humano/P2 final continuam abertos.
- E2c aprovada localmente: coordenador repetiu web **386/386** e smoke MCP,
  inclusive após correção do JSON inválido. Executor entregou HTTP compilado
  restrito, integração SQL 3/3, tipos/builds e CI localmente configurada. Não há
  aceite humano P2 nem execução da CI no GitHub. Commit focado autorizado.
- E3a subdividida para revisão segura: E3a.1 identidade, fontes e pareamento/pulso;
  E3a.2 remessas, revisões, finalização e frescor. E3b integra o coletor local.
- E3a.2 aceita localmente às 18:56 -03: remessas revisadas, integração SQL 6/6,
  isolamento 315/315 e HTTP compilado reportados pelo executor; coordenador
  repetiu parser/glob/contexto 45/45, tipos e diff check. Commit focado autorizado
  e E3b.1 enviada para continuar sem nova confirmação do Pedro. Instalação,
  fontes reais, distribuição e aceite do piloto continuam fora desse aceite.
- E3b.1 aceita localmente após correções: coordenador repetiu **58/58**, zero
  pulados, incluindo redirect entre loopbacks e TLS autoassinado real recusado.
  Importação pontual apenas; não cobre sincronização contínua, cofre real, UI
  ou piloto. Commit focado autorizado. E3b.2a enviada diretamente: cliente
  Python real contra API compilada restrita e gestão de fontes/dispositivos no
  painel, sem exigir novo prompt do Pedro e sem autorização remota adicional.

## Recorte preparado para E2c (após revisão E2b)

- API: completar leitura por id no controlador estreito de agente, com o mesmo
  filtro de fonte/campo e rastro da busca. Não reutilizar a leitura humana integral.
- MCP: evoluir `packages/mcp/src/client.ts` e `server.ts`, oferecendo
  `memoria_buscar`/`memoria_ler` com PAT exclusivo. Token ausente, inválido ou
  revogado não dispara login de conta compartilhada. O modo cliente não deve
  exigir senha de serviço nem anunciar ferramentas que seu token não pode usar.
  Compatibilidade legada, se mantida, deve ser explícita e não reabrir memória
  integral pelo caminho antigo. HTTPS, sem encaminhar bearer em redirects,
  timeout e erros sem conteúdo/segredo.
- Painel: reaproveitar `/contexto` e helpers de autenticação para tokens próprios
  e concessões da empresa. Separar permissão de emitir token da de consentir
  dados; exibir texto/destino/fonte/campos antes de consentir. Exibição única do
  segredo, sem persistência no browser. Conectar não concede fonte automaticamente.
- Entrega: instrução curta baseada nos comandos efetivos do pacote, testes de
  cliente MCP/UI e HTTP restrito. Não simular conexão humana no Claude Code como
  aceite concluído. Não criar outro servidor, catálogo ou sistema de orquestração.

## Contrato E3a.1 — dispositivo e fontes, antes do envio

O Luna implementa o módulo receptor `conector`, sem acessar arquivos reais.
Reutiliza o contrato da seção 3 do plano de produto:

- Fonte lógica de pasta/arquivo: filtros, tipos permitidos, limites, modo,
  regra de exclusão, versão de escopo e revogação. Nunca raiz absoluta ou
  credenciais. A fonte não concede acesso ao agente/modelo automaticamente.
- Dispositivo vinculado a empresa e fontes autorizadas. Credencial opaca
  separada do PAT de memória, apenas hash persistido. RLS FORCE e integridade
  de vínculos impedem combinar objetos de empresas diferentes.
- Código de pareamento de 15 minutos, uso único transacional, pelo menos 128
  bits aleatórios, hash persistido e tentativas limitadas. Seletor público serve
  para resolver o tenant, não como autorização nem como leitura global livre.
- `POST /conector/pareamento` troca o código pelo token;
  `POST /conector/pulso` exige o token de dispositivo e relê revogação/empresa/
  fontes. Corpo não escolhe empresa. Tokens JWT, PAT e dispositivo não se
  substituem entre as três superfícies.
- Gestão humana mínima de fonte/código/dispositivo com JWT e permissões
  atuais `admin.permissoes` + `obsidian.editar`, sem alterar o catálogo de
  permissões. Auditar as mutações na mesma transação. Não devolver segredos
  ou hashes em listagens. Declarar prefixo e rotas públicas precisamente.
- O pulso informa alcance permitido no servidor; o coletor fará a interseção
  com consentimento local em E3b. O servidor não autoriza ampliar pasta/filtros.
- Provas: dois tenants com papel SQL restrito, uso único concorrente, expiração,
  revogação, limite de tentativas, rollback ao falhar auditoria e autorização
  humana atual. Suíte dedicada com proteção estrita de banco local descartável,
  CI sequencial e piso sem pulados; smoke HTTP compilado pair/pulse/revoke/deny.

E3a.1 não contém remessa nem UI do coletor. Não confundir o pareamento verde
com P3 concluído. As restrições de rede, segredos, escrita remota e escritor
único continuam valendo. Entrega para revisão antes do commit desta subfatia.

## Contrato E3a.2 — remessas rastreáveis e retomáveis

Após commit local focado E3a.1, o mesmo Luna completa as três chamadas de
remessa, lote e fim da seção 3 do plano de produto, usando somente fixtures.

- Abertura idempotente por chave de requisição; revisão monotônica do servidor
  impede lote antigo sobrescrever dado novo. Remessa prende dispositivo, fonte,
  empresa e versão do escopo. Revalidar autoridade de dispositivo/fonte/empresa
  em cada lote e fim, não apenas no pulso.
- Memória existente `ContextItem`/versões, origem `conector`, referência
  `<fonte>/<caminho>`, chave estável. Sem segunda verdade de conteúdo, vault ROOT
  ou embeddings. Hash e tamanho conferidos no servidor; limites explícitos de
  arquivo/lote/quantidade, tipos md/txt/csv e filtros do escopo.
- Repetição não cria outra versão; A → B → A cria três. Recibo de revisão,
  projeção e evento precisam de uma fronteira transacional demonstrável.
  A composição ingênua dos métodos humanos atuais não a fornece: eles gravam o
  rastro separadamente. Preferir extensão interna pequena que reutilize a lógica
  de hash/montagem do EventLog, preservando comportamento humano existente.
  Nada de framework ou outbox genérico criado para esta fatia.
- Finalização com manifesto completo das chaves vistas, escopo estável e zero
  erros. Snapshot interrompido, parcial, revogado ou antigo não arquiva ausências
  nem marca sucesso. Regra `ignorar` não arquiva; arquivamento é reversível.
  Revogação não apaga o já recebido. Distinguir tentativa/sucesso/frescor na fonte.
- Provas reais com papel SQL restrito: dois tenants, idempotência, retorno A → B
  → A, ordem, adulteração de hash/tamanho/filtro, dispositivo/tenant indevidos,
  revogação entre chamadas, exclusões em snapshot completo e falha de rastro com
  retomada sem duplicação. RLS/catálogo, CI dedicada sequencial e smoke compilado.
- Memória recebida só fica acessível ao agente após grant separado. Não fabricar
  consentimento na ingestão. Cliente local e UI ficam para E3b, sem coleta real.

O executor registra a escolha de serialização e segue implementando; entrega
para revisão antes do commit E3a.2. Todos os limites operacionais anteriores
continuam válidos. P3 não está concluído com o receptor isolado.

## Recorte preparado E3b — cliente local, sem dados pessoais

Usar o protótipo Python existente. Não instalar o OS inteiro no computador,
não abrir porta de entrada e não criar serviço de administração remota.
Dividir em duas entregas revisáveis pelo mesmo escritor:

1. **E3b.1, núcleo local:** seleção explícita por CLI, prévia completa e aprovação
   separada; consentimento/estado local com permissões restritas; leitor seguro;
   transporte de saída e retomada. Token somente em adaptador de cofre do SO,
   nunca em argv, JSON, logs ou Git. Sem backend seguro disponível, recusar a
   operação; não criar fallback silencioso para segredo em texto puro.
2. **E3b.2, integração e uso:** seletor visual pequeno, quando o toolkit nativo
   estiver disponível, pareamento e ciclo completo contra API compilada restrita;
   fontes, saúde/frescor e revogação no painel existente. Documentar execução
   manual/agendada sem instalar tarefa automaticamente. A distribuição e o
   aceite na máquina do piloto continuam dependências humanas explícitas.

Requisitos de ambas as fatias:

- Guardar a raiz absoluta apenas localmente; transmitir referências relativas.
  Pareamento não é consentimento. Prévia incompleta, inacessível ou excedendo
  limites não autoriza envio nem fechamento como snapshot completo.
- Consentimento liga dispositivo, destino, fonte e versão do escopo à seleção
  local. Mudança de destino/escopo exige aprovação nova; o pulso pode revogar
  ou restringir, nunca ampliar pastas/tipos/filtros autorizados localmente.
- Importação usa lista aprovada e versão dos arquivos. Sincronização de mudanças
  e inclusão de arquivos novos exigem autorização distinta e explícita. Regra
  de exclusão fica visível antes de confirmar. Nenhum teste lê arquivos pessoais.
- Abrir sem seguir links, verificar os componentes da raiz e os descendentes,
  comparar identidade/metadados antes e depois da leitura e rejeitar mudanças.
  `lstat` seguido de `open` convencional não elimina TOCTOU. Onde a plataforma
  não fornecer implementação validável, bloquear envio, não alegar suporte.
- HTTPS com certificados/hostname verificados, sem redirects com credencial,
  timeouts e limites de corpo. HTTP somente em opção de teste explícita para
  loopback literal. Falta de pulso/revogação interrompe coleta programada.
- Persistir chave/estado da remessa sem conteúdo ou segredo. Resposta ambígua
  repete a mesma operação idempotente. Arquivo alterado durante retomada exige
  nova prévia, não reusa a aprovação de outro conteúdo.
- Fixtures demonstram exclusões, links/ancestrais trocados, alteração entre
  prévia/leitura/envio, escopo ampliado, revogação, interrupção e reenvio, segredo
  indisponível e negativas de TLS/redirect. Ensaio real loopback demonstra que o
  documento só chega ao agente depois do grant separado.

Não instalar agendamento, credenciais ou configuração do Claude real durante os
testes. Testes simulados de Windows não equivalem a validação na máquina do
piloto. Não acrescentar assinatura de instalador, SQL ou framework de plugins
para contornar essas pendências. E3b só começa após aceite local do receptor.

Sequenciamento refinado durante E3b.1: o primeiro recorte é importação pontual,
não sincronização automática. Depois, E3b.2a liga o cliente real à API compilada
restrita e acrescenta controles no painel; E3b.2b cobre snapshots/sincronização
com consentimentos separados e seletor local. O coordenador verificou que o
Python atual encontra o pacote `tkinter`, mas seu import falha por ausência de
`_tkinter`. Não instalar toolkit global nem declarar interface visual testada
nesta máquina; suporte/distribuição e ensaio humano precisam ficar explícitos.

Recorte preparado E3b.2b: **snapshots manuais**, sem daemon. Cada snapshot fixa
arquivos/versões e revalida antes de concluir; alterações e arquivos novos têm
aprovações separadas, sem incorporar descoberta posterior durante retomada.
Ausência só é ausência em varredura íntegra. Arquivo conhecido agora em skip
(link, tamanho excedido, acesso negado, tipo inseguro) não pode ser omitido como
se tivesse sido removido para então arquivá-lo na VPS.

O manifesto de sincronização é autoritativo para a **fonte inteira** no receptor.
Logo, uma seleção local parcial/filtro adicional/subpastas não percorridas não
pode fechar `manifestoCompleto=true` e arquivar itens fora dessa seleção.
Primeiro contrato deve exigir cobertura exata do escopo lógico suportado e
explicar explicitamente a regra de ausências; caso não consiga provar cobertura,
recusar sincronização e manter importação, sem inventar completude. Testar regra
`ignorar`, `arquivar`, ausências reais, skips, erro de varredura e retomada sem
ampliação. O seletor visual não concede consentimento automaticamente.

Não acrescentar um sistema novo de assinatura/MAC para fingir segurança contra
o próprio usuário/processo que pode editar o cliente e acessar o cofre. Estado
0600 é privado ao usuário; fingerprint detecta divergência, não equivale a
assinatura humana inviolável. A fronteira e essa limitação devem ficar claras.

Detalhes do próximo despacho E3b.2b, ainda sujeito ao aceite E3b.2a:

- Prévia de snapshot deriva filtros/tipos/limites da fonte exata do pulso,
  percorre a raiz inteira suportada e liga essa cobertura ao consentimento.
  Não basta confiar em `complete=true` de uma prévia genérica que aceita seleção
  parcial. Varredura de diretórios precisa detectar troca/link e erro, inclusive
  quando o snapshot está vazio; usar abertura ancorada e verificação de identidade.
- Comparação com o snapshot anterior separa novos, alterados e ausentes. A
  confirmação mostra esses grupos e a regra de ausência; novos e alterações têm
  confirmações distintas. Nada autoriza incorporações descobertas na retomada.
- Remessa vazia só é válida para snapshot integral comprovado, não para
  importação vazia. Antes do fim, conferir que o snapshot não mudou; se mudou,
  não declarar sucesso nem arquivar ausentes. Testar também árvore que mudou
  entre a varredura, os lotes e a finalização.
- Seletor de arquivo/pasta é opcional e local; cancellation não coleta, seleção
  não aprova. Toolkit ausente tem erro útil e mantém o CLI. Testes usam doubles,
  sem abrir diálogos nesta máquina ou instalar dependências globais.
- Provar via HTTP compilado os snapshots e a regra de ausência com fixtures;
  manter a distinção entre importação, snapshot manual e agendamento contínuo.
  Não instalar scheduler nem apresentar o suporte Windows como validado.

## Dependência identificada para E4/E5 — migrations das ferramentas

O revisor Luna confirmou por leitura que `deploy/atualizar.sh` inventaria o
histórico de migrations da **tag do núcleo**, antes do build, enquanto preserva
`ferramentas/` por checksum. Isso não incorpora migrations próprias dessas
pastas. Copiá-las somente no Docker build não resolve: a checagem anterior
poderia interpretar migration já aplicada como ausente/downgrade.

Consequência para a execução: o scaffold pode ser preparado, mas não publicado
como P4 concluído antes de integrar e testar o inventário **núcleo + ferramentas**,
com nomes/checksums, migração em cópia, imagem anterior compatível e restauração.
Uma alternativa sem schema próprio pode ser um recorte intermediário, não a
entrega prometida de tabela/migration com RLS. Não alterar silenciosamente esse
critério do plano de produto para declarar a etapa verde.

A aprovação de capacidade nova permanece humana e explícita. Um fragmento de
política gerado não é uma assinatura, e autorização para implementar/testar
localmente não autoriza ativar essa capacidade na VPS.

### Recorte de implementação preparado, ainda não despachado

E4 deve ser pequeno e dividido: primeiro scaffold/contrato validado; depois
integração determinística de build e inventário de migrations; por fim prova
HTTP/RLS da ferramenta sintética. E5 reutiliza esse caminho para a segunda,
atualização e restauração. Não executar scripts de deploy no workspace vivo.

- Um manifesto por `ferramentas/<slug>/` declara prefixo, permissão, capacidades
  propostas e migrations próprias. Nomes e tabelas têm namespace do slug;
  colisão com núcleo/outra ferramenta, caminho externo e symlink são recusados.
  O inventário agregado com hashes é artefato determinístico, não catálogo de
  plugins nem autorregistro de autorização.
- Pré-check de atualização combina migrations da tag candidata com as das
  ferramentas preservadas e verifica todas as aplicadas, inclusive checksum.
  O mesmo inventário deve chegar ao build/ensaio/migração, sem editar migrations
  históricas nem copiar SQL somente depois da checagem de compatibilidade.
- Para o molde mínimo, SQL próprio e queries parametrizadas de tabela constante
  evitam compor um Prisma Client dinâmico. Tabelas têm empresa obrigatória,
  integridade, ENABLE/FORCE RLS e a política efetiva existente no repositório;
  teste com papel restrito e duas empresas. Prisma tipado por ferramenta fica
  fora deste recorte, não como promessa implícita.
- A imagem anterior precisa continuar funcionando contra o schema expandido
  no ensaio. Restore recupera dado/schema em destino descartável; desligar
  módulo não é rollback. Classificação/aprovação de capacidade e publicação
  continuam portões humanos; fixtures de autorização não contam como assinatura.
- Testes mínimos: duas pastas sem editar núcleo por ferramenta; slug/caminho/
  colisão/manifesto inválidos; SQL adulterado/ausente/extra; banco novo e upgrade;
  negativa RLS; primeiro módulo preservado após segundo; identidade do artefato,
  imagem anterior e restore com dado sintético conferido.

O executor deve apresentar qualquer incompatibilidade com os gates existentes
antes de ampliar esse contrato. A fiscalização de prefixos/permissões e a régua
do gateway não podem ser removidas para acomodar ferramentas customizadas.

Integração de autorização preparada por leitura: um bridge de build estável
registra os efeitos com dono/ID único, e o controlador continua passando pela
porta do operador/gateway. Proposta de capability em arquivo de ferramenta não
é catálogo ativo: sem classificação na política vigente, continua bloqueada
em R5. Fixtures podem aplicar um delta explícito com conta/autor sintéticos no
banco de teste para provar o caminho permitido, sem alegar assinatura do Pedro.

Não há hoje endpoint de sobrescrita de política; o serviço interno e o seed
possuem os gates de autor/motivo. Não criar uma API ampla de publicação como
atalho de E4. A operação real de ativação continua revisão/configuração/deploy
controlados. O molde inicial pode declarar permissões existentes apropriadas
(por exemplo, `mcp.ver`/`mcp.executar` para ferramentas), sem inventar uma nova
chave ou rodar o sincronizador destrutivo. Se uma ferramenta exigir alçada ou
permissão nova, isso vira decisão explícita, não alteração automática de perfis.

Revisão adicional para o molde: `mcp.executar` também está nas contas de máquina.
Uma rota que use `PortaDoOperador` não pode por isso marcar qualquer JWT como
humano. Reusar a distinção existente `temPapelDeMaquina` e reler usuário/papéis/
permissões atuais antes da escrita; fixtures devem provar conta de máquina,
usuário desativado e permissão retirada. Não resolver isso concedendo
`admin.usuarios` a todos nem presumindo que JWT ainda válido conserva autoridade.

O bridge não deve importar TypeScript diretamente de fora de `apps/api/src`
e prometer preservar `dist/main.js`: isso pode ampliar o rootDir inferido.
Preparar cópia determinística para área gerada reservada, recusando colisões e
artefatos obsoletos, e provar a saída compilada. Manifesto é dado validado, não
código executado no pré-check. A proposta do revisor sobre ativação por tabela
própria ainda não foi adotada: escolher o menor mecanismo que preserve negação
por tenant e o contrato de módulos, sem acrescentar catálogo de plugins.

Recorte refinado após segunda leitura do revisor: usar ativações exatas
`ferramentas:<slug>` no **`Org.modulos` já existente**, validadas contra o
artefato gerado. API `/ferramentas/<slug>` tem declaração central única; catálogo
core `MODULOS` e navegação `/ferramentas` não viram listas editadas por cliente.
Uma lista explícita de ferramentas ativas pode complementar `/tenants/modulos`,
sem declarar namespace desconhecido como módulo core nem liberar slug ausente
do build. Não criar tabela de ativação. A escrita real desses valores continua
parte da publicação controlada, não um endpoint novo de ativação automática.

A verificação de ativação tem de existir **no efeito/serviço compartilhado**, não
somente no controller. Caso contrário, chamada de agente ou aprovação retida
alcança o registro diretamente e ignora a ferramenta desligada. Provar 404/recusa
entre tenants e recusa após desativar também por esse caminho; manter a
distinção de ator humano/IA e a política vigente. O conteúdo da tabela própria
continua sob RLS com papel restrito, independentemente do controle de disponibilidade.

Compatibilidade operacional: o instalador exige Docker/Git/OpenSSL, não Node ou
Python no host da VPS. Um validador Node para manifests/inventário não pode virar
dependência oculta de `atualizar.sh`. Usar runtime já disponível na imagem, sem
rede e com entradas de metadados somente leitura, ou declarar/provar outra
solução sem instalar runtime adicional silenciosamente. Não montar `.env`, cofre
ou socket Docker no validador; arquivos da ferramenta são dados, não código a
executar no pré-check. Ensaiar os scripts em clone/instância descartáveis, nunca
no workspace ativo nem na VPS sem aprovação.

Outra integração obrigatória: `test/tenant-isolation.test.ts` compara `ALVOS`
com **todas** as tabelas públicas. Incorporar um artefato estático gerado de
alvos/fixtures das ferramentas ao registro e ao seed/cleanup existentes, sem
editar o núcleo por slug nem excluir tabelas `Tool_*` da conferência. O recorte
inicial pode limitar o molde a tabela direta de tenant com chave `id`, `orgId`
obrigatório e fixture A/B; não precisa criar agora um motor genérico de joins.
Manifesto ausente/inválido ou tabela extra deve reprovar, inclusive se tiver
RLS declarada, porque policy sem linhas de teste não comprova isolamento.
Queries de dados do molde são parametrizadas e com tabela constante; não há
catraca global de `RawUnsafe` no código atual, portanto conferir o molde e os
casos negativos explicitamente, sem prometer sandbox por análise de strings.

### Despacho preparado E4a — contrato e geração, antes da ativação

Após o aceite de E3b.2b.2, o mesmo Luna permanece escritor exclusivo. Primeira
subfatia de E4 entrega `pnpm criar-ferramenta <slug>` com stdlib Node e molde
documentado: manifesto JSON, módulo/página, migration SQL, fixture e proposta de
capacidade. Gerar uma pasta não ativa tenant ou política e não publica nada.
O gerador recusa sobrescrever uma pasta existente e valida antes de escrever.

Separar criação de preparação determinística do build. A preparação lê dados
do manifesto, sem executar código da ferramenta no precheck; enumera todos os
arquivos relevantes e hashes. Staging de TS da API fica dentro de `src`, para
preservar `dist/main.js`. Staging Next usa área reservada que não confunde a
rota `/ferramentas` existente com páginas de ferramentas. Só saídas comprovadamente
geradas podem ser substituídas; colisão com conteúdo não gerado deve recusar.
Ferramenta removida não pode sobreviver em artefato obsoleto. Duas preparações
sem alteração devem produzir bytes iguais, sem timestamps voláteis.

Provas desta subfatia são em temporários: dois slugs, nomes inválidos, colisões,
symlinks, manifesto inválido, arquivo declarado ausente/extra e remoção de
ferramenta. O núcleo não recebe edição por slug. Não colocar demonstrações do
cliente permanentemente em `ferramentas/` rastreadas pela release do núcleo.
O contrato inicial limita a fixture SQL a tabela direta de tenant; não adicionar
motor de schema/plugins. Dependências externas exigem decisão, não `npm install`.

Hooks devem cobrir chamadas diretas aos pacotes (Docker usa `pnpm --filter`
e não passa pelo script raiz), além de dev/build/typecheck/test quando precisam
dos artefatos. Preparação antes do hash do Turbo e entradas globais de ferramentas
evitam cache stale. Preparadores paralelos não devem apagar a saída um do outro;
uma alternativa pequena é preparação por alvo com registro comum determinístico.
O mecanismo exato é revisado com o diff, não presumido como pronto.

E4b integra bridge estável, ativação/autorização atual, gateway, página funcional
e provas HTTP/RLS. E4c fecha inventário agregado e scripts de atualização. Nenhuma
subfatia isolada equivale ao aceite P4 com pessoa cliente e publicação remota.

Despacho efetivo ao `luna_ferramentas`: integrar build e depois API/página com
funções reais no **código da própria ferramenta**, não um CRUD genérico guiado
apenas por query-string/configuração. Tabela literal e valores parametrizados
no módulo gerado; bridge tipado estático. Dois efeitos mínimos propostos: ler
(R0) e criar artefato interno (R1), sem classificá-los automaticamente na política
vigente; desconhecido continua R5. Fixtures de revisão aplicam delta explícito
com autor/motivo sintéticos e provam a recusa anterior.

Não existe `app/ferramentas/page.tsx` dedicado no estado anterior: `/ferramentas`
é navegação/placeholder do catchall. E4b pode criar uma landing mínima com as
ferramentas ativas da empresa, além da página própria `/ferramentas/<slug>`;
isso não requer um catálogo genérico. Testar troca de sessão, além de autoridade
atual no servidor. A primeira fonte de SQL da ferramenta deve entrar no
inventário da fixture e na prova de RLS, sem tabela aplicada invisivelmente
fora do histórico só para produzir um smoke verde.

Dependência adicional E4c/E5 confirmada por leitura: `atualizar.sh` hoje recusa
mesmo commit e nomeia/verifica a imagem apenas pelo núcleo; `health/versao` não
identifica ferramentas. Publicar alteração só de ferramenta requer identidade
**core + hash determinístico das ferramentas**, verificação no artefato e na
saúde/recuperação e caminho explícito no atualizador. Não confundir o checksum
de preservação da pasta com identificação do que está rodando. A imagem antiga
já contém seu código compilado e pode recuperar o runtime sem sobrescrever a
pasta atual do cliente; registrar essa diferença entre fonte preservada e
artefato ativo, em vez de inventar um catálogo/bundle manager como atalho.

### E4c/E5 — ordem preparada para o próximo despacho (ainda não executada)

1. **Inventário e identidade.** Uma única enumeração validada de core+tool
   migrations, nomes/checksums sem duplicatas, é usada no pré-check, no build e
   no `migrate deploy`. Histórico aplicado ausente ou alterado reprova antes do
   corte. Testes devem confrontar os bytes, não apenas contar migrations. O
   `toolHash` é calculado dos inputs validados e ligado aos bytes compilados;
   não aceitar um valor arbitrário de env como identidade. Identidade core/hash
   embutida na imagem deve prevalecer sobre env de runtime, com desenvolvimento
   explicitamente distinto. Não precisa de nova variável `ARTIFACT_ID` se for
   derivável. Fixtures de ferramentas antigas sem manifesto não são convertidas
   nem ignoradas silenciosamente: recusa legível, preservando os arquivos.
2. **Atualizador e recuperação.** Atualização somente de ferramenta deve ser
   possível com mesmo core e hash diferente. Imagem nomeada/registrada pela
   identidade completa, sem sobrescrever a anterior; health e recuperação
   conferem a mesma identidade. `--voltar` seleciona imagem exata registrada,
   não a reconstrói só por tag/core. A pasta do cliente permanece intocada mesmo
   se sua fonte estiver adiante do runtime restaurado. Imagem legada sem hash
   não equivale a conjunto vazio validado: registrar a lacuna e exigir caminho
   explícito de transição, sem declarar recuperação totalmente comprovada.
   No host, usar Node da imagem para validação de dados somente leitura e sem
   rede; não instalar Node/Python nem executar TS/SQL da ferramenta no pré-check.
3. **Duas ferramentas e restore.** Em instância/clone local descartável, provar
   primeira ferramenta, segunda, mudança de núcleo e mudança só de ferramenta;
   dados, arquivos e env preservados. Ensaiar imagem anterior sobre schema novo
   e restaurar backup em outro banco descartável antes de afirmar recuperação.
   Stubs de deploy são prova de controle/ordem, não substituem imagem e banco
   reais. Nenhum destes passos autoriza tocar na homologação ou produção.

E6 distingue explicitamente boot da imagem, HTTP/RLS, cliente Python no host e
integração cliente→imagem. O harness `smoke-restrito.cjs` atual chama Python:
não roda inalterado na imagem Node sem Python. Não adicionar Python à produção
nem pular o filho e devolver o marcador antigo como se fosse prova completa.
Um harness Node da imagem pode ter marcador próprio e complementar a prova do
cliente; uma integração completa precisa realmente conectar ambos. Bind local
ou rede interna exclusiva e ambiente allowlist permanecem obrigatórios.
