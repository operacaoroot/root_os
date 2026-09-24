import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PAUTA_CHAVES_DA_PALAVRA_DE_CORTE,
  apelidoDoEpisodio,
  comPalavraDeCorte,
  type PautaEpisodioStatus,
  type PautaRoteiroDoEpisodio,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService } from '../memory/memoria.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { EspelhoService } from './espelho.service';
import { itensMantidos } from './episodio';
import { blocoDeVoz } from './voz-da-pauta';
import {
  RoteiroInvalidoError,
  entradaDoRoteiro,
  lerRoteiroDaIa,
  markdownDoEspelho,
  montarRoteiro,
  motivoParaNaoGerar,
  nomeDoArquivoDoEspelho,
  nomeDoArquivoDoRoteiro,
  ordemDoRoteiro,
  palavraDaNota,
  palavraDeCorteEfetiva,
  systemDoRoteiro,
} from './roteiro-do-episodio';

const DO_EPISODIO = {
  id: true,
  numero: true,
  titulo: true,
  status: true,
  roteiro: true,
  palavraDeCorte: true,
  atualizadoEm: true,
  rodada: { select: { itens: true } },
} as const;

interface LinhaDoRoteiro {
  id: string;
  numero: number;
  titulo: string;
  status: PautaEpisodioStatus;
  roteiro: string;
  palavraDeCorte: string | null;
  atualizadoEm: Date;
  rodada: { itens: unknown };
}

type ResultadoDoEspelho = { caminho: string | null; erro: string | null };

const MSG_CORRIDA = 'O roteiro mudou em outra aba enquanto isso — recarregue e tente de novo.';

/*
 * O ROTEIRO DO EPISÓDIO (MC8): gerar pela IA a partir dos itens mantidos,
 * editar à mão, exportar em markdown e espelhar no vault. Tudo é escrita DENTRO
 * do OS; o espelho é a mesma cópia de mão única das fichas (off/local/drive).
 */
@Injectable()
export class RoteiroService {
  private readonly log = new Logger('RoteiroService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly espelho: EspelhoService,
    private readonly memoria: MemoriaService,
  ) {}

  private async ler(orgId: string, id: string): Promise<LinhaDoRoteiro> {
    const e = await this.prisma.pautaEpisodio.findFirst({ where: { id, orgId }, select: DO_EPISODIO });
    if (!e) throw new NotFoundException('Episódio não encontrado');
    return e as LinhaDoRoteiro;
  }

  /**
   * A palavra da empresa: a nota da memória (chaves em ordem), só lida. Pública
   * porque a fila da estação de mídia (MC9) entrega a palavra efetiva ao Mac.
   */
  async palavraDaEmpresa(orgId: string): Promise<string | null> {
    try {
      for (const chave of PAUTA_CHAVES_DA_PALAVRA_DE_CORTE) {
        const palavra = palavraDaNota(await this.memoria.porChave(orgId, chave));
        if (palavra) return palavra;
      }
      return null;
    } catch (e) {
      // Memória fora do ar não trava a gravação: cai no padrão, com o aviso no log.
      this.log.warn(`palavra de corte de ${orgId}: memória indisponível (${(e as Error).message})`);
      return null;
    }
  }

  /**
   * O ponto único de montagem da voz (MC10 preenche): hoje o tom da casa.
   * Quando o perfil existir, é lido aqui, por empresa, e nada mais muda.
   */
  private async voz(_orgId: string): Promise<string> {
    return blocoDeVoz(null);
  }

  /**
   * O roteiro como sai para fora (painel, gravação, .md, espelho): o lembrete
   * do topo com a palavra que vale agora — a nota da empresa pode ter mudado
   * depois de gerar, sem nenhuma escrita no episódio.
   */
  private roteiroCom(e: LinhaDoRoteiro, daEmpresa: string | null): string {
    return comPalavraDeCorte(e.roteiro, palavraDeCorteEfetiva(e.palavraDeCorte, daEmpresa).efetiva);
  }

