# Continuação do isolamento por cliente — 04/11/2026

Solicitação de Pedro: seguir os próximos lotes, com testes antes do código e modelos conforme o plano. A continuação parte da publicação `2c45bf4465618f63bf6ad8b23be09893180edc9e`, que contém as etapas 6 a 8 e a correção do ritmo da Bio. Essa revisão foi integrada sem sobrescrever o trabalho publicado.

## Recorte em execução

O lote de Trabalho e arquivos do plano foi dividido em duas entregas verificáveis. A autorização por cliente é aplicada a cada método liberado, sem liberar o módulo inteiro.

| Lote | Responsabilidade | Modelo | Critério de aceite |
| --- | --- | --- | --- |
| 2 — Trabalho por carteira | Backend de tarefas e comentários; criação/edição com relações controladas | GPT-6.1 Terra, high | Lista, detalhe, filhos, contadores e escritas só alcançam o cliente autorizado; hierarquia divergente fica oculta; revogação vale com a mesma sessão |
| 3 — Arquivos e área de clientes | Lista de anexos, downloads nativos/migrados e estado das pastas | Coordenador Codex | ID conhecido de outro cliente não lê storage; download revalida acesso; contagens só incluem clientes da carteira |
| Interface dos dois lotes | Seletor, lista, detalhe, formulários e cancelamento de respostas antigas | GPT-6.1 Sol, high | Troca de cliente/conta remove dados anteriores; a interface restrita não chama rotas organizacionais |
| Revisão e aceite independente | Contratos de autorização, HTTP com Postgres e casos de corrida | GPT-6 Astra, high | Acesso permitido funciona; A não alcança B/NULL/interno sem vínculo; nenhuma rota futura ganha liberação por marca na classe |
| Integração e publicação | Base corrente, build, regressão, cópia de segurança e recuperação | Coordenador Codex | API e web do mesmo artefato; nenhuma pessoa recebe acesso novo; cofre e depósito JUMA preservados |

Os testes negativos e positivos são executados antes de implementar cada recorte. Os logs registram a falha inicial e a execução após a correção. O aceite final depende de HTTP e banco descartável, além dos testes com dublês.

## Decisões de escopo

- `WorkTask.clienteId` já existe. Não há classificação automática pelo título, nome de pasta ou semelhança com o cadastro.
- Registros sem cliente continuam reservados à visão ampla. O cliente interno usa seu Partner real e exige vínculo para carteiras restritas.
- Uma subtarefa só pode aparecer na carteira quando toda a cadeia de pais pertence ao mesmo cliente. Ciclos, órfãos e relações legadas divergentes ficam fora do resultado restrito.
- As leituras de Trabalho usam uma transação com snapshot consistente entre carteira, hierarquia e resultado.
- Escritas restritas relêem a autorização dentro da transação. Mudanças de relações que ainda não possuem contrato completo permanecem bloqueadas.
- O estado e a contagem das pastas podem ser consultados por carteira. Pedir criação de pasta e enviar anexos que acionam cópias no Drive dependem da revalidação de ator no efeito e no retry; seguem contidos nesta publicação.
- Estrutura organizacional, agentes, delegação, atas, financeiro e comercial não são liberados por consequência da abertura de Trabalho.

## Dependências seguintes

Comercial precisa derivar o escopo da ficha canônica antes de materializar dados ou executar o fechamento. Financeiro precisa distinguir cliente proprietário de contraparte/fornecedor e não atribuir saldo bancário inicial da organização a um cliente. Jobs, MCP e efeitos externos precisam conservar o ator original e revalidar sua carteira. As condições estão detalhadas em `REVISAO-LOTES.md` e continuam no plano principal.

Produção permanece com papel superusuário e `TENANT_MODO=observar`. Estes lotes não são apresentados como ativação de RLS por cliente.

## Estado

Recortes dos lotes 2 e 3 publicados em 04/11/2026 às 13h50 (BRT), revisão funcional `6fea2fdb1477b00686ad4ea00d25265e1b429c1c`. API e web conferidas; cofre e depósito JUMA preservados. Resultado, testes, recuperação e limites do CI em `VALIDACAO-LOTES-2-3.md`. Os métodos ainda contidos e as dependências seguintes permanecem pendentes conforme descrito acima.


## Lote 4: Comercial e Financeiro — 04/11/2026

Base publicada integrada: Etapa 9 `1422e903d7df064912796f7867ff71c13f0b3086`; merge local `bd35af7`. O recorte adiciona oito GETs por carteira e quatro pontos de entrada da UI (Comercial, Financeiro e aliases Leads/Propostas). Autoridade deriva da ficha canônica e das relações financeiras, com revalidação atual e totais do conjunto autorizado. Nenhuma migration nova, concessão real ou escrituração financeira faz parte deste lote.

Coordenação executada: Terra high escreveu testes negativos antes da API; Sol high escreveu testes antes da UI e fez QA sintético em desktop/celular; Astra high revisou autorização, coerência das relações e paridade Prisma; o coordenador integrou a base publicada e reproduziu as falhas de CI. Evidências focais e limites estão em `REVISAO-COMERCIAL-FINANCEIRO.md`.

O CI tinha falhas de memória no TypeScript, paridade Prisma e fixtures anteriores aos contratos atuais de permissão, identidade e recibos. A checagem de tipos foi dividida em nove programas sequenciais, cobrindo todas as raízes configuradas e compartilhando raízes ambientais entre os lotes. Testes do runner comprovam reprovação por erros em lotes diferentes e por declarações globais incompatíveis. O prazo do job passou a 60 minutos para acomodar esse trabalho. Nenhum gate de falha ou piso de cobertura foi removido.

A inferência com servidor llama.cpp real ganhou comando separado `test:nativo`, que exige configuração explícita e recusa execução sem ela. Não foi validada uma inferência nativa nesta rodada. O conjunto padrão mantém os testes de autorização, recuperação e execução com fixtures; o teste de seleção de conjuntos impede que o caso nativo desapareça sem comando próprio.

Foram encontrados dois defeitos reais além das fixtures: o seed comercial variava eventos conforme o relógio, e a migração legada de memória tentava inserir novamente uma identidade protegida. Os reparos têm regressões de idempotência, concorrência e integridade do corpo. A reversão destrutiva da migração foi substituída por prévia e recusa explícita de execução; nenhuma dessas rotinas foi executada em produção.

Estado deste registro: implementação e focais concluídos; regressões integrais, CI do GitHub e publicação ainda em validação. Atualizar com commit, resultados e prova de runtime antes de declarar o lote publicado.
