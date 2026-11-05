import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { ehEmpresaDaCasa } from '../tenants/empresa-da-casa';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { GoogleService } from '../google/google.service';
import {
  NOME_DAS_DECISOES,
  NOME_DO_GOSTO,
  PASTA_DO_ALGORITMO,
  SYSTEM_DO_GOSTO,
  arquivoDasDecisoes,
  juntarGosto,
  limparResumo,
  modeloDoGosto,
  notaParaAIa,
  pedidoDoResumo,
  precisaResumir,
  separarGosto,
  type Decisao,
  type MarcaDoResumo,
} from './gosto-da-root';

/**
 * O GOSTO DA ROOT (04/11/2026): o OS grava no Obsidian do Drive o histórico das decisões e a
 * nota "Gosto da Root", e a IA das ideias e a do "Gerar" leem essa nota. Ver `gosto-da-root.ts`.
 *
 * Nada aqui lança: sem Drive, sem IA ou com o Google fora do ar, a triagem segue como antes,
 * com os comentários do banco.
 */

const simulada = () => process.env.MARKETING_IA_SIMULADA === '1';
/** A nota lida fica guardada 10 min por empresa: a rotina lê uma vez, não a cada lote. */
const GUARDA_DA_NOTA_MS = 10 * 60_000;
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export type ResultadoDoGosto = 'resumido' | 'sem-novidade' | 'sem-drive' | 'sem-ia' | 'falhou';

/** O pedaço do Google que o gosto usa (os testes passam um dublê). */
type DriveDoGosto = Pick<GoogleService, 'filhosDaPasta' | 'criarPasta' | 'gravarArquivoNoDrive' | 'baixarTextoDoDrive'>;

/** Só títulos e linhas em branco não ensinam nada: a IA não recebe a nota vazia. */
function textoUtil(t: string): string {
  return t.split('\n').every((l) => !l.trim() || l.trim().startsWith('#')) ? '' : t;
}

function resumoSimulado(decisoes: Decisao[]): string {
  const comentadas = decisoes.filter((d) => d.comentario);
  return [
    '### O que a Root aprova',
    ...(comentadas.filter((d) => d.status === 'aprovada').slice(0, 3).map((d) => `- "${d.comentario}"`) || []),
    '### O que a Root recusa',
    decisoes.some((d) => d.status === 'recusada') ? `- ${decisoes.filter((d) => d.status === 'recusada').length} recusas (simulado).` : '- Ainda sem decisões que mostrem isso.',
    '### Formatos e jeitos de fazer',
    '- Ainda sem decisões que mostrem isso.',
    '### Pontos em aberto',
    '- Ainda sem decisões que mostrem isso.',
  ].join('\n');
}

