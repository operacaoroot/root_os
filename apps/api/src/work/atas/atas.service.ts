import {
  BadRequestException,
  ConflictException,
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
  type TrabAtaDetalhe,
  type TrabAtaFonte,
  type TrabAtaGeracao,
  type TrabAtaLista,
  type TrabAtaResumo,
  type TrabAtaSugestaoDto,
  type TrabAtaSugestaoEstado,
} from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { MemoriaService } from '../../memory/memoria.service';
import { normalizarParaBusca } from '../../onboarding/trilho/leitor-de-ata';
import { varrerSegredos } from '../../onboarding/trilho/segredos';
import { umaPorVez } from '../../pauta/uma-por-vez';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkService } from '../work.service';
import {
  SugestoesIlegiveisError,
  interpretarSugestoes,
  metadadosDaAta,
  promptDasSugestoes,
  slugDaAta,
  type ListaParaAta,
} from './leitor-de-atas';

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
 */

/** Teto de atas do vault lidas por listagem. A tela pagina pelo mais novo. */
const MAX_DO_VAULT = 200;
const MAX_COLADAS = 200;
const SAIDA_DA_LEITURA = 4000;

export interface QuemDecide {
  id: string;
}

type LinhaDaSugestao = Prisma.AtaSugestaoGetPayload<Record<string, never>>;

