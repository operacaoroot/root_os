import type { Efeito } from '../gateway/efeitos.registry';

/*
 * A LEITURA DO ESPELHO DA AGENDA NO GOOGLE (agenda v2, 29/10/2026, lane G1).
 *
 * Os dois efeitos R0 que a rotina `agenda.sincronizar` pede pela porta:
 *   · `comunicacao.agenda.sincronizar` — `events.list` com `syncToken` (410 =
 *     o token venceu, a sincronia refaz a janela de -30 a +180 dias);
 *   · `comunicacao.agenda.livre_ocupado` — `freeBusy.query` das agendas pessoais
 *     dos sócios (decisão 3): só começo e fim, nunca título.
 * Só LÊ.
 *
 * O ARQUIVO NÃO IMPORTA O CONECTOR (catraca de arquitetura): o `GoogleService`
 * importa ESTE arquivo e se passa como `ChamadorDaAgenda` na inscrição dos
 * efeitos. O HTTP continua lá, em `chamarAgenda` (destino fixo, só `/calendar/v3/`).
 *
 * UMA PÁGINA POR CHAMADA: o serviço do espelho (`agenda/espelho/`) pede a página
 * seguinte pelo `pagina` (o `pageToken` do Google). Cada página é uma chamada da
 * porta, com o RASTRO dela.
 *
 * O 410 NÃO VIRA ERRO AQUI: a porta transforma erro de efeito em 400 com a
 * mensagem, e o status se perderia no caminho. O token vencido volta como
 * resposta (`tokenVencido: true`) e o serviço refaz a janela inteira.
 */

/** O pedaço do conector que a agenda usa: uma chamada autenticada ao Calendar. */
export interface ChamadorDaAgenda {
  chamarAgenda<T = unknown>(orgId: string, caminho: string, init?: RequestInit): Promise<T>;
}

export const CAPACIDADE_DE_SINCRONIZAR = 'comunicacao.agenda.sincronizar';
export const CAPACIDADE_DE_LIVRE_OCUPADO = 'comunicacao.agenda.livre_ocupado';

/** Os eventos de uma página (o máximo que o Google aceita é 2500; 250 cabe no registro da porta). */
export const EVENTOS_POR_PAGINA = 250;
/** A descrição que o espelho guarda (o mesmo teto da coluna). */
export const TETO_DA_DESCRICAO = 8000;

/**
 * Os campos que o espelho guarda, e só eles. `fields` do Google, com os
 * parênteses que a regra do `chamarAgenda` não aceita crus: o `URLSearchParams`
 * os codifica.
 */
export const CAMPOS_DA_LISTA =
  'nextPageToken,nextSyncToken,items(id,status,summary,description,location,start,end,updated,htmlLink,' +
  'recurringEventId,originalStartTime,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),' +
  'organizer(email,self),attendees(email,displayName,organizer,optional,responseStatus,self),' +
  'extendedProperties(private))';

/** A página como o serviço a recebe: o evento cru do Google, que `espelho-do-google.ts` desmonta. */
export interface PaginaDaSincronia {
  itens: unknown[];
  nextSyncToken: string | null;
  nextPageToken: string | null;
  /** O Google respondeu 410: o `syncToken` venceu. Nada foi lido. */
  tokenVencido?: boolean;
}

export interface IntervaloOcupado {
  agenda: string;
  inicio: string;
  fim: string;
}

/** O livre/ocupado: só intervalos, e o erro de cada agenda que não respondeu. */
export interface RespostaDoLivreOcupado {
  intervalos: IntervaloOcupado[];
  erros: Array<{ agenda: string; motivo: string }>;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** O status 410 do `ErroDoGoogle`, sem importar a classe (ela mora ao lado do conector). */
const ehTokenVencido = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { status?: unknown }).status === 410;

const dataValida = (v: string): boolean => !!v && !Number.isNaN(Date.parse(v));

