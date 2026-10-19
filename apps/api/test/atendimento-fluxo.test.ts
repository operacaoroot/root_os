import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { EntradaDoAtendimentoService, chaveDoAnexo } from '../src/atendimento/entrada-do-atendimento.service';
import { AtendimentoService, CAPACIDADE_DE_RESPONDER } from '../src/atendimento/atendimento.service';
import { OuvintesDoWebhookRegistry } from '../src/gateway/canais/ouvintes-do-webhook.registry';
import { EntradaDeGrupoRegistry } from '../src/gateway/canais/entrada-de-grupo.registry';
import { WhatsappDoAtendimentoRegistry } from '../src/gateway/canais/whatsapp-do-atendimento.registry';
import { CanalDeAprovacaoController } from '../src/gateway/canais/canal-de-aprovacao.controller';
import type { CanalDeAprovacaoService } from '../src/gateway/canais/canal-de-aprovacao.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { StorageService } from '../src/storage/storage.service';
import type { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import type { TarefasDoDiaService } from '../src/work/tarefas-do-dia.service';

/*
 * ============================================================================
 * CAIXA DE ATENDIMENTO — o percurso inteiro, com dados sintéticos
 * ============================================================================
 *
 * Sem banco e sem Evolution de verdade, como a suíte do grupo de links: um
 * Prisma em memória que IMPÕE as mesmas chaves únicas da migration
 * `20261019230000_atendimento_whatsapp` (é nelas que mora a deduplicação), uma
 * Evolution falsa que conta cada envio, e uma porta falsa que retém como a de
 * verdade retém um R3. Nenhum número, nome ou mensagem real.
 *
 * O que só um Postgres prova (o isolamento por linha e a migration aplicando)
 * está no roteiro de publicação, não aqui.
 */

Logger.overrideLogger(false);

const ORG = 'org-root';
const OUTRA = 'org-outra';
const LUCAS = 'user-lucas';
const PEDRO = 'user-pedro';
const CLIENTE = '5511900000001@s.whatsapp.net';
const OPERADOR = '5511900000099@s.whatsapp.net';
const GRUPO_LINKS = '120363000000000077@g.us';
const GRUPO_CLIENTE = '120363000000000001@g.us';

// ---------------------------------------------------------------- banco em memória

type Linha = Record<string, unknown>;
const UNICAS: Record<string, string[][]> = {
  atendimentoAjuste: [['orgId']],
  atendimentoContato: [['orgId', 'jid'], ['id']],
  atendimentoMensagem: [['orgId', 'evolutionId'], ['orgId', 'clienteMensagemId'], ['id']],
  atendimentoTarefa: [['mensagemId']],
};
const COMPOSTAS: Record<string, string[]> = {
  orgId_evolutionId: ['orgId', 'evolutionId'],
  orgId_clienteMensagemId: ['orgId', 'clienteMensagemId'],
  orgId_jid: ['orgId', 'jid'],
};
const RELACOES: Record<string, Record<string, { tabela: string; chave: string; muitos?: boolean; pai?: string }>> = {
  atendimentoContato: {
    cliente: { tabela: 'workTask', chave: 'clienteId' },
    responsavel: { tabela: 'user', chave: 'responsavelId' },
  },
  atendimentoMensagem: {
    contato: { tabela: 'atendimentoContato', chave: 'contatoId' },
    tarefa: { tabela: 'atendimentoTarefa', chave: 'id', pai: 'mensagemId' },
  },
  workTask: { list: { tabela: 'workList', chave: 'listId' } },
};

function repetida() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'teste' });
}

