import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TABELA_DE_PRECO, type ComercialProduto, type OpcaoDeDecisao } from '@mktos/shared';

import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { comProcedencia } from '../llm/procedencia';
import { PrismaService } from '../prisma/prisma.service';
import { DecisoesRegistry, DecisoesService, type DecisaoResolvida } from './decisoes.service';
import { hashDoConteudo, type PayloadDe } from './eventos';
import { ReacoesRegistry } from './fio.service';
import { interpretarDuvida, promptDaDuvida, RESPOSTA_DE_SEGURANCA, RespostaIlegivelError, type FatosDaProposta } from './inteligencia-prompts';
import { chaveDaDuvida } from './sala-projecao';
import { SalaService } from './sala.service';

/*
 * O ASSISTENTE DA PROPOSTA (lane E, 13/10/2026) · "tirar uma dúvida" na sala (tela 07).
 *
 * Reação a `proposta.duvida` (`inteligencia.duvida`): o modelo lê a proposta
 * publicada daquela versão e ESCOLHE qual fato responde a dúvida; a pergunta
 * do cliente é conteúdo de fora e entra cercada (`cercar`).
 *
 * O QUE VAI DIRETO AO CLIENTE (revisão E-2): só a frase que o SISTEMA escreve
 * a partir do fato escolhido (`frasesDosFatos`), ou um texto do modelo que
 * seja literalmente uma dessas frases. Isso é R0: lê e escreve dentro da
 * própria sala, com texto que a proposta publicada já diz.
 *
 * O RESTO VAI A UMA PESSOA: número por extenso, percentual, condição,
 * endereço, frase que não casa com fato, modelo sem resposta segura, falha do
 * modelo. A sala grava a resposta de segurança ("recebemos, a resposta chega
 * por aqui") e abre a decisão `aprovacao_de_envio` na fila do comercial, com a
 * pergunta, a sugestão do modelo e o porquê. A pessoa escolhe "enviar a
 * sugestão" (o texto exato, preso pelo hash, vai para a sala em nome dela) ou
 * "responder por outro canal". O padrão, se ninguém responder, é o segundo:
 * nada do modelo sai sem gente.
 *
 * Quem grava a resposta é a sala (`SalaService.responderDuvida`, lane B).
 */

export const REACAO_DA_DUVIDA = 'inteligencia.duvida';
/** O assunto da decisão `aprovacao_de_envio` aberta pela dúvida (o tipo pode servir a outros envios). */
export const ASSUNTO_DA_DUVIDA = 'duvida_da_sala';
type P = Record<string, unknown>;

@Injectable()
export class AssistenteService implements OnModuleInit {
  private readonly log = new Logger('ComercialAssistente');

  constructor(
    private readonly prisma: PrismaService,
    private readonly reacoes: ReacoesRegistry,
    private readonly sala: SalaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly decisoes: DecisoesService,
    private readonly aoDecidir: DecisoesRegistry,
  ) {}

  onModuleInit(): void {
    this.inscrever();
  }

  inscrever(): void {
    this.reacoes.inscrever('proposta.duvida', REACAO_DA_DUVIDA, (ev) => this.responder(ev.orgId, ev.leadId, ev.payload));
    this.aoDecidir.aoDecidir('aprovacao_de_envio', (d) => this.aplicarDecisao(d), 'inteligencia.duvida-revisada');
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
      quadroDeCustos: q ? { mesNormalCentavos: n(q.mesNormalCentavos), piorMesCentavos: n(q.piorMesCentavos), exemplo: q.exemplo === true || p.quadroDeExemplo === true } : null,
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
    let fato: string | null = null;
    let sugestao: string | null = null;
    let procedencia = null;
    if (!fatos) motivo = `a v${d.versao} não está publicada`;
    else {
      try {
        const { system, user } = promptDaDuvida({ fatos, pergunta: d.pergunta });
        const r = await comProcedencia(() => this.llm.complete({ system, user, orgId, maxTokens: 800 }));
        procedencia = r.procedencia ?? { provider: this.llm.name, modelo: this.llm.model, custoUsd: 0, custoDesconhecido: true, caiuNoStub: false, aviso: null };
        const lida = interpretarDuvida(r.resultado, fatos);
        ({ resposta, doModelo, motivo, fato, sugestao } = lida);
      } catch (e) {
        motivo = e instanceof RespostaIlegivelError ? e.message : `o assistente falhou: ${(e as Error).message}`;
        this.log.warn(`dúvida do lead ${leadId}: ${motivo}`);
      }
    }
    await this.sala.responderDuvida(orgId, leadId, { versao: d.versao, pergunta: d.pergunta }, resposta, doModelo ? 'assistente da proposta' : 'assistente (levado a uma pessoa)');
    const decisaoId = doModelo ? null : await this.levarAUmaPessoa(orgId, leadId, d, sugestao, motivo);
    return { respondida: true, doModelo, levadaAoSocio: !doModelo, fato, motivo, decisaoId, procedencia };
  }

