import { PautaVozHumanoPainelSchema, type PautaVozHumanoPainel, type PautaVozSalvarHumanoInput, type PautaVozChaveHumanaInput, type PautaEscritaHumanaResultado } from '@mktos/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, ContextKind, ContextSource } from '@prisma/client';
import {
  PAUTA_CHAVE_DA_CHAVE_DA_VOZ,
  PAUTA_CHAVE_DA_VOZ_PADRAO,
  PAUTA_VOZ_REGRAS_DA_MARCA,
  PautaChaveDaVozSchema,
  apelidoDoEpisodio,
  type PautaVozAprendida,
  type PautaVozAprenderInput,
  type PautaVozPainel,
  type PautaVozSalvarInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService, type NotaDeContexto, type IdentidadeDaDerivacao, type PlanoInternoDeFontesDaDerivacao, type LeitorFisicoDaDerivacao, type CompromissoDaDerivacao } from '../memory/memoria.service';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { rotuloDeProcedencia } from '../memory/procedencia';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import {
  SYSTEM_VOZ,
  TOM_DA_CASA,
  VozInvalidaError,
  blocoDeVoz,
  chaveDaVozDaNota,
  entradaDaVoz,
  lerPerfilDaIa,
  materialDaVoz,
  montarPerfil,
  procedenciaDaVoz,
  procedenciaDoPerfil,
  type FonteDaVoz,
} from './voz-da-pauta';
import { umaPorVez } from './uma-por-vez';

const TITULO_DO_PERFIL = 'Voz do autor (pauta)';
const TITULO_DA_CHAVE = 'Chave da voz da pauta';
const HISTORICO_NO_PAINEL = 10;
const EPISODIOS_NO_PAINEL = 30;

interface MaterialEscolhidoDaVoz {
  chave: string; origem: 'empresa' | 'padrao'; material: ReturnType<typeof materialDaVoz>;
  apelidos: string[]; textos: number; texto: string; provider: string; model: string; configured: boolean;
}
interface SelecaoDaVoz { episodioIds: string[] }

/*
 * A VOZ DO AUTOR (MC10). O perfil é uma nota da memória — lida por `porChave`
 * e escrita SÓ por `MemoriaService` (criar/alterar/restaurar), que é o caminho
 * da ADR-011: evento no RASTRO, versão nova, a anterior no histórico. Nada aqui
 * toca `ContextItem` direto.
 *
 * Perfil novo substitui o anterior como VERSÃO da mesma nota (chave fixa), e
 * não por `supersedesId`: aquele campo liga notas DIFERENTES que se contradizem
 * (RF-M-08); aqui é a mesma afirmação reescrita, e o histórico guarda cada uma.
 */
@Injectable()
export class VozService {
  private readonly log = new Logger('VozService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly memoria: MemoriaService,
  ) {}

  /**
   * A chave desta empresa: a da nota de configuração, senão `voz.pedro`. Erro
   * da memória SOBE: os caminhos de escrita não podem gravar na chave padrão
   * por engano. Quem tolera (a leitura do bloco) é `vigente`.
   */
  async chave(orgId: string): Promise<{ chave: string; origem: 'empresa' | 'padrao' }> {
    const c = chaveDaVozDaNota(await this.memoria.porChave(orgId, PAUTA_CHAVE_DA_CHAVE_DA_VOZ));
    return c ? { chave: c, origem: 'empresa' } : { chave: PAUTA_CHAVE_DA_VOZ_PADRAO, origem: 'padrao' };
  }

  /** A nota vigente, ou nulo (sem nota, arquivada, vazia, memória fora do ar). */
  private async vigente(orgId: string): Promise<NotaDeContexto | null> {
    try {
      const { chave } = await this.chave(orgId);
      const nota = await this.memoria.porChave(orgId, chave);
      if (!nota || nota.arquivadoEm || !nota.body.trim()) return null;
      return nota;
    } catch (e) {
      // Memória fora do ar não trava a escrita: cai no tom da casa, com o aviso no log.
      this.log.warn(`perfil de voz de ${orgId}: memória indisponível (${(e as Error).message})`);
      return null;
    }
  }