interface AtaLida {
  ref: string;
  fonte: TrabAtaFonte;
  titulo: string;
  texto: string;
  caminho: string | null;
  procedencia: string;
  atualizadaEm: Date;
}

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
    const nota = await this.memoria.porChave(orgId, ATA_CHAVE_DA_PASTA).catch(() => null);
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

  async listar(orgId: string): Promise<TrabAtaLista> {
    const pasta = await this.pasta(orgId);
    const [doVault, coladas, notasDoVault, contagens] = await Promise.all([
      this.prisma.knowledgeNote.findMany({
        where: { orgId, ...this.filtroDaPasta(pasta) },
        orderBy: { fileTime: 'desc' },
        take: MAX_DO_VAULT,
        select: { id: true, path: true, title: true, content: true, fileTime: true },
      }),
      this.prisma.contextItem.findMany({
        where: { orgId, chave: { startsWith: ATA_PREFIXO_DA_CHAVE }, arquivadoEm: null },
        orderBy: { atualizadoEm: 'desc' },
        take: MAX_COLADAS,
        select: { id: true, title: true, body: true, atualizadoEm: true },
      }),
      this.prisma.knowledgeNote.count({ where: { orgId } }),
      this.contagens(orgId),
    ]);

    const atas: TrabAtaResumo[] = [
      ...doVault.map((n) =>
        this.resumo(
          { ref: refDaAta('vault', n.id), fonte: 'vault', titulo: n.title, texto: n.content, caminho: n.path, procedencia: '', atualizadaEm: n.fileTime },
          contagens,
        ),
      ),
      ...coladas.map((c) =>
        this.resumo(
          { ref: refDaAta('colada', c.id), fonte: 'colada', titulo: c.title, texto: c.body, caminho: null, procedencia: '', atualizadaEm: c.atualizadoEm },
          contagens,
        ),
      ),
    ];
    // A mais nova primeiro: pela data da reunião, e sem ela pela do arquivo.
    atas.sort((a, b) => (b.data ?? b.atualizadaEm.slice(0, 10)).localeCompare(a.data ?? a.atualizadaEm.slice(0, 10)) || b.atualizadaEm.localeCompare(a.atualizadaEm));
    return { atas, pasta, notasDoVault, iaConfigurada: this.llm.configured };
  }

  async ler(orgId: string, ref: string): Promise<TrabAtaDetalhe> {
    const ata = await this.exigirAta(orgId, ref);
    const linhas = await this.prisma.ataSugestao.findMany({
      where: { orgId, ataRef: ata.ref },
      orderBy: { criadaEm: 'asc' },
    });
    const dtos = await this.paraDtos(orgId, linhas);
    const contagens = new Map<string, TrabAtaContagem>([[ata.ref, this.contar(linhas)]]);
    return { ...this.resumo(ata, contagens), texto: ata.texto, procedencia: ata.procedencia, sugestoesDaAta: dtos };
  }

  async sugestoes(orgId: string, filtro: { ata?: string; estado?: string } = {}): Promise<TrabAtaSugestaoDto[]> {
    const estado = filtro.estado && ['rascunho', 'aceita', 'descartada'].includes(filtro.estado) ? filtro.estado : undefined;
    const linhas = await this.prisma.ataSugestao.findMany({
      where: { orgId, ...(filtro.ata ? { ataRef: filtro.ata } : {}), ...(estado ? { estado } : {}) },
      orderBy: { criadaEm: 'desc' },
      take: 500,
    });
    return this.paraDtos(orgId, linhas);
  }

  // ==========================================================================
  // COLAR — a ata avulsa vira nota da memória (ADR-011)
  // ==========================================================================

  async colar(orgId: string, actorId: string, input: TrabAtaColarInput): Promise<TrabAtaDetalhe> {
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
    return this.ler(orgId, refDaAta('colada', nota.id));
  }

  // ==========================================================================
  // GERAR — o leitor propõe, o parser confere
  // ==========================================================================

  gerar(orgId: string, actorId: string, ref: string): Promise<TrabAtaGeracao> {
    return umaPorVez(`trabalho-atas:${orgId}:${ref}`, 'A leitura desta ata', () => this.gerarAgora(orgId, actorId, ref));
  }

  private async gerarAgora(orgId: string, actorId: string, ref: string): Promise<TrabAtaGeracao> {
    const ata = await this.exigirAta(orgId, ref);
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
      leitura = interpretarSugestoes(saida, { ata: ata.texto, listas, pessoas });
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
                titulo: s.titulo,
                listaId: s.listaId,
                donoSugerido: s.donoSugerido,
                vencimento: s.vencimento ? new Date(`${s.vencimento}T12:00:00.000Z`) : null,
                trecho: s.trecho,
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
        descartadasPeloParser: leitura.avisos.filter((a) => a.includes('descartada')).length,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });
    return { criadas: await this.paraDtos(orgId, criadas), repetidas, avisos };
  }

  // ==========================================================================
  // DECIDIR — aceitar cria a tarefa pelo Trabalho; descartar fica registrado
  // ==========================================================================

  async aceitar(orgId: string, actorId: string, id: string, input: TrabAtaAceitarInput): Promise<TrabAtaSugestaoDto> {
    const s = await this.prisma.ataSugestao.findFirst({ where: { id, orgId } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    if (s.estado !== 'rascunho') throw this.jaDecidida(s.estado);
    const listId = input.listaId ?? s.listaId;
    if (!listId) throw new BadRequestException('Escolha a lista da tarefa antes de aceitar.');
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

    const ata = await this.resumoDaAtaParaTarefa(orgId, s.ataRef);
    let tarefaId: string;
    try {
      const tarefa = await this.work.criarTarefa(orgId, actorId, {
        listId,
        title: s.titulo,
        description: this.descricaoDaTarefa(s, ata),
        assignee: s.donoSugerido ?? null,
        dueDate: s.vencimento ? s.vencimento.toISOString() : null,
      });
      tarefaId = tarefa.id;
    } catch (e) {
      // A tarefa não nasceu: a sugestão volta a rascunho, para a pessoa tentar de novo.
      await this.prisma.ataSugestao.updateMany({
        where: { id, orgId, estado: 'aceita', workTaskId: null },
        data: { estado: 'rascunho', decididaPor: null, decididaEm: null },
      });
      throw e;
    }

    const final = await this.prisma.ataSugestao.update({ where: { id }, data: { workTaskId: tarefaId } });
    await this.audit.log({
      orgId,
      actorId,
      action: 'trabalho.ata.sugestao_aceita',
      entityType: 'ata_sugestao',
      entityId: id,
      after: { ataRef: s.ataRef, workTaskId: tarefaId, listaId: listId },
    });
    return (await this.paraDtos(orgId, [final]))[0];
  }

  async descartar(orgId: string, actorId: string, id: string): Promise<TrabAtaSugestaoDto> {
    const s = await this.prisma.ataSugestao.findFirst({ where: { id, orgId } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
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

  private jaDecidida(estado: string): ConflictException {
    return new ConflictException(
      estado === 'descartada' ? 'Esta sugestão já foi descartada.' : 'Esta sugestão já foi aceita: a tarefa já existe.',
    );
  }

  private async exigirAta(orgId: string, ref: string): Promise<AtaLida> {
    const lida = lerRefDaAta(ref);
    if (!lida) throw new NotFoundException('Ata não encontrada.');
    if (lida.fonte === 'vault') {
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
        texto: n.content,
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
      fonte: 'colada',
      titulo: c.title,
      texto: c.body,
      caminho: null,
      procedencia: `memória: ${c.chave} · versão ${c.versao}${c.sourceRef ? ` · ${c.sourceRef}` : ''}`,
      atualizadaEm: c.atualizadoEm,
    };
  }

  private resumo(ata: AtaLida, contagens: Map<string, TrabAtaContagem>): TrabAtaResumo {
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
      atualizadaEm: ata.atualizadaEm.toISOString(),
    };
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

  private async listasDaEmpresa(orgId: string): Promise<ListaParaAta[]> {
    const listas = await this.prisma.workList.findMany({
      where: { orgId },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, folder: { select: { name: true } } },
      take: 200,
    });
    return listas.map((l) => ({ id: l.id, nome: l.name, rotulo: l.folder ? `${l.folder.name} › ${l.name}` : l.name }));
  }

  private async pessoasDaEmpresa(orgId: string): Promise<string[]> {
    const gente = await this.prisma.user.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: 'asc' },
      select: { name: true },
      take: 100,
    });
    return gente.map((g) => g.name).filter(Boolean);
  }

  private async resumoDaAtaParaTarefa(orgId: string, ref: string): Promise<{ titulo: string; data: string | null } | null> {
    try {
      const a = await this.exigirAta(orgId, ref);
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

  private async paraDtos(orgId: string, linhas: LinhaDaSugestao[]): Promise<TrabAtaSugestaoDto[]> {
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
