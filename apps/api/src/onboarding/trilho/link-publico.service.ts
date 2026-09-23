import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnboardingFase, type OnboardingItem, type OnboardingTrilho } from '@prisma/client';

import { comTenantPublico, resolverTenantDoConvite } from '../../common/tenant-publico';
import { TranscricaoIndisponivelError, TranscricaoService } from '../../llm/transcricao.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { aceitaEscrita, estadoDoConvite, hashDoToken, tokenBemFormado, type EstadoDoConvite } from './convite';
import {
  ROTULO_DO_BLOCO,
  ehNivel,
  obrigatorios,
  temaDaEspinha,
  temasDoConvite,
  type BlocosDoConvite,
  type Nivel,
  type TemaDaEspinha,
} from './espinha';
import { itemRespondido, type Portoes } from './fases';
import { formatarData } from './mensagens';
import type { RetratoDoTrilho } from './retrato-do-trilho';
import { varrerSegredos } from './segredos';
import { TrilhoService, type Quem } from './trilho.service';

/* ==========================================================================
 * O LINK PÚBLICO — o que o cliente vê e faz, sem login
 * ==========================================================================
 *
 * Toda rota anônima passa por dois passos, como a bio pública: (1) resolver a
 * empresa pelo hash do token, sob a sentinela; (2) o resto dentro de
 * `comTenantPublico`, já na empresa da ROOT. Token inexistente, expirado e
 * revogado respondem IGUAL (404 sem detalhe): distinguir contaria a quem
 * sondasse que um convite existiu.
 *
 * O QUE O CLIENTE PODE FAZER: confirmar ou corrigir uma proposta APROVADA;
 * responder um tema em branco por texto ou áudio; concluir. O que ele NÃO vê:
 * proposta ainda não aprovada, proposta descartada, o trecho da ata inteiro
 * (só o minuto e a etiqueta "da reunião de…"). Nenhuma chamada de modelo no
 * caminho de entrada — só a transcrição do áudio, que é o cliente pedindo.
 */

export interface Resolvido {
  orgId: string;
  trilhoId: string;
  conviteId: string;
  blocos: BlocosDoConvite;
  estado: EstadoDoConvite;
  validoAte: Date;
}

export interface ItemDoLink {
  temaId: string;
  bloco: string;
  blocoRotulo: string;
  titulo: string;
  pergunta: string;
  aprofundar: string;
  obrigatorio: boolean;
  formato: 'texto' | 'escolha';
  opcoes: string[] | null;
  /** `confirmar` (há proposta aprovada), `responder` (em branco), `feito`. */
  modo: 'confirmar' | 'responder' | 'feito';
  proposta: string | null;
  /** "Da reunião de 30/09 · 04:12", "Anotado pela Root" — nunca o trecho inteiro. */
  fonte: string | null;
  interpretado: boolean;
  status: string;
  textoFinal: string | null;
  respondidoVia: string | null;
}

export interface EstadoDoLink {
  cliente: string;
  contatoNome: string | null;
  blocos: BlocosDoConvite;
  estado: EstadoDoConvite;
  validoAte: string;
  concluido: boolean;
  kickoffEm: string | null;
  itens: ItemDoLink[];
  progresso: {
    confirmados: number;
    respondidos: number;
    total: number;
    obrigatoriosFaltando: string[];
  };
}

const NAO_ENCONTRADO = 'link não encontrado.';

@Injectable()
export class LinkPublicoService {
  private readonly log = new Logger('OnboardingLink');

  constructor(
    private readonly prisma: PrismaService,
    private readonly trilhos: TrilhoService,
    private readonly transcricao: TranscricaoService,
  ) {}

  // ==========================================================================
  // 1. Resolver
  // ==========================================================================

  async resolver(token: string): Promise<Resolvido> {
    if (!tokenBemFormado(token)) throw new NotFoundException(NAO_ENCONTRADO);
    const c = await resolverTenantDoConvite(this.prisma, hashDoToken(token));
    if (!c) throw new NotFoundException(NAO_ENCONTRADO);
    const estado = estadoDoConvite(c);
    if (estado === 'revogado' || estado === 'expirado') throw new NotFoundException(NAO_ENCONTRADO);
    return {
      orgId: c.orgId,
      trilhoId: c.trilhoId,
      conviteId: c.conviteId,
      blocos: c.blocos === 'A' ? 'A' : 'BCD',
      estado,
      validoAte: c.validoAte,
    };
  }

