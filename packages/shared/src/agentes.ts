/*
 * O CADASTRO ÚNICO DE AGENTES, ROTINAS E AUTOMAÇÕES (rodada dos agentes, 21/10/2026)
 *
 * Uma entrada por linha do levantamento de 21/10 (`docs/agentes/catalogo-levantamento-20261021.json`)
 * mais o vigia da agenda (AG-01). É daqui que leem os três seeds de agente, a tela
 * `/agentes`, a Equipe, os cartões de `/conexoes`, a documentação gerada e o
 * provedor de modelo (o `funcao` de cada chamada é o `id` daqui).
 *
 * O QUE É CADA TIPO
 *   agente     decide com modelo: tem `modelo` (Claude) ou `modeloExterno` (local).
 *   rotina     roda no relógio, sem modelo de linguagem.
 *   automacao  reage a evento ou sincroniza uma integração, sem modelo de linguagem.
 * O `modeloExterno` existe para o que não é Claude e mesmo assim gasta modelo
 * (embeddings e áudio da OpenAI, o Whisper e o llama.cpp locais): não entra na
 * escolha do provedor, só aparece na tela.
 *
 * O CÓDIGO MANDA. Onde o levantamento divergiu do código, a entrada daqui foi
 * corrigida e a divergência anotada em `homolog/RESULTADO-AGENTES.md`.
 *
 * `dono` é o dono PADRÃO, por área ([a decidir] pelo Rodrigo): a Equipe deixa
 * trocar, e a troca vive no banco, não aqui.
 * `estado` é o estado DECLARADO depois da publicação desta rodada; a tela mostra
 * ao lado o que o histórico de execuções diz.
 * `semente` diz em qual seed a linha vira registro `Agent` (os slugs desses três
 * seeds são os daqui, e o teste do cadastro confere os dois sentidos).
 * `rotina` é o tipo no histórico de rotinas (`RotinaExecucao.tipo`), de onde a
 * tela tira a última e a próxima execução.
 */

export type TipoDaFuncao = 'agente' | 'rotina' | 'automacao';
export type ModeloDaFuncao = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export type EsforcoDaFuncao = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type DonoDaFuncao = 'rodrigo' | 'lucas' | 'pedro';
export type EstadoDaFuncao = 'ativo' | 'desligado' | 'so-homologacao' | 'aposentado';
export type SementeDaFuncao = 'entrada' | 'onboarding' | 'tripulacao';
export type AreaDaFuncao =
  | 'Comercial'
  | 'Implantação'
  | 'Trabalho e pastas'
  | 'Conteúdo'
  | 'Financeiro'
  | 'Central e contexto'
  | 'Rotinas da casa'
  | 'Canais e integrações'
  | 'Receitas para clientes'
  | 'Agenda';

export interface FuncaoDoCadastro {
  /** CO-01, IM-07, AG-01… É o `funcao` das chamadas ao modelo. */
  id: string;
  /** O `agentSlug` do orçamento e do RASTRO; para os semeados, o slug do `Agent`. */
  slug: string;
  nome: string;
  area: AreaDaFuncao;
  tipo: TipoDaFuncao;
  /** Uma frase, em português, para a tela. */
  paraQueServe: string;
  gatilho: string;
  frequencia: string;
  le: string;
  escreve: string;
  /** Ids da política (catálogo base + delta). O teste confere que existem. */
  capacidades: readonly string[];
  /** O nível como o levantamento descreve (texto livre para a tela). */
  nivel: string;
  modelo: ModeloDaFuncao | null;
  esforco: EsforcoDaFuncao | null;
  modeloExterno?: string;
  dono: DonoDaFuncao;
  estado: EstadoDaFuncao;
  /** Onde mexer: o arquivo ou a pasta do código. */
  onde: string;
  semente?: readonly SementeDaFuncao[];
  rotina?: string;
  /** Escrito no plano, sem código ainda. */
  soNoPapel?: true;
}

