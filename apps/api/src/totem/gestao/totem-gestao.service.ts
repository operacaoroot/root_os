import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  TotemGestaoCodigoAtivacao,
  TotemGestaoConfig,
  TotemGestaoConfigEntrada,
  TotemGestaoDispositivo,
  TotemGestaoDispositivoCriar,
  TotemGestaoEventosPagina,
  TotemGestaoEventosQuery,
  TotemGestaoLoja,
  TotemGestaoLojaCriar,
  TotemGestaoLojaEditar,
  TotemGestaoProdutoCriar,
  TotemGestaoProdutoEditar,
  TotemGestaoProdutoResposta,
  TotemGestaoProdutosPagina,
  TotemGestaoProdutosQuery,
  TotemGestaoResumo,
  TotemGestaoUsuario,
} from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import type { JwtUser } from '../../auth/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { LoteVigenteService } from '../lote/lote-vigente.service';
import {
  totemGestaoCriarDispositivo,
  totemGestaoListarDispositivos,
  totemGestaoNovoCodigo,
  totemGestaoRenomearDispositivo,
  totemGestaoRevogarDispositivo,
} from './dispositivos';
import { totemGestaoListarEventos } from './eventos';
import {
  totemGestaoCriarLoja,
  totemGestaoDesvincularLoja,
  totemGestaoEditarLoja,
  totemGestaoListarLojas,
  totemGestaoListarUsuarios,
  totemGestaoVincularLoja,
} from './lojas';
import {
  totemGestaoCriarProduto,
  totemGestaoEditarProduto,
  totemGestaoListarProdutos,
  totemGestaoObterConfig,
  totemGestaoObterProduto,
  totemGestaoSalvarConfig,
} from './produtos';
import { totemGestaoCarregarResumo } from './resumo';

/*
 * A porta Nest das funções do painel. A regra mora nos arquivos irmãos, que
 * recebem o client por parâmetro e são testados sem Nest; aqui fica só o client
 * do contexto, a transação onde há mais de uma escrita e a auditoria.
 *
 * O código de ativação nunca entra na auditoria: ela guarda o id do totem e o
 * vencimento, e quem lê o log não ativa aparelho nenhum.
 */