  /** O corpo do perfil vigente, ou nulo. */
  async perfil(orgId: string): Promise<string | null> {
    return (await this.vigente(orgId))?.body.trim() ?? null;
  }

  /**
   * O bloco de voz que os prompts da pauta recebem. Sem perfil, `semPerfil`:
   * o tom da casa no roteiro; vazio nas peças, que ficam no SYSTEM_PECAS.
   */
  async bloco(orgId: string, semPerfil: string = TOM_DA_CASA): Promise<string> {
    const nota = await this.vigente(orgId);
    return blocoDeVoz(nota?.body, { procedencia: nota ? procedenciaDoPerfil(nota) : undefined, semPerfil });
  }


  async painelHumano(orgId: string, actorId: string): Promise<PautaVozHumanoPainel> {
    const r = await this.memoria.lerDestinosHumanos(orgId, actorId, { tipo: 'voz' });
    if (!r.configuracao) throw new ConflictException('A configuração da voz não pôde ser conferida.');
    const n = r.notas.perfil; const painel = await this.painel(orgId);
    painel.chave = r.configuracao.chaveEfetiva; painel.origemDaChave = r.configuracao.origemEfetiva;
    painel.perfil = n ? { id: n.id, corpo: n.body, versao: n.versao, procedencia: n.procedencia,
      sourceType: n.sourceType, sourceRef: n.sourceRef, atualizadoEm: n.atualizadoEm, arquivado: !!n.arquivadoEm } : null;
    const final = await this.memoria.reconferirDestinosHumanos(orgId, actorId, { tipo: 'voz' }, r);
    return PautaVozHumanoPainelSchema.parse({ contrato: 1, escopo: final.escopo, autoridade: final.autoridade,
      observadoEm: final.observadoEm, painel, destinos: r.destinos, configuracao: r.configuracao });
  }
  async salvarHumano(orgId: string, actorId: string, entrada: PautaVozSalvarHumanoInput): Promise<PautaEscritaHumanaResultado> {
    const corpo = entrada.perfil.replace(/\r\n?/g, '\n').trim();
    const r = await this.memoria.gravarPautaHumana(orgId, actorId, { acao: 'salvar_voz', chaveVozEsperada: entrada.chaveVozEsperada }, entrada,
      { kind: ContextKind.definicao, title: TITULO_DO_PERFIL, body: corpo, tags: ['pauta', 'voz'], sourceType: ContextSource.operador,
        sourceRef: 'pauta.voz · edição manual', motivo: entrada.motivo || 'perfil de voz editado à mão' });
    await this.audit.log({ orgId, actorId, action: 'pauta.voz_editada', entityType: 'context_item', entityId: r.edicao.itemId,
      after: { versao: r.edicao.versao, caracteres: corpo.length } }); return this.memoria.reconferirResultadoHumanoDoProdutor(orgId, actorId, r);
  }
  async definirChaveHumana(orgId: string, actorId: string, entrada: PautaVozChaveHumanaInput): Promise<PautaEscritaHumanaResultado> {
    const chave = PautaChaveDaVozSchema.parse(entrada.chave);
    const r = await this.memoria.gravarPautaHumana(orgId, actorId, { acao: 'mudar_chave_voz', chaveEfetivaEsperada: entrada.chaveEfetivaEsperada }, entrada,
      { kind: ContextKind.definicao, title: TITULO_DA_CHAVE, body: chave, tags: ['pauta', 'voz'], sourceType: ContextSource.operador,
        sourceRef: 'pauta.voz · chave', motivo: 'a voz da pauta passa a ler outra chave (MC10)' });
    await this.audit.log({ orgId, actorId, action: 'pauta.voz_chave', entityType: 'context_item', entityId: r.edicao.itemId,
      after: { mudou: chave !== entrada.chaveEfetivaEsperada, versao: r.edicao.versao } }); return this.memoria.reconferirResultadoHumanoDoProdutor(orgId, actorId, r);
  }

