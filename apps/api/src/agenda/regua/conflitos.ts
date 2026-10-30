import { createHash } from 'node:crypto';
import {
  PROPRIEDADES_DO_OS,
  SOCIOS_DA_AGENDA,
  avaliarNaRegua,
  diasDoEvento,
  horaDaAgenda,
  instanteDaAgenda,
  lerCompromisso,
  noFusoDaAgenda,
  pessoasDoEvento,
  proximoDiaUtil,
  ritosDoDia,
  rotuloDoDia,
  somarDias,
  sugerirHorarios,
  type AcaoDoConflito,
  type CartaoDeConflito,
  type EventoDaAgenda,
  type ItemDaRegua,
  type PedidoDeEscrita,
  type RegrasDaAgenda,
  type RetratoDoCompromisso,
  type SocioDaAgenda,
  type TipoDeConflito,
  type TipoQueSeMarca,
} from '@mktos/shared';

/*
 * OS CONFLITOS DA AGENDA (agenda v2, 29/10/2026, lane G5) — a parte pura.
 *
 * O MESMO motor da régua (`avaliarNaRegua`) passado sobre cada reunião dos
 * próximos dias, com o próprio evento fora da conta, mais o que o vigia AG-01
 * achou fora do padrão, numa lista só. Cada cartão traz os consertos com o
 * `PedidoDeEscrita` PRONTO: o botão manda o pedido a `POST /agenda/escritas`
 * (lane D), pela mesma porta e com a mesma regra de aprovação da tela. O que não
 * é escrita na agenda (aplicar o título do vigia, "não é reunião") vem com a
 * `rota` do vigia; "remarcar" e "manter" são da tela.
 *
 * A chave de cada pedido é derivada do cartão e da ação (sha256 em base32hex,
 * o alfabeto que o Google aceita em id de evento): o mesmo botão clicado duas
 * vezes manda a mesma chave, e a escrita é idempotente por ela.
 */

/** O que o vigia AG-01 deixou aberto (`AgendaConferencia` em `proposta` ou `pendencia`). */
export interface ItemDoVigiaNosConflitos {
  eventoId: string;
  tituloAtual: string;
  inicio: string | null;
  estado: 'proposta' | 'pendencia';
  problemas: string[];
  tituloProposto: string | null;
  adicionarMeet: boolean;
  /** A pendência aberta, quando há, e se ela oferece "não é reunião". */
  pendenciaId: string | null;
  opcaoNaoEReuniao: string | null;
}

export interface EntradaDosConflitos {
  orgId: string;
  /** Os eventos do espelho do período (com um dia de folga antes, para o vizinho). */
  eventos: readonly EventoDaAgenda[];
  regras: Pick<RegrasDaAgenda, 'pessoas' | 'ritos' | 'feriados'>;
  agora: Date;
  dias: number;
  vigia?: readonly ItemDoVigiaNosConflitos[];
  /** As propriedades privadas por id de evento, quando o evento não as traz. */
  propriedades?: ReadonlyMap<string, Record<string, string>>;
}

const MIN = 60_000;

