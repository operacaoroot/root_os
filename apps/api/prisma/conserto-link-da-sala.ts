import { Prisma, PrismaClient } from '@prisma/client';

import { MARCADOR_DO_LINK_DA_SALA, semLinkDeSalaEmClaro, temLinkDeSalaEmClaro } from '../src/comercial/sala-token';

/*
 * CONSERTO B-1 DA REVISÃO (13/10/2026) · o link da sala gravado em claro.
 *
 * Até o conserto, o texto das mensagens M1, M3, M4 e M6 levava o link da sala
 * com o token, e esse texto foi gravado em três lugares sem cifra: os
 * argumentos que a porta guarda (`ToolCall.args`), o fato `whats.enviada`
 * (`LeadEvent.payload`) e a própria `ComercialMensagem.texto`. O código novo
 * grava o marcador `{{link-da-sala}}`; este script troca, no que JÁ foi
 * gravado, todo link de sala em claro pelo mesmo marcador.
 *
 * REGRAS:
 *   · nenhuma linha é apagada; só o trecho do link é trocado;
 *   · idempotente: a segunda passada não acha nada para trocar;
 *   · a mensagem que esperava na fila (`na_fila`) com o texto reescrito vira
 *     `falhou` com o motivo: a aprovação pendente foi assinada sobre o texto
 *     antigo e a porta a recusa na execução (vínculo quebrado, falha fechada);
 *     quem quiser o envio pede de novo e a mensagem volta à fila com o marcador;
 *   · `EventLog` e `AuditLog` NÃO são reescritos: o `EventLog` é append-only com
 *     cadeia de hash (reescrever quebraria a prova do `GET /audit/verificar`).
 *     O script só CONTA o que houver neles e diz onde; na revisão, os dois
 *     tinham zero (o conteúdo sai lá em resumo).
 *
 * No fim, uma varredura de TODA coluna de texto e JSON do esquema `public`
 * conta o que sobrou com link de sala em claro: é a prova.
 *
 *   DATABASE_URL=... pnpm --filter @mktos/api db:conserto:link-da-sala
 *   (acrescente --so-contar para só medir)
 */

const prisma = new PrismaClient();
const SO_CONTAR = process.argv.includes('--so-contar');
const RE_SQL = '/s/[A-Za-z0-9_-]{43}([^A-Za-z0-9_-]|$)';
const MOTIVO_DA_FILA =
  'texto reescrito no conserto B-1 (o link da sala estava em claro): a aprovação antiga não vale mais; peça o envio de novo';

type Json = Prisma.JsonValue;

/** Troca o link em claro em toda string do JSON; devolve `null` se nada mudou. */
function semLinkNoJson(v: Json): { valor: Json; mudou: boolean } {
  if (typeof v === 'string') {
    const novo = semLinkDeSalaEmClaro(v);
    return { valor: novo, mudou: novo !== v };
  }
  if (Array.isArray(v)) {
    let mudou = false;
    const valor = v.map((x) => {
      const r = semLinkNoJson(x as Json);
      mudou ||= r.mudou;
      return r.valor;
    });
    return { valor, mudou };
  }
  if (v && typeof v === 'object') {
    let mudou = false;
    const valor: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v)) {
      const r = semLinkNoJson(x as Json);
      mudou ||= r.mudou;
      valor[k] = r.valor;
    }
    return { valor, mudou };
  }
  return { valor: v, mudou: false };
}

