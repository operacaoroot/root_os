import { PrismaClient, type Prisma } from '@prisma/client';
import { TABELA_DE_PRECO, formatarReais } from '@mktos/shared';

import { abrirCardDaImplantacao } from '../../src/comercial/card-da-implantacao';
import { hashDoConteudo, uuidDe } from '../../src/comercial/eventos';
import { FioService, ReacoesRegistry } from '../../src/comercial/fio.service';
import { chaveDaDuvida } from '../../src/comercial/sala-projecao';
import type { PrismaService } from '../../src/prisma/prisma.service';

/*
 * O CENÁRIO DA RODADA DA IMPLANTAÇÃO NO SEED DA HOMOLOGAÇÃO (I6, 18/10/2026).
 *
 * 1. O CARD DA IMPLANTAÇÃO para todo lead JÁ FECHADO (`cliente.ativo` no fio)
 *    que ainda não tem um: os fechamentos de antes da I1 (as "Construtora
 *    Alicerce Homolog" das jornadas) ganham o card pela MESMA função da sexta
 *    escrita, com os dados copiados do aceite e da ficha. Idempotente: o id do
 *    card é derivado do lead.
 *
 *    A Alicerce DA SEMENTE continua em follow-up, de propósito: ela é o fio da
 *    tela 05 e a prova da lane UX (`ux-painel.mjs`) depende dela pedindo 8%. A
 *    "Alicerce fechada" do roteiro é a da jornada, que fecha de verdade pelos
 *    dublês; o `implantacao.mjs` roda a jornada e confere o card dela.
 *
 * 2. REAÇÕES DE EXEMPLO, marcadas como exemplo no texto, pelo mesmo id
 *    derivado da rota pública (repetir não duplica): na Alicerce da semente,
 *    leitura por seção, um "faz sentido", uma ideia e uma dúvida; na Rede Pão
 *    Bom, mais duas visitas com leitura (ela leu três vezes e não respondeu, que
 *    é o caso que o relatório marca em magenta).
 */

type P = Record<string, unknown>;

const EXEMPLO = '(exemplo de homologação)';