  // ==========================================================================
  // 2. O estado — o que a tela mostra
  // ==========================================================================

  async estado(token: string): Promise<EstadoDoLink> {
    const r = await this.resolver(token);
    return comTenantPublico(r.orgId, async () => {
      const t = await this.trilhoDoConvite(r);
      // Conta o acesso sem segurar a resposta. Falha aqui não é falha da tela.
      this.prisma.onboardingConvite
        .update({ where: { id: r.conviteId }, data: { acessos: { increment: 1 }, ultimoAcessoEm: new Date() } })
        .catch(() => undefined);
      return this.montarEstado(t, r);
    });
  }

  private montarEstado(t: OnboardingTrilho & { itens: OnboardingItem[] }, r: Resolvido): EstadoDoLink {
    const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
    const temas = temasDoConvite(r.blocos, nivel);
    const porTema = new Map(t.itens.map((i) => [i.temaId, i]));
    const itens = temas.map((tema) => this.itemDoLink(tema, porTema.get(tema.id) ?? null, t));
    const obrig = obrigatorios(r.blocos, nivel);
    return {
      cliente: t.cliente,
      contatoNome: t.contatoNome,
      blocos: r.blocos,
      estado: r.estado,
      validoAte: r.validoAte.toISOString(),
      concluido: r.estado === 'concluido',
      kickoffEm: t.kickoffEm ? t.kickoffEm.toISOString() : null,
      itens,
      progresso: {
        confirmados: itens.filter((i) => i.status === 'confirmado' || i.status === 'corrigido').length,
        respondidos: itens.filter((i) => i.status === 'respondido').length,
        total: itens.length,
        obrigatoriosFaltando: obrig
          .filter((tema) => !itemRespondido(porTema.get(tema.id)?.status ?? 'em-branco'))
          .map((tema) => tema.titulo),
      },
    };
  }

  private itemDoLink(tema: TemaDaEspinha, i: OnboardingItem | null, t: OnboardingTrilho): ItemDoLink {
    const status = i?.status ?? 'em-branco';
    const feito = itemRespondido(status);
    const aprovado = status === 'aprovado' && !!i?.proposta;
    let fonte: string | null = null;
    if (i && (aprovado || feito)) {
      if (i.origem === 'ata') {
        fonte = `Da reunião${t.kickoffEm ? ` de ${formatarData(t.kickoffEm)}` : ''}${i.fonteMinuto ? ` · ${i.fonteMinuto}` : ''}`;
        if (i.tipo === 'interpretado') fonte += ' · aprovado pela Root';
      } else if (i.origem === 'root') {
        fonte = 'Anotado pela Root';
      } else if (i.origem === 'triagem') {
        fonte = 'Da sua triagem';
      }
    }
    return {
      temaId: tema.id,
      bloco: tema.bloco,
      blocoRotulo: ROTULO_DO_BLOCO[tema.bloco],
      titulo: tema.titulo,
      pergunta: tema.pergunta,
      aprofundar: tema.aprofundar,
      obrigatorio: tema.obrigatorio,
      formato: tema.formato,
      opcoes: tema.opcoes ? [...tema.opcoes] : null,
      modo: feito ? 'feito' : aprovado ? 'confirmar' : 'responder',
      proposta: aprovado ? i!.proposta : null,
      fonte,
      interpretado: i?.tipo === 'interpretado',
      status,
      textoFinal: feito ? i!.textoFinal : null,
      respondidoVia: feito ? i!.respondidoVia : null,
    };
  }

  // ==========================================================================
  // 3. As escritas do cliente
  // ==========================================================================