function igual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function bancoEmMemoria() {
  const t: Record<string, Linha[]> = {
    atendimentoAjuste: [], atendimentoContato: [], atendimentoMensagem: [], atendimentoTarefa: [],
    channelIdentity: [], approval: [], user: [], workTask: [], workList: [], workArea: [], org: [], auditLog: [],
  };

  const relacionado = (tabela: string, linha: Linha, nome: string): Linha | null => {
    const r = RELACOES[tabela]?.[nome];
    if (!r) return null;
    if (r.pai) return t[r.tabela].find((x) => x[r.pai!] === linha[r.chave]) ?? null;
    return t[r.tabela].find((x) => x.id === linha[r.chave]) ?? null;
  };

  const casa = (tabela: string, linha: Linha, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (k === 'OR') return (v as Record<string, unknown>[]).some((w) => casa(tabela, linha, w));
      if (k === 'NOT') return !casa(tabela, linha, v as Record<string, unknown>);
      if (COMPOSTAS[k]) return COMPOSTAS[k].every((c) => igual(linha[c], (v as Linha)[c]));
      if (RELACOES[tabela]?.[k]) {
        const rel = relacionado(tabela, linha, k);
        return rel !== null && casa(RELACOES[tabela][k].tabela, rel, v as Record<string, unknown>);
      }
      const atual = linha[k];
      if (v === null) return atual == null;
      if (typeof v !== 'object' || v instanceof Date) return igual(atual, v);
      const o = v as Record<string, unknown>;
      if ('in' in o && !(o.in as unknown[]).some((x) => igual(atual, x))) return false;
      if ('notIn' in o && (o.notIn as unknown[]).some((x) => igual(atual, x))) return false;
      if ('not' in o && (o.not === null ? atual == null : igual(atual, o.not))) return false;
      if ('gte' in o && !(atual != null && (atual as Date) >= (o.gte as Date))) return false;
      if ('lt' in o && !(atual != null && (atual as Date) < (o.lt as Date))) return false;
      if ('endsWith' in o && !String(atual ?? '').endsWith(String(o.endsWith))) return false;
      if ('contains' in o) {
        const ci = o.mode === 'insensitive';
        const a = String(atual ?? ''), b = String(o.contains);
        if (!(ci ? a.toLowerCase().includes(b.toLowerCase()) : a.includes(b))) return false;
      }
      return true;
    });
  };

  const conferirUnicas = (tabela: string, linha: Linha, ignorar?: Linha) => {
    for (const cols of UNICAS[tabela] ?? []) {
      if (cols.some((c) => linha[c] == null)) continue; // NULL não colide, como no Postgres
      if (t[tabela].some((x) => x !== ignorar && cols.every((c) => igual(x[c], linha[c])))) throw repetida();
    }
  };

  const aplicar = (linha: Linha, data: Linha) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as Linha)) {
        linha[k] = Number(linha[k] ?? 0) + Number((v as Linha).increment);
      } else linha[k] = v;
    }
    linha.atualizadoEm = new Date(Date.now() + (linha.__v = Number(linha.__v ?? 0) + 1));
  };

  const projetar = (tabela: string, linha: Linha, args: { include?: Linha; select?: Linha }): Linha => {
    const saida: Linha = { ...linha };
    const extras = args.include ?? args.select ?? {};
    for (const [k, v] of Object.entries(extras)) {
      if (RELACOES[tabela]?.[k]) {
        const rel = relacionado(tabela, linha, k);
        const sub = v && typeof v === 'object' ? (v as Linha) : {};
        saida[k] = rel ? projetar(RELACOES[tabela][k].tabela, rel, { select: sub.select as Linha | undefined }) : null;
      }
    }
    return saida;
  };

  const modelo = (tabela: string) => ({
    findUnique: async (a: { where: Linha; include?: Linha; select?: Linha }) => {
      const l = t[tabela].find((x) => casa(tabela, x, a.where));
      return l ? projetar(tabela, l, a) : null;
    },
    findFirst: async (a: { where?: Linha; include?: Linha; select?: Linha; orderBy?: unknown } = {}) => {
      const l = ordenar(t[tabela].filter((x) => casa(tabela, x, a.where)), a.orderBy)[0];
      return l ? projetar(tabela, l, a) : null;
    },
    findMany: async (a: { where?: Linha; include?: Linha; select?: Linha; orderBy?: unknown; take?: number; skip?: number } = {}) =>
      ordenar(t[tabela].filter((x) => casa(tabela, x, a.where)), a.orderBy)
        .slice(a.skip ?? 0, (a.skip ?? 0) + (a.take ?? 1e9))
        .map((l) => projetar(tabela, l, a)),
    count: async (a: { where?: Linha } = {}) => t[tabela].filter((x) => casa(tabela, x, a.where)).length,
    create: async (a: { data: Linha; select?: Linha }) => {
      const l: Linha = { id: randomUUID(), criadoEm: new Date(), atualizadoEm: new Date(), ...a.data };
      if (tabela === 'atendimentoContato') { l.versao ??= 0; l.grupo ??= false; l.encerradaEm ??= null; l.clienteId ??= null; l.responsavelId ??= null; l.nome ??= null; }
      if (tabela === 'atendimentoMensagem') {
        for (const k of ['evolutionId', 'clienteMensagemId', 'approvalId', 'lidaEm', 'apagadaEm', 'erroEnvio', 'statusEnvio', 'anexoChave', 'anexoSituacao', 'autorId']) l[k] ??= null;
      }
      if (tabela === 'atendimentoTarefa') l.tarefaId ??= null;
      conferirUnicas(tabela, l);
      t[tabela].push(l);
      return { ...l };
    },
    upsert: async (a: { where: Linha; create: Linha; update: Linha }) => {
      const l = t[tabela].find((x) => casa(tabela, x, a.where));
      if (l) { aplicar(l, a.update); return { ...l }; }
      return modelo(tabela).create({ data: a.create });
    },
    update: async (a: { where: Linha; data: Linha }) => {
      const l = t[tabela].find((x) => casa(tabela, x, a.where));
      if (!l) throw new Error(`${tabela}: linha não encontrada`);
      const prova = { ...l }; aplicar(prova, a.data); conferirUnicas(tabela, prova, l);
      aplicar(l, a.data);
      return { ...l };
    },
    updateMany: async (a: { where: Linha; data: Linha }) => {
      const alvo = t[tabela].filter((x) => casa(tabela, x, a.where));
      for (const l of alvo) { const prova = { ...l }; aplicar(prova, a.data); conferirUnicas(tabela, prova, l); }
      for (const l of alvo) aplicar(l, a.data);
      return { count: alvo.length };
    },
    deleteMany: async (a: { where: Linha }) => {
      const antes = t[tabela].length;
      t[tabela] = t[tabela].filter((x) => !casa(tabela, x, a.where));
      return { count: antes - t[tabela].length };
    },
    groupBy: async (a: { by: string[]; where: Linha }) => {
      const grupos = new Map<string, number>();
      for (const l of t[tabela].filter((x) => casa(tabela, x, a.where))) {
        const k = String(l[a.by[0]]); grupos.set(k, (grupos.get(k) ?? 0) + 1);
      }
      return [...grupos].map(([k, n]) => ({ [a.by[0]]: k, _count: { _all: n } }));
    },
  });

  function ordenar(linhas: Linha[], orderBy: unknown): Linha[] {
    const ordens = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, unknown>[];
    return [...linhas].sort((a, b) => {
      for (const o of ordens) {
        const [k, d] = Object.entries(o)[0];
        const dir = typeof d === 'object' ? (d as Linha).sort : d;
        const va = a[k] as number | string | Date | null, vb = b[k] as number | string | Date | null;
        if (va == null && vb == null) continue;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (va < vb) return dir === 'desc' ? 1 : -1;
        if (va > vb) return dir === 'desc' ? -1 : 1;
      }
      return 0;
    });
  }

  const prisma = new Proxy({} as Record<string, unknown>, {
    get: (_, nome: string) => (t[nome] ? modelo(nome) : undefined),
  }) as unknown as PrismaService;
  return { prisma, t };
}

