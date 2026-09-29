import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import {
  PAUTA_CHAVE_DA_MARCA,
  PAUTA_CHAVE_DOS_PILARES,
  PAUTA_SECOES_DA_MARCA,
  type PautaMarcaPainel,
  type PautaMarcaSalvarInput,
  type PautaPilar,
  type PautaPilaresSalvarInput,
} from '@mktos/shared';
import { AuditService } from '../audit/audit.service';
import { MemoriaService, type NotaDeContexto } from '../memory/memoria.service';
import { blocoDeMarca, marcaDaNota, pilaresDaNota, procedenciaDaMarca } from './marca-da-pauta';

const TITULO_DA_MARCA = 'Marca (pauta)';
const TITULO_DOS_PILARES = 'Pilares de conteúdo (pauta)';

/*
 * A MARCA E OS PILARES (MK1). Duas notas da memória, lidas por `porChave` e
 * escritas SÓ por `MemoriaService` (criar/alterar/restaurar), que é o caminho da
 * ADR-011: evento no RASTRO, versão nova, a anterior no histórico. Nada aqui
 * toca `ContextItem` direto — mesma regra que a voz (MC10) segue.
 *
 * `bloco` é o que os prompts da pauta consomem, e é o ÚNICO lugar onde texto de
 * marca é montado para o modelo.
 */
@Injectable()
export class MarcaService {
  private readonly log = new Logger('MarcaService');

  constructor(
    private readonly audit: AuditService,
    private readonly memoria: MemoriaService,
  ) {}

  /**
   * A nota, ou nulo. Memória fora do ar NÃO TRAVA a geração: cai em nulo com o
   * aviso no log, e o prompt segue sem o bloco — a mesma escolha da voz, pelo
   * mesmo motivo (um roteiro que não sai é pior que um roteiro sem a marca).
   */
  private async nota(orgId: string, chave: string): Promise<NotaDeContexto | null> {
    try {
      return await this.memoria.porChave(orgId, chave);
    } catch (e) {
      this.log.warn(`marca de ${orgId}: memória indisponível ao ler ${chave} (${(e as Error).message})`);
      return null;
    }
  }

  /** O perfil da marca vigente, ou nulo. */
  async perfil(orgId: string): Promise<string | null> {
    return marcaDaNota(await this.nota(orgId, PAUTA_CHAVE_DA_MARCA)).perfil;
  }

  /** Os pilares vigentes. Lista vazia quando não há nota ou nenhuma linha vale. */
  async pilares(orgId: string): Promise<PautaPilar[]> {
    return pilaresDaNota(await this.nota(orgId, PAUTA_CHAVE_DOS_PILARES)).pilares;
  }

  /**
   * O bloco de marca que os prompts da pauta recebem. Vazio quando não há marca
   * nem pilar: nesse caso o prompt fica exatamente como era antes da MK1.
   */
  async bloco(orgId: string): Promise<string> {
    const [notaMarca, notaPilares] = await Promise.all([
      this.nota(orgId, PAUTA_CHAVE_DA_MARCA),
      this.nota(orgId, PAUTA_CHAVE_DOS_PILARES),
    ]);
    const { perfil } = marcaDaNota(notaMarca);
    const { pilares } = pilaresDaNota(notaPilares);
    return blocoDeMarca(perfil, pilares, {
      procedencia: notaMarca && perfil ? procedenciaDaMarca(notaMarca) : undefined,
    });
  }

  async painel(orgId: string): Promise<PautaMarcaPainel> {
    const [notaMarca, notaPilares] = await Promise.all([
      this.nota(orgId, PAUTA_CHAVE_DA_MARCA),
      this.nota(orgId, PAUTA_CHAVE_DOS_PILARES),
    ]);
    const m = marcaDaNota(notaMarca);
    const p = pilaresDaNota(notaPilares);
    return {
      perfil: m.perfil,
      perfilVersao: m.versao,
      perfilAtualizadoEm: notaMarca ? new Date(notaMarca.atualizadoEm).toISOString() : null,
      pilaresTexto: p.texto,
      pilaresVersao: p.versao,
      pilares: p.pilares,
      avisos: [...m.avisos, ...p.avisos],
      bloco: blocoDeMarca(m.perfil, p.pilares, {
        procedencia: notaMarca && m.perfil ? procedenciaDaMarca(notaMarca) : undefined,
      }),
    };
  }

