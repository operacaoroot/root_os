import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, SessionCanal, SessionStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { AgentRuntime } from '../../agents/agent-runtime.service';
import {
  SLUG_DO_LEITOR_DE_ATA,
  SLUG_DO_PESQUISADOR_DE_CONTA,
  SLUG_DO_ROTEIRISTA,
} from '../../agents/roster';
import { ARQUIVISTA_DO_CLIENTE, type ArquivistaDoClientePort, type ResultadoDoArquivo } from '../../clientes/portas';
import { LLM_PROVIDER, type LlmProvider, type LlmStepInput, type LlmStepOutput } from '../../llm/llm.provider';
import { MemoriaService } from '../../memory/memoria.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NOTA_DA_PESQUISA_NA_WEB,
  USOS_DA_BUSCA_NA_WEB,
  buscaNaWebLigada,
  pedidoDoPesquisador,
  promptDoDossie,
  interpretarDossie,
  TAREFA_DO_DOSSIE,
  type Dossie,
} from './dossie';
import { ehNivel, temasDoBloco, temasDoConvite, type Nivel } from './espinha';
import {
  AtaInvalidaError,
  LeituraIlegivelError,
  ataGeradaEmMarkdown,
  conferirAta,
  interpretarLeitura,
  promptDoLeitor,
  type LeituraDaAta,
} from './leitor-de-ata';
import { lerPerguntasDoRoteirista, promptDoRoteirista, RoteiroIlegivelError } from './roteirista';
import { varrerSegredos } from './segredos';
import { enderecoDeDentro } from '../../pauta/endereco-de-dentro';
import {
  CorpoAcimaDoTetoError,
  ipDaConexao,
  lerCorpoComTeto,
  pedirAoIp,
  resolverDoSistema,
  TETO_DE_BYTES_DA_PAGINA,
  type Conectar,
  type Resolver,
} from '../../pauta/pagina-publica';
import { TrilhoService, type AtaNaBancada, type Quem } from './trilho.service';

/** A marca do stub para o roteirista: mora em `roteirista.ts` (parte pura do IM-03) e é reexportada aqui. */
export { TAREFA_DO_ROTEIRO } from './roteirista';

/* ==========================================================================
 * AS TRÊS CHAMADAS DE MODELO DO TRILHO — ata, dossiê, roteiro
 * ==========================================================================
 *
 * Todas pelo `LlmProvider` do OS (o envelope do teto de custo por empresa e
 * do orçamento por agente), em nome do agente certo do roster da ROOT. Os
 * prompts e os parsers são puros (`leitor-de-ata.ts`, `dossie.ts`); aqui
 * entra a fonte (texto, PDF, link), a varredura de segredos, o registro do
 * que a leitura custou e o que ela rendeu.
 *
 * A TRANSCRIÇÃO BRUTA NÃO É GRAVADA (nota do Pedro, §10): `OnboardingAta`
 * guarda hash, tamanho, segredos mascarados, modelo e custo. O que sobrevive
 * é o trecho curto de cada proposta — e ele já passou pela varredura.
 *
 * PDF: o provider da Anthropic lê o documento nativamente. Só que o parser
 * precisa do TEXTO para conferir cada trecho contra a ata (é o que separa
 * literal de invenção). Então o PDF passa por uma primeira chamada que o
 * transcreve na íntegra, e daí em diante é o mesmo caminho do texto colado.
 * Custa uma chamada a mais; sem ela, "literal" seria palavra do modelo.
 */

export type FonteDaAta =
  | { tipo: 'texto'; texto: string; referencia?: string | null }
  | { tipo: 'pdf'; base64: string; nome?: string | null }
  | { tipo: 'link'; url: string };

export interface ResultadoDaLeitura {
  ata: AtaNaBancada;
  leitura: LeituraDaAta;
  preservadas: string[];
}

const MAX_PDF_BYTES = 30 * 1024 * 1024;

export class FonteIndisponivelError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'FonteIndisponivelError';
  }
}