// ---------------------------------------------------------------- o mundo de mentira

function montar() {
  const { prisma, t } = bancoEmMemoria();
  t.org.push({ id: ORG, name: 'Empresa Teste', slug: 'teste' }, { id: OUTRA, name: 'Outra', slug: 'outra' });
  t.user.push(
    { id: LUCAS, orgId: ORG, name: 'Lucas Teste', email: 'lucas@teste.local', isActive: true, lastLoginAt: new Date() },
    { id: PEDRO, orgId: ORG, name: 'Pedro Teste', email: 'pedro@teste.local', isActive: true, lastLoginAt: new Date() },
  );
  t.workList.push({ id: 'lista-crm', orgId: ORG, natureza: 'cadastro' });
  t.workTask.push(
    { id: 'card-cliente', orgId: ORG, title: 'Cliente Sintético Ltda', listId: 'lista-crm', archived: false, parentId: null, description: null },
    { id: 'card-outra', orgId: OUTRA, title: 'Cliente da Outra', listId: 'lista-crm', archived: false, parentId: null, description: null },
  );
  t.workArea.push({ id: 'area-ops', orgId: ORG, nome: 'Operação' });
  t.channelIdentity.push({ id: 'ci', orgId: ORG, canal: 'whatsapp', externalId: '5511900000099', ativo: true, userId: PEDRO });

  const arquivos = new Map<string, Buffer>();
  const storage = {
    put: vi.fn(async (k: string, b: Buffer) => { arquivos.set(k, b); }),
    get: vi.fn(async (k: string) => {
      const b = arquivos.get(k);
      if (!b) throw new Error('não existe');
      return { stream: Readable.from(b), contentType: 'image/jpeg', size: b.length };
    }),
  } as unknown as StorageService;

  const enviados: { jid: string; texto: string }[] = [];
  let falharEnvio = false;
  const whatsapp = new WhatsappDoAtendimentoRegistry();
  whatsapp.registrar({
    enviarTexto: async (jid, texto) => {
      if (falharEnvio) throw new Error('Evolution respondeu HTTP 500.');
      enviados.push({ jid, texto });
      return { id: `EVO-OUT-${enviados.length}` };
    },
    baixarMidia: async ({ id }) => (id.startsWith('SEM-MIDIA') ? null : { base64: Buffer.from('JPEGFALSO').toString('base64'), mimetype: 'image/jpeg' }),
  }, 'teste');

  const ouvintes = new OuvintesDoWebhookRegistry();
  const grupos = new EntradaDeGrupoRegistry();
  grupos.registrar(GRUPO_LINKS, async () => 'pauta', 'teste');
  const entrada = new EntradaDoAtendimentoService(prisma, storage, ouvintes, grupos, whatsapp);
  entrada.onModuleInit();

  const efeitos = new EfeitosRegistry();
  /** A porta de verdade retém R3; `soltar` faz o papel da assinatura de outra pessoa. */
  const retidas = new Map<string, { args: Record<string, unknown>; orgId: string; actorId: string }>();
  const porta = {
    executar: vi.fn(async (e: { orgId: string; actorId: string; capabilityId: string; args: Record<string, unknown> }) => {
      const approvalId = `ap-${retidas.size + 1}`;
      retidas.set(approvalId, { args: e.args, orgId: e.orgId, actorId: e.actorId });
      t.approval.push({ id: approvalId, orgId: e.orgId, status: 'pendente', expiraEm: new Date(Date.now() + 900_000) });
      return { status: 'aguardando_aprovacao', approvalId, mensagem: 'retida', fila: '/atendimento', expiraEm: '', resumo: '', nivel: 'R3', precisaDeOutraPessoa: true };
    }),
  } as unknown as PortaDoOperador;
  const soltar = (approvalId: string) => {
    const r = retidas.get(approvalId)!;
    return efeitos.executar(CAPACIDADE_DE_RESPONDER, r.args, { orgId: r.orgId, approvalId });
  };

  const tarefasCriadas: Linha[] = [];
  const tarefas = {
    criar: vi.fn(async (orgId: string, _actor: string, input: { titulo: string; clienteId?: string | null; confirmar?: boolean }) => {
      await new Promise((r) => setTimeout(r, 5)); // dá tempo de outra chamada correr junto
      const igualA = tarefasCriadas.find((x) => x.orgId === orgId && x.title === input.titulo && x.clienteId === (input.clienteId ?? null));
      if (igualA) return { criada: false, aviso: { tipo: 'igual', tarefa: { id: igualA.id, titulo: igualA.title } } };
      if (!input.confirmar && /^post \d+/i.test(input.titulo)) return { criada: false, aviso: { tipo: 'nao_parece_tarefa', casa: 'post', motivo: 'Parece post.' } };
      const nova = { id: randomUUID(), orgId, title: input.titulo, clienteId: input.clienteId ?? null, description: null };
      tarefasCriadas.push(nova); t.workTask.push(nova);
      return { criada: true, tarefa: { id: nova.id, titulo: nova.title } };
    }),
  } as unknown as TarefasDoDiaService;

  const svc = new AtendimentoService(prisma, new AuditService(prisma), storage, efeitos, porta, whatsapp, tarefas);
  svc.onModuleInit();

  return {
    t, svc, entrada, ouvintes, grupos, enviados, porta, tarefas, tarefasCriadas, arquivos, soltar,
    falhar: (v: boolean) => { falharEnvio = v; },
    ligar: async (org = ORG) => svc.ajustar(org, LUCAS, true),
  };
}

