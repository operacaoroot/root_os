import { BadRequestException, Injectable, NotFoundException, type OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  CABECALHO_DO_SEGREDO_GRANOLA,
  CONECTOR_GRANOLA,
  NOME_DA_SENHA_GRANOLA,
  type ConexaoDoGranola,
  type SenhaDoGranola,
  LISTA_DE_TAREFAS_DO_CLIENTE,
  LISTA_DO_CRM,
  type ReuniaoDoGranola,
  type ReuniaoSemCliente,
  type ResultadoDoGranola,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CofreService, SegredoIndisponivelError } from '../cofre/cofre.service';
import { ConectoresService } from '../integrations/conectores.service';
import { RegistroDeConectores } from '../integrations/conectores.registry';
import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeRevogacao,
  type SaudeDeConector,
  conectado,
  naoConfigurado,
} from '../integrations/contrato-de-conector';

/*
 * GRANOLA → OS. O Zap do Granola entrega cada reunião terminada; aqui ela vira
 * uma reunião da ficha (`ReuniaoDoCartao`, fonte granola) no card do cliente.
 *
 * QUEM É O CLIENTE, nesta ordem:
 *   1. `cardId` no corpo (o Zap pode mandar, se um dia souber);
 *   2. e-mail de um participante igual ao campo E-mail de um card;
 *   3. domínio do e-mail de um participante igual ao domínio do E-mail ou do
 *      Site de um card (domínio de e-mail pessoal e o da própria ROOT não contam);
 *   4. nome: Empresa, Contato ou o começo do título do card aparecendo no título
 *      da reunião ou no nome de um participante (o mais longo ganha).
 * Sem cliente reconhecido, a reunião espera num cartão-caixa ("Reuniões do
 * Granola sem cliente") até alguém vincular na tela de Leads. Nada se perde.
 *
 * A CONEXÃO (19/10/2026) é um conector do catálogo, como os outros:
 *   · aparece em Conexões, com o painel do que chegou;
 *   · LIGA/DESLIGA no interruptor de conector (`ConectorDesligado`, com rastro);
 *   · a SENHA do Zap é por empresa, gerada na tela e guardada cifrada no cofre
 *     (`granola/segredo_do_webhook`). Revogar queima a senha: o Zap para na hora.
 * Sem senha ativa ou com o conector desligado, o endereço do Zap responde 404.
 */

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Domínio que não identifica empresa: e-mail pessoal e a própria casa. */
const DOMINIOS_GENERICOS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com',
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'msn.com', 'proton.me', 'protonmail.com',
  'operacaoroot.com', 'ferpin.com.br', 'fullbpo.com',
]);
const CAIXA = 'granola-sem-cliente';
/** O endereço do Zap, sem a origem (a tela e o guia somam a origem do OS). */
export const caminhoDoGranola = (orgId: string) => `/api/trabalho/granola/${orgId}`;

/** Compara em tempo constante. */
export function senhaConfere(esperada: string, apresentada: string | undefined | null): boolean {
  if (!esperada || typeof apresentada !== 'string' || !apresentada) return false;
  const a = Buffer.from(apresentada.trim(), 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CardParaCasar {
  id: string;
  titulo: string;
  email: string | null;
  site: string | null;
  empresa: string | null;
  contato: string | null;
}

export interface ReuniaoNormalizada {
  titulo: string;
  transcricao: string;
  participantes: string;
  emails: string[];
  link: string | null;
  em: Date;
}

const primeiro = (...vs: (string | null | undefined)[]) => vs.find((v) => typeof v === 'string' && v.trim())?.trim() ?? null;

function lista(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? Object.values(x as Record<string, unknown>).filter((y) => typeof y === 'string').join(' ') : ''))
      .filter(Boolean)
      .join(', ');
  }
  return typeof v === 'string' ? v : '';
}

/** O corpo do Zap, com os nomes do Granola ou os nossos, num formato só. */
export function normalizar(c: ReuniaoDoGranola, agora = new Date()): ReuniaoNormalizada {
  const transcricao = primeiro(c.transcricao, c.transcript) ?? '';
  const notas = primeiro(c.notas, c.my_notes, c.notes, c.summary);
  const participantes = lista(c.participantes ?? c.attendees);
  const quando = primeiro(c.inicio, c.start_time, c.start, c.data, c.date);
  const em = quando && !Number.isNaN(new Date(quando).getTime()) ? new Date(quando) : agora;
  const emails = [...new Set([...(participantes.match(EMAIL) ?? []), ...((primeiro(c.criador, c.creator) ?? '').match(EMAIL) ?? [])].map((e) => e.toLowerCase()))];
  return {
    titulo: (primeiro(c.titulo, c.title) ?? 'Reunião (Granola)').slice(0, 200),
    // As notas digitadas vêm antes da transcrição, quando o Zap manda as duas.
    transcricao: [notas ? `NOTAS\n${notas}` : null, transcricao ? (notas ? `TRANSCRIÇÃO\n${transcricao}` : transcricao) : null].filter(Boolean).join('\n\n'),
    participantes,
    emails,
    link: primeiro(c.link, c.share_link, c.url),
    em,
  };
}

