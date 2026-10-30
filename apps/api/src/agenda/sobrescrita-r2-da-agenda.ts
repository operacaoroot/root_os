import {
  avaliar,
  lerPolitica,
  resolverPolitica,
  type Capacidade,
  type DeltaPolitica,
  type Politica,
} from '@mktos/policy';
import { CAPACIDADES_DA_AGENDA } from '@mktos/shared';

/* ==========================================================================
 * "MARCAR PELA TELA SAI NO CLIQUE": A SOBRESCRITA ASSINADA DA APROVAÇÃO DE R2
 * (agenda v2, 29/10/2026, decisão 2) — a parte pura
 * ==========================================================================
 *
 * O caminho honesto que `docs/AGENDA.md` ("A fricção conhecida") descreve: o
 * efeito declarado NÃO muda; marcar, alterar, cancelar e desmarcar já são R2
 * pela escada (cada um com um desfazer implementado), e o que esta sobrescrita
 * grava é UMA coisa só: `PolicyVersion.aprovacaoR2Ligada = false` para a
 * empresa, numa versão nova da política dela, com autor e motivo (RF-P-04,
 * RF-P-06). Desligar é afrouxamento: o `PolicyService.sobrescrever` recusa sem
 * assinatura.
 *
 * O ALCANCE É ESTREITO, e é a porta que o garante (`ToolGateway`, `naTela`): a
 * empresa só lê a aprovação desligada para GENTE NA TELA (ator `user`, `naTela`
 * posto pelo controlador da agenda depois de reler no banco que é pessoa). O
 * agente, as rotinas, o WhatsApp e o link público seguem com R2 retido. R3 (o
 * `agenda.reuniao.reabrir`) exige aprovação sempre e não muda.
 *
 * Este arquivo monta o delta (o que a empresa já tem, preservado: a
 * sobrescrita substitui o delta inteiro) e diz, pela MESMA régua da porta, o
 * que muda para cada capacidade da agenda. Quem aplica é o comando em
 * `sobrescrita-r2-da-agenda.cli.ts`.
 */

/** O motivo escrito da assinatura (RF-P-06) precisa dizer alguma coisa. */
export const MOTIVO_MINIMO_R2 = 20;

/** As escritas da agenda que a análise mostra, na ordem da tela. */
export const ESCRITAS_DA_AGENDA = [
  CAPACIDADES_DA_AGENDA.marcar,
  CAPACIDADES_DA_AGENDA.alterar,
  CAPACIDADES_DA_AGENDA.cancelar,
  CAPACIDADES_DA_AGENDA.desmarcar,
  CAPACIDADES_DA_AGENDA.reabrir,
] as const;

/** O delta que a empresa já tem, ou um vazio (a empresa herda tudo da base). */
export function deltaDaAprovacaoR2(atual: DeltaPolitica | null, hoje: string): DeltaPolitica {
  return {
    versao: atual?.versao ?? '1.0.0',
    atualizadoEm: hoje,
    origem: atual?.origem ?? 'sobrescrita da empresa',
    descricao: atual?.descricao ?? 'sobrescrita de política da empresa',
    estende: atual?.estende ?? 'politica-marketing-os.json',
    ...(atual?.limitesPadrao ? { limitesPadrao: atual.limitesPadrao } : {}),
    capacidades: [...(atual?.capacidades ?? [])],
  };
}

export interface LinhaDaAnalise {
  capacidade: string;
  nivel: string;
  /** Como a porta decide hoje para gente na tela (aprovação ligada). */
  hojeNaTela: 'fila' | 'clique';
  /** Como a porta decidiria para gente na tela com a aprovação desligada. */
  depoisNaTela: 'fila' | 'clique';
  /** Agente, rotina, link público: sempre a régua de sempre. */
  foraDaTela: 'fila' | 'clique';
}

/** O que muda, capacidade por capacidade, pela mesma régua da porta (sem sinais: dia comum, dentro da janela). */
export function analisarAprovacaoR2(base: Politica, delta: DeltaPolitica, ligadaHoje: boolean, ligadaDepois: boolean): LinhaDaAnalise[] {
  const resolvida = lerPolitica(resolverPolitica(base, delta), 'sobrescrita da aprovação de R2');
  return ESCRITAS_DA_AGENDA.map((id) => {
    const cap = (resolvida.capacidades.find((c) => c.id === id) ?? null) as unknown as Capacidade | null;
    const como = (ligada: boolean) => (avaliar(cap, ligada ? {} : { aprovacaoR2Ligada: false }).exigeAprovacao ? 'fila' : 'clique') as 'fila' | 'clique';
    return {
      capacidade: id,
      nivel: avaliar(cap, {}).nivel,
      hojeNaTela: como(ligadaHoje),
      depoisNaTela: como(ligadaDepois),
      foraDaTela: como(true),
    };
  });
}
