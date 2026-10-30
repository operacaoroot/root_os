import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  ATA_PREFIXO_DA_CHAVE,
  GRANOLA_DIAS_DA_LISTA,
  refDaAta,
  refDaTranscricaoDoGranola,
  type TrabAtaDetalhe,
  type TrabGranolaAtaGerada,
  type TrabGranolaReunioes,
} from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import { cardsParaCasar, clienteDaReuniao, levarReuniaoDiretaParaFicha, reuniaoDoGranolaNaFicha } from '../../ficha/granola.service';
import { ConectorDesligadoError } from '../../integrations/conectores.service';
import { LLM_PROVIDER, TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA, type LlmProvider, type LlmStepOutput } from '../../llm/llm.provider';
import { MemoriaService } from '../../memory/memoria.service';
import { normalizarParaBusca } from '../../onboarding/trilho/leitor-de-ata';
import { varrerSegredos } from '../../onboarding/trilho/segredos';
import { umaPorVez } from '../../pauta/uma-por-vez';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AtasService,
  PREFIXO_DA_PROCEDENCIA_DO_DRIVE,
  PREFIXO_DA_PROCEDENCIA_DO_GRANOLA,
  type AcessoAsAtas,
  type QuemDecide,
} from './atas.service';
import {
  FONTE_DO_GRANOLA,
  type FonteDoGranola,
  GranolaIndisponivelError,
  GranolaNaoConectadoError,
  ID_DE_REUNIAO_DO_GRANOLA,
} from './fonte-do-granola';
import { SugestoesIlegiveisError, metadadosDaAta, slugDaAta } from './leitor-de-atas';
import { interpretarAtaDoGranola, markdownDaAta, promptDaAtaDoGranola, type LeituraDaAtaDoGranola } from './leitor-do-granola';

/* ==========================================================================
 * AS REUNIÕES DO GRANOLA NO BANCO DE ATAS (rodada da interface, 20/10/2026)
 * ==========================================================================
 *
 * "Gerar ata": o OS puxa a TRANSCRIÇÃO pelo conector direto (`FONTE_DO_GRANOLA`),
 * mascara os segredos, pede ao modelo a ata e as sugestões num pedido só (sob o
 * teto da empresa e o `umaPorVez`), e o parser decide o que vale
 * (`leitor-do-granola.ts`). Depois:
 *   · a ATA vira nota da memória pelo `MemoriaService` (ADR-011): chave
 *     `ata:<data>-<slug>`, procedência `granola:<id da reunião>`. Gerar de novo
 *     é VERSÃO NOVA DA MESMA NOTA, achada pela procedência, nunca outra nota;
 *   · as SUGESTÕES entram em `AtaSugestao`, em rascunho, com `ataRef` apontando
 *     para a nota (a mesma tarefa lida de novo não vira segundo rascunho);
 *   · a REUNIÃO vai para a ficha do cliente quando ele é reconhecido, pelas
 *     regras e funções do Zap (`ficha/granola.service.ts`), sem duplicar o que
 *     o Zap já trouxe (o id da reunião é a chave).
 *
 * A TRANSCRIÇÃO BRUTA NÃO É GRAVADA, a mesma regra do leitor de ata do
 * onboarding: nem no banco, nem no log, nem no RASTRO. Ela vive só dentro de
 * `gerarAgora`. O que fica é o hash (sha256 da transcrição mascarada), o
 * tamanho, o custo e a procedência, na seção "Procedência" da ata e na
 * auditoria. Os trechos de cada sugestão (até 400 caracteres, conferidos e
 * mascarados) são citação, como na ata colada. "Reprocessar" puxa de novo do
 * Granola.
 *
 * Gente, não máquina: as mesmas trancas do banco de atas (guarda do token no
 * controller e `exigirGente` pelo banco antes de gastar IA).
 */

