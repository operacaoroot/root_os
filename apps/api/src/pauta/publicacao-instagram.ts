import {
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_JANELA_DA_PUBLICACAO_MS,
  PAUTA_LEGENDA_DO_INSTAGRAM_MAXIMO,
  PAUTA_SLIDES_MAXIMO,
  type PautaFormatoDaSemana,
  type PautaPecaStatus,
  type PautaPublicacaoDaPeca,
  type PautaPublicacaoEstado,
  type PautaRede,
} from '@mktos/shared';
import { ehPecaDaSemana, lerMetaDaSemana, tipoDaImagem } from './derivacao-do-episodio';
import { semLinksDeCaixaDeEntrada } from './link-publico';

/*
 * O PUBLICADOR DO INSTAGRAM (MD6) — a parte pura.
 *
 * O que vai no pedido (os argumentos que a aprovação assina), o que impede
 * pedir, o que cada `status_code` da Meta quer dizer para a máquina de estados
 * e o que a rotina faz com cada peça no horário. O serviço
 * (`publicacao-instagram.service.ts`) só lê o banco, chama a Graph e grava.
 */

/** Uma mídia do pedido: a chave no storage e o sha256 do arquivo. A ordem é a do post. */
export interface MidiaDoPedido {
  chave: string;
  sha256: string;
}

/** Os argumentos de `instagram.post.publicar`, como o catálogo os declara. */
export interface ArgsDaPublicacao {
  pecaId: string;
  formato: PautaFormatoDaSemana;
  legenda: string;
  midias: MidiaDoPedido[];
  igUserId: string;
  agendadaPara?: string;
}

/** A peça como o publicador a lê. */
export interface PecaParaPublicar {
  id: string;
  canal: string;
  formato: string;
  status: PautaPecaStatus;
  corpo: string;
  meta: unknown;
  agendadaPara: Date | null;
}

/** A conta de publicação da empresa (MD5), sem o token. */
export interface ContaParaPublicar {
  externalId: string;
  handle: string;
  escopos: string[];
  status: string;
}

/** O carrossel da Meta tem de 2 a 10 itens. */
export const CARROSSEL_MINIMO = 2;
/** Consulta do status do Reels: uma por minuto, por até 5 minutos (a Meta pede isso). */
export const INTERVALO_DO_STATUS_MS = 60_000;
export const ESPERA_MAXIMA_DO_PROCESSAMENTO_MS = 5 * 60_000;
/** Container não publicado vence em 24 h na Meta. */
export const VALIDADE_DO_CONTAINER_MS = 24 * 3600_000;
/** O prazo de cada chamada à Graph no conector (`bio/plataformas/instagram.ts`). */
export const PRAZO_DA_CHAMADA_MS = 60_000;
/** Quantas chamadas cabem numa passagem da rotina por uma publicação: status, limite, publish, releitura, permalink e a busca do post. */
export const CHAMADAS_DA_ROTINA = 6;
/**
 * Depois do publish sem resposta, quanto tempo a Meta tem para dar o container
 * por `PUBLISHED`. Passado isso com o container ainda `FINISHED`, vira erro que
 * manda conferir no Instagram: o mesmo container nunca é publicado de novo.
 */
export const ESPERA_DA_CONFIRMACAO_MS = 10 * 60_000;

/**
 * A posse da linha: quem trabalha nela grava `proximaEm` no futuro, e a rotina
 * só pega linha com a posse vencida. O prazo cobre as chamadas que o dono ainda
 * vai fazer, cada uma com o seu prazo no conector.
 */
export function posseAte(agora: Date, chamadas: number): Date {
  return new Date(agora.getTime() + Math.max(1, chamadas) * PRAZO_DA_CHAMADA_MS);
}

/** O texto que vai como legenda: sem link de caixa de entrada (MC-R), sem espaço sobrando. */
export function legendaDoPedido(corpo: string): string {
  return semLinksDeCaixaDeEntrada(corpo ?? '').trim();
}

