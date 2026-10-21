import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SessionCanal } from '@prisma/client';
import {
  CADASTRO_DE_FUNCOES,
  PAPEIS_DE_MAQUINA,
  PERMISSAO_DE_CADASTRAR_WHATSAPP_DE_OUTRO,
  finalDoWhatsapp,
  formatarWhatsappBr,
  funcaoPorSlug,
  lerWhatsappBr,
  podeEditarDono,
  type EquipeDaEmpresa,
  type FuncaoNaEquipe,
  type MotivoForaDaEquipe,
  type PessoaNaEquipe,
  type WhatsappNaEquipe,
} from '@mktos/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { formasDaChave, sufixoVisivel } from '../gateway/canais/identidade-de-canal';
import {
  carregarEquipe,
  donoDaFuncao,
  donoEfetivo,
  donosDosAgentes,
  type ContextoDaEquipe,
} from './equipe-donos';

/*
 * A EQUIPE (rodada dos agentes, 21/10/2026, A7) — `/organograma`
 *
 * As pessoas da empresa (a regra de quem aparece está em
 * `packages/shared/src/equipe-pessoas.ts`) e, sob cada uma, as funções do
 * cadastro único de que ela é dona, por área. Duas escritas:
 *
 *  · TROCAR O DONO de uma função. Só `admin` ou `controle` (`admin.usuarios` ou
 *    `admin.permissoes`), RELIDO NO BANCO, porque a permissão do JWT tem a
 *    idade do login. O destino tem de ser pessoa da equipe. Com registro `Agent`
 *    a troca vai a `Agent.donoId` (o laço do agente lê); sem registro, a
 *    `DonoDaFuncao`. Auditado: quem, quando, de quem para quem.
 *
 *  · O WHATSAPP DE CADA PESSOA (CA-02). Cadastra a identidade de canal
 *    (`ChannelIdentity`, canal `whatsapp`) que o canal de aprovação já procura.
 *    A própria pessoa cadastra o seu; o de outra pessoa só quem administra gente
 *    (`admin.usuarios`). O número não se repete entre pessoas (409). Uma pessoa
 *    tem um número ativo: o anterior fica INATIVO, nunca apagado. Na auditoria
 *    só o final do número, como o canal faz no RASTRO.
 */

const CANAL = SessionCanal.whatsapp;
const AREA_FORA = 'Fora do cadastro';

interface QuemAge {
  id: string;
  nome: string;
  papeis: string[];
  permissoes: string[];
}