const upsert = (data: Record<string, unknown>) => ({ event: 'messages.upsert', instance: 'teste', data });
const texto = (id: string, conteudo: string, jid = CLIENTE, extra: Record<string, unknown> = {}) =>
  upsert({ key: { id, remoteJid: jid, fromMe: false, ...extra }, pushName: 'Cliente Sintético', message: { conversation: conteudo }, messageTimestamp: Math.floor(Date.now() / 1000) });

// ---------------------------------------------------------------- casos

describe('atendimento — entrada pelo webhook único', () => {
  let m: ReturnType<typeof montar>;
  beforeEach(() => { m = montar(); });

  it('desligada por padrão: nada é guardado até a empresa ligar', async () => {
    expect(await m.entrada.ouvir(ORG, texto('E1', 'oi'))).toBe('caixa_desligada');
    expect(m.t.atendimentoMensagem).toHaveLength(0);
    await m.ligar();
    expect(await m.entrada.ouvir(ORG, texto('E1', 'oi'))).toBe('guardada');
    expect(m.t.atendimentoContato).toHaveLength(1);
    expect(m.t.atendimentoContato[0]).toMatchObject({ jid: CLIENTE, telefone: '5511900000001', nome: 'Cliente Sintético' });
  });

  it('evento repetido não duplica (mesmo id da Evolution)', async () => {
    await m.ligar();
    await m.entrada.ouvir(ORG, texto('E2', 'oi'));
    expect(await m.entrada.ouvir(ORG, texto('E2', 'oi'))).toBe('repetida');
    await Promise.all([m.entrada.ouvir(ORG, texto('E3', 'a')), m.entrada.ouvir(ORG, texto('E3', 'a'))]);
    expect(m.t.atendimentoMensagem.filter((x) => x.evolutionId === 'E3')).toHaveLength(1);
  });

  it('não guarda o que é do canal de aprovação nem do grupo de links', async () => {
    await m.ligar();
    expect(await m.entrada.ouvir(ORG, texto('O1', 'qualquer coisa', OPERADOR))).toBe('canal_de_aprovacao');
    expect(await m.entrada.ouvir(ORG, texto('O2', 'APROVAR ROOT-AB12CD34'))).toBe('resposta_de_aprovacao');
    expect(await m.entrada.ouvir(ORG, texto('O3', 'https://exemplo.com', GRUPO_LINKS, { participant: CLIENTE }))).toBe('grupo_inscrito');
    // "Aprovar" sem código é conversa de cliente, e entra.
    expect(await m.entrada.ouvir(ORG, texto('O4', 'Aprovar o orçamento, por favor'))).toBe('guardada');
    expect(m.t.atendimentoMensagem.map((x) => x.evolutionId)).toEqual(['O4']);
  });

  it('o webhook continua entregando ao canal e ao grupo primeiro, e a caixa só ouve depois', async () => {
    await m.ligar();
    const ordem: string[] = [];
    const canal = { receber: vi.fn(async () => { ordem.push('canal'); return { desfecho: 'ignorado' }; }) } as unknown as CanalDeAprovacaoService;
    m.ouvintes.registrar('espia', async () => { ordem.push('ouvinte'); return 'ok'; });
    const ctrl = new CanalDeAprovacaoController(canal, m.grupos, m.ouvintes);
    process.env.CANAL_APROVACAO_SEGREDO = process.env.CANAL_APROVACAO_SEGREDO ?? '';
    // Sem segredo configurado a rota responde 404, como antes: nada muda do lado de fora.
    await expect(ctrl.whatsapp(ORG, 'qualquer', texto('W1', 'oi'))).rejects.toThrow();
    // O trabalho em segundo plano, chamado direto (é o que a rota faz depois do segredo).
    await (ctrl as unknown as { emSegundoPlano(o: string, c: unknown): Promise<void> }).emSegundoPlano(ORG, texto('W1', 'oi'));
    expect(ordem).toEqual(['canal', 'ouvinte']);
    expect(m.t.atendimentoMensagem.map((x) => x.evolutionId)).toEqual(['W1']);
  });

  it('a falha do canal não impede a caixa, e a falha da caixa não chega ao canal', async () => {
    await m.ligar();
    const canal = { receber: vi.fn(async () => { throw new Error('canal caiu'); }) } as unknown as CanalDeAprovacaoService;
    m.ouvintes.registrar('quebrado', async () => { throw new Error('ouvinte caiu'); });
    const ctrl = new CanalDeAprovacaoController(canal, m.grupos, m.ouvintes);
    await (ctrl as unknown as { emSegundoPlano(o: string, c: unknown): Promise<void> }).emSegundoPlano(ORG, texto('W2', 'oi'));
    expect(m.t.atendimentoMensagem.map((x) => x.evolutionId)).toEqual(['W2']);
  });

  it('grupo de cliente entra com o participante; o nome do grupo não vira o de quem falou', async () => {
    await m.ligar();
    await m.entrada.ouvir(ORG, texto('G1', 'bom dia', GRUPO_CLIENTE, { participant: '5511900000003@s.whatsapp.net' }));
    expect(m.t.atendimentoContato[0]).toMatchObject({ jid: GRUPO_CLIENTE, grupo: true, nome: null });
    expect(m.t.atendimentoMensagem[0]).toMatchObject({ remetenteJid: '5511900000003@s.whatsapp.net', remetenteNome: 'Cliente Sintético' });
  });

  it('cada empresa guarda só o que é dela', async () => {
    await m.ligar(ORG);
    await m.entrada.ouvir(ORG, texto('X1', 'da root'));
    expect(await m.entrada.ouvir(OUTRA, texto('X2', 'da outra'))).toBe('caixa_desligada');
    await m.ligar(OUTRA);
    await m.entrada.ouvir(OUTRA, texto('X1', 'mesmo id em outra empresa'));
    const lista = await m.svc.conversas(ORG, LUCAS, 'todas', undefined, 0);
    expect(lista.conversas).toHaveLength(1);
    expect(m.t.atendimentoContato.filter((c) => c.orgId === OUTRA)).toHaveLength(1);
    const daOutra = m.t.atendimentoContato.find((c) => c.orgId === OUTRA)!;
    await expect(m.svc.mensagens(ORG, String(daOutra.id), undefined)).rejects.toThrow('Conversa não encontrada');
    await expect(m.svc.editar(ORG, LUCAS, String(lista.conversas[0].id), { clienteId: 'card-outra' })).rejects.toThrow('Cliente não encontrado');
  });
});

