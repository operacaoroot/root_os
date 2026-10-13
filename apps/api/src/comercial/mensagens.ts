import type { ComercialTemplate } from '@mktos/shared';

/*
 * OS OITO TEXTOS DO WHATSAPP (C08) — dado versionado, Lane B (13/10/2026).
 *
 * Cada texto tem gatilho, quem prepara e quem envia, como a seção C08 do mapa.
 * A regra vigente é "agente prepara, pessoa envia": o envio passa pela porta
 * como R3 (`comercial.whatsapp.enviar`) e espera o toque de outra pessoa na
 * fila. O interruptor `ComercialConfig.envioAutomatico` só acrescenta a janela
 * de veto; ele não tira a mensagem da régua (ver `canais/whatsapp.service.ts`).
 *
 * VERSÃO E DATA. Mudou uma vírgula, sobe a versão e a data. A mensagem gravada
 * em `ComercialMensagem` guarda o texto já preenchido, então mudar o texto aqui
 * não reescreve o que já saiu. Os textos finais ainda passam pela aprovação de
 * um sócio na mesa (C08): estes são a versão de homologação.
 *
 * O QUE NÃO ESTÁ AQUI DE PROPÓSITO. Os dias do M5 e do M6 são "[a decidir]" na
 * C08: nenhum texto cita número de dias. Quem decide QUANDO cada um sai é o
 * relógio da lane A, com a configuração da empresa.
 *
 * Dois marcadores a mais que a lista do contrato, e o porquê: `{novidade}` no
 * M6 (a C08 pede um dado novo e concreto, que o fupeiro traz; sem ele o M6 vira
 * cobrança) e `{equipe}` no M8 (o "quem é quem" do grupo; quem entra em cada
 * grupo é [a decidir] pela mesa, então o nome não pode estar fixo no texto).
 */

export const MENSAGENS_DATA = '2026-10-13';

export type Marcador =
  | 'nome'
  | 'linkDaSala'
  | 'horario1'
  | 'horario2'
  | 'horario'
  | 'validade'
  | 'linkAssinatura'
  | 'kickoff'
  | 'quemAssina'
  | 'novidade'
  | 'equipe';

export type Variaveis = Partial<Record<Marcador, string>>;

export interface TextoDoWhatsapp {
  template: ComercialTemplate;
  versao: number;
  data: string;
  titulo: string;
  /** Etapa ou relógio que dispara (C08). */
  gatilho: string;
  /** O agente que prepara. */
  prepara: string;
  /** A pessoa que envia (o toque na fila). */
  envia: string;
  texto: string;
  /** O que o simulador e o provedor oficial renderizam além do texto. */
  interativo?: 'formulario_de_qualificacao' | 'botoes_de_horario';
}

