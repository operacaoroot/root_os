import { OnboardingFase } from '@prisma/client';

import { ehNivel, obrigatorios, type Nivel, type Perfil } from './espinha';

/* ==========================================================================
 * AS CINCO FASES E OS PORTÕES — o que a ferramenta faz valer
 * ==========================================================================
 *
 * A esteira do Pedro (§4): o formato é sempre o mesmo, e o trilho NÃO deixa
 * avançar sem o portão cumprido. Não há "pular fase": `podeAvancar` devolve a
 * lista EXATA do que falta, e é essa lista que a tela mostra ao lado do botão.
 *
 * REGRAS DE PORTÃO, como a nota as escreve:
 *   · a imersão só é marcada com a entrada compensada (card 02);
 *   · quem não confirmou o ambiente no D-1 não começa (card 15);
 *   · sem linha de base medida não existe fase 4 — sem número de partida não
 *     há case nem upsell;
 *   · toda fase termina com PRÓXIMO PASSO com dono e data.
 *
 * PURO: a decisão é uma função do estado, e o estado é o que está gravado. O
 * serviço só lê o trilho e os itens e pergunta aqui.
 */

export const ORDEM_DAS_FASES: readonly OnboardingFase[] = [
  OnboardingFase.qualificar,
  OnboardingFase.diagnostico,
  OnboardingFase.contrato,
  OnboardingFase.imersao,
  OnboardingFase.operacao,
  OnboardingFase.encerrado,
] as const;

export const ROTULO_DA_FASE: Record<OnboardingFase, string> = {
  qualificar: '0 · Qualificar',
  diagnostico: '1 · Diagnóstico',
  contrato: '2 · Contrato e onboarding',
  imersao: '3 · Imersão',
  operacao: '4 · Operação assistida',
  encerrado: 'Encerrado',
};

export function proximaFase(fase: OnboardingFase): OnboardingFase | null {
  const i = ORDEM_DAS_FASES.indexOf(fase);
  return i >= 0 && i < ORDEM_DAS_FASES.length - 1 ? ORDEM_DAS_FASES[i + 1] : null;
}

/** O que está gravado em `OnboardingTrilho.portoes`. Tudo opcional: é o que já foi cumprido. */
export interface Portoes {
  /** Fase 0: o bloco A respondido pelo link (data). */
  triagemRespondidaEm?: string;
  /** Fase 1: proposta enviada (até 48h depois do diagnóstico). */
  propostaEnviadaEm?: string;
  /** Fase 2 (card 02): a entrada compensada. */
  entradaCompensadaEm?: string;
  /** Fase 2: a dupla nomeada — sem os dois, não avança. */
  dupla?: {
    donoPerguntas?: { nome: string; papel?: string; contato?: string };
    guardiaoAcesso?: { nome: string; papel?: string; contato?: string };
  };
  /** Fase 2: o número de partida, com data e quem mediu. */
  linhaDeBase?: { metrica: string; valor: number; unidade?: string; medidoEm: string; quemMediu: string };
  /** Fase 2 (card 15): o ambiente conferido no D-1. */
  ambienteOkEm?: string;
  /** Fase 3: o critério de saída da receita, atingido na frente do cliente. */
  criterioDeSaida?: { atingidoEm: string; evidencia: string };
  /** Fase 4: a medição do dia 30 e o antes/depois. */
  medicaoDia30?: { valor: number; medidoEm: string; quemMediu: string };
  antesDepois?: { antes: number; depois: number; unidade?: string; registradoEm: string };
  /** Fase 4: o case escrito e a mensalidade proposta. */
  caseEm?: string;
  mensalidadePropostaEm?: string;
}

export interface ItemParaPortao {
  temaId: string;
  bloco: string;
  status: string;
}

export interface EstadoParaPortao {
  fase: OnboardingFase;
  perfil: string | null;
  nivel: string | null;
  receita: string | null;
  portoes: Portoes;
  itens: readonly ItemParaPortao[];
  proximoPasso: string | null;
  proximoPassoDono: string | null;
  proximoPassoEm: Date | string | null;
}

/** Os estados de item que contam como "o cliente respondeu". */
export const STATUS_RESPONDIDO: readonly string[] = ['confirmado', 'corrigido', 'respondido'] as const;

export function itemRespondido(status: string): boolean {
  return STATUS_RESPONDIDO.includes(status);
}

function temProximoPasso(e: EstadoParaPortao): string[] {
  const faltas: string[] = [];
  if (!e.proximoPasso?.trim()) faltas.push('próximo passo escrito');
  if (!e.proximoPassoDono?.trim()) faltas.push('dono do próximo passo');
  if (!e.proximoPassoEm) faltas.push('data do próximo passo');
  return faltas;
}