async function censo(): Promise<{ tabela: string; coluna: string; linhas: number }[]> {
  const colunas = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string }[]>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json')
      AND table_name NOT LIKE '\\_prisma%'`,
  );
  const achados: { tabela: string; coluna: string; linhas: number }[] = [];
  for (const c of colunas) {
    const expr = c.data_type.startsWith('json') ? `"${c.column_name}"::text` : `"${c.column_name}"`;
    const [r] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${c.table_name}" WHERE ${expr} ~ $1`, RE_SQL);
    const n = Number(r?.n ?? 0);
    if (n > 0) achados.push({ tabela: c.table_name, coluna: c.column_name, linhas: n });
  }
  return achados;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  const banco = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? '(desconhecido)';
  console.log(`banco: ${banco} · marcador: ${MARCADOR_DO_LINK_DA_SALA}${SO_CONTAR ? ' · só contar' : ''}`);

  const antes = await censo();
  console.log('ANTES (linhas com link de sala em claro):', antes.length ? antes : 'nenhuma');
  if (SO_CONTAR) return;

  let mensagens = 0;
  let filaReaberta = 0;
  const comLink = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "ComercialMensagem" WHERE texto ~ $1`, RE_SQL);
  for (const { id } of comLink) {
    const m = await prisma.comercialMensagem.findUniqueOrThrow({ where: { id } });
    if (!temLinkDeSalaEmClaro(m.texto)) continue;
    const texto = semLinkDeSalaEmClaro(m.texto);
    const naFila = m.estado === 'na_fila';
    // Escrita condicionada ao texto lido: o que mudou no meio do caminho fica para a próxima passada.
    const r = await prisma.comercialMensagem.updateMany({
      where: { id, texto: m.texto },
      data: { texto, ...(naFila ? { estado: 'falhou', erro: MOTIVO_DA_FILA } : {}) },
    });
    mensagens += r.count;
    if (naFila && r.count) filaReaberta++;
  }

  let fatos = 0;
  const eventos = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "LeadEvent" WHERE payload::text ~ $1`, RE_SQL);
  for (const { id } of eventos) {
    const e = await prisma.leadEvent.findUniqueOrThrow({ where: { id }, select: { payload: true } });
    const r = semLinkNoJson(e.payload as Json);
    if (!r.mudou) continue;
    await prisma.leadEvent.update({ where: { id }, data: { payload: r.valor as Prisma.InputJsonValue } });
    fatos++;
  }

  let chamadas = 0;
  const tcs = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "ToolCall" WHERE args::text ~ $1 OR resultado::text ~ $1 OR erro ~ $1`,
    RE_SQL,
  );
  for (const { id } of tcs) {
    const t = await prisma.toolCall.findUniqueOrThrow({ where: { id }, select: { args: true, resultado: true, erro: true } });
    const a = t.args === null ? { valor: null, mudou: false } : semLinkNoJson(t.args as Json);
    const res = t.resultado === null ? { valor: null, mudou: false } : semLinkNoJson(t.resultado as Json);
    const erro = t.erro ? semLinkDeSalaEmClaro(t.erro) : t.erro;
    if (!a.mudou && !res.mudou && erro === t.erro) continue;
    await prisma.toolCall.update({
      where: { id },
      data: {
        ...(a.mudou ? { args: a.valor as Prisma.InputJsonValue } : {}),
        ...(res.mudou ? { resultado: res.valor as Prisma.InputJsonValue } : {}),
        ...(erro !== t.erro ? { erro } : {}),
      },
    });
    chamadas++;
  }

  let aprovacoes = 0;
  const aps = await prisma.$queryRawUnsafe<{ id: string; resumo: string }[]>(`SELECT id, resumo FROM "Approval" WHERE resumo ~ $1`, RE_SQL);
  for (const ap of aps) {
    await prisma.approval.update({ where: { id: ap.id }, data: { resumo: semLinkDeSalaEmClaro(ap.resumo) } });
    aprovacoes++;
  }

  console.log(
    `reescritas: ComercialMensagem ${mensagens} (das quais ${filaReaberta} saíram da fila com o motivo), LeadEvent ${fatos}, ToolCall ${chamadas}, Approval ${aprovacoes}`,
  );
  const depois = await censo();
  console.log('DEPOIS (linhas com link de sala em claro):', depois.length ? depois : 'nenhuma');
  const intocaveis = depois.filter((d) => d.tabela === 'EventLog' || d.tabela === 'AuditLog');
  if (intocaveis.length) {
    console.log('NÃO reescrito de propósito (cadeia de hash / append-only): registrar em homolog/progresso.md:', intocaveis);
  }
  const resto = depois.filter((d) => d.tabela !== 'EventLog' && d.tabela !== 'AuditLog');
  if (resto.length) {
    console.error('SOBROU link de sala em claro fora do rastro: confira à mão', resto);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
