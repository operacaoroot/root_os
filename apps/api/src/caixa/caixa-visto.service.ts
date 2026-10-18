import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CaixaLimparInput, CaixaLimparResposta } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { exigirTenant } from '../common/contexto-execucao';
import { EVENTO_DO_TUDO, ORIGEM_DO_TUDO, lerChaveDoItem, novoLimpoAte } from './atividade-da-caixa';

/**
 * ============================================================================
 * O "LIMPEI ISTO" DA CAIXA DE ENTRADA — a única escrita do módulo caixa
 * ============================================================================
 *
 * A caixa nasceu com uma promessa (fatia A7): ela LÊ e não guarda nada, porque
 * "o que espera por mim" materializado numa tabela seria a segunda verdade sobre
 * um fato que já tem dono. Esta escrita NÃO quebra a promessa, e o motivo é o
 * que ela grava:
 *
 *  · é MARCA DE LEITURA PESSOAL, não estado de negócio. Limpar não muda status,
 *    não fecha tarefa, não apaga comentário, não decide aprovação. A tarefa
 *    continua igual para todo mundo, inclusive para quem limpou (ela está no
 *    quadro e no histórico da caixa, com `incluirLimpos`);
 *  · é DO PRÓPRIO USUÁRIO, e só dele. O `userId` vem do token, nunca do corpo:
 *    não existe "limpar a caixa de outra pessoa", e o visto de um não some da
 *    caixa do outro;
 *  · não copia o evento. A linha guarda a origem e o id do evento (ou, no
 *    "limpar tudo", um instante) — o conteúdo continua só onde nasceu.
 *
 * Por isso a escrita mora AQUI e não em `CaixaService`: aquele serviço segue sem
 * verbo de escrita nenhum (a suíte `caixa.test.ts` continua reprovando se ele
 * ganhar um), e este escreve UMA tabela, `CaixaVisto` — `caixa-atividade.test.ts`
 * reprova se ele tocar em qualquer outra.
 *
 * Sem RASTRO e sem auditoria, de propósito: registrar "Pedro leu o comentário
 * do Lucas" num livro que a empresa inteira consulta transformaria a leitura
 * pessoal em vigilância, e não há decisão de negócio para provar depois.
 */
@Injectable()
export class CaixaVistoService {
  constructor(private readonly prisma: PrismaService) {}

  async limpar(pedido: {
    orgId: string;
    usuarioId: string;
    entrada: CaixaLimparInput;
  }): Promise<CaixaLimparResposta> {
    const orgId = exigirTenant(pedido.orgId, 'CaixaVistoService.limpar');
    const agora = new Date();

    // Só usuário ativo desta empresa marca. Sessão de quem saiu não escreve.
    const eu = await this.prisma.user.findFirst({
      where: { id: pedido.usuarioId, orgId, isActive: true },
      select: { id: true },
    });
    if (!eu) {
      throw new ForbiddenException(
        'Sua sessão não corresponde a um usuário ativo desta empresa. Saia e entre de novo.',
      );
    }

    if ('ids' in pedido.entrada) {
      const vistos = new Set<string>();
      const linhas: { orgId: string; userId: string; origem: string; eventoId: string }[] = [];
      for (const chave of pedido.entrada.ids) {
        const lida = lerChaveDoItem(chave);
        if (!lida || vistos.has(chave)) continue;
        vistos.add(chave);
        linhas.push({ orgId, userId: eu.id, origem: lida.origem, eventoId: lida.eventoId });
      }
      // Limpar de novo o que já estava limpo não é erro: o índice único segura
      // a repetição e o clique duplo devolve o mesmo resultado.
      const feito = linhas.length
        ? await this.prisma.caixaVisto.createMany({ data: linhas, skipDuplicates: true })
        : { count: 0 };
      const tudo = await this.prisma.caixaVisto.findFirst({
        where: { orgId, userId: eu.id, origem: ORIGEM_DO_TUDO, eventoId: EVENTO_DO_TUDO },
        select: { ate: true },
      });
      return { limpos: feito.count, limpoAte: tudo?.ate?.toISOString() ?? null };
    }

    const pedidoAte = pedido.entrada.ate ? new Date(pedido.entrada.ate) : null;
    const chave = { orgId, userId: eu.id, origem: ORIGEM_DO_TUDO, eventoId: EVENTO_DO_TUDO };
    const anterior = await this.prisma.caixaVisto.findFirst({ where: chave, select: { ate: true } });
    const alvo = novoLimpoAte(pedidoAte, anterior?.ate ?? null, agora);

    // Cria a linha se não houver; depois só AVANÇA o instante. A escrita
    // condicionada (`ate < alvo`) é o que impede dois cliques fora de ordem de
    // devolverem à caixa o que já estava limpo.
    await this.prisma.caixaVisto.upsert({
      where: { orgId_userId_origem_eventoId: chave },
      create: { ...chave, ate: alvo, vistoEm: agora },
      update: {},
    });
    await this.prisma.caixaVisto.updateMany({
      where: { ...chave, OR: [{ ate: null }, { ate: { lt: alvo } }] },
      data: { ate: alvo, vistoEm: agora },
    });
    const depois = await this.prisma.caixaVisto.findFirst({ where: chave, select: { ate: true } });
    return { limpos: 0, limpoAte: depois?.ate?.toISOString() ?? alvo.toISOString() };
  }
}