function obrigatoriosRespondidos(
  e: EstadoParaPortao,
  blocos: 'A' | 'BCD',
): string[] {
  const nivel: Nivel | null = ehNivel(e.nivel) ? e.nivel : null;
  const porTema = new Map(e.itens.map((i) => [i.temaId, i.status]));
  return obrigatorios(blocos, nivel)
    .filter((t) => !itemRespondido(porTema.get(t.id) ?? 'em-branco'))
    .map((t) => `"${t.titulo}" respondido pelo cliente`);
}

/**
 * O que falta para SAIR da fase atual. Vazio = pode avançar.
 *
 * A lista é escrita para a tela: cada linha é uma coisa que uma pessoa faz.
 */
export function faltaParaSair(e: EstadoParaPortao): string[] {
  const p = e.portoes ?? {};
  const faltas: string[] = [];

  switch (e.fase) {
    case OnboardingFase.qualificar: {
      // O ponto zero: tem sistema e base, e perfil decidido.
      if (!e.perfil) faltas.push('perfil decidido (P1, P2, P3 ou não entra)');
      if (e.perfil === 'nao-entra') faltas.push('perfil "não entra" não avança — encerre o trilho');
      faltas.push(...obrigatoriosRespondidos(e, 'A'));
      faltas.push(...temProximoPasso(e));
      break;
    }
    case OnboardingFase.diagnostico: {
      if (!e.receita) faltas.push('frente escolhida no cardápio de receitas');
      if (!p.propostaEnviadaEm) faltas.push('proposta padrão enviada (até 48h)');
      faltas.push(...temProximoPasso(e));
      break;
    }
    case OnboardingFase.contrato: {
      if (!p.entradaCompensadaEm) faltas.push('entrada compensada (card 02)');
      if (!p.dupla?.donoPerguntas?.nome) faltas.push('dono das perguntas nomeado');
      if (!p.dupla?.guardiaoAcesso?.nome) faltas.push('guardião do acesso nomeado');
      const lb = p.linhaDeBase;
      if (!lb || typeof lb.valor !== 'number' || !Number.isFinite(lb.valor) || !lb.medidoEm || !lb.quemMediu) {
        faltas.push('linha de base medida (número, data e quem mediu)');
      }
      // O ambiente é ramo: no beabá ninguém instala nada na máquina do cliente.
      if (e.nivel !== 'beaba' && !p.ambienteOkEm) faltas.push('ambiente conferido no D-1 (card 15)');
      if (!e.nivel) faltas.push('nível de oferta decidido');
      faltas.push(...obrigatoriosRespondidos(e, 'BCD'));
      faltas.push(...temProximoPasso(e));
      break;
    }
    case OnboardingFase.imersao: {
      if (!p.criterioDeSaida?.atingidoEm || !p.criterioDeSaida?.evidencia?.trim()) {
        faltas.push('critério de saída da receita atingido na frente do cliente, com evidência');
      }
      faltas.push(...temProximoPasso(e));
      break;
    }
    case OnboardingFase.operacao: {
      const ad = p.antesDepois;
      if (!ad || typeof ad.antes !== 'number' || typeof ad.depois !== 'number') {
        faltas.push('antes/depois registrado (o número de partida e o do dia 30)');
      }
      if (!p.caseEm) faltas.push('case escrito');
      if (!p.mensalidadePropostaEm) faltas.push('mensalidade (operação assistida) proposta');
      break;
    }
    case OnboardingFase.encerrado:
      faltas.push('trilho encerrado não avança');
      break;
  }
  return faltas;
}

export function podeAvancar(e: EstadoParaPortao): { ok: boolean; faltando: string[]; proxima: OnboardingFase | null } {
  const faltando = faltaParaSair(e);
  const proxima = proximaFase(e.fase);
  return { ok: faltando.length === 0 && proxima !== null, faltando, proxima };
}

/**
 * Os portões da fase, um a um, para a tela desenhar (cumprido ou não).
 * É a MESMA regra de `faltaParaSair`, só que nomeada por portão.
 */
export interface PortaoNaTela {
  chave: string;
  rotulo: string;
  cumprido: boolean;
  detalhe: string | null;
}