/** HTML de página de ata (Granola, Docs publicado) vira texto corrido. */
export function htmlParaTexto(html: string): string {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/*
 * BUSCAR UM LINK DE FORA, E SÓ DE FORA.
 *
 * O sócio cola o link da ata (Granola, Docs publicado). A API vai buscá-lo —
 * e uma busca de URL informada por gente é o caminho clássico para dentro da
 * rede do servidor (MinIO, Traefik, a própria API) se ninguém conferir o
 * destino. O que esta função faz valer:
 *
 *   · só http(s), só porta padrão (nada de `:9000`);
 *   · o host é resolvido ANTES de conectar e endereço privado, de loopback,
 *     link-local ou "este host" é recusado — em cada salto de redirect;
 *   · redirect é seguido À MÃO (até 3), conferindo o destino de novo;
 *   · o corpo é lido com teto de 2 MB — uma transcrição tem dezenas de KB.
 *
 * Sair da casa por conector (pela porta) continua sendo o desenho certo para
 * o dia em que o Granola for conector; até lá, é isto que impede a bancada de
 * virar sonda da rede interna.
 */
const TETO_DE_BYTES_DO_LINK = TETO_DE_BYTES_DA_PAGINA;

/**
 * Confere o destino e devolve a URL e o IP em que a conexão vai ser aberta.
 * A regra de endereço é a da casa inteira (`enderecoDeDentro`, Produção 22,
 * M4); as regras daqui (porta padrão, sem credencial, sem nome local) ficam.
 */
async function conferirDestino(bruto: string, resolver: Resolver): Promise<{ url: URL; ip: string }> {
  let u: URL;
  try {
    u = new URL(bruto);
  } catch {
    throw new FonteIndisponivelError('o link não é uma URL válida.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FonteIndisponivelError('o link precisa começar com http(s)://');
  if (u.port && u.port !== '80' && u.port !== '443') throw new FonteIndisponivelError('link com porta fora do padrão não é aceito.');
  if (u.username || u.password) throw new FonteIndisponivelError('link com credencial embutida não é aceito.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new FonteIndisponivelError('o link aponta para dentro da casa; só endereço público.');
  }
  if (isIP(host)) {
    if (enderecoDeDentro(host)) throw new FonteIndisponivelError('o link aponta para dentro da casa; só endereço público.');
    return { url: u, ip: host };
  }
  let enderecos: string[];
  try {
    enderecos = await resolver(host);
  } catch {
    throw new FonteIndisponivelError(`não consegui resolver ${host}.`);
  }
  if (!enderecos.length || enderecos.some(enderecoDeDentro)) {
    throw new FonteIndisponivelError('o link aponta para dentro da casa; só endereço público.');
  }
  return { url: u, ip: ipDaConexao(enderecos) };
}

/**
 * O corpo com o teto de 2 MB, pela leitura comum (`lerCorpoComTeto`, a mesma
 * da captura da pauta). Resposta que morre no meio (o prazo, um gzip cortado)
 * vira a frase de link indisponível, em vez de ficar pendurada.
 */
async function lerComTeto(res: Response): Promise<string> {
  try {
    return await lerCorpoComTeto(res, TETO_DE_BYTES_DO_LINK);
  } catch (e) {
    if (e instanceof CorpoAcimaDoTetoError) {
      throw new FonteIndisponivelError('a página passa de 2 MB — isso não é uma transcrição. Cole o texto.');
    }
    throw new FonteIndisponivelError(`não consegui ler o link até o fim: ${(e as Error).message}`);
  }
}

/**
 * O link de fora, com o rebinding fechado (Produção 22, M4): cada salto é
 * conferido e a conexão vai ao IP dessa conferência (`pedirAoIp`), nunca a uma
 * segunda resolução do nome. `deps` é só da suíte.
 */
export async function buscarLinkDeFora(
  bruto: string,
  deps: { resolver?: Resolver; conectar?: Conectar } = {},
): Promise<{ corpo: string; tipo: string; url: string }> {
  const resolver = deps.resolver ?? resolverDoSistema;
  const conectar = deps.conectar ?? pedirAoIp;
  let alvo = await conferirDestino(bruto, resolver);
  for (let salto = 0; salto < 4; salto++) {
    let res: Response;
    try {
      res = await conectar(alvo.url, alvo.ip, {
        headers: { accept: 'text/html,text/plain,application/json;q=0.8,*/*;q=0.5', 'user-agent': 'ROOT-OS/onboarding' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new FonteIndisponivelError(`não consegui abrir o link: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400) {
      const para = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!para) throw new FonteIndisponivelError('o link redireciona sem destino.');
      alvo = await conferirDestino(new URL(para, alvo.url).toString(), resolver);
      continue;
    }
    if (!res.ok) throw new FonteIndisponivelError(`o link respondeu ${res.status}. Cole a transcrição ou envie o PDF.`);
    return { corpo: await lerComTeto(res), tipo: res.headers.get('content-type') ?? '', url: alvo.url.toString() };
  }
  throw new FonteIndisponivelError('o link redireciona demais.');
}

@Injectable()
export class LeituraDaAtaService {
  private readonly log = new Logger('LeituraDaAta');

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly trilhos: TrilhoService,
    private readonly prisma: PrismaService,
    /** A nota `onboarding.pesquisa.web` (IM-02). `@Optional()`: as suítes montam à mão. */
    @Optional() private readonly memoria?: MemoriaService,
    /** O laço do agente (IM-02). Sem ele, ou com provedor que não chama ferramenta, o dossiê sai pela chamada direta. */
    @Optional() private readonly runtime?: AgentRuntime,
    /** IM-01: a ata gerada vai a `03-kickoff` do cliente. Ausente = fica só no OS. */
    @Optional() @Inject(ARQUIVISTA_DO_CLIENTE) private readonly arquivista?: ArquivistaDoClientePort,
  ) {}

  // ==========================================================================
  // 1. A ATA DO KICKOFF
  // ==========================================================================

  async lerAta(
    orgId: string,
    trilhoId: string,
    fonte: FonteDaAta,
    quem: Quem,
    kickoffEm?: string | null,
  ): Promise<ResultadoDaLeitura> {
    const t = await this.trilhos.exigirTrilho(orgId, trilhoId, true);
    const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
    // O kickoff cobre B, C e D; o bloco A foi antes da 1ª reunião.
    const temas = temasDoConvite('BCD', nivel);

    if (kickoffEm) {
      const d = new Date(kickoffEm);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('kickoffEm: data inválida.');
      await this.prisma.onboardingTrilho.update({ where: { id: trilhoId }, data: { kickoffEm: d } });
      t.kickoffEm = d;
    }

    let texto: string;
    let referencia: string | null = null;
    let custoDaTranscricao = 0;
    try {
      const obtido = await this.textoDaFonte(orgId, fonte);
      texto = obtido.texto;
      referencia = obtido.referencia;
      custoDaTranscricao = obtido.custoUsd;
    } catch (e) {
      const msg = (e as Error).message;
      await this.registrarAta(orgId, trilhoId, fonte.tipo, null, '', 0, null, 0, false, 0, 0, msg, quem);
      if (e instanceof AtaInvalidaError || e instanceof FonteIndisponivelError) throw new BadRequestException(msg);
      throw e;
    }

    const varredura = varrerSegredos(texto);
    const ata = varredura.texto;
    const hash = createHash('sha256').update(ata, 'utf8').digest('hex');
    const { system, user } = promptDoLeitor({
      cliente: t.cliente,
      temas,
      ata,
      kickoffEm: t.kickoffEm ? t.kickoffEm.toISOString().slice(0, 10) : null,
    });

    let saida: LlmStepOutput;
    try {
      saida = await this.llm.step({
        funcao: 'IM-01',
        system,
        turns: [{ role: 'user', text: user }],
        orgId,
        agentSlug: SLUG_DO_LEITOR_DE_ATA,
        maxTokens: 16000,
      });
    } catch (e) {
      const msg = `o leitor de ata não conseguiu chamar o modelo: ${(e as Error).message}`;
      await this.registrarAta(orgId, trilhoId, fonte.tipo, referencia, hash, Array.from(ata).length, null, custoDaTranscricao, false, 0, 0, msg, quem, varredura.removidos);
      throw new BadRequestException(msg);
    }

    let leitura: LeituraDaAta;
    try {
      leitura = interpretarLeitura(saida.text, temas, ata);
    } catch (e) {
      const msg = (e as LeituraIlegivelError).message;
      await this.registrarAta(orgId, trilhoId, fonte.tipo, referencia, hash, Array.from(ata).length, saida.usage.modeloServido, saida.usage.custoUsd + custoDaTranscricao, saida.usage.custoEstimado, 0, 0, msg, quem, varredura.removidos);
      throw new BadRequestException(msg);
    }

    const { preservadas } = await this.trilhos.propor(orgId, trilhoId, leitura.propostas, 'ata');
    const registrada = await this.registrarAta(
      orgId,
      trilhoId,
      fonte.tipo,
      referencia,
      hash,
      Array.from(ata).length,
      saida.usage.modeloServido,
      saida.usage.custoUsd + custoDaTranscricao,
      saida.usage.custoEstimado,
      leitura.propostas.length,
      leitura.emBranco.length,
      null,
      quem,
      varredura.removidos,
    );

    /*
     * IM-01 (rodada dos agentes, 21/10/2026): as NOTAS DA CONVERSA viram o marco
     * `ata.notas`, que a teia do link e `carregarMemoria` já leem (antes era
     * escrito por script). Só com nota: ata sem nota não apaga as notas que uma
     * leitura anterior deixou.
     */
    if (leitura.notas.length) {
      await this.trilhos.marco(
        orgId,
        trilhoId,
        'ata.notas',
        `${leitura.notas.length} nota(s) nasceram da conversa.`,
        { notas: leitura.notas as unknown as Record<string, unknown>[], ataId: registrada.id },
        quem,
      );
    }

    // A ata GERADA (nunca a transcrição) vai a `03-kickoff` do cliente. Falha não derruba a leitura.
    const copia = await this.copiarAtaParaOCliente(orgId, t, leitura, temas, quem);

    await this.trilhos.marco(
      orgId,
      trilhoId,
      'ata.lida',
      `Ata lida (${fonte.tipo}): ${leitura.propostas.length} proposta(s) em ${temas.length} temas, ${leitura.emBranco.length} em branco` +
        (leitura.notas.length ? `, ${leitura.notas.length} nota(s) da conversa` : '') +
        (varredura.removidos ? `, ${varredura.removidos} segredo(s) mascarado(s)` : '') +
        (preservadas.length ? `; ${preservadas.length} tema(s) já respondidos pelo cliente foram preservados` : '') +
        '.',
      {
        avisos: leitura.avisos,
        emBranco: leitura.emBranco,
        preservadas,
        custoUsd: saida.usage.custoUsd,
        modelo: saida.usage.modeloServido,
        notas: leitura.notas.length,
        copiaNoDrive: copia,
      },
      quem,
    );
    return { ata: registrada, leitura, preservadas };
  }

  /**
   * A ata gerada como `.md` na pasta do cliente (`03-kickoff`), pelo arquivista
   * (`drive.arquivo.enviar`, R3, pela porta dele). Só o resumo do resultado volta,
   * nunca o conteúdo. Sem arquivista, sem cliente ligado ou com o Drive fora, a
   * leitura segue: a ata já está no OS (o trilho), a cópia é conveniência.
   */
  private async copiarAtaParaOCliente(
    orgId: string,
    t: { id: string; cliente: string; slug: string; cardId: string | null; kickoffEm: Date | null },
    leitura: LeituraDaAta,
    temas: ReturnType<typeof temasDoConvite>,
    quem: Quem,
  ): Promise<{ estado: ResultadoDoArquivo['estado'] | 'sem_cliente' | 'sem_arquivista'; motivo: string | null }> {
    if (!this.arquivista) return { estado: 'sem_arquivista', motivo: 'o arquivista não está montado neste processo' };
    try {
      const partnerId = await this.trilhos.clienteDoTrilho(orgId, t);
      if (!partnerId) return { estado: 'sem_cliente', motivo: 'o trilho não tem cliente ligado (ficha ou card)' };
      const dia = t.kickoffEm ? t.kickoffEm.toISOString().slice(0, 10) : null;
      const md = ataGeradaEmMarkdown({ cliente: t.cliente, kickoffEm: dia, temas, leitura });
      const r = await this.arquivista.arquivar({
        orgId,
        partnerId,
        origem: 'ata',
        nomeOriginal: `ata-kickoff-${t.slug}.md`,
        tipoMime: 'text/markdown',
        conteudo: { buffer: Buffer.from(md, 'utf8') },
        subpasta: '03-kickoff',
        tipo: 'ata',
        titulo: `Ata do kickoff ${t.cliente}`,
        data: t.kickoffEm ?? new Date(),
        texto: md.slice(0, 8000),
        atorId: quem.id,
      });
      return { estado: r.estado, motivo: 'motivo' in r ? r.motivo : null };
    } catch (e) {
      this.log.warn(`trilho ${t.id}: a ata não foi para a pasta do cliente (${(e as Error).message})`);
      return { estado: 'erro', motivo: (e as Error).message.slice(0, 300) };
    }
  }

  /** O texto da ata, venha de onde vier. PDF passa pelo modelo primeiro. */
  private async textoDaFonte(
    orgId: string,
    fonte: FonteDaAta,
  ): Promise<{ texto: string; referencia: string | null; custoUsd: number }> {
    if (fonte.tipo === 'texto') {
      return { texto: conferirAta(fonte.texto), referencia: fonte.referencia ?? null, custoUsd: 0 };
    }
    if (fonte.tipo === 'link') {
      const { corpo, tipo, url } = await buscarLinkDeFora(String(fonte.url ?? '').trim());
      const texto = /html/i.test(tipo) ? htmlParaTexto(corpo) : corpo;
      try {
        return { texto: conferirAta(texto), referencia: url, custoUsd: 0 };
      } catch (e) {
        throw new FonteIndisponivelError(
          `a página não trouxe a transcrição (${(e as Error).message}). Páginas montadas por JavaScript não ` +
            'são lidas — cole o texto ou envie o PDF.',
        );
      }
    }
    // PDF
    if (!this.llm.leAnexos) {
      throw new FonteIndisponivelError(
        `o provedor de modelo atual (${this.llm.name}) não lê PDF. Cole a transcrição como texto.`,
      );
    }
    const base64 = String(fonte.base64 ?? '').replace(/\s+/g, '');
    if (!base64) throw new FonteIndisponivelError('o PDF veio vazio.');
    if ((base64.length * 3) / 4 > MAX_PDF_BYTES) throw new FonteIndisponivelError('o PDF passa de 30 MB.');
    const saida = await this.llm.step({
      funcao: 'IM-01',
      system:
        'Você transcreve documentos. Devolva o TEXTO INTEGRAL do PDF anexado, na ordem em que aparece, ' +
        'sem resumir, sem comentar, sem corrigir. Preserve as marcas de tempo e os nomes de quem fala. ' +
        'Se houver senha, token, chave ou dado bancário, escreva "[segredo omitido]" no lugar.',
      turns: [
        {
          role: 'user',
          text: 'Transcreva o documento anexado na íntegra.',
          anexos: [{ tipo: 'pdf', base64, titulo: fonte.nome ?? 'ata.pdf' }],
        },
      ],
      orgId,
      agentSlug: SLUG_DO_LEITOR_DE_ATA,
      effort: 'low',
      maxTokens: 60_000,
      // Streaming: saída longa não cabe no timeout de uma chamada comum.
      onTextDelta: () => undefined,
    });
    return { texto: conferirAta(saida.text), referencia: fonte.nome ?? 'ata.pdf', custoUsd: saida.usage.custoUsd };
  }

  private async registrarAta(
    orgId: string,
    trilhoId: string,
    fonte: string,
    referencia: string | null,
    hash: string,
    caracteres: number,
    modelo: string | null,
    custoUsd: number,
    custoEstimado: boolean,
    propostas: number,
    emBranco: number,
    erro: string | null,
    quem: Quem,
    segredosRemovidos = 0,
  ): Promise<AtaNaBancada> {
    const a = await this.prisma.onboardingAta.create({
      data: {
        orgId,
        trilhoId,
        fonte,
        referencia,
        caracteres,
        hash,
        segredosRemovidos,
        modelo,
        custoUsd: new Prisma.Decimal(Number.isFinite(custoUsd) ? custoUsd : 0),
        custoEstimado,
        propostas,
        emBranco,
        erro,
        lidaPor: quem.nome,
      },
    });
    return {
      id: a.id,
      fonte: a.fonte,
      referencia: a.referencia,
      caracteres: a.caracteres,
      segredosRemovidos: a.segredosRemovidos,
      modelo: a.modelo,
      custoUsd: Number(a.custoUsd),
      custoEstimado: a.custoEstimado,
      propostas: a.propostas,
      emBranco: a.emBranco,
      erro: a.erro,
      lidaPor: a.lidaPor,
      lidaEm: a.lidaEm.toISOString(),
    };
  }

  // ==========================================================================
  // 2. O DOSSIÊ DE UMA PÁGINA (fase 0)
  // ==========================================================================

  async gerarDossie(orgId: string, trilhoId: string, fontePublica: string | null, quem: Quem): Promise<Dossie> {
    const t = await this.trilhos.exigirTrilho(orgId, trilhoId, true);
    const temasA = temasDoBloco('A');
    const porTema = new Map(t.itens.map((i) => [i.temaId, i]));
    const respostasA = temasA
      .map((tema) => {
        const i = porTema.get(tema.id);
        const r = i?.textoFinal ?? (i?.status === 'aprovado' ? i.proposta : null);
        return r ? { titulo: tema.titulo, resposta: r } : null;
      })
      .filter((x): x is { titulo: string; resposta: string } => !!x);

    // O que a casa já sabe: notas da própria ROOT que citam o cliente.
    const nome = t.cliente.trim();
    const notas = nome.length >= 3
      ? await this.prisma.contextItem.findMany({
          where: {
            orgId,
            arquivadoEm: null, acessoRestrito: false,
            OR: [
              { title: { contains: nome, mode: 'insensitive' } },
              { body: { contains: nome, mode: 'insensitive' } },
            ],
          },
          take: 8,
          select: { title: true, body: true },
        })
      : [];
    const memoria = notas.map((n) => ({ titulo: n.title, trecho: Array.from(n.body).slice(0, 400).join('') }));

    const fonte = fontePublica ? varrerSegredos(String(fontePublica).slice(0, 40_000)).texto : null;
    const entrada = { cliente: t.cliente, contato: t.contatoNome, respostasA, fontePublica: fonte, memoria };

    /*
     * IM-02 (rodada dos agentes, 21/10/2026): o pesquisador passa pelo LAÇO DO
     * AGENTE e pela porta, com as capacidades que declara (`contexto.memoria.buscar`,
     * `contexto.nota.ler`), em nome do registro `Agent` que o roster do onboarding
     * semeia. A busca na web só com o provedor que a executa E a nota ligada.
     *
     * Sem o laço montado, ou com um provedor que não chama ferramenta (o `stub` da
     * homologação), cai na chamada direta de antes, com o mesmo prompt e o mesmo
     * parser: o dossiê não pode depender de a homologação ter modelo de verdade.
     */
    let texto: string;
    let custoUsd = 0;
    let modelo: string | null = null;
    let via: 'laco' | 'direta';
    let web = false;
    if (this.runtime && this.llm.supportsTools) {
      web = await this.buscaNaWebPermitida(orgId);
      const r = await this.runtime.executar({
        orgId,
        agentSlug: SLUG_DO_PESQUISADOR_DE_CONTA,
        canal: SessionCanal.web,
        pedido: pedidoDoPesquisador(entrada, { buscaNaWeb: web }),
        solicitanteId: quem.id,
        solicitanteRotulo: quem.nome,
        funcao: 'IM-02',
        ...(web ? { servidor: { buscaNaWeb: { maxUsos: USOS_DA_BUSCA_NA_WEB } } } : {}),
      });
      if (r.status !== SessionStatus.respondida || !r.resposta.trim()) {
        throw new BadRequestException(
          `o pesquisador de conta não respondeu (${r.status}${r.motivo ? `: ${r.motivo}` : ''}). Veja a sessão ${r.sessionId} em Agentes.`,
        );
      }
      texto = r.resposta;
      custoUsd = r.custoUsd;
      via = 'laco';
    } else {
      const { system, user } = promptDoDossie(entrada);
      const saida = await this.llm.step({
        funcao: 'IM-02',
        system,
        turns: [{ role: 'user', text: user }],
        orgId,
        agentSlug: SLUG_DO_PESQUISADOR_DE_CONTA,
        maxTokens: 12_000,
      });
      texto = saida.text;
      custoUsd = saida.usage.custoUsd;
      modelo = saida.usage.modeloServido;
      via = 'direta';
    }
    const dossie = interpretarDossie(texto);
    await this.trilhos.marco(
      orgId,
      trilhoId,
      'dossie.gerado',
      `Dossiê gerado: ${dossie.afirmacoes.length} afirmação(ões), ${dossie.hipoteses.length} hipótese(s), ` +
        `${dossie.perguntasQueFaltam.length} pergunta(s) que faltam` +
        (dossie.perfilSugerido ? `; perfil sugerido ${dossie.perfilSugerido}` : '') +
        (via === 'laco' ? `; pelo laço do agente${web ? ', com busca na web' : ''}` : '') +
        '.',
      { dossie: dossie as unknown as Record<string, unknown>, custoUsd, modelo, via, buscaNaWeb: web },
      quem,
    );
    return dossie;
  }

  /** As duas condições da busca na web (IM-02): o provedor a executa e a nota está `ligada`. */
  async buscaNaWebPermitida(orgId: string): Promise<boolean> {
    if (!this.llm.buscaNaWeb || !this.memoria) return false;
    // Nota de configuração da casa: lida como fonte aberta (leitor nulo), como `trabalho.atas.pasta`.
    const nota = await this.memoria.porChave(orgId, NOTA_DA_PESQUISA_NA_WEB, null).catch(() => null);
    return !!nota && !nota.arquivadoEm && buscaNaWebLigada(nota.body);
  }

  // ==========================================================================
  // 3. O ROTEIRO PERSONALIZADO (acabamento, não pré-requisito)
  // ==========================================================================

  async personalizarRoteiro(orgId: string, trilhoId: string, quem: Quem): Promise<Record<string, string>> {
    const t = await this.trilhos.exigirTrilho(orgId, trilhoId, true);
    const roteiro = await this.trilhos.roteiro(orgId, trilhoId);
    const folha = await this.trilhos.folhaDeReuniao(orgId, trilhoId);
    const temas = roteiro.blocos.flatMap((b) => b.temas);
    const ids = new Set(temas.map((x) => x.id));

    const { system, user } = promptDoRoteirista({
      cliente: t.cliente,
      temas,
      triagem: roteiro.triagem,
      afirmacoes: folha.dossie ? folha.dossie.afirmacoes.map((a) => a.texto) : null,
    });

    const saida = await this.llm.step({
      funcao: 'IM-03',
      system,
      turns: [{ role: 'user', text: user }],
      orgId,
      agentSlug: SLUG_DO_ROTEIRISTA,
      maxTokens: 8000,
    });
    let perguntas: Record<string, string>;
    try {
      perguntas = lerPerguntasDoRoteirista(saida.text, ids);
    } catch (e) {
      if (e instanceof RoteiroIlegivelError) throw new BadRequestException(e.message);
      throw e;
    }
    await this.trilhos.marco(
      orgId,
      trilhoId,
      'roteiro.personalizado',
      `Roteiro personalizado pelo roteirista: ${Object.keys(perguntas).length} de ${temas.length} perguntas reescritas.`,
      { perguntas, custoUsd: saida.usage.custoUsd, modelo: saida.usage.modeloServido },
      quem,
    );
    return perguntas;
  }
}
