import { Injectable } from '@nestjs/common';
import type { Agent } from '@prisma/client';
import { ObsidianService } from '../obsidian/obsidian.service';

export interface FonteContexto {
  tipo: 'nota' | 'regra';
  id: string;
  titulo: string;
  ref?: string;
  score?: number;
}

/*
 * O bloco 02 do traço: o contexto que entrou junto do pedido.
 *
 * Não constrói MEMÓRIA nova — usa a que existe. ObsidianService.search já é
 * KNN por cosseno com queda para keyword quando falta a chave de embedding;
 * reconstruir isso seria inventar um segundo lugar onde a empresa sabe coisas.
 */
@Injectable()
export class ContextBuilder {
  // Teto duro: opus-5 a US$5/MTok com o vault inteiro no prompt é dinheiro
  // queimado a cada turno, e um contexto gigante piora a resposta.
  private static readonly MAX_CHARS = 6000;
  private static readonly TRECHO = 400;

  constructor(private readonly obsidian: ObsidianService) {}

  async montar(
    orgId: string,
    pedido: string,
    agent: Agent,
  ): Promise<{ blocos: string; fontes: FonteContexto[] }> {
    const fontes: FonteContexto[] = [];
    const partes: string[] = [];

    // As regras da casa deste agente entram SEMPRE, e primeiro: são a "regra
    // do que é verdade", e o lugar dela é dentro do pedido.
    if (agent.contextoFixo.length > 0) {
      partes.push('O QUE VALE NESTA EMPRESA:\n' + agent.contextoFixo.map((c) => `- ${c}`).join('\n'));
      agent.contextoFixo.forEach((c, i) =>
        fontes.push({ tipo: 'regra', id: `regra-${i}`, titulo: c.slice(0, 80) }),
      );
    }

    try {
      const busca = await this.obsidian.search(orgId, pedido, 5);
      const notas = (busca as { items?: Array<Record<string, unknown>> }).items ?? [];
      if (notas.length) {
        const trechos: string[] = [];
        let orcamento = ContextBuilder.MAX_CHARS - partes.join('\n').length;
        for (const n of notas) {
          const titulo = String(n.title ?? n.path ?? 'nota');
          const corpo = String(n.content ?? '').slice(0, ContextBuilder.TRECHO);
          if (orcamento - corpo.length < 0) break;
          orcamento -= corpo.length;
          trechos.push(`### ${titulo}\n${corpo}`);
          fontes.push({
            tipo: 'nota',
            id: String(n.id ?? titulo),
            titulo,
            ref: String(n.path ?? ''),
            score: typeof n.score === 'number' ? Number(n.score.toFixed(3)) : undefined,
          });
        }
        if (trechos.length) partes.push('DA BASE DE CONHECIMENTO:\n' + trechos.join('\n\n'));
      }
    } catch {
      // Busca indisponível não pode derrubar a sessão: o agente responde com
      // as ferramentas e a resposta sai marcada como sem procedência.
    }

    return { blocos: partes.join('\n\n'), fontes };
  }
}