/**
 * A mídia do pedido, na ordem do post: um JPEG por slide (carrossel), o JPEG do
 * story, ou o mp4 do corte no storage. Toda mídia precisa do sha256 inteiro —
 * é ele que prende a aprovação ao arquivo exato.
 */
export function midiasDoPedido(formato: PautaFormatoDaSemana, meta: unknown): { ok: true; midias: MidiaDoPedido[] } | { ok: false; motivo: string } {
  const m = lerMetaDaSemana(meta);
  if (formato === 'corte') {
    if (!m.video?.chave) return { ok: false, motivo: 'O mp4 do corte ainda não está no OS: rode a /root-midia no Mac para subir.' };
    if (!m.video.sha256) return { ok: false, motivo: 'O mp4 do corte está sem o sha256: suba de novo pela /root-midia.' };
    return { ok: true, midias: [{ chave: m.video.chave, sha256: m.video.sha256 }] };
  }
  const esperadas = formato === 'story' ? 1 : (m.slides?.length ?? 0);
  if (formato === 'carrossel' && (esperadas < CARROSSEL_MINIMO || esperadas > PAUTA_SLIDES_MAXIMO)) {
    return { ok: false, motivo: `O carrossel do Instagram tem de ${CARROSSEL_MINIMO} a ${PAUTA_SLIDES_MAXIMO} slides (este tem ${esperadas}).` };
  }
  const jpegs = new Map(m.imagens.filter((i) => tipoDaImagem(i) === 'jpeg').map((i) => [i.n, i]));
  const midias: MidiaDoPedido[] = [];
  const faltam: number[] = [];
  for (let n = 1; n <= esperadas; n++) {
    const j = jpegs.get(n);
    if (!j?.chave || !j.sha256) faltam.push(n);
    else midias.push({ chave: j.chave, sha256: j.sha256 });
  }
  if (faltam.length) {
    return { ok: false, motivo: `Falta o JPEG ${faltam.join(', ')} da peça no OS (é o que a Meta baixa): rode a /root-midia no Mac.` };
  }
  return { ok: true, midias };
}

/**
 * O que impede pedir a publicação desta peça, ou nulo. Cada frase é a que a
 * tela mostra: diz o que fazer, não só o que falta.
 */
export function motivoParaNaoPublicar(peca: PecaParaPublicar, conta: ContaParaPublicar | null, escopoDePublicar: string): string | null {
  if (!ehPecaDaSemana(peca.meta) || peca.canal !== 'instagram' || !(PAUTA_FORMATOS_DA_SEMANA as readonly string[]).includes(peca.formato)) {
    return 'Só a peça da semana de posts (carrossel, story ou corte) se publica pelo OS.';
  }
  if (peca.status === 'publicada') return 'Esta peça já foi publicada.';
  if (peca.status !== 'aprovada') return 'Só a peça aprovada se publica: aprove antes (um rascunho não sai do OS).';
  if (!conta) return 'A empresa não tem conta de publicação do Instagram: conecte na aba Semana.';
  if (!conta.escopos.includes(escopoDePublicar)) return 'A conta conectada não deu permissão de publicar: reconecte na aba Semana.';
  if (conta.status !== 'ok') return `A conta de publicação está com problema (${conta.status}): reconecte na aba Semana.`;
  const legenda = legendaDoPedido(peca.corpo);
  if (!legenda) return 'A peça está sem texto.';
  if (peca.formato !== 'story' && [...legenda].length > PAUTA_LEGENDA_DO_INSTAGRAM_MAXIMO) {
    return `A legenda tem ${[...legenda].length} caracteres e o Instagram aceita até ${PAUTA_LEGENDA_DO_INSTAGRAM_MAXIMO}: encurte antes.`;
  }
  const midias = midiasDoPedido(peca.formato as PautaFormatoDaSemana, peca.meta);
  return midias.ok ? null : midias.motivo;
}