/** O peso por tipo, em minutos somados ao "minutos até o início": só ordena, não decide nada. */
const PESO: Record<TipoDeConflito, number> = { choque: 0, feriado: 0, fora: 0, teto: 30, rito: 60, padrao: 60, sem_meet: 90, janela: 120 };
/** O confirmado com o cliente continua na lista, depois de todo o resto. */
const PESO_DO_CONFIRMADO = 10_000_000;

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/** A chave determinística de um pedido: sha256 → base32hex, 32 caracteres (`[a-v0-9]{10,64}`). */
export function chaveDoPedido(...partes: unknown[]): string {
  const bytes = createHash('sha256').update(JSON.stringify(partes)).digest();
  let bits = 0;
  let valor = 0;
  let out = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < 32) {
      out += BASE32HEX[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

const ehReuniao = (ev: EventoDaAgenda): boolean =>
  (ev.leitura?.tipo === 'cliente' || ev.leitura?.tipo === 'interna') && ev.status !== 'cancelado' && !ev.diaInteiro;

const nomeCurto = (ev: EventoDaAgenda): string => ev.leitura?.cliente || ev.titulo || 'o compromisso';

const retrato = (ev: EventoDaAgenda): RetratoDoCompromisso => ({
  titulo: ev.titulo ?? '',
  inicio: ev.inicio,
  fim: ev.fim,
  local: ev.local,
  meet: !!ev.meet,
});

const quandoCurto = (iso: string): string => {
  const { dia } = noFusoDaAgenda(new Date(iso));
  return `${rotuloDoDia(dia)} ${horaDaAgenda(iso)}`;
};

function propsDo(ev: EventoDaAgenda, extra?: ReadonlyMap<string, Record<string, string>>): Record<string, string> {
  return ev.propriedades ?? extra?.get(ev.id) ?? {};
}

export function confirmadoComCliente(ev: EventoDaAgenda, extra?: ReadonlyMap<string, Record<string, string>>): boolean {
  return propsDo(ev, extra)[PROPRIEDADES_DO_OS.confirmadoComCliente] === '1';
}

/** O compromisso de um evento, como a régua o recebe. */
function propostaDo(ev: EventoDaAgenda, pessoas: RegrasDaAgenda['pessoas'], responsaveis?: SocioDaAgenda[]) {
  const tipo: TipoQueSeMarca = ev.leitura.tipo === 'cliente' ? 'cliente' : 'interna';
  return {
    tipo,
    modalidade: ev.leitura.modalidade ?? (ev.meet ? 'online' : null),
    responsaveis: responsaveis ?? [...pessoasDoEvento(ev, pessoas)],
    inicio: ev.inicio,
    fim: ev.fim,
    ignorarEventoId: ev.id,
  } as const;
}

interface Contexto {
  e: EntradaDosConflitos;
  cartoes: Map<string, CartaoDeConflito>;
}

const alterar = (ctx: Contexto, cartaoId: string, tipo: AcaoDoConflito['tipo'], ev: EventoDaAgenda, depois: Extract<PedidoDeEscrita, { acao: 'alterar' }>['depois']): PedidoDeEscrita => ({
  acao: 'alterar',
  chave: chaveDoPedido(ctx.e.orgId, cartaoId, tipo, ev.id, depois),
  eventoId: ev.id,
  antes: retrato(ev),
  depois,
});

/** "Empurrar X para 10:30": o primeiro horário verde a partir do próprio horário, sem ele na conta. */
function acaoDeEmpurrar(ctx: Contexto, cartaoId: string, ev: EventoDaAgenda, aPartirDe?: Date): AcaoDoConflito | null {
  if (!ev.titulo) return null;
  const p = propostaDo(ev, ctx.e.regras.pessoas);
  if (!p.responsaveis.length) return null;
  const duracaoMin = Math.max(5, Math.round((new Date(ev.fim).getTime() - new Date(ev.inicio).getTime()) / MIN));
  const desde = new Date(Math.max((aPartirDe ?? new Date(ev.inicio)).getTime(), ctx.e.agora.getTime()));
  const [h] = sugerirHorarios({
    eventos: ctx.e.eventos,
    regras: ctx.e.regras,
    base: { tipo: p.tipo, modalidade: p.modalidade, responsaveis: p.responsaveis, ignorarEventoId: ev.id, duracaoMin },
    aPartirDe: desde,
    limite: 1,
    dias: 14,
  });
  if (!h || h.inicio === ev.inicio) return null;
  const mesmoDia = noFusoDaAgenda(new Date(h.inicio)).dia === noFusoDaAgenda(new Date(ev.inicio)).dia;
  return {
    tipo: 'empurrar',
    rotulo: `Empurrar ${nomeCurto(ev)} para ${mesmoDia ? horaDaAgenda(h.inicio) : quandoCurto(h.inicio)}`,
    pedido: alterar(ctx, cartaoId, 'empurrar', ev, { inicio: h.inicio, fim: h.fim }),
  };
}

/** "Passar X para o Lucas (livre)": o substituto primeiro, depois os outros; só quem dá verde. */
function acaoDePassar(ctx: Contexto, cartaoId: string, ev: EventoDaAgenda): AcaoDoConflito | null {
  if (!ev.titulo || ev.leitura.tipo !== 'cliente') return null;
  const atuais = [...pessoasDoEvento(ev, ctx.e.regras.pessoas)];
  if (atuais.length !== 1) return null;
  const substituto = ctx.e.regras.pessoas.find((p) => p.nome === atuais[0])?.substituto ?? null;
  const ordem = [...new Set([substituto, ...SOCIOS_DA_AGENDA].filter((s): s is SocioDaAgenda => !!s && s !== atuais[0]))];
  for (const outro of ordem) {
    const r = avaliarNaRegua({ eventos: ctx.e.eventos, regras: ctx.e.regras, proposta: propostaDo(ev, ctx.e.regras.pessoas, [outro]) });
    if (r.cor !== 'verde') continue;
    return {
      tipo: 'passar',
      rotulo: `Passar ${nomeCurto(ev)} para o ${outro} (livre)`,
      pedido: alterar(ctx, cartaoId, 'passar', ev, { responsaveis: [outro] }),
    };
  }
  return null;
}

const acaoDeRemarcar = (): AcaoDoConflito => ({ tipo: 'remarcar', rotulo: 'Remarcar…', pedido: null });
const acaoDeManter = (rotulo = 'Deixar assim'): AcaoDoConflito => ({ tipo: 'manter', rotulo, pedido: null });

function acaoDeConfirmar(ctx: Contexto, cartaoId: string, ev: EventoDaAgenda): AcaoDoConflito | null {
  if (!ev.titulo || confirmadoComCliente(ev, ctx.e.propriedades)) return null;
  return {
    tipo: 'confirmado_com_cliente',
    rotulo: 'Marcar como confirmado com o cliente',
    pedido: alterar(ctx, cartaoId, 'confirmado_com_cliente', ev, { confirmadoComCliente: true }),
  };
}

function acaoDeModalidade(ctx: Contexto, cartaoId: string, ev: EventoDaAgenda): AcaoDoConflito | null {
  if (!ev.titulo || ev.leitura.tipo !== 'cliente' || !ev.leitura.modalidade) return null;
  const nova = ev.leitura.modalidade === 'online' ? 'presencial' : 'online';
  return {
    tipo: 'trocar_modalidade',
    rotulo: `Trocar para ${nova}`,
    pedido: alterar(ctx, cartaoId, 'trocar_modalidade', ev, { modalidade: nova, ...(nova === 'online' ? { criarMeet: true } : {}) }),
  };
}

const semNulos = (xs: Array<AcaoDoConflito | null>): AcaoDoConflito[] => xs.filter((x): x is AcaoDoConflito => !!x);

const resumoDoEvento = (ev: EventoDaAgenda) => ({ id: ev.id, titulo: ev.titulo, inicio: ev.inicio, fim: ev.fim });

function guardar(ctx: Contexto, c: Omit<CartaoDeConflito, 'urgencia' | 'confirmado'> & { confirmado?: boolean }): void {
  if (ctx.cartoes.has(c.id)) return;
  const confirmado = c.confirmado ?? false;
  const minutos = Math.max(0, Math.round((new Date(c.quando).getTime() - ctx.e.agora.getTime()) / MIN));
  ctx.cartoes.set(c.id, { ...c, confirmado, urgencia: minutos + PESO[c.tipo] + (confirmado ? PESO_DO_CONFIRMADO : 0) });
}

const pessoasDoItem = (i: ItemDaRegua, ev: EventoDaAgenda, ctx: Contexto): SocioDaAgenda[] =>
  i.pessoa ? [i.pessoa] : [...pessoasDoEvento(ev, ctx.e.regras.pessoas)];

/** Os cartões de uma reunião, pelos itens da régua. */
function daReuniao(ctx: Contexto, ev: EventoDaAgenda, porId: Map<string, EventoDaAgenda>): void {
  const p = propostaDo(ev, ctx.e.regras.pessoas);
  if (!p.responsaveis.length) return;
  const r = avaliarNaRegua({ eventos: ctx.e.eventos, regras: ctx.e.regras, proposta: p });
  const janela: ItemDaRegua[] = [];

  for (const i of r.itens) {
    if (i.nivel === 'ok') continue;
    const outro = i.eventoId ? porId.get(i.eventoId) : undefined;

    if ((i.regra === 'choque' || i.regra === 'fechado') && i.nivel === 'bloqueio') {
      // Um cartão por par. Quem se mexe é o que começa depois (empate: o de id maior); contra Fechado, a reunião.
      const par = [ev.id, i.eventoId ?? 'fechado'].sort();
      const id = `choque:${par.join('+')}:${i.pessoa ?? ''}`;
      const reunioes = [ev, outro].filter((x): x is EventoDaAgenda => !!x && ehReuniao(x));
      const mover =
        reunioes.length === 2
          ? [...reunioes].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id))[1]
          : ev;
      const todos = [ev, ...(outro ? [outro] : [])].sort((a, b) => a.inicio.localeCompare(b.inicio));
      const confirmado = todos.some((x) => confirmadoComCliente(x, ctx.e.propriedades));
      guardar(ctx, {
        id,
        tipo: 'choque',
        quando: todos[0].inicio,
        pessoas: pessoasDoItem(i, ev, ctx),
        titulo: i.regra === 'fechado' ? `${i.pessoa} está Fechado no horário de ${nomeCurto(ev)}` : `${i.pessoa} está em dois lugares ao mesmo tempo`,
        frase: i.frase,
        eventos: todos.map(resumoDoEvento),
        acoes: semNulos([
          acaoDeEmpurrar(ctx, id, mover),
          acaoDePassar(ctx, id, mover),
          acaoDeRemarcar(),
          confirmado ? null : acaoDeConfirmar(ctx, id, mover),
        ]),
        serieId: mover.serieId,
        confirmado,
      });
      continue;
    }

    if (i.regra === 'fora' && i.nivel === 'bloqueio') {
      const id = `fora:${ev.id}:${i.pessoa ?? ''}`;
      guardar(ctx, {
        id,
        tipo: 'fora',
        quando: ev.inicio,
        pessoas: pessoasDoItem(i, ev, ctx),
        titulo: `${i.pessoa} está Fora no dia de ${nomeCurto(ev)}`,
        frase: i.frase,
        eventos: [resumoDoEvento(ev), ...(outro ? [resumoDoEvento(outro)] : [])],
        acoes: semNulos([acaoDePassar(ctx, id, ev), acaoDeEmpurrar(ctx, id, ev), acaoDeRemarcar()]),
        serieId: ev.serieId,
      });
      continue;
    }

    if (i.regra === 'feriado' && i.nivel === 'bloqueio') {
      const id = `feriado:${ev.id}`;
      guardar(ctx, {
        id,
        tipo: 'feriado',
        quando: ev.inicio,
        pessoas: [...pessoasDoEvento(ev, ctx.e.regras.pessoas)],
        titulo: `${nomeCurto(ev)} marcado no feriado`,
        frase: i.frase,
        eventos: [resumoDoEvento(ev)],
        acoes: semNulos([acaoDeDiaUtil(ctx, id, ev), acaoDeRemarcar()]),
        serieId: ev.serieId,
      });
      continue;
    }

    if (i.regra === 'rito') {
      const id = `rito:${ev.id}`;
      guardar(ctx, {
        id,
        tipo: 'rito',
        quando: ev.inicio,
        pessoas: pessoasDoItem(i, ev, ctx),
        titulo: `${nomeCurto(ev)} em cima de um rito da casa`,
        frase: i.frase,
        eventos: [resumoDoEvento(ev)],
        acoes: semNulos([acaoDeEmpurrar(ctx, id, ev), acaoDeRemarcar(), i.nivel === 'atencao' ? acaoDeManter() : null]),
        serieId: ev.serieId,
      });
      continue;
    }

    if (i.regra === 'teto' && i.nivel === 'bloqueio' && i.pessoa) {
      // Um cartão por pessoa e dia; quem se mexe é a última reunião do dia.
      const dia = noFusoDaAgenda(new Date(ev.inicio)).dia;
      const doDia = ctx.e.eventos
        .filter((x) => ehReuniao(x) && pessoasDoEvento(x, ctx.e.regras.pessoas).has(i.pessoa!) && noFusoDaAgenda(new Date(x.inicio)).dia === dia)
        .sort((a, b) => a.inicio.localeCompare(b.inicio));
      const ultima = doDia[doDia.length - 1] ?? ev;
      const id = `teto:${i.pessoa}:${dia}`;
      const proximoDia = instanteDaAgenda(somarDias(dia, 1), 0);
      guardar(ctx, {
        id,
        tipo: 'teto',
        quando: doDia[0]?.inicio ?? ev.inicio,
        pessoas: [i.pessoa],
        titulo: `${i.pessoa} com ${doDia.length} reuniões em ${rotuloDoDia(dia)}`,
        frase: i.frase.replace(/^\d+ª reunião/, `${doDia.length} reuniões`),
        eventos: doDia.map(resumoDoEvento),
        acoes: semNulos([acaoDeEmpurrar(ctx, id, ultima, proximoDia), acaoDePassar(ctx, id, ultima), acaoDeRemarcar()]),
        serieId: null,
      });
      continue;
    }

    if (i.regra === 'janela' || i.regra === 'trajeto' || i.regra === 'intervalo' || i.regra === 'bloqueio_fixo') {
      // O par colado aparece uma vez só, na reunião que vem depois.
      if ((i.regra === 'trajeto' || i.regra === 'intervalo') && outro && outro.inicio > ev.inicio) continue;
      janela.push(i);
    }
  }

  if (janela.length) {
    const id = `janela:${ev.id}`;
    const temTrajeto = janela.some((i) => i.regra === 'trajeto');
    guardar(ctx, {
      id,
      tipo: 'janela',
      quando: ev.inicio,
      pessoas: [...new Set(janela.flatMap((i) => pessoasDoItem(i, ev, ctx)))],
      titulo: nomeCurto(ev),
      frase: janela.map((i) => i.frase).join(' '),
      eventos: [resumoDoEvento(ev)],
      acoes: semNulos([
        acaoDeEmpurrar(ctx, id, ev),
        temTrajeto && ev.leitura.modalidade === 'presencial' ? acaoDeModalidade(ctx, id, ev) : null,
        acaoDeRemarcar(),
        acaoDeManter(),
      ]),
      serieId: ev.serieId,
    });
  }
}

