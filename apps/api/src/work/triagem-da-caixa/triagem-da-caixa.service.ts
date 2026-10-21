import { Inject, Injectable, Logger } from '@nestjs/common';
import { funcaoPorId, type OpcaoDaPendencia, type Pendencia, type PendenciaNaCaixa, type PendenciasDaCaixa } from '@mktos/shared';

import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { garantirRotinaDaCobranca } from '../cobranca/cobranca';
import {
  CacheDaTriagem,
  LOTE_DA_TRIAGEM,
  agrupar,
  chaveDaReferencia,
  clienteExplicito,
  hashDoItem,
  interpretarTriagem,
  promptDaTriagem,
  urgenciaDaPendencia,
  type PendenciaParaTriar,
  type ReferenciasDaTriagem,
} from './triagem';

const TETO_DA_LISTA = 200;
const TIPOS_DE_TAREFA = ['work_task', 'tarefa'];
const TIPOS_DE_CLIENTE = ['partner', 'cliente'];

/**
 * TR-08 · A TRIAGEM DA CAIXA (rodada dos agentes, 21/10/2026). Ver `triagem.ts`.
 *
 * A caixa continua sem fonte própria: a lista é a MESMA de `GET /pendencias`
 * (abertas, as da pessoa e as sem destinatário, até 200), lida da tabela
 * `Pendencia` como a caixa lê a `ComercialDecisao`. Esta classe só acrescenta a
 * urgência (regra), o cliente (explícito ou agrupado pelo modelo) e os grupos.
 *
 * O CACHE (por item, em memória do processo) vive aqui: uma instância por
 * container da API.
 */
@Injectable()
export class TriagemDaCaixaService {
  private readonly log = new Logger('TriagemDaCaixa');
  private readonly cache = new CacheDaTriagem();
  /** As empresas em que a rotina do cobrador já foi garantida neste processo. */
  private readonly comRotina = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async daCaixa(orgId: string, usuarioId: string, agora = new Date()): Promise<PendenciasDaCaixa> {
    await this.garantirRotina(orgId);
    const linhas = await this.prisma.pendencia.findMany({
      where: { orgId, estado: 'aberta', OR: [{ paraUsuarioId: usuarioId }, { paraUsuarioId: null }] },
      orderBy: { criadaEm: 'desc' },
      take: TETO_DA_LISTA,
    });
    const refs = await this.referencias(orgId, linhas);

    const base = linhas.map((l) => {
      const p: PendenciaParaTriar = {
        id: l.id, funcao: l.funcao, tipo: l.tipo, titulo: l.titulo, contexto: l.contexto, refTipo: l.refTipo, refId: l.refId, dados: l.dados,
      };
      return { linha: l, p, explicito: clienteExplicito(p, refs), ...urgenciaDaPendencia(p, refs, agora) };
    });

    // O modelo só para o que não tem cliente explícito, e só o que o cache ainda não sabe.
    const semCliente = base.filter((b) => !b.explicito);
    const paraPerguntar = semCliente.filter((b) => !this.cache.tem(hashDoItem(orgId, b.p)));
    const doCache = semCliente.length - paraPerguntar.length;
    let usouModelo = false;
    let caiuNaRegra = false;
    if (paraPerguntar.length) {
      if (!this.llm.configured) caiuNaRegra = true;
      else {
        for (let i = 0; i < paraPerguntar.length; i += LOTE_DA_TRIAGEM) {
          const lote = paraPerguntar.slice(i, i + LOTE_DA_TRIAGEM).map((b) => ({ id: b.p.id, titulo: b.p.titulo, contexto: b.p.contexto }));
          try {
            const { system, user } = promptDaTriagem(lote);
            const saida = await this.llm.step({ funcao: 'TR-08', system, turns: [{ role: 'user', text: user }], orgId, maxTokens: 2000 });
            const lidos = interpretarTriagem(saida.text, lote);
            for (const b of paraPerguntar.slice(i, i + LOTE_DA_TRIAGEM)) this.cache.gravar(hashDoItem(orgId, b.p), lidos.get(b.p.id) ?? null);
            usouModelo = true;
          } catch (e) {
            caiuNaRegra = true;
            this.log.warn(`empresa ${orgId}: a triagem caiu na regra para ${lote.length} item(ns) (${(e as Error).message})`);
          }
        }
      }
    }

    const itens: PendenciaNaCaixa[] = base.map((b) => {
      const chave = hashDoItem(orgId, b.p);
      const doModelo = !b.explicito && this.cache.tem(chave) ? this.cache.ler(chave) : null;
      const cliente = b.explicito ?? doModelo;
      return {
        ...paraPendencia(b.linha),
        funcaoNome: funcaoPorId(b.linha.funcao)?.nome ?? null,
        urgencia: b.urgencia,
        motivoDaUrgencia: b.motivo,
        cliente,
        clienteDe: b.explicito ? 'explicito' : doModelo ? 'modelo' : 'nenhum',
      };
    });
    return {
      total: itens.length,
      grupos: agrupar(itens),
      triagem: !semCliente.length ? 'nada' : caiuNaRegra && !usouModelo && !doCache ? 'regra' : 'modelo',
      doCache,
    };
  }

