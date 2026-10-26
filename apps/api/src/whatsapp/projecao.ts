import { Prisma } from '@prisma/client';
import {
  formatarWhatsappBr,
  type CitacaoDaMensagem,
  type ConversaDaCaixa,
  type MensagemDaCaixa,
  type MidiaDaMensagem,
  type SugestaoDeVinculo,
} from '@mktos/shared';

import type { PrismaService } from '../prisma/prisma.service';

/*
 * A PROJEÇÃO DA CAIXA (produção 22C): de linha do banco para o que a tela lê.
 * Um lugar só, para a caixa (W2), o vínculo (W3: aba do lead, ficha do cliente)
 * e quem mais mostrar conversa falarem igual.
 *
 * Tudo aqui roda dentro do contexto da empresa (isolamento por linha); mesmo
 * assim toda consulta leva o `orgId` explícito, como o resto do repositório.
 */

export const SELECT_DA_CONVERSA = {
  id: true,
  instancia: true,
  chatJid: true,
  grupo: true,
  nome: true,
  fotoUrl: true,
  participantes: true,
  equipe: true,
  comunidade: true,
  ultimaMensagemEm: true,
  naoLidas: true,
  leadId: true,
  clienteId: true,
  vinculoSugerido: true,
  vinculadoPorId: true,
  vinculadoEm: true,
  arquivadaEm: true,
  lead: { select: { id: true, name: true } },
  cliente: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
} satisfies Prisma.WhatsAppConversaSelect;

export type LinhaDaConversa = Prisma.WhatsAppConversaGetPayload<{ select: typeof SELECT_DA_CONVERSA }>;

export const SELECT_DA_MENSAGEM = {
  id: true,
  conversaId: true,
  mensagemExternaId: true,
  deMim: true,
  tipo: true,
  texto: true,
  midia: true,
  remetenteNome: true,
  remetenteNumero: true,
  timestamp: true,
  citaMensagemExternaId: true,
  enviadaPorId: true,
  lidaEm: true,
} satisfies Prisma.WhatsAppMensagemSelect;

export type LinhaDaMensagem = Prisma.WhatsAppMensagemGetPayload<{ select: typeof SELECT_DA_MENSAGEM }>;

/** O nome do cliente como a casa o chama: fantasia, senão razão social. */
export function nomeDoCliente(c: { razaoSocial: string; nomeFantasia: string | null }): string {
  return (c.nomeFantasia ?? '').trim() || c.razaoSocial;
}

/** O número (só dígitos) de uma conversa 1:1 pelo `chatJid` canônico, ou null. */
export function numeroDoChat(chatJid: string, grupo: boolean): string | null {
  if (grupo) return null;
  const m = /^(\d{10,15})@(s\.whatsapp\.net|c\.us)$/.exec(chatJid);
  return m ? m[1] : null;
}

function lerSugestao(v: Prisma.JsonValue | null): SugestaoDeVinculo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if ((o.tipo !== 'lead' && o.tipo !== 'cliente') || typeof o.id !== 'string' || typeof o.nome !== 'string') return null;
  const como = o.como === 'telefone' ? 'telefone' : 'nome_igual';
  return { tipo: o.tipo, id: o.id, nome: o.nome, como };
}

export function lerMidia(v: Prisma.JsonValue | null): MidiaDaMensagem | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
  return {
    mime: typeof o.mime === 'string' ? o.mime : null,
    nome: typeof o.nome === 'string' ? o.nome : null,
    tamanho: num(o.tamanho),
    segundos: num(o.segundos),
  };
}

/**
 * As conversas como a caixa as mostra: com a última mensagem (prévia), o nome
 * de quem vinculou e o vínculo resolvido. `linhas` já vem filtrada e ordenada.
 */