  async painel(orgId: string): Promise<PautaVozPainel> {
    const { chave, origem } = await this.chave(orgId);
    const nota = await this.memoria.porChave(orgId, chave);
    const historico = nota ? (await this.memoria.historico(orgId, nota.id)).slice(0, HISTORICO_NO_PAINEL) : [];
    // O tamanho sai do banco: a transcrição inteira tem até 120 mil caracteres por episódio.
    const episodios = await this.prisma.$queryRaw<Array<{ id: string; numero: number; titulo: string; caracteres: number }>>`
      SELECT id, numero, titulo, length("transcricaoTexto")::int AS caracteres
        FROM "PautaEpisodio"
       WHERE "orgId" = ${orgId} AND "transcricaoTexto" <> ''
       ORDER BY numero DESC
       LIMIT ${EPISODIOS_NO_PAINEL}`;
    return {
      chave,
      origemDaChave: origem,
      perfil: nota
        ? {
            id: nota.id,
            corpo: nota.body,
            versao: nota.versao,
            procedencia: nota.procedencia,
            sourceType: nota.sourceType,
            sourceRef: nota.sourceRef,
            atualizadoEm: nota.atualizadoEm,
            arquivado: Boolean(nota.arquivadoEm),
          }
        : null,
      historico: historico.map((v) => ({
        versao: v.versao,
        mudanca: v.mudanca,
        procedencia: v.procedencia,
        motivo: v.motivo,
        criadoEm: v.criadoEm,
      })),
      regrasDaMarca: PAUTA_VOZ_REGRAS_DA_MARCA,
      episodios: episodios.map((e) => ({
        id: e.id,
        apelido: apelidoDoEpisodio(Number(e.numero)),
        titulo: e.titulo,
        caracteres: Number(e.caracteres),
      })),
      iaConfigurada: this.llm.configured,
    };
  }

  /**
   * A IA destila o perfil das transcrições e dos textos colados, e ele vira a
   * versão nova da nota. Resposta fora do formato é 503 sem gravar nada.
   */
  aprender(orgId: string, actorId: string, entrada: PautaVozAprenderInput): Promise<PautaVozAprendida> {
    return umaPorVez(`pauta-voz:${orgId}`, 'O aprendizado da voz', () => this.aprenderAgora(orgId, actorId, entrada));
  }

