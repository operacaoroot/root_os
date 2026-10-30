import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { MemoriaService } from '../memory/memoria.service';
import { COMPLEMENTOS_DOS_AGENTES } from '../agents/roster';

/** A rota de execução de uma capacidade por agente externo (A2). */
export const ROTA_DE_EXECUCAO = 'POST /agents/:slug/capacidades/:id/executar';

/** Uma ferramenta do MCP gerado do catálogo: a capacidade como o agente externo a enxerga. */
export interface FerramentaDoCatalogo {
  /** O id da capacidade — é o nome da ferramenta no MCP. */
  id: string;
  descricao: string;
  nivel: string;
  /** O JSON Schema que a PORTA valida (`argsSchema` do catálogo), ou `null` quando a capacidade não declara. */
  argsSchema: Record<string, unknown> | null;
  /**
   * Por onde a ferramenta sai: `leitura` é o GET de sempre (R0 com rota GET, com
   * o token do corpo e as permissões da pessoa padrão); `execucao` é a rota A2,
   * pela porta.
   */
  caminho: 'leitura' | 'execucao';
  /** `METODO /caminho` que o MCP chama, com `:parametros` a preencher pelos argumentos. */
  rota: string;
  /** Há efeito ligado? Sem ele, a execução é recusada antes da porta (não aparece no MCP). */
  temEfeito: boolean;
}

/*
 * ============================================================================
 * O CATÁLOGO E A DEFINIÇÃO DO AGENTE, PARA QUEM ESTÁ FORA (A3, 30/10/2026)
 * ============================================================================
 *
 * O MCP do modo catálogo (`packages/mcp`, `MCP_MODO=catalogo`) não escreve
 * ferramenta à mão: ele pergunta aqui QUAIS capacidades o agente do token
 * declarou e gera uma ferramenta por capacidade, com o nome = id e o esquema =
 * o `argsSchema` que a porta valida. Tirar uma capacidade da declaração do
 * agente (na tela de Agentes) tira a ferramenta do MCP no próximo arranque — a
 * lista não tem segunda cópia.
 *
 * A política é a da EMPRESA (`PolicyService.resolverCapacidade`), a que vale em
 * runtime — não os JSON do repositório.
 */
@Injectable()
export class CatalogoExternoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PolicyService,
    private readonly efeitos: EfeitosRegistry,
    private readonly memoria: MemoriaService,
  ) {}

  async catalogo(orgId: string, slug: string): Promise<{ agente: string; estado: string; ferramentas: FerramentaDoCatalogo[]; semEfeito: string[] }> {
    const agente = await this.prisma.agent.findFirst({
      where: { orgId, slug },
      select: { slug: true, estado: true, capacidades: true },
    });
    if (!agente) throw new NotFoundException('Agente não encontrado.');
    const ferramentas: FerramentaDoCatalogo[] = [];
    const semEfeito: string[] = [];
    for (const id of agente.capacidades) {
      const c = this.politica.resolverCapacidade(orgId, id) as
        | { id: string; descricao: string; nivel: string; rota?: string; argsSchema?: Record<string, unknown> }
        | null;
      if (!c) continue;
      const leitura = c.nivel === 'R0' && typeof c.rota === 'string' && /^GET\s/i.test(c.rota);
      const temEfeito = this.efeitos.tem(id);
      // Escrita sem efeito ligado não vira ferramenta: o modelo a chamaria e ouviria
      // sempre a mesma recusa. Ela fica listada em `semEfeito`, para quem configura ver.
      if (!leitura && !temEfeito) {
        semEfeito.push(id);
        continue;
      }
      ferramentas.push({
        id,
        descricao: c.descricao,
        nivel: c.nivel,
        argsSchema: c.argsSchema ?? null,
        caminho: leitura ? 'leitura' : 'execucao',
        rota: leitura ? (c.rota as string) : ROTA_DE_EXECUCAO.replace(':slug', slug).replace(':id', id),
        temEfeito,
      });
    }
    return { agente: agente.slug, estado: agente.estado, ferramentas, semEfeito };
  }

  /**
   * A DEFINIÇÃO: missão, procedimento e voz. É o que o corpo de fora põe no
   * prompt do agente, e vem DAQUI para que a tela de Agentes continue sendo onde
   * se muda o procedimento — e não um arquivo de configuração no Hermes.
   *
   * A VOZ: a nota `voz.<slug>` da memória, quando existe e a pessoa pode lê-la;
   * senão, a voz de nascimento do código (`complementos.ts`). O campo `fonte` diz
   * qual das duas veio, para ninguém confundir a padrão com a afinada.
   */
  async definicao(orgId: string, slug: string, leitorId: string | null) {
    const agente = await this.prisma.agent.findFirst({
      where: { orgId, slug },
      select: { id: true, slug: true, nome: true, missao: true, estado: true, autonomiaAte: true, capacidades: true },
    });
    if (!agente) throw new NotFoundException('Agente não encontrado.');
    const sop = await this.prisma.sop.findFirst({
      where: { orgId, agentId: agente.id },
      select: { proposito: true, gatilho: true, passos: true, definicaoDePronto: true, observacoes: true, versao: true },
    });
    const chaveDaVoz = `voz.${slug}`;
    let voz: { fonte: 'memoria' | 'cadastro' | null; chave: string; texto: string | null } = { fonte: null, chave: chaveDaVoz, texto: null };
    try {
      const nota = leitorId ? await this.memoria.porChave(orgId, chaveDaVoz, leitorId) : null;
      if (nota?.body?.trim()) voz = { fonte: 'memoria', chave: chaveDaVoz, texto: nota.body };
    } catch {
      // Sem permissão de ler a memória, a voz cai na de nascimento — nunca derruba a definição.
    }
    if (!voz.texto) {
      const doCodigo = COMPLEMENTOS_DOS_AGENTES[slug]?.voz ?? null;
      if (doCodigo) voz = { fonte: 'cadastro', chave: chaveDaVoz, texto: doCodigo };
    }
    return {
      slug: agente.slug,
      nome: agente.nome,
      missao: agente.missao,
      estado: agente.estado,
      autonomiaAte: agente.autonomiaAte,
      procedimento: sop,
      voz,
      capacidades: agente.capacidades,
    };
  }
}
