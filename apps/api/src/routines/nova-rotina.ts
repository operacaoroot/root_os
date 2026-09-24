import { AgentEstado } from '@prisma/client';
import { validarCron } from '../pauta/cron';
import { lerOrigensDaRodada } from '../pauta/origem-da-rodada';
import { TIPO_PAUTA_COLETA } from './rotina.tipos';

/*
 * A ROTINA CRIADA PELA TELA — `POST /rotinas` (MC5). A parte pura.
 *
 * Até o MC5 toda rotina nascia do espelho da pauta. Esta é a porta para as que
 * não têm linha de origem: só aceita tipo com executor inscrito (rotina órfã de
 * executor nunca dispara e só confundiria a tela), confere cron e fuso como a
 * tela de Pauta confere, e a configuração é conferida pelo tipo.
 */

export const SLUG_DA_ROTINA = /^[a-z0-9-]{2,60}$/;

/** O corpo aceito. `estado` ausente é `planejado`: rotina nova não começa agindo. */
export interface NovaRotinaInput {
  nome: string;
  slug?: string;
  tipo: string;
  cron: string;
  tz?: string;
  estado?: AgentEstado;
  config?: Record<string, unknown>;
}

export interface NovaRotinaLida {
  nome: string;
  slug: string;
  tipo: string;
  cron: string;
  tz: string;
  estado: AgentEstado;
  config: Record<string, unknown>;
}

export type ResultadoDaLeitura = { dados: NovaRotinaLida } | { erro: string };

type ConfigLida = { config: Record<string, unknown> } | { erro: string };

/** A janela da coleta, a mesma faixa que a curadoria aceita na tela (6h a 14 dias). */
const HORAS_MIN = 6;
const HORAS_MAX = 336;

function configDaColeta(bruto: Record<string, unknown>): ConfigLida {
  const desconhecidas = Object.keys(bruto).filter((k) => k !== 'horas' && k !== 'origens');
  if (desconhecidas.length) {
    return { erro: `config da coleta só aceita horas e origens (veio ${desconhecidas.join(', ')}).` };
  }
  const config: Record<string, unknown> = {};
  if (bruto.horas !== undefined) {
    const h = bruto.horas;
    if (typeof h !== 'number' || !Number.isInteger(h) || h < HORAS_MIN || h > HORAS_MAX) {
      return { erro: `config.horas é um número inteiro de ${HORAS_MIN} a ${HORAS_MAX}.` };
    }
    config.horas = h;
  }
  if (bruto.origens !== undefined) {
    const lidas = lerOrigensDaRodada(bruto.origens);
    if ('erro' in lidas) return { erro: `config.origens: ${lidas.erro}` };
    config.origens = lidas.origens;
  }
  return { config };
}

/** O que cada tipo aceita em `config`. Tipo fora daqui não recebe configuração. */
const CONFIG_POR_TIPO: Readonly<Record<string, (bruto: Record<string, unknown>) => ConfigLida>> = {
  [TIPO_PAUTA_COLETA]: configDaColeta,
};

function texto(v: unknown): string | null {
  return typeof v === 'string' ? v.trim() : null;
}

/** O nome vira slug: sem acento, minúsculo, hífen no lugar do resto. */
export function slugDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export function fusoValido(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function lerNovaRotina(bruto: unknown, tiposInscritos: readonly string[]): ResultadoDaLeitura {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { erro: 'Mande um objeto com nome, tipo e cron.' };
  }
  const b = bruto as Record<string, unknown>;

  const tipo = texto(b.tipo);
  if (!tipo) return { erro: 'Informe o tipo da rotina.' };
  if (!tiposInscritos.includes(tipo)) {
    return {
      erro:
        `O tipo "${tipo.slice(0, 60)}" não tem executor inscrito nesta instalação. ` +
        `Disponíveis: ${tiposInscritos.join(', ') || '(nenhum)'}.`,
    };
  }

  const nome = texto(b.nome);
  if (!nome || nome.length > 120) return { erro: 'O nome tem de 1 a 120 caracteres.' };

  const slug = b.slug === undefined || b.slug === '' ? slugDoNome(nome) : texto(b.slug);
  if (!slug || !SLUG_DA_ROTINA.test(slug)) {
    return { erro: 'O slug tem de 2 a 60 caracteres: letras minúsculas, números e hífen.' };
  }

  const cron = texto(b.cron);
  if (!cron) return { erro: 'Informe o cron (5 campos: minuto hora dia mês dia-da-semana).' };
  const v = validarCron(cron);
  if (!v.ok) return { erro: `Cron inválido: ${v.erro}` };

  const tz = b.tz === undefined ? 'America/Sao_Paulo' : texto(b.tz);
  if (!tz || tz.length > 60 || !fusoValido(tz)) return { erro: `Fuso inválido: "${String(b.tz).slice(0, 60)}".` };

  let estado: AgentEstado = AgentEstado.planejado;
  if (b.estado !== undefined) {
    if (!Object.values(AgentEstado).includes(b.estado as AgentEstado)) {
      return { erro: `Estado inválido. Use: ${Object.values(AgentEstado).join(', ')}.` };
    }
    estado = b.estado as AgentEstado;
  }

  let config: Record<string, unknown> = {};
  if (b.config !== undefined) {
    if (!b.config || typeof b.config !== 'object' || Array.isArray(b.config)) {
      return { erro: 'config é um objeto.' };
    }
    const lerConfig = CONFIG_POR_TIPO[tipo];
    const chaves = Object.keys(b.config);
    if (!lerConfig) {
      if (chaves.length) return { erro: `O tipo "${tipo}" não recebe configuração.` };
    } else {
      const lida = lerConfig(b.config as Record<string, unknown>);
      if ('erro' in lida) return lida;
      config = lida.config;
    }
  }

  return { dados: { nome, slug, tipo, cron, tz, estado, config } };
}