  private async aprenderAgora(orgId: string, actorId: string, entrada: PautaVozAprenderInput): Promise<PautaVozAprendida> {
    const identidade = this.identidadeHumana(orgId, actorId);
    if (!this.llm.configured) throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    const pedido = structuredClone(entrada);
    // Esta leitura é apenas pista; o plano confere a configuração física no tx.
    const { chave } = await this.chave(orgId);
    const observada = await this.prisma.$transaction(async (tx) => {
      const r = await this.memoria.observarDestinoDaDerivacaoNoTx(tx, orgId, identidade,
        { tipo: 'A4-VOZ', chave }, this.planoDaVoz(orgId, chave, pedido));
      const existente = await tx.contextItem.findFirst({ where: { orgId, chave }, select: { id: true } });
      return { ...r, criarComTags: !existente };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const m = observada.material;
    this.identidadeHumana(orgId, actorId);
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['obsidian.ver', 'pauta.editar', 'automacoes.executar']);
    this.conferirModeloEscolhido(m);
    const saida = await this.llm.complete({ funcao: 'CT-09', system: SYSTEM_VOZ, user: m.texto, orgId, maxTokens: SAIDA_DA_GERACAO_LONGA });
    let corpo: string;
    try { corpo = montarPerfil(lerPerfilDaIa(saida)); }
    catch (err) {
      if (err instanceof VozInvalidaError) { this.log.warn(`voz de ${orgId}: ${err.message}`); throw new ServiceUnavailableException(err.message); }
      throw err;
    }
    const compromisso = await this.prisma.$transaction((tx) => this.memoria.aplicarDerivacaoCondicionadaNoTx(tx,
      observada.capsula, { kind: ContextKind.definicao, title: TITULO_DO_PERFIL, body: corpo,
        ...(observada.criarComTags ? { tags: ['pauta', 'voz'] } : {}), sourceType: ContextSource.promocao,
        sourceRef: procedenciaDaVoz({ episodios: m.apelidos, textos: m.textos, provider: m.provider,
          model: m.model, cortado: m.material.cortado }), motivo: 'perfil de voz aprendido pela IA (MC10)' }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    await this.audit.log({ orgId, actorId, action: 'pauta.voz_aprendida', entityType: 'context_item', entityId: compromisso.aplicada.itemId,
      after: { versao: compromisso.aplicada.versao, versionId: compromisso.aplicada.versionId,
        contentHash: compromisso.aplicada.contentHash, episodios: m.apelidos, textos: m.textos,
        caracteres: m.material.caracteres, cortado: m.material.cortado, provider: m.provider, model: m.model } });
    return this.painelDaVozConfirmada(orgId, m, compromisso);
  }

  private identidadeHumana(orgId: string, actorId: string): Extract<IdentidadeDaDerivacao, { tipo: 'humano' }> {
    const c = contextoAtual();
    if (!actorId || c?.orgId !== orgId || c.actorType !== 'user' || c.actorId !== actorId || !c.correlationId)
      throw new ForbiddenException('Acesso insuficiente.');
    return { tipo: 'humano', actorId, correlationId: c.correlationId };
  }

  private conferirModeloEscolhido(m: Readonly<MaterialEscolhidoDaVoz>) {
    if (!m.configured || this.llm.configured !== m.configured || this.llm.name !== m.provider || this.llm.model !== m.model)
      throw new ConflictException('A configuração da geração mudou. Confira a base antes de gerar novamente.');
  }

  private planoDaVoz(orgId: string, chave: string, entrada: PautaVozAprenderInput): PlanoInternoDeFontesDaDerivacao<MaterialEscolhidoDaVoz, SelecaoDaVoz> {
    return {
      observar: async (tx, lerFonte) => {
        const ids = [...new Set(entrada.episodios)];
        const eps = ids.length ? await tx.pautaEpisodio.findMany({ where: { orgId, id: { in: ids } },
          select: { id: true }, orderBy: { numero: 'asc' } }) : [];
        if (eps.length !== ids.length) throw new NotFoundException('Episódio não encontrado');
        const selecao = { episodioIds: eps.map((e) => e.id) };
        return { ...await this.relerVozNoTx(tx, orgId, chave, entrada, selecao, lerFonte), selecao };
      },
      reconferir: (tx, lerFonte, selecao) => this.relerVozNoTx(tx, orgId, chave, entrada, selecao, lerFonte),
    };
  }

  private async relerVozNoTx(tx: Prisma.TransactionClient, orgId: string, chave: string, entrada: PautaVozAprenderInput,
    selecao: Readonly<SelecaoDaVoz>, lerFonte: LeitorFisicoDaDerivacao) {
    const configuracao = await lerFonte({ chave: PAUTA_CHAVE_DA_CHAVE_DA_VOZ });
    let efetiva: string = PAUTA_CHAVE_DA_VOZ_PADRAO; let origem: 'empresa' | 'padrao' = 'padrao';
    if (configuracao.estado === 'existente') {
      const primeira = configuracao.nota.body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
      const r = PautaChaveDaVozSchema.safeParse(primeira);
      if (!r.success) throw new ConflictException('A configuração da voz está inválida. Revise antes de aprender.');
      efetiva = r.data; origem = 'empresa';
    }
    if (efetiva !== chave) throw new ConflictException('A chave da voz mudou. Confira a base antes de aprender.');
    const ids = [...selecao.episodioIds];
    if (ids.length) await tx.$queryRaw`SELECT id FROM "PautaEpisodio" WHERE "orgId"=${orgId}
      AND id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR SHARE`;
    const rows = ids.length ? await tx.pautaEpisodio.findMany({ where: { orgId, id: { in: ids } } }) : [];
    if (rows.length !== ids.length) throw new ConflictException('Os episódios escolhidos mudaram durante o aprendizado.');
    const porId = new Map(rows.map((e) => [e.id, e]));
    const eps = ids.map((id) => { const e = porId.get(id);
      if (!e) throw new ConflictException('Os episódios escolhidos mudaram durante o aprendizado.'); return e; });
    const semTexto = eps.find((e) => !e.transcricaoTexto.trim());
    if (semTexto) throw new BadRequestException(`${apelidoDoEpisodio(semTexto.numero)} ainda não tem transcrição — a voz aprende do que foi dito.`);
    const fontes: FonteDaVoz[] = [ ...eps.map((e) => ({ rotulo: `episódio ${apelidoDoEpisodio(e.numero)} · ${e.titulo}`, texto: e.transcricaoTexto })),
      ...entrada.textos.map((t, i) => ({ rotulo: `texto colado ${i + 1}${t.titulo ? ` · ${t.titulo}` : ''}`, texto: t.texto })) ];
    const material = materialDaVoz(fontes);
    return { material: { chave, origem, material, apelidos: eps.map((e) => apelidoDoEpisodio(e.numero)), textos: entrada.textos.length,
      texto: entradaDaVoz(material), provider: this.llm.name, model: this.llm.model, configured: this.llm.configured },
      descritores: { configuracao, episodios: eps, textos: entrada.textos } };
  }

  private async painelDaVozConfirmada(orgId: string, m: Readonly<MaterialEscolhidoDaVoz>, compromisso: CompromissoDaDerivacao): Promise<PautaVozAprendida> {
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    const a = compromisso.aplicada;
    const v = await this.prisma.contextItemVersion.findFirst({ where: { id: a.versionId, orgId, itemId: a.itemId, versao: a.versao } });
    if (!v || v.body !== a.body || v.contentHash !== a.contentHash || v.sourceType !== a.sourceType || v.sourceRef !== a.sourceRef)
      throw new ConflictException('A versão aplicada da voz não pôde ser conferida.');
    const historico = (await this.memoria.historico(orgId, a.itemId)).slice(0, HISTORICO_NO_PAINEL);
    const episodios = await this.prisma.$queryRaw<Array<{ id: string; numero: number; titulo: string; caracteres: number }>>`
      SELECT id,numero,titulo,length("transcricaoTexto")::int AS caracteres FROM "PautaEpisodio"
      WHERE "orgId"=${orgId} AND "transcricaoTexto"<>'' ORDER BY numero DESC LIMIT ${EPISODIOS_NO_PAINEL}`;
    const final = await this.memoria.concluirEntregaDaDerivacao(compromisso);
    return { chave: a.chave, origemDaChave: m.origem,
      perfil: { id: a.itemId, corpo: a.body, versao: a.versao, procedencia: rotuloDeProcedencia(a.sourceType, a.sourceRef),
        sourceType: a.sourceType, sourceRef: a.sourceRef, atualizadoEm: v.criadoEm.toISOString(), arquivado: final.disponibilidadeAtual.arquivada },
      historico: historico.map((h) => ({ versao: h.versao, mudanca: h.mudanca, procedencia: h.procedencia, motivo: h.motivo, criadoEm: h.criadoEm })),
      regrasDaMarca: PAUTA_VOZ_REGRAS_DA_MARCA,
      episodios: episodios.map((e) => ({ id: e.id, apelido: apelidoDoEpisodio(Number(e.numero)), titulo: e.titulo, caracteres: Number(e.caracteres) })),
      iaConfigurada: this.llm.configured, material: { fontes: m.material.fontes.length, caracteres: m.material.caracteres, cortado: m.material.cortado } };
  }

  /**
   * A edição à mão: versão nova, procedência `operador`. `versao` velha é outra
   * aba (409); `chave` diferente da atual quer dizer que o rascunho é de outra nota (409).
   */
  async salvar(orgId: string, actorId: string, entrada: PautaVozSalvarInput): Promise<PautaVozPainel> {
    const { chave } = await this.chave(orgId);
    if (entrada.chave && entrada.chave !== chave) {
      throw new ConflictException('A chave da voz mudou desde a leitura — recarregue e tente de novo.');
    }
    const corpo = entrada.perfil.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, chave, {
      titulo: TITULO_DO_PERFIL,
      corpo,
      sourceType: ContextSource.operador,
      sourceRef: 'pauta.voz · edição manual',
      motivo: entrada.motivo || 'perfil de voz editado à mão',
      versaoEsperada: entrada.versao,
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.voz_editada',
      entityType: 'context_item',
      entityId: nota.id,
      after: { versao: nota.versao, caracteres: corpo.length },
    });
    return this.painel(orgId);
  }

  /** Troca a chave desta empresa. A configuração também é nota da memória, com histórico. */
  async definirChave(orgId: string, actorId: string, chaveNova: string): Promise<PautaVozPainel> {
    const chave = PautaChaveDaVozSchema.parse(chaveNova);
    const atual = await this.chave(orgId);
    if (atual.chave !== chave || atual.origem === 'padrao') {
      await this.gravar(orgId, PAUTA_CHAVE_DA_CHAVE_DA_VOZ, {
        titulo: TITULO_DA_CHAVE,
        corpo: chave,
        sourceType: ContextSource.operador,
        sourceRef: 'pauta.voz · chave',
        // A chave fica fora do motivo: ela costuma trazer nome de pessoa, e o
        // motivo vai em claro para o RASTRO, que redige a chave (ADR-011).
        motivo: 'a voz da pauta passa a ler outra chave (MC10)',
      });
      await this.audit.log({
        orgId,
        actorId,
        action: 'pauta.voz_chave',
        entityType: 'context_item',
        entityId: PAUTA_CHAVE_DA_CHAVE_DA_VOZ,
        before: { origem: atual.origem },
        after: { mudou: atual.chave !== chave },
      });
    }
    return this.painel(orgId);
  }

  /**
   * Cria a nota ou grava a versão nova — sempre por `MemoriaService`. A nota
   * arquivada volta: quem aprende ou edita a voz quer que ela valha.
   */
  private async gravar(
    orgId: string,
    chave: string,
    d: {
      titulo: string;
      corpo: string;
      sourceType: ContextSource;
      sourceRef: string;
      motivo: string;
      versaoEsperada?: number;
    },
  ): Promise<NotaDeContexto> {
    const existente = await this.memoria.porChave(orgId, chave);
    if (!existente) {
      return this.memoria.criar(orgId, {
        chave,
        kind: ContextKind.definicao,
        title: d.titulo,
        body: d.corpo,
        tags: ['pauta', 'voz'],
        sourceType: d.sourceType,
        sourceRef: d.sourceRef,
        motivo: d.motivo,
      });
    }
    let nota = await this.memoria.alterar(orgId, existente.id, {
      kind: ContextKind.definicao,
      title: d.titulo,
      body: d.corpo,
      sourceType: d.sourceType,
      sourceRef: d.sourceRef,
      motivo: d.motivo,
      versaoEsperada: d.versaoEsperada,
    });
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, 'a voz voltou a valer com a versão nova');
    return nota;
  }
}
