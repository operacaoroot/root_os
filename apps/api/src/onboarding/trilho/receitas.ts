/* ==========================================================================
 * O CARDÁPIO DE RECEITAS — a peça que dá escala (nota do Pedro, §7)
 * ==========================================================================
 *
 * Cada frente vendida é uma RECEITA: um pacote reutilizável que a proposta, a
 * imersão e a operação leem. A receita é o que impede a Root de inventar um
 * projeto novo a cada cliente — o mesmo princípio da casca do OS: doze telas
 * fixas, e só o bloco do negócio muda.
 *
 * DADO VERSIONADO, não tabela: a receita muda por revisão de gente (a
 * retrospectiva do card 37: "o que foi improvisado ao vivo e devia ser
 * padrão?"), e mudança que passa por commit tem autor, data e diff. O dia em
 * que a mesa quiser editar receita na tela é o dia de mover para o banco —
 * com a mesma catraca de unicidade que este arquivo cobra em teste.
 *
 * SÓ UMA ESTÁ INTEIRA. "Arquivista documental" é a única descrita campo a campo
 * na nota. As outras cinco são SEMENTES: têm o que se sabe delas e o que falta
 * está marcado como `[a definir pela mesa]` — nunca preenchido por dedução.
 */

export interface Receita {
  chave: string;
  nome: string;
  /** A dor, na língua do cliente. */
  dor: string;
  /** O que precisa existir na casa do cliente para a receita rodar. */
  preRequisito: string;
  /** O que se instala: skills, padrões, agentes. */
  oQueSeInstala: string;
  /** Onde a receita mora na régua R0–R5. */
  nivelNaRegua: string;
  /** O que precisa acontecer NA FRENTE DO CLIENTE no dia 2 da imersão. */
  criterioDeSaida: string;
  /** A métrica da linha de base — o número de partida e o do dia 30. */
  metricaDaLinhaDeBase: string;
  /** Onde já rodou. */
  ondeJaRodou: string;
  /** Nicho a que serve. */
  nicho: string;
  /** `inteira` = pronta para vender; `semente` = vira receita quando se repetir. */
  estado: 'inteira' | 'semente';
  /** A pauta dos dois dias de imersão, gerada pela receita. */
  pautaDaImersao: { dia1: readonly string[]; dia2: readonly string[] };
}

const A_DEFINIR = '[a definir pela mesa]';