describe('atendimento — anexos protegidos', () => {
  let m: ReturnType<typeof montar>;
  beforeEach(async () => { m = montar(); await m.ligar(); });
  const imagem = (id: string, extra: Record<string, unknown> = {}) => upsert({
    key: { id, remoteJid: CLIENTE, fromMe: false },
    message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 9, caption: 'foto', ...extra } },
  });

  it('baixa, guarda por empresa e serve só para a empresa dona', async () => {
    await m.entrada.ouvir(ORG, imagem('IMG1'));
    const msg = m.t.atendimentoMensagem[0];
    expect(msg).toMatchObject({ anexoSituacao: 'guardado', anexoChave: chaveDoAnexo(ORG, String(msg.id)) });
    expect(m.arquivos.get(chaveDoAnexo(ORG, String(msg.id)))?.toString()).toBe('JPEGFALSO');
    const a = await m.svc.anexo(ORG, String(msg.id));
    expect(a.tipo).toBe('image/jpeg');
    await expect(m.svc.anexo(OUTRA, String(msg.id))).rejects.toThrow('Anexo não encontrado');
  });

  it('tipo perigoso ou grande demais é recusado sem baixar; Evolution sem o arquivo vira "falhou"', async () => {
    await m.entrada.ouvir(ORG, upsert({ key: { id: 'DOC1', remoteJid: CLIENTE }, message: { documentMessage: { mimetype: 'text/html', fileName: 'x.html' } } }));
    await m.entrada.ouvir(ORG, imagem('IMG2', { fileLength: 60 * 1024 * 1024 }));
    await m.entrada.ouvir(ORG, imagem('SEM-MIDIA-1'));
    expect(m.t.atendimentoMensagem.map((x) => x.anexoSituacao)).toEqual(['recusado', 'recusado', 'falhou']);
    expect(m.arquivos.size).toBe(0);
    await expect(m.svc.anexo(ORG, String(m.t.atendimentoMensagem[0].id))).rejects.toThrow('Anexo não encontrado');
  });
});