@Injectable()
export class GostoDaRootService {
  private readonly log = new Logger('GostoDaRoot');
  private readonly notas = new Map<string, { em: number; texto: string }>();
  private readonly pastas = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Optional() private readonly google?: GoogleService,
  ) {}

  private async driveDaEmpresa(orgId: string): Promise<DriveDoGosto | null> {
    if (!this.google || process.env.MEMORIA_DRIVE_DESLIGADO === '1') return null;
    return await ehEmpresaDaCasa(this.prisma, orgId) ? this.google : null;
  }

  /** A pasta 40-marca-e-conteudo/Memória/Algoritmo do Drive da Root. Só cria o caminho com `criar`. */
  private async pasta(drive: DriveDoGosto, orgId: string, criar: boolean): Promise<string | null> {
    const guardada = this.pastas.get(orgId);
    if (guardada) return guardada;
    let pai = (process.env.MEMORIA_DRIVE_RAIZ_ID || '1WqCqI0gOxvVEhTPUQktATvj1lH1pOPSt').trim();
    for (const nome of PASTA_DO_ALGORITMO) {
      const achada = (await drive.filhosDaPasta(orgId, pai, { nome, soPastas: true }))[0];
      if (achada) pai = achada.id;
      else if (criar) pai = (await drive.criarPasta(orgId, pai, nome)).id;
      else return null;
    }
    this.pastas.set(orgId, pai);
    return pai;
  }

  private async lerNota(drive: DriveDoGosto, orgId: string, pasta: string): Promise<string | null> {
    const arquivo = (await drive.filhosDaPasta(orgId, pasta, { nome: NOME_DO_GOSTO })).find((f) => !f.mimeType.includes('folder'));
    return arquivo ? drive.baixarTextoDoDrive(orgId, arquivo.id) : null;
  }

  /** Todas as decisões de Ideias de conteúdo, a mais recente primeiro. */
  decisoes(orgId: string): Promise<Decisao[]> {
    return this.prisma.marketingIdeiaCard.findMany({
      where: { orgId, status: { in: ['aprovada', 'recusada'] } },
      orderBy: { decididaEm: 'desc' },
      take: 2000,
      select: { titulo: true, status: true, motivo: true, comentario: true, decididaEm: true, decididaPor: true, fonteNome: true, url: true, formatoSugerido: true },
    });
  }

  /** Regrava "Decisões da triagem.md" com todas as decisões, com ou sem comentário. Nunca lança. */
  async gravarDecisoes(orgId: string): Promise<boolean> {
    try {
      const drive = await this.driveDaEmpresa(orgId);
      if (!drive) return false;
      const pasta = await this.pasta(drive, orgId, true);
      if (!pasta) return false;
      await drive.gravarArquivoNoDrive(orgId, { folderId: pasta, nome: NOME_DAS_DECISOES, conteudo: arquivoDasDecisoes(await this.decisoes(orgId)), mimeType: 'text/markdown' });
      return true;
    } catch (e) {
      this.pastas.delete(orgId);
      this.log.warn(`decisões no Drive: ${mensagem(e)}`);
      return false;
    }
  }

  /** A nota "Gosto da Root" do jeito que a IA lê; '' sem Drive, sem nota ou com a nota vazia. Nunca lança. */
  async paraAIa(orgId: string): Promise<string> {
    let guardada: { em: number; texto: string } | undefined;
    try {
      const drive = await this.driveDaEmpresa(orgId);
      if (!drive) return '';
      guardada = this.notas.get(orgId);
      if (guardada && Date.now() - guardada.em < GUARDA_DA_NOTA_MS) return guardada.texto;
      const pasta = await this.pasta(drive, orgId, false);
      const nota = pasta ? await this.lerNota(drive, orgId, pasta) : null;
      const texto = nota ? textoUtil(notaParaAIa(nota)) : '';
      this.notas.set(orgId, { em: Date.now(), texto });
      return texto;
    } catch (e) {
      this.pastas.delete(orgId);
      this.log.warn(`gosto da Root (leitura): ${mensagem(e)}`);
      return guardada?.texto ?? '';
    }
  }

  /**
   * Na rotina das 23h, antes da IA ler o que a coleta trouxe: se houve decisão desde o último
   * resumo (ou a nota não existe), regrava o histórico e reescreve o "Resumo da IA" a partir de
   * todas as decisões. A parte "Escrito pela equipe" volta como estava. Nunca lança.
   */
  async atualizarResumo(orgId: string): Promise<ResultadoDoGosto> {
    try {
      const drive = await this.driveDaEmpresa(orgId);
      if (!drive) return 'sem-drive';
      const decisoes = await this.decisoes(orgId);
      const atual: MarcaDoResumo = { total: decisoes.length, ultima: decisoes[0]?.decididaEm?.toISOString() ?? null };
      const pasta = await this.pasta(drive, orgId, true);
      if (!pasta) return 'sem-drive';
      const antes = await this.lerNota(drive, orgId, pasta);
      const { daEquipe, marca } = separarGosto(antes ?? modeloDoGosto());
      if (antes !== null && !precisaResumir(marca, atual)) return 'sem-novidade';
      if (decisoes.length && !simulada() && !this.llm.configured) return 'sem-ia';
      await this.gravarDecisoes(orgId);

      const resumo = !decisoes.length
        ? '- Ainda sem decisões. O resumo aparece depois das primeiras aprovações e recusas em Ideias de conteúdo.'
        : simulada()
          ? resumoSimulado(decisoes)
          : limparResumo(await this.llm.complete({ funcao: 'CT-21', system: SYSTEM_DO_GOSTO, user: pedidoDoResumo(decisoes, daEquipe), orgId, maxTokens: 2500 }));
      if (!resumo) return 'falhou';

      // Relê logo antes de gravar: o que a equipe escreveu enquanto a IA resumia não se perde.
      const agora = await this.lerNota(drive, orgId, pasta);
      const equipe = agora === null ? daEquipe : separarGosto(agora).daEquipe;
      const nota = juntarGosto(equipe, resumo, atual);
      await drive.gravarArquivoNoDrive(orgId, { folderId: pasta, nome: NOME_DO_GOSTO, conteudo: nota, mimeType: 'text/markdown' });
      this.notas.set(orgId, { em: Date.now(), texto: textoUtil(notaParaAIa(nota)) });
      return 'resumido';
    } catch (e) {
      this.pastas.delete(orgId);
      this.log.warn(`gosto da Root (resumo): ${mensagem(e)}`);
      return 'falhou';
    }
  }
}