export const MENSAGENS: Readonly<Record<ComercialTemplate, TextoDoWhatsapp>> = {
  M1: {
    template: 'M1',
    versao: 1,
    data: MENSAGENS_DATA,
    titulo: 'resposta ao lead novo',
    gatilho: 'E1 · lead novo',
    prepara: 'qualificador',
    envia: 'dono do lead',
    texto:
      'Oi, {nome}. Recebemos a sua mensagem. Para a conversa começar pelos seus números, responda quatro perguntas aqui mesmo ou na sua sala: {linkDaSala}. Quem responde você é um dos sócios da Root.',
    interativo: 'formulario_de_qualificacao',
  },
  M2: {
    template: 'M2',
    versao: 1,
    data: MENSAGENS_DATA,
    titulo: 'convite de agenda',
    gatilho: 'E2 fechada',
    prepara: 'agendador',
    envia: 'dono do lead',
    texto:
      'Pronto, {nome}. Separei dois horários com um dos sócios: {horario1} ou {horario2}. São 40 minutos, e a conversa é gravada para virar o seu diagnóstico. Toque no horário que preferir.',
    interativo: 'botoes_de_horario',
  },
  M3: {
    template: 'M3',
    versao: 1,
    data: MENSAGENS_DATA,
    titulo: 'confirmação de véspera',
    gatilho: 'D-1 da reunião',
    prepara: 'agendador',
    envia: 'sócio',
    texto:
      '{nome}, a nossa conversa é amanhã, {horario}. O link da chamada abre na sua sala 10 minutos antes: {linkDaSala}. A conversa é gravada para virar o seu diagnóstico.',
  },
  M4: {
    template: 'M4',
    versao: 1,
    data: MENSAGENS_DATA,
    titulo: 'envio da proposta',
    gatilho: 'E6 liberada',
    prepara: 'construtor de proposta',
    envia: 'sócio da conta',
    texto:
      '{nome}, a sua proposta está na sala: {linkDaSala}. Ela vale até {validade}. O próximo passo é escolher uma das opções e aceitar ali mesmo. Se quiser mudar algo, use o botão de pedir ajuste.',
  },
  M5: {
    template: 'M5',
    versao: 1,
    data: MENSAGENS_DATA,
    titulo: 'follow-up de leitura',
    gatilho: 'leitura sem resposta em [a decidir] dias',
    prepara: 'fupeiro',
    envia: 'sócio',
    texto: '{nome}, ficou alguma dúvida sobre a proposta que eu possa responder antes de {validade}?',
  },
  M6: {
    template: 'M6',
    versao: 1,
    data: MENSAGENS_DATA,
    titulo: 'follow-up com novidade',
    gatilho: '[a decidir] dias sem resposta',
    prepara: 'fupeiro',
    envia: 'sócio',
    texto: '{nome}, uma novidade que tem a ver com a sua proposta: {novidade} A sala continua no mesmo endereço: {linkDaSala}.',
  },
  M7: {
    template: 'M7',
    versao: 1,
    data: MENSAGENS_DATA,
    titulo: 'assinatura',
    gatilho: 'E8 minuta aprovada',
    prepara: 'construtor de contrato',
    envia: 'Rodrigo',
    texto:
      '{nome}, o contrato está pronto para assinar pelo celular: {linkAssinatura}. Quem assina pela sua empresa é {quemAssina}. Assim que a assinatura chegar, confirmamos por aqui.',
  },
  M8: {
    template: 'M8',
    versao: 1,
    data: MENSAGENS_DATA,
    titulo: 'boas-vindas do grupo',
    gatilho: 'E9 transação',
    prepara: 'fechador',
    envia: 'sócio da conta',
    texto:
      'Boas-vindas, {nome}. Este é o grupo da sua empresa com a Root. Quem está aqui: {equipe}. Toda mensagem neste grupo tem resposta em até 4 horas. O kickoff está marcado para {kickoff}.',
  },
};

const MARCADOR_RE = /\{([a-zA-Z0-9]+)\}/g;

/** Os marcadores que um texto pede, na ordem em que aparecem, sem repetição. */
export function marcadoresDe(texto: string): string[] {
  const vistos = new Set<string>();
  for (const m of texto.matchAll(MARCADOR_RE)) vistos.add(m[1]);
  return [...vistos];
}

export class VariavelFaltandoError extends Error {
  constructor(
    readonly template: string,
    readonly faltando: string[],
  ) {
    super(`o texto ${template} pede ${faltando.map((f) => `{${f}}`).join(', ')} e ${faltando.length === 1 ? 'ela não veio' : 'elas não vieram'}: nada foi preparado.`);
  }
}

/**
 * O texto preenchido. Recusa (lança) quando falta variável ou ela vem vazia:
 * mensagem com `{validade}` cru, ou com um buraco no lugar da data, não sai.
 * Nunca inventa valor para o que faltou.
 */
export function textoDe(template: ComercialTemplate | TextoDoWhatsapp, variaveis: Variaveis): string {
  const t = typeof template === 'string' ? MENSAGENS[template] : template;
  if (!t) throw new Error(`texto desconhecido: ${String(template)}`);
  const pede = marcadoresDe(t.texto);
  const vars = variaveis as Record<string, string | undefined>;
  const faltando = pede.filter((m) => typeof vars[m] !== 'string' || !vars[m]!.trim());
  if (faltando.length) throw new VariavelFaltandoError(t.template, faltando);
  return t.texto.replace(MARCADOR_RE, (_, m: string) => vars[m]!.trim());
}

/** O formulário de qualificação (tela 01): as quatro perguntas do `SalaFormSchema`. */
export const FORMULARIO_DE_QUALIFICACAO = {
  id: 'qualificacao-v1',
  titulo: 'Quatro perguntas',
  campos: [
    { chave: 'sistema', rotulo: 'Qual sistema vocês usam?', tipo: 'texto' },
    { chave: 'baseOrganizada', rotulo: 'A base de dados está organizada?', tipo: 'sim_nao' },
    { chave: 'maiorDor', rotulo: 'Qual é a maior dor hoje?', tipo: 'texto' },
    { chave: 'equipeFinanceiro', rotulo: 'Quantas pessoas no financeiro?', tipo: 'numero' },
  ],
} as const;

export type FormularioDoWhatsapp = typeof FORMULARIO_DE_QUALIFICACAO;
