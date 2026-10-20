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
import { ContextKind, ContextSource, Prisma } from '@prisma/client';
import {
  ATA_CHAVE_DA_PASTA,
  ATA_PASTA_PADRAO,
  ATA_PREFIXO_DA_CHAVE,
  lerRefDaAta,
  refDaAta,
  type TrabAtaAceitarInput,
  type TrabAtaColarInput,
  type TrabAtaContagem,
  type TrabAtaDecidida,
  type TrabAtaDetalhe,
  type TrabAtaFonte,
  type TrabAtaGeracao,
  type TrabAtaLista,
  type TrabAtaPendencia,
  type TrabAtaResumo,
  type TrabAtaSugestaoDto,
  type TrabAtaSugestaoEstado,
} from '@mktos/shared';

import { temPapelDeMaquina } from '../../approvals/alcada';
import { AuditService } from '../../audit/audit.service';
import { lerAprovador } from '../../auth/aprovador';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { MemoriaService } from '../../memory/memoria.service';
import { normalizarParaBusca } from '../../onboarding/trilho/leitor-de-ata';
import { varrerSegredos } from '../../onboarding/trilho/segredos';
import { umaPorVez } from '../../pauta/uma-por-vez';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkService } from '../work.service';
import {
  SugestoesIlegiveisError,
  dataIsoValida,
  interpretarSugestoes,
  metadadosDaAta,
  promptDasSugestoes,
  slugDaAta,
  type ListaParaAta,
} from './leitor-de-atas';
import { pendenciaCasaComSugestao, secoesDaAta } from './leitor-do-granola';

/* ==========================================================================
 * O BANCO DE ATAS DO TRABALHO (rodada do painel P3, 18/10/2026)
 * ==========================================================================
 *
 * DE ONDE VÊM AS ATAS, e nenhuma delas é cópia:
 *   · do VAULT: as notas que o conector do Obsidian já indexou (`KnowledgeNote`)
 *     dentro da pasta das reuniões (padrão `80-Reunioes`; a nota da memória
 *     `trabalho.atas.pasta` muda, primeira linha = a pasta). Só leitura;
 *   · COLADAS na tela: viram nota da memória pelo `MemoriaService.criar`, o
 *     caminho da ADR-011 (versão + evento no RASTRO). Este serviço NUNCA escreve
 *     em `ContextItem` por fora; a leitura das coladas é consulta direta, só de
 *     leitura, como a do dossiê do onboarding.
 *
 * AS SUGESTÕES: `gerar` chama o modelo pelo `LlmProvider` (com `orgId`, sob o
 * teto da empresa), uma leitura por ata de cada vez (`umaPorVez`: o segundo
 * clique é 409 antes de gastar), e grava o que o parser deixou passar em
 * `AtaSugestao`, em rascunho. `aceitar` cria a tarefa pelo `WorkService` (o
 * mesmo `criarTarefa` do botão da tela, com auditoria `work.task.create`);
 * dois cliques criam UMA tarefa porque a sugestão é tomada por escrita
 * condicionada ao estado lido antes de a tarefa nascer.
 *
 * O QUE A REVISÃO DE 18/10/2026 FECHOU (laudo `homolog/revisao/painel-20261018.md`):
 *   · PA-2, o banco de atas NÃO ALARGA ACESSO. A ata do vault só aparece, abre,
 *     é lida pelo agente ou vira tarefa para quem lê o vault (`obsidian.ver`,
 *     o `acesso.vault` que o controller passa). Sem ela, a lista traz só as
 *     coladas e diz por quê. Colar escreve na memória e pede, no controller, a
 *     mesma permissão do `POST /memoria` (`obsidian.editar`);
 *   · PA-3, "nunca cria task sozinho" vale AQUI: conta de máquina (`ia_servico`,
 *     `ia_acao`) não cola, não pede leitura, não aceita nem descarta. A recusa
 *     é pelo token (guarda no controller) e de novo pelo banco (`exigirGente`);
 *   · PA-5, a ata do vault passa pela mesma varredura de segredos da colada
 *     antes de ir à tela, ao modelo, ao trecho guardado e à tarefa.
 */

/** Teto de atas do vault lidas por listagem. A tela pagina pelo mais novo. */
const MAX_DO_VAULT = 200;
const MAX_COLADAS = 200;
const SAIDA_DA_LEITURA = 4000;

