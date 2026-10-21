import { funcaoPorId, funcaoPorSlug, MARCO_DO_KIT, type AgenteNaEtapa, type EstadoDoAgenteNaEtapa, type FatoNaEtapa, type FuncaoDoCadastro, type QuemTrabalhaNaEtapa } from '@mktos/shared';

import type { AgenteDoRoster } from '../../agents/roster/roster';
import type { TipoDePendencia } from './relogio';

/*
 * QUEM TRABALHA NESTA ETAPA: a parte pura (rodada de produção 1, 21/10/2026).
 *
 * Junta o que já está gravado: os agentes do roster do onboarding (com o estado que o
 * dono declarou no banco), o último marco de cada um NESTE trilho, o gatilho do
 * procedimento dele (o que vai fazer e quando), a rotina do relógio e as pendências
 * que ela grava na próxima passagem. Nada é inventado: sem marco, "ainda não rodou".
 */

/** Os marcos que cada agente do roster grava no trilho (ver `leitura-da-ata.service.ts`). */
export const MARCOS_DO_AGENTE: Readonly<Record<string, readonly string[]>> = {
  'leitor-de-ata': ['ata.lida', 'ata.notas'],
  'pesquisador-de-conta': ['dossie.gerado'],
  'roteirista-de-kickoff': ['roteiro.personalizado'],
  // IM-07 (rodada dos agentes, 21/10/2026): o montador do kit grava o kit como marco.
  'montador-do-kit': [MARCO_DO_KIT],
};

/**
 * As funções da Implantação que trabalham no card e NÃO são semeadas como `Agent`
 * (o roster do onboarding semeia IM-01, IM-02 e IM-03). Aparecem na lista com o
 * estado declarado no cadastro único (rodada dos agentes, 21/10/2026).
 */
export const FUNCOES_DO_CARD_FORA_DO_ROSTER: readonly string[] = ['IM-07'];

/** O relógio no cadastro único. */
export const FUNCAO_DO_RELOGIO = 'IM-05';

/** O estado declarado no cadastro, na língua da tela da etapa (para quem não tem `Agent`). */
export function estadoDoCadastroNaEtapa(estado: FuncaoDoCadastro['estado']): EstadoDoAgenteNaEtapa {
  if (estado === 'ativo') return 'ativo';
  if (estado === 'desligado') return 'pausado';
  if (estado === 'so-homologacao') return 'planejado';
  return 'encerrado';
}

function iniciaisDe(nome: string): string {
  const p = nome.split(/\s+/).filter((x) => x.length > 2);
  return ((p[0]?.[0] ?? 'A') + (p[1]?.[0] ?? p[0]?.[1] ?? 'G')).toUpperCase();
}

/** Os campos do cadastro que a tela mostra ao lado de cada agente. */
function doCadastro(f: FuncaoDoCadastro | undefined): Pick<AgenteNaEtapa, 'funcao' | 'paraQueServe' | 'estadoDeclarado' | 'modelo' | 'esforco'> {
  if (!f) return {};
  return { funcao: f.id, paraQueServe: f.paraQueServe, estadoDeclarado: f.estado, modelo: f.modelo, esforco: f.esforco };
}

/** Os marcos que o relógio grava (os tipos de pendência de `relogio.ts`). */
export const MARCOS_DO_RELOGIO: readonly TipoDePendencia[] = [
  'convite.lembrete',
  'convite.cobranca-pessoal',
  'triagem.d-1',
  'ambiente.d-1',
  'proximo-passo.vencido',
  'sem-proximo-passo',
  'check.semanal',
  'medicao.dia-30',
  'alerta.sem-uso',
];

export interface MarcoLido {
  tipo: string;
  texto: string;
  em: Date;
  /** Quem gravou (o relógio grava como `relógio do onboarding`; o check semanal também pode ser de gente). */
  quem: string | null;
}

/** O nome com que o relógio assina os marcos (`TrilhoService.registrarPendencia`). */
export const QUEM_E_O_RELOGIO = 'relógio do onboarding';