/** `events.list` de UMA página. Sem `syncToken`, a janela `de`–`ate` (a sincronia completa). */
export async function listarPaginaDaAgenda(
  google: ChamadorDaAgenda,
  orgId: string,
  args: { syncToken?: string; de?: string; ate?: string; pagina?: string },
): Promise<PaginaDaSincronia> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    showDeleted: 'true',
    maxResults: String(EVENTOS_POR_PAGINA),
    fields: CAMPOS_DA_LISTA,
  });
  const syncToken = texto(args.syncToken);
  if (syncToken) {
    // Com `syncToken` o Google recusa `timeMin`/`timeMax`/`orderBy`.
    params.set('syncToken', syncToken);
  } else {
    const de = texto(args.de);
    const ate = texto(args.ate);
    if (!dataValida(de) || !dataValida(ate) || Date.parse(ate) <= Date.parse(de)) {
      throw new Error('Sincronia completa sem janela: diga `de` e `ate` em ISO, com o fim depois do início.');
    }
    params.set('timeMin', new Date(de).toISOString());
    params.set('timeMax', new Date(ate).toISOString());
  }
  const pagina = texto(args.pagina);
  if (pagina) params.set('pageToken', pagina);

  try {
    const r = await google.chamarAgenda<{ items?: unknown[]; nextPageToken?: string; nextSyncToken?: string }>(
      orgId,
      `/calendar/v3/calendars/primary/events?${params.toString()}`,
    );
    return {
      itens: Array.isArray(r?.items) ? r.items.map(aparar) : [],
      nextSyncToken: texto(r?.nextSyncToken) || null,
      nextPageToken: texto(r?.nextPageToken) || null,
    };
  } catch (e) {
    if (syncToken && ehTokenVencido(e)) return { itens: [], nextSyncToken: null, nextPageToken: null, tokenVencido: true };
    throw e;
  }
}

/** A descrição cortada no teto do espelho: o resto do evento passa como veio. */
function aparar(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item;
  const e = item as { description?: unknown };
  if (typeof e.description === 'string' && e.description.length > TETO_DA_DESCRICAO) {
    return { ...e, description: e.description.slice(0, TETO_DA_DESCRICAO) };
  }
  return item;
}

/**
 * `freeBusy.query` das agendas pessoais. Uma agenda que não foi compartilhada
 * (ou não existe) volta com o erro DELA; as outras seguem. Do Google só se lê
 * `busy` (começo e fim): título não existe nesta resposta, e nada além dos dois
 * campos é repassado.
 */
export async function lerLivreOcupado(
  google: ChamadorDaAgenda,
  orgId: string,
  args: { agendas: string[]; de: string; ate: string },
): Promise<RespostaDoLivreOcupado> {
  const agendas = [...new Set((args.agendas ?? []).map(texto).filter(Boolean))];
  if (agendas.length === 0) return { intervalos: [], erros: [] };
  if (!dataValida(args.de) || !dataValida(args.ate) || Date.parse(args.ate) <= Date.parse(args.de)) {
    throw new Error('Livre/ocupado sem período: diga `de` e `ate` em ISO, com o fim depois do início.');
  }
  const r = await google.chamarAgenda<{
    calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }>; errors?: Array<{ reason?: string }> }>;
  }>(orgId, '/calendar/v3/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: new Date(args.de).toISOString(),
      timeMax: new Date(args.ate).toISOString(),
      items: agendas.map((id) => ({ id })),
    }),
  });

  const intervalos: IntervaloOcupado[] = [];
  const erros: RespostaDoLivreOcupado['erros'] = [];
  const porAgenda = r?.calendars ?? {};
  for (const agenda of agendas) {
    // O Google devolve a chave como pedida, às vezes em minúsculas.
    const c = porAgenda[agenda] ?? porAgenda[agenda.toLowerCase()];
    if (!c) {
      erros.push({ agenda, motivo: 'o Google não respondeu por esta agenda' });
      continue;
    }
    if (Array.isArray(c.errors) && c.errors.length > 0) {
      const motivo = texto(c.errors[0]?.reason);
      erros.push({
        agenda,
        motivo: motivo === 'notFound'
          ? 'agenda não compartilhada com a conta da Root (ou não existe)'
          : `o Google recusou esta agenda (${motivo || 'sem motivo'})`,
      });
      continue;
    }
    for (const b of c.busy ?? []) {
      const inicio = texto(b?.start);
      const fim = texto(b?.end);
      if (dataValida(inicio) && dataValida(fim) && Date.parse(fim) > Date.parse(inicio)) {
        intervalos.push({ agenda, inicio: new Date(inicio).toISOString(), fim: new Date(fim).toISOString() });
      }
    }
  }
  return { intervalos, erros };
}

export function efeitosDaLeituraDaAgenda(google: ChamadorDaAgenda): Record<string, Efeito> {
  return {
    [CAPACIDADE_DE_SINCRONIZAR]: (a, org) =>
      listarPaginaDaAgenda(google, org, {
        syncToken: texto(a.syncToken) || undefined,
        de: texto(a.de) || undefined,
        ate: texto(a.ate) || undefined,
        pagina: texto(a.pagina) || undefined,
      }),
    [CAPACIDADE_DE_LIVRE_OCUPADO]: (a, org) =>
      lerLivreOcupado(google, org, {
        agendas: Array.isArray(a.agendas) ? (a.agendas as unknown[]).map(texto) : [],
        de: texto(a.de),
        ate: texto(a.ate),
      }),
  };
}