describe('atendimento — responder pela porta (R3), estados e falhas', () => {
  let m: ReturnType<typeof montar>;
  let conversa: string;
  beforeEach(async () => {
    m = montar(); await m.ligar();
    await m.entrada.ouvir(ORG, texto('IN1', 'preciso de ajuda'));
    conversa = String(m.t.atendimentoContato[0].id);
  });

  it('a resposta fica retida, NADA sai antes da assinatura, e sai uma vez depois dela', async () => {
    const cmid = randomUUID();
    const r = await m.svc.responder(ORG, LUCAS, conversa, { texto: 'Olá! Já vejo.', clienteMensagemId: cmid });
    expect(r.retida?.approvalId).toBe('ap-1');
    expect(m.enviados).toHaveLength(0);
    const guardada = m.t.atendimentoMensagem.find((x) => x.id === r.mensagemId)!;
    expect(guardada).toMatchObject({ statusEnvio: 'aguardando_assinatura', approvalId: 'ap-1', autorId: LUCAS });
    // Quem respondeu primeiro assume a conversa.
    expect(m.t.atendimentoContato[0].responsavelId).toBe(LUCAS);

    await m.soltar('ap-1');
    expect(m.enviados).toEqual([{ jid: CLIENTE, texto: 'Olá! Já vejo.' }]);
    expect(guardada).toMatchObject({ statusEnvio: 'aceita', evolutionId: 'EVO-OUT-1' });
    // Soltar de novo (reentrega, clique duplo na fila) não manda de novo.
    await m.soltar('ap-1');
    expect(m.enviados).toHaveLength(1);
  });

  it('clicar duas vezes com o mesmo id devolve a mesma resposta, sem segunda aprovação', async () => {
    const cmid = randomUUID();
    const [a, b] = await Promise.all([
      m.svc.responder(ORG, LUCAS, conversa, { texto: 'uma vez', clienteMensagemId: cmid }),
      m.svc.responder(ORG, LUCAS, conversa, { texto: 'uma vez', clienteMensagemId: cmid }),
    ]);
    expect(a.mensagemId).toBe(b.mensagemId);
    expect(m.t.atendimentoMensagem.filter((x) => x.direcao === 'saida')).toHaveLength(1);
    expect(m.porta.executar).toHaveBeenCalledTimes(1);
  });

  it('aceita → entregue → lida pelos avisos, e aviso atrasado não rebaixa', async () => {
    const r = await m.svc.responder(ORG, LUCAS, conversa, { texto: 'status', clienteMensagemId: randomUUID() });
    await m.soltar(r.retida!.approvalId);
    const msg = m.t.atendimentoMensagem.find((x) => x.id === r.mensagemId)!;
    await m.entrada.ouvir(ORG, { event: 'messages.update', data: { keyId: 'EVO-OUT-1', status: 'READ' } });
    expect(msg.statusEnvio).toBe('lida');
    await m.entrada.ouvir(ORG, { event: 'messages.update', data: { keyId: 'EVO-OUT-1', status: 'DELIVERY_ACK' } });
    expect(msg.statusEnvio).toBe('lida');
    const h = await m.svc.mensagens(ORG, conversa, undefined);
    expect(h.mensagens.find((x) => x.id === r.mensagemId)?.statusEnvio).toBe('lida');
  });

  it('o eco da própria resposta não vira mensagem "pelo celular"', async () => {
    const r = await m.svc.responder(ORG, LUCAS, conversa, { texto: 'eco', clienteMensagemId: randomUUID() });
    await m.soltar(r.retida!.approvalId);
    expect(await m.entrada.ouvir(ORG, upsert({ key: { id: 'EVO-OUT-1', remoteJid: CLIENTE, fromMe: true }, message: { conversation: 'eco' } }))).toBe('repetida');
    expect(m.t.atendimentoMensagem.filter((x) => x.direcao === 'saida')).toHaveLength(1);
    // Mensagem mandada pelo celular, fora do OS, aparece como tal.
    expect(await m.entrada.ouvir(ORG, upsert({ key: { id: 'CEL1', remoteJid: CLIENTE, fromMe: true }, message: { conversation: 'do celular' } }))).toBe('saida_pelo_celular');
  });

  it('falha de envio vira erro com o motivo, e tentar de novo reaproveita a mesma resposta', async () => {
    const cmid = randomUUID();
    const r = await m.svc.responder(ORG, LUCAS, conversa, { texto: 'vai falhar', clienteMensagemId: cmid });
    m.falhar(true);
    await expect(m.soltar(r.retida!.approvalId)).rejects.toThrow('HTTP 500');
    const msg = m.t.atendimentoMensagem.find((x) => x.id === r.mensagemId)!;
    expect(msg).toMatchObject({ statusEnvio: 'erro', erroEnvio: 'Evolution respondeu HTTP 500.' });
    m.falhar(false);
    const de2 = await m.svc.responder(ORG, LUCAS, conversa, { texto: 'vai falhar', clienteMensagemId: cmid });
    expect(de2.mensagemId).toBe(r.mensagemId);
    expect(msg.statusEnvio).toBe('aguardando_assinatura');
    await m.soltar(de2.retida!.approvalId);
    expect(m.enviados).toHaveLength(1);
  });

  it('o efeito recusa texto diferente do guardado e conversa trocada', async () => {
    const r = await m.svc.responder(ORG, LUCAS, conversa, { texto: 'original', clienteMensagemId: randomUUID() });
    const efeitos = (m.svc as unknown as { efeitos: EfeitosRegistry }).efeitos;
    await expect(efeitos.executar(CAPACIDADE_DE_RESPONDER, { conversaId: conversa, mensagemId: r.mensagemId, texto: 'trocado' }, ORG)).rejects.toThrow('texto assinado');
    await expect(efeitos.executar(CAPACIDADE_DE_RESPONDER, { conversaId: 'outra', mensagemId: r.mensagemId, texto: 'original' }, ORG)).rejects.toThrow('não encontrada');
    await expect(efeitos.executar(CAPACIDADE_DE_RESPONDER, { conversaId: conversa, mensagemId: r.mensagemId, texto: 'original' }, OUTRA)).rejects.toThrow('não encontrada');
    expect(m.enviados).toHaveLength(0);
  });

  it('assinatura recusada ou vencida aparece como "não enviada", com o motivo', async () => {
    const r = await m.svc.responder(ORG, LUCAS, conversa, { texto: 'ninguém assina', clienteMensagemId: randomUUID() });
    m.t.approval.find((a) => a.id === r.retida!.approvalId)!.status = 'rejeitada';
    const h = await m.svc.mensagens(ORG, conversa, undefined);
    const msg = h.mensagens.find((x) => x.id === r.mensagemId)!;
    expect(msg.statusEnvio).toBe('erro');
    expect(msg.erroEnvio).toMatch(/recusada/);
  });

  it('com a caixa desligada não dá para responder', async () => {
    await m.svc.ajustar(ORG, LUCAS, false);
    await expect(m.svc.responder(ORG, LUCAS, conversa, { texto: 'x', clienteMensagemId: randomUUID() })).rejects.toThrow('desligada');
  });
});

