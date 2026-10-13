import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_ETAPA,
  ordemDaEtapa,
  type ComercialEtapa,
  type ComercialMotivoDeSaida,
  type RelatorioDaSemana,
} from '@mktos/shared';

import { FONTE_DO_EVENTO } from './eventos';
import { numeroPorExtenso } from './inteligencia-prompts';

/*
 * O RELATÓRIO DA QUINTA (lane E, fase 2, 13/10/2026) — a parte pura. Tela 13.
 *
 * A REGRA DA MK6 VALE AQUI: número é do sistema, narrativa é da IA. Toda
 * contagem sai do banco, por estas funções; o modelo escreve só a leitura da
 * semana, e o prompt o proíbe de escrever número. Frase da narrativa com
 * algarismo SAI (`limparNarrativa`): o número que um modelo escreveu ninguém
 * consegue conferir depois, e o do sistema é o único que vai à tela.
 *
 * AS CONTAS
 *   · leads: os que ENTRARAM no período (`Lead.enteredAt`), só os do cockpit
 *     (com ficha comercial);
 *   · fechados: leads com `cliente.ativo` no período (o fechamento é evento com
 *     data: a conta não depende de status, como a tela 13 escreve);
 *   · mediana do 1º oi ao Pix: dos leads cujo PRIMEIRO `pix.pago` caiu no
 *     período, os dias entre a entrada e esse Pix, mediana com uma casa;
 *   · funil: dos leads que entraram no período, quantos ALCANÇARAM cada etapa
 *     (a maior etapa ativa que o fio registrou, mesmo que depois tenham saído);
 *   · perdas por motivo: saídas `perdido` e `desqualificado` no período, pelo
 *     motivo do catálogo. A geladeira não conta como perda (ela volta);
 *   · ações humanas: decisão tomada, veto, saída registrada por pessoa (não a que
 *     veio de uma decisão), ata subida, diagnóstico aprovado e toda aprovação da
 *     porta a uma capacidade `comercial.*` dada no período;
 *   · ações automáticas: os fatos que o sistema produziu sozinho (fonte agente,
 *     relógio, sistema ou decisão aberta/vencida) e as mensagens que as
 *     automações prepararam e saíram. O que o CLIENTE fez (sala, formulário,
 *     resposta, Pix, assinatura) não entra em nenhum dos dois;
 *   · propostas vencendo (C10): as publicadas em proposta ou follow-up cuja
 *     validade cai dentro do mesmo recorte, à frente;
 *   · previsão: a tela 13 mostra "fechamentos prováveis entre os leads em
 *     proposta" e o mapa não dá a taxa. Fica `null`, com a contagem dos leads em
 *     proposta ao lado. [a decidir] pela mesa: a fórmula da previsão.
 */

export const DIAS_PADRAO_DO_RELATORIO = 7;
export const DIAS_MAXIMOS_DO_RELATORIO = 90;
/** Os recortes que a tela 13 oferece (a torre procura o relator por eles). */
export const RECORTES_DA_TELA: readonly number[] = [DIAS_PADRAO_DO_RELATORIO, 30, 90];
export const PREVISAO_PENDENTE = 'a fórmula da previsão é [a decidir] pela mesa: o mapa mostra a frase e não dá a taxa.';
const DIA_MS = 86_400_000;

export function diasDoPedido(dias: unknown): number {
  const n = Number(dias);
  if (!Number.isFinite(n) || n < 1) return DIAS_PADRAO_DO_RELATORIO;
  return Math.min(DIAS_MAXIMOS_DO_RELATORIO, Math.floor(n));
}

export function mediana(valores: readonly number[]): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Dias entre dois instantes, com uma casa, nunca negativo. O Asaas manda só o
 * DIA do pagamento (`pagoEm` sem hora), e o fato do Pix cai à meia-noite UTC:
 * o lead que entra e paga no mesmo dia daria "menos um décimo". Antes da
 * entrada vira zero (mesmo dia), que é o que a precisão do dado sustenta.
 */
export function diasEntre(de: Date, ate: Date): number {
  return Math.max(0, Math.round(((ate.getTime() - de.getTime()) / DIA_MS) * 10) / 10);
}

