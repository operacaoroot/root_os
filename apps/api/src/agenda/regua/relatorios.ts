import {
  PROPRIEDADES_DO_OS,
  SOCIOS_DA_AGENDA,
  pessoasDoEvento,
  type EventoDaAgenda,
  type RegraDaPessoa,
  type RelatorioDaAgenda,
  type TipoDeCompromisso,
} from '@mktos/shared';

/*
 * OS RELATÓRIOS DA AGENDA (agenda v2, 29/10/2026, lane G5) — a parte pura.
 *
 * Contagem do que está no espelho no período, sem nada inventado: compromissos
 * por sócio e por tipo, reuniões online de cliente sem Meet, sócio sem e-mail
 * na Equipe (o convite não chega a ele), o que foi "marcado assim mesmo" (o
 * motivo e quem pediu vêm das propriedades privadas que o OS grava no evento) e
 * quantos foram criados direto no Google (só a contagem: marcar pelo celular é
 * a redundância da casa, não é erro).
 */

export interface EntradaDoRelatorio {
  de: string;
  ate: string;
  eventos: readonly EventoDaAgenda[];
  pessoas: readonly RegraDaPessoa[];
  /** As propriedades privadas por id de evento, quando o evento não as traz. */
  propriedades?: ReadonlyMap<string, Record<string, string>>;
  /** O nome de quem pediu, pelo id do usuário no OS. */
  nomes?: ReadonlyMap<string, string>;
}

const props = (ev: EventoDaAgenda, extra?: ReadonlyMap<string, Record<string, string>>) => ev.propriedades ?? extra?.get(ev.id) ?? {};

export function montarRelatorio(e: EntradaDoRelatorio): RelatorioDaAgenda {
  const vivos = e.eventos.filter((x) => x.status !== 'cancelado');
  const porTipo: Partial<Record<TipoDeCompromisso, number>> = {};
  const porSocio = SOCIOS_DA_AGENDA.map((socio) => ({ socio, total: 0, porTipo: {} as Partial<Record<TipoDeCompromisso, number>> }));
  const semMeet: RelatorioDaAgenda['semMeet'] = [];
  const marcadosAssimMesmo: RelatorioDaAgenda['marcadosAssimMesmo'] = [];
  let criadosDiretoNoGoogle = 0;

  for (const ev of [...vivos].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    const tipo = ev.leitura?.tipo ?? 'outro';
    porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;
    const quem = pessoasDoEvento(ev, e.pessoas);
    for (const linha of porSocio) {
      if (!quem.has(linha.socio)) continue;
      linha.total++;
      linha.porTipo[tipo] = (linha.porTipo[tipo] ?? 0) + 1;
    }
    if (tipo === 'cliente' && ev.leitura.modalidade === 'online' && !ev.meet) {
      semMeet.push({ id: ev.id, titulo: ev.titulo, inicio: ev.inicio });
    }
    const p = props(ev, e.propriedades);
    const motivo = p[PROPRIEDADES_DO_OS.forcado];
    if (motivo) {
      const pedidoPor = p[PROPRIEDADES_DO_OS.pedidoPor] ?? null;
      marcadosAssimMesmo.push({
        eventoId: ev.id,
        titulo: ev.titulo,
        inicio: ev.inicio,
        motivo,
        quem: pedidoPor ? (e.nomes?.get(pedidoPor) ?? null) : null,
        quando: ev.atualizadoNoGoogle ?? ev.inicio,
      });
    }
    if (ev.origem === 'google' && !ev.criadoPeloOs && p[PROPRIEDADES_DO_OS.criadoPeloOs] !== '1') criadosDiretoNoGoogle++;
  }

  return {
    de: e.de,
    ate: e.ate,
    porSocio,
    porTipo,
    semMeet,
    responsavelSemEmail: e.pessoas.filter((p) => !p.email).map((p) => p.nome),
    marcadosAssimMesmo,
    criadosDiretoNoGoogle,
  };
}