/** "Levar para ter 03/11, mesmo horário". */
function acaoDeDiaUtil(ctx: Contexto, cartaoId: string, ev: EventoDaAgenda): AcaoDoConflito | null {
  if (!ev.titulo) return null;
  const { dia, minutos } = noFusoDaAgenda(new Date(ev.inicio));
  const destino = proximoDiaUtil(dia, ctx.e.regras.feriados);
  const inicio = instanteDaAgenda(destino, minutos);
  const fim = new Date(inicio.getTime() + (new Date(ev.fim).getTime() - new Date(ev.inicio).getTime()));
  return {
    tipo: 'levar_para_dia_util',
    rotulo: `Levar para ${rotuloDoDia(destino)}, mesmo horário`,
    pedido: alterar(ctx, cartaoId, 'levar_para_dia_util', ev, { inicio: inicio.toISOString(), fim: fim.toISOString() }),
  };
}

/** O rito sem gente: um dos sócios do rito está Fora no dia. */
function ritosSemGente(ctx: Contexto, dias: string[]): void {
  const foras = ctx.e.eventos.filter((x) => x.leitura?.tipo === 'fora' && x.status !== 'cancelado');
  for (const dia of dias) {
    for (const o of ritosDoDia(dia, ctx.e.regras.ritos)) {
      if (o.intervalo[0] < ctx.e.agora.getTime()) continue;
      for (const pessoa of o.pessoas) {
        const fora = foras.find((f) => pessoasDoEvento(f, ctx.e.regras.pessoas).has(pessoa) && diasDoEvento(f).includes(dia));
        if (!fora) continue;
        const id = `rito-sem-gente:${o.rito.id}:${dia}:${pessoa}`;
        // A ocorrência na agenda (o evento do rito), para "pular esta ocorrência".
        const ocorrencia = ctx.e.eventos.find(
          (x) =>
            x.status !== 'cancelado' &&
            !!x.titulo &&
            x.titulo.trim() === o.rito.titulo.trim() &&
            new Date(x.inicio).getTime() < o.intervalo[1] &&
            o.intervalo[0] < new Date(x.fim).getTime(),
        );
        const motivo = fora.leitura.motivo ? ` (${fora.leitura.motivo})` : '';
        guardar(ctx, {
          id,
          tipo: 'rito',
          quando: new Date(o.intervalo[0]).toISOString(),
          pessoas: [pessoa],
          titulo: `${pessoa} Fora no dia do rito`,
          frase: `${o.rito.nome}, ${rotuloDoDia(dia)}${o.rito.inicio ? ` ${o.rito.inicio}` : ''}: ${pessoa} está Fora${motivo}.`,
          eventos: [...(ocorrencia ? [resumoDoEvento(ocorrencia)] : []), resumoDoEvento(fora)],
          acoes: semNulos([
            acaoDeManter(`Manter sem o ${pessoa}`),
            ocorrencia
              ? {
                  tipo: 'pular_ocorrencia',
                  rotulo: 'Pular esta ocorrência',
                  pedido: {
                    acao: 'cancelar',
                    chave: chaveDoPedido(ctx.e.orgId, id, 'pular_ocorrencia', ocorrencia.id),
                    eventoId: ocorrencia.id,
                    tituloAtual: ocorrencia.titulo ?? '',
                    motivo: 'ocorrência pulada',
                    avisar: true,
                  },
                }
              : null,
          ]),
          serieId: ocorrencia?.serieId ?? null,
        });
      }
    }
  }
}