@Injectable()
export class EquipeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A pessoa que age, RELIDA no banco: ativa, desta empresa, com papéis e permissões de agora. */
  private async quemAge(orgId: string, userId: string): Promise<QuemAge> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, orgId, isActive: true },
      select: { id: true, name: true, roles: { select: { key: true, permissions: { select: { key: true } } } } },
    });
    if (!u) throw new ForbiddenException('Sua conta não está ativa nesta empresa.');
    return {
      id: u.id,
      nome: u.name,
      papeis: u.roles.map((r) => r.key),
      permissoes: [...new Set(u.roles.flatMap((r) => r.permissions.map((p) => p.key)))],
    };
  }

  async equipe(orgId: string, viewerId: string): Promise<EquipeDaEmpresa> {
    const [ctx, quem, agentes, identidades] = await Promise.all([
      carregarEquipe(this.prisma, orgId),
      this.quemAge(orgId, viewerId).catch(() => null),
      this.prisma.agent.findMany({
        where: { orgId },
        orderBy: { nome: 'asc' },
        select: { slug: true, nome: true, missao: true, tipo: true, estado: true, donoId: true },
      }),
      this.prisma.channelIdentity.findMany({
        where: { orgId, canal: CANAL, ativo: true, userId: { not: null } },
        orderBy: { criadoEm: 'desc' },
        select: { userId: true, externalId: true },
      }),
    ]);
    const donos = await donosDosAgentes(this.prisma, orgId, agentes);
    const verTudo = !!quem?.permissoes.includes(PERMISSAO_DE_CADASTRAR_WHATSAPP_DE_OUTRO);

    const funcoes: FuncaoNaEquipe[] = [];
    for (const f of CADASTRO_DE_FUNCOES) {
      if (f.estado === 'aposentado') continue;
      const { dono, guardadoEm } = donoDaFuncao(f, donos, ctx);
      funcoes.push({
        id: f.id,
        slug: f.slug,
        nome: f.nome,
        area: f.area,
        tipo: f.tipo,
        estado: f.estado,
        paraQueServe: f.paraQueServe,
        dono,
        guardadoEm,
      });
    }
    for (const a of agentes) {
      if (funcaoPorSlug(a.slug) || a.estado === 'encerrado') continue;
      funcoes.push({
        id: null,
        slug: a.slug,
        nome: a.nome,
        area: AREA_FORA,
        tipo: a.tipo === 'llm' ? 'agente' : 'automacao',
        estado: a.estado === 'ativo' ? 'ativo' : 'desligado',
        paraQueServe: a.missao,
        dono: donoEfetivo(null, donos.get(a.slug), ctx),
        guardadoEm: 'agente',
      });
    }

    const pessoas: PessoaNaEquipe[] = ctx.equipe.pessoas.map((p) => {
      const minhas = funcoes.filter((f) => f.dono.efetivo?.id === p.id);
      const areas: PessoaNaEquipe['areas'] = [];
      for (const f of minhas) {
        const g = areas.find((x) => x.area === f.area);
        if (g) g.funcoes.push(f);
        else areas.push({ area: f.area, funcoes: [f] });
      }
      const ident = identidades.find((i) => i.userId && ctx.equipe.canonica.get(i.userId) === p.id);
      const proprio = quem?.id ? ctx.equipe.canonica.get(quem.id) === p.id : false;
      return {
        id: p.id,
        nome: p.nome,
        papeis: [...p.papeis],
        whatsapp: this.whatsappNaTela(ident?.externalId ?? null, proprio || verTudo),
        podeEditarWhatsapp: proprio || verTudo,
        areas,
      };
    });

    const foraDaVista: Partial<Record<MotivoForaDaEquipe, number>> = {};
    for (const f of ctx.equipe.fora) foraDaVista[f.motivo] = (foraDaVista[f.motivo] ?? 0) + 1;

    return {
      pessoas,
      semDono: funcoes.filter((f) => !f.dono.efetivo),
      foraDaVista,
      podeEditarDono: !!quem && podeEditarDono(quem.permissoes),
      totais: {
        pessoas: pessoas.length,
        agentes: funcoes.filter((f) => f.tipo === 'agente').length,
        rotinas: funcoes.filter((f) => f.tipo === 'rotina').length,
        automacoes: funcoes.filter((f) => f.tipo === 'automacao').length,
      },
    };
  }

  private whatsappNaTela(externalId: string | null, inteiro: boolean): WhatsappNaEquipe {
    if (!externalId) return { cadastrado: false, final: null, numero: null };
    const digitos = externalId.split('@')[0] ?? externalId;
    return { cadastrado: true, final: finalDoWhatsapp(digitos), numero: inteiro ? formatarWhatsappBr(digitos) : null };
  }

  /* ---------------------------------------------------------------- dono -- */

  async trocarDono(orgId: string, atorId: string, slug: string, userId: string | null) {
    const ator = await this.quemAge(orgId, atorId);
    if (!podeEditarDono(ator.permissoes)) {
      throw new ForbiddenException('Trocar o dono é de quem administra gente ou o controle (admin.usuarios ou admin.permissoes).');
    }
    const funcao = funcaoPorSlug(slug);
    const ctx = await carregarEquipe(this.prisma, orgId);
    let destino: { id: string; nome: string } | null = null;
    if (userId !== null) {
      const id = ctx.equipe.canonica.get(userId);
      const p = id ? ctx.equipe.pessoas.find((x) => x.id === id) : undefined;
      if (!p) throw new BadRequestException('O dono tem de ser uma pessoa da Equipe.');
      destino = { id: p.id, nome: p.nome };
    }

    const resultado = await this.prisma.$transaction(async (tx) => {
      const agente = await tx.agent.findUnique({
        where: { orgId_slug: { orgId, slug } },
        select: { id: true, slug: true, donoId: true },
      });
      if (!agente && !funcao) throw new NotFoundException(`Função "${slug}" não existe no cadastro nem no registro de agentes.`);

      let antes: string | null;
      let guardadoEm: 'agente' | 'equipe';
      if (agente) {
        guardadoEm = 'agente';
        antes = agente.donoId;
        await tx.agent.update({ where: { id: agente.id }, data: { donoId: destino?.id ?? null } });
      } else {
        guardadoEm = 'equipe';
        const atual = await tx.donoDaFuncao.findUnique({
          where: { orgId_funcaoId: { orgId, funcaoId: funcao!.id } },
          select: { userId: true },
        });
        antes = atual?.userId ?? null;
        await tx.donoDaFuncao.upsert({
          where: { orgId_funcaoId: { orgId, funcaoId: funcao!.id } },
          create: { orgId, funcaoId: funcao!.id, userId: destino?.id ?? null, definidoPorId: ator.id },
          update: { userId: destino?.id ?? null, definidoPorId: ator.id },
        });
      }
      const doAntes = donoEfetivo(funcao?.dono ?? null, antes, ctx);
      const doDepois = donoEfetivo(funcao?.dono ?? null, destino?.id ?? null, ctx);
      await this.audit.log(
        {
          orgId,
          actorId: ator.id,
          action: 'equipe.dono.trocado',
          entityType: 'funcao',
          entityId: slug,
          before: { donoId: antes, efetivo: doAntes.efetivo, origem: doAntes.origem },
          after: { donoId: destino?.id ?? null, efetivo: doDepois.efetivo, origem: doDepois.origem },
          metadata: { funcaoId: funcao?.id ?? null, guardadoEm, quem: ator.nome },
        },
        tx,
      );
      return { slug, funcaoId: funcao?.id ?? null, guardadoEm, dono: doDepois };
    });
    return resultado;
  }

  /* ------------------------------------------------------------ whatsapp -- */

  async cadastrarWhatsapp(orgId: string, atorId: string, pessoaId: string, numero: string | null): Promise<WhatsappNaEquipe> {
    const ator = await this.quemAge(orgId, atorId);
    if (ator.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p))) {
      throw new ForbiddenException('Conta de máquina não cadastra número.');
    }
    const ehAdmin = ator.permissoes.includes(PERMISSAO_DE_CADASTRAR_WHATSAPP_DE_OUTRO);
    if (pessoaId !== ator.id && !ehAdmin) {
      throw new ForbiddenException('Você cadastra o seu número; o de outra pessoa é de quem administra gente.');
    }
    const alvo = await this.prisma.user.findFirst({
      where: { id: pessoaId, orgId, isActive: true },
      select: { id: true, name: true, roles: { select: { key: true } } },
    });
    if (!alvo) throw new NotFoundException('Pessoa não encontrada nesta empresa.');
    if (alvo.roles.some((r) => PAPEIS_DE_MAQUINA.includes(r.key))) {
      throw new BadRequestException('Conta de máquina não tem WhatsApp de aprovação.');
    }

    if (numero === null) {
      await this.prisma.$transaction(async (tx) => {
        const ativas = await tx.channelIdentity.findMany({
          where: { orgId, canal: CANAL, userId: alvo.id, ativo: true },
          select: { id: true, externalId: true },
        });
        if (ativas.length) {
          await tx.channelIdentity.updateMany({ where: { id: { in: ativas.map((a) => a.id) } }, data: { ativo: false } });
          await this.audit.log(
            {
              orgId,
              actorId: ator.id,
              action: 'equipe.whatsapp.removido',
              entityType: 'user',
              entityId: alvo.id,
              before: { finais: ativas.map((a) => sufixoVisivel(a.externalId.split('@')[0] ?? '')) },
              after: { ativo: false },
              metadata: { quem: ator.nome, deQuem: alvo.name },
            },
            tx,
          );
        }
      });
      return { cadastrado: false, final: null, numero: null };
    }

    const leitura = lerWhatsappBr(numero);
    if (!leitura.ok) throw new BadRequestException(leitura.motivo);
    const digitos = leitura.digitos;

    try {
      await this.prisma.$transaction(async (tx) => {
        const deOutro = await tx.channelIdentity.findFirst({
          where: { orgId, canal: CANAL, ativo: true, externalId: { in: formasDaChave(digitos) }, NOT: { userId: alvo.id } },
          select: { id: true },
        });
        if (deOutro) throw new ConflictException('Este número já está cadastrado para outra pessoa.');

        const anteriores = await tx.channelIdentity.findMany({
          where: { orgId, canal: CANAL, userId: alvo.id, ativo: true },
          select: { id: true, externalId: true },
        });
        const mesma = await tx.channelIdentity.findUnique({
          where: { orgId_canal_externalId: { orgId, canal: CANAL, externalId: digitos } },
          select: { id: true, userId: true, ativo: true },
        });
        const rotulo = `WhatsApp de ${alvo.name}`.slice(0, 120);
        if (mesma) {
          await tx.channelIdentity.update({ where: { id: mesma.id }, data: { userId: alvo.id, ativo: true, rotulo } });
        } else {
          await tx.channelIdentity.create({ data: { orgId, canal: CANAL, externalId: digitos, userId: alvo.id, rotulo } });
        }
        const outras = anteriores.filter((a) => a.externalId !== digitos);
        if (outras.length) {
          await tx.channelIdentity.updateMany({ where: { id: { in: outras.map((o) => o.id) } }, data: { ativo: false } });
        }
        await this.audit.log(
          {
            orgId,
            actorId: ator.id,
            action: 'equipe.whatsapp.cadastrado',
            entityType: 'user',
            entityId: alvo.id,
            before: { finais: anteriores.map((a) => sufixoVisivel(a.externalId.split('@')[0] ?? '')) },
            after: { final: sufixoVisivel(digitos), canal: 'whatsapp' },
            metadata: { quem: ator.nome, deQuem: alvo.name, proprio: ator.id === alvo.id, retomou: !!mesma },
          },
          tx,
        );
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Este número já está cadastrado para outra pessoa.');
      }
      throw e;
    }
    return { cadastrado: true, final: finalDoWhatsapp(digitos), numero: formatarWhatsappBr(digitos) };
  }
}

export type { ContextoDaEquipe };