export async function semearImplantacao(
  prisma: PrismaClient,
  orgId: string,
  leads: { alicerce: string; redePaoBom: string },
  agora: Date = new Date(),
): Promise<{ cards: { empresa: string; estado: string }[]; reacoes: number }> {
  const fio = new FioService(prisma as unknown as PrismaService, new ReacoesRegistry());

  // 1) O card para os já fechados.
  const ativos = await prisma.leadEvent.findMany({ where: { orgId, type: 'cliente.ativo' }, select: { leadId: true, payload: true }, distinct: ['leadId'] });
  const cards: { empresa: string; estado: string }[] = [];
  for (const a of ativos) {
    const leadId = a.leadId;
    const [lead, ficha, aceite, fechamento] = await Promise.all([
      prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true, phone: true, email: true } }),
      prisma.comercialFicha.findFirst({ where: { leadId, orgId } }),
      prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'aceite.dados' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } }),
      prisma.comercialFechamento.findFirst({ where: { leadId, orgId }, orderBy: { criadoEm: 'desc' }, select: { chave: true } }),
    ]);
    if (!lead || !ficha) continue;
    const d = ((aceite?.payload ?? {}) as P);
    const dono = ficha.donoId ? await prisma.user.findFirst({ where: { id: ficha.donoId, orgId }, select: { name: true } }) : null;
    const produto = ficha.produto ?? '';
    const r = await prisma.$transaction((tx) =>
      abrirCardDaImplantacao(tx, orgId, {
        leadId,
        empresa: String(d.razaoSocial ?? '') || ficha.empresa || lead.name,
        cnpj: String(d.cnpj ?? ficha.cnpj ?? ''),
        contato: String(d.quemAssina ?? ''),
        telefone: lead.phone ?? null,
        email: String(d.email ?? '') || lead.email || null,
        produto: (TABELA_DE_PRECO as Record<string, { rotulo: string }>)[produto]?.rotulo ?? (produto || '[a decidir]'),
        valor: ficha.valorCentavos ? formatarReais(ficha.valorCentavos) : '[a decidir]',
        parcelas: ficha.parcelas ?? 1,
        forma: ficha.forma ?? '[a decidir]',
        chave: fechamento?.chave ?? `fech-${leadId}`,
        trilhoId: ficha.trilhoId ?? null,
        responsavel: dono?.name ?? null,
        clienteId: ficha.partnerId ?? null,
      }, agora),
    );
    if (r.estado === 'criado') {
      await fio.registrar(orgId, leadId, 'implantacao.card_criado', r.cardId, { chave: fechamento?.chave ?? '', cardId: r.cardId, listId: r.listId, lista: r.lista, etapa: r.etapa }, { em: agora, semReacoes: true });
    }
    cards.push({ empresa: ficha.empresa || lead.name, estado: r.estado });
  }

  // 2) As reações de exemplo.
  let reacoes = 0;
  const reacao = async (leadId: string, linha: { tipo: 'leitura' | 'faz_sentido' | 'ideia' | 'duvida'; secao: 'montar' | 'funciona' | 'investimento'; acesso: number; segundos?: number; texto?: string; em: Date }) => {
    const partes = [orgId, 'lead-reacao', leadId, linha.tipo, '1', linha.secao, String(linha.acesso)];
    if (linha.texto) partes.push(hashDoConteudo(linha.texto));
    const id = uuidDe(partes);
    const r = await prisma.leadReacao.createMany({
      data: [{
        id, leadId, versao: 1, secao: linha.secao, tipo: linha.tipo, acesso: linha.acesso, criadoEm: linha.em, atualizadoEm: linha.em,
        ...(linha.tipo === 'leitura' ? { segundos: linha.segundos ?? 30 } : {}),
        ...(linha.texto ? { texto: linha.texto } : {}),
      } as Prisma.LeadReacaoCreateManyInput],
      skipDuplicates: true,
    });
    if (r.count === 0) return;
    reacoes++;
    if (linha.tipo === 'ideia') {
      await fio.registrar(orgId, leadId, 'proposta.ideia', id, { versao: 1, secao: linha.secao, texto: linha.texto!, visita: linha.acesso, reacaoId: id } as never, { em: linha.em, semReacoes: true });
    } else if (linha.tipo === 'duvida') {
      await fio.registrar(orgId, leadId, 'proposta.duvida', chaveDaDuvida(1, linha.texto!), { versao: 1, pergunta: linha.texto!, resposta: null, secao: linha.secao } as never, { em: linha.em, semReacoes: true });
    } else if (linha.tipo === 'faz_sentido') {
      await fio.registrar(orgId, leadId, 'proposta.reagida', `1:${linha.secao}:${linha.acesso}`, { versao: 1, secao: linha.secao, reacao: 'faz_sentido', visita: linha.acesso, reacaoId: id } as never, { em: linha.em, semReacoes: true });
    }
  };
  const h = (horas: number) => new Date(agora.getTime() - horas * 3_600_000);

  const alicerce = await prisma.lead.findFirst({ where: { id: leads.alicerce, orgId }, select: { id: true } });
  if (alicerce) {
    await reacao(alicerce.id, { tipo: 'leitura', secao: 'montar', acesso: 1, segundos: 95, em: h(30) });
    await reacao(alicerce.id, { tipo: 'faz_sentido', secao: 'montar', acesso: 1, em: h(30) });
    await reacao(alicerce.id, { tipo: 'leitura', secao: 'investimento', acesso: 2, segundos: 140, em: h(26) });
    await reacao(alicerce.id, { tipo: 'duvida', secao: 'investimento', acesso: 2, texto: `O Claude do 1º mês entra no valor? ${EXEMPLO}`, em: h(26) });
    await reacao(alicerce.id, { tipo: 'ideia', secao: 'funciona', acesso: 2, texto: `Dá para começar pelo fechamento de outubro? ${EXEMPLO}`, em: h(25) });
  }
  const pao = await prisma.lead.findFirst({ where: { id: leads.redePaoBom, orgId }, select: { id: true } });
  if (pao) {
    for (const visita of [2, 3]) {
      const em = h(60 - visita * 8);
      await fio.registrar(orgId, pao.id, 'proposta.lida', `v1:recomendada:${visita}`, { versao: 1, bloco: 'recomendada', visita } as never, { em, semReacoes: true });
      await reacao(pao.id, { tipo: 'leitura', secao: 'montar', acesso: visita, segundos: 40 + visita * 10, em });
    }
  }
  return { cards, reacoes };
}