export async function projetarConversas(prisma: PrismaService, orgId: string, linhas: LinhaDaConversa[]): Promise<ConversaDaCaixa[]> {
  if (!linhas.length) return [];
  const ids = linhas.map((l) => l.id);
  // Revisão 22C (A4): a última mensagem de cada conversa por DISTINCT ON no banco. O `distinct`
  // do Prisma deduplica em memória e trazia TODAS as mensagens das conversas listadas a cada leitura.
  const ultimas = await prisma.$queryRaw<
    { conversaId: string; texto: string | null; tipo: string; deMim: boolean; remetenteNome: string | null; timestamp: Date }[]
  >(Prisma.sql`
    SELECT DISTINCT ON ("conversaId") "conversaId", "texto", "tipo", "deMim", "remetenteNome", "timestamp"
      FROM "WhatsAppMensagem"
     WHERE "orgId" = ${orgId} AND "conversaId" IN (${Prisma.join(ids)})
     ORDER BY "conversaId", "timestamp" DESC, "id" DESC`);
  const ultimaDe = new Map(ultimas.map((u) => [u.conversaId, u]));
  const pessoas = [...new Set(linhas.map((l) => l.vinculadoPorId).filter((x): x is string => !!x))];
  const nomes = pessoas.length
    ? new Map((await prisma.user.findMany({ where: { orgId, id: { in: pessoas } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    : new Map<string, string>();
  return linhas.map((l) => {
    const u = ultimaDe.get(l.id);
    const numero = numeroDoChat(l.chatJid, l.grupo);
    const vinculo = l.lead
      ? { tipo: 'lead' as const, id: l.lead.id, nome: l.lead.name }
      : l.cliente
        ? { tipo: 'cliente' as const, id: l.cliente.id, nome: nomeDoCliente(l.cliente) }
        : null;
    return {
      id: l.id,
      grupo: l.grupo,
      nome: (l.nome ?? '').trim() || (numero ? formatarWhatsappBr(numero) : l.grupo ? 'Grupo sem nome' : 'Contato sem número'),
      numero,
      fotoUrl: l.fotoUrl,
      participantes: l.participantes,
      equipe: l.equipe,
      comunidade: l.comunidade,
      ultimaMensagemEm: l.ultimaMensagemEm?.toISOString() ?? null,
      previa: u ? { texto: u.texto, tipo: u.tipo, deMim: u.deMim, remetenteNome: u.remetenteNome, timestamp: u.timestamp.toISOString() } : null,
      naoLidas: l.naoLidas,
      vinculo: vinculo
        ? {
            ...vinculo,
            vinculadoPor: l.vinculadoPorId ? { id: l.vinculadoPorId, nome: nomes.get(l.vinculadoPorId) ?? 'pessoa da equipe' } : null,
            vinculadoEm: l.vinculadoEm?.toISOString() ?? null,
          }
        : null,
      sugestao: vinculo ? null : lerSugestao(l.vinculoSugerido),
      arquivada: !!l.arquivadaEm,
    };
  });
}

/**
 * As mensagens como a caixa as mostra, com a citação resolvida (quando a
 * mensagem citada está gravada) e o nome de quem respondeu pela caixa.
 */
export async function projetarMensagens(prisma: PrismaService, orgId: string, conversaId: string, linhas: LinhaDaMensagem[]): Promise<MensagemDaCaixa[]> {
  const citadas = [...new Set(linhas.map((l) => l.citaMensagemExternaId).filter((x): x is string => !!x))];
  const citacoes = citadas.length
    ? new Map(
        (
          await prisma.whatsAppMensagem.findMany({
            where: { orgId, conversaId, mensagemExternaId: { in: citadas } },
            select: { mensagemExternaId: true, texto: true, tipo: true, remetenteNome: true, deMim: true },
          })
        ).map((c) => [c.mensagemExternaId, c]),
      )
    : new Map<string, { mensagemExternaId: string; texto: string | null; tipo: string; remetenteNome: string | null; deMim: boolean }>();
  const pessoas = [...new Set(linhas.map((l) => l.enviadaPorId).filter((x): x is string => !!x))];
  const nomes = pessoas.length
    ? new Map((await prisma.user.findMany({ where: { orgId, id: { in: pessoas } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    : new Map<string, string>();
  return linhas.map((l) => {
    let cita: CitacaoDaMensagem | null = null;
    if (l.citaMensagemExternaId) {
      const c = citacoes.get(l.citaMensagemExternaId);
      cita = c
        ? { mensagemExternaId: c.mensagemExternaId, texto: c.texto, tipo: c.tipo, remetenteNome: c.remetenteNome, deMim: c.deMim }
        : { mensagemExternaId: l.citaMensagemExternaId, texto: null, tipo: null, remetenteNome: null, deMim: null };
    }
    return {
      id: l.id,
      mensagemExternaId: l.mensagemExternaId,
      deMim: l.deMim,
      tipo: l.tipo,
      texto: l.texto,
      midia: lerMidia(l.midia),
      remetenteNome: l.remetenteNome,
      remetenteNumero: l.remetenteNumero,
      timestamp: l.timestamp.toISOString(),
      cita,
      enviadaPor: l.enviadaPorId ? { id: l.enviadaPorId, nome: nomes.get(l.enviadaPorId) ?? 'pessoa da equipe' } : null,
      lida: l.deMim || !!l.lidaEm,
    };
  });
}
