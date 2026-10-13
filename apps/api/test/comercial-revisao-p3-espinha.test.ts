/**
 * REVISÃO ADVERSARIAL, P3 DA ESPINHA (lane G/P3-servidor, 13/10/2026).
 *
 * Os serviços de verdade, montados à mão, num banco descartável:
 *   · A-4: a geladeira decidida pela fila volta na data que a régua dá; sem o
 *     número, nasce sem data e com o [a decidir] escrito.
 *   · A-3: a reação à decisão tomada que lança deixa a linha de trava em
 *     `erro` e o retry do relógio a roda de novo.
 *   · A-5: a etapa, o `Lead.status` e o `etapa.mudou` caem juntos.
 *   · E-24: o sócio da conta é achado pelo id da ata, nunca pelo nome.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigComercialService } from '../src/comercial/config.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, eventos, fichas, decisões e rotinas do comercial)');

const MARCA = `p3e${Date.now().toString(36).slice(-6)}`;
const DIA = 86_400_000;

describe.skipIf(!URL)('revisão P3 da espinha, contra o banco', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let socia = { id: '', name: '' };
  let reacoes: ReacoesRegistry;
  let fio: FioService;
  let fichas: FichaService;
  let decisoes: DecisoesService;
  let aoDecidir: DecisoesRegistry;
  let config: ConfigComercialService;
  let relogio: RelogioDaEspinha;
  let n = 0;

  const ficha = (leadId: string) => prisma.comercialFicha.findFirstOrThrow({ where: { leadId } });

  async function leadNovo(): Promise<string> {
    n++;
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: `Lead ${MARCA} ${n}`, phone: `55329${Date.now().toString().slice(-7)}${n}` } });
    await fichas.garantir(ORG, lead.id);
    return lead.id;
  }

  async function pontoZeroNaGeladeira(leadId: string): Promise<void> {
    const d = await decisoes.abrir({
      orgId: ORG,
      leadId,
      tipo: 'ponto_zero',
      chave: 'form',
      titulo: 'Lead sem base',
      contexto: 'teste',
      opcoes: [
        { chave: 'aceitar_excecao', rotulo: 'aceitar exceção' },
        { chave: 'geladeira', rotulo: 'geladeira' },
        { chave: 'desqualificar', rotulo: 'desqualificar' },
      ],
      padrao: 'geladeira',
    });
    await decisoes.responder(ORG, d.id, 'geladeira', { id: socia.id, nome: socia.name }, 'tela');
  }

  beforeAll(async () => {
    const org = await prisma.org.create({ data: { name: `P3 espinha ${MARCA}`, slug: `p3-espinha-${MARCA}` } });
    ORG = org.id;
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin Master' } });
    socia = await prisma.user.create({ data: { orgId: ORG, name: 'Sócia', email: `socia.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } }, select: { id: true, name: true } });
    reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    config = new ConfigComercialService(p);
    aoDecidir = new DecisoesRegistry();
    decisoes = new DecisoesService(p, fio, config, aoDecidir);
    fichas = new FichaService(p, fio, config);
    relogio = new RelogioDaEspinha(p, new ExecutoresDeRotinaRegistry(), new RelogioComercialRegistry(), decisoes, fio, config, fichas);
    relogio.inscrever();
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, aoDecidir, relogio).inscrever();
  });

  afterAll(async () => {
    if (ORG) {
      const leads = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: ORG } });
      await prisma.rotina.deleteMany({ where: { orgId: ORG } });
      await prisma.comercialConfig.deleteMany({ where: { orgId: ORG } });
      await prisma.user.deleteMany({ where: { orgId: ORG } });
      await prisma.role.deleteMany({ where: { orgId: ORG } });
      await prisma.org.deleteMany({ where: { id: ORG } });
    }
    await prisma.$disconnect();
  });

  describe('A-4: a geladeira decidida pela fila', () => {
    it('sem o número da régua, nasce sem data, com o [a decidir] no fato e a próxima ação pedindo a data', async () => {
      const leadId = await leadNovo();
      await pontoZeroNaGeladeira(leadId);
      const f = await ficha(leadId);
      expect(f.etapa).toBe('geladeira');
      expect(f.voltaEm).toBeNull();
      const saida = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'saida.registrada' } });
      expect((saida.payload as { detalhe: string }).detalhe).toContain('[a decidir]');
      expect((await fichas.projecao(ORG, leadId)).proximaAcao).toMatchObject({ tipo: 'data_da_geladeira' });
    });

    it('com geladeiraVoltaDias na régua, nasce com voltaEm e o relógio a devolve quando a data chega', async () => {
      await config.gravar(ORG, { geladeiraVoltaDias: 30 });
      const leadId = await leadNovo();
      const antes = Date.now();
      await pontoZeroNaGeladeira(leadId);
      const f = await ficha(leadId);
      expect(f.etapa).toBe('geladeira');
      expect(f.voltaEm).not.toBeNull();
      const volta = f.voltaEm!.getTime();
      expect(volta).toBeGreaterThanOrEqual(antes + 30 * DIA - 1000);
      expect(volta).toBeLessThanOrEqual(Date.now() + 30 * DIA + 1000);
      expect(await relogio.voltasDaGeladeira(ORG, new Date(Date.now() + 29 * DIA))).toBe(0);
      expect(await relogio.voltasDaGeladeira(ORG, new Date(Date.now() + 31 * DIA))).toBe(1);
      expect((await ficha(leadId)).etapa).toBe('novo_lead');
      await config.gravar(ORG, { geladeiraVoltaDias: null });
    });
  });

  describe('A-3: a reação à decisão que falha entra no retry', () => {
    it('lança na primeira vez: a linha fica erro; o retry do relógio a roda de novo e ela fica ok', async () => {
      let chamadas = 0;
      aoDecidir.aoDecidir(
        'lead_parado',
        async (d) => {
          chamadas++;
          if (chamadas === 1) throw new Error('caiu no meio');
          return { refeita: d.escolha, por: d.por?.nome ?? null };
        },
        'teste.instavel',
      );
      const leadId = await leadNovo();
      const d = await decisoes.abrir({ orgId: ORG, leadId, tipo: 'lead_parado', chave: 'p3', titulo: 'parado', contexto: 'teste', opcoes: [{ chave: 'manter', rotulo: 'manter' }, { chave: 'perdido', rotulo: 'perdido' }], padrao: 'manter' });
      const r = await decisoes.responder(ORG, d.id, 'manter', { id: socia.id, nome: socia.name }, 'tela');
      expect(r.resultados).toContainEqual({ reacao: 'teste.instavel', erro: 'caiu no meio' });
      const linha = await prisma.comercialReacao.findFirstOrThrow({ where: { leadId, reacao: 'decisao:teste.instavel' } });
      expect(linha).toMatchObject({ estado: 'erro', erro: 'caiu no meio' });
      // A reação da espinha à mesma decisão também tem a sua linha, e ok.
      expect(await prisma.comercialReacao.findFirst({ where: { leadId, reacao: 'decisao:espinha.lead-parado' } })).toMatchObject({ estado: 'ok' });

      await fio.reexecutarPendentes(ORG, new Date(Date.now() + 1000));
      expect(chamadas).toBe(2);
      const depois = await prisma.comercialReacao.findUniqueOrThrow({ where: { id: linha.id } });
      expect(depois.estado).toBe('ok');
      expect(depois.resultado).toEqual({ refeita: 'manter', por: socia.name });
      // Passar de novo não roda outra vez.
      await fio.reexecutarPendentes(ORG, new Date(Date.now() + 1000));
      expect(chamadas).toBe(2);
    });
  });

  describe('A-5: a etapa, o status e o fato numa transação', () => {
    /** O mesmo banco, com a gravação do fato caindo quando `cair()` diz (dentro ou fora de transação). */
    function comQuedaNoFato(real: PrismaClient | Prisma.TransactionClient, cair: () => boolean): PrismaClient {
      return new Proxy(real as object, {
        get(alvo, k) {
          const t = alvo as Record<string | symbol, unknown>;
          if (k === 'leadEvent') {
            const le = t.leadEvent as Record<string | symbol, unknown>;
            return new Proxy(le, {
              get(m, f) {
                if (f === 'createMany' && cair()) return async () => { throw new Error('queda entre as escritas'); };
                const v = (m as Record<string | symbol, unknown>)[f];
                return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(m) : v;
              },
            });
          }
          if (k === '$transaction') {
            return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, o?: unknown) =>
              (alvo as PrismaClient).$transaction((tx) => fn(comQuedaNoFato(tx, cair) as unknown as Prisma.TransactionClient), o as never);
          }
          const v = t[k];
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(alvo) : v;
        },
      }) as PrismaClient;
    }

    it('a gravação do fato cai: a etapa e o status ficam como estavam; sem queda, as três escritas e o fato', async () => {
      let cair = true;
      const px = comQuedaNoFato(prisma, () => cair) as unknown as PrismaService;
      const fichasComQueda = new FichaService(px, new FioService(px, new ReacoesRegistry()), config);
      const leadId = await leadNovo();
      const statusAntes = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status;
      await expect(fichasComQueda.mudarEtapa(ORG, leadId, 'perdido', { motivo: 'teste da queda' })).rejects.toThrow(/queda/);
      expect((await ficha(leadId)).etapa).toBe('novo_lead');
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).toBe(statusAntes);
      expect(await prisma.leadEvent.count({ where: { leadId, type: 'etapa.mudou' } })).toBe(0);

      cair = false;
      const r = await fichasComQueda.mudarEtapa(ORG, leadId, 'perdido', { motivo: 'teste sem queda' });
      expect(r).toMatchObject({ ok: true, mudou: true, de: 'novo_lead', para: 'perdido' });
      expect((await ficha(leadId)).etapa).toBe('perdido');
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).status).not.toBe(statusAntes);
      expect(await prisma.leadEvent.count({ where: { leadId, type: 'etapa.mudou' } })).toBe(1);
    });

    it('a reação ao etapa.mudou roda depois do commit, uma vez', async () => {
      let vistas = 0;
      reacoes.inscrever('etapa.mudou', 'teste.p3.etapa', async (ev) => {
        vistas++;
        // A reação enxerga a etapa nova (o commit já aconteceu).
        return { etapa: (await ficha(ev.leadId)).etapa };
      });
      const leadId = await leadNovo();
      await fichas.mudarEtapa(ORG, leadId, 'desqualificado', { motivo: 'teste da reação' });
      expect(vistas).toBe(1);
      const linha = await prisma.comercialReacao.findFirstOrThrow({ where: { leadId, reacao: 'teste.p3.etapa' } });
      expect(linha).toMatchObject({ estado: 'ok', resultado: { etapa: 'desqualificado' } });
    });
  });

  describe('E-24: o sócio da conta pelo id', () => {
    it('dois usuários com o mesmo nome: o sócio é quem subiu a ata, não o mais antigo', async () => {
      const antigo = await prisma.user.create({ data: { orgId: ORG, name: 'Rodrigo', email: `rodrigo.a.${MARCA}@root.local`, passwordHash: 'x' }, select: { id: true } });
      const novo = await prisma.user.create({ data: { orgId: ORG, name: 'Rodrigo', email: `rodrigo.b.${MARCA}@root.local`, passwordHash: 'x' }, select: { id: true } });
      const leadId = await leadNovo();
      await fichas.registrarAta(ORG, leadId, { texto: 'Ata da conversa com o cliente. '.repeat(20), fonte: 'texto' }, { id: novo.id, nome: 'Rodrigo' });
      const f = await fichas.projecao(ORG, leadId);
      expect(f.socioDaConta).toEqual({ id: novo.id, nome: 'Rodrigo' });
      expect(f.socioDaConta?.id).not.toBe(antigo.id);
    });

    it('ata sem id (gravada antes do conserto): o id fica nulo, nunca o nome no lugar', async () => {
      const leadId = await leadNovo();
      await fio.registrar(ORG, leadId, 'ata.chegou', `h-${MARCA}`, { hash: `h-${MARCA}`, caracteres: 10, fonte: 'texto', por: 'Rodrigo' });
      await fichas.aplicar({ eventoId: 'x', orgId: ORG, leadId, type: 'ata.chegou', payload: { hash: `h-${MARCA}`, caracteres: 10, fonte: 'texto', por: 'Rodrigo' }, em: new Date() } as never);
      const f = await fichas.projecao(ORG, leadId);
      expect(f.socioDaConta).toEqual({ id: null, nome: 'Rodrigo' });
    });
  });
});
