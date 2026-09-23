import { OnboardingFase } from '@prisma/client';

import { COBRANCA_PESSOAL_DIAS, LEMBRETE_DIAS, diasDesde } from './convite';
import type { Portoes } from './fases';

/* ==========================================================================
 * O RELÓGIO DO TRILHO — o que a rotina diária olha
 * ==========================================================================
 *
 * A ferramenta "dispara o que é automático" (nota do Pedro, §1). Este arquivo
 * é a parte que DECIDE o que está vencido; a rotina (`onboarding.relogio`)
 * só chama isto e grava o resultado como marco na linha do tempo do trilho.
 *
 * O que ele olha, fase a fase:
 *   · convite enviado há 3 dias sem concluir → lembrete (uma vez);
 *   · 5 dias → cobrança pessoal do sócio (uma vez);
 *   · fase 0 com reunião em D-1 e bloco A sem resposta → aviso ao dono;
 *   · fase 2 com imersão em D-1 e ambiente não conferido → aviso;
 *   · qualquer fase aberta com próximo passo vencido, ou sem próximo passo;
 *   · fase 4: check semanal em atraso, medição do dia 30 vencida, N dias sem
 *     uso (o N é da mesa; o padrão provisório é 7).
 *
 * PURO. A data "agora" entra por parâmetro para o teste poder mover o relógio.
 */

export const N_DIAS_SEM_USO_PADRAO = 7;
export const CHECK_SEMANAL_DIAS = 7;
export const MEDICAO_DIA = 30;

const DIA_MS = 86_400_000;

export interface ConviteParaRelogio {
  id: string;
  trilhoId: string;
  blocos: string;
  enviadoEm: Date | null;
  lembradoEm: Date | null;
  concluidoEm: Date | null;
  revogadoEm: Date | null;
  validoAte: Date;
}

export interface TrilhoParaRelogio {
  id: string;
  cliente: string;
  fase: OnboardingFase;
  reuniaoEm: Date | null;
  imersaoEm: Date | null;
  portoes: Portoes;
  proximoPasso: string | null;
  proximoPassoEm: Date | null;
  /** Quando entrou na fase atual (do marco `fase.avancou`), ou a criação. */
  faseDesde: Date;
  /** O último marco `check.semanal`, se houve. */
  ultimoCheckEm: Date | null;
  /** A última pergunta/uso do cliente no OS, se medido. */
  ultimaAtividadeEm: Date | null;
  /** Marcos já registrados nas últimas 24h, por tipo — para não repetir. */
  marcosRecentes: readonly string[];
  /** Aviso de cobrança pessoal já dado? (marco `convite.cobranca-pessoal`) */
  cobrancaPessoalDadaEm: Date | null;
}

export type TipoDePendencia =
  | 'convite.lembrete'
  | 'convite.cobranca-pessoal'
  | 'triagem.d-1'
  | 'ambiente.d-1'
  | 'proximo-passo.vencido'
  | 'sem-proximo-passo'
  | 'check.semanal'
  | 'medicao.dia-30'
  | 'alerta.sem-uso';

export interface Pendencia {
  trilhoId: string;
  tipo: TipoDePendencia;
  texto: string;
  /** O convite de que a pendência fala, quando há um. */
  conviteId?: string;
  dados?: Record<string, unknown>;
}

export interface ConfigDoRelogio {
  nDiasSemUso: number;
}

function diasAte(alvo: Date, agora: Date): number {
  return Math.ceil((alvo.getTime() - agora.getTime()) / DIA_MS);
}

