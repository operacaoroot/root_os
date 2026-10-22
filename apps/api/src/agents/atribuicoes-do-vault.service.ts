import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FRASE_DA_MEMORIA_INDISPONIVEL, type MemoriaDaEquipe, type MotivoDaMemoriaIndisponivel } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import {
  identidadeHttpDoIndice,
  lerNativasNoTx,
  travarIndiceEMemoriaNoTx,
  travarLeitorDoIndiceNoTx,
} from '../onboarding/indice-protegido';
import { PASTAS_DAS_ATRIBUICOES, lerVault, sociosDoVault, type LeituraDoVault } from './atribuicoes-do-vault';

/*
 * AS ATRIBUIÇÕES DA EQUIPE, LIDAS PELA PORTA DO ÍNDICE (produção 22B, I6).
 *
 * Nenhum caminho novo de arquivo: o vault é lido pelo ÍNDICE que o conector do
 * Obsidian mantém (`KnowledgeNote`), pela mesma porta protegida do Contexto
 * (`onboarding/indice-protegido.ts`): a pessoa relida no banco com
 * `obsidian.ver`, as notas arquivadas e restritas de fora, a leitura numa
 * transação com o cadeado do índice. Só as duas pastas que a Equipe usa.
 *
 * O índice só existe na empresa da casa (só ela reindexa o vault). Em qualquer
 * outra empresa, e na casa sem as notas, a Equipe diz "memória da Root
 * indisponível" e segue com o resto.
 */

export interface LeituraDaEquipe {
  memoria: MemoriaDaEquipe;
  leitura: LeituraDoVault | null;
}

const indisponivel = (motivo: MotivoDaMemoriaIndisponivel): LeituraDaEquipe => ({
  memoria: { disponivel: false, motivo, frase: FRASE_DA_MEMORIA_INDISPONIVEL[motivo], socios: [] },
  leitura: null,
});

@Injectable()
export class AtribuicoesDoVaultService {
  private readonly log = new Logger('AtribuicoesDoVault');

  constructor(private readonly prisma: PrismaService) {}

  async ler(orgId: string, pessoaId: string): Promise<LeituraDaEquipe> {
    let identidade;
    try {
      identidade = identidadeHttpDoIndice(orgId, pessoaId);
    } catch {
      return indisponivel('sem_permissao');
    }
    try {
      const notas = await this.prisma.$transaction(
        async (tx) => {
          await travarIndiceEMemoriaNoTx(tx, orgId);
          await travarLeitorDoIndiceNoTx(tx, orgId, identidade);
          const linhas = await lerNativasNoTx(tx, orgId, pessoaId, { pastas: PASTAS_DAS_ATRIBUICOES });
          if (!linhas.length) return [];
          // O link da ficha no Contexto é a nota da memória que espelha o arquivo.
          const chaves = linhas.map((l) => `vault:${l.path}`);
          const itens = await tx.contextItem.findMany({
            where: {
              orgId,
              chave: { in: chaves },
              arquivadoEm: null,
              OR: [{ acessoRestrito: false }, { leitores: { has: pessoaId } }],
            },
            select: { id: true, chave: true },
          });
          const porChave = new Map(itens.map((i) => [i.chave, i.id]));
          return linhas.map((l) => ({ caminho: l.path, conteudo: l.content, notaId: porChave.get(`vault:${l.path}`) ?? null }));
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      const leitura = lerVault(notas);
      if (!leitura.temGovernanca) return indisponivel('ausente');
      return {
        memoria: { disponivel: true, motivo: null, frase: null, socios: sociosDoVault(leitura) },
        leitura,
      };
    } catch (e) {
      if (e instanceof ForbiddenException) return indisponivel('sem_permissao');
      this.log.warn(`Leitura das atribuições no vault falhou: ${(e as Error).message}`);
      return indisponivel('erro');
    }
  }
}