  /** A pendência para uma pessoa: a decisão `aprovacao_de_envio`, com a pergunta, a sugestão do modelo e o porquê. */
  private async levarAUmaPessoa(orgId: string, leadId: string, d: PayloadDe<'proposta.duvida'>, sugestao: string | null, motivo: string | null): Promise<string> {
    const opcoes: OpcaoDeDecisao[] = [];
    if (sugestao) {
      opcoes.push({ chave: 'enviar_sugestao', rotulo: 'Enviar a sugestão do assistente', efeito: 'o texto sugerido, exatamente como está no contexto, vai para a sala do cliente em seu nome' });
    }
    opcoes.push({ chave: 'responder_por_fora', rotulo: 'Responder por outro canal', efeito: 'nada sai pela sala; a sala segue dizendo que a pergunta foi recebida' });
    const pergunta = d.pergunta.replace(/\s+/g, ' ').trim().slice(0, 300);
    const dec = await this.decisoes.abrir({
      orgId,
      leadId,
      tipo: 'aprovacao_de_envio',
      titulo: `Dúvida do cliente na sala (v${d.versao}) espera uma pessoa`,
      contexto: [
        `Pergunta: "${pergunta}".`,
        sugestao ? `Sugestão do assistente: "${sugestao}".` : 'O assistente não sugeriu resposta.',
        `Não foi direto ao cliente porque ${motivo ?? 'o assistente não respondeu'}.`,
        'Padrão se ninguém responder: nada sai pela sala.',
      ].join(' '),
      opcoes,
      padrao: 'responder_por_fora',
      dados: { assunto: ASSUNTO_DA_DUVIDA, versao: d.versao, pergunta: d.pergunta, sugestao, hashDaSugestao: sugestao ? hashDoConteudo({ sugestao }) : null },
      chave: `duvida:${leadId}:${chaveDaDuvida(d.versao, d.pergunta)}`,
    });
    return dec.id;
  }

  /** A pessoa decidiu: "enviar a sugestão" grava o texto exato na sala, em nome dela. O padrão não envia nada. */
  private async aplicarDecisao(d: DecisaoResolvida): Promise<unknown> {
    if (d.dados.assunto !== ASSUNTO_DA_DUVIDA) return { ignorado: 'a decisão não é de dúvida da sala' };
    if (d.escolha !== 'enviar_sugestao' || d.como !== 'tomada') return { enviada: false, escolha: d.escolha };
    const sugestao = typeof d.dados.sugestao === 'string' ? d.dados.sugestao : '';
    if (!sugestao || d.dados.hashDaSugestao !== hashDoConteudo({ sugestao })) return { enviada: false, motivo: 'a sugestão gravada não confere com a decidida' };
    const versao = Number(d.dados.versao);
    const pergunta = String(d.dados.pergunta ?? '');
    await this.sala.responderDuvida(d.orgId, d.leadId, { versao, pergunta }, sugestao, d.por?.nome ?? d.por?.id ?? 'uma pessoa da Root');
    return { enviada: true, por: d.por?.nome ?? d.por?.id ?? null };
  }
}