export function portoesDaFase(e: EstadoParaPortao): PortaoNaTela[] {
  const p = e.portoes ?? {};
  const nivel: Nivel | null = ehNivel(e.nivel) ? e.nivel : null;
  const porTema = new Map(e.itens.map((i) => [i.temaId, i.status]));
  const respondidos = (blocos: 'A' | 'BCD') => {
    const todos = obrigatorios(blocos, nivel);
    const ok = todos.filter((t) => itemRespondido(porTema.get(t.id) ?? 'em-branco'));
    return { ok: ok.length === todos.length, detalhe: `${ok.length} de ${todos.length} obrigatórios` };
  };
  const passo = temProximoPasso(e).length === 0;
  const passoDetalhe = e.proximoPasso
    ? `${e.proximoPasso} — ${e.proximoPassoDono ?? 'sem dono'}${e.proximoPassoEm ? ` · ${new Date(e.proximoPassoEm).toLocaleDateString('pt-BR')}` : ' · sem data'}`
    : null;

  switch (e.fase) {
    case OnboardingFase.qualificar: {
      const r = respondidos('A');
      return [
        { chave: 'perfil', rotulo: 'Perfil decidido (P1/P2/P3)', cumprido: !!e.perfil && e.perfil !== 'nao-entra', detalhe: e.perfil ?? null },
        { chave: 'triagem', rotulo: 'Bloco A respondido', cumprido: r.ok, detalhe: r.detalhe },
        { chave: 'proximo-passo', rotulo: 'Próximo passo com dono e data', cumprido: passo, detalhe: passoDetalhe },
      ];
    }
    case OnboardingFase.diagnostico:
      return [
        { chave: 'receita', rotulo: 'Frente escolhida (receita)', cumprido: !!e.receita, detalhe: e.receita },
        { chave: 'proposta', rotulo: 'Proposta enviada em até 48h', cumprido: !!p.propostaEnviadaEm, detalhe: p.propostaEnviadaEm ?? null },
        { chave: 'proximo-passo', rotulo: 'Próximo passo com dono e data', cumprido: passo, detalhe: passoDetalhe },
      ];
    case OnboardingFase.contrato: {
      const r = respondidos('BCD');
      const lb = p.linhaDeBase;
      return [
        { chave: 'entrada', rotulo: 'Entrada compensada', cumprido: !!p.entradaCompensadaEm, detalhe: p.entradaCompensadaEm ?? null },
        { chave: 'nivel', rotulo: 'Nível de oferta decidido', cumprido: !!e.nivel, detalhe: e.nivel },
        { chave: 'dupla', rotulo: 'Dupla nomeada (dono das perguntas + guardião do acesso)', cumprido: !!p.dupla?.donoPerguntas?.nome && !!p.dupla?.guardiaoAcesso?.nome, detalhe: [p.dupla?.donoPerguntas?.nome, p.dupla?.guardiaoAcesso?.nome].filter(Boolean).join(' + ') || null },
        { chave: 'linha-de-base', rotulo: 'Linha de base medida', cumprido: !!lb && typeof lb.valor === 'number' && !!lb.medidoEm && !!lb.quemMediu, detalhe: lb ? `${lb.metrica}: ${lb.valor}${lb.unidade ? ` ${lb.unidade}` : ''} (${lb.quemMediu})` : null },
        { chave: 'ambiente', rotulo: e.nivel === 'beaba' ? 'Ambiente (não se aplica ao beabá)' : 'Ambiente conferido no D-1', cumprido: e.nivel === 'beaba' || !!p.ambienteOkEm, detalhe: p.ambienteOkEm ?? null },
        { chave: 'formulario', rotulo: 'Blocos B–D confirmados pelo cliente', cumprido: r.ok, detalhe: r.detalhe },
        { chave: 'proximo-passo', rotulo: 'Próximo passo com dono e data', cumprido: passo, detalhe: passoDetalhe },
      ];
    }
    case OnboardingFase.imersao:
      return [
        { chave: 'criterio', rotulo: 'Critério de saída atingido na frente do cliente', cumprido: !!p.criterioDeSaida?.atingidoEm && !!p.criterioDeSaida?.evidencia, detalhe: p.criterioDeSaida?.evidencia ?? null },
        { chave: 'proximo-passo', rotulo: 'Próximo passo com dono e data', cumprido: passo, detalhe: passoDetalhe },
      ];
    case OnboardingFase.operacao:
      return [
        { chave: 'dia-30', rotulo: 'Medição do dia 30', cumprido: !!p.medicaoDia30, detalhe: p.medicaoDia30 ? `${p.medicaoDia30.valor} (${p.medicaoDia30.quemMediu})` : null },
        { chave: 'antes-depois', rotulo: 'Antes/depois registrado', cumprido: !!p.antesDepois, detalhe: p.antesDepois ? `${p.antesDepois.antes} → ${p.antesDepois.depois}` : null },
        { chave: 'case', rotulo: 'Case escrito', cumprido: !!p.caseEm, detalhe: p.caseEm ?? null },
        { chave: 'mensalidade', rotulo: 'Mensalidade proposta', cumprido: !!p.mensalidadePropostaEm, detalhe: p.mensalidadePropostaEm ?? null },
      ];
    case OnboardingFase.encerrado:
      return [];
  }
}

export function ehFase(v: unknown): v is OnboardingFase {
  return typeof v === 'string' && (ORDEM_DAS_FASES as readonly string[]).includes(v);
}

export function ehPerfilValido(v: unknown): v is Perfil {
  return v === 'P1' || v === 'P2' || v === 'P3' || v === 'nao-entra';
}