  async confirmar(token: string, temaId: string, nome: string | null): Promise<EstadoDoLink> {
    return this.escrever(token, temaId, nome, async (t, item, quem) => {
      if (!item || item.status !== 'aprovado' || !item.proposta) {
        throw new ConflictException('não há proposta para confirmar neste tema — responda em vez de confirmar.');
      }
      await this.prisma.onboardingItem.update({
        where: { id: item.id },
        data: {
          status: 'confirmado',
          textoFinal: item.proposta,
          respondidoPor: quem.nome,
          respondidoEm: new Date(),
          respondidoVia: 'texto',
        },
      });
    });
  }

  async corrigir(token: string, temaId: string, textoBruto: string, nome: string | null): Promise<EstadoDoLink> {
    return this.escrever(token, temaId, nome, async (t, item, quem) => {
      if (!item || item.status !== 'aprovado' || !item.proposta) {
        throw new ConflictException('não há proposta para corrigir neste tema — responda em vez de corrigir.');
      }
      const limpo = varrerSegredos(String(textoBruto ?? '').trim()).texto;
      if (!limpo) throw new BadRequestException('a correção veio vazia.');
      await this.prisma.onboardingItem.update({
        where: { id: item.id },
        data: {
          status: 'corrigido',
          textoFinal: limpo,
          respondidoPor: quem.nome,
          respondidoEm: new Date(),
          respondidoVia: 'texto',
        },
      });
    });
  }

  async responder(
    token: string,
    temaId: string,
    textoBruto: string,
    nome: string | null,
    via: 'texto' | 'audio' = 'texto',
  ): Promise<EstadoDoLink> {
    return this.escrever(token, temaId, nome, async (t, item, quem, tema) => {
      const limpo = varrerSegredos(String(textoBruto ?? '').trim()).texto;
      if (!limpo) throw new BadRequestException('a resposta veio vazia.');
      if (tema.formato === 'escolha' && tema.opcoes && !tema.opcoes.includes(limpo)) {
        throw new BadRequestException(`escolha uma das opções: ${tema.opcoes.join(', ')}.`);
      }
      const dados = {
        status: 'respondido',
        textoFinal: limpo,
        respondidoPor: quem.nome,
        respondidoEm: new Date(),
        respondidoVia: via,
      };
      if (item) {
        await this.prisma.onboardingItem.update({ where: { id: item.id }, data: dados });
      } else {
        await this.prisma.onboardingItem.create({
          data: {
            orgId: t.orgId,
            trilhoId: t.id,
            temaId,
            bloco: tema.bloco,
            origem: 'cliente',
            tipo: 'em-branco',
            ...dados,
          },
        });
      }
    });
  }

  /** O áudio vira texto e a resposta entra como `respondido por áudio`. */
  async responderPorAudio(
    token: string,
    temaId: string,
    audio: Buffer,
    mimetype: string,
    nome: string | null,
  ): Promise<{ texto: string; estado: EstadoDoLink }> {
    const r = await this.resolver(token);
    if (r.estado !== 'ativo') throw new ConflictException('este link já foi concluído.');
    let texto: string;
    try {
      texto = (await this.transcricao.transcrever({ orgId: r.orgId, audio, mimetype })).texto;
    } catch (e) {
      if (e instanceof TranscricaoIndisponivelError) throw new BadRequestException(e.message);
      throw e;
    }
    const estado = await this.responder(token, temaId, texto, nome, 'audio');
    return { texto: varrerSegredos(texto).texto, estado };
  }

  private async escrever(
    token: string,
    temaId: string,
    nome: string | null,
    acao: (
      t: OnboardingTrilho & { itens: OnboardingItem[] },
      item: OnboardingItem | null,
      quem: Quem,
      tema: TemaDaEspinha,
    ) => Promise<void>,
  ): Promise<EstadoDoLink> {
    const r = await this.resolver(token);
    return comTenantPublico(r.orgId, async () => {
      const convite = await this.prisma.onboardingConvite.findUnique({ where: { id: r.conviteId } });
      if (!convite || !aceitaEscrita(convite)) throw new ConflictException('este link já foi concluído ou não aceita mais respostas.');
      const t = await this.trilhoDoConvite(r);
      const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
      const tema = temasDoConvite(r.blocos, nivel).find((x) => x.id === temaId);
      if (!tema) throw new BadRequestException('este tema não faz parte deste link.');
      const item = t.itens.find((i) => i.temaId === temaId) ?? null;
      const quem: Quem = { id: null, nome: (nome ?? '').trim() || t.contatoNome || 'cliente' };
      await acao(t, item, quem, tema);
      const depois = await this.trilhoDoConvite(r);
      return this.montarEstado(depois, r);
    });
  }