/** Os argumentos do pedido, na forma que o catálogo valida e a aprovação assina. */
export function argsDaPublicacao(peca: PecaParaPublicar, conta: ContaParaPublicar): ArgsDaPublicacao {
  const midias = midiasDoPedido(peca.formato as PautaFormatoDaSemana, peca.meta);
  if (!midias.ok) throw new Error(midias.motivo);
  return {
    pecaId: peca.id,
    formato: peca.formato as PautaFormatoDaSemana,
    legenda: legendaDoPedido(peca.corpo),
    midias: midias.midias,
    igUserId: conta.externalId,
    ...(peca.agendadaPara ? { agendadaPara: peca.agendadaPara.toISOString() } : {}),
  };
}

/** Lê os argumentos que vieram da porta. Nulo quando a forma não é a do catálogo. */
export function lerArgsDaPublicacao(a: Record<string, unknown>): ArgsDaPublicacao | null {
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const pecaId = texto(a.pecaId);
  const legenda = texto(a.legenda);
  const igUserId = texto(a.igUserId);
  const formato = a.formato as PautaFormatoDaSemana;
  if (!pecaId || !legenda || !igUserId || !(PAUTA_FORMATOS_DA_SEMANA as readonly string[]).includes(formato)) return null;
  if (!Array.isArray(a.midias) || !a.midias.length || a.midias.length > PAUTA_SLIDES_MAXIMO) return null;
  const midias: MidiaDoPedido[] = [];
  for (const m of a.midias as unknown[]) {
    const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : null;
    const chave = texto(o?.chave);
    const sha256 = typeof o?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(o.sha256) ? o.sha256 : null;
    if (!chave || !sha256 || Object.keys(o ?? {}).length !== 2) return null;
    midias.push({ chave, sha256 });
  }
  if (a.agendadaPara !== undefined && (typeof a.agendadaPara !== 'string' || Number.isNaN(Date.parse(a.agendadaPara)))) return null;
  return { pecaId, formato, legenda, midias, igUserId, ...(a.agendadaPara ? { agendadaPara: a.agendadaPara as string } : {}) };
}

/**
 * O que mudou entre o que a aprovação assinou e a peça de agora, ou nulo. A
 * aprovação cobre o conteúdo exato: legenda, mídia, conta e horário.
 */
export function mudouDesdeOPedido(assinado: ArgsDaPublicacao, agora: ArgsDaPublicacao): string | null {
  if (assinado.legenda !== agora.legenda) return 'a legenda mudou';
  if (JSON.stringify(assinado.midias) !== JSON.stringify(agora.midias)) return 'a mídia mudou';
  if (assinado.igUserId !== agora.igUserId) return 'a conta de publicação mudou';
  if ((assinado.agendadaPara ?? null) !== (agora.agendadaPara ?? null)) return 'o horário mudou';
  if (assinado.formato !== agora.formato) return 'o formato mudou';
  return null;
}

/** O container final e os itens (carrossel), como ficam em `PautaPublicacao.containers`. */
export interface ContainersGravados {
  itens?: string[];
  final?: string;
  /** Quando o container final nasceu: vence em 24 h. */
  criadoEm?: string;
  /** Quando o publish foi tentado: a partir daí, reler o status antes de repetir. */
  publicandoEm?: string;
  /** A legenda que foi para a Meta (a assinada): é por ela que se acha o post cuja resposta se perdeu. */
  legenda?: string;
  /** A correlação da chamada aprovada: a conclusão pela rotina escreve o RASTRO nela, não na da passagem. */
  correlacao?: string;
  /** Quem confirmou em /atendimento: é quem publica, mesmo quando a rotina termina o Reels. */
  aprovadoPor?: string;
}