/*
 * O mesmo teto do `complete()` (16 mil), e não 6 mil: na Anthropic o `max_tokens`
 * do `step()` cobre o pensamento adaptativo E a resposta. Com 6 mil, a reunião
 * longa (a de 29/10/2026 tinha 127 mil caracteres) esgotava o limite no meio da
 * lista de sugestões, e a tela mostrava "não é o JSON combinado" (30/10/2026).
 */
const SAIDA_DA_LEITURA = TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA;
const MIN_CARACTERES_DA_TRANSCRICAO = 50;

const diaEmSaoPaulo = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export const RECUSA_SEM_GRANOLA = 'Conecte o Granola em Configurações › Integrações para ler as reuniões daqui.';

/** Uma transcrição para virar ata, do Granola ou do Drive (P7). O texto vive só na chamada. */
interface TranscricaoParaAta {
  fonte: 'granola' | 'drive';
  id: string;
  titulo: string;
  /** AAAA-MM-DD do dia da reunião. */
  data: string | null;
  /** A hora da reunião (só o Granola diz; a ficha usa). */
  em: Date | null;
  participantes: string[];
  emails: string[];
  link: string | null;
  transcricao: string;
  /** Do Drive, a varredura já rodou ao abrir: soma na procedência. */
  segredosJaMascarados: number;
}

