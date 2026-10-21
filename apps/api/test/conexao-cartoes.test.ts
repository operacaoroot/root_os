/**
 * O CARTÃO ÚNICO DE CONEXÕES NA API — rodada dos agentes, lane A6 (21/10/2026).
 *
 * `GET /integrations/cartoes` traduz o catálogo SONDADO para o vocabulário de um
 * cartão só e acrescenta quem usa cada conector (o cadastro único) e se há
 * credencial desta empresa no cofre. Cobra-se aqui:
 *   · o estado é a sonda (verde só com tentativa), desligado não é sondado;
 *   · "Erro" leva o motivo do conector;
 *   · a credencial nunca vem, só o fato;
 *   · quem usa vem do cadastro (pela capacidade e pelo mapa à mão), sem aposentado;
 *   · a pessoa sem acesso não leva a resposta.
 * Sem banco e sem Nest: o serviço é montado à mão.
 */
import { describe, expect, it } from 'vitest';
import { CADASTRO_DE_FUNCOES, CONNECTORS, textoDoEstadoDoCartao } from '@mktos/shared';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { USO_SEM_CAPACIDADE, quemUsa } from '../src/integrations/usado-por';
import { conectado, erroDeConector, naoConfigurado, type ConectorDoContrato } from '../src/integrations/contrato-de-conector';
import type { AuditService } from '../src/audit/audit.service';
import type { ConectoresService } from '../src/integrations/conectores.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const EMPRESA = 'org-a6-cartoes';
const PESSOA = 'pessoa-a6';
const SEGREDO = 'valor-do-segredo-que-nao-pode-sair';

function conector(chave: string, saude: () => ReturnType<ConectorDoContrato['saude']>, extra: Partial<ConectorDoContrato> = {}): ConectorDoContrato {
  return {
    chave,
    rotulo: chave,
    escopoDaCredencial: 'empresa',
    autorizar: async () => ({ tipo: 'nao_se_aplica', motivo: '-' }),
    sincronizar: async () => ({ tipo: 'nao_se_aplica', motivo: '-' }),
    revogar: async () => ({ tipo: 'nao_se_aplica', motivo: '-' }),
    saude,
    ...extra,
  };
}

function montar(opcoes: { permissoes?: string[]; ativo?: boolean } = {}) {
  const contrato = new RegistroDeConectores();
  const desligados = new Map<string, { motivo: string | null; desligadoPor: string | null; desligadoEm: Date }>();
  let chamadasDeSaude: string[] = [];
  const permissoes = opcoes.permissoes ?? ['dashboard.ver', 'admin.usuarios'];
  const prisma = {
    integrationAccount: { findMany: async () => [] },
    segredoDeConector: {
      // O select pedido pelo serviço é só `conector`; o valor cifrado nunca é lido.
      findMany: async (q: { select: Record<string, boolean> }) => {
        expect(Object.keys(q.select)).toEqual(['conector']);
        return [{ conector: 'google' }, { conector: 'evolution' }];
      },
    },
    user: {
      findFirst: async () =>
        opcoes.ativo === false ? null : { roles: [{ permissions: permissoes.map((key) => ({ key })) }] },
    },
  } as unknown as PrismaService;
  const conectores = { desligados: async () => desligados } as unknown as ConectoresService;
  const svc = new IntegrationsService(prisma, { log: async () => {} } as unknown as AuditService, conectores, new ConectoresConfiguradosRegistry(), contrato);

  const registrar = (c: ConectorDoContrato) => {
    const saude = c.saude;
    contrato.registrar({ ...c, saude: async (ctx) => { chamadasDeSaude.push(c.chave); return saude(ctx); } }, c.chave);
  };
  registrar(conector('google', async () => conectado(30, 'contato@empresa.exemplo'), { linhasDoCatalogo: ['gmail', 'gcal', 'gdocs', 'drive'] }));
  registrar(conector('evolution', async () => erroDeConector('Instância desconectada: gere o QR para ligar o número.', 40), { linhasDoCatalogo: ['evolution'] }));
  registrar(conector('zapsign', async () => naoConfigurado('ZAPSIGN_API_TOKEN ausente.'), { escopoDaCredencial: 'processo' }));
  registrar(conector('clickup', async () => conectado(10, 'token de alguém'), { escopoDaCredencial: 'processo' }));
  return { svc, desligados, chamadas: () => chamadasDeSaude, zerar: () => (chamadasDeSaude = []) };
}

