import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, SessionCanal } from '@prisma/client';
import {
  CAMPOS_DO_PERFIL,
  PAPEIS_DE_MAQUINA,
  PERMISSAO_DE_EDITAR_PERFIL_DE_OUTRO,
  aniversarioDaData,
  finalDoWhatsapp,
  formatarWhatsappBr,
  rotaDaFoto,
  sugerirNomeNoVault,
  tituloNormalizado,
  type AvataresDaEmpresa,
  type CampoDoPerfil,
  type PerfilDaPessoa,
  type PerfilUpdateInput,
  type TipoDaFoto,
} from '@mktos/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AtribuicoesDoVaultService } from '../agents/atribuicoes-do-vault.service';
import { conferirFotoDePerfil } from './imagem-do-avatar';

/*
 * O PERFIL DA PESSOA (produção 22B, I6) — `/perfil`
 *
 * Tudo de GENTE, auditado, sem permissão nova:
 *
 *  · VER: qualquer pessoa logada da empresa (`dashboard.ver`) vê o perfil de
 *    outra (nome, apelido, cargo, cidade, fuso, foto e aniversário só com dia e
 *    mês). A data com o ano, o telefone e o WhatsApp inteiro só a própria
 *    pessoa e quem tem `admin.usuarios`.
 *  · EDITAR: a própria pessoa edita o seu; o de outra é de `admin.usuarios`.
 *    Os papéis são RELIDOS no banco (a permissão do token tem a idade do
 *    login), conta de máquina não edita nem é editada, e a escrita é
 *    condicionada à versão lida (`perfilAtualizadoEm`): outra aba no meio = 409.
 *  · A FOTO: conferida pelos bytes (`imagem-do-avatar.ts`) e guardada no banco
 *    (`FotoDePerfil`). Trocar ou tirar não apaga: a anterior ganha
 *    `substituidaEm`. A auditoria leva tipo, lado, tamanho e 12 caracteres do
 *    sha256, NUNCA o conteúdo.
 *
 * A auditoria do texto leva os campos que mudaram; a data de nascimento e o
 * telefone entram só como "definida/removida", sem o valor.
 */

interface QuemAge {
  id: string;
  permissoes: string[];
  maquina: boolean;
}

const SELECAO = {
  id: true,
  name: true,
  email: true,
  phone: true,
  apelido: true,
  cargo: true,
  cidade: true,
  fuso: true,
  dataNascimento: true,
  nomeNoVault: true,
  perfilAtualizadoEm: true,
  roles: { select: { key: true } },
  fotosDePerfil: {
    where: { substituidaEm: null },
    select: { sha256: true, tipo: true, largura: true, altura: true, tamanho: true, enviadaEm: true },
    take: 1,
  },
} satisfies Prisma.UserSelect;

type Linha = Prisma.UserGetPayload<{ select: typeof SELECAO }>;