/** A reunião online sem Meet (a de cliente: a interna não diz a modalidade no título). */
function semMeet(ctx: Contexto, ev: EventoDaAgenda, doVigia: Set<string>): void {
  if (ev.leitura.tipo !== 'cliente' || ev.leitura.modalidade !== 'online' || ev.meet || doVigia.has(ev.id) || !ev.titulo) return;
  const id = `sem_meet:${ev.id}`;
  guardar(ctx, {
    id,
    tipo: 'sem_meet',
    quando: ev.inicio,
    pessoas: [...pessoasDoEvento(ev, ctx.e.regras.pessoas)],
    titulo: 'Reunião online sem Meet',
    frase: `${ev.titulo} não tem link do Meet.`,
    eventos: [resumoDoEvento(ev)],
    acoes: semNulos([
      { tipo: 'criar_meet', rotulo: 'Criar o Meet e avisar o cliente', pedido: alterar(ctx, id, 'criar_meet', ev, { criarMeet: true }) },
      acaoDeModalidade(ctx, id, ev),
    ]),
    serieId: ev.serieId,
  });
}

/** O que o vigia achou fora do padrão. */
function doVigia(ctx: Contexto, item: ItemDoVigiaNosConflitos, porId: Map<string, EventoDaAgenda>): void {
  const ev = porId.get(item.eventoId);
  const id = `padrao:${item.eventoId}`;
  const lido = item.tituloProposto ? lerCompromisso(item.tituloProposto) : ev?.leitura;
  const pessoas = lido?.responsaveis?.length ? lido.responsaveis : ev ? [...pessoasDoEvento(ev, ctx.e.regras.pessoas)] : [];
  const quando = ev?.inicio ?? item.inicio ?? ctx.e.agora.toISOString();
  const proposta = item.tituloProposto ? `proposta: ${item.tituloProposto}${item.adicionarMeet ? ' + link do Meet' : ''}` : 'O vigia não teve proposta segura.';
  guardar(ctx, {
    id,
    tipo: 'padrao',
    quando,
    pessoas,
    titulo: `"${item.tituloAtual}"`,
    frase: [item.problemas.length ? `Fora do padrão: ${item.problemas.join('; ')}.` : 'Fora do padrão.', proposta].join(' '),
    eventos: [ev ? resumoDoEvento(ev) : { id: item.eventoId, titulo: item.tituloAtual, inicio: quando, fim: quando }],
    acoes: semNulos([
      item.estado === 'proposta' && item.tituloProposto
        ? { tipo: 'aplicar_titulo', rotulo: 'Aplicar título', pedido: null, rota: { metodo: 'POST', caminho: `/agenda/padronizar/${encodeURIComponent(item.eventoId)}` } }
        : null,
      item.pendenciaId && item.opcaoNaoEReuniao
        ? {
            tipo: 'nao_e_reuniao',
            rotulo: 'Não é reunião',
            pedido: null,
            rota: { metodo: 'POST', caminho: `/pendencias/${encodeURIComponent(item.pendenciaId)}/responder`, corpo: { escolha: item.opcaoNaoEReuniao } },
          }
        : null,
      ev ? acaoDeRemarcar() : null,
    ]),
    serieId: ev?.serieId ?? null,
  });
}

