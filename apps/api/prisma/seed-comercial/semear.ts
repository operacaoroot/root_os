import { LeadStatus, Prisma, type ComercialEtapa as EtapaDoBanco, type PrismaClient } from '@prisma/client';

import { eventoIdComercial, uuidDe } from '../../src/comercial/eventos';
import {
  baseDoLink,
  cifrarTokenDaSala,
  decifrarTokenDaSala,
  gerarTokenDaSala,
  linkDaSala,
  segredoDoAmbiente,
  validadeDaSala,
} from '../../src/comercial/sala-token';
import { COLUNAS_PROJETADAS, projetarLead, type ColunaProjetada } from './projecao';
import { montarRoteiros, type RoteiroDoLead } from './roteiro';

/*
 * A SEMENTE DAS EMPRESAS DE DEMONSTRAÇÃO (lane F, 13/10/2026) — a parte que escreve.
 *
 * Chamada por `prisma/seed-comercial.ts` (que recusa produção) e pelo teste
 * `comercial-seed.test.ts` (contra o banco descartável). Idempotente de ponta a
 * ponta: lead, ficha, evento, decisão, cobrança, documento e sala entram com id
 * derivado e `skipDuplicates`; a sala existente é reaproveitada; e a ficha é
 * REFEITA a cada passagem a partir dos eventos que estão no banco (não dos que
 * esta passagem montou), então rodar de novo com outro `agora` não muda nada e
 * a ficha nunca diverge do fio.
 *
 * Nenhum evento passa pelo `FioService`: não há reação a rodar. A semente grava o
 * resultado que as reações teriam gravado (a regra está em `roteiro.ts`).
 */

export interface OpcoesDaSemente {
  orgId: string;
  agora?: Date;
  /** O dono pela regra `regra-v1` da API (primeiro admin_master/diretor ativo). Nulo = lead sem dono. */
  dono: { id: string; nome: string } | null;
  decisaoExpiraHoras: number;
  validadePropostaDias: number;
  /** Chave de cifra do link da sala (padrão: `ENCRYPTION_KEY` do ambiente). */
  segredo?: string | null;
  /** A origem dos links impressos (padrão: `PUBLIC_BASE_URL`). */
  baseDoLink?: string;
}

export interface SalaSemeada {
  slug: string;
  empresa: string;
  leadId: string;
  nova: boolean;
  /** O link inteiro, ou nulo quando o token não pode ser reescrito (sala sem cifra ou chave trocada). */
  link: string | null;
}

export interface LeadSemeado {
  slug: string;
  empresa: string;
  leadId: string;
  etapa: string;
  esperada: string;
  eventos: number;
  resumo: string;
}

export interface RelatorioDaSemente {
  leads: LeadSemeado[];
  salas: SalaSemeada[];
  contagens: { leads: number; eventos: number; fichas: number; salas: number; decisoes: number; cobrancas: number; documentos: number };
}

const JSON_NA_FICHA: readonly ColunaProjetada[] = ['quadroDeCustos', 'diagnostico', 'cadastro'];

/** O valor projetado no formato que o Prisma pede para atualizar a coluna. */
function paraOBanco(coluna: ColunaProjetada, v: unknown): unknown {
  if (JSON_NA_FICHA.includes(coluna)) return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
  return v ?? null;
}

export async function semearDemonstracao(prisma: PrismaClient, o: OpcoesDaSemente): Promise<RelatorioDaSemente> {
  const agora = o.agora ?? new Date();
  const roteiros = montarRoteiros({ orgId: o.orgId, agora, dono: o.dono, decisaoExpiraHoras: o.decisaoExpiraHoras, validadePropostaDias: o.validadePropostaDias });
  const segredo = o.segredo === undefined ? segredoDoAmbiente() : o.segredo;
  const base = o.baseDoLink ?? baseDoLink();

  const leads: LeadSemeado[] = [];
  const salas: SalaSemeada[] = [];
  for (const r of roteiros) {
    await gravarLead(prisma, o.orgId, r);
    salas.push(await garantirSala(prisma, o.orgId, r, segredo, base));
    await gravarFio(prisma, o.orgId, r);
    const etapa = await refazerFicha(prisma, r);
    leads.push({ slug: r.slug, empresa: r.empresa, leadId: r.leadId, etapa, esperada: r.etapaEsperada, eventos: r.eventos.length, resumo: r.resumo });
  }
  return { leads, salas, contagens: await contar(prisma, roteiros.map((r) => r.leadId)) };
}

async function gravarLead(prisma: PrismaClient, orgId: string, r: RoteiroDoLead): Promise<void> {
  await prisma.lead.createMany({
    data: [{ id: r.leadId, orgId, name: r.nome, phone: r.telefone, status: LeadStatus.novo, enteredAt: r.entrada }],
    skipDuplicates: true,
  });
  const doLead = await prisma.lead.findFirst({ where: { id: r.leadId, orgId }, select: { id: true } });
  if (!doLead) throw new Error(`seed-comercial: o lead ${r.slug} já existe em outra empresa (id derivado do telefone ${r.telefone}).`);
  await prisma.comercialFicha.createMany({ data: [{ leadId: r.leadId, etapa: 'novo_lead', etapaDesde: r.entrada }], skipDuplicates: true });
}