export function lerContainers(v: unknown): ContainersGravados {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return {
    itens: Array.isArray(o.itens) ? (o.itens as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
    final: typeof o.final === 'string' ? o.final : undefined,
    criadoEm: typeof o.criadoEm === 'string' ? o.criadoEm : undefined,
    publicandoEm: typeof o.publicandoEm === 'string' ? o.publicandoEm : undefined,
    legenda: typeof o.legenda === 'string' ? o.legenda : undefined,
    correlacao: typeof o.correlacao === 'string' ? o.correlacao : undefined,
    aprovadoPor: typeof o.aprovadoPor === 'string' ? o.aprovadoPor : undefined,
  };
}

/**
 * O que fazer com o `status_code` do container. `PUBLISHED` é o valor que a
 * documentação lista para o container já publicado (a conferir no primeiro
 * post real): com ele, nunca se publica de novo.
 */
export type PassoDoStatus = 'publicar' | 'esperar' | 'erro' | 'vencido' | 'ja_publicado';

export function passoDoStatus(codigo: string): PassoDoStatus {
  switch (codigo.trim().toUpperCase()) {
    case 'FINISHED':
      return 'publicar';
    case 'IN_PROGRESS':
      return 'esperar';
    case 'EXPIRED':
      return 'vencido';
    case 'PUBLISHED':
      return 'ja_publicado';
    default:
      return 'erro';
  }
}

/** O container venceu (24 h), ou o processamento passou dos 5 minutos que a Meta pede para esperar. */
export function containerVencido(c: ContainersGravados, agora: Date): boolean {
  return !!c.criadoEm && agora.getTime() - Date.parse(c.criadoEm) >= VALIDADE_DO_CONTAINER_MS;
}

export function esperaEsgotada(c: ContainersGravados, agora: Date): boolean {
  return !!c.criadoEm && agora.getTime() - Date.parse(c.criadoEm) >= ESPERA_MAXIMA_DO_PROCESSAMENTO_MS;
}

/**
 * Qual das mídias recentes da conta é o post cuja resposta se perdeu: a primeira
 * depois do container com a mesma legenda. Sem legenda (story), não há como
 * provar — devolve nulo, e quem chama registra sem id em vez de postar de novo.
 */
export function postDoContainer(
  recentes: ReadonlyArray<{ id: string; caption: string | null; timestamp: string | null; permalink: string | null }>,
  legenda: string | null,
  criadoEm: string | undefined,
): { id: string; permalink: string | null } | null {
  if (!legenda) return null;
  const desde = criadoEm ? Date.parse(criadoEm) - 60_000 : 0;
  const alvo = legenda.trim();
  const achados = recentes
    .filter((m) => (m.caption ?? '').trim() === alvo && (!m.timestamp || Date.parse(m.timestamp) >= desde))
    .sort((a, b) => Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? ''));
  return achados[0] ? { id: achados[0].id, permalink: achados[0].permalink } : null;
}

/** Os estados em que a publicação está a caminho (a rotina olha, e ninguém pede de novo). */
export const ESTADOS_EM_CURSO: readonly PautaPublicacaoEstado[] = ['container_criado', 'processando'];
/** Os estados de onde um efeito aprovado pode começar. `recusada` é "voltou ao manual": não sai. */
export const ESTADOS_QUE_COMECAM: readonly PautaPublicacaoEstado[] = ['pendente', 'erro'];

/**
 * O que a rotina faz com uma peça aprovada no horário (MD6 item 6, MD8 item 7).
 * Publicar sozinha exige as duas coisas da D-MD1: a nota
 * `pauta.publicacao.automatica` ligada E o item ativo de um lote assinado. Quem
 * confere que o item vale (o conteúdo de agora é o assinado, a janela, o uso
 * que sobra) é a PORTA, no consumo contado; aqui só se decide se vale chamá-la.
 */
export type DecisaoDaRotina =
  | { tipo: 'pular'; motivo: string }
  | { tipo: 'janela_perdida'; motivo: string }
  | { tipo: 'publicar'; loteItemId: string };

