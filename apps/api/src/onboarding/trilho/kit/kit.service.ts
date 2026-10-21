import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ETAPA_DO_KIT, MARCO_DO_KIT, type EstadoDaCopiaDoKit, type KitEPastaDoCard, type KitNaTela } from '@mktos/shared';

import { ARQUIVISTA_DO_CLIENTE, type ArquivistaDoClientePort } from '../../../clientes/portas';
import { comContexto, contextoAtual, novaCorrelacao } from '../../../common/contexto-execucao';
import { LLM_PROVIDER, type LlmProvider } from '../../../llm/llm.provider';
import { umaPorVez } from '../../../pauta/uma-por-vez';
import { PrismaService } from '../../../prisma/prisma.service';
import { temaDaEspinha } from '../espinha';
import { varrerSegredos } from '../segredos';
import { notasDaConversaDe } from '../teia-do-cliente';
import { TrilhoService, type Quem } from '../trilho.service';
import {
  KitIlegivelError,
  indiceDoKitEmMarkdown,
  interpretarKit,
  kitEmMarkdown,
  nomeDoArquivoDoKit,
  nomeDoIndiceDoKit,
  promptDoKit,
  type NotaParaOKit,
} from './kit';

/** No máximo tantas notas do cliente no pedido, e tantos caracteres de cada. */
const MAX_NOTAS = 20;
const CORPO_MAX = 1200;

/**
 * IM-07 · O MONTADOR DO KIT (rodada dos agentes, 21/10/2026). Ver `kit.ts`.
 *
 * Monta pelo botão "Montar kit" do card da Implantação (gente clica; a rotina
 * não monta sozinha). O kit fica no OS como marco do trilho (`kit.montado`, com
 * o markdown nos dados) e vai a `03-kickoff` da pasta do cliente pelo arquivista
 * (`drive.arquivo.enviar`, R3, pela porta dele): o kit e o índice. Drive fora ou
 * cliente sem pasta não derruba nada: o kit fica no OS e o card diz o estado da
 * cópia.
 */