@Injectable()
export class TotemGestaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lotes: LoteVigenteService,
    private readonly audit: AuditService,
  ) {}

  private registrar(
    user: JwtUser,
    action: string,
    entityType: string,
    entityId: string,
    after?: Prisma.InputJsonValue,
  ): Promise<void> {
    return this.audit.log({ orgId: user.orgId, actorId: user.sub, action, entityType, entityId, after });
  }

  // --- Resumo e eventos ---

  resumo(user: JwtUser, lojaId: string | undefined): Promise<TotemGestaoResumo> {
    return totemGestaoCarregarResumo(this.prisma, user, lojaId, new Date(), (loja, ids) =>
      this.lotes.porProduto(loja, ids),
    );
  }

  eventos(user: JwtUser, q: TotemGestaoEventosQuery): Promise<TotemGestaoEventosPagina> {
    return totemGestaoListarEventos(this.prisma, user, q);
  }

  // --- Lojas e usuários ---

  lojas(user: JwtUser, situacao: 'ativas' | 'todas'): Promise<TotemGestaoLoja[]> {
    return totemGestaoListarLojas(this.prisma, user, situacao);
  }

  async criarLoja(user: JwtUser, dados: TotemGestaoLojaCriar): Promise<TotemGestaoLoja> {
    const loja = await this.prisma.$transaction((tx) => totemGestaoCriarLoja(tx, user, dados));
    await this.registrar(user, 'totem.loja.criar', 'totem_loja', loja.id, { codigo: loja.codigo, nome: loja.nome });
    return loja;
  }

  async editarLoja(user: JwtUser, id: string, dados: TotemGestaoLojaEditar): Promise<TotemGestaoLoja> {
    const loja = await totemGestaoEditarLoja(this.prisma, user, id, dados);
    await this.registrar(user, 'totem.loja.editar', 'totem_loja', id, dados as Prisma.InputJsonValue);
    return loja;
  }

  usuarios(user: JwtUser): Promise<TotemGestaoUsuario[]> {
    return totemGestaoListarUsuarios(this.prisma, user);
  }

  async vincular(user: JwtUser, userId: string, lojaId: string): Promise<TotemGestaoUsuario> {
    const alvo = await totemGestaoVincularLoja(this.prisma, user, userId, lojaId);
    await this.registrar(user, 'totem.usuario.vincular', 'user', userId, { lojaId });
    return alvo;
  }

  async desvincular(user: JwtUser, userId: string, lojaId: string): Promise<TotemGestaoUsuario> {
    const alvo = await totemGestaoDesvincularLoja(this.prisma, user, userId, lojaId);
    await this.registrar(user, 'totem.usuario.desvincular', 'user', userId, { lojaId });
    return alvo;
  }

  // --- Dispositivos ---

  dispositivos(user: JwtUser, lojaId: string | undefined): Promise<TotemGestaoDispositivo[]> {
    return totemGestaoListarDispositivos(this.prisma, user, lojaId, new Date());
  }

  async criarDispositivo(user: JwtUser, dados: TotemGestaoDispositivoCriar): Promise<TotemGestaoCodigoAtivacao> {
    const r = await totemGestaoCriarDispositivo(this.prisma, user, dados, new Date());
    await this.registrar(user, 'totem.dispositivo.criar', 'totem_dispositivo', r.dispositivo.id, {
      lojaId: dados.lojaId,
      nome: dados.nome,
      expiraEm: r.expiraEm,
    });
    return r;
  }

  async novoCodigo(user: JwtUser, id: string): Promise<TotemGestaoCodigoAtivacao> {
    const r = await totemGestaoNovoCodigo(this.prisma, user, id, new Date());
    await this.registrar(user, 'totem.dispositivo.novo_codigo', 'totem_dispositivo', id, { expiraEm: r.expiraEm });
    return r;
  }

  async renomearDispositivo(user: JwtUser, id: string, nome: string): Promise<TotemGestaoDispositivo> {
    const d = await totemGestaoRenomearDispositivo(this.prisma, user, id, nome, new Date());
    await this.registrar(user, 'totem.dispositivo.renomear', 'totem_dispositivo', id, { nome });
    return d;
  }

  async revogarDispositivo(user: JwtUser, id: string): Promise<TotemGestaoDispositivo> {
    const d = await totemGestaoRevogarDispositivo(this.prisma, user, id, new Date());
    await this.registrar(user, 'totem.dispositivo.revogar', 'totem_dispositivo', id);
    return d;
  }

  // --- Produtos e configuração ---

  produtos(user: JwtUser, q: TotemGestaoProdutosQuery): Promise<TotemGestaoProdutosPagina> {
    return totemGestaoListarProdutos(this.prisma, user.orgId, q);
  }

  produto(user: JwtUser, id: string): Promise<TotemGestaoProdutoResposta> {
    return totemGestaoObterProduto(this.prisma, user.orgId, id);
  }

  async criarProduto(user: JwtUser, dados: TotemGestaoProdutoCriar): Promise<TotemGestaoProdutoResposta> {
    const r = await totemGestaoCriarProduto(this.prisma, user.orgId, dados);
    await this.registrar(user, 'totem.produto.criar', 'totem_produto', r.produto.id, {
      codigo: r.produto.codigo,
      nome: r.produto.nome,
    });
    return r;
  }

  async editarProduto(user: JwtUser, id: string, dados: TotemGestaoProdutoEditar): Promise<TotemGestaoProdutoResposta> {
    const r = await totemGestaoEditarProduto(this.prisma, user.orgId, id, dados);
    await this.registrar(user, 'totem.produto.editar', 'totem_produto', id, {
      campos: Object.keys(dados),
    });
    return r;
  }

  config(user: JwtUser): Promise<TotemGestaoConfig> {
    return totemGestaoObterConfig(this.prisma, user.orgId);
  }

  async salvarConfig(user: JwtUser, dados: TotemGestaoConfigEntrada): Promise<TotemGestaoConfig> {
    const c = await totemGestaoSalvarConfig(this.prisma, user.orgId, dados);
    await this.registrar(user, 'totem.config.salvar', 'totem_config', user.orgId, {
      precoLigado: c.precoLigado,
      cadastroLigado: c.cadastroLigado,
    });
    return c;
  }
}