  private painelDe(e: LinhaDoRoteiro, daEmpresa: string | null, espelho?: ResultadoDoEspelho): PautaRoteiroDoEpisodio {
    const itens = itensMantidos(e.rodada.itens).length;
    const motivo = motivoParaNaoGerar(e.status, itens);
    return {
      episodioId: e.id,
      apelido: apelidoDoEpisodio(e.numero),
      titulo: e.titulo,
      status: e.status,
      roteiro: this.roteiroCom(e, daEmpresa),
      atualizadoEm: e.atualizadoEm.toISOString(),
      palavraDeCorte: {
        ...palavraDeCorteEfetiva(e.palavraDeCorte, daEmpresa),
        doEpisodio: e.palavraDeCorte,
        daEmpresa,
      },
      podeGerar: motivo === null,
      motivo,
      ...(espelho ? { espelho } : {}),
    };
  }

  async painel(orgId: string, id: string): Promise<PautaRoteiroDoEpisodio> {
    const e = await this.ler(orgId, id);
    return this.painelDe(e, await this.palavraDaEmpresa(orgId));
  }

  /**
   * Gera o roteiro e passa o episódio para a gravação. A escrita é condicionada
   * ao status E ao `atualizadoEm` lidos antes da IA: uma edição à mão feita
   * enquanto o modelo pensava não é apagada em silêncio (409).
   */
  async gerar(orgId: string, id: string, actorId: string, opts: { substituir: boolean }): Promise<PautaRoteiroDoEpisodio> {
    const e = await this.ler(orgId, id);
    const itens = itensMantidos(e.rodada.itens);
    const motivo = motivoParaNaoGerar(e.status, itens.length);
    if (motivo) throw new BadRequestException(motivo);
    if (e.roteiro.trim() && !opts.substituir) {
      throw new ConflictException('O episódio já tem roteiro — confirme para substituir o atual.');
    }
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }

    const apelido = apelidoDoEpisodio(e.numero);
    const daEmpresa = await this.palavraDaEmpresa(orgId);
    const palavra = palavraDeCorteEfetiva(e.palavraDeCorte, daEmpresa);

    const saida = await this.llm.complete({
      system: systemDoRoteiro(await this.voz(orgId)),
      user: entradaDoRoteiro({ apelido, titulo: e.titulo, itens }),
      // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
      orgId,
    });