/** O funil cumulativo: quantos leads alcançaram cada etapa ativa. `alcance` = a maior ordem (1 a 9) de cada lead. */
export function funilCumulativo(alcance: readonly number[]): { etapa: string; n: number }[] {
  return COMERCIAL_ETAPAS.map((e) => {
    const ordem = ordemDaEtapa(e) ?? 0;
    return { etapa: e, n: alcance.filter((a) => a >= ordem).length };
  });
}

/** A maior etapa ativa que um lead alcançou: a atual (se ativa), os `para` de `etapa.mudou` e a de antes da saída. */
export function alcanceDoLead(etapaAtual: string, etapaAntesDaSaida: string | null, destinos: readonly string[]): number {
  const ordens = [etapaAtual, etapaAntesDaSaida ?? '', ...destinos].map((e) => ordemDaEtapa(e as ComercialEtapa) ?? 0);
  return Math.max(1, ...ordens);
}

export interface FatoParaContar {
  type: string;
  payload: unknown;
}

/** Humana, automática ou nenhuma das duas (o que o cliente fez). */
export function quemFez(f: FatoParaContar): 'humana' | 'automatica' | null {
  const p = (f.payload ?? {}) as Record<string, unknown>;
  switch (f.type) {
    case 'decisao.tomada':
    case 'veto.registrado':
    case 'ata.chegou':
      return 'humana';
    case 'saida.registrada':
      return String(p.detalhe ?? '').startsWith('decisão') ? 'automatica' : 'humana';
    case 'diagnostico.pronto':
      return p.aprovadoEm ? 'humana' : 'automatica';
    case 'whats.enviada':
    case 'followup.enviado':
      return 'automatica';
    default: {
      const fonte = (FONTE_DO_EVENTO as Record<string, string | undefined>)[f.type];
      return fonte === 'agente' || fonte === 'relogio' || fonte === 'sistema' || fonte === 'decisao' ? 'automatica' : null;
    }
  }
}

export function contarAcoes(fatos: readonly FatoParaContar[], aprovacoesDaPorta: number): { automaticas: number; humanas: number } {
  let automaticas = 0;
  let humanas = aprovacoesDaPorta;
  for (const f of fatos) {
    const q = quemFez(f);
    if (q === 'humana') humanas++;
    else if (q === 'automatica') automaticas++;
  }
  return { automaticas, humanas };
}

export function perdasPorMotivo(saidas: readonly { saida: string; motivo: string }[]): { motivo: ComercialMotivoDeSaida; n: number }[] {
  const conta = new Map<string, number>();
  for (const s of saidas) {
    if (s.saida !== 'perdido' && s.saida !== 'desqualificado') continue;
    conta.set(s.motivo, (conta.get(s.motivo) ?? 0) + 1);
  }
  return [...conta.entries()].map(([motivo, n]) => ({ motivo: motivo as ComercialMotivoDeSaida, n })).sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo));
}

// ---------------------------------------------------------------------------
// A narrativa: o pedido ao modelo e a limpeza do que voltou
// ---------------------------------------------------------------------------

export const TAREFA_DO_RELATORIO = 'comercial.relatorio';

/** O pedido. Os números vão como contexto; o modelo é proibido de escrevê-los. */
export function promptDoRelatorio(r: RelatorioDaSemana): { system: string; user: string } {
  const system = [
    `[tarefa:${TAREFA_DO_RELATORIO}]`,
    'Você escreve a leitura da semana do comercial da Root para a mesa de quinta.',
    'Regras:',
    '- NÃO escreva nenhum número, algarismo, porcentagem, valor em reais ou data. Os números já estão na tela, contados pelo sistema; a sua parte é dizer o que eles querem dizer.',
    '- De três a cinco frases curtas e afirmativas, em português, tratando a mesa por "vocês".',
    '- Fale do que andou, do que travou e de uma pergunta para a mesa decidir.',
    '- Sem travessão, sem emoji, sem exagero, sem prometer o que os fatos não sustentam.',
    'Devolva só o texto da leitura, sem título.',
  ].join('\n');
  const funil = r.funil.map((f) => `${COMERCIAL_ROTULO_DA_ETAPA[f.etapa as ComercialEtapa] ?? f.etapa}: ${f.n}`).join('; ');
  const perdas = r.perdasPorMotivo.map((p) => `${p.motivo}: ${p.n}`).join('; ') || 'nenhuma';
  const user = [
    `FATOS DO SISTEMA (últimos ${r.periodoDias} dias; não repita os números):`,
    `leads que entraram: ${r.leads}`,
    `fechados (cliente ativo): ${r.fechados}`,
    `mediana do primeiro oi ao Pix: ${r.medianaDiasDoOiAoPix ?? 'sem Pix no período'}`,
    `ações automáticas: ${r.acoes.automaticas}; ações de gente: ${r.acoes.humanas}`,
    `funil (quantos alcançaram cada etapa): ${funil}`,
    `perdas por motivo: ${perdas}`,
    `leads em proposta agora: ${r.leadsEmPropostaAgora ?? 0}`,
  ].join('\n');
  return { system, user };
}

