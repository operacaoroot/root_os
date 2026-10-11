import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  TotemCampanhaCriarSchema,
  TotemCampanhaEditarSchema,
  TotemClienteLocalizarSchema,
  TotemClientesFiltroSchema,
  TotemCodigoCupomSchema,
  TotemCupomBaixaSchema,
  TotemRevogarSchema,
  totemDetalheDoBeneficio,
  totemMascararCelular,
  totemProblemaDaCampanha,
  totemStatusEfetivoDoCupom,
  totemTextoDoBeneficio,
  type TotemAnonimizacaoEmLote,
  type TotemCampanhaResumo,
  type TotemClienteDetalhe,
  type TotemClienteLinha,
  type TotemClientePagina,
  type TotemCupomDetalhe,
  type TotemCupomLinha,
  type TotemLojaDoEscopo,
  type TotemLojaRef,
  type TotemTipoBeneficio,
} from '@mktos/shared';

import type { JwtUser } from '../../auth/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { escopoDeLojas, exigirLojaNoEscopo, type TotemEscopoDeLojas } from '../comum/escopo';
import { beneficioDa } from './cadastrar';
import { anonimizarCliente, anonimizarInativos, revogarCampanhas } from './clientes';
import { hashDoCpf, lerPepper } from './cpf';
import {
  MENSAGEM_CUPOM_NAO_ENCONTRADO,
  campanhaGerenciavel,
  campanhaVisivel,
  cancelarCupom,
  darBaixaNoCupom,
} from './cupons';

/*
 * O PAINEL DO CADASTRO: campanhas (`totem.campanhas`), clientes e
 * consentimentos (`totem.clientes`) e cupons no caixa (`totem.cupons`).
 *
 * Escopo de lojas em tudo (CONTRATO.md, seção 4). O cliente pertence à loja
 * em que se cadastrou (`lojaOrigemId`); a campanha, às lojas da lista dela.
 * Fora do escopo a resposta é 404, igual a "não existe".
 *
 * O painel nunca devolve CPF nem celular inteiros: o CPF não existe no banco,
 * e o celular sai mascarado.
 */

const MENSAGEM_CLIENTE_NAO_ENCONTRADO = 'Não encontramos este cliente.';
const MENSAGEM_CAMPANHA_NAO_ENCONTRADA = 'Não encontramos esta campanha.';

type CampanhaDoBanco = Prisma.TotemCampanhaGetPayload<object>;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function vigente(c: CampanhaDoBanco, agora: Date): boolean {
  return c.ativa && c.inicioEm <= agora && (!c.fimEm || c.fimEm > agora);
}

@Injectable()
export class TotemCampanhasService {
  private readonly log = new Logger('TotemCampanhas');

  constructor(private readonly prisma: PrismaService) {}

  // --- Lojas ---

  async lojas(user: JwtUser): Promise<TotemLojaDoEscopo[]> {
    const escopo = await escopoDeLojas(this.prisma, user);
    return this.prisma.totemLoja.findMany({
      where: { orgId: user.orgId, ...(escopo === 'todas' ? {} : { id: { in: escopo } }) },
      select: { id: true, codigo: true, nome: true, ativa: true },
      orderBy: [{ codigo: 'asc' }],
    });
  }

  private async nomesDasLojas(orgId: string, ids: Array<string | null | undefined>): Promise<Map<string, TotemLojaRef>> {
    const unicos = [...new Set(ids.filter((i): i is string => !!i))];
    if (unicos.length === 0) return new Map();
    const lojas = await this.prisma.totemLoja.findMany({
      where: { orgId, id: { in: unicos } },
      select: { id: true, nome: true },
    });
    return new Map(lojas.map((l) => [l.id, l]));
  }

  // --- Campanhas ---