    let blocos;
    let daIa;
    try {
      daIa = lerRoteiroDaIa(saida, itens.length);
      blocos = ordemDoRoteiro(daIa, itens);
    } catch (err) {
      if (err instanceof RoteiroInvalidoError) {
        this.log.warn(`roteiro ${apelido} de ${orgId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }
    const roteiro = montarRoteiro({
      apelido,
      titulo: e.titulo,
      palavraDeCorte: palavra.efetiva,
      abertura: daIa.abertura,
      blocos,
      fechamento: daIa.fechamento,
    });

    const para: PautaEpisodioStatus = 'gravacao';
    const r = await this.prisma.pautaEpisodio.updateMany({
      where: { id, orgId, status: e.status, atualizadoEm: e.atualizadoEm },
      data: { roteiro, status: para },
    });
    if (r.count === 0) throw new ConflictException(MSG_CORRIDA);

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_roteiro_gerado',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { status: e.status, caracteres: e.roteiro.length },
      after: {
        status: para,
        caracteres: roteiro.length,
        ordem: blocos.map((b) => b.materia.n),
        completadas: blocos.filter((b) => !b.daIa).map((b) => b.materia.n),
        palavraDeCorte: palavra.origem,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });

    const depois = await this.ler(orgId, id);
    return this.painelDe(depois, daEmpresa, await this.espelhar(orgId, depois, daEmpresa));
  }

  /** Edição à mão: o status não muda. `versao` diferente da atual é outra aba (409). */
  async salvar(
    orgId: string,
    id: string,
    actorId: string,
    entrada: { roteiro: string; versao?: string },
  ): Promise<PautaRoteiroDoEpisodio> {
    const e = await this.ler(orgId, id);
    if (entrada.versao && entrada.versao !== e.atualizadoEm.toISOString()) {
      throw new ConflictException(MSG_CORRIDA);
    }
    const daEmpresa = await this.palavraDaEmpresa(orgId);
    // A edição pode ter partido de um texto com a palavra antiga no topo.
    const roteiro = comPalavraDeCorte(
      entrada.roteiro.replace(/\r\n/g, '\n'),
      palavraDeCorteEfetiva(e.palavraDeCorte, daEmpresa).efetiva,
    );
    const r = await this.prisma.pautaEpisodio.updateMany({
      where: { id, orgId, atualizadoEm: e.atualizadoEm },
      data: { roteiro },
    });
    if (r.count === 0) throw new ConflictException(MSG_CORRIDA);

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_roteiro_editado',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { caracteres: e.roteiro.length },
      after: { caracteres: roteiro.length },
    });

    const depois = await this.ler(orgId, id);
    return this.painelDe(depois, daEmpresa, await this.espelhar(orgId, depois, daEmpresa));
  }

  /**
   * `null` volta à palavra da empresa. Vale já: o lembrete do roteiro gravado
   * é reescrito na mesma escrita (condicionada, como a edição) e o espelho,
   * refeito.
   */
  async definirPalavraDeCorte(
    orgId: string,
    id: string,
    actorId: string,
    palavra: string | null,
  ): Promise<PautaRoteiroDoEpisodio> {
    const e = await this.ler(orgId, id);
    const nova = palavra?.trim() || null;
    const daEmpresa = await this.palavraDaEmpresa(orgId);
    const roteiro = comPalavraDeCorte(e.roteiro, palavraDeCorteEfetiva(nova, daEmpresa).efetiva);
    const r = await this.prisma.pautaEpisodio.updateMany({
      where: { id, orgId, atualizadoEm: e.atualizadoEm },
      data: { palavraDeCorte: nova, roteiro },
    });
    if (r.count === 0) throw new ConflictException(MSG_CORRIDA);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_palavra_de_corte',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { palavraDeCorte: e.palavraDeCorte },
      after: { palavraDeCorte: nova },
    });
    const depois = await this.ler(orgId, id);
    const espelho = roteiro === e.roteiro ? undefined : await this.espelhar(orgId, depois, daEmpresa);
    return this.painelDe(depois, daEmpresa, espelho);
  }

  /** O .md para baixar ou abrir na tela da gravação. Sem roteiro, 404. */
  async exportar(orgId: string, id: string): Promise<{ nome: string; conteudo: string }> {
    const e = await this.ler(orgId, id);
    if (!e.roteiro.trim()) throw new NotFoundException('O episódio ainda não tem roteiro.');
    const roteiro = this.roteiroCom(e, await this.palavraDaEmpresa(orgId));
    const conteudo = roteiro.endsWith('\n') ? roteiro : `${roteiro}\n`;
    return { nome: nomeDoArquivoDoRoteiro(apelidoDoEpisodio(e.numero)), conteudo };
  }

  /**
   * Cópia no vault, quando a empresa ligou o espelho. Desligado devolve
   * `{caminho: null, erro: null}`; falhar não desfaz a escrita no banco — o
   * Postgres é canônico e o erro volta para a tela.
   */
  private async espelhar(orgId: string, e: LinhaDoRoteiro, daEmpresa: string | null): Promise<ResultadoDoEspelho> {
    if (!e.roteiro.trim()) return { caminho: null, erro: null };
    const apelido = apelidoDoEpisodio(e.numero);
    try {
      const caminho = await this.espelho.espelharDocumento(orgId, {
        nome: nomeDoArquivoDoEspelho(apelido, e.id),
        subpastaLocal: 'episodios',
        conteudo: markdownDoEspelho({
          id: e.id,
          apelido,
          titulo: e.titulo,
          roteiro: this.roteiroCom(e, daEmpresa),
          atualizadoEm: e.atualizadoEm,
        }),
      });
      return { caminho, erro: null };
    } catch (err) {
      const msg = (err as Error).message ?? 'falha desconhecida';
      this.log.warn(`espelho do roteiro ${apelido} de ${orgId} falhou: ${msg}`);
      return { caminho: null, erro: msg.slice(0, 300) };
    }
  }
}
