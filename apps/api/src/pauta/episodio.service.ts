import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PAUTA_EPISODIO_STATUS_ROTULO,
  apelidoDoEpisodio,
  transicaoDoEpisodio,
  type PautaEpisodioDetalhe,
  type PautaEpisodioList,
  type PautaEpisodioStatus,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  STATUS_DA_RODADA_QUE_VIRA_EPISODIO,
  detalheDoEpisodio,
  proximoNumero,
  resumoDoEpisodio,
  semPai,
  tituloPadrao,
} from './episodio';

const DA_RODADA = { select: { titulo: true, itens: true, janelaIni: true, janelaFim: true } } as const;

/** A página de links (MC12) com os botões, para o detalhe e para a descrição apontar para ela. */
const DA_PAGINA = {
  select: {
    id: true,
    handle: true,
    titulo: true,
    publicada: true,
    links: { select: { id: true, rotulo: true, destino: true, ativo: true, chave: true, ordem: true } },
  },
} as const;

function repetido(e: unknown): string | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null;
  return JSON.stringify(e.meta?.target ?? '');
}

/*
 * O EPISÓDIO (MC7): nasce de uma rodada curada e anda do roteiro ao concluído.
 * Tudo aqui é escrita DENTRO do OS — nada sai para fora, nada passa pela porta.
 */
@Injectable()
export class EpisodioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * O número sai sob um cadeado por EMPRESA, dentro da mesma transação que
   * grava: duas criações simultâneas leem o maior número uma depois da outra.
   * O índice único `(orgId, numero)` é a segunda tranca (outro processo, script
   * na mão), e o `rodadaId` único é a de "uma rodada, um episódio".
   */
  async criar(orgId: string, actorId: string, entrada: { rodadaId: string; titulo?: string }) {
    let criado: { id: string; numero: number; titulo: string };
    try {
      criado = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-episodio:${orgId}`}))`;

        const rodada = await tx.pautaRodada.findFirst({
          where: { id: entrada.rodadaId, orgId },
          select: { id: true, status: true, titulo: true, episodio: { select: { numero: true } } },
        });
        if (!rodada) throw new NotFoundException('Rodada não encontrada');
        if (rodada.episodio) {
          throw new ConflictException(`Esta rodada já é o episódio ${apelidoDoEpisodio(rodada.episodio.numero)}.`);
        }
        if (rodada.status !== STATUS_DA_RODADA_QUE_VIRA_EPISODIO) {
          throw new BadRequestException(
            rodada.status === 'aguardando_curadoria'
              ? 'A rodada ainda aguarda a curadoria — confirme os itens antes de criar o episódio.'
              : `Só rodada curada vira episódio (esta está em "${rodada.status}").`,
          );
        }

        const maior = await tx.pautaEpisodio.aggregate({ where: { orgId }, _max: { numero: true } });
        const numero = proximoNumero(maior._max.numero);
        return tx.pautaEpisodio.create({
          data: {
            orgId,
            rodadaId: rodada.id,
            numero,
            titulo: entrada.titulo?.trim() || tituloPadrao(numero, rodada.titulo),
            criadoPor: actorId,
          },
          select: { id: true, numero: true, titulo: true },
        });
      });
    } catch (e) {
      const alvo = repetido(e);
      if (alvo?.includes('rodadaId')) throw new ConflictException('Esta rodada já virou episódio.');
      if (alvo) throw new ConflictException('Outro episódio pegou este número agora — tente de novo.');
      // A rodada foi apagada entre a leitura e o insert: o gatilho recusa.
      if (semPai(e)) throw new NotFoundException('Rodada não encontrada');
      throw e;
    }

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_criado',
      entityType: 'pauta_episodio',
      entityId: criado.id,
      after: { numero: criado.numero, rodadaId: entrada.rodadaId, titulo: criado.titulo },
    });
    return this.obter(orgId, criado.id);
  }

  async listar(orgId: string): Promise<PautaEpisodioList> {
    const rows = await this.prisma.pautaEpisodio.findMany({
      where: { orgId },
      orderBy: { numero: 'desc' },
      take: 100,
      include: { rodada: DA_RODADA },
    });
    return {
      items: rows.map(resumoDoEpisodio),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async obter(orgId: string, id: string): Promise<PautaEpisodioDetalhe> {
    const e = await this.prisma.pautaEpisodio.findFirst({
      where: { id, orgId },
      include: { rodada: DA_RODADA, bioPage: DA_PAGINA },
    });
    if (!e) throw new NotFoundException('Episódio não encontrado');
    return detalheDoEpisodio(e, process.env.PUBLIC_BIO_ORIGIN);
  }

  async atualizarTitulo(orgId: string, id: string, actorId: string, titulo: string) {
    const antes = await this.prisma.pautaEpisodio.findFirst({ where: { id, orgId }, select: { titulo: true } });
    if (!antes) throw new NotFoundException('Episódio não encontrado');
    const novo = titulo.trim();
    await this.prisma.pautaEpisodio.updateMany({ where: { id, orgId }, data: { titulo: novo } });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_titulo',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { titulo: antes.titulo },
      after: { titulo: novo },
    });
    return this.obter(orgId, id);
  }

  /**
   * Anda um passo, à frente ou atrás. A escrita é condicionada ao status que
   * foi lido: duas abas movendo o mesmo episódio não fazem ele pular dois.
   */
  async mudarStatus(orgId: string, id: string, actorId: string, para: PautaEpisodioStatus) {
    const e = await this.prisma.pautaEpisodio.findFirst({ where: { id, orgId }, select: { status: true } });
    if (!e) throw new NotFoundException('Episódio não encontrado');
    const t = transicaoDoEpisodio(e.status, para);
    if (!t.ok) throw new BadRequestException(t.erro);

    const r = await this.prisma.pautaEpisodio.updateMany({
      where: { id, orgId, status: e.status },
      data: { status: para },
    });
    if (r.count === 0) {
      throw new ConflictException(
        `O episódio saiu de ${PAUTA_EPISODIO_STATUS_ROTULO[e.status]} enquanto isso — recarregue e tente de novo.`,
      );
    }
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_status',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { status: e.status },
      after: { status: para, sentido: t.sentido },
    });
    return this.obter(orgId, id);
  }
}