  private async resumos(orgId: string, campanhas: CampanhaDoBanco[]): Promise<TotemCampanhaResumo[]> {
    const ids = campanhas.map((c) => c.id);
    const contagem = ids.length
      ? await this.prisma.totemCupom.groupBy({
          by: ['campanhaId', 'status'],
          where: { orgId, campanhaId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const agora = new Date();
    return campanhas.map((c) => {
      const daCampanha = contagem.filter((g) => g.campanhaId === c.id);
      const b = beneficioDa(c);
      return {
        id: c.id,
        nome: c.nome,
        chamada: c.chamada,
        tipoBeneficio: c.tipoBeneficio as TotemTipoBeneficio,
        valorBeneficio: b.valorBeneficio,
        descricaoBeneficio: c.descricaoBeneficio,
        beneficio: totemTextoDoBeneficio(b),
        validadeDias: c.validadeDias,
        inicioEm: c.inicioEm.toISOString(),
        fimEm: iso(c.fimEm),
        ativa: c.ativa,
        vigente: vigente(c, agora),
        lojaIds: c.lojaIds,
        cupons: {
          emitidos: daCampanha.reduce((s, g) => s + g._count._all, 0),
          usados: daCampanha.filter((g) => g.status === 'usado').reduce((s, g) => s + g._count._all, 0),
        },
      };
    });
  }

  async listarCampanhas(user: JwtUser): Promise<TotemCampanhaResumo[]> {
    const escopo = await escopoDeLojas(this.prisma, user);
    const campanhas = await this.prisma.totemCampanha.findMany({
      where: {
        orgId: user.orgId,
        ...(escopo === 'todas' ? {} : { OR: [{ lojaIds: { isEmpty: true } }, { lojaIds: { hasSome: escopo } }] }),
      },
      orderBy: [{ ativa: 'desc' }, { inicioEm: 'desc' }],
    });
    return this.resumos(user.orgId, campanhas);
  }

  /**
   * Lista vazia é "todas as lojas", e só quem tem a rede inteira escolhe isso.
   * Loja de fora do escopo ou de outra empresa responde 404.
   */
  private async conferirLojasDaCampanha(user: JwtUser, escopo: TotemEscopoDeLojas, lojaIds: string[]): Promise<string[]> {
    const unicas = [...new Set(lojaIds)];
    if (unicas.length === 0) {
      if (escopo !== 'todas') {
        throw new BadRequestException('Escolha as lojas da campanha. Só quem cuida da rede inteira cria campanha para todas.');
      }
      return unicas;
    }
    for (const id of unicas) await exigirLojaNoEscopo(this.prisma, user, id);
    return unicas;
  }

  private async campanhaParaMexer(user: JwtUser, id: string): Promise<{ campanha: CampanhaDoBanco; escopo: TotemEscopoDeLojas }> {
    const escopo = await escopoDeLojas(this.prisma, user);
    const campanha = await this.prisma.totemCampanha.findFirst({ where: { id, orgId: user.orgId } });
    if (!campanha || !campanhaVisivel(escopo, campanha.lojaIds)) throw new NotFoundException(MENSAGEM_CAMPANHA_NAO_ENCONTRADA);
    if (!campanhaGerenciavel(escopo, campanha.lojaIds)) {
      throw new NotFoundException(MENSAGEM_CAMPANHA_NAO_ENCONTRADA);
    }
    return { campanha, escopo };
  }

  async criarCampanha(user: JwtUser, corpo: unknown): Promise<TotemCampanhaResumo> {
    const c = TotemCampanhaCriarSchema.parse(corpo);
    const escopo = await escopoDeLojas(this.prisma, user);
    const lojaIds = await this.conferirLojasDaCampanha(user, escopo, c.lojaIds ?? []);
    const criada = await this.prisma.totemCampanha.create({
      data: {
        orgId: user.orgId,
        nome: c.nome,
        chamada: c.chamada,
        tipoBeneficio: c.tipoBeneficio,
        valorBeneficio: c.tipoBeneficio === 'brinde' ? null : (c.valorBeneficio ?? null),
        descricaoBeneficio: c.descricaoBeneficio || null,
        validadeDias: c.validadeDias,
        ...(c.inicioEm ? { inicioEm: new Date(c.inicioEm) } : {}),
        fimEm: c.fimEm ? new Date(c.fimEm) : null,
        ativa: c.ativa ?? true,
        lojaIds,
      },
    });
    const [resumo] = await this.resumos(user.orgId, [criada]);
    return resumo!;
  }

  async editarCampanha(user: JwtUser, id: string, corpo: unknown): Promise<TotemCampanhaResumo> {
    const c = TotemCampanhaEditarSchema.parse(corpo);
    const { campanha, escopo } = await this.campanhaParaMexer(user, id);

    const tipoBeneficio = c.tipoBeneficio ?? campanha.tipoBeneficio;
    const valorBeneficio = c.valorBeneficio !== undefined ? c.valorBeneficio : beneficioDa(campanha).valorBeneficio;
    const descricaoBeneficio = c.descricaoBeneficio !== undefined ? c.descricaoBeneficio : campanha.descricaoBeneficio;
    const inicioEm = c.inicioEm ? new Date(c.inicioEm) : campanha.inicioEm;
    const fimEm = c.fimEm !== undefined ? (c.fimEm ? new Date(c.fimEm) : null) : campanha.fimEm;
    const problema = totemProblemaDaCampanha({ tipoBeneficio, valorBeneficio, descricaoBeneficio, inicioEm, fimEm });
    if (problema) throw new BadRequestException(problema);

    const mudaBeneficio =
      tipoBeneficio !== campanha.tipoBeneficio ||
      (tipoBeneficio !== 'brinde' && (valorBeneficio ?? null) !== beneficioDa(campanha).valorBeneficio) ||
      (tipoBeneficio === 'brinde' && (descricaoBeneficio ?? null) !== campanha.descricaoBeneficio);
    if (mudaBeneficio) {
      const cupons = await this.prisma.totemCupom.count({ where: { orgId: user.orgId, campanhaId: id } });
      if (cupons > 0) {
        throw new ConflictException(
          'Esta campanha já emitiu cupons, e o benefício deles não pode mudar. Encerre esta campanha e crie outra.',
        );
      }
    }

    const lojaIds = c.lojaIds !== undefined ? await this.conferirLojasDaCampanha(user, escopo, c.lojaIds) : undefined;
    const atualizada = await this.prisma.totemCampanha.update({
      where: { id },
      data: {
        ...(c.nome !== undefined ? { nome: c.nome } : {}),
        ...(c.chamada !== undefined ? { chamada: c.chamada } : {}),
        tipoBeneficio,
        valorBeneficio: tipoBeneficio === 'brinde' ? null : (valorBeneficio ?? null),
        descricaoBeneficio: descricaoBeneficio || null,
        ...(c.validadeDias !== undefined ? { validadeDias: c.validadeDias } : {}),
        inicioEm,
        fimEm,
        ...(c.ativa !== undefined ? { ativa: c.ativa } : {}),
        ...(lojaIds !== undefined ? { lojaIds } : {}),
      },
    });
    const [resumo] = await this.resumos(user.orgId, [atualizada]);
    return resumo!;
  }

  async apagarCampanha(user: JwtUser, id: string): Promise<{ ok: true }> {
    await this.campanhaParaMexer(user, id);
    const cupons = await this.prisma.totemCupom.count({ where: { orgId: user.orgId, campanhaId: id } });
    if (cupons > 0) {
      throw new ConflictException('Esta campanha já emitiu cupons e não pode ser apagada. Desative-a para parar de emitir.');
    }
    await this.prisma.totemCampanha.deleteMany({ where: { id, orgId: user.orgId } });
    return { ok: true };
  }

  // --- Clientes ---

  private filtroDoEscopo(escopo: TotemEscopoDeLojas): Prisma.TotemClienteWhereInput {
    return escopo === 'todas' ? {} : { lojaOrigemId: { in: escopo } };
  }

  private linha(
    c: Prisma.TotemClienteGetPayload<{ include: { _count: { select: { cupons: true } } } }>,
    lojas: Map<string, TotemLojaRef>,
  ): TotemClienteLinha {
    return {
      id: c.id,
      cpfMascarado: c.cpfMascarado,
      telefoneMascarado: c.telefone ? totemMascararCelular(c.telefone) : null,
      lojaOrigem: (c.lojaOrigemId && lojas.get(c.lojaOrigemId)) || null,
      canalOrigem: c.canalOrigem,
      aceitaCampanhas: c.aceitaCampanhas,
      anonimizado: !!c.anonimizadoEm,
      criadoEm: c.criadoEm.toISOString(),
      totalDeCupons: c._count.cupons,
    };
  }

  async listarClientes(user: JwtUser, query: unknown): Promise<TotemClientePagina> {
    const f = TotemClientesFiltroSchema.parse(query);
    const escopo = await escopoDeLojas(this.prisma, user);
    if (f.lojaId) await exigirLojaNoEscopo(this.prisma, user, f.lojaId);
    const where: Prisma.TotemClienteWhereInput = {
      orgId: user.orgId,
      AND: [this.filtroDoEscopo(escopo), f.lojaId ? { lojaOrigemId: f.lojaId } : {}],
    };
    const [total, clientes] = await Promise.all([
      this.prisma.totemCliente.count({ where }),
      this.prisma.totemCliente.findMany({
        where,
        include: { _count: { select: { cupons: true } } },
        orderBy: [{ criadoEm: 'desc' }, { id: 'asc' }],
        skip: (f.pagina - 1) * f.porPagina,
        take: f.porPagina,
      }),
    ]);
    const lojas = await this.nomesDasLojas(user.orgId, clientes.map((c) => c.lojaOrigemId));
    return { itens: clientes.map((c) => this.linha(c, lojas)), total, pagina: f.pagina, porPagina: f.porPagina };
  }

  private async clienteNoEscopo(user: JwtUser, where: Prisma.TotemClienteWhereInput): Promise<string> {
    const escopo = await escopoDeLojas(this.prisma, user);
    const c = await this.prisma.totemCliente.findFirst({
      where: { AND: [{ orgId: user.orgId }, where, this.filtroDoEscopo(escopo)] },
      select: { id: true },
    });
    if (!c) throw new NotFoundException(MENSAGEM_CLIENTE_NAO_ENCONTRADO);
    return c.id;
  }

  async detalheCliente(user: JwtUser, id: string): Promise<TotemClienteDetalhe> {
    await this.clienteNoEscopo(user, { id });
    const c = await this.prisma.totemCliente.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        _count: { select: { cupons: true } },
        consentimentos: { orderBy: [{ aceitoEm: 'desc' }, { criadoEm: 'desc' }] },
        cupons: { include: { campanha: true }, orderBy: { emitidoEm: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException(MENSAGEM_CLIENTE_NAO_ENCONTRADO);
    const lojas = await this.nomesDasLojas(user.orgId, [
      c.lojaOrigemId,
      ...c.consentimentos.map((x) => x.lojaId),
      ...c.cupons.map((x) => x.usadoLojaId),
    ]);
    const agora = new Date();
    return {
      ...this.linha(c, lojas),
      nome: c.nome,
      anonimizadoEm: iso(c.anonimizadoEm),
      consentimentos: c.consentimentos.map((x) => ({
        id: x.id,
        politicaVersao: x.politicaVersao,
        finalidades: x.finalidades,
        canal: x.canal,
        loja: (x.lojaId && lojas.get(x.lojaId)) || null,
        aceitoEm: x.aceitoEm.toISOString(),
        revogadoEm: iso(x.revogadoEm),
      })),
      cupons: c.cupons.map((x) => this.linhaDoCupom(x, lojas, agora)),
    };
  }

  async localizarCliente(user: JwtUser, corpo: unknown): Promise<TotemClienteDetalhe> {
    const pepper = lerPepper();
    if (!pepper) {
      this.log.error('busca por CPF recusada: TOTEM_CPF_PEPPER ausente ou com menos de 32 caracteres');
      throw new ServiceUnavailableException('A busca por CPF está fora do ar. Fale com o suporte da Root.');
    }
    const { cpf } = TotemClienteLocalizarSchema.parse(corpo);
    const id = await this.clienteNoEscopo(user, { cpfHash: hashDoCpf(pepper, cpf) });
    return this.detalheCliente(user, id);
  }

  async revogar(user: JwtUser, id: string, corpo: unknown): Promise<TotemClienteDetalhe> {
    const { alcance } = TotemRevogarSchema.parse(corpo);
    await this.clienteNoEscopo(user, { id });
    await this.prisma.$transaction(async (tx) => {
      if (alcance === 'tudo') await anonimizarCliente(tx, user.orgId, id);
      else await revogarCampanhas(tx, user.orgId, id);
    });
    return this.detalheCliente(user, id);
  }

  async anonimizar(user: JwtUser, id: string): Promise<TotemClienteDetalhe> {
    await this.clienteNoEscopo(user, { id });
    await this.prisma.$transaction((tx) => anonimizarCliente(tx, user.orgId, id));
    return this.detalheCliente(user, id);
  }

  async anonimizarInativos(user: JwtUser): Promise<TotemAnonimizacaoEmLote> {
    const r = await this.prisma.$transaction((tx) => anonimizarInativos(tx, user.orgId), { timeout: 60_000 });
    return { anonimizados: r.anonimizados, limite: r.limite.toISOString() };
  }

  // --- Cupons ---

  private linhaDoCupom(
    x: Prisma.TotemCupomGetPayload<{ include: { campanha: true } }>,
    lojas: Map<string, TotemLojaRef>,
    agora: Date,
  ): TotemCupomLinha {
    return {
      codigo: x.codigo,
      status: totemStatusEfetivoDoCupom(x.status, x.validoAte, agora),
      campanha: x.campanha.nome,
      beneficio: totemTextoDoBeneficio(beneficioDa(x.campanha)),
      emitidoEm: x.emitidoEm.toISOString(),
      validoAte: x.validoAte.toISOString(),
      usadoEm: iso(x.usadoEm),
      usadoLoja: (x.usadoLojaId && lojas.get(x.usadoLojaId)) || null,
    };
  }

  private codigoDoCupom(codigo: string): string {
    const r = TotemCodigoCupomSchema.safeParse(codigo);
    if (!r.success) throw new BadRequestException('O código do cupom tem 8 letras ou números.');
    return r.data;
  }

  async consultarCupom(user: JwtUser, codigoBruto: string): Promise<TotemCupomDetalhe> {
    const codigo = this.codigoDoCupom(codigoBruto);
    const escopo = await escopoDeLojas(this.prisma, user);
    const x = await this.prisma.totemCupom.findUnique({
      where: { orgId_codigo: { orgId: user.orgId, codigo } },
      include: { campanha: true },
    });
    if (!x || !campanhaVisivel(escopo, x.campanha.lojaIds)) throw new NotFoundException(MENSAGEM_CUPOM_NAO_ENCONTRADO);
    const lojas = await this.nomesDasLojas(user.orgId, [x.usadoLojaId, ...x.campanha.lojaIds]);
    const b = beneficioDa(x.campanha);
    return {
      ...this.linhaDoCupom(x, lojas, new Date()),
      chamada: x.campanha.chamada,
      detalhe: totemDetalheDoBeneficio(b),
      lojasValidas:
        x.campanha.lojaIds.length === 0
          ? 'todas'
          : x.campanha.lojaIds.map((id) => lojas.get(id)).filter((l): l is TotemLojaRef => !!l),
    };
  }

  async darBaixa(user: JwtUser, codigoBruto: string, corpo: unknown): Promise<TotemCupomDetalhe> {
    const codigo = this.codigoDoCupom(codigoBruto);
    const { lojaId } = TotemCupomBaixaSchema.parse(corpo);
    await exigirLojaNoEscopo(this.prisma, user, lojaId);
    const escopo = await escopoDeLojas(this.prisma, user);
    await darBaixaNoCupom(this.prisma, { orgId: user.orgId, codigo, lojaId, usuarioId: user.sub, escopo });
    return this.consultarCupom(user, codigo);
  }

  async cancelar(user: JwtUser, codigoBruto: string): Promise<TotemCupomDetalhe> {
    const codigo = this.codigoDoCupom(codigoBruto);
    const escopo = await escopoDeLojas(this.prisma, user);
    await cancelarCupom(this.prisma, { orgId: user.orgId, codigo, escopo });
    return this.consultarCupom(user, codigo);
  }
}