/** Quem age: o id e os papéis do token (relidos no banco antes de escrever). */
export interface QuemDecide {
  id: string;
  papeis: readonly string[];
}

/** O que quem pediu pode ler além do Trabalho. `vault` = tem `obsidian.ver`. */
export interface AcessoAsAtas {
  vault: boolean;
}

export const RECUSA_DE_MAQUINA_NAS_ATAS =
  'Ata é decisão de gente: conta de serviço (IA) não cola ata, não pede a leitura e não aceita nem descarta sugestão.';
export const RECUSA_DO_VAULT_NAS_ATAS =
  'Esta ata é do vault, e ler o vault pede a permissão "obsidian.ver". Peça a quem administra, ou use uma ata colada.';

type LinhaDaSugestao = Prisma.AtaSugestaoGetPayload<Record<string, never>>;

interface AtaLida {
  ref: string;
  fonte: TrabAtaFonte;
  titulo: string;
  texto: string;
  caminho: string | null;
  procedencia: string;
  atualizadaEm: Date;
  /** O id da reunião no Granola, quando a ata veio de lá (procedência `granola:<id>`). */
  granolaId?: string | null;
  versao?: number | null;
}

/** A procedência das atas que o OS escreveu a partir do Granola. */
export const PREFIXO_DA_PROCEDENCIA_DO_GRANOLA = 'granola:';
const granolaIdDa = (sourceRef: string | null | undefined): string | null =>
  sourceRef && sourceRef.startsWith(PREFIXO_DA_PROCEDENCIA_DO_GRANOLA) ? sourceRef.slice(PREFIXO_DA_PROCEDENCIA_DO_GRANOLA.length) || null : null;

function contagemVazia(): TrabAtaContagem {
  return { rascunho: 0, aceitas: 0, descartadas: 0 };
}

@Injectable()
export class AtasService {
  private readonly log = new Logger('AtasDoTrabalho');

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoria: MemoriaService,
    private readonly work: WorkService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  // ==========================================================================
  // LEITURA
  // ==========================================================================