/**
 * Junta os cartões de uma série (`recurringEventId`): o mesmo tipo e o mesmo
 * título viram um cartão só, com a primeira ocorrência e a contagem.
 */
function agruparSeries(cartoes: CartaoDeConflito[]): CartaoDeConflito[] {
  const grupos = new Map<string, CartaoDeConflito>();
  const out: CartaoDeConflito[] = [];
  for (const c of [...cartoes].sort((a, b) => a.quando.localeCompare(b.quando))) {
    if (!c.serieId) {
      out.push(c);
      continue;
    }
    const chave = `${c.tipo}|${c.serieId}|${c.titulo}`;
    const g = grupos.get(chave);
    if (!g) {
      const novo = { ...c, eventos: [...c.eventos] };
      grupos.set(chave, novo);
      out.push(novo);
      continue;
    }
    for (const e of c.eventos) if (!g.eventos.some((x) => x.id === e.id)) g.eventos.push(e);
  }
  for (const g of grupos.values()) {
    const n = new Set(g.eventos.map((e) => e.id)).size;
    if (n > (g.tipo === 'choque' ? 2 : 1)) g.frase = `${g.frase} Repete na série: ${n} ocorrências.`;
  }
  return out;
}

/** Os cartões dos próximos `dias`, ordenados por urgência. */
export function montarConflitos(e: EntradaDosConflitos): CartaoDeConflito[] {
  const ctx: Contexto = { e, cartoes: new Map() };
  const agora = e.agora.getTime();
  const limite = agora + e.dias * 24 * 60 * MIN;
  const porId = new Map(e.eventos.map((x) => [x.id, x]));
  const doVigiaIds = new Set((e.vigia ?? []).map((v) => v.eventoId));
  const noHorizonte = (x: EventoDaAgenda) => {
    const t = new Date(x.inicio).getTime();
    return t >= agora && t < limite;
  };

  for (const ev of e.eventos) {
    if (!ehReuniao(ev) || !noHorizonte(ev)) continue;
    daReuniao(ctx, ev, porId);
    semMeet(ctx, ev, doVigiaIds);
  }

  const hoje = noFusoDaAgenda(e.agora).dia;
  const dias: string[] = [];
  for (let k = 0; k <= e.dias; k++) dias.push(somarDias(hoje, k));
  ritosSemGente(ctx, dias);

  for (const item of e.vigia ?? []) {
    const t = item.inicio ? new Date(item.inicio).getTime() : null;
    if (t != null && (t < agora - 24 * 60 * MIN || t >= limite)) continue;
    doVigia(ctx, item, porId);
  }

  return agruparSeries([...ctx.cartoes.values()]).sort((a, b) => a.urgencia - b.urgencia || a.quando.localeCompare(b.quando) || a.id.localeCompare(b.id));
}

const TIPOS: readonly TipoDeConflito[] = ['choque', 'padrao', 'sem_meet', 'rito', 'feriado', 'janela', 'fora', 'teto'];

/** A contagem por tipo (e "tudo"), para os filtros. */
export function contarConflitos(cartoes: readonly CartaoDeConflito[]): Record<TipoDeConflito | 'tudo', number> {
  const c = Object.fromEntries([...TIPOS, 'tudo'].map((t) => [t, 0])) as Record<TipoDeConflito | 'tudo', number>;
  for (const x of cartoes) {
    c[x.tipo]++;
    c.tudo++;
  }
  return c;
}