describe('atendimento — lidas, responsável, cliente e encerramento', () => {
  let m: ReturnType<typeof montar>;
  let conversa: string;
  beforeEach(async () => {
    m = montar(); await m.ligar();
    await m.entrada.ouvir(ORG, texto('L1', 'um'));
    await m.entrada.ouvir(ORG, texto('L2', 'dois'));
    conversa = String(m.t.atendimentoContato[0].id);
  });

  it('não lidas por conversa e marcar como lida', async () => {
    let l = await m.svc.conversas(ORG, LUCAS, 'todas', undefined, 0);
    expect(l.conversas[0].naoLidas).toBe(2);
    expect(l.totalNaoLidas).toBe(2);
    await m.svc.marcarLida(ORG, conversa);
    l = await m.svc.conversas(ORG, LUCAS, 'todas', undefined, 0);
    expect(l.conversas[0].naoLidas).toBe(0);
  });

  it('responsável e cliente da própria empresa; filtros minhas e sem cliente', async () => {
    await m.svc.editar(ORG, LUCAS, conversa, { responsavelId: PEDRO, clienteId: 'card-cliente' });
    expect((await m.svc.conversas(ORG, PEDRO, 'minhas', undefined, 0)).conversas).toHaveLength(1);
    expect((await m.svc.conversas(ORG, LUCAS, 'minhas', undefined, 0)).conversas).toHaveLength(0);
    expect((await m.svc.conversas(ORG, LUCAS, 'sem_cliente', undefined, 0)).conversas).toHaveLength(0);
    expect((await m.svc.conversas(ORG, LUCAS, 'todas', 'Sintético Ltda', 0)).conversas[0].cliente?.nome).toBe('Cliente Sintético Ltda');
    await expect(m.svc.editar(ORG, LUCAS, conversa, { responsavelId: 'user-de-fora' })).rejects.toThrow('Pessoa não encontrada');
  });

  it('encerrar com a versão vista; mensagem nova do cliente reabre e o encerramento velho é recusado', async () => {
    const c = await m.svc.conversa(ORG, conversa);
    const enc = await m.svc.encerrar(ORG, LUCAS, conversa, c.versao, true);
    expect(enc.encerrada).toBe(true);
    await m.entrada.ouvir(ORG, texto('L3', 'voltei'));
    const reaberta = await m.svc.conversa(ORG, conversa);
    expect(reaberta.encerrada).toBe(false);
    expect(reaberta.versao).toBe(enc.versao + 1);
    await expect(m.svc.encerrar(ORG, LUCAS, conversa, enc.versao, true)).rejects.toThrow('mudou');
    // Mensagem NOSSA não reabre.
    await m.svc.encerrar(ORG, LUCAS, conversa, reaberta.versao, true);
    await m.entrada.ouvir(ORG, upsert({ key: { id: 'CEL2', remoteJid: CLIENTE, fromMe: true }, message: { conversation: 'tchau' } }));
    expect((await m.svc.conversa(ORG, conversa)).encerrada).toBe(true);
  });

  it('mensagens do mesmo segundo ficam na ordem em que chegaram (achado na v2)', async () => {
    const mesmoSegundo = 1_760_000_000;
    for (const [id, t] of [['S1', 'primeira'], ['S2', 'segunda'], ['S3', 'terceira']]) {
      await m.entrada.ouvir(ORG, upsert({ key: { id, remoteJid: CLIENTE }, message: { conversation: t }, messageTimestamp: mesmoSegundo }));
      await new Promise((r) => setTimeout(r, 2));
    }
    const h = await m.svc.mensagens(ORG, conversa, undefined);
    const doSegundo = h.mensagens.filter((x) => ['primeira', 'segunda', 'terceira'].includes(String(x.texto)));
    expect(doSegundo.map((x) => x.texto)).toEqual(['primeira', 'segunda', 'terceira']);
  });

  it('busca de mensagens não atravessa empresa', async () => {
    await m.ligar(OUTRA);
    await m.entrada.ouvir(OUTRA, texto('Z1', 'dois também'));
    const r = await m.svc.buscarMensagens(ORG, 'dois');
    expect(r.resultados.map((x) => x.texto)).toEqual(['dois']);
  });
});