function ultimo(marcos: readonly MarcoLido[], tipos: readonly string[], quem?: string): FatoNaEtapa | null {
  const m = marcos.filter((x) => tipos.includes(x.tipo) && (quem === undefined || x.quem === quem)).sort((a, b) => b.em.getTime() - a.em.getTime())[0];
  return m ? { texto: m.texto, em: m.em.toISOString() } : null;
}

function primeiraMinuscula(s: string): string {
  return s ? s.charAt(0).toLocaleLowerCase('pt-BR') + s.slice(1) : s;
}

export function montarQuemTrabalha(e: {
  trilho: { id: string; fase: string; faseRotulo: string };
  roster: readonly AgenteDoRoster[];
  estados: ReadonlyMap<string, string>;
  marcos: readonly MarcoLido[];
  rotina: { ativo: boolean; proximaExecucaoEm: Date | null } | null;
  pendencias: readonly { texto: string }[];
}): QuemTrabalhaNaEtapa {
  const agentes: AgenteNaEtapa[] = e.roster.map((a) => {
    const fato = ultimo(e.marcos, MARCOS_DO_AGENTE[a.slug] ?? []);
    const estado = (e.estados.get(a.slug) ?? 'ausente') as EstadoDoAgenteNaEtapa;
    const quando = primeiraMinuscula(a.sop.gatilho);
    const oQueVaiFazer = estado === 'ausente'
      ? 'Não está semeado nesta empresa: abre na primeira vez que a bancada do onboarding for aberta.'
      : estado === 'pausado' || estado === 'encerrado' || estado === 'planejado'
        ? `Está ${estado}: não roda até o dono ligar de novo em Agentes.`
        : fato
          ? `Já rodou neste cliente. Roda de novo com ${quando}.`
          : `Ainda não rodou neste cliente. Roda com ${quando}.`;
    const f = funcaoPorSlug(a.slug);
    return { slug: a.slug, nome: f?.nome ?? a.nome, iniciais: a.iniciais, missao: a.missao, estado, ultimoFato: fato, oQueVaiFazer, ...doCadastro(f) };
  });
  // As funções da Implantação sem `Agent` (IM-07): o estado é o declarado no cadastro.
  for (const id of FUNCOES_DO_CARD_FORA_DO_ROSTER) {
    const f = funcaoPorId(id);
    if (!f || agentes.some((a) => a.slug === f.slug)) continue;
    const fato = ultimo(e.marcos, MARCOS_DO_AGENTE[f.slug] ?? []);
    const estado = estadoDoCadastroNaEtapa(f.estado);
    const quando = primeiraMinuscula(f.gatilho);
    const oQueVaiFazer = estado !== 'ativo'
      ? `Está ${estado} no cadastro: não roda até o dono ligar de novo.`
      : fato
        ? `Já rodou neste cliente. Roda de novo com o botão "Montar kit" (gatilho: ${quando}).`
        : `Ainda não rodou neste cliente. Roda com o botão "Montar kit" (gatilho: ${quando}).`;
    agentes.push({ slug: f.slug, nome: f.nome, iniciais: iniciaisDe(f.nome), missao: f.paraQueServe, estado, ultimoFato: fato, oQueVaiFazer, ...doCadastro(f) });
  }
  const relogioDoCadastro = funcaoPorId(FUNCAO_DO_RELOGIO);
  return {
    trilhoId: e.trilho.id,
    fase: e.trilho.fase,
    faseRotulo: e.trilho.faseRotulo,
    agentes,
    relogio: {
      nome: relogioDoCadastro?.nome ?? 'Relógio do onboarding',
      ...(relogioDoCadastro ? { funcao: relogioDoCadastro.id, paraQueServe: relogioDoCadastro.paraQueServe } : {}),
      ligado: !!e.rotina?.ativo,
      proximaPassagemEm: e.rotina?.ativo && e.rotina.proximaExecucaoEm ? e.rotina.proximaExecucaoEm.toISOString() : null,
      ultimoFato: ultimo(e.marcos, MARCOS_DO_RELOGIO, QUEM_E_O_RELOGIO),
      vaiFazer: e.rotina?.ativo ? e.pendencias.map((p) => p.texto) : [],
    },
  };
}