export const RECEITAS: readonly Receita[] = [
  {
    chave: 'arquivista-documental',
    nome: 'Arquivista documental',
    dor: 'O documento existe, mas ninguém acha; cada um salva de um jeito. "Dois minutos para responder o cliente viram um dia procurando."',
    preRequisito: 'Pasta de rede ou Drive com acesso de leitura; lista de clientes com CNPJ.',
    oQueSeInstala:
      'Skill de classificação + padrão de nomes + agente que arquiva na pasta certa e avisa a equipe.',
    nivelNaRegua:
      'R1 (organiza dentro do vault/pasta de trabalho); R2 para mover na pasta do cliente, com aprovação.',
    criterioDeSaida:
      '10 documentos reais classificados, renomeados e arquivados sem erro, na frente do cliente.',
    metricaDaLinhaDeBase: 'Minutos para achar um documento; % de arquivos fora do padrão.',
    ondeJaRodou: 'Pedido da MaisQ em 22/09/2026 (a construir).',
    nicho: 'Escritório contábil, controladoria e BPO.',
    estado: 'inteira',
    pautaDaImersao: {
      dia1: [
        'Carga dos 8 temas no OS (o que a ata e o link já trouxeram, confirmado ao vivo).',
        'Conectar a fonte: a pasta de rede ou o Drive, só leitura, pelo MCP no servidor do cliente.',
        'Levantar o padrão de nomes que a casa já usa, mesmo sem saber que usa.',
        'Definir as pastas-destino por setor (Público, DP, Fiscal, Contábil) com o cliente.',
      ],
      dia2: [
        'O agente classificando os primeiros documentos, com o cliente olhando.',
        'A régua: R1 arquiva no vault; R2 move na pasta do cliente e espera aprovação.',
        'A prova: 10 documentos reais, sem erro, medidos em minutos por documento.',
        'O critério de saída assinado, e a linha de base do dia 30 combinada.',
      ],
    },
  },
  {
    chave: 'minuta-orcamento-dossie',
    nome: 'Minuta, orçamento e dossiê (cartório)',
    dor: 'Cada minuta nasce do zero e a conferência da pasta depende de memória de gente.',
    preRequisito: 'Modelos de escritura da casa; pasta do serviço com os documentos; acesso de leitura.',
    oQueSeInstala: 'Construtor e conferente de minuta, orçamentista sobre a tabela oficial, dossiê de conferência.',
    nivelNaRegua: 'R1 (rascunho em amarelo/vermelho); nunca lavra.',
    criterioDeSaida: A_DEFINIR,
    metricaDaLinhaDeBase: 'Minutos por minuta; lacunas por campo.',
    ondeJaRodou: 'Cartório de Descoberto (Jorge).',
    nicho: 'Cartórios.',
    estado: 'semente',
    pautaDaImersao: { dia1: [A_DEFINIR], dia2: [A_DEFINIR] },
  },
  {
    chave: 'conciliacao-sobre-erp',
    nome: 'Relatório de conciliação sobre ERP',
    dor: 'A conciliação é feita à mão a cada fechamento, e o número chega tarde.',
    preRequisito: 'ERP com API ou exportação (Senior, Omie, Conta Azul); extrato bancário.',
    oQueSeInstala: 'Rotina que cruza extrato e ERP e devolve o relatório com as divergências.',
    nivelNaRegua: 'R0/R1 (lê e relata; não baixa título).',
    criterioDeSaida: A_DEFINIR,
    metricaDaLinhaDeBase: 'Horas por fechamento; divergências achadas por mês.',
    ondeJaRodou: 'Custeio (Senior).',
    nicho: 'Controladoria e BPO financeiro.',
    estado: 'semente',
    pautaDaImersao: { dia1: [A_DEFINIR], dia2: [A_DEFINIR] },
  },
  {
    chave: 'painel-de-vendas-sobre-erp',
    nome: 'Painel de vendas sobre ERP',
    dor: 'O dono não sabe o que a base tem; o número da semana depende de alguém montar planilha.',
    preRequisito: 'ERP com API que libere o dado (Protheus fechado é exceção a decidir).',
    oQueSeInstala: 'Leitura do ERP + os números que a casa olha, respondidos em pergunta livre.',
    nivelNaRegua: 'R0 (só leitura).',
    criterioDeSaida: A_DEFINIR,
    metricaDaLinhaDeBase: 'Minutos para responder "como foi a semana".',
    ondeJaRodou: 'ProMedical (Protheus); Dispropan.',
    nicho: 'Distribuição e comércio com ERP.',
    estado: 'semente',
    pautaDaImersao: { dia1: [A_DEFINIR], dia2: [A_DEFINIR] },
  },
  {
    chave: 'kit-de-contexto-e-conteudo',
    nome: 'Kit de contexto e conteúdo',
    dor: 'Quem cria conteúdo repete o briefing a cada peça, e a IA responde genérico.',
    preRequisito: 'Vault ou pasta com o material da marca; acesso de leitura.',
    oQueSeInstala: 'Contexto persistente + skills de conteúdo sobre ele.',
    nivelNaRegua: 'R1 (rascunha peça; publicar é R3).',
    criterioDeSaida: A_DEFINIR,
    metricaDaLinhaDeBase: 'Minutos por peça; acerto na primeira versão ("acertei 10 de 12").',
    ondeJaRodou: 'Kit feito para o Lucas Rezende (22/09/2026).',
    nicho: 'Criadores e agências.',
    estado: 'semente',
    pautaDaImersao: { dia1: [A_DEFINIR], dia2: [A_DEFINIR] },
  },
  {
    chave: 'dossie-de-conta',
    nome: 'Dossiê de conta antes da reunião',
    dor: 'O vendedor entra na reunião sem saber quem é o cliente; a preparação depende de tempo que não há.',
    preRequisito: 'CRM ou lista de reuniões; fonte pública do cliente.',
    oQueSeInstala: 'Agente que monta o dossiê de uma página ao marcar a reunião, com hipótese e fonte.',
    nivelNaRegua: 'R0/R1 (lê fonte pública e a memória; escreve rascunho).',
    criterioDeSaida: A_DEFINIR,
    metricaDaLinhaDeBase: 'Minutos de preparação por reunião.',
    ondeJaRodou: 'A dor declarada pelo Lucas Rezende (22/09/2026); é o que a fase 0 deste trilho faz.',
    nicho: 'Vendas consultivas.',
    estado: 'semente',
    pautaDaImersao: { dia1: [A_DEFINIR], dia2: [A_DEFINIR] },
  },
] as const;

export function receita(chave: string | null | undefined): Receita | undefined {
  if (!chave) return undefined;
  return RECEITAS.find((r) => r.chave === chave);
}

export const NICHO_INICIAL_SUGERIDO = 'Escritório contábil, controladoria e BPO';
