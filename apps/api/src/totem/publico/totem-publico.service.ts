import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { TotemAtivacao, TotemCatalogo, TotemEventoQuiosque } from '@mktos/shared';

import { comTenantPublico, resolverTenantDaAtivacao, resolverTenantDoTotem } from '../../common/tenant-publico';
import { PrismaService } from '../../prisma/prisma.service';
import { exigirModuloTotem, totemNaoEncontrado } from '../comum/modulo';
import { gerarToken, hashToken } from '../comum/segredos';
import { LoteVigenteService } from '../lote/lote-vigente.service';
import { montarCatalogo } from './catalogo';
import { linhasDeEventos } from './eventos';

/** A frase do 401: o quiosque apaga o token e volta para a tela de ativação. */
export const TOTEM_REATIVAR = 'Este totem precisa ser ativado de novo.';

const USER_AGENT_MAXIMO = 300;

export interface AparelhoResolvido {
  dispositivoId: string;
  orgId: string;
  lojaId: string;
}

/*
 * As quatro rotas do quiosque. Cada uma resolve a empresa pelo hash (sob a
 * sentinela, em `common/tenant-publico.ts`) e faz o resto dentro de
 * `comTenantPublico`, com `exigirModuloTotem` como primeira consulta.
 *
 * Na ativação, código inexistente, vencido, já usado, de aparelho revogado,
 * de loja desativada ou de empresa sem o módulo respondem a MESMA 404: quem
 * sonda códigos não aprende nada com a diferença.
 */
