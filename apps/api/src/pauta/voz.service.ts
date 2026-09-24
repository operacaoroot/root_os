import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
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
import { MemoriaService, type NotaDeContexto } from '../memory/memoria.service';
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

const TITULO_DO_PERFIL = 'Voz do autor (pauta)';
const TITULO_DA_CHAVE = 'Chave da voz da pauta';
const HISTORICO_NO_PAINEL = 10;
const EPISODIOS_NO_PAINEL = 30;

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
  async aprender(orgId: string, actorId: string, entrada: PautaVozAprenderInput): Promise<PautaVozAprendida> {
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }

    const ids = [...new Set(entrada.episodios)];
    const eps = ids.length
      ? await this.prisma.pautaEpisodio.findMany({
          where: { orgId, id: { in: ids } },
          select: { id: true, numero: true, titulo: true, transcricaoTexto: true },
          orderBy: { numero: 'asc' },
        })
      : [];
    if (eps.length !== ids.length) throw new NotFoundException('Episódio não encontrado');
    const semTexto = eps.find((e) => !e.transcricaoTexto.trim());
    if (semTexto) {
      throw new BadRequestException(
        `${apelidoDoEpisodio(semTexto.numero)} ainda não tem transcrição — a voz aprende do que foi dito.`,
      );
    }

    const fontes: FonteDaVoz[] = [
      ...eps.map((e) => ({ rotulo: `episódio ${apelidoDoEpisodio(e.numero)} · ${e.titulo}`, texto: e.transcricaoTexto })),
      ...entrada.textos.map((t, i) => ({ rotulo: `texto colado ${i + 1}${t.titulo ? ` · ${t.titulo}` : ''}`, texto: t.texto })),
    ];
    const material = materialDaVoz(fontes);
    // Antes da IA: memória fora do ar não gasta chamada, e a chave lida é a que recebe o perfil.
    const { chave } = await this.chave(orgId);

    const saida = await this.llm.complete({
      system: SYSTEM_VOZ,
      user: entradaDaVoz(material),
      // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
      orgId,
      maxTokens: SAIDA_DA_GERACAO_LONGA,
    });

    let corpo: string;
    try {
      corpo = montarPerfil(lerPerfilDaIa(saida));
    } catch (err) {
      if (err instanceof VozInvalidaError) {
        this.log.warn(`voz de ${orgId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const apelidos = eps.map((e) => apelidoDoEpisodio(e.numero));
    const nota = await this.gravar(orgId, chave, {
      titulo: TITULO_DO_PERFIL,
      corpo,
      sourceType: ContextSource.promocao,
      sourceRef: procedenciaDaVoz({
        episodios: apelidos,
        textos: entrada.textos.length,
        provider: this.llm.name,
        model: this.llm.model,
        cortado: material.cortado,
      }),
      motivo: 'perfil de voz aprendido pela IA (MC10)',
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.voz_aprendida',
      entityType: 'context_item',
      entityId: nota.id,
      after: {
        versao: nota.versao,
        episodios: apelidos,
        textos: entrada.textos.length,
        caracteres: material.caracteres,
        cortado: material.cortado,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });

    const painel = await this.painel(orgId);
    return {
      ...painel,
      material: { fontes: material.fontes.length, caracteres: material.caracteres, cortado: material.cortado },
    };
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