const TETO_DA_NARRATIVA = 1_200;

/** Quantidade escrita por palavra: o número é do sistema, e a narrativa não o reescreve por extenso. */
const QUANTIDADE = /\b(nenhum|nenhuma|todos|todas|maioria|minoria|metade|dobro|triplo)\b|%|\bpor\s*cento\b/i;

function fraseComQuantidade(f: string): boolean {
  return QUANTIDADE.test(f) || numeroPorExtenso(f) !== null;
}

/**
 * Tira da narrativa toda frase com número (o do sistema prevalece): algarismo,
 * número por extenso, percentual e palavra de quantidade ("metade", "dobro",
 * "nenhum", "todos"; revisão E-9). Travessão vira vírgula. Devolve o texto e o
 * que saiu, para a tela mostrar o aviso.
 */
export function limparNarrativa(bruta: string): { narrativa: string | null; avisos: string[] } {
  const texto = String(bruta ?? '').replace(/\s+/g, ' ').trim();
  if (!texto) return { narrativa: null, avisos: [] };
  const frases = texto.split(/(?<=[.!?])\s+/);
  const avisos: string[] = [];
  const ficam: string[] = [];
  for (const f of frases) {
    if (/\d/.test(f) || fraseComQuantidade(f)) {
      avisos.push(`frase com número tirada da narrativa: "${f.slice(0, 120)}"`);
      continue;
    }
    ficam.push(f.replace(/\s*[—–]\s*/g, ', '));
  }
  let narrativa = ficam.join(' ').trim();
  if (narrativa.length > TETO_DA_NARRATIVA) narrativa = `${narrativa.slice(0, TETO_DA_NARRATIVA - 1)}…`;
  return { narrativa: narrativa || null, avisos };
}

/** O markdown da nota (para gente ler; o dado vai no bloco json). */
export function markdownDoRelatorio(r: RelatorioDaSemana): string {
  const linhas = [
    `# Relatório da semana · ${r.geradoEm.slice(0, 10)}`,
    '',
    `Últimos ${r.periodoDias} dias. Números do sistema; a leitura é do modelo.`,
    '',
    `- leads: ${r.leads}`,
    `- fechados: ${r.fechados}`,
    `- mediana do 1º oi ao Pix: ${r.medianaDiasDoOiAoPix == null ? 'sem Pix no período' : `${r.medianaDiasDoOiAoPix} dias`}`,
    `- ações automáticas · humanas: ${r.acoes.automaticas} · ${r.acoes.humanas}`,
    '',
    '## Funil',
    ...r.funil.map((f) => `- ${COMERCIAL_ROTULO_DA_ETAPA[f.etapa as ComercialEtapa] ?? f.etapa}: ${f.n}`),
    '',
    '## Perdas por motivo',
    ...(r.perdasPorMotivo.length ? r.perdasPorMotivo.map((p) => `- ${p.motivo}: ${p.n}`) : ['- nenhuma']),
    '',
    '## Propostas vencendo',
    ...(r.propostasVencendo?.length ? r.propostasVencendo.map((v) => `- ${v.nome}: vale até ${v.validade.slice(0, 10)}`) : ['- nenhuma no recorte']),
    '',
    '## Previsão',
    r.previsao ? `${r.previsao.fechamentosProvaveis} entre ${r.previsao.leadsEmProposta}` : `${r.leadsEmPropostaAgora ?? 0} leads em proposta; ${r.previsaoPendente ?? PREVISAO_PENDENTE}`,
    '',
    '## Leitura da semana',
    r.narrativa ?? 'sem leitura do modelo.',
  ];
  return linhas.join('\n');
}