/** A sala do lead: cria uma vez (só o hash e a cifra no banco) e reaproveita a que existe, devolvendo o link quando ele puder ser reescrito. */
async function garantirSala(prisma: PrismaClient, orgId: string, r: RoteiroDoLead, segredo: string | null, base: string): Promise<SalaSemeada> {
  const existente = await prisma.salaDoCliente.findUnique({ where: { leadId: r.leadId } });
  if (existente) {
    const token = segredo && existente.tokenCifrado ? decifrarTokenDaSala(existente.tokenCifrado, segredo, existente.id) : null;
    return { slug: existente.slug, empresa: r.empresa, leadId: r.leadId, nova: false, link: token ? linkDaSala(token, base) : null };
  }
  const { token, hash } = gerarTokenDaSala();
  await prisma.salaDoCliente.create({
    data: {
      id: r.salaId,
      orgId,
      leadId: r.leadId,
      slug: r.slug,
      tokenHash: hash,
      tokenCifrado: segredo ? cifrarTokenDaSala(token, segredo, r.salaId) : null,
      validoAte: validadeDaSala(r.entrada),
      dados: {},
    },
  });
  return { slug: r.slug, empresa: r.empresa, leadId: r.leadId, nova: true, link: linkDaSala(token, base) };
}

async function gravarFio(prisma: PrismaClient, orgId: string, r: RoteiroDoLead): Promise<void> {
  await prisma.leadEvent.createMany({
    data: r.eventos.map((e) => ({
      id: eventoIdComercial(orgId, r.leadId, e.type, e.chave),
      leadId: r.leadId,
      type: e.type,
      payload: e.payload as Prisma.InputJsonValue,
      occurredAt: e.em,
    })),
    skipDuplicates: true,
  });
  if (r.decisoes.length) {
    await prisma.comercialDecisao.createMany({
      data: r.decisoes.map((d) => ({
        id: d.id,
        leadId: r.leadId,
        tipo: d.tipo,
        titulo: d.titulo,
        contexto: d.contexto,
        opcoes: d.opcoes as unknown as Prisma.InputJsonValue,
        padrao: d.padrao,
        expiraEm: d.expiraEm,
        estado: 'aberta',
        eventoAberturaId: d.eventoAberturaId,
        dados: d.dados as Prisma.InputJsonValue,
        criadoEm: d.criadaEm,
      })),
      skipDuplicates: true,
    });
  }
  if (r.cobrancas.length) {
    await prisma.comercialCobranca.createMany({
      data: r.cobrancas.map((c) => ({
        id: uuidDe([orgId, 'seed-comercial', 'cobranca', c.externoId]),
        leadId: r.leadId,
        provedor: 'asaas',
        externoId: c.externoId,
        parcela: c.parcela,
        parcelas: c.parcelas,
        valorCentavos: c.valorCentavos,
        forma: c.forma,
        vence: c.vence,
        estado: 'pendente',
      })),
      skipDuplicates: true,
    });
  }
  if (r.documentos.length) {
    await prisma.comercialDocumento.createMany({
      data: r.documentos.map((d) => ({
        id: uuidDe([orgId, 'seed-comercial', 'documento', d.externoId]),
        leadId: r.leadId,
        provedor: 'zapsign',
        externoId: d.externoId,
        estado: d.estado,
        hashConteudo: d.hashConteudo,
        assinadoClienteEm: d.assinadoClienteEm,
      })),
      skipDuplicates: true,
    });
  }
}

/** A ficha e os espelhos do Lead, refeitos dos eventos GRAVADOS (não dos montados agora). Devolve a etapa. */
async function refazerFicha(prisma: PrismaClient, r: RoteiroDoLead): Promise<string> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.leadId }, select: { enteredAt: true } });
  const eventos = await prisma.leadEvent.findMany({ where: { leadId: r.leadId }, select: { id: true, type: true, payload: true, occurredAt: true } });
  const proj = projetarLead(eventos, lead.enteredAt);

  const data: Record<string, unknown> = {};
  for (const c of COLUNAS_PROJETADAS) data[c] = paraOBanco(c, proj.ficha[c]);
  data.saude = r.overlay.saude;
  data.proximaAcaoTipo = r.overlay.proximaAcao?.tipo ?? null;
  data.proximaAcaoQuando = r.overlay.proximaAcao?.quando ?? null;
  data.proximaAcaoTexto = r.overlay.proximaAcao?.descricao ?? null;
  await prisma.comercialFicha.update({ where: { leadId: r.leadId }, data: data as Prisma.ComercialFichaUncheckedUpdateInput });
  await prisma.lead.update({
    where: { id: r.leadId },
    data: { status: proj.lead.status as LeadStatus, score: proj.lead.score, ownerId: proj.lead.ownerId },
  });
  return proj.ficha.etapa as EtapaDoBanco;
}

/** As linhas que a semente deixa, só dos leads dela (o banco de homologação tem outros). */
export async function contar(prisma: PrismaClient, leadIds: string[]): Promise<RelatorioDaSemente['contagens']> {
  const where = { leadId: { in: leadIds } };
  const [leads, eventos, fichas, salas, decisoes, cobrancas, documentos] = await Promise.all([
    prisma.lead.count({ where: { id: { in: leadIds } } }),
    prisma.leadEvent.count({ where }),
    prisma.comercialFicha.count({ where }),
    prisma.salaDoCliente.count({ where }),
    prisma.comercialDecisao.count({ where }),
    prisma.comercialCobranca.count({ where }),
    prisma.comercialDocumento.count({ where }),
  ]);
  return { leads, eventos, fichas, salas, decisoes, cobrancas, documentos };
}

/** Os ids dos leads que a semente cria, para o teste e a contagem de antes e depois. */
export function idsDosLeads(orgId: string, agora: Date = new Date()): string[] {
  return montarRoteiros({ orgId, agora, dono: null, decisaoExpiraHoras: 4, validadePropostaDias: 8 }).map((r) => r.leadId);
}