  /** O cliente, o prazo e o vencimento que as referências dizem, só desta empresa. */
  private async referencias(
    orgId: string,
    linhas: readonly { refTipo: string | null; refId: string | null }[],
  ): Promise<ReferenciasDaTriagem> {
    const ids = (tipos: string[]) => [...new Set(linhas.filter((l) => l.refTipo && tipos.includes(l.refTipo) && l.refId).map((l) => l.refId!))];
    const [tarefas, parceiros, leads, aprovacoes] = await Promise.all([
      ids(TIPOS_DE_TAREFA).length
        ? this.prisma.workTask.findMany({
            where: { orgId, id: { in: ids(TIPOS_DE_TAREFA) } },
            select: { id: true, dueDate: true, cliente: { select: { razaoSocial: true, nomeFantasia: true, interno: true } } },
          })
        : Promise.resolve([]),
      ids(TIPOS_DE_CLIENTE).length
        ? this.prisma.partner.findMany({ where: { orgId, id: { in: ids(TIPOS_DE_CLIENTE) } }, select: { id: true, razaoSocial: true, nomeFantasia: true } })
        : Promise.resolve([]),
      ids(['lead']).length ? this.prisma.lead.findMany({ where: { orgId, id: { in: ids(['lead']) } }, select: { id: true, name: true } }) : Promise.resolve([]),
      ids(['approval']).length
        ? this.prisma.approval.findMany({ where: { orgId, id: { in: ids(['approval']) } }, select: { id: true, expiraEm: true } })
        : Promise.resolve([]),
    ]);
    const clientes = new Map<string, string>();
    const prazos = new Map<string, Date>();
    for (const t of tarefas) {
      for (const tipo of TIPOS_DE_TAREFA) {
        if (t.cliente && !t.cliente.interno) clientes.set(`${tipo}:${t.id}`, t.cliente.nomeFantasia || t.cliente.razaoSocial);
        if (t.dueDate) prazos.set(`${tipo}:${t.id}`, t.dueDate);
      }
    }
    for (const p of parceiros) for (const tipo of TIPOS_DE_CLIENTE) clientes.set(`${tipo}:${p.id}`, p.nomeFantasia || p.razaoSocial);
    for (const l of leads) clientes.set(chaveDaReferencia('lead', l.id)!, l.name);
    return { clientes, prazos, aprovacoes: new Map(aprovacoes.map((a) => [a.id, a.expiraEm])) };
  }

  /** TR-07: a rotina do cobrador existe (desligada) para quem abre a caixa. Uma vez por processo e empresa. */
  private async garantirRotina(orgId: string): Promise<void> {
    if (this.comRotina.has(orgId)) return;
    this.comRotina.add(orgId);
    try {
      await garantirRotinaDaCobranca(this.prisma, orgId);
    } catch (e) {
      this.comRotina.delete(orgId);
      this.log.warn(`empresa ${orgId}: a rotina do cobrador não foi garantida (${(e as Error).message})`);
    }
  }
}

function paraPendencia(l: {
  id: string; funcao: string; tipo: string; titulo: string; contexto: string; opcoes: unknown; paraUsuarioId: string | null;
  refTipo: string | null; refId: string | null; estado: string; escolha: string | null; decididaPor: string | null;
  decididaEm: Date | null; criadaEm: Date;
}): Pendencia {
  return {
    id: l.id,
    funcao: l.funcao,
    tipo: l.tipo,
    titulo: l.titulo,
    contexto: l.contexto,
    opcoes: (Array.isArray(l.opcoes) ? l.opcoes : []) as unknown as OpcaoDaPendencia[],
    paraUsuarioId: l.paraUsuarioId,
    refTipo: l.refTipo,
    refId: l.refId,
    estado: l.estado as Pendencia['estado'],
    escolha: l.escolha,
    decididaPor: l.decididaPor,
    decididaEm: l.decididaEm?.toISOString() ?? null,
    criadaEm: l.criadaEm.toISOString(),
  };
}