const SENSIVEIS: ReadonlySet<CampoDoPerfil> = new Set(['dataNascimento', 'telefone']);

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class PerfilService {
  private readonly vault: AtribuicoesDoVaultService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() vault?: AtribuicoesDoVaultService,
  ) {
    this.vault = vault ?? new AtribuicoesDoVaultService(prisma);
  }

  private async quemAge(orgId: string, userId: string): Promise<QuemAge> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, orgId, isActive: true },
      select: { id: true, roles: { select: { key: true, permissions: { select: { key: true } } } } },
    });
    if (!u) throw new ForbiddenException('Sua conta não está ativa nesta empresa.');
    return {
      id: u.id,
      permissoes: [...new Set(u.roles.flatMap((r) => r.permissions.map((p) => p.key)))],
      maquina: u.roles.some((r) => PAPEIS_DE_MAQUINA.includes(r.key)),
    };
  }

  private async alvo(orgId: string, id: string): Promise<Linha> {
    const u = await this.prisma.user.findFirst({ where: { id, orgId, isActive: true }, select: SELECAO });
    if (!u) throw new NotFoundException('Pessoa não encontrada nesta empresa.');
    return u;
  }

  /** Pode editar: a própria pessoa, ou `admin.usuarios` (relido). Máquina nunca. */
  private podeEditar(ator: QuemAge, alvo: Linha): boolean {
    if (ator.maquina) return false;
    if (alvo.roles.some((r) => PAPEIS_DE_MAQUINA.includes(r.key))) return false;
    return ator.id === alvo.id || ator.permissoes.includes(PERMISSAO_DE_EDITAR_PERFIL_DE_OUTRO);
  }

  private exigirEdicao(ator: QuemAge, alvo: Linha): void {
    if (ator.maquina) throw new ForbiddenException('Conta de máquina não edita perfil.');
    if (alvo.roles.some((r) => PAPEIS_DE_MAQUINA.includes(r.key))) {
      throw new BadRequestException('Conta de máquina não tem perfil de pessoa.');
    }
    if (!this.podeEditar(ator, alvo)) {
      throw new ForbiddenException('Você edita o seu perfil; o de outra pessoa é de quem administra gente (admin.usuarios).');
    }
  }

  private async tela(orgId: string, ator: QuemAge, u: Linha): Promise<PerfilDaPessoa> {
    const proprio = ator.id === u.id;
    const inteiro = proprio || ator.permissoes.includes(PERMISSAO_DE_EDITAR_PERFIL_DE_OUTRO);
    const [ident, vault, equipe] = await Promise.all([
      this.prisma.channelIdentity.findFirst({
        where: { orgId, canal: SessionCanal.whatsapp, userId: u.id, ativo: true },
        orderBy: { criadoEm: 'desc' },
        select: { externalId: true },
      }),
      this.vault.ler(orgId, ator.id),
      this.prisma.user.findMany({ where: { orgId, isActive: true }, select: { name: true, nomeNoVault: true } }),
    ]);
    const digitos = ident ? (ident.externalId.split('@')[0] ?? ident.externalId) : null;
    const tomados = equipe.map((e) => e.nomeNoVault?.trim()).filter((n): n is string => !!n);
    const sugestao =
      !u.nomeNoVault && vault.memoria.disponivel
        ? sugerirNomeNoVault(
            u.name,
            vault.memoria.socios.filter((s) => !tomados.some((t) => tituloNormalizado(t) === tituloNormalizado(s))),
            equipe.map((e) => e.name),
          )
        : null;
    const foto = u.fotosDePerfil[0];
    const nascimento = dia(u.dataNascimento);
    return {
      id: u.id,
      nome: u.name,
      email: u.email,
      apelido: u.apelido,
      cargo: u.cargo,
      cidade: u.cidade,
      fuso: u.fuso,
      aniversario: aniversarioDaData(nascimento),
      dataNascimento: inteiro ? nascimento : null,
      telefone: inteiro ? u.phone : null,
      nomeNoVault: u.nomeNoVault,
      foto: foto
        ? {
            url: rotaDaFoto(u.id, foto.sha256),
            tipo: foto.tipo as TipoDaFoto,
            largura: foto.largura,
            altura: foto.altura,
            bytes: foto.tamanho,
            enviadaEm: foto.enviadaEm.toISOString(),
          }
        : null,
      whatsapp: digitos
        ? { cadastrado: true, final: finalDoWhatsapp(digitos), numero: inteiro ? formatarWhatsappBr(digitos) : null }
        : { cadastrado: false, final: null, numero: null },
      vault: { disponivel: vault.memoria.disponivel, frase: vault.memoria.frase, socios: vault.memoria.socios, sugestao },
      podeEditar: this.podeEditar(ator, u),
      proprio,
      atualizadoEm: u.perfilAtualizadoEm.toISOString(),
    };
  }

  async ver(orgId: string, viewerId: string, alvoId: string): Promise<PerfilDaPessoa> {
    const ator = await this.quemAge(orgId, viewerId);
    return this.tela(orgId, ator, await this.alvo(orgId, alvoId));
  }

  async alterar(orgId: string, atorId: string, alvoId: string, input: PerfilUpdateInput): Promise<PerfilDaPessoa> {
    const ator = await this.quemAge(orgId, atorId);
    const alvo = await this.alvo(orgId, alvoId);
    this.exigirEdicao(ator, alvo);
    if (alvo.perfilAtualizadoEm.toISOString() !== input.esperado) {
      throw new ConflictException('O perfil mudou desde que você abriu (outra aba ou outra pessoa). Recarregue e salve de novo.');
    }

    const vazio = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());
    const novo: Partial<Record<CampoDoPerfil, string | null>> = {};
    for (const campo of CAMPOS_DO_PERFIL) {
      const v = vazio(input[campo] as string | null | undefined);
      if (v !== undefined) novo[campo] = v;
    }
    const atual: Record<CampoDoPerfil, string | null> = {
      apelido: alvo.apelido,
      cargo: alvo.cargo,
      cidade: alvo.cidade,
      fuso: alvo.fuso,
      dataNascimento: dia(alvo.dataNascimento),
      telefone: alvo.phone,
      nomeNoVault: alvo.nomeNoVault,
    };
    const mudou = (Object.keys(novo) as CampoDoPerfil[]).filter((c) => novo[c] !== atual[c]);
    if (!mudou.length) return this.tela(orgId, ator, alvo);

    const data: Prisma.UserUpdateManyMutationInput = { perfilAtualizadoEm: new Date() };
    for (const c of mudou) {
      const v = novo[c] ?? null;
      if (c === 'dataNascimento') data.dataNascimento = v ? new Date(`${v}T00:00:00.000Z`) : null;
      else if (c === 'telefone') data.phone = v;
      else data[c] = v;
    }
    const mostrar = (c: CampoDoPerfil, v: string | null) => (SENSIVEIS.has(c) ? (v ? 'definida' : null) : v);

    await this.prisma.$transaction(async (tx) => {
      const r = await tx.user.updateMany({
        where: { id: alvo.id, orgId, isActive: true, perfilAtualizadoEm: alvo.perfilAtualizadoEm },
        data,
      });
      if (r.count !== 1) throw new ConflictException('O perfil mudou no meio da gravação. Recarregue e salve de novo.');
      await this.audit.log(
        {
          orgId,
          actorId: ator.id,
          action: 'perfil.alterado',
          entityType: 'user',
          entityId: alvo.id,
          before: Object.fromEntries(mudou.map((c) => [c, mostrar(c, atual[c])])),
          after: Object.fromEntries(mudou.map((c) => [c, mostrar(c, novo[c] ?? null)])),
          metadata: { campos: mudou, proprio: ator.id === alvo.id },
        },
        tx,
      );
    });
    return this.tela(orgId, ator, await this.alvo(orgId, alvo.id));
  }

  async enviarFoto(
    orgId: string,
    atorId: string,
    alvoId: string,
    arquivo: { buffer: Buffer; mimetype?: string; size?: number } | undefined,
  ): Promise<PerfilDaPessoa> {
    const ator = await this.quemAge(orgId, atorId);
    const alvo = await this.alvo(orgId, alvoId);
    this.exigirEdicao(ator, alvo);
    const c = conferirFotoDePerfil(arquivo);
    if (!c.ok) throw new BadRequestException(c.motivo);
    const conteudo = new Uint8Array(arquivo!.buffer);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`perfil-foto:${orgId}:${alvo.id}`}))`;
      const anterior = await tx.fotoDePerfil.findFirst({
        where: { orgId, userId: alvo.id, substituidaEm: null },
        select: { id: true, sha256: true },
      });
      if (anterior?.sha256 === c.sha256) return;
      const agora = new Date();
      if (anterior) await tx.fotoDePerfil.update({ where: { id: anterior.id }, data: { substituidaEm: agora } });
      await tx.fotoDePerfil.create({
        data: {
          orgId,
          userId: alvo.id,
          tipo: c.tipo,
          largura: c.largura,
          altura: c.altura,
          tamanho: c.tamanho,
          sha256: c.sha256,
          conteudo,
          enviadaPorId: ator.id,
          enviadaEm: agora,
        },
      });
      await tx.user.updateMany({ where: { id: alvo.id, orgId }, data: { perfilAtualizadoEm: agora } });
      await this.audit.log(
        {
          orgId,
          actorId: ator.id,
          action: 'perfil.foto.enviada',
          entityType: 'user',
          entityId: alvo.id,
          before: anterior ? { foto: anterior.sha256.slice(0, 12) } : { foto: null },
          after: { foto: c.sha256.slice(0, 12), tipo: c.tipo, largura: c.largura, altura: c.altura, bytes: c.tamanho },
          metadata: { proprio: ator.id === alvo.id },
        },
        tx,
      );
    });
    return this.tela(orgId, ator, await this.alvo(orgId, alvo.id));
  }

  async tirarFoto(orgId: string, atorId: string, alvoId: string): Promise<PerfilDaPessoa> {
    const ator = await this.quemAge(orgId, atorId);
    const alvo = await this.alvo(orgId, alvoId);
    this.exigirEdicao(ator, alvo);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`perfil-foto:${orgId}:${alvo.id}`}))`;
      const anterior = await tx.fotoDePerfil.findFirst({
        where: { orgId, userId: alvo.id, substituidaEm: null },
        select: { id: true, sha256: true },
      });
      if (!anterior) return;
      const agora = new Date();
      // Não apaga: a foto fica guardada, fora de uso.
      await tx.fotoDePerfil.update({ where: { id: anterior.id }, data: { substituidaEm: agora } });
      await tx.user.updateMany({ where: { id: alvo.id, orgId }, data: { perfilAtualizadoEm: agora } });
      await this.audit.log(
        {
          orgId,
          actorId: ator.id,
          action: 'perfil.foto.retirada',
          entityType: 'user',
          entityId: alvo.id,
          before: { foto: anterior.sha256.slice(0, 12) },
          after: { foto: null },
          metadata: { proprio: ator.id === alvo.id },
        },
        tx,
      );
    });
    return this.tela(orgId, ator, await this.alvo(orgId, alvo.id));
  }

  /** A foto em uso, para servir. Só da empresa de quem pede (o `orgId` do token). */
  async foto(orgId: string, alvoId: string): Promise<{ tipo: TipoDaFoto; conteudo: Buffer; sha256: string }> {
    const f = await this.prisma.fotoDePerfil.findFirst({
      where: { orgId, userId: alvoId, substituidaEm: null },
      select: { tipo: true, conteudo: true, sha256: true },
    });
    if (!f) throw new NotFoundException('Sem foto.');
    return { tipo: f.tipo as TipoDaFoto, conteudo: Buffer.from(f.conteudo), sha256: f.sha256 };
  }

  /**
   * As pessoas da empresa com a rota da foto e o aniversário (dia e mês), para
   * o avatar do responsável em qualquer tela e o bloco de aniversários. Gente
   * ativa, sem conta de máquina.
   */
  async avatares(orgId: string): Promise<AvataresDaEmpresa> {
    const gente = await this.prisma.user.findMany({
      where: { orgId, isActive: true, roles: { none: { key: { in: [...PAPEIS_DE_MAQUINA] } } } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        cargo: true,
        dataNascimento: true,
        fotosDePerfil: { where: { substituidaEm: null }, select: { sha256: true }, take: 1 },
      },
    });
    return {
      pessoas: gente.map((g) => ({
        id: g.id,
        nome: g.name,
        cargo: g.cargo,
        aniversario: aniversarioDaData(dia(g.dataNascimento)),
        fotoUrl: g.fotosDePerfil[0] ? rotaDaFoto(g.id, g.fotosDePerfil[0].sha256) : null,
      })),
    };
  }
}