describe('atendimento — mensagem vira tarefa sem duplicar', () => {
  let m: ReturnType<typeof montar>;
  let mensagem: string;
  beforeEach(async () => {
    m = montar(); await m.ligar();
    await m.entrada.ouvir(ORG, texto('T1', 'Preciso da nota fiscal de setembro'));
    mensagem = String(m.t.atendimentoMensagem[0].id);
    await m.svc.editar(ORG, LUCAS, String(m.t.atendimentoContato[0].id), { clienteId: 'card-cliente' });
  });

  it('cria uma tarefa com o cliente da conversa e o trecho da mensagem', async () => {
    const r = await m.svc.virarTarefa(ORG, LUCAS, mensagem, { titulo: 'Enviar NF de setembro', areaId: 'area-ops' });
    expect(r.criada).toBe(true);
    const tarefa = m.t.workTask.find((x) => x.id === r.tarefaId)!;
    expect(tarefa).toMatchObject({ clienteId: 'card-cliente' });
    expect(String(tarefa.description)).toContain('Preciso da nota fiscal de setembro');
    const h = await m.svc.mensagens(ORG, String(m.t.atendimentoContato[0].id), undefined);
    expect(h.mensagens[0].tarefaId).toBe(r.tarefaId);
  });

  it('dois cliques ao mesmo tempo criam UMA tarefa', async () => {
    const [a, b] = await Promise.all([
      m.svc.virarTarefa(ORG, LUCAS, mensagem, { titulo: 'Enviar NF', areaId: 'area-ops' }),
      m.svc.virarTarefa(ORG, PEDRO, mensagem, { titulo: 'Enviar NF', areaId: 'area-ops' }),
    ]);
    expect(m.tarefas.criar).toHaveBeenCalledTimes(1);
    expect(m.tarefasCriadas).toHaveLength(1);
    expect([a.criada, b.criada].sort()).toEqual([false, true]);
    expect(m.t.atendimentoTarefa).toHaveLength(1);
  });

  it('aviso de "não parece tarefa" solta a mensagem para confirmar; confirmando, cria', async () => {
    const r = await m.svc.virarTarefa(ORG, LUCAS, mensagem, { titulo: 'Post 12 do cliente', areaId: 'area-ops' });
    expect(r).toMatchObject({ criada: false, tarefaId: null, aviso: { tipo: 'nao_parece_tarefa' } });
    expect(m.t.atendimentoTarefa).toHaveLength(0);
    const ok = await m.svc.virarTarefa(ORG, LUCAS, mensagem, { titulo: 'Post 12 do cliente', areaId: 'area-ops', confirmar: true });
    expect(ok.criada).toBe(true);
  });

  it('tarefa igual já aberta: liga a mensagem à que existe em vez de criar outra', async () => {
    await m.entrada.ouvir(ORG, texto('T2', 'reforçando a nota'));
    const outra = String(m.t.atendimentoMensagem[1].id);
    const a = await m.svc.virarTarefa(ORG, LUCAS, mensagem, { titulo: 'Enviar NF', areaId: 'area-ops' });
    const b = await m.svc.virarTarefa(ORG, LUCAS, outra, { titulo: 'Enviar NF', areaId: 'area-ops' });
    expect(b.criada).toBe(false);
    expect(b.tarefaId).toBe(a.tarefaId);
    expect(m.tarefasCriadas).toHaveLength(1);
  });

  it('mensagem de outra empresa não vira tarefa aqui', async () => {
    await expect(m.svc.virarTarefa(OUTRA, LUCAS, mensagem, { titulo: 'x', areaId: 'area-ops' })).rejects.toThrow('Mensagem não encontrada');
  });
});