@Injectable()
export class TotemPublicoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lotes: LoteVigenteService,
  ) {}

  async ativar(codigo: string, userAgent: string | undefined): Promise<TotemAtivacao> {
    const codigoHash = hashToken(codigo);
    const r = await resolverTenantDaAtivacao(this.prisma, codigoHash);
    const agora = new Date();
    if (!r || r.revogadoEm || !r.ativacaoExpiraEm || r.ativacaoExpiraEm.getTime() <= agora.getTime()) {
      throw totemNaoEncontrado();
    }
    return comTenantPublico(r.orgId, async () => {
      await exigirModuloTotem(this.prisma, r.orgId);
      const loja = await this.prisma.totemLoja.findFirst({
        where: { id: r.lojaId, orgId: r.orgId, ativa: true },
        select: { id: true, nome: true },
      });
      const aparelho = await this.prisma.totemDispositivo.findFirst({
        where: { id: r.dispositivoId, orgId: r.orgId },
        select: { id: true, nome: true },
      });
      if (!loja || !aparelho) throw totemNaoEncontrado();

      const token = gerarToken();
      // O filtro repete o código e o prazo: de dois pedidos com o mesmo código
      // ao mesmo tempo, só um troca a linha, e o outro cai na 404.
      const trocou = await this.prisma.totemDispositivo.updateMany({
        where: {
          id: r.dispositivoId,
          orgId: r.orgId,
          codigoAtivacaoHash: codigoHash,
          revogadoEm: null,
          ativacaoExpiraEm: { gt: agora },
        },
        data: {
          tokenHash: hashToken(token),
          codigoAtivacaoHash: null,
          ativacaoExpiraEm: null,
          ativadoEm: agora,
          vistoEm: agora,
          catalogoVersao: null,
          userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAXIMO) : null,
        },
      });
      if (trocou.count !== 1) throw totemNaoEncontrado();
      return { token, dispositivo: { id: aparelho.id, nome: aparelho.nome }, loja };
    });
  }

  /** Token sem aparelho ou de aparelho revogado: 401, e o quiosque volta à ativação. */
  async aparelhoDoToken(token: string): Promise<AparelhoResolvido> {
    const r = await resolverTenantDoTotem(this.prisma, hashToken(token));
    if (!r || r.revogadoEm) throw new UnauthorizedException(TOTEM_REATIVAR);
    return { dispositivoId: r.dispositivoId, orgId: r.orgId, lojaId: r.lojaId };
  }

  async catalogo(a: AparelhoResolvido, agora = new Date()): Promise<TotemCatalogo> {
    return comTenantPublico(a.orgId, async () => {
      await exigirModuloTotem(this.prisma, a.orgId);
      const loja = await this.prisma.totemLoja.findFirst({
        where: { id: a.lojaId, orgId: a.orgId },
        select: { id: true, nome: true, cidade: true, ativa: true },
      });
      const aparelho = await this.prisma.totemDispositivo.findFirst({
        where: { id: a.dispositivoId, orgId: a.orgId },
        select: { id: true, nome: true },
      });
      if (!loja || !loja.ativa || !aparelho) throw totemNaoEncontrado();

      const config = await this.prisma.totemConfig.findUnique({
        where: { orgId: a.orgId },
        select: {
          nomeExibicao: true,
          corPrimaria: true,
          corFundo: true,
          logoUrl: true,
          mensagemBoasVindas: true,
          tempoOciosoSeg: true,
          precoLigado: true,
          cadastroLigado: true,
        },
      });
      const produtos = await this.prisma.totemProduto.findMany({
        where: { orgId: a.orgId, ativo: true },
        select: {
          id: true,
          codigo: true,
          nome: true,
          nomeBusca: true,
          categoria: true,
          composicao: true,
          beneficios: true,
          alergenicos: true,
          porcaoG: true,
          porcaoDescricao: true,
          nutricional: true,
          selos: true,
          imagemUrl: true,
          fonteNutricional: true,
          precoCentavos: true,
          unidadePreco: true,
          ativo: true,
        },
      });
      const campanhas = await this.prisma.totemCampanha.findMany({
        where: { orgId: a.orgId, ativa: true, inicioEm: { lte: agora } },
        select: { nome: true, chamada: true, ativa: true, inicioEm: true, fimEm: true, lojaIds: true },
      });
      const lotes = await this.lotes.porProduto(
        loja.id,
        produtos.map((p) => p.id),
      );

      const catalogo = montarCatalogo(
        {
          loja: { id: loja.id, nome: loja.nome, cidade: loja.cidade },
          dispositivo: aparelho,
          produtos: produtos.map((p) => ({ ...p, porcaoG: p.porcaoG == null ? null : Number(p.porcaoG) })),
          lotes,
          campanhas,
        },
        config,
        agora,
      );
      await this.prisma.totemDispositivo.updateMany({
        where: { id: a.dispositivoId, orgId: a.orgId },
        data: { vistoEm: agora, catalogoVersao: catalogo.versao },
      });
      return catalogo;
    });
  }

  async eventos(a: AparelhoResolvido, eventos: readonly TotemEventoQuiosque[]): Promise<{ recebidos: number }> {
    return comTenantPublico(a.orgId, async () => {
      await exigirModuloTotem(this.prisma, a.orgId);
      const ids = [...new Set(eventos.map((e) => e.produtoId).filter((id): id is string => !!id))];
      const produtos = ids.length
        ? await this.prisma.totemProduto.findMany({ where: { orgId: a.orgId, id: { in: ids } }, select: { id: true } })
        : [];
      const agora = new Date();
      const linhas = linhasDeEventos(eventos, a, new Set(produtos.map((p) => p.id)), agora);
      await this.prisma.totemEvento.createMany({ data: linhas, skipDuplicates: true });
      await this.prisma.totemDispositivo.updateMany({
        where: { id: a.dispositivoId, orgId: a.orgId },
        data: { vistoEm: agora },
      });
      return { recebidos: linhas.length };
    });
  }

  async batimento(a: AparelhoResolvido, versaoApp: string, catalogoVersao: string | null | undefined): Promise<void> {
    await comTenantPublico(a.orgId, async () => {
      await exigirModuloTotem(this.prisma, a.orgId);
      await this.prisma.totemDispositivo.updateMany({
        where: { id: a.dispositivoId, orgId: a.orgId },
        data: {
          vistoEm: new Date(),
          versaoApp,
          ...(catalogoVersao ? { catalogoVersao } : {}),
        },
      });
    });
  }
}