  /** A pasta do vault que vale para esta empresa. */
  async pasta(orgId: string): Promise<string> {
    // Nota de configuração da casa: lida como fonte ABERTA (leitor nulo), que é o que a
    // regra da memória dá a quem não declara identidade. Quem cola ou lista atas tem
    // `tarefas.*`, não precisa de `obsidian.ver`, e nota restrita não vale como configuração.
    const nota = await this.memoria.porChave(orgId, ATA_CHAVE_DA_PASTA, null).catch(() => null);
    const linha = nota && !nota.arquivadoEm ? nota.body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) : null;
    const limpa = (linha ?? '').replace(/^\/+|\/+$/g, '');
    return limpa && limpa.length <= 200 && !limpa.includes('..') ? limpa : ATA_PASTA_PADRAO;
  }

  private filtroDaPasta(pasta: string): Prisma.KnowledgeNoteWhereInput {
    return {
      OR: [
        { folder: pasta },
        { folder: { startsWith: `${pasta}/` } },
        { folder: { endsWith: `/${pasta}` } },
        { folder: { contains: `/${pasta}/` } },
      ],
    };
  }

  async listar(orgId: string, acesso: AcessoAsAtas): Promise<TrabAtaLista> {
    const pasta = await this.pasta(orgId);
    const [doVault, coladas, notasDoVault, contagens] = await Promise.all([
      // Sem `obsidian.ver`, o vault nem é consultado (PA-2).
      acesso.vault
        ? this.prisma.knowledgeNote.findMany({
            where: { orgId, ...this.filtroDaPasta(pasta) },
            orderBy: { fileTime: 'desc' },
            take: MAX_DO_VAULT,
            select: { id: true, path: true, title: true, content: true, fileTime: true },
          })
        : Promise.resolve([]),
      this.prisma.contextItem.findMany({
        where: { orgId, chave: { startsWith: ATA_PREFIXO_DA_CHAVE }, arquivadoEm: null },
        orderBy: { atualizadoEm: 'desc' },
        take: MAX_COLADAS,
        select: { id: true, title: true, body: true, atualizadoEm: true, sourceRef: true, versao: true },
      }),
      this.prisma.knowledgeNote.count({ where: { orgId } }),
      this.contagens(orgId),
    ]);
    const decididas = await this.decididasPorAta(orgId);

    const atas: TrabAtaResumo[] = [
      ...doVault.map((n) =>
        this.resumo(
          { ref: refDaAta('vault', n.id), fonte: 'vault', titulo: n.title, texto: varrerSegredos(n.content).texto, caminho: n.path, procedencia: '', atualizadaEm: n.fileTime },
          contagens,
          decididas,
        ),
      ),
      ...coladas.map((c) =>
        this.resumo(
          {
            ref: refDaAta('colada', c.id),
            fonte: granolaIdDa(c.sourceRef) ? 'granola' : 'colada',
            titulo: c.title,
            texto: c.body,
            caminho: null,
            procedencia: '',
            atualizadaEm: c.atualizadoEm,
            granolaId: granolaIdDa(c.sourceRef),
            versao: c.versao,
          },
          contagens,
          decididas,
        ),
      ),
    ];
    // A mais nova primeiro: pela data da reunião, e sem ela pela do arquivo.
    atas.sort((a, b) => (b.data ?? b.atualizadaEm.slice(0, 10)).localeCompare(a.data ?? a.atualizadaEm.slice(0, 10)) || b.atualizadaEm.localeCompare(a.atualizadaEm));
    return { atas, pasta, notasDoVault, vaultVisivel: acesso.vault, iaConfigurada: this.llm.configured };
  }

  async ler(orgId: string, ref: string, acesso: AcessoAsAtas): Promise<TrabAtaDetalhe> {
    const ata = await this.exigirAta(orgId, ref, acesso);
    const linhas = await this.prisma.ataSugestao.findMany({
      where: { orgId, ataRef: ata.ref },
      orderBy: { criadaEm: 'asc' },
    });
    const dtos = await this.paraDtos(orgId, linhas);
    const contagens = new Map<string, TrabAtaContagem>([[ata.ref, this.contar(linhas)]]);
    const decididas = new Map<string, TrabAtaDecidida[]>([[ata.ref, this.decididasDe(dtos)]]);
    // A ata aberta mostra decisões e pendências como lista; a pendência que virou sugestão aparece marcada.
    const secoes = secoesDaAta(ata.texto);
    const pendencias: TrabAtaPendencia[] = secoes.pendencias.map((texto) => {
      const casadas = dtos.filter((d) => pendenciaCasaComSugestao(texto, d));
      const s = casadas.find((d) => d.estado === 'aceita') ?? casadas.find((d) => d.estado === 'rascunho') ?? casadas[0] ?? null;
      return { texto, sugestaoId: s?.id ?? null, estado: s?.estado ?? null, workTaskId: s?.workTaskId ?? null };
    });
    return {
      ...this.resumo(ata, contagens, decididas),
      texto: ata.texto,
      procedencia: ata.procedencia,
      sugestoesDaAta: dtos,
      decisoes: secoes.decisoes,
      pendencias,
      versao: ata.versao ?? null,
    };
  }

  async sugestoes(
    orgId: string,
    filtro: { ata?: string; estado?: string },
    acesso: AcessoAsAtas,
  ): Promise<TrabAtaSugestaoDto[]> {
    const estado = filtro.estado && ['rascunho', 'aceita', 'descartada'].includes(filtro.estado) ? filtro.estado : undefined;
    const linhas = await this.prisma.ataSugestao.findMany({
      where: {
        orgId,
        ...(filtro.ata ? { ataRef: filtro.ata } : {}),
        ...(estado ? { estado } : {}),
        // O trecho da sugestão é texto do vault: sem `obsidian.ver`, as do vault ficam de fora.
        ...(acesso.vault ? {} : { NOT: { ataRef: { startsWith: 'vault:' } } }),
      },
      orderBy: { criadaEm: 'desc' },
      take: 500,
    });
    return this.paraDtos(orgId, linhas);
  }

  // ==========================================================================
  // COLAR — a ata avulsa vira nota da memória (ADR-011)
  // ==========================================================================

  async colar(orgId: string, quem: QuemDecide, input: TrabAtaColarInput): Promise<TrabAtaDetalhe> {
    await this.exigirGente(orgId, quem);
    const actorId = quem.id;
    const titulo = input.titulo.replace(/\s+/g, ' ').trim();
    const varredura = varrerSegredos(String(input.texto ?? '').replace(/\r\n/g, '\n').trim());
    const texto = varredura.texto;
    const participantes = (input.participantes ?? []).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

    // O cabeçalho que a lista lê, só com o que a pessoa informou e a ata ainda não diz.
    const meta = metadadosDaAta(texto);
    const cabecalho: string[] = [];
    const data = input.data ?? meta.data ?? null;
    if (input.data && !meta.data) cabecalho.push(`Data: ${input.data}`);
    if (participantes.length && !meta.participantes.length) cabecalho.push(`Participantes: ${participantes.join(', ')}`);
    const corpo = cabecalho.length ? `${cabecalho.join('\n')}\n\n${texto}` : texto;

    const base = `${ATA_PREFIXO_DA_CHAVE}${data ?? 'sem-data'}-${slugDaAta(titulo)}`;
    let nota: Awaited<ReturnType<MemoriaService['criar']>> | null = null;
    for (let n = 1; n <= 20 && !nota; n++) {
      const chave = n === 1 ? base : `${base}-${n}`;
      if (await this.memoria.porChave(orgId, chave)) continue;
      try {
        nota = await this.memoria.criar(orgId, {
          chave,
          kind: ContextKind.nota,
          title: titulo,
          body: corpo,
          tags: ['ata', 'trabalho'],
          sourceType: ContextSource.operador,
          sourceRef: 'colada em Trabalho › Atas',
          motivo: 'ata colada na tela de Atas do Trabalho',
        });
      } catch (e) {
        // Outra aba criou a mesma chave entre a consulta e a escrita: tenta a próxima.
        if (e instanceof ConflictException) continue;
        throw e;
      }
    }
    if (!nota) throw new ConflictException('Já existem atas demais com esse título nesse dia. Mude o título.');

    await this.audit.log({
      orgId,
      actorId,
      action: 'trabalho.ata.colada',
      entityType: 'context_item',
      entityId: nota.id,
      after: { chave: nota.chave, versao: nota.versao, caracteres: Array.from(corpo).length, segredosMascarados: varredura.removidos },
    });
    return this.ler(orgId, refDaAta('colada', nota.id), { vault: false });
  }

  // ==========================================================================
  // GERAR — o leitor propõe, o parser confere
  // ==========================================================================

  async gerar(orgId: string, quem: QuemDecide, ref: string, acesso: AcessoAsAtas): Promise<TrabAtaGeracao> {
    // Antes do `umaPorVez` e do modelo: conta de máquina não gasta IA nem ocupa a vez (PA-3).
    await this.exigirGente(orgId, quem);
    return umaPorVez(`trabalho-atas:${orgId}:${ref}`, 'A leitura desta ata', () => this.gerarAgora(orgId, quem.id, ref, acesso));
  }

  private async gerarAgora(orgId: string, actorId: string, ref: string, acesso: AcessoAsAtas): Promise<TrabAtaGeracao> {
    const ata = await this.exigirAta(orgId, ref, acesso);
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }
    const [listas, pessoas] = await Promise.all([this.listasDaEmpresa(orgId), this.pessoasDaEmpresa(orgId)]);
    const meta = metadadosDaAta(ata.texto, ata.caminho);
    const { system, user, cortada } = promptDasSugestoes({
      ref: ata.ref,
      titulo: ata.titulo,
      data: meta.data,
      ata: ata.texto,
      listas,
      pessoas,
    });

    let saida: string;
    try {
      saida = await this.llm.complete({ system, user, orgId, maxTokens: SAIDA_DA_LEITURA });
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ConflictException) throw e;
      const msg = `o leitor de atas não conseguiu chamar o modelo: ${(e as Error).message}`;
      this.log.warn(`${orgId} ${ata.ref}: ${msg}`);
      throw new ServiceUnavailableException(msg);
    }

    let leitura: ReturnType<typeof interpretarSugestoes>;
    try {
      // O dia da reunião resolve o ano da data sem ano; sem ele, o dia do arquivo.
      const referencia = meta.data ?? ata.atualizadaEm.toISOString().slice(0, 10);
      leitura = interpretarSugestoes(saida, { ata: ata.texto, listas, pessoas, referencia });
    } catch (e) {
      if (e instanceof SugestoesIlegiveisError) throw new ServiceUnavailableException(e.message);
      throw e;
    }
    const avisos = [...(cortada ? ['a ata é longa e entrou cortada na leitura'] : []), ...leitura.avisos];

    // A mesma tarefa lida de novo não vira segundo rascunho (vale o título, sem caixa nem acento).
    const existentes = await this.prisma.ataSugestao.findMany({
      where: { orgId, ataRef: ata.ref },
      select: { titulo: true },
    });
    const jaTem = new Set(existentes.map((e) => normalizarParaBusca(e.titulo)));
    const novas = leitura.sugestoes.filter((s) => !jaTem.has(normalizarParaBusca(s.titulo)));
    const repetidas = leitura.sugestoes.length - novas.length;

    const criadas = novas.length
      ? await this.prisma.$transaction(
          novas.map((s) =>
            this.prisma.ataSugestao.create({
              data: {
                orgId,
                ataRef: ata.ref,
                // A ata já entrou varrida; varrer de novo o que se grava é a segunda tranca (PA-5).
                titulo: varrerSegredos(s.titulo).texto,
                listaId: s.listaId,
                donoSugerido: s.donoSugerido,
                vencimento: s.vencimento ? new Date(`${s.vencimento}T12:00:00.000Z`) : null,
                trecho: varrerSegredos(s.trecho).texto,
                estado: 'rascunho',
                criadaPor: actorId,
              },
            }),
          ),
        )
      : [];

    await this.audit.log({
      orgId,
      actorId,
      action: 'trabalho.ata.sugestoes_geradas',
      entityType: 'ata',
      entityId: ata.ref,
      // Só a forma: o texto da ata e dos trechos não entra na auditoria.
      after: {
        criadas: criadas.length,
        repetidas,
        descartadasPeloParser: leitura.descartadas,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });
    return { criadas: await this.paraDtos(orgId, criadas), repetidas, avisos };
  }

  // ==========================================================================
  // DECIDIR — aceitar cria a tarefa pelo Trabalho; descartar fica registrado
  // ==========================================================================

  async aceitar(
    orgId: string,
    quem: QuemDecide,
    id: string,
    input: TrabAtaAceitarInput,
    acesso: AcessoAsAtas,
  ): Promise<TrabAtaSugestaoDto> {
    await this.exigirGente(orgId, quem);
    const actorId = quem.id;
    const s = await this.prisma.ataSugestao.findFirst({ where: { id, orgId } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    this.exigirAcessoAFonte(s.ataRef, acesso);
    if (s.estado !== 'rascunho') throw this.jaDecidida(s.estado);
    // O dono e o vencimento são os que a pessoa confirmou na tela (PA-4); ausentes, os da sugestão.
    let dono = input.dono === undefined ? s.donoSugerido : input.dono?.trim() || null;
    // T5: o responsável escolhido entre os perfis reais da empresa (gente, não conta de máquina).
    if (input.responsavelId) {
      const pessoa = await this.prisma.user.findFirst({
        where: { id: input.responsavelId, orgId, isActive: true },
        select: { name: true, roles: { select: { key: true } } },
      });
      if (!pessoa || pessoa.roles.some((r) => ['ia_servico', 'ia_acao'].includes(r.key))) {
        throw new BadRequestException('O responsável escolhido não é uma pessoa desta empresa.');
      }
      dono = pessoa.name;
    } else if (input.responsavelId === null) dono = null;
    const titulo = input.titulo?.trim() || s.titulo;
    const descricaoEditada = input.descricao === undefined ? null : input.descricao?.trim() || null;
    let vencimento: string | null = s.vencimento ? s.vencimento.toISOString().slice(0, 10) : null;
    if (input.vencimento !== undefined) {
      if (input.vencimento === null) vencimento = null;
      else {
        vencimento = dataIsoValida(input.vencimento);
        if (!vencimento) throw new BadRequestException('O vencimento escolhido não é uma data que existe.');
      }
    }
    const listId = input.listaId ?? s.listaId;
    if (!listId) throw new BadRequestException('Escolha a lista da tarefa antes de aceitar.');
    // T4: toda tarefa nova tem cliente; a pergunta vem antes da tomada, para nada ser marcado à toa.
    if (!input.clienteId) throw new BadRequestException('Escolha o cliente da tarefa antes de aceitar. O trabalho da própria empresa vai para o cliente interno.');
    const lista = await this.prisma.workList.findFirst({ where: { id: listId, orgId }, select: { id: true } });
    if (!lista) throw new BadRequestException('A lista escolhida não existe mais nesta empresa.');

    // A TOMADA: só um clique passa daqui. O segundo lê `count: 0` e ouve 409.
    const tomada = await this.prisma.ataSugestao.updateMany({
      where: { id, orgId, estado: 'rascunho' },
      data: { estado: 'aceita', listaId: listId, decididaPor: actorId, decididaEm: new Date() },
    });
    if (tomada.count === 0) {
      const agora = await this.prisma.ataSugestao.findFirst({ where: { id, orgId }, select: { estado: true } });
      throw this.jaDecidida(agora?.estado ?? 'aceita');
    }

    const ata = await this.resumoDaAtaParaTarefa(orgId, s.ataRef, acesso);
    let tarefaId: string;
    try {
      const procedencia = this.descricaoDaTarefa(s, ata);
      const tarefa = await this.work.criarTarefa(orgId, actorId, {
        listId,
        title: titulo,
        // O que será executado vem primeiro; o trecho da ata segue como procedência.
        description: descricaoEditada ? [descricaoEditada, '', procedencia].join('\n') : procedencia,
        assignee: dono,
        dueDate: vencimento ? new Date(`${vencimento}T12:00:00.000Z`).toISOString() : null,
        clienteId: input.clienteId ?? null,
      }, { exigirCliente: true });
      tarefaId = tarefa.id;
    } catch (e) {
      // A tarefa não nasceu: a sugestão volta a rascunho, para a pessoa tentar de novo.
      await this.prisma.ataSugestao.updateMany({
        where: { id, orgId, estado: 'aceita', workTaskId: null },
        data: { estado: 'rascunho', decididaPor: null, decididaEm: null },
      });
      throw e;
    }

    // Com a empresa no `where`, como toda escrita deste serviço.
    await this.prisma.ataSugestao.updateMany({ where: { id, orgId, estado: 'aceita' }, data: { workTaskId: tarefaId } });
    const final = await this.prisma.ataSugestao.findFirstOrThrow({ where: { id, orgId } });
    const vencimentoSugerido = s.vencimento ? s.vencimento.toISOString().slice(0, 10) : null;
    await this.audit.log({
      orgId,
      actorId,
      action: 'trabalho.ata.sugestao_aceita',
      entityType: 'ata_sugestao',
      entityId: id,
      // Só a forma: se a pessoa corrigiu, não o quê (o nome e a data ficam na tarefa).
      after: {
        ataRef: s.ataRef,
        workTaskId: tarefaId,
        listaId: listId,
        donoCorrigido: dono !== (s.donoSugerido ?? null),
        vencimentoCorrigido: vencimento !== vencimentoSugerido,
        tituloCorrigido: titulo !== s.titulo,
        descricaoEscrita: !!descricaoEditada,
      },
    });
    return (await this.paraDtos(orgId, [final]))[0];
  }

  async descartar(orgId: string, quem: QuemDecide, id: string, acesso: AcessoAsAtas): Promise<TrabAtaSugestaoDto> {
    await this.exigirGente(orgId, quem);
    const actorId = quem.id;
    const s = await this.prisma.ataSugestao.findFirst({ where: { id, orgId } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    this.exigirAcessoAFonte(s.ataRef, acesso);
    const r = await this.prisma.ataSugestao.updateMany({
      where: { id, orgId, estado: 'rascunho' },
      data: { estado: 'descartada', decididaPor: actorId, decididaEm: new Date() },
    });
    if (r.count === 0) {
      const agora = await this.prisma.ataSugestao.findFirst({ where: { id, orgId }, select: { estado: true } });
      throw this.jaDecidida(agora?.estado ?? s.estado);
    }
    await this.audit.log({
      orgId,
      actorId,
      action: 'trabalho.ata.sugestao_descartada',
      entityType: 'ata_sugestao',
      entityId: id,
      after: { ataRef: s.ataRef },
    });
    const final = await this.prisma.ataSugestao.findFirstOrThrow({ where: { id, orgId } });
    return (await this.paraDtos(orgId, [final]))[0];
  }

  // ==========================================================================
  // Por dentro
  // ==========================================================================

  /**
   * Gente de verdade, relida no banco: usuário ativo desta empresa e sem papel
   * de máquina. O guarda do controller recusa pelo token; esta é a segunda
   * tranca, contra o token antigo de quem virou conta de serviço (PA-3).
   */
  async exigirGente(orgId: string, quem: QuemDecide): Promise<void> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NAS_ATAS);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem decide uma ata precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NAS_ATAS);
  }

  /** A sugestão de uma ata do vault só se decide com `obsidian.ver` (o trecho É o vault). */
  private exigirAcessoAFonte(ataRef: string, acesso: AcessoAsAtas): void {
    if (!acesso.vault && lerRefDaAta(ataRef)?.fonte === 'vault') throw new ForbiddenException(RECUSA_DO_VAULT_NAS_ATAS);
  }

  private jaDecidida(estado: string): ConflictException {
    return new ConflictException(
      estado === 'descartada' ? 'Esta sugestão já foi descartada.' : 'Esta sugestão já foi aceita: a tarefa já existe.',
    );
  }

  async exigirAta(orgId: string, ref: string, acesso: AcessoAsAtas): Promise<AtaLida> {
    const lida = lerRefDaAta(ref);
    if (!lida) throw new NotFoundException('Ata não encontrada.');
    if (lida.fonte === 'vault') {
      if (!acesso.vault) throw new ForbiddenException(RECUSA_DO_VAULT_NAS_ATAS);
      const pasta = await this.pasta(orgId);
      const n = await this.prisma.knowledgeNote.findFirst({
        where: { id: lida.id, orgId, ...this.filtroDaPasta(pasta) },
        select: { id: true, path: true, title: true, content: true, fileTime: true },
      });
      if (!n) throw new NotFoundException('Ata não encontrada.');
      return {
        ref: refDaAta('vault', n.id),
        fonte: 'vault',
        titulo: n.title,
        // A mesma varredura da colada, antes da tela, do modelo e do trecho (PA-5).
        texto: varrerSegredos(n.content).texto,
        caminho: n.path,
        procedencia: `vault: ${n.path}`,
        atualizadaEm: n.fileTime,
      };
    }
    const c = await this.prisma.contextItem.findFirst({
      where: { id: lida.id, orgId, chave: { startsWith: ATA_PREFIXO_DA_CHAVE }, arquivadoEm: null },
      select: { id: true, title: true, body: true, atualizadoEm: true, sourceRef: true, versao: true, chave: true },
    });
    if (!c) throw new NotFoundException('Ata não encontrada.');
    return {
      ref: refDaAta('colada', c.id),
      fonte: granolaIdDa(c.sourceRef) ? 'granola' : 'colada',
      granolaId: granolaIdDa(c.sourceRef),
      versao: c.versao,
      titulo: c.title,
      texto: c.body,
      caminho: null,
      procedencia: `memória: ${c.chave} · versão ${c.versao}${c.sourceRef ? ` · ${c.sourceRef}` : ''}`,
      atualizadaEm: c.atualizadoEm,
    };
  }

  private resumo(ata: AtaLida, contagens: Map<string, TrabAtaContagem>, decididas?: Map<string, TrabAtaDecidida[]>): TrabAtaResumo {
    const meta = metadadosDaAta(ata.texto, ata.caminho);
    return {
      id: ata.ref,
      fonte: ata.fonte,
      titulo: ata.titulo,
      data: meta.data,
      participantes: meta.participantes,
      resumo: meta.resumo,
      caminho: ata.caminho,
      sugestoes: contagens.get(ata.ref) ?? contagemVazia(),
      decididas: decididas?.get(ata.ref) ?? [],
      granolaId: ata.granolaId ?? null,
      atualizadaEm: ata.atualizadaEm.toISOString(),
    };
  }

  /** As decididas mais recentes de uma ata, a partir dos DTOs já resolvidos (nomes e tarefa). */
  private decididasDe(dtos: TrabAtaSugestaoDto[]): TrabAtaDecidida[] {
    return dtos
      .filter((d) => d.estado === 'aceita' || d.estado === 'descartada')
      .sort((a, b) => (b.decididaEm ?? '').localeCompare(a.decididaEm ?? ''))
      .slice(0, 6)
      .map((d) => ({
        id: d.id,
        titulo: d.titulo,
        estado: d.estado as 'aceita' | 'descartada',
        decididaPor: d.decididaPor,
        decididaEm: d.decididaEm,
        workTaskId: d.workTaskId,
      }));
  }

  /** As decididas de todas as atas da empresa, para a lista (até 6 por ata). */
  private async decididasPorAta(orgId: string): Promise<Map<string, TrabAtaDecidida[]>> {
    const linhas = await this.prisma.ataSugestao.findMany({
      where: { orgId, estado: { in: ['aceita', 'descartada'] } },
      orderBy: { decididaEm: 'desc' },
      take: 1000,
    });
    const porAta = new Map<string, LinhaDaSugestao[]>();
    for (const l of linhas) {
      const lista = porAta.get(l.ataRef) ?? [];
      if (lista.length < 6) lista.push(l);
      porAta.set(l.ataRef, lista);
    }
    const dtos = await this.paraDtos(orgId, [...porAta.values()].flat());
    const mapa = new Map<string, TrabAtaDecidida[]>();
    for (const d of dtos) mapa.set(d.ataRef, [...(mapa.get(d.ataRef) ?? []), ...this.decididasDe([d])]);
    return mapa;
  }

  private contar(linhas: Array<{ estado: string }>): TrabAtaContagem {
    const c = contagemVazia();
    for (const l of linhas) {
      if (l.estado === 'rascunho') c.rascunho++;
      else if (l.estado === 'aceita') c.aceitas++;
      else if (l.estado === 'descartada') c.descartadas++;
    }
    return c;
  }

  private async contagens(orgId: string): Promise<Map<string, TrabAtaContagem>> {
    const grupos = await this.prisma.ataSugestao.groupBy({
      by: ['ataRef', 'estado'],
      where: { orgId },
      _count: { _all: true },
    });
    const mapa = new Map<string, TrabAtaContagem>();
    for (const g of grupos) {
      const c = mapa.get(g.ataRef) ?? contagemVazia();
      if (g.estado === 'rascunho') c.rascunho += g._count._all;
      else if (g.estado === 'aceita') c.aceitas += g._count._all;
      else if (g.estado === 'descartada') c.descartadas += g._count._all;
      mapa.set(g.ataRef, c);
    }
    return mapa;
  }

  async listasDaEmpresa(orgId: string): Promise<ListaParaAta[]> {
    const listas = await this.prisma.workList.findMany({
      where: { orgId },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, folder: { select: { name: true } } },
      take: 200,
    });
    return listas.map((l) => ({ id: l.id, nome: l.name, rotulo: l.folder ? `${l.folder.name} › ${l.name}` : l.name }));
  }

  async pessoasDaEmpresa(orgId: string): Promise<string[]> {
    const gente = await this.prisma.user.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: 'asc' },
      select: { name: true },
      take: 100,
    });
    return gente.map((g) => g.name).filter(Boolean);
  }

  private async resumoDaAtaParaTarefa(
    orgId: string,
    ref: string,
    acesso: AcessoAsAtas,
  ): Promise<{ titulo: string; data: string | null } | null> {
    try {
      const a = await this.exigirAta(orgId, ref, acesso);
      return { titulo: a.titulo, data: metadadosDaAta(a.texto, a.caminho).data };
    } catch {
      return null;
    }
  }

  private descricaoDaTarefa(s: LinhaDaSugestao, ata: { titulo: string; data: string | null } | null): string {
    const origem = ata ? `Da ata "${ata.titulo}"${ata.data ? ` (${ata.data})` : ''}:` : 'Da ata:';
    const trecho = s.trecho
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    return [origem, '', trecho, '', `Ata: /trabalho/atas?ata=${encodeURIComponent(s.ataRef)}`].join('\n');
  }

  async paraDtos(orgId: string, linhas: LinhaDaSugestao[]): Promise<TrabAtaSugestaoDto[]> {
    const ids = [...new Set(linhas.map((l) => l.listaId).filter((x): x is string => !!x))];
    const listas = ids.length
      ? await this.prisma.workList.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const nomes = new Map(listas.map((l) => [l.id, l.name]));
    // Quem decidiu aparece pelo nome, resolvido só entre as pessoas desta empresa.
    const quem = [...new Set(linhas.map((l) => l.decididaPor).filter((x): x is string => !!x))];
    const gente = quem.length
      ? await this.prisma.user.findMany({ where: { orgId, id: { in: quem } }, select: { id: true, name: true } })
      : [];
    const nomeDe = new Map(gente.map((g) => [g.id, g.name]));
    return linhas.map((l) => ({
      id: l.id,
      ataRef: l.ataRef,
      titulo: l.titulo,
      listaId: l.listaId,
      listaNome: l.listaId ? (nomes.get(l.listaId) ?? null) : null,
      donoSugerido: l.donoSugerido,
      vencimento: l.vencimento ? l.vencimento.toISOString().slice(0, 10) : null,
      trecho: l.trecho,
      estado: l.estado as TrabAtaSugestaoEstado,
      workTaskId: l.workTaskId,
      criadaEm: l.criadaEm.toISOString(),
      decididaEm: l.decididaEm ? l.decididaEm.toISOString() : null,
      decididaPor: l.decididaPor ? (nomeDe.get(l.decididaPor) ?? 'outra pessoa') : null,
    }));
  }
}
