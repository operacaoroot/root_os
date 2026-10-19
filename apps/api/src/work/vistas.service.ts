import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  TELAS_DE_VISTA, conferirConfigDaVista,
  type TelaDeVista, type VistaAlterarInput, type VistaCriarInput, type VistaSalvaDto,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';

/*
 * AS VISTAS SALVAS (rodada do trabalho T3, 19/10/2026). Preferência de UMA
 * pessoa: toda consulta filtra pela empresa E pelo `userId` da sessão, e a vista
 * de outra pessoa responde o mesmo 404 de uma que não existe. Uma padrão por
 * pessoa e tela: marcar uma desmarca as outras na mesma transação, e o índice
 * único parcial `VistaSalva_padrao_unica` segura a corrida.
 */

type Linha = { id: string; tela: string; nome: string; padrao: boolean; config: Prisma.JsonValue; atualizadaEm: Date };

function paraDto(l: Linha): VistaSalvaDto {
  return {
    id: l.id,
    tela: l.tela as TelaDeVista,
    nome: l.nome,
    padrao: l.padrao,
    config: l.config as unknown as VistaSalvaDto['config'],
    atualizadaEm: l.atualizadaEm.toISOString(),
  };
}

function nomeRepetido(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

@Injectable()
export class VistasService {
  constructor(private readonly prisma: PrismaService) {}

  telaValida(tela: unknown): TelaDeVista {
    if (typeof tela !== 'string' || !(TELAS_DE_VISTA as readonly string[]).includes(tela)) {
      throw new NotFoundException('Tela de vista desconhecida.');
    }
    return tela as TelaDeVista;
  }

  async listar(orgId: string, userId: string, tela: TelaDeVista): Promise<VistaSalvaDto[]> {
    const linhas = await this.prisma.vistaSalva.findMany({
      where: { orgId, userId, tela },
      orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
    });
    return linhas.map(paraDto);
  }

  async criar(orgId: string, userId: string, input: VistaCriarInput): Promise<VistaSalvaDto> {
    try {
      const criada = await this.prisma.$transaction(async (tx) => {
        if (input.padrao) await tx.vistaSalva.updateMany({ where: { orgId, userId, tela: input.tela, padrao: true }, data: { padrao: false } });
        return tx.vistaSalva.create({
          data: { orgId, userId, tela: input.tela, nome: input.nome, padrao: !!input.padrao, config: input.config as Prisma.InputJsonValue },
        });
      });
      return paraDto(criada);
    } catch (e) {
      if (nomeRepetido(e)) throw new ConflictException('Você já tem uma vista com esse nome nesta tela.');
      throw e;
    }
  }

  async alterar(orgId: string, userId: string, id: string, input: VistaAlterarInput): Promise<VistaSalvaDto> {
    const atual = await this.prisma.vistaSalva.findFirst({ where: { id, orgId, userId } });
    if (!atual) throw new NotFoundException('Vista não encontrada.');
    const tela = atual.tela as TelaDeVista;
    const config = input.config === undefined ? undefined : conferirConfigDaVista(tela, input.config);
    try {
      const nova = await this.prisma.$transaction(async (tx) => {
        if (input.padrao) await tx.vistaSalva.updateMany({ where: { orgId, userId, tela, padrao: true, id: { not: id } }, data: { padrao: false } });
        return tx.vistaSalva.update({
          where: { id },
          data: {
            nome: input.nome,
            padrao: input.padrao,
            config: config === undefined ? undefined : (config as Prisma.InputJsonValue),
          },
        });
      });
      return paraDto(nova);
    } catch (e) {
      if (nomeRepetido(e)) throw new ConflictException('Você já tem uma vista com esse nome nesta tela.');
      throw e;
    }
  }

  async remover(orgId: string, userId: string, id: string): Promise<{ removida: true }> {
    const r = await this.prisma.vistaSalva.deleteMany({ where: { id, orgId, userId } });
    if (r.count === 0) throw new NotFoundException('Vista não encontrada.');
    return { removida: true };
  }
}