export function pendencias(
  trilhos: readonly TrilhoParaRelogio[],
  convites: readonly ConviteParaRelogio[],
  agora: Date,
  config: ConfigDoRelogio = { nDiasSemUso: N_DIAS_SEM_USO_PADRAO },
): Pendencia[] {
  const saida: Pendencia[] = [];
  const porTrilho = new Map<string, ConviteParaRelogio[]>();
  for (const c of convites) {
    (porTrilho.get(c.trilhoId) ?? porTrilho.set(c.trilhoId, []).get(c.trilhoId)!).push(c);
  }

  for (const t of trilhos) {
    if (t.fase === OnboardingFase.encerrado) continue;
    const recentes = new Set(t.marcosRecentes);
    const push = (p: Pendencia) => {
      if (!recentes.has(p.tipo)) saida.push(p);
    };
    const meus = porTrilho.get(t.id) ?? [];

    // ---- convites -----------------------------------------------------
    for (const c of meus) {
      if (!c.enviadoEm || c.concluidoEm || c.revogadoEm) continue;
      if (c.validoAte.getTime() <= agora.getTime()) continue;
      const dias = diasDesde(c.enviadoEm, agora);
      if (dias >= COBRANCA_PESSOAL_DIAS && c.lembradoEm && !t.cobrancaPessoalDadaEm) {
        push({
          trilhoId: t.id,
          tipo: 'convite.cobranca-pessoal',
          conviteId: c.id,
          texto: `${t.cliente}: o link (${c.blocos}) foi enviado há ${dias} dias, o lembrete já foi e não houve conclusão. Hora de o sócio cobrar pessoalmente.`,
          dados: { dias, blocos: c.blocos },
        });
      } else if (dias >= LEMBRETE_DIAS && !c.lembradoEm) {
        push({
          trilhoId: t.id,
          tipo: 'convite.lembrete',
          conviteId: c.id,
          texto: `${t.cliente}: o link (${c.blocos}) foi enviado há ${dias} dias sem conclusão. Lembrete automático preparado.`,
          dados: { dias, blocos: c.blocos },
        });
      }
    }

    // ---- fase 0: a triagem no D-1 ---------------------------------------
    if (t.fase === OnboardingFase.qualificar && t.reuniaoEm) {
      const faltam = diasAte(t.reuniaoEm, agora);
      const triagem = meus.find((c) => c.blocos === 'A');
      const respondida = !!t.portoes?.triagemRespondidaEm || !!triagem?.concluidoEm;
      if (faltam <= 1 && faltam >= -0 && !respondida) {
        push({
          trilhoId: t.id,
          tipo: 'triagem.d-1',
          texto: `${t.cliente}: a reunião é amanhã e o bloco A não foi respondido. Avise o dono; a reunião vai começar sem o raio-x.`,
          dados: { reuniaoEm: t.reuniaoEm.toISOString() },
        });
      }
    }

    // ---- fase 2: o ambiente no D-1 --------------------------------------
    if (t.fase === OnboardingFase.contrato && t.imersaoEm) {
      const faltam = diasAte(t.imersaoEm, agora);
      if (faltam <= 1 && faltam >= 0 && !t.portoes?.ambienteOkEm) {
        push({
          trilhoId: t.id,
          tipo: 'ambiente.d-1',
          texto: `${t.cliente}: a imersão é amanhã e o ambiente não foi conferido (card 15). Quem não confirmou não começa.`,
          dados: { imersaoEm: t.imersaoEm.toISOString() },
        });
      }
    }

    // ---- próximo passo ---------------------------------------------------
    if (!t.proximoPasso?.trim()) {
      push({
        trilhoId: t.id,
        tipo: 'sem-proximo-passo',
        texto: `${t.cliente}: sem próximo passo com dono e data. Estado sem próximo passo é alerta.`,
      });
    } else if (t.proximoPassoEm && t.proximoPassoEm.getTime() < agora.getTime()) {
      push({
        trilhoId: t.id,
        tipo: 'proximo-passo.vencido',
        texto: `${t.cliente}: o próximo passo "${t.proximoPasso}" venceu em ${t.proximoPassoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
        dados: { proximoPassoEm: t.proximoPassoEm.toISOString() },
      });
    }

    // ---- fase 4: operação assistida --------------------------------------
    if (t.fase === OnboardingFase.operacao) {
      const desdeCheck = t.ultimoCheckEm ?? t.faseDesde;
      if (diasDesde(desdeCheck, agora) >= CHECK_SEMANAL_DIAS) {
        push({
          trilhoId: t.id,
          tipo: 'check.semanal',
          texto: `${t.cliente}: check semanal de 30 min em atraso (último há ${diasDesde(desdeCheck, agora)} dias).`,
        });
      }
      if (diasDesde(t.faseDesde, agora) >= MEDICAO_DIA && !t.portoes?.medicaoDia30) {
        push({
          trilhoId: t.id,
          tipo: 'medicao.dia-30',
          texto: `${t.cliente}: dia 30 de operação chegou e a medição contra a linha de base não foi registrada.`,
        });
      }
      const ultima = t.ultimaAtividadeEm ?? t.faseDesde;
      const semUso = diasDesde(ultima, agora);
      if (semUso >= config.nDiasSemUso) {
        push({
          trilhoId: t.id,
          tipo: 'alerta.sem-uso',
          texto: `${t.cliente}: ${semUso} dias sem uso ou mensagem. Contato ativo (card 35).`,
          dados: { dias: semUso, n: config.nDiasSemUso },
        });
      }
    }
  }

  return saida;
}