const dominio = (s: string | null) => {
  if (!s) return null;
  const m = /@([a-z0-9.-]+)/i.exec(s) ?? /^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+)/i.exec(s.trim());
  return m ? m[1].toLowerCase() : null;
};

/** Acha o card do cliente da reunião (ver o cabeçalho). Puro: testável sem banco. */
export function casarCliente(r: ReuniaoNormalizada, cards: CardParaCasar[]): { card: CardParaCasar; porque: 'email' | 'dominio' | 'nome' } | null {
  for (const c of cards) {
    if (c.email && r.emails.includes(c.email.toLowerCase().trim())) return { card: c, porque: 'email' };
  }
  const dominios = r.emails.map((e) => e.split('@')[1]).filter((d) => d && !DOMINIOS_GENERICOS.has(d));
  for (const c of cards) {
    const ds = [dominio(c.email), dominio(c.site)].filter((d): d is string => !!d && !DOMINIOS_GENERICOS.has(d));
    if (ds.some((d) => dominios.includes(d))) return { card: c, porque: 'dominio' };
  }
  const onde = semAcento(`${r.titulo} ${r.participantes}`);
  let melhor: { card: CardParaCasar; tam: number } | null = null;
  for (const c of cards) {
    const chaves = [c.empresa, c.contato, c.titulo.split(/[|(]/)[0]].map((x) => (x ? semAcento(x) : '')).filter((x) => x.length >= 4);
    for (const k of chaves) {
      if (onde.includes(k) && (!melhor || k.length > melhor.tam)) melhor = { card: c, tam: k.length };
    }
  }
  return melhor ? { card: melhor.card, porque: 'nome' } : null;
}

@Injectable()
export class GranolaService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cofre: CofreService,
    private readonly conectores: ConectoresService,
    /** `@Optional()` porque a suíte monta à mão; sem registro, o Granola só não aparece no contrato. */
    @Optional() private readonly contrato?: RegistroDeConectores,
  ) {}

  onModuleInit(): void {
    this.contrato?.registrar(this.descritorDoContrato(), 'GranolaService');
  }

  // ------------------------------------------------------------- a conexão

  /**
   * O webhook pode entrar? Senha primeiro (quem não sabe a senha não deixa
   * rastro nenhum), interruptor depois (a recusa de quem sabe fica no RASTRO).
   */
  async podeReceber(orgId: string, apresentada: string | undefined): Promise<boolean> {
    let confere = false;
    try {
      confere = await this.cofre.envolver({ orgId, conector: CONECTOR_GRANOLA, nome: NOME_DA_SENHA_GRANOLA }, (cred) =>
        cred.usar((senha) => senhaConfere(senha, apresentada)),
      );
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) return false;
      throw e;
    }
    if (!confere) return false;
    const recusa = await this.conectores.verificar({ orgId, conector: CONECTOR_GRANOLA });
    return !recusa;
  }

  /** Gera (ou troca) a senha do Zap. A anterior para de valer na hora. */
  async gerarSenha(orgId: string, actorId: string | null): Promise<SenhaDoGranola> {
    const senha = randomBytes(24).toString('base64url');
    await this.cofre.guardar({
      orgId, conector: CONECTOR_GRANOLA, nome: NOME_DA_SENHA_GRANOLA, valor: senha, origem: 'Conexões (senha do Zap)', actorId,
    });
    return { senha, caminho: caminhoDoGranola(orgId), cabecalho: CABECALHO_DO_SEGREDO_GRANOLA };
  }

  private async linhaDaSenha(orgId: string) {
    const { items } = await this.cofre.estado(orgId);
    return items.find((i) => i.conector === CONECTOR_GRANOLA && i.nome === NOME_DA_SENHA_GRANOLA) ?? null;
  }

  /** O painel do Granola em Conexões: estado da ligação e o que chegou. */
  async conexao(orgId: string): Promise<ConexaoDoGranola> {
    const [linha, desligados, caixa] = await Promise.all([
      this.linhaDaSenha(orgId),
      this.conectores.desligados(orgId),
      this.prisma.workTask.findFirst({ where: { orgId, externalId: CAIXA }, select: { id: true } }),
    ]);
    const off = desligados.get(CONECTOR_GRANOLA) ?? null;
    const ativa = !!linha && !linha.revogadoEm;
    // Pelo Zap = fonte granola sem autor (a colada à mão na ficha tem autor).
    const doZap = { orgId, fonte: 'granola', autorId: null };
    const trintaDias = new Date(Date.now() - 30 * 86_400_000);
    const [total, ultimos30Dias, semCliente, ultimas] = await Promise.all([
      this.prisma.reuniaoDoCartao.count({ where: doZap }),
      this.prisma.reuniaoDoCartao.count({ where: { ...doZap, createdAt: { gte: trintaDias } } }),
      caixa ? this.prisma.reuniaoDoCartao.count({ where: { orgId, taskId: caixa.id } }) : Promise.resolve(0),
      this.prisma.reuniaoDoCartao.findMany({
        where: doZap,
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { id: true, titulo: true, em: true, createdAt: true, taskId: true, task: { select: { title: true } } },
      }),
    ]);
    const quando = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
    return {
      caminho: caminhoDoGranola(orgId),
      cabecalho: CABECALHO_DO_SEGREDO_GRANOLA,
      desligado: !!off,
      desligadoEm: quando(off?.desligadoEm),
      motivoDesligado: off?.motivo ?? null,
      senha: {
        ativa,
        desde: ativa ? quando(linha?.atualizadoEm ?? linha?.criadoEm) : null,
        usadaEm: quando(linha?.usadoEm),
        revogadaEm: quando(linha?.revogadoEm),
      },
      recebendo: ativa && !off,
      total,
      ultimos30Dias,
      semCliente,
      ultimas: ultimas.map((r) => {
        const naCaixa = caixa?.id === r.taskId;
        return {
          id: r.id, titulo: r.titulo, em: r.em.toISOString(), recebidaEm: r.createdAt.toISOString(),
          cliente: naCaixa ? null : r.task.title, taskId: naCaixa ? null : r.taskId,
        };
      }),
    };
  }

  /** O Granola no contrato de conectores: é assim que ele aparece em Conexões. */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: CONECTOR_GRANOLA,
      rotulo: 'Granola (reuniões)',
      escopoDaCredencial: 'empresa',
      linhasDoCatalogo: [CONECTOR_GRANOLA],
      autorizar: async () => ({
        tipo: 'manual',
        instrucao:
          'Gere a senha do Zap no painel do Granola, no topo de Conexões, e cole no cabeçalho x-root-segredo do passo Webhooks by Zapier.',
      }),
      sincronizar: async () => ({
        tipo: 'nao_se_aplica',
        motivo: 'O Granola não é consultado pelo OS: o Zap manda cada reunião quando a nota cai na pasta.',
      }),
      saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
        const comecou = Date.now();
        const c = await this.conexao(ctx.orgId);
        if (!c.senha.ativa) return naoConfigurado('Sem senha do Zap. Gere no painel do Granola, em Conexões, e cole no Zap.');
        const ultima = c.ultimas[0]?.recebidaEm;
        const quando = ultima ? new Date(ultima).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
        return conectado(
          Date.now() - comecou,
          `${c.total} reunião(ões) recebida(s)${quando ? ', a última em ' + quando : ', nenhuma ainda'}; ${c.semCliente} esperando cliente.`,
        );
      },
      revogar: async (ctx: ContextoDoVerbo & { motivo?: string | null }): Promise<ResultadoDeRevogacao> => {
        const r = await this.cofre.revogar({
          orgId: ctx.orgId, conector: CONECTOR_GRANOLA, nome: NOME_DA_SENHA_GRANOLA, motivo: ctx.motivo ?? null, por: ctx.actorId ?? null,
        });
        return {
          tipo: 'revogado',
          segredos: r.revogados,
          resumo:
            'A senha do Zap foi queimada: o Zap para de entrar na hora. As reuniões já gravadas ficam. Para voltar, gere outra senha e cole no Zap.',
        };
      },
    };
  }

  // ------------------------------------------------------------- o cliente

  private async cards(orgId: string): Promise<CardParaCasar[]> {
    const ts = await this.prisma.workTask.findMany({
      where: { orgId, archived: false, parentId: null, list: { externalId: LISTA_DO_CRM } },
      select: { id: true, title: true, values: { select: { value: true, field: { select: { name: true } } } } },
    });
    return ts.map((t) => {
      const v = (n: string) => t.values.find((x) => semAcento(x.field.name) === n)?.value ?? null;
      return { id: t.id, titulo: t.title, email: v('e-mail'), site: v('site'), empresa: v('empresa'), contato: v('contato') };
    });
  }

  /** O cartão-caixa das reuniões sem cliente, na lista "Tarefas dos clientes". */
  private async caixa(orgId: string): Promise<string> {
    const ja = await this.prisma.workTask.findFirst({ where: { orgId, externalId: CAIXA }, select: { id: true } });
    if (ja) return ja.id;
    const crm = await this.prisma.workList.findFirst({ where: { orgId, externalId: LISTA_DO_CRM }, select: { folderId: true } });
    const lista =
      (await this.prisma.workList.findFirst({ where: { orgId, externalId: LISTA_DE_TAREFAS_DO_CLIENTE }, include: { statuses: { orderBy: { order: 'asc' } } } })) ??
      (await this.prisma.workList.create({
        data: {
          orgId, folderId: crm?.folderId ?? null, name: 'Tarefas dos clientes', externalId: LISTA_DE_TAREFAS_DO_CLIENTE,
          statuses: { create: [
            { name: 'A fazer', type: 'open', color: '#87909e', order: 0 },
            { name: 'Fazendo', type: 'custom', color: '#4194f6', order: 1 },
            { name: 'Feito', type: 'closed', color: '#008844', order: 2 },
          ] },
        },
        include: { statuses: { orderBy: { order: 'asc' } } },
      }));
    const t = await this.prisma.workTask.create({
      data: {
        orgId, listId: lista.id, statusId: lista.statuses[0].id, externalId: CAIXA,
        title: 'Reuniões do Granola sem cliente',
        description: 'Caixa das reuniões que o Granola mandou e o OS não reconheceu o cliente. Vincule cada uma ao card certo na tela de Leads.',
      },
    });
    return t.id;
  }

  async receber(orgId: string, corpo: ReuniaoDoGranola): Promise<ResultadoDoGranola> {
    const r = normalizar(corpo);
    if (r.transcricao.length < 50) throw new BadRequestException('A reunião chegou sem transcrição (nem notas). Confira o mapeamento do campo Transcript no Zap.');
    const cards = await this.cards(orgId);
    const forcado = corpo.cardId ? cards.find((c) => c.id === corpo.cardId) : undefined;
    const achado = forcado ? { card: forcado, porque: 'card' as const } : casarCliente(r, cards);
    const taskId = achado?.card.id ?? (await this.caixa(orgId));

    // O Zap reenvia quando a chamada falha: o mesmo link (ou título + horário) não entra duas vezes.
    const ja = await this.prisma.reuniaoDoCartao.findFirst({
      where: { orgId, fonte: 'granola', ...(r.link ? { link: r.link } : { titulo: r.titulo, em: r.em }) },
      select: { id: true, taskId: true },
    });
    const nome = (id: string) => cards.find((c) => c.id === id)?.titulo ?? null;
    if (ja) return { ok: true, duplicada: true, cliente: nome(ja.taskId), porque: null };

    const cabecalho = r.participantes ? `Participantes: ${r.participantes}\n\n` : '';
    await this.prisma.reuniaoDoCartao.create({
      data: { orgId, taskId, titulo: r.titulo, em: r.em, fonte: 'granola', link: r.link, transcricao: `${cabecalho}${r.transcricao}`.slice(0, 2_000_000) },
    });
    return { ok: true, duplicada: false, cliente: achado?.card.titulo ?? null, porque: achado?.porque ?? null };
  }

  /** As reuniões que esperam na caixa (tela de Leads). */
  async semCliente(orgId: string): Promise<ReuniaoSemCliente[]> {
    const caixa = await this.prisma.workTask.findFirst({ where: { orgId, externalId: CAIXA }, select: { id: true } });
    if (!caixa) return [];
    const rs = await this.prisma.reuniaoDoCartao.findMany({ where: { orgId, taskId: caixa.id }, orderBy: { em: 'desc' } });
    return rs.map((x) => {
      const p = /^Participantes: (.*)\n/.exec(x.transcricao)?.[1] ?? null;
      const limpo = x.transcricao.replace(/^Participantes: .*\n\n/, '').replace(/\s+/g, ' ').trim();
      return {
        id: x.id, titulo: x.titulo, em: x.em.toISOString(), fonte: 'granola', link: x.link,
        caracteres: x.transcricao.length, trecho: limpo.length > 280 ? `${limpo.slice(0, 280)}…` : limpo,
        autorNome: null, createdAt: x.createdAt.toISOString(), participantes: p,
      };
    });
  }

  /** Passa a reunião para o card escolhido (da caixa, ou de um card errado). */
  async vincular(orgId: string, reuniaoId: string, taskId: string): Promise<{ ok: true }> {
    const card = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId }, select: { id: true } });
    if (!card) throw new NotFoundException('Card não encontrado');
    const r = await this.prisma.reuniaoDoCartao.updateMany({ where: { id: reuniaoId, orgId }, data: { taskId } });
    if (!r.count) throw new NotFoundException('Reunião não encontrada');
    return { ok: true };
  }
}
