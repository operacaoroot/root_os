/**
 * REVISÃO ADVERSARIAL, P3 DA ESPINHA (lane G/P3-servidor, 13/10/2026).
 *
 * Os serviços de verdade, montados à mão, num banco descartável:
 *   · A-4: a geladeira decidida pela fila volta na data que a régua dá; sem o
 *     número, nasce sem data e com o [a decidir] escrito.
 */
import { PrismaClient } from '@prisma/client';
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
});