export function decisaoDaRotina(e: {
  agendadaPara: Date;
  agora: Date;
  automaticaLigada: boolean;
  loteItemId: string | null;
}): DecisaoDaRotina {
  if (!e.automaticaLigada) return { tipo: 'pular', motivo: 'publicação automática desligada' };
  if (!e.loteItemId) return { tipo: 'pular', motivo: 'sem aprovação da semana' };
  if (e.agora.getTime() - e.agendadaPara.getTime() > PAUTA_JANELA_DA_PUBLICACAO_MS) {
    return { tipo: 'janela_perdida', motivo: 'a janela de 2 h do slot passou sem publicar: volta ao manual' };
  }
  return { tipo: 'publicar', loteItemId: e.loteItemId };
}

/**
 * A nota `pauta.publicacao.automatica` liga a publicação automática quando a
 * primeira linha diz `ligada` (a marcação do markdown não conta). Sem nota ou
 * arquivada, desligada.
 */
export function notaDaAutomaticaLigada(nota: { body: string; arquivadoEm?: unknown } | null): boolean {
  if (!nota || nota.arquivadoEm) return false;
  const linha = nota.body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return linha.replace(/[*_`#>\-\s]/g, '').toLowerCase() === 'ligada';
}

/** A aprovação que a publicação `pendente` espera, como a tela precisa dela. */
export interface AprovacaoDoPedido {
  status: string;
  expiraEm: Date;
}

/**
 * Por que o pedido `pendente` morreu, ou nulo se ainda espera alguém. A linha
 * não volta sozinha quando a aprovação vence ou é recusada em /atendimento:
 * quem lê a publicação deriva daqui, para a tela não dizer "esperando" para
 * sempre e oferecer pedir de novo.
 */
export function pedidoMorto(aprovacao: AprovacaoDoPedido | null, agora: Date): string | null {
  if (!aprovacao) return 'O pedido sumiu da fila de aprovação: peça de novo.';
  if (aprovacao.status === 'rejeitada') return 'Outra pessoa recusou o pedido em /atendimento: peça de novo se ainda for para sair.';
  if (aprovacao.status === 'expirada' || aprovacao.expiraEm.getTime() <= agora.getTime()) {
    return 'O pedido venceu sem a confirmação de outra pessoa: peça de novo.';
  }
  if (aprovacao.status === 'consumida') return 'A aprovação foi usada, mas a publicação não começou: peça de novo.';
  return null;
}

/**
 * A publicação como a tela recebe. `pendente` com erro gravado (o container
 * venceu, a origem da mídia faltou) ou com o pedido morto chega como `erro`,
 * com o motivo: é o estado de onde se pede de novo. `aprovacao` indefinida é
 * "não foi consultada".
 */
export function publicacaoParaATela(
  p: {
    id: string;
    rede: PautaRede;
    estado: PautaPublicacaoEstado;
    externalId: string | null;
    permalink: string | null;
    erro: string | null;
    tentativas: number;
    proximaEm: Date | null;
    atualizadaEm: Date;
  },
  aprovacao?: AprovacaoDoPedido | null,
  agora: Date = new Date(),
): PautaPublicacaoDaPeca {
  let estado = p.estado;
  let erro = p.erro;
  if (estado === 'pendente') {
    const morto = erro ? null : aprovacao === undefined ? null : pedidoMorto(aprovacao, agora);
    if (erro || morto) {
      estado = 'erro';
      erro = erro ?? morto;
    }
  }
  return {
    id: p.id,
    rede: p.rede,
    estado,
    externalId: p.externalId,
    permalink: p.permalink,
    erro,
    tentativas: p.tentativas,
    proximaEm: p.proximaEm?.toISOString() ?? null,
    atualizadaEm: p.atualizadaEm.toISOString(),
  };
}