@Injectable()
export class AtasDoGranolaService {
  private readonly log = new Logger('AtasDoGranola');

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoria: MemoriaService,
    private readonly atas: AtasService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    /** `@Optional()`: sem o módulo do conector montado, o bloco diz "conecte o Granola" e nada quebra. */
    @Optional() @Inject(FONTE_DO_GRANOLA) private readonly fonte?: FonteDoGranola,
  ) {}

  // ==========================================================================
  // A LISTA
  // ==========================================================================

  async reunioes(orgId: string): Promise<TrabGranolaReunioes> {
    const base = { reunioes: [], iaConfigurada: this.llm.configured };
    if (!this.fonte || !(await this.fonte.conectado(orgId))) {
      return { ...base, conectado: false, desligado: false, motivo: RECUSA_SEM_GRANOLA };
    }
    let lista: Awaited<ReturnType<FonteDoGranola['listarReunioes']>>;
    try {
      lista = await this.fonte.listarReunioes(orgId, { dias: GRANOLA_DIAS_DA_LISTA });
    } catch (e) {
      if (e instanceof ConectorDesligadoError) {
        return { ...base, conectado: true, desligado: true, motivo: 'O Granola está desligado em Conexões. Religue lá para ler as reuniões.' };
      }
      if (e instanceof GranolaNaoConectadoError) return { ...base, conectado: false, desligado: false, motivo: e.message };
      if (e instanceof GranolaIndisponivelError || e instanceof Error) {
        this.log.warn(`${orgId}: a lista de reuniões do Granola falhou: ${e.message.slice(0, 200)}`);
        return { ...base, conectado: true, desligado: false, motivo: e.message.slice(0, 300) };
      }
      throw e;
    }
    const validas = lista.filter((r) => ID_DE_REUNIAO_DO_GRANOLA.test(r.id));
    const marcas = validas.map((r) => `${PREFIXO_DA_PROCEDENCIA_DO_GRANOLA}${r.id}`);
    const [cards, atas, naFicha] = await Promise.all([
      cardsParaCasar(this.prisma, orgId),
      marcas.length
        ? this.prisma.contextItem.findMany({
            where: { orgId, sourceRef: { in: marcas }, chave: { startsWith: ATA_PREFIXO_DA_CHAVE }, arquivadoEm: null },
            select: { id: true, sourceRef: true, versao: true },
          })
        : Promise.resolve([]),
      Promise.all(validas.map((r) => reuniaoDoGranolaNaFicha(this.prisma, orgId, r.id))),
    ]);
    const ataDe = new Map(atas.map((a) => [a.sourceRef, a]));
    return {
      ...base,
      conectado: true,
      desligado: false,
      motivo: null,
      reunioes: validas.map((r, i) => {
        const ata = ataDe.get(`${PREFIXO_DA_PROCEDENCIA_DO_GRANOLA}${r.id}`);
        return {
          id: r.id,
          titulo: r.titulo,
          em: r.em,
          participantes: r.participantes,
          cliente: clienteDaReuniao(r, cards),
          ataRef: ata ? refDaAta('colada', ata.id) : null,
          ataVersao: ata?.versao ?? null,
          naFicha: !!naFicha[i],
        };
      }),
    };
  }

  // ==========================================================================
  // GERAR A ATA — da transcrição, num pedido só
  // ==========================================================================

  async gerarAta(orgId: string, quem: QuemDecide, granolaId: string): Promise<TrabGranolaAtaGerada> {
    if (!ID_DE_REUNIAO_DO_GRANOLA.test(String(granolaId ?? ''))) throw new NotFoundException('Reunião do Granola não encontrada.');
    // Antes do `umaPorVez` e do modelo: conta de máquina não gasta IA nem ocupa a vez.
    await this.atas.exigirGente(orgId, quem);
    return umaPorVez(`trabalho-atas-granola:${orgId}:${granolaId}`, 'A ata desta reunião', () => this.gerarAgora(orgId, quem.id, granolaId));
  }

  /** "Reprocessar" de uma ata que veio do Granola: o id sai da procedência da nota. */
  async reprocessar(orgId: string, quem: QuemDecide, granolaId: string): Promise<TrabGranolaAtaGerada> {
    return this.gerarAta(orgId, quem, granolaId);
  }

  // ==========================================================================
  // A TRANSCRIÇÃO ABERTA na tela (P7): lida agora, mascarada, nunca gravada
  // ==========================================================================

  /** A transcrição de uma reunião do Granola, para a coluna da direita. Nada dela é gravado. */
  async lerTranscricao(orgId: string, granolaId: string): Promise<TrabAtaDetalhe> {
    if (!ID_DE_REUNIAO_DO_GRANOLA.test(String(granolaId ?? ''))) throw new NotFoundException('Reunião do Granola não encontrada.');
    if (!this.fonte) throw new BadRequestException(RECUSA_SEM_GRANOLA);
    let reuniao: Awaited<ReturnType<FonteDoGranola['lerReuniao']>>;
    try {
      reuniao = await this.fonte.lerReuniao(orgId, granolaId);
    } catch (e) {
      if (e instanceof ConectorDesligadoError) throw new BadRequestException('O Granola está desligado em Conexões. Religue lá para ler as reuniões.');
      if (e instanceof GranolaNaoConectadoError) throw new BadRequestException(e.message);
      if (e instanceof GranolaIndisponivelError) throw new ServiceUnavailableException(e.message);
      throw e;
    }
    const texto = varrerSegredos(String(reuniao.transcricao ?? '').replace(/\r\n/g, '\n').trim()).texto;
    const em = reuniao.em ? new Date(reuniao.em) : null;
    const valida = em && !Number.isNaN(em.getTime()) ? em : null;
    const ata = await this.prisma.contextItem.findFirst({
      where: { orgId, sourceRef: `${PREFIXO_DA_PROCEDENCIA_DO_GRANOLA}${granolaId}`, chave: { startsWith: ATA_PREFIXO_DA_CHAVE }, arquivadoEm: null },
      orderBy: { criadoEm: 'asc' },
      select: { id: true },
    });
    return {
      id: refDaTranscricaoDoGranola(granolaId),
      fonte: 'granola',
      tipo: 'transcricao',
      titulo: varrerSegredos(reuniao.titulo).texto,
      data: valida ? diaEmSaoPaulo(valida) : null,
      participantes: reuniao.participantes.map((p) => varrerSegredos(p).texto),
      resumo: '',
      caminho: null,
      sugestoes: { rascunho: 0, aceitas: 0, descartadas: 0 },
      decididas: [],
      granolaId,
      link: reuniao.link,
      ataGerada: ata ? refDaAta('colada', ata.id) : null,
      atualizadaEm: (valida ?? new Date(0)).toISOString(),
      texto: texto || 'Esta reunião ainda não tem transcrição no Granola.',
      procedencia: 'Granola: a transcrição é lida agora e não fica guardada no OS.',
      sugestoesDaAta: [],
      decisoes: [],
      pendencias: [],
      versao: null,
    };
  }

  // ==========================================================================
  // GERAR A ATA DE UMA TRANSCRIÇÃO DO DRIVE (P7) — o mesmo pedido, a mesma régua
  // ==========================================================================

  async gerarAtaDoDrive(orgId: string, quem: QuemDecide, fileId: string, acesso: AcessoAsAtas): Promise<TrabGranolaAtaGerada> {
    if (!/^[A-Za-z0-9_-]{10,120}$/.test(String(fileId ?? ''))) throw new NotFoundException('Arquivo do Drive não encontrado.');
    await this.atas.exigirGente(orgId, quem);
    return umaPorVez(`trabalho-atas-drive:${orgId}:${fileId}`, 'A ata desta transcrição', async () => {
      const lida = await this.atas.lerDoDrive(orgId, fileId, { ...acesso, actorId: quem.id });
      if (lida.tipo !== 'transcricao') throw new BadRequestException('Este arquivo é uma ata, não uma transcrição: use "Sugerir tarefas".');
      const data = metadadosDaAta('', lida.caminho).data ?? (lida.atualizadaEm.getTime() > 0 ? diaEmSaoPaulo(lida.atualizadaEm) : null);
      return this.escreverAta(orgId, quem.id, {
        fonte: 'drive',
        id: fileId,
        titulo: lida.titulo,
        data,
        em: null,
        participantes: metadadosDaAta(lida.texto).participantes,
        emails: [],
        link: lida.link ?? null,
        transcricao: lida.texto,
        segredosJaMascarados: lida.segredosMascarados ?? 0,
      });
    });
  }

  private async gerarAgora(orgId: string, actorId: string, granolaId: string): Promise<TrabGranolaAtaGerada> {
    if (!this.fonte) throw new BadRequestException(RECUSA_SEM_GRANOLA);
    if (!this.llm.configured) throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);

    // A TRANSCRIÇÃO: só nesta função, e mascarada antes de qualquer outra coisa.
    let reuniao: Awaited<ReturnType<FonteDoGranola['lerReuniao']>>;
    try {
      reuniao = await this.fonte.lerReuniao(orgId, granolaId);
    } catch (e) {
      if (e instanceof GranolaNaoConectadoError) throw new BadRequestException(e.message);
      if (e instanceof GranolaIndisponivelError) throw new ServiceUnavailableException(e.message);
      throw e;
    }
    const em = reuniao.em ? new Date(reuniao.em) : null;
    const valida = em && !Number.isNaN(em.getTime()) ? em : null;
    return this.escreverAta(orgId, actorId, {
      fonte: 'granola',
      id: granolaId,
      titulo: reuniao.titulo,
      data: valida ? diaEmSaoPaulo(valida) : null,
      em: valida,
      participantes: reuniao.participantes,
      emails: reuniao.emails,
      link: reuniao.link,
      transcricao: reuniao.transcricao,
      segredosJaMascarados: 0,
    });
  }

  /**
   * A ata de uma TRANSCRIÇÃO, venha do Granola ou do Drive: mascara, pede ao
   * modelo num pedido só, o parser confere, a ata vira nota da memória (versão
   * nova da mesma nota quando a transcrição já tem ata) e as sugestões entram em
   * rascunho. A reunião vai à ficha do cliente só quando veio do Granola.
   */
  private async escreverAta(orgId: string, actorId: string, entrada: TranscricaoParaAta): Promise<TrabGranolaAtaGerada> {
    if (!this.llm.configured) throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    const granolaId = entrada.id;
    const varredura = varrerSegredos(String(entrada.transcricao ?? '').replace(/\r\n/g, '\n').trim());
    const transcricao = varredura.texto;
    const segredosMascarados = varredura.removidos + entrada.segredosJaMascarados;
    if (Array.from(transcricao).length < MIN_CARACTERES_DA_TRANSCRICAO) {
      throw new BadRequestException(
        entrada.fonte === 'drive'
          ? 'Este arquivo do Drive é curto demais para ser uma transcrição.'
          : 'Esta reunião ainda não tem transcrição no Granola (ou o plano da conta não libera a transcrição).',
      );
    }
    const caracteres = Array.from(transcricao).length;
    const sha256 = createHash('sha256').update(transcricao, 'utf8').digest('hex');
    const em = entrada.em;
    const data = entrada.data;
    const participantes = entrada.participantes.map((p) => varrerSegredos(p).texto);
    const paraAta = { granolaId, titulo: varrerSegredos(entrada.titulo).texto, data, participantes, fonte: entrada.fonte };

    const [listas, pessoas] = await Promise.all([this.atas.listasDaEmpresa(orgId), this.atas.pessoasDaEmpresa(orgId)]);
    const { system, user, cortada } = promptDaAtaDoGranola({ reuniao: paraAta, transcricao, listas, pessoas });

    let saida: LlmStepOutput;
    try {
      saida = await this.llm.step({ funcao: 'TR-02', system, turns: [{ role: 'user', text: user }], orgId, maxTokens: SAIDA_DA_LEITURA });
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ConflictException || e instanceof ForbiddenException) throw e;
      const msg = `o leitor de reuniões não conseguiu chamar o modelo: ${(e as Error).message}`.slice(0, 300);
      this.log.warn(`${orgId} ${entrada.fonte}:${granolaId}: ${msg}`);
      throw new ServiceUnavailableException(msg);
    }

    if (saida.stopReason === 'max_tokens') {
      const msg =
        `a leitura da reunião passou do limite de ${SAIDA_DA_LEITURA} tokens de saída e veio cortada; ` +
        'nada foi gravado. Tente de novo ou leia a reunião em partes.';
      this.log.warn(`${orgId} ${entrada.fonte}:${granolaId}: ${msg}`);
      throw new ServiceUnavailableException(msg);
    }

    let leitura: LeituraDaAtaDoGranola;
    try {
      leitura = interpretarAtaDoGranola(saida.text, { transcricao, listas, pessoas, referencia: data ?? diaEmSaoPaulo(new Date()) });
    } catch (e) {
      if (e instanceof SugestoesIlegiveisError) throw new ServiceUnavailableException(e.message);
      throw e;
    }
    const custoUsd = Number.isFinite(saida.usage?.custoUsd) ? saida.usage.custoUsd : 0;
    const modelo = saida.usage?.modeloServido || this.llm.model;
    const corpo = markdownDaAta(paraAta, leitura, { caracteres, sha256, segredosMascarados, modelo, custoUsd, cortada });
    const avisos = [...(cortada ? ['a transcrição é longa e entrou cortada na leitura'] : []), ...leitura.avisos];

    // A ATA na memória: versão nova da MESMA nota quando a reunião já tem ata.
    const doDrive = entrada.fonte === 'drive';
    const marca = `${doDrive ? PREFIXO_DA_PROCEDENCIA_DO_DRIVE : PREFIXO_DA_PROCEDENCIA_DO_GRANOLA}${granolaId}`;
    const existente = await this.prisma.contextItem.findFirst({
      where: { orgId, sourceRef: marca, chave: { startsWith: ATA_PREFIXO_DA_CHAVE }, arquivadoEm: null },
      orderBy: { criadoEm: 'asc' },
      select: { id: true },
    });
    const nota = existente
      ? await this.memoria.alterar(orgId, existente.id, {
          title: paraAta.titulo,
          body: corpo,
          sourceType: ContextSource.conector,
          sourceRef: marca,
          motivo: doDrive ? 'ata reprocessada da transcrição do Drive' : 'ata reprocessada da transcrição do Granola',
        })
      : await this.criarNota(orgId, paraAta.titulo, data, corpo, marca, entrada.fonte);

    // AS SUGESTÕES: a mesma tarefa lida de novo não vira segundo rascunho (vale o título, sem caixa nem acento).
    const ataRef = refDaAta('colada', nota.id);
    const ja = new Set(
      (await this.prisma.ataSugestao.findMany({ where: { orgId, ataRef }, select: { titulo: true } })).map((x) => normalizarParaBusca(x.titulo)),
    );
    const novas = leitura.sugestoes.filter((x) => !ja.has(normalizarParaBusca(x.titulo)));
    const repetidas = leitura.sugestoes.length - novas.length;
    const criadas = novas.length
      ? await this.prisma.$transaction(
          novas.map((x) =>
            this.prisma.ataSugestao.create({
              data: {
                orgId,
                ataRef,
                titulo: varrerSegredos(x.titulo).texto,
                listaId: x.listaId,
                donoSugerido: x.donoSugerido,
                vencimento: x.vencimento ? new Date(`${x.vencimento}T12:00:00.000Z`) : null,
                trecho: varrerSegredos(x.trecho).texto,
                estado: 'rascunho',
                criadaPor: actorId,
              },
            }),
          ),
        )
      : [];

    // A FICHA: pelo caminho do Zap, sem duplicar o que ele já trouxe. Só a reunião do Granola vai à ficha.
    const ficha: { ficha: TrabGranolaAtaGerada['ficha']; cliente: TrabGranolaAtaGerada['cliente'] } = doDrive
      ? { ficha: 'nao_se_aplica', cliente: null }
      : await levarReuniaoDiretaParaFicha(this.prisma, orgId, {
          granolaId,
          titulo: paraAta.titulo,
          em: em && !Number.isNaN(em.getTime()) ? em : new Date(),
          participantes,
          emails: entrada.emails,
          link: entrada.link,
          ata: corpo,
          autorId: actorId,
        });

    await this.audit.log({
      orgId,
      actorId,
      action: doDrive ? 'trabalho.ata.drive_gerada' : 'trabalho.ata.granola_gerada',
      entityType: 'ata',
      entityId: ataRef,
      // Só a forma: nem a transcrição nem os trechos entram na auditoria.
      after: {
        procedencia: marca,
        versao: nota.versao,
        nova: !existente,
        transcricao: { caracteres, sha256, segredosMascarados, cortada },
        custoUsd,
        modelo,
        criadas: criadas.length,
        repetidas,
        descartadasPeloParser: leitura.descartadas,
        ficha: ficha.ficha,
      },
    });

    return {
      ata: await this.atas.ler(orgId, ataRef, { vault: false }),
      nova: !existente,
      versao: nota.versao,
      criadas: await this.atas.paraDtos(orgId, criadas),
      repetidas,
      avisos,
      cliente: ficha.cliente,
      ficha: ficha.ficha,
    };
  }

  private async criarNota(orgId: string, titulo: string, data: string | null, corpo: string, marca: string, fonte: 'granola' | 'drive' = 'granola') {
    const base = `${ATA_PREFIXO_DA_CHAVE}${data ?? 'sem-data'}-${slugDaAta(titulo)}`;
    for (let n = 1; n <= 20; n++) {
      const chave = n === 1 ? base : `${base}-${n}`;
      if (await this.memoria.porChave(orgId, chave)) continue;
      try {
        return await this.memoria.criar(orgId, {
          chave,
          kind: ContextKind.nota,
          title: titulo,
          body: corpo,
          tags: ['ata', 'trabalho', fonte],
          sourceType: ContextSource.conector,
          sourceRef: marca,
          motivo: fonte === 'drive' ? 'ata gerada da transcrição do Drive em Trabalho › Atas' : 'ata gerada da transcrição do Granola em Trabalho › Atas',
        });
      } catch (e) {
        if (e instanceof ConflictException) continue;
        throw e;
      }
    }
    throw new ConflictException('Já existem atas demais com esse título nesse dia.');
  }
}