  /** A edição à mão do perfil. `versao` velha é outra aba mexendo junto (409). */
  async salvarPerfil(orgId: string, actorId: string, entrada: PautaMarcaSalvarInput): Promise<PautaMarcaPainel> {
    const corpo = entrada.perfil.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, PAUTA_CHAVE_DA_MARCA, {
      titulo: TITULO_DA_MARCA,
      corpo,
      tags: ['pauta', 'marca'],
      sourceRef: 'pauta.marca · edição manual',
      motivo: 'perfil da marca editado à mão (MK1)',
      versaoEsperada: entrada.versao,
      aoRestaurar: 'a marca voltou a valer com a versão nova',
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.marca_salva',
      entityType: 'context_item',
      entityId: nota.id,
      after: { versao: nota.versao, caracteres: corpo.length },
    });
    return this.painel(orgId);
  }

  /**
   * A edição à mão dos pilares. Grava o TEXTO como a pessoa escreveu, não a
   * lista lida: a nota é o original, e o que a leitura não entendeu volta em
   * `avisos` para ela corrigir — apagar a linha ruim ao gravar perderia o que
   * ela quis dizer.
   */
  async salvarPilares(orgId: string, actorId: string, entrada: PautaPilaresSalvarInput): Promise<PautaMarcaPainel> {
    const corpo = entrada.pilares.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, PAUTA_CHAVE_DOS_PILARES, {
      titulo: TITULO_DOS_PILARES,
      corpo,
      tags: ['pauta', 'marca', 'pilares'],
      sourceRef: 'pauta.marca.pilares · edição manual',
      motivo: 'pilares de conteúdo editados à mão (MK1)',
      versaoEsperada: entrada.versao,
      aoRestaurar: 'os pilares voltaram a valer com a versão nova',
    });
    const painel = await this.painel(orgId);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.pilares_salvos',
      entityType: 'context_item',
      entityId: nota.id,
      after: { versao: nota.versao, pilares: painel.pilares.map((p) => p.chave), avisos: painel.avisos.length },
    });
    return painel;
  }

  /** O modelo do perfil, para a aba oferecer as seções em vez de uma folha em branco. */
  static modeloDoPerfil(): string {
    return PAUTA_SECOES_DA_MARCA.map((s) => `## ${s}\n`).join('\n');
  }

  private async gravar(
    orgId: string,
    chave: string,
    d: {
      titulo: string;
      corpo: string;
      tags: string[];
      sourceRef: string;
      motivo: string;
      versaoEsperada?: number;
      aoRestaurar: string;
    },
  ): Promise<NotaDeContexto> {
    const existente = await this.memoria.porChave(orgId, chave);
    if (!existente) {
      if (d.versaoEsperada) {
        // A aba partiu de uma versão que não existe mais: a nota foi apagada
        // entre a leitura e o salvar. Criar aqui esconderia a remoção.
        throw new ConflictException('A nota mudou desde a leitura — recarregue e tente de novo.');
      }
      return this.memoria.criar(orgId, {
        chave,
        kind: ContextKind.definicao,
        title: d.titulo,
        body: d.corpo,
        tags: d.tags,
        sourceType: ContextSource.operador,
        sourceRef: d.sourceRef,
        motivo: d.motivo,
      });
    }
    let nota = await this.memoria.alterar(orgId, existente.id, {
      kind: ContextKind.definicao,
      title: d.titulo,
      body: d.corpo,
      sourceType: ContextSource.operador,
      sourceRef: d.sourceRef,
      motivo: d.motivo,
      versaoEsperada: d.versaoEsperada,
    });
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, d.aoRestaurar);
    return nota;
  }
}
