import { Injectable, NotFoundException } from '@nestjs/common';
import {
  OperacaoPainelSchema,
  type OperacaoPainelConteudo,
  type OperacaoPainelResposta,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SUPERFICIE_DO_CONSOLE, cercar } from './plataforma';

interface LinhaDaRodada {
  rodadaEm: string;
  conteudo: unknown;
  updatedAt: Date;
}

/** O recorte do cliente Prisma que este serviço usa. Ver `cercar()`. */
interface PrismaDaOperacao {
  operacaoRodada: {
    findMany(args: unknown): Promise<Pick<LinhaDaRodada, 'rodadaEm'>[]>;
    findUnique(args: unknown): Promise<LinhaDaRodada | null>;
  };
}

/*
 * O painel da operação da Root, rodada a rodada. A escrita é do script
 * `importar-painel-operacao` (a rotina semanal roda fora do OS); aqui só se lê.
 * O conteúdo é validado de novo na leitura porque o JSONB aceita qualquer
 * objeto que passe o CHECK, e a tela não deve receber um formato que não sabe
 * desenhar. A leitura passa pela cerca do console, como toda leitura desta pasta.
 */
@Injectable()
export class OperacaoService {
  private readonly cerca: PrismaDaOperacao;

  constructor(prisma: PrismaService) {
    this.cerca = cercar(prisma, SUPERFICIE_DO_CONSOLE, 'console') as PrismaDaOperacao;
  }

  async painel(orgId: string, rodada?: string): Promise<OperacaoPainelResposta> {
    const rodadas = await this.cerca.operacaoRodada.findMany({
      where: { orgId },
      select: { rodadaEm: true },
      orderBy: { rodadaEm: 'desc' },
      take: 104,
    });
    const datas = rodadas.map((r) => r.rodadaEm);
    const alvo = rodada ?? datas[0];
    if (!alvo) return { rodada: null, rodadas: [], importadaEm: null, conteudo: null };

    const linha = await this.cerca.operacaoRodada.findUnique({
      where: { orgId_rodadaEm: { orgId, rodadaEm: alvo } },
      select: { rodadaEm: true, conteudo: true, updatedAt: true },
    });
    if (!linha) throw new NotFoundException('Rodada não encontrada.');

    const conteudo = OperacaoPainelSchema.safeParse(linha.conteudo);
    return {
      rodada: linha.rodadaEm,
      rodadas: datas,
      importadaEm: linha.updatedAt.toISOString(),
      conteudo: conteudo.success ? (conteudo.data as OperacaoPainelConteudo) : null,
    };
  }
}
