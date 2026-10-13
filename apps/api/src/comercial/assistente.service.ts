import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TABELA_DE_PRECO, type ComercialProduto } from '@mktos/shared';

import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { comProcedencia } from '../llm/procedencia';
import { PrismaService } from '../prisma/prisma.service';
import type { PayloadDe } from './eventos';
import { ReacoesRegistry } from './fio.service';
import { interpretarDuvida, promptDaDuvida, RESPOSTA_DE_SEGURANCA, RespostaIlegivelError, type FatosDaProposta } from './inteligencia-prompts';
import { SalaService } from './sala.service';

/*
 * O ASSISTENTE DA PROPOSTA (lane E, 13/10/2026) — "tirar uma dúvida" na sala (tela 07).
 *
 * R0: só lê e escreve a resposta dentro da própria sala (nada sai da casa).
 * Reação a `proposta.duvida` (`inteligencia.duvida`): responde SÓ a partir da
 * proposta publicada daquela versão e do diagnóstico; a pergunta do cliente é
 * conteúdo de fora e entra cercada (`cercar`). O que o modelo escreve só sai se
 * todo número dele estiver nos fatos da proposta; senão, e quando o modelo diz
 * que não tem resposta segura, vale a resposta de segurança ("vai para o sócio
 * da sua conta"), e o motivo fica no resultado da reação, que é o registro no
 * fio. Não abre decisão: a dúvida sem resposta aparece para o sócio pela sala.
 *
 * Quem grava a resposta é a sala (`SalaService.responderDuvida`, lane B).
 */

export const REACAO_DA_DUVIDA = 'inteligencia.duvida';
type P = Record<string, unknown>;

@Injectable()
export class AssistenteService implements OnModuleInit {
  private readonly log = new Logger('ComercialAssistente');

  constructor(
    private readonly prisma: PrismaService,
    private readonly reacoes: ReacoesRegistry,
    private readonly sala: SalaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  onModuleInit(): void {
    this.inscrever();
  }

  inscrever(): void {
    this.reacoes.inscrever('proposta.duvida', REACAO_DA_DUVIDA, (ev) => this.responder(ev.orgId, ev.leadId, ev.payload));
  }

  /** Os fatos da versão publicada: o único chão da resposta. */
  async fatos(orgId: string, leadId: string, versao: number): Promise<FatosDaProposta | null> {
    const publicadas = await this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'proposta.publicada' }, orderBy: { occurredAt: 'desc' }, take: 20 });
    const pub = publicadas.find((e) => Number(((e.payload ?? {}) as P).versao) === versao);
    if (!pub) return null;
    const p = (pub.payload ?? {}) as P;
    const produto = String(p.produto) as ComercialProduto;
    const linha = TABELA_DE_PRECO[produto];
    const alt = typeof p.alternativa === 'string' ? TABELA_DE_PRECO[p.alternativa as ComercialProduto] : null;
    const q = (p.quadroDeCustos ?? null) as P | null;
    const diag = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'diagnostico.pronto' }, orderBy: { occurredAt: 'desc' } });
    const dores = Array.isArray(((diag?.payload ?? {}) as P).dores) ? ((((diag!.payload as P).dores) as P[]).map((d) => String(d.texto ?? '')).filter(Boolean)) : [];
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      versao,
      produto: linha?.rotulo ?? produto,
      valorCentavos: n(p.valorCentavos) ?? 0,
      parcelas: n(p.parcelas) ?? 1,
      parcelaCentavos: n(p.parcelaCentavos) ?? 0,
      ultimaParcelaCentavos: n(p.ultimaParcelaCentavos),
      formas: Array.isArray(p.formas) ? p.formas.map(String) : [],
      validaAte: typeof p.validaAte === 'string' ? p.validaAte : null,
      descontoPct: n(p.descontoPct),
      alternativa: alt ? { rotulo: alt.rotulo, valorCentavos: alt.valorCentavos, parcelas: alt.parcelas, parcelaCentavos: alt.parcelaCentavos, formas: [...alt.formas] } : null,
      quadroDeCustos: q ? { mesNormalCentavos: n(q.mesNormalCentavos), piorMesCentavos: n(q.piorMesCentavos) } : null,
      descricao: linha?.descricao ?? '',
      comoEDiferente: typeof p.comoEDiferente === 'string' ? p.comoEDiferente : null,
      dores,
    };
  }

  async responder(orgId: string, leadId: string, d: PayloadDe<'proposta.duvida'>): Promise<unknown> {
    if (d.resposta) return { pulado: 'a dúvida já veio respondida' };
    const fatos = await this.fatos(orgId, leadId, d.versao);
    let resposta = RESPOSTA_DE_SEGURANCA;
    let doModelo = false;
    let motivo: string | null = null;
    let procedencia = null;
    if (!fatos) motivo = `a v${d.versao} não está publicada`;
    else {
      try {
        const { system, user } = promptDaDuvida({ fatos, pergunta: d.pergunta });
        const r = await comProcedencia(() => this.llm.complete({ system, user, orgId, maxTokens: 800 }));
        procedencia = r.procedencia ?? { provider: this.llm.name, modelo: this.llm.model, custoUsd: 0, custoDesconhecido: true, caiuNoStub: false, aviso: null };
        const lida = interpretarDuvida(r.resultado, fatos);
        resposta = lida.resposta;
        doModelo = lida.doModelo;
        motivo = lida.motivo;
      } catch (e) {
        motivo = e instanceof RespostaIlegivelError ? e.message : `o assistente falhou: ${(e as Error).message}`;
        this.log.warn(`dúvida do lead ${leadId}: ${motivo}`);
      }
    }
    await this.sala.responderDuvida(orgId, leadId, { versao: d.versao, pergunta: d.pergunta }, resposta, doModelo ? 'assistente da proposta' : 'assistente (levado ao sócio)');
    return { respondida: true, doModelo, levadaAoSocio: !doModelo, motivo, procedencia };
  }
}