  // ==========================================================================
  // 4. Concluir — o retrato
  // ==========================================================================

  async concluir(token: string, nome: string | null): Promise<{ retrato: RetratoDoTrilho | null; mensagem: string }> {
    const r = await this.resolver(token);
    return comTenantPublico(r.orgId, async () => {
      const convite = await this.prisma.onboardingConvite.findUnique({ where: { id: r.conviteId } });
      if (!convite) throw new NotFoundException(NAO_ENCONTRADO);
      const t = await this.trilhoDoConvite(r);
      const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
      const porTema = new Map(t.itens.map((i) => [i.temaId, i]));
      const faltando = obrigatorios(r.blocos, nivel)
        .filter((tema) => !itemRespondido(porTema.get(tema.id)?.status ?? 'em-branco'))
        .map((tema) => tema.titulo);
      if (faltando.length) {
        throw new ConflictException({ message: 'ainda faltam respostas obrigatórias.', faltando });
      }
      const quem: Quem = { id: null, nome: (nome ?? '').trim() || t.contatoNome || 'cliente' };

      if (!convite.concluidoEm) {
        await this.prisma.onboardingConvite.update({ where: { id: convite.id }, data: { concluidoEm: new Date() } });
        if (r.blocos === 'A') {
          const portoes = { ...((t.portoes ?? {}) as Portoes), triagemRespondidaEm: new Date().toISOString() };
          await this.prisma.onboardingTrilho.update({ where: { id: t.id }, data: { portoes } });
          // As respostas da triagem viram "o que a triagem já disse" no roteiro.
          await this.prisma.onboardingItem.updateMany({
            where: { trilhoId: t.id, bloco: 'A', status: 'respondido', origem: 'cliente' },
            data: { origem: 'triagem' },
          });
        }
        await this.trilhos.marco(
          r.orgId,
          t.id,
          'convite.concluido',
          `${quem.nome} concluiu o link (${r.blocos}).`,
          { conviteId: convite.id, blocos: r.blocos },
          quem,
        );
      }

      if (r.blocos === 'A') {
        return {
          retrato: null,
          mensagem: 'Obrigado. Com isso a gente chega na reunião falando da sua empresa, e não de IA em geral.',
        };
      }

      const atualizado = await this.trilhoDoConvite(r);
      const retrato = this.trilhos.retratoDe(atualizado, atualizado.itens);
      if (atualizado.empresaId) {
        try {
          await this.trilhos.carregarMemoria(r.orgId, t.id, quem);
        } catch (e) {
          this.log.warn(`trilho ${t.id}: o retrato saiu, mas a memória do cliente não foi carregada (${(e as Error).message})`);
        }
      }
      return { retrato, mensagem: 'Pronto. Isto é o que o OS entendeu — com a origem de cada parte.' };
    });
  }

  async retrato(token: string): Promise<RetratoDoTrilho> {
    const r = await this.resolver(token);
    if (r.blocos !== 'BCD') throw new NotFoundException(NAO_ENCONTRADO);
    return comTenantPublico(r.orgId, async () => {
      const t = await this.trilhoDoConvite(r);
      return this.trilhos.retratoDe(t, t.itens);
    });
  }

  private async trilhoDoConvite(r: Resolvido): Promise<OnboardingTrilho & { itens: OnboardingItem[] }> {
    const t = await this.prisma.onboardingTrilho.findFirst({ where: { id: r.trilhoId, orgId: r.orgId }, include: { itens: true } });
    if (!t || t.fase === OnboardingFase.encerrado) throw new NotFoundException(NAO_ENCONTRADO);
    return t;
  }
}

export function ehBlocoDoConvite(v: unknown): v is BlocosDoConvite {
  return v === 'A' || v === 'BCD';
}

export { temaDaEspinha };