@Injectable()
export class KitDoTrilhoService {
  private readonly log = new Logger('KitDoTrilho');

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly prisma: PrismaService,
    private readonly trilhos: TrilhoService,
    @Optional() @Inject(ARQUIVISTA_DO_CLIENTE) private readonly arquivista?: ArquivistaDoClientePort,
  ) {}

  /** O que o card lê: a etapa, o kit (se há) e a pasta do cliente. */
  async doCard(orgId: string, trilhoId: string): Promise<KitEPastaDoCard> {
    const t = await this.trilhos.exigirTrilho(orgId, trilhoId);
    const [etapa, marco, partnerId] = await Promise.all([
      t.cardId
        ? this.prisma.workTask.findFirst({ where: { id: t.cardId, orgId }, select: { status: { select: { name: true } } } })
        : Promise.resolve(null),
      this.prisma.onboardingMarco.findFirst({ where: { orgId, trilhoId, tipo: MARCO_DO_KIT }, orderBy: { em: 'desc' } }),
      this.trilhos.clienteDoTrilho(orgId, t),
    ]);
    const partner = partnerId
      ? await this.prisma.partner.findFirst({ where: { id: partnerId, orgId }, select: { id: true, pastaDriveUrl: true, pastaDriveErro: true } })
      : null;
    const etapaDoCard = etapa?.status?.name ?? null;
    const kit = marco ? kitDoMarco(marco) : null;
    return {
      etapaDoCard,
      kit,
      avisoSemKit: !kit && !!etapaDoCard && mesmaEtapa(etapaDoCard, ETAPA_DO_KIT),
      cliente: partner ? { partnerId: partner.id, pastaUrl: partner.pastaDriveUrl ?? null, pastaErro: partner.pastaDriveErro ?? null } : null,
    };
  }

  async montar(orgId: string, trilhoId: string, quem: Quem): Promise<KitNaTela> {
    return umaPorVez(`onboarding-kit:${orgId}:${trilhoId}`, 'A montagem deste kit', () => this.montarAgora(orgId, trilhoId, quem));
  }

  private async montarAgora(orgId: string, trilhoId: string, quem: Quem): Promise<KitNaTela> {
    const t = await this.trilhos.exigirTrilho(orgId, trilhoId, true);
    const manifesto = varrerSegredos(t.observacoes ?? '').texto;
    const notas = await this.contextoDoCliente(orgId, t);
    if (!manifesto.trim() && !notas.length) {
      throw new BadRequestException(
        'Não há o que montar: o trilho não tem manifesto (o cliente não veio do fechamento) nem contexto carregado. Leia a ata do kickoff ou responda o formulário antes.',
      );
    }
    const { system, user } = promptDoKit({ cliente: t.cliente, manifesto, notas });
    const saida = await this.llm.step({
      funcao: 'IM-07',
      system,
      turns: [{ role: 'user', text: user }],
      orgId,
      maxTokens: 8000,
    });
    let kit;
    try {
      kit = interpretarKit(saida.text, [manifesto, t.cliente, ...notas.flatMap((n) => [n.titulo, n.corpo])]);
    } catch (e) {
      if (e instanceof KitIlegivelError) throw new BadRequestException(e.message);
      throw e;
    }
    const montadoEm = new Date().toISOString();
    const arquivo = nomeDoArquivoDoKit(t.cliente);
    const md = kitEmMarkdown({ cliente: t.cliente, manifesto, kit, montadoEm });
    const ataLida = await this.prisma.onboardingMarco.findFirst({ where: { orgId, trilhoId, tipo: 'ata.lida' }, select: { id: true } });
    const indice = indiceDoKitEmMarkdown({ cliente: t.cliente, kit, montadoEm, ataDoKickoff: ataLida ? `ata-kickoff-${t.slug}.md` : null });
    const copia = await this.copiarParaOCliente(orgId, t, arquivo, md, indice, quem);

    await this.trilhos.marco(
      orgId,
      trilhoId,
      MARCO_DO_KIT,
      `Kit montado: ${kit.secoes.length} seção(ões), ${kit.secoes.reduce((n, s) => n + s.itens.length, 0)} item(ns)` +
        (kit.avisos.length ? `, ${kit.avisos.length} aviso(s)` : '') +
        `; cópia em 03-kickoff: ${copia.estado}.`,
      {
        arquivo,
        kit: md,
        indice,
        secoes: kit.secoes.map((s) => ({ titulo: s.titulo, itens: s.itens.length })),
        avisos: kit.avisos,
        copia,
        custoUsd: saida.usage.custoUsd,
        modelo: saida.usage.modeloServido,
      },
      quem,
    );
    return {
      montadoEm,
      montadoPor: quem.nome,
      arquivo,
      secoes: kit.secoes.map((s) => ({ titulo: s.titulo, itens: s.itens.length })),
      avisos: kit.avisos,
      copia,
    };
  }

  /**
   * O contexto do cliente: as notas da memória DELE (quando a empresa dele existe
   * no OS), lidas no contexto daquela empresa, como `carregarMemoria` escreve;
   * sem empresa, as respostas do trilho e as notas da conversa (o mesmo conteúdo,
   * ainda do lado da Root). Tudo passa pela varredura de segredos.
   */
  private async contextoDoCliente(
    orgId: string,
    t: Awaited<ReturnType<TrilhoService['exigirTrilho']>>,
  ): Promise<NotaParaOKit[]> {
    const limpar = (n: NotaParaOKit): NotaParaOKit => ({
      titulo: varrerSegredos(n.titulo).texto.slice(0, 200),
      corpo: varrerSegredos(Array.from(n.corpo).slice(0, CORPO_MAX).join('')).texto,
    });
    if (t.empresaId) {
      const empresaId = t.empresaId;
      try {
        const notas = await comContexto(
          {
            orgId: empresaId,
            actorType: 'system',
            actorId: null,
            correlationId: contextoAtual()?.correlationId ?? novaCorrelacao('onboarding'),
            origem: contextoAtual()?.origem ?? 'http',
          },
          () =>
            this.prisma.contextItem.findMany({
              where: { orgId: empresaId, arquivadoEm: null, acessoRestrito: false, chave: { startsWith: 'onboarding:' } },
              orderBy: { atualizadoEm: 'desc' },
              take: MAX_NOTAS,
              select: { title: true, body: true },
            }),
        );
        if (notas.length) return notas.map((n) => limpar({ titulo: n.title, corpo: n.body }));
      } catch (e) {
        this.log.warn(`trilho ${t.id}: a memória do cliente não foi lida (${(e as Error).message}); vale o que o trilho tem`);
      }
    }
    const doTrilho: NotaParaOKit[] = [];
    for (const i of t.itens) {
      const corpo = (i.textoFinal ?? (i.status === 'aprovado' ? i.proposta : null) ?? '').trim();
      if (!corpo) continue;
      doTrilho.push({ titulo: temaDaEspinha(i.temaId)?.titulo ?? i.temaId, corpo });
    }
    const marco = await this.prisma.onboardingMarco.findFirst({ where: { orgId, trilhoId: t.id, tipo: 'ata.notas' }, orderBy: { em: 'desc' } });
    for (const n of marco ? notasDaConversaDe(marco.dados) : []) doTrilho.push({ titulo: n.titulo, corpo: n.corpo });
    return doTrilho.slice(0, MAX_NOTAS).map(limpar);
  }

  private async copiarParaOCliente(
    orgId: string,
    t: { id: string; cliente: string; cardId: string | null },
    arquivo: string,
    md: string,
    indice: string,
    quem: Quem,
  ): Promise<{ estado: EstadoDaCopiaDoKit; motivo: string | null }> {
    if (!this.arquivista) return { estado: 'so_no_os', motivo: 'o arquivista não está montado neste processo' };
    try {
      const partnerId = await this.trilhos.clienteDoTrilho(orgId, t);
      if (!partnerId) return { estado: 'sem_cliente', motivo: 'o trilho não tem cliente ligado (ficha ou card)' };
      const agora = new Date();
      const enviar = (nome: string, conteudo: string, tipo: string, titulo: string) =>
        this.arquivista!.arquivar({
          orgId,
          partnerId,
          origem: 'kit',
          nomeOriginal: nome,
          tipoMime: 'text/markdown',
          conteudo: { buffer: Buffer.from(conteudo, 'utf8') },
          subpasta: '03-kickoff',
          tipo,
          titulo,
          data: agora,
          texto: conteudo.slice(0, 8000),
          atorId: quem.id,
        });
      const r = await enviar(arquivo, md, 'kit', `Kit de implantação ${t.cliente}`);
      // O índice vai junto; o estado que o card mostra é o do kit.
      await enviar(nomeDoIndiceDoKit(t.cliente), indice, 'indice', `Índice do kit ${t.cliente}`).catch(() => undefined);
      return { estado: r.estado, motivo: 'motivo' in r ? r.motivo : null };
    } catch (e) {
      this.log.warn(`trilho ${t.id}: o kit não foi para a pasta do cliente (${(e as Error).message})`);
      return { estado: 'erro', motivo: (e as Error).message.slice(0, 300) };
    }
  }
}

function mesmaEtapa(a: string, b: string): boolean {
  const n = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
}

/** O kit como o card mostra, lido de volta do marco (a cópia do OS). */
export function kitDoMarco(m: { em: Date; quem: string | null; dados: unknown }): KitNaTela {
  const d = (m.dados ?? {}) as Record<string, unknown>;
  const secoes = Array.isArray(d.secoes)
    ? (d.secoes as Array<Record<string, unknown>>).map((s) => ({ titulo: String(s?.titulo ?? ''), itens: Number(s?.itens ?? 0) || 0 }))
    : [];
  const copia = (d.copia ?? {}) as { estado?: EstadoDaCopiaDoKit; motivo?: string | null };
  return {
    montadoEm: m.em.toISOString(),
    montadoPor: m.quem ?? null,
    arquivo: typeof d.arquivo === 'string' ? d.arquivo : 'kit.md',
    secoes,
    avisos: Array.isArray(d.avisos) ? (d.avisos as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    copia: { estado: copia.estado ?? 'so_no_os', motivo: copia.motivo ?? null },
  };
}