describe('GET /integrations/cartoes', () => {
  it('o estado é a sonda, no vocabulário do cartão, com a hora da medição', async () => {
    const { svc } = montar();
    const r = await svc.cartoes(EMPRESA, PESSOA, { prazoDeSondaMs: 500 });
    const por = (k: string) => r.items.find((i) => i.key === k)!;
    expect(por('gmail').estado).toBe('conectado');
    expect(por('gmail').conta).toBe('contato@empresa.exemplo');
    expect(por('gmail').medidoEm).toBeTruthy();
    expect(por('evolution').estado).toBe('erro');
    expect(textoDoEstadoDoCartao(por('evolution').estado, por('evolution').motivo)).toBe(
      'Erro: Instância desconectada: gere o QR para ligar o número.',
    );
    expect(por('evolution').conta).toBeNull();
    expect(por('zapsign').estado).toBe('nao_configurado');
    expect(r.autoridadeGerenciar).toBe(true);
  });

  it('desligado é "Desligado" e NÃO é sondado (sondar sairia da casa)', async () => {
    const { svc, desligados, chamadas, zerar } = montar();
    desligados.set('clickup', { motivo: 'o Trabalho mora no OS', desligadoPor: null, desligadoEm: new Date() });
    zerar();
    const r = await svc.cartoes(EMPRESA, PESSOA, { prazoDeSondaMs: 500 });
    const clickup = r.items.find((i) => i.key === 'clickup')!;
    expect(clickup.estado).toBe('desligado');
    expect(clickup.motivo).toBe('o Trabalho mora no OS');
    expect(clickup.medidoEm).toBeNull();
    expect(chamadas()).not.toContain('clickup');
  });

  it('a credencial nunca vem: só o fato de haver uma no cofre', async () => {
    const { svc } = montar();
    const r = await svc.cartoes(EMPRESA, PESSOA, { prazoDeSondaMs: 500 });
    expect(JSON.stringify(r)).not.toContain(SEGREDO);
    expect(r.items.find((i) => i.key === 'gmail')!.credencialNoCofre).toBe(true);
    expect(r.items.find((i) => i.key === 'evolution')!.credencialNoCofre).toBe(true);
    expect(r.items.find((i) => i.key === 'zapsign')!.credencialNoCofre).toBe(false);
  });

  it('linha sem conector do contrato não ganha verde: "Não configurado" ou "Não verificado"', async () => {
    const { svc } = montar();
    const r = await svc.cartoes(EMPRESA, PESSOA, { prazoDeSondaMs: 500 });
    const asana = r.items.find((i) => i.key === 'asana')!;
    expect(asana.contrato).toBeNull();
    expect(['nao_configurado', 'nao_verificado']).toContain(asana.estado);
  });

  it('todo cartão diz para que serve e quem usa vem do cadastro', async () => {
    const { svc } = montar();
    const r = await svc.cartoes(EMPRESA, PESSOA, { prazoDeSondaMs: 500 });
    for (const i of r.items) expect(i.paraQueServe.length, i.key).toBeGreaterThan(5);
    const drive = r.items.find((i) => i.key === 'drive')!;
    expect(drive.usadoPor.map((u) => u.id)).toEqual(expect.arrayContaining(['TR-04', 'TR-05', 'CO-10']));
    const evo = r.items.find((i) => i.key === 'evolution')!;
    expect(evo.usadoPor.map((u) => u.id)).toEqual(expect.arrayContaining(['CO-16', 'CO-10']));
  });

  it('quem perdeu o acesso não leva a resposta', async () => {
    const { svc } = montar({ ativo: false });
    await expect(svc.cartoes(EMPRESA, PESSOA)).rejects.toThrow(/Acesso insuficiente/);
  });

  it('quem não administra lê, mas a resposta diz que não gerencia', async () => {
    const { svc } = montar({ permissoes: ['dashboard.ver'] });
    const r = await svc.cartoes(EMPRESA, PESSOA, { prazoDeSondaMs: 500 });
    expect(r.autoridadeGerenciar).toBe(false);
  });
});

describe('quem usa cada conector (o cadastro único)', () => {
  it('o mapa à mão só cita funções que existem no cadastro e linhas que existem no catálogo', () => {
    const ids = new Set(CADASTRO_DE_FUNCOES.map((f) => f.id));
    const linhas = new Set(CONNECTORS.map((c) => c.key));
    for (const [linha, funcoes] of Object.entries(USO_SEM_CAPACIDADE)) {
      expect(linhas.has(linha), linha).toBe(true);
      for (const id of funcoes) expect(ids.has(id), `${linha}: ${id}`).toBe(true);
    }
  });

  it('função aposentada não aparece em cartão nenhum', () => {
    const aposentadas = new Set(CADASTRO_DE_FUNCOES.filter((f) => f.estado === 'aposentado').map((f) => f.id));
    for (const c of CONNECTORS) for (const u of quemUsa(c.key)) expect(aposentadas.has(u.id), `${c.key}: ${u.id}`).toBe(false);
  });

  it('a capacidade leva a função ao cartão do conector dela (Asaas, ZapSign, YouTube, Instagram)', () => {
    expect(quemUsa('asaas').map((u) => u.id)).toEqual(expect.arrayContaining(['CO-09', 'CO-10', 'FI-02']));
    expect(quemUsa('zapsign').map((u) => u.id)).toContain('CO-08');
    expect(quemUsa('youtube').map((u) => u.id)).toEqual(expect.arrayContaining(['CT-15', 'CT-17']));
    expect(quemUsa('instagram').map((u) => u.id)).toEqual(expect.arrayContaining(['CT-16', 'CT-19', 'RO-02']));
    expect(quemUsa('gcal').map((u) => u.id)).toContain('AG-01');
    expect(quemUsa('clickup').map((u) => u.id)).toContain('RO-01');
  });
});