export const MODELOS_DO_CADASTRO: readonly ModeloDaFuncao[] = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
export const ESFORCOS_DO_CADASTRO: readonly EsforcoDaFuncao[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DONOS_DO_CADASTRO: readonly DonoDaFuncao[] = ['rodrigo', 'lucas', 'pedro'];

/** As áreas que esta rodada construiu ou completou (as outras receberam só a fundação). */
export const AREAS_DA_RODADA_DOS_AGENTES: readonly AreaDaFuncao[] = [
  'Comercial',
  'Implantação',
  'Trabalho e pastas',
  'Rotinas da casa',
  'Canais e integrações',
  'Agenda',
];

/** As capacidades que a rodada dos agentes acrescentou ao delta da política (1.11.0). */
export const CAPACIDADES_DA_RODADA_DOS_AGENTES = [
  'comercial.lead.criar',
  'drive.pasta.criar',
  'drive.arquivo.enviar',
  'agenda.evento.padronizar',
] as const;

export const CADASTRO_DE_FUNCOES: readonly FuncaoDoCadastro[] = [
  {id: "CO-01", slug: "qualificador", nome: "Qualificador", area: "Comercial", tipo: "automacao", paraQueServe: "Pontua o lead que chega e prepara a mensagem de boas-vindas (M1) para uma pessoa aprovar.", gatilho: "lead.chegou", frequencia: "por lead", le: "Lead, ficha comercial", escreve: "pontuação, rascunho da M1", capacidades: ["comercial.whatsapp.enviar"], nivel: "M1 é R3 (pessoa aprova)", modelo: null, esforco: null, dono: "lucas", estado: "ativo", onde: "comercial/pontuacao.ts"},
  {id: "CO-02", slug: "agendador", nome: "Agendador", area: "Comercial", tipo: "automacao", paraQueServe: "Propõe horário de reunião e prepara convite e lembretes (M2/M3).", gatilho: "etapa de agendamento", frequencia: "por lead", le: "agenda, ficha", escreve: "mensagens, evento", capacidades: ["comercial.whatsapp.enviar","agenda.reuniao.marcar"], nivel: "R3", modelo: null, esforco: null, dono: "lucas", estado: "ativo", onde: "comercial/whatsapp.service.ts"},
  {id: "CO-03", slug: "leitor-de-ata-do-comercial", nome: "Leitor de ata do comercial", area: "Comercial", tipo: "agente", paraQueServe: "Lê a transcrição da reunião e tira dores e objeções com trecho literal e minuto, para o sócio aprovar o diagnóstico.", gatilho: "ata.chegou", frequencia: "por reunião", le: "transcrição da reunião", escreve: "diagnóstico, decisão na fila", capacidades: [], nivel: "sem capacidade; sócio aprova (A2)", modelo: "claude-opus-5-5", esforco: "high", dono: "lucas", estado: "ativo", onde: "comercial/diagnostico.service.ts"},
  {id: "CO-04", slug: "construtor-de-proposta", nome: "Construtor de proposta", area: "Comercial", tipo: "agente", paraQueServe: "Monta a proposta: o preço sai da tabela de 04/10 e o modelo escreve só o trecho de como a Root é diferente.", gatilho: "diagnóstico aprovado", frequencia: "por lead", le: "diagnóstico, tabela de preço", escreve: "proposta", capacidades: ["comercial.proposta.publicar"], nivel: "comercial.proposta.publicar R3", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "lucas", estado: "ativo", onde: "comercial/proposta.service.ts"},
  {id: "CO-05", slug: "revisor-de-proposta", nome: "Revisor de proposta", area: "Comercial", tipo: "automacao", paraQueServe: "Confere a proposta por regras antes de publicar e devolve um laudo.", gatilho: "proposta montada", frequencia: "por proposta", le: "proposta", escreve: "laudo", capacidades: [], nivel: "só laudo", modelo: null, esforco: null, dono: "lucas", estado: "ativo", onde: "comercial/proposta-construtor.ts"},
  {id: "CO-06", slug: "assistente-da-sala", nome: "Assistente da sala", area: "Comercial", tipo: "agente", paraQueServe: "Responde a dúvida que o cliente deixa na sala da proposta; a resposta vira pedido de envio para uma pessoa aprovar.", gatilho: "dúvida na sala", frequencia: "sob demanda", le: "proposta, dúvida", escreve: "decisão de envio", capacidades: [], nivel: "sem capacidade; pessoa aprova", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "lucas", estado: "ativo", onde: "comercial/assistente.service.ts"},
  {id: "CO-07", slug: "follow-up", nome: "Follow-up", area: "Comercial", tipo: "rotina", paraQueServe: "Prepara as mensagens de retomada (M5/M6) quando o lead leu e não respondeu ou ficou em silêncio.", gatilho: "relógio do comercial", frequencia: "diário", le: "fio do lead", escreve: "mensagens", capacidades: ["comercial.whatsapp.enviar"], nivel: "comercial.whatsapp.enviar R3", modelo: null, esforco: null, dono: "lucas", estado: "desligado", onde: "comercial/whatsapp.service.ts"},
  {id: "CO-08", slug: "assinador", nome: "Assinador", area: "Comercial", tipo: "automacao", paraQueServe: "Gera o contrato na ZapSign e acompanha a assinatura.", gatilho: "aceite", frequencia: "por fechamento", le: "contrato modelo", escreve: "documento", capacidades: ["comercial.contrato.enviar","drive.arquivo.enviar"], nivel: "comercial.contrato.enviar R4; cópia ao Drive drive.arquivo.enviar R3", modelo: null, esforco: null, dono: "lucas", estado: "so-homologacao", onde: "comercial/dinheiro.service.ts e comercial/assinado-na-pasta.service.ts"},
  {id: "CO-09", slug: "cobrador", nome: "Cobrador", area: "Comercial", tipo: "automacao", paraQueServe: "Cria a cobrança no Asaas e segue a régua do contrato vivo.", gatilho: "aceite e mês a mês", frequencia: "por fechamento", le: "contrato", escreve: "cobrança", capacidades: ["comercial.cobranca.criar"], nivel: "comercial.cobranca.criar R4", modelo: null, esforco: null, dono: "lucas", estado: "so-homologacao", onde: "comercial/dinheiro.service.ts"},
  {id: "CO-10", slug: "fechador", nome: "Fechador", area: "Comercial", tipo: "automacao", paraQueServe: "Executa as 7 escritas do fechamento: cliente, cobrança, contrato, kit e trilho, card, grupo e a pasta do cliente no Drive.", gatilho: "assinatura da titular", frequencia: "por fechamento", le: "lead, ficha", escreve: "cliente, contrato, trilho, card, grupo, pasta do cliente", capacidades: ["comercial.fechamento.executar","drive.pasta.criar"], nivel: "comercial.fechamento.executar R4; pasta drive.pasta.criar R3", modelo: null, esforco: null, dono: "lucas", estado: "ativo", onde: "comercial/fechamento.service.ts"},
  {id: "CO-11", slug: "vigia-das-08h", nome: "Vigia das 08h", area: "Comercial", tipo: "agente", paraQueServe: "Lista as exceções do funil (lead parado, prazo vencido), abre decisões na fila e escreve no topo um resumo de três linhas com os números do sistema.", gatilho: "diário 08:00", frequencia: "diário", le: "funil, fio", escreve: "nota do vigia, decisões", capacidades: [], nivel: "sem capacidade", modelo: "claude-haiku-5-5", esforco: "low", dono: "lucas", estado: "ativo", onde: "comercial/vigia.service.ts e comercial/vigia-resumo.ts"},
  {id: "CO-12", slug: "relator-da-quinta", nome: "Relator da quinta", area: "Comercial", tipo: "agente", paraQueServe: "Escreve a narrativa da semana comercial; os números vêm do sistema.", gatilho: "quinta 18:00", frequencia: "semanal", le: "eventos da semana", escreve: "nota do relatório", capacidades: [], nivel: "sem capacidade", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "lucas", estado: "ativo", onde: "comercial/relatorio-da-semana.service.ts"},
  {id: "CO-13", slug: "construtor-de-contrato-da-root", nome: "Construtor de contrato da Root", area: "Comercial", tipo: "agente", paraQueServe: "Redige a minuta do contrato da Root a partir da proposta aceita, com inserções e lacunas marcadas.", gatilho: "aceite", frequencia: "por fechamento", le: "proposta, ficha, modelo de contrato", escreve: "minuta em 02-contrato", capacidades: ["contexto.arquivo.listar","contexto.arquivo.ler","drive.arquivo.enviar"], nivel: "rascunho no OS; cópia ao Drive drive.arquivo.enviar R3 (sócio revisa)", modelo: "claude-opus-5-5", esforco: "high", dono: "lucas", estado: "ativo", onde: "comercial/contrato-da-root/"},
  {id: "CO-14", slug: "revisor-de-contrato-da-root", nome: "Revisor de contrato da Root", area: "Comercial", tipo: "agente", paraQueServe: "Confere a minuta: valor por extenso e em algarismo, remissões, partes e lacunas.", gatilho: "minuta pronta", frequencia: "por contrato", le: "minuta", escreve: "laudo", capacidades: [], nivel: "só laudo", modelo: "claude-opus-5-5", esforco: "high", dono: "lucas", estado: "ativo", onde: "comercial/contrato-da-root/"},
  {id: "CO-15", slug: "entrada-pelo-formulario-do-site", nome: "Entrada pelo formulário do site", area: "Comercial", tipo: "automacao", paraQueServe: "Recebe o formulário de operacaoroot.com e cria o lead no funil.", gatilho: "formulário enviado", frequencia: "por envio", le: "formulário", escreve: "lead", capacidades: ["comercial.lead.criar"], nivel: "comercial.lead.criar R1 (capacidade nova)", modelo: null, esforco: null, dono: "lucas", estado: "ativo", onde: "comercial/formulario-do-site/ e comercial/lead-criar.service.ts"},
  {id: "CO-16", slug: "triagem-do-whatsapp", nome: "Triagem do WhatsApp", area: "Comercial", tipo: "agente", paraQueServe: "Classifica cada mensagem que chega (lead novo, dúvida, documento, cliente ativo) e encaminha para o lugar certo.", gatilho: "mensagem recebida", frequencia: "por mensagem", le: "mensagem", escreve: "fio do lead ou caixa", capacidades: ["comercial.lead.criar"], nivel: "leitura R0; lead novo comercial.lead.criar R1", modelo: "claude-haiku-5-5", esforco: "low", dono: "lucas", estado: "desligado", onde: "comercial/triagem-do-whatsapp/ e comercial/evolution-entrada.service.ts (liga com WHATSAPP_PROVEDOR=evolution e a nota comercial.whatsapp.triagem = ligada)"},
  {id: "IM-01", slug: "leitor-de-ata", nome: "Leitor de ata do onboarding", area: "Implantação", tipo: "agente", paraQueServe: "Lê a ata da reunião (texto ou PDF), separa o que o cliente disse literalmente do que é interpretação e preenche o formulário do trilho.", gatilho: "ata colada no trilho", frequencia: "por cliente", le: "ata, triagem", escreve: "ata (sem transcrição), itens do trilho, marco ata.notas, ata gerada em 03-kickoff", capacidades: ["drive.arquivo.enviar"], nivel: "R1; sócio aprova o interpretado; ata ao Drive drive.arquivo.enviar R3", modelo: "claude-opus-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "onboarding/trilho/leitura-da-ata.service.ts", semente: ["onboarding"]},
  {id: "IM-02", slug: "pesquisador-de-conta", nome: "Pesquisador de conta", area: "Implantação", tipo: "agente", paraQueServe: "Monta o dossiê da empresa do cliente e as hipóteses para o kickoff.", gatilho: "trilho na fase Diagnóstico", frequencia: "por cliente", le: "triagem, texto colado pelo sócio", escreve: "dossiê", capacidades: ["contexto.memoria.buscar"], nivel: "R1", modelo: "claude-opus-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "onboarding/trilho/leitura-da-ata.service.ts e dossie.ts (pelo laço do agente; busca na web atrás da nota onboarding.pesquisa.web)", semente: ["onboarding"]},
  {id: "IM-03", slug: "roteirista-de-kickoff", nome: "Roteirista do kickoff", area: "Implantação", tipo: "agente", paraQueServe: "Reescreve as perguntas do kickoff para o cliente específico.", gatilho: "dossiê pronto", frequencia: "por cliente", le: "dossiê, espinha", escreve: "roteiro personalizado", capacidades: [], nivel: "R1", modelo: "claude-sonnet-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "onboarding/trilho/roteirista.ts", semente: ["onboarding"]},
  {id: "IM-04", slug: "carregador-de-contexto", nome: "Carregador de contexto", area: "Implantação", tipo: "rotina", paraQueServe: "Grava as respostas da carga guiada como notas da memória do cliente.", gatilho: "resposta em /entrar", frequencia: "por resposta", le: "resposta", escreve: "nota da memória", capacidades: [], nivel: "R1", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "onboarding/carga-guiada.ts", semente: ["entrada"]},
  {id: "IM-05", slug: "relogio-do-onboarding", nome: "Relógio do onboarding", area: "Implantação", tipo: "rotina", paraQueServe: "Confere os prazos do trilho e grava o lembrete pronto, sem enviar.", gatilho: "diário 09:00", frequencia: "diário", le: "trilhos", escreve: "marco com a mensagem", capacidades: [], nivel: "grava; enviar é R3", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "onboarding/trilho/relogio.executor.ts", rotina: "onboarding.relogio"},
  {id: "IM-06", slug: "transcricao-de-audio", nome: "Transcrição de áudio", area: "Implantação", tipo: "automacao", paraQueServe: "Transcreve a resposta em áudio que o cliente deixa no link do kickoff.", gatilho: "áudio enviado", frequencia: "por áudio", le: "áudio", escreve: "texto", capacidades: [], nivel: "dentro do teto diário (reserva por minuto)", modelo: null, esforco: null, modeloExterno: "openai:gpt-4o-transcribe", dono: "pedro", estado: "desligado", onde: "llm/transcricao.provider.ts"},
  {id: "IM-07", slug: "montador-do-kit", nome: "Montador do kit", area: "Implantação", tipo: "agente", paraQueServe: "Monta o kit de implantação a partir do manifesto e grava em 03-kickoff do cliente.", gatilho: "etapa Kit montado", frequencia: "por cliente", le: "manifesto, contexto do cliente", escreve: "kit e índice em 03-kickoff; marco kit.montado", capacidades: ["drive.arquivo.enviar"], nivel: "kit no OS; cópia ao Drive drive.arquivo.enviar R3", modelo: "claude-sonnet-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "onboarding/trilho/kit/"},
  {id: "TR-01", slug: "leitor-de-atas", nome: "Leitor de atas", area: "Trabalho e pastas", tipo: "agente", paraQueServe: "Lê a ata (do vault ou colada) e sugere tarefas com trecho, lista, dono e prazo; a pessoa aceita ou descarta.", gatilho: "botão Sugerir tarefas", frequencia: "por ata", le: "ata", escreve: "sugestões de tarefa", capacidades: ["drive.arquivo.enviar"], nivel: "sem capacidade; só gente aceita; ata ao Drive drive.arquivo.enviar R3", modelo: "claude-sonnet-5-5", esforco: "high", dono: "rodrigo", estado: "ativo", onde: "work/atas/leitor-de-atas.ts"},
  {id: "TR-02", slug: "leitor-do-granola", nome: "Leitor do Granola", area: "Trabalho e pastas", tipo: "agente", paraQueServe: "Puxa a reunião do Granola e gera ata, decisões, pendências e sugestões numa chamada só.", gatilho: "Gerar ata", frequencia: "por reunião", le: "transcrição do Granola", escreve: "nota da ata, sugestões, reunião no card", capacidades: [], nivel: "sem capacidade; leitura fora da porta", modelo: "claude-sonnet-5-5", esforco: "high", dono: "rodrigo", estado: "ativo", onde: "work/atas/atas-do-granola.service.ts"},
  {id: "TR-03", slug: "granola-para-a-ficha", nome: "Granola para a ficha", area: "Trabalho e pastas", tipo: "automacao", paraQueServe: "Recebe a reunião do Granola por webhook e grava no card do cliente.", gatilho: "webhook", frequencia: "por reunião", le: "Granola", escreve: "reunião no card", capacidades: [], nivel: "conector com interruptor", modelo: null, esforco: null, dono: "rodrigo", estado: "ativo", onde: "ficha/granola.service.ts"},
  {id: "TR-04", slug: "criador-da-pasta-do-cliente", nome: "Criador da pasta do cliente", area: "Trabalho e pastas", tipo: "automacao", paraQueServe: "Copia o _modelo-cliente para 10-clientes/<cliente> e grava o link no cliente, na ficha e no card.", gatilho: "fechamento, Iniciar onboarding ou Registrar já fechado", frequencia: "por cliente", le: "cliente, card", escreve: "pasta no Drive, link no cliente", capacidades: ["drive.pasta.criar"], nivel: "drive.pasta.criar R3", modelo: null, esforco: null, dono: "rodrigo", estado: "ativo", onde: "clientes/pasta-do-cliente/"},
  {id: "TR-05", slug: "arquivista-do-cliente", nome: "Arquivista do cliente", area: "Trabalho e pastas", tipo: "agente", paraQueServe: "Classifica cada arquivo que chega (sala, anexo de tarefa, contrato assinado, ata) e põe na subpasta certa (01 a 07) com nome padrão.", gatilho: "arquivo novo", frequencia: "por arquivo", le: "arquivo, cliente", escreve: "arquivo na subpasta, link na tarefa", capacidades: ["drive.arquivo.enviar"], nivel: "drive.arquivo.enviar R3", modelo: "claude-haiku-5-5", esforco: "low", dono: "rodrigo", estado: "ativo", onde: "clientes/arquivista/"},
  {id: "TR-06", slug: "anexo-na-tarefa", nome: "Anexo na tarefa", area: "Trabalho e pastas", tipo: "automacao", paraQueServe: "Deixa subir arquivo na tarefa e guarda na pasta do cliente dela.", gatilho: "upload", frequencia: "por arquivo", le: "arquivo", escreve: "arquivo no Drive, link", capacidades: ["drive.arquivo.enviar"], nivel: "anexo no OS; cópia ao Drive drive.arquivo.enviar R3", modelo: null, esforco: null, dono: "rodrigo", estado: "ativo", onde: "work/anexos/"},
  {id: "TR-07", slug: "cobrador-de-tarefas", nome: "Cobrador de tarefas", area: "Trabalho e pastas", tipo: "agente", paraQueServe: "Aponta tarefa vencida, sem dono ou parada e manda o resumo do dia para cada pessoa.", gatilho: "diário", frequencia: "diário", le: "tarefas", escreve: "aviso na caixa", capacidades: [], nivel: "R0", modelo: "claude-haiku-5-5", esforco: "low", dono: "rodrigo", estado: "desligado", onde: "work/cobranca/", rotina: "trabalho.cobranca"},
  {id: "TR-08", slug: "triagem-da-caixa", nome: "Triagem da caixa", area: "Trabalho e pastas", tipo: "agente", paraQueServe: "Agrupa a atividade de Pendências por cliente e urgência.", gatilho: "ao abrir a caixa", frequencia: "sob demanda", le: "atividade, comentários", escreve: "ordem da caixa", capacidades: [], nivel: "R0", modelo: "claude-haiku-5-5", esforco: "low", dono: "rodrigo", estado: "ativo", onde: "work/triagem-da-caixa/triagem-da-caixa.service.ts"},
  {id: "TR-09", slug: "delegador", nome: "Delegador", area: "Trabalho e pastas", tipo: "agente", paraQueServe: "Reparte o trabalho de uma tarefa grande entre agentes e pessoas.", gatilho: "tarefa atribuída a agente", frequencia: "sob demanda", le: "tarefa, catálogo de agentes", escreve: "subtarefas", capacidades: [], nivel: "só sugestão; uma pessoa aceita", modelo: "claude-opus-5-5", esforco: "high", dono: "rodrigo", estado: "ativo", onde: "work/delegador/"},
  {id: "TR-10", slug: "limpeza-das-aprovacoes", nome: "Limpeza das aprovações", area: "Trabalho e pastas", tipo: "rotina", paraQueServe: "Expira as aprovações vencidas às 03:00.", gatilho: "diário 03:00", frequencia: "diário", le: "aprovações", escreve: "aprovações", capacidades: [], nivel: "", modelo: null, esforco: null, dono: "rodrigo", estado: "ativo", onde: "approvals/limpeza-das-vencidas.ts"},
  {id: "CT-01", slug: "editor-de-pauta", nome: "Editor de pauta", area: "Conteúdo", tipo: "rotina", paraQueServe: "Dono cadastrado das 5 rotinas da pauta; não executa nada por conta própria.", gatilho: "", frequencia: "", le: "", escreve: "", capacidades: [], nivel: "R1", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "routines/rotina.tipos.ts", semente: ["tripulacao"]},
  {id: "CT-02", slug: "ficha-da-referencia", nome: "Ficha da referência", area: "Conteúdo", tipo: "agente", paraQueServe: "Gera a ficha de 14 campos de cada referência capturada.", gatilho: "captura processada", frequencia: "por captura", le: "página ou post", escreve: "ficha da referência", capacidades: [], nivel: "automacoes.executar; vetorização no teto diário", modelo: "claude-haiku-5-5", esforco: "medium", dono: "pedro", estado: "ativo", onde: "pauta/pauta.service.ts"},
  {id: "CT-03", slug: "curadoria-de-quinta", nome: "Curadoria de quinta", area: "Conteúdo", tipo: "agente", paraQueServe: "Coleta as fontes da semana e sugere quais itens marcar para o episódio.", gatilho: "quinta 22:00", frequencia: "semanal", le: "até 200 capturas", escreve: "rodada em curadoria", capacidades: [], nivel: "R0 na coleta", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "pedro", estado: "ativo", onde: "pauta/curadoria-da-rodada.ts", rotina: "pauta.coleta"},
  {id: "CT-04", slug: "rodada-antiga-miolo-e-pecas", nome: "Rodada antiga (miolo e peças)", area: "Conteúdo", tipo: "agente", paraQueServe: "Escreve o miolo da rodada e deriva uma peça por canal.", gatilho: "rotina pauta.rodada", frequencia: "conforme a rotina", le: "capturas", escreve: "peças", capacidades: [], nivel: "", modelo: "claude-sonnet-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "pauta/rodada.service.ts", rotina: "pauta.rodada"},
  {id: "CT-05", slug: "roteiro-do-episodio", nome: "Roteiro do episódio", area: "Conteúdo", tipo: "agente", paraQueServe: "Escreve o roteiro na voz do autor a partir das matérias escolhidas.", gatilho: "botão", frequencia: "por episódio", le: "itens, voz, marca", escreve: "roteiro", capacidades: [], nivel: "pauta.editar", modelo: "claude-opus-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "pauta/roteiro.service.ts"},
  {id: "CT-06", slug: "pacote-do-youtube", nome: "Pacote do YouTube", area: "Conteúdo", tipo: "agente", paraQueServe: "Títulos, descrição com capítulos e briefs de thumb a partir da transcrição.", gatilho: "botão ou encadeamento", frequencia: "por episódio", le: "transcrição", escreve: "pacote", capacidades: [], nivel: "pauta.editar", modelo: "claude-sonnet-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "pauta/pacote.service.ts"},
  {id: "CT-07", slug: "newsletter", nome: "Newsletter", area: "Conteúdo", tipo: "agente", paraQueServe: "Escreve a newsletter a partir da transcrição, com uma refação se reprovar na checagem anti-slop.", gatilho: "botão ou encadeamento", frequencia: "por episódio", le: "transcrição, voz", escreve: "newsletter", capacidades: [], nivel: "pauta.editar", modelo: "claude-opus-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "pauta/newsletter.service.ts"},
  {id: "CT-08", slug: "semana-de-posts", nome: "Semana de posts", area: "Conteúdo", tipo: "agente", paraQueServe: "Gera carrossel, story e corte para cada matéria do episódio.", gatilho: "botão ou encadeamento", frequencia: "por matéria", le: "transcrição, voz", escreve: "3 peças por matéria", capacidades: [], nivel: "pauta.editar", modelo: "claude-sonnet-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "pauta/derivacao.service.ts"},
  {id: "CT-09", slug: "voz-do-autor", nome: "Voz do autor", area: "Conteúdo", tipo: "agente", paraQueServe: "Aprende o perfil de voz a partir de episódios e textos.", gatilho: "botão", frequencia: "raro", le: "transcrições, textos", escreve: "perfil de voz", capacidades: [], nivel: "pauta.editar", modelo: "claude-opus-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "pauta/voz.service.ts"},
  {id: "CT-10", slug: "dossie-de-concorrente", nome: "Dossiê de concorrente", area: "Conteúdo", tipo: "agente", paraQueServe: "Lê os posts de um perfil observado e explica o que rende, com os números já calculados.", gatilho: "botão", frequencia: "por perfil", le: "posts e métricas", escreve: "dossiê", capacidades: [], nivel: "pauta.editar", modelo: "claude-sonnet-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "pauta/concorrentes.service.ts"},
  {id: "CT-11", slug: "estrategia-do-mes", nome: "Estratégia do mês", area: "Conteúdo", tipo: "agente", paraQueServe: "Propõe pilares, cadência, metas, apostas e o que parar.", gatilho: "botão", frequencia: "mensal", le: "marca, dossiês, publicadas", escreve: "estratégia do mês", capacidades: [], nivel: "pauta.editar", modelo: "claude-opus-5-5", esforco: "high", dono: "pedro", estado: "ativo", onde: "pauta/estrategia.service.ts"},
  {id: "CT-12", slug: "banco-de-ideias", nome: "Banco de ideias", area: "Conteúdo", tipo: "agente", paraQueServe: "Propõe ideias por pilar com gancho, roteiro e legenda; a pessoa aprova.", gatilho: "botão", frequencia: "sob demanda", le: "marca, pilares", escreve: "ideias", capacidades: [], nivel: "pauta.editar", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "pedro", estado: "ativo", onde: "pauta/ideias.service.ts"},
  {id: "CT-13", slug: "relatorio-do-mes", nome: "Relatório do mês", area: "Conteúdo", tipo: "agente", paraQueServe: "Escreve a leitura do mês de conteúdo; os números vêm do banco.", gatilho: "rotina mensal", frequencia: "mensal", le: "publicadas, estratégia", escreve: "relatório do mês", capacidades: [], nivel: "", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "pedro", estado: "desligado", onde: "pauta/relatorio.service.ts", rotina: "pauta.relatorio"},
  {id: "CT-14", slug: "encadeamento", nome: "Encadeamento", area: "Conteúdo", tipo: "rotina", paraQueServe: "Anda um passo por episódio chamando os serviços da pauta; nunca publica.", gatilho: "a cada 5 min", frequencia: "contínuo", le: "episódios", escreve: "passos", capacidades: [], nivel: "system", modelo: null, esforco: null, dono: "pedro", estado: "desligado", onde: "pauta/encadeamento.service.ts", rotina: "pauta.encadear"},
  {id: "CT-15", slug: "publicador", nome: "Publicador", area: "Conteúdo", tipo: "rotina", paraQueServe: "Publica no Instagram e no YouTube o que foi aprovado no lote da semana.", gatilho: "a cada 1 min", frequencia: "contínuo", le: "lote da semana", escreve: "publicação", capacidades: ["instagram.post.publicar","youtube.video.publicar"], nivel: "R3 sob lote R4", modelo: null, esforco: null, dono: "pedro", estado: "desligado", onde: "routines/executores/pauta-publicar.executor.ts", rotina: "pauta.publicar-agendadas"},
  {id: "CT-16", slug: "comentarios-e-dm", nome: "Comentários e DM", area: "Conteúdo", tipo: "rotina", paraQueServe: "Lê comentários com a palavra-chave e manda a DM aprovada no lote.", gatilho: "a cada 10 min", frequencia: "contínuo", le: "comentários", escreve: "fila da DM, envios", capacidades: ["instagram.comentario.ler","instagram.resposta_privada.enviar","instagram.regra_de_resposta.pausar"], nivel: "R0 e R3 sob lote", modelo: null, esforco: null, dono: "pedro", estado: "desligado", onde: "pauta/dm-automatica.service.ts", rotina: "pauta.coletar-comentarios"},
  {id: "CT-17", slug: "vigia-do-mac", nome: "Vigia do Mac", area: "Conteúdo", tipo: "automacao", paraQueServe: "Corta, transcreve e manda o vídeo do episódio a partir da gravação do OBS.", gatilho: "launchd no Mac", frequencia: "contínuo", le: "gravação", escreve: "mídia, transcrição", capacidades: ["youtube.video.enviar"], nivel: "login normal", modelo: null, esforco: null, modeloExterno: "local:whisper", dono: "pedro", estado: "ativo", onde: "tools/root-midia/lib/vigia.mjs"},
  {id: "CT-18", slug: "grupo-de-links", nome: "Grupo de links", area: "Conteúdo", tipo: "automacao", paraQueServe: "Link colado no grupo de WhatsApp vira captura, sem IA.", gatilho: "mensagem no grupo", frequencia: "por link", le: "link", escreve: "captura", capacidades: [], nivel: "", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "pauta/entrada-de-links.service.ts"},
  {id: "CT-19", slug: "performance-da-casa", nome: "Performance da casa", area: "Conteúdo", tipo: "automacao", paraQueServe: "Coleta os números da conta e compara cada post com a mediana da própria casa.", gatilho: "botão", frequencia: "mensal", le: "Instagram", escreve: "performance do mês", capacidades: ["social.instagram.midia"], nivel: "R0", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "pauta/performance"},
  {id: "FI-01", slug: "analise-do-financeiro", nome: "Análise do financeiro", area: "Financeiro", tipo: "agente", paraQueServe: "Lê os números do financeiro e escreve a análise.", gatilho: "botão", frequencia: "sob demanda", le: "lançamentos, DRE", escreve: "texto da análise", capacidades: [], nivel: "sem capacidade", modelo: "claude-sonnet-5-5", esforco: "high", dono: "lucas", estado: "ativo", onde: "finance/analise.service.ts"},
  {id: "FI-02", slug: "conciliador-bancario", nome: "Conciliador bancário", area: "Financeiro", tipo: "rotina", paraQueServe: "Sincroniza Pluggy e Asaas a cada 6 h e casa movimentos por score.", gatilho: "a cada 360 min", frequencia: "4x por dia", le: "bancos", escreve: "lançamentos", capacidades: [], nivel: "R0", modelo: null, esforco: null, dono: "lucas", estado: "ativo", onde: "finance/finance.service.ts", semente: ["tripulacao"], rotina: "casa.conciliacao"},
  {id: "FI-03", slug: "fechamento-do-mes", nome: "Fechamento do mês", area: "Financeiro", tipo: "agente", paraQueServe: "Confere conciliação, DRE e pendências e escreve o resumo do mês.", gatilho: "dia 1", frequencia: "mensal", le: "financeiro", escreve: "relatório", capacidades: [], nivel: "R1", modelo: "claude-sonnet-5-5", esforco: "high", dono: "lucas", estado: "desligado", onde: "", soNoPapel: true},
  {id: "FI-04", slug: "cobranca-de-atrasados", nome: "Cobrança de atrasados", area: "Financeiro", tipo: "agente", paraQueServe: "Lista atrasos e prepara a mensagem de cobrança para a pessoa aprovar.", gatilho: "diário", frequencia: "diário", le: "Asaas, contratos", escreve: "mensagem", capacidades: [], nivel: "R3", modelo: "claude-haiku-5-5", esforco: "low", dono: "lucas", estado: "desligado", onde: "", soNoPapel: true},
  {id: "CE-01", slug: "assistente", nome: "Assistente da central", area: "Central e contexto", tipo: "agente", paraQueServe: "Responde no Perguntar à central usando ferramentas de leitura: memória, painel, leads, tarefas e financeiro.", gatilho: "pergunta", frequencia: "sob demanda", le: "várias, pela porta", escreve: "sessão, chamadas de ferramenta", capacidades: ["contexto.memoria.buscar","numeros.painel.ler","financeiro.resumo.ler","financeiro.kpi.ler","financeiro.pagavel.listar","crm.lead.buscar","operacao.tarefa.listar","operacao.tarefa.atrasada","pecas.campanha.listar"], nivel: "R1, até 12 capacidades", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "pedro", estado: "ativo", onde: "agents/roster/roster.ts e prisma/seed-tripulacao.ts", semente: ["entrada","tripulacao"]},
  {id: "CE-02", slug: "briefing-diario", nome: "Briefing diário", area: "Central e contexto", tipo: "agente", paraQueServe: "Resumo da manhã com funil, tarefas e financeiro.", gatilho: "cron 08:00 no cadastro", frequencia: "diário", le: "5 leituras", escreve: "sessão", capacidades: ["numeros.painel.ler","operacao.tarefa.atrasada","pecas.campanha.listar","financeiro.resumo.ler"], nivel: "R1", modelo: "claude-sonnet-5-5", esforco: "low", dono: "pedro", estado: "ativo", onde: "prisma/seed-tripulacao.ts", semente: ["tripulacao"]},
  {id: "CE-03", slug: "briefing-antigo", nome: "Briefing antigo", area: "Central e contexto", tipo: "agente", paraQueServe: "Relatório antigo de analista de marketing, sem porta e sem rastro.", gatilho: "chamada manual", frequencia: "sob demanda", le: "painel", escreve: "relatório", capacidades: [], nivel: "fora da porta", modelo: "claude-sonnet-5-5", esforco: "low", dono: "pedro", estado: "ativo", onde: "reports/reports.service.ts"},
  {id: "CE-04", slug: "procedimento-local", nome: "Procedimento local", area: "Central e contexto", tipo: "agente", paraQueServe: "Resume uma nota da memória com modelo local (llama.cpp), criado pelo Pedro.", gatilho: "manual", frequencia: "sob demanda", le: "nota da memória", escreve: "operação local", capacidades: [], nivel: "R1", modelo: null, esforco: "low", modeloExterno: "local:llama.cpp", dono: "pedro", estado: "ativo", onde: "agents/procedimento-do-agente.service.ts"},
  {id: "CE-05", slug: "indexador-vault", nome: "Indexador do vault", area: "Central e contexto", tipo: "rotina", paraQueServe: "Reindexa o vault e gera embeddings a cada 30 min.", gatilho: "a cada 30 min", frequencia: "48x por dia", le: "vault", escreve: "notas indexadas", capacidades: [], nivel: "R0; vetorização no teto diário", modelo: null, esforco: null, modeloExterno: "openai:text-embedding-3-small", dono: "pedro", estado: "ativo", onde: "obsidian/obsidian.service.ts", semente: ["tripulacao"], rotina: "casa.vault"},
  {id: "CE-06", slug: "despertador-por-evento", nome: "Despertador por evento", area: "Central e contexto", tipo: "automacao", paraQueServe: "Acorda o agente quando algo acontece: atribuição, menção ou aprovação resolvida.", gatilho: "evento", frequencia: "", le: "eventos", escreve: "fila de batidas", capacidades: [], nivel: "", modelo: null, esforco: null, dono: "pedro", estado: "desligado", onde: "docs/especificacoes/A6-heartbeat-por-evento.md", soNoPapel: true},
  {id: "RO-01", slug: "sincronizador-clickup", nome: "Sincronizador do ClickUp", area: "Rotinas da casa", tipo: "rotina", paraQueServe: "Traz as tarefas do ClickUp a cada 60 min, só para a empresa root.", gatilho: "a cada 60 min", frequencia: "24x por dia", le: "ClickUp", escreve: "tarefas", capacidades: [], nivel: "R0", modelo: null, esforco: null, dono: "pedro", estado: "desligado", onde: "integrations/clickup.service.ts", semente: ["tripulacao"], rotina: "casa.clickup"},
  {id: "RO-02", slug: "coletor-bio", nome: "Coletor da bio", area: "Rotinas da casa", tipo: "rotina", paraQueServe: "Atualiza os dados da página de links a cada 6 h.", gatilho: "a cada 360 min", frequencia: "4x por dia", le: "plataformas", escreve: "bio", capacidades: [], nivel: "R0", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "bio/bio-sync.service.ts", semente: ["tripulacao"], rotina: "casa.bio"},
  {id: "RO-03", slug: "ponte-metas", nome: "Ponte das metas", area: "Rotinas da casa", tipo: "rotina", paraQueServe: "Leva cliques da bio para as metas a cada 12 h.", gatilho: "a cada 720 min", frequencia: "2x por dia", le: "bio", escreve: "metas", capacidades: [], nivel: "R0", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "bio/bio-bridge.service.ts", semente: ["tripulacao"], rotina: "casa.metas"},
  {id: "RO-04", slug: "relogio-do-comercial", nome: "Relógio do comercial", area: "Rotinas da casa", tipo: "rotina", paraQueServe: "Dispara o relógio do comercial: 8 tarefas de relógio e 21 reações inscritas, por empresa.", gatilho: "a cada 1 min, por empresa", frequencia: "contínuo", le: "fio dos leads", escreve: "reações", capacidades: [], nivel: "R0", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "comercial/relogio-da-espinha.ts", rotina: "comercial.relogio"},
  {id: "CA-01", slug: "entrada-do-digisac-excluida", nome: "Entrada do DigiSac (excluída)", area: "Canais e integrações", tipo: "automacao", paraQueServe: "Excluído em 21/10/2026: o WhatsApp do comercial entra pela Evolution.", gatilho: "webhook", frequencia: "por mensagem", le: "DigiSac", escreve: "fio do lead", capacidades: [], nivel: "conector com interruptor", modelo: null, esforco: null, dono: "pedro", estado: "aposentado", onde: "— (excluído em 21/10/2026)"},
  {id: "CA-02", slug: "aprovacao-pelo-whatsapp", nome: "Aprovação pelo WhatsApp", area: "Canais e integrações", tipo: "automacao", paraQueServe: "Avisa no WhatsApp que há aprovação esperando.", gatilho: "pedido de aprovação", frequencia: "por pedido", le: "fila", escreve: "mensagem", capacidades: [], nivel: "notifica, não decide", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "gateway/canais/ (o número de cada pessoa é cadastrado na Equipe: agents/equipe.service.ts, tela /organograma)"},
  {id: "CA-03", slug: "servidor-mcp", nome: "Servidor MCP", area: "Canais e integrações", tipo: "automacao", paraQueServe: "35 ferramentas só de leitura para usar o OS pelo Claude Desktop ou Claude Code.", gatilho: "cliente MCP", frequencia: "sob demanda", le: "API", escreve: "", capacidades: [], nivel: "conta ia_servico (leitura)", modelo: null, esforco: null, dono: "pedro", estado: "ativo", onde: "packages/mcp/src/server.ts"},
  {id: "CA-04", slug: "ponte-de-modelo", nome: "Ponte de modelo", area: "Canais e integrações", tipo: "automacao", paraQueServe: "Faz a homologação chamar o Claude pela linha de comando da assinatura, no modelo que a função pede; nunca com chave de API.", gatilho: "chamada na homologação", frequencia: "", le: "", escreve: "", capacidades: [], nivel: "", modelo: null, esforco: null, dono: "pedro", estado: "so-homologacao", onde: "homolog/ponte-modelo/ponte.mjs"},
  {id: "CA-05", slug: "bot-do-telegram-e-a-conta-ia-acao", nome: "Bot do Telegram e a conta ia-acao@", area: "Canais e integrações", tipo: "automacao", paraQueServe: "Aposentado em 11/09; a conta de máquina ia-acao@ é desativada nesta rodada (nunca apagada).", gatilho: "", frequencia: "", le: "", escreve: "", capacidades: [], nivel: "ia-acao@ com 6 permissões de escrita", modelo: null, esforco: null, dono: "pedro", estado: "aposentado", onde: "docker-compose.yml (lápide)"},
  {id: "RE-01", slug: "arquivista-documental", nome: "Arquivista documental", area: "Receitas para clientes", tipo: "agente", paraQueServe: "Organiza os documentos do cliente em pastas, com nome padrão e índice.", gatilho: "arquivo novo", frequencia: "por arquivo", le: "pasta do cliente", escreve: "pastas organizadas", capacidades: [], nivel: "R1", modelo: "claude-haiku-5-5", esforco: "low", dono: "pedro", estado: "desligado", onde: "onboarding/trilho/receitas.ts", soNoPapel: true},
  {id: "RE-02", slug: "minuta-orcamento-e-dossie", nome: "Minuta, orçamento e dossiê", area: "Receitas para clientes", tipo: "agente", paraQueServe: "Agente de documento para cartório e escritório.", gatilho: "", frequencia: "", le: "", escreve: "", capacidades: [], nivel: "", modelo: "claude-opus-5-5", esforco: "high", dono: "pedro", estado: "desligado", onde: "onboarding/trilho/receitas.ts", soNoPapel: true},
  {id: "RE-03", slug: "conciliacao-sobre-erp", nome: "Conciliação sobre ERP", area: "Receitas para clientes", tipo: "agente", paraQueServe: "Concilia o financeiro do cliente sobre o ERP dele.", gatilho: "", frequencia: "", le: "", escreve: "", capacidades: [], nivel: "", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "pedro", estado: "desligado", onde: "onboarding/trilho/receitas.ts", soNoPapel: true},
  {id: "RE-04", slug: "painel-de-vendas-sobre-erp", nome: "Painel de vendas sobre ERP", area: "Receitas para clientes", tipo: "agente", paraQueServe: "Painel de vendas do cliente, com leitura do mês.", gatilho: "", frequencia: "", le: "", escreve: "", capacidades: [], nivel: "", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "pedro", estado: "desligado", onde: "onboarding/trilho/receitas.ts", soNoPapel: true},
  {id: "RE-05", slug: "kit-de-contexto-e-conteudo", nome: "Kit de contexto e conteúdo", area: "Receitas para clientes", tipo: "agente", paraQueServe: "Carga do contexto e pauta de conteúdo do cliente.", gatilho: "", frequencia: "", le: "", escreve: "", capacidades: [], nivel: "", modelo: "claude-sonnet-5-5", esforco: "high", dono: "pedro", estado: "desligado", onde: "onboarding/trilho/receitas.ts", soNoPapel: true},
  {id: "RE-06", slug: "dossie-de-conta", nome: "Dossiê de conta", area: "Receitas para clientes", tipo: "agente", paraQueServe: "Dossiê de empresa para venda consultiva.", gatilho: "", frequencia: "", le: "", escreve: "", capacidades: [], nivel: "", modelo: "claude-opus-5-5", esforco: "high", dono: "pedro", estado: "desligado", onde: "onboarding/trilho/receitas.ts", soNoPapel: true},
  {id: "AG-01", slug: "vigia-da-agenda", nome: "Vigia da agenda", area: "Agenda", tipo: "agente", paraQueServe: "Confere as reuniões que a agenda da Root organizou contra o padrão de título e propõe a correção de quem saiu dele.", gatilho: "a cada 15 min, só na empresa da casa (rotina nasce desligada; liga em /rotinas)", frequencia: "96x por dia", le: "agenda da Root (ontem a +60 dias), clientes e leads", escreve: "título padronizado e Meet na reunião online, pela porta; pendência quando não há proposta segura", capacidades: ["comunicacao.agenda.periodo","agenda.evento.padronizar"], nivel: "agenda.evento.padronizar R3", modelo: "claude-haiku-5-5", esforco: "low", dono: "rodrigo", estado: "desligado", onde: "agenda/vigia-da-agenda.service.ts", rotina: "agenda.vigia"},
  {id: "TR-11", slug: "arquivista-do-cliente-revisao", nome: "Arquivista do cliente (segunda leitura)", area: "Trabalho e pastas", tipo: "agente", paraQueServe: "Relê o arquivo que o arquivista classificou com confiança baixa, num modelo maior, antes de pedir a uma pessoa.", gatilho: "confiança baixa do TR-05", frequencia: "por arquivo", le: "arquivo, cliente", escreve: "subpasta proposta", capacidades: [], nivel: "sem capacidade; o envio é o do TR-05", modelo: "claude-sonnet-5-5", esforco: "low", dono: "rodrigo", estado: "ativo", onde: "clientes/arquivista/classificador.ts"},
  {id: "TR-12", slug: "agente-de-tarefas", nome: "Agente de tarefas", area: "Trabalho e pastas", tipo: "agente", paraQueServe: "Cria, lista, conclui e muda prazo ou responsável das tarefas do Dia a dia quando alguém da equipe pede no grupo do WhatsApp, e responde no próprio grupo.", gatilho: "mensagem começando com \"tarefa\" no grupo da equipe (AGENTE_TAREFAS_JID)", frequencia: "sob demanda", le: "tarefas, áreas e equipe", escreve: "tarefa do Dia a dia, em nome de quem pediu; resposta no grupo", capacidades: ["operacao.tarefa.listar","operacao.tarefa.alterar"], nivel: "age em nome da pessoa que pediu, com a permissão dela", modelo: "claude-haiku-5-5", esforco: "low", dono: "rodrigo", estado: "ativo", onde: "work/agente-de-tarefas/", semente: ["tripulacao"]},
  {id: "CT-20", slug: "memoria-do-marketing", nome: "Memória do Marketing", area: "Conteúdo", tipo: "agente", paraQueServe: "Lê o link ou o Reel mandado no grupo Memória ROOT e escreve a nota: resumo, gancho, estrutura e como adaptar.", gatilho: "mensagem no grupo ou captura na tela", frequencia: "a cada link", le: "link, legenda, transcrição, marca", escreve: "notas da Memória (e o .md no Drive)", capacidades: [], nivel: "pauta.editar", modelo: "claude-haiku-5-5", esforco: "low", dono: "lucas", estado: "ativo", onde: "marketing-estudio/memoria-do-marketing.service.ts"},
  {id: "CT-21", slug: "triagem-de-ideias", nome: "Triagem de ideias", area: "Conteúdo", tipo: "agente", paraQueServe: "Transforma capturas e notas em cards de ideia com por que e como fazer; a equipe aprova ou recusa um por vez.", gatilho: "botão", frequencia: "sob demanda", le: "capturas, notas, marca, réguas, decisões", escreve: "cards da triagem", capacidades: [], nivel: "pauta.editar", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "lucas", estado: "ativo", onde: "marketing-estudio/triagem.service.ts"},
  {id: "CT-22", slug: "redator-pela-regua", nome: "Redator pela régua", area: "Conteúdo", tipo: "agente", paraQueServe: "Escreve o post da Máquina (gancho, roteiro, slides, legenda) seguindo a régua do formato, e extrai a régua das referências.", gatilho: "botão", frequencia: "sob demanda", le: "post, régua, referências, marca", escreve: "textos do post", capacidades: [], nivel: "pauta.editar", modelo: "claude-sonnet-5-5", esforco: "medium", dono: "lucas", estado: "ativo", onde: "marketing-estudio/reguas.service.ts"},
];

const POR_ID = new Map(CADASTRO_DE_FUNCOES.map((f) => [f.id, f]));
const POR_SLUG = new Map(CADASTRO_DE_FUNCOES.map((f) => [f.slug, f]));

export function funcaoPorId(id: string): FuncaoDoCadastro | undefined {
  return POR_ID.get(id);
}

export function funcaoPorSlug(slug: string): FuncaoDoCadastro | undefined {
  return POR_SLUG.get(slug);
}

/** `CO-03` → `LLM_MODELO_CO_03`: a variável que sobrescreve o modelo daquela função. */
export function variavelDoModelo(id: string): string {
  return `LLM_MODELO_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** `CO-03` → `LLM_ESFORCO_CO_03`. */
export function variavelDoEsforco(id: string): string {
  return `LLM_ESFORCO_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export interface EscolhaDoModelo {
  modelo: string;
  esforco: EsforcoDaFuncao;
  /** De onde veio: o cadastro, a variável da função ou o padrão do provedor. */
  origem: 'cadastro' | 'variavel' | 'padrao';
}

/**
 * O modelo e o esforço de uma chamada. Ordem: `LLM_MODELO_<ID>`/`LLM_ESFORCO_<ID>`
 * → o cadastro → o padrão do provedor. Função desconhecida, sem modelo no cadastro
 * (rotina, automação, modelo externo) ou ausente cai no padrão: nunca lança, porque
 * errar o nome da função não pode derrubar a geração.
 * Variável com valor fora dos modelos e esforços conhecidos é ignorada (valor torto
 * não vira chamada com modelo inventado; o teto de custo recusaria de qualquer jeito).
 */
export function escolherModelo(
  funcao: string | undefined,
  padrao: { modelo: string; esforco: EsforcoDaFuncao },
  env: Readonly<Record<string, string | undefined>> = {},
): EscolhaDoModelo {
  const f = funcao ? POR_ID.get(funcao) : undefined;
  if (!f) return { ...padrao, origem: 'padrao' };
  const doEnvModelo = (env[variavelDoModelo(f.id)] ?? '').trim();
  const doEnvEsforco = (env[variavelDoEsforco(f.id)] ?? '').trim() as EsforcoDaFuncao;
  const modeloVar = (MODELOS_DO_CADASTRO as readonly string[]).includes(doEnvModelo) ? doEnvModelo : '';
  const esforcoVar = ESFORCOS_DO_CADASTRO.includes(doEnvEsforco) ? doEnvEsforco : null;
  if (modeloVar || esforcoVar) {
    return {
      modelo: modeloVar || f.modelo || padrao.modelo,
      esforco: esforcoVar ?? f.esforco ?? padrao.esforco,
      origem: 'variavel',
    };
  }
  if (!f.modelo) return { ...padrao, origem: 'padrao' };
  return { modelo: f.modelo, esforco: f.esforco ?? padrao.esforco, origem: 'cadastro' };
}

/** As linhas de um tipo, na ordem do cadastro. */
export function funcoesDoTipo(tipo: TipoDaFuncao): FuncaoDoCadastro[] {
  return CADASTRO_DE_FUNCOES.filter((f) => f.tipo === tipo);
}

/** As linhas que um seed transforma em registro `Agent`. */
export function funcoesDaSemente(semente: SementeDaFuncao): FuncaoDoCadastro[] {
  return CADASTRO_DE_FUNCOES.filter((f) => f.semente?.includes(semente));
}
