import {
  AREA_BLOCOS,
  AREA_FASES_DO_FLUXO,
  AREA_ITENS,
  AREA_ROTULO_DO_BLOCO,
  ehConteudoDeItem,
  faseDoFluxoPorId,
  type AreaDoClienteParaOCliente,
  type AreaFaseId,
  type AreaItemId,
  type ConteudoDoItemParaOCliente,
  type EstadoDaSala,
  type FaseDaAreaParaOCliente,
  type ItemDaAreaParaOCliente,
  type SalaVersaoPublica,
} from '@mktos/shared';

import type { AcompanhamentoDaSala, EventoDaSala } from './sala-projecao';

/*
 * A ÁREA DO CLIENTE COMO PROJEÇÃO (leva A, 30/10/2026): o que o cliente vê no
 * `/s/<token>` depois do fechamento, montado do que está gravado.
 *
 * Três perguntas, as três puras (a suíte mede sem banco):
 *
 *   · MODO: a sala vira área quando o negócio fechou (`clienteAtivoEm` na ficha
 *     ou o fato `cliente.ativo`) ou quando o lead já tem o card da implantação
 *     na lista Onboarding de cliente (`ComercialFicha.cardId`, o mesmo id de
 *     `cardIdDoLead`). Lead em andamento continua na sala de sempre.
 *
 *   · FASE DO FLUXO: a régua das sete fases do Fluxo v6 no alto da área. Nesta
 *     leva ela é DERIVADA de fatos com data, nunca digitada: o fechamento abre a
 *     Abertura; o kickoff que passou abre a Primeira semana; sete dias depois
 *     dele (o nome da fase é "primeira semana") vem a Construção; trinta dias
 *     depois (o nome da fase é "construção, 30 dias") ou o trilho em operação
 *     assistida vem o Acompanhamento; o trilho encerrado vai à última fase. A
 *     leva B (cronograma, tarefa 09) troca esta conta pelas datas combinadas
 *     com o cliente; até lá, a régua diz onde os fatos sustentam que estamos.
 *
 *   · SLOTS: os quinze itens, bloco a bloco. Um item publicado pela Root
 *     (versão de `SalaVersao` com `item`) vence tudo; sem versão, o que o OS já
 *     sabe entra DERIVADO (contrato, escopo, o caminho para dúvida e o que vem
 *     agora, que a projeção da sala já tinha); sem nada, o slot fica vazio
 *     dizendo em que fase chega. "Novo" é o publicado cuja versão não tem
 *     leitura gravada (`SalaLeitura`).
 *
 * Nada aqui inventa dado: campo sem fonte é nulo, e a tela mostra "ainda não".
 */

export interface FichaParaArea {
  clienteAtivoEm: Date | null;
  kickoffEm: Date | null;
  cardId: string | null;
}

export interface TrilhoParaArea {
  fase: string | null;
  marcos: { tipo: string; em: Date; dados: unknown }[];
}

export interface VersaoPublicadaDoItem {
  item: string;
  numero: number;
  /** A ordem desta versão entre as do mesmo item (1ª, 2ª...), derivada na leitura. */
  edicao: number;
  publicadaEm: Date;
  conteudo: unknown;
}

export interface LeituraDoItem {
  item: string;
  versao: number;
}

export interface EntradaDaArea {
  agora: Date;
  empresa: string;
  ficha: FichaParaArea | null;
  eventos: readonly EventoDaSala[];
  /** A projeção da sala de sempre (aceite, proposta, começo): é dela que saem os derivados. */
  estado: EstadoDaSala;
  acompanhamento: AcompanhamentoDaSala;
  /** A última versão publicada DA SALA (item nulo), se houver: traz os próximos passos e quem cuida. */
  salaPublicada: SalaVersaoPublica | null;
  trilho: TrilhoParaArea | null;
  publicadas: readonly VersaoPublicadaDoItem[];
  leituras: readonly LeituraDoItem[];
  /** Quem cuida da conta, quando a sala publicada ou a ficha dizem; nulo nunca inventa nome. */
  quemCuida: { nome: string; papel: string } | null;
}

type P = Record<string, unknown>;
const DIA_MS = 86_400_000;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function tem(eventos: readonly EventoDaSala[], type: string): boolean {
  return eventos.some((e) => e.type === type);
}

function ultimo(eventos: readonly EventoDaSala[], type: string): EventoDaSala | null {
  for (let i = eventos.length - 1; i >= 0; i--) if (eventos[i].type === type) return eventos[i];
  return null;
}

/** O negócio fechou de verdade (a data na ficha ou o fato que o fechamento grava)? */
export function negocioFechado(e: { ficha: Pick<FichaParaArea, 'clienteAtivoEm'> | null; eventos: readonly EventoDaSala[] }): boolean {
  return Boolean(e.ficha?.clienteAtivoEm) || tem(e.eventos, 'cliente.ativo');
}

/**
 * O modo do link: `area` quando o negócio fechou ou quando o lead já tem o card
 * da implantação (o "Iniciar onboarding" antes do fechamento também abre a área,
 * porque o cliente já está sendo implantado); `sala` no resto.
 */
export function modoDaSala(e: { ficha: Pick<FichaParaArea, 'clienteAtivoEm' | 'cardId'> | null; eventos: readonly EventoDaSala[] }): 'sala' | 'area' {
  if (negocioFechado(e)) return 'area';
  if (e.ficha?.cardId) return 'area';
  return 'sala';
}

/** O horário do kickoff: o da ficha ou o do fato `kickoff.marcado` (o cliente marcou pela sala). */
export function kickoffDaArea(e: { ficha: Pick<FichaParaArea, 'kickoffEm'> | null; eventos: readonly EventoDaSala[] }): Date | null {
  if (e.ficha?.kickoffEm) return e.ficha.kickoffEm;
  const k = ultimo(e.eventos, 'kickoff.marcado');
  const h = k ? str((k.payload as P)?.horario) : null;
  if (!h) return null;
  const d = new Date(h);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A fase do Fluxo v6 que os fatos sustentam (ver o cabeçalho: provisória até a leva B). */
export function faseDoFluxo(e: Pick<EntradaDaArea, 'agora' | 'ficha' | 'eventos' | 'trilho'>): { atual: AreaFaseId; fases: FaseDaAreaParaOCliente[] } {
  const agora = e.agora.getTime();
  let atual: AreaFaseId = 'fase-1';
  if (negocioFechado(e)) atual = 'fase-2';
  const kickoff = kickoffDaArea(e);
  const kickoffPassou = kickoff !== null && kickoff.getTime() <= agora;
  const diasDesdeOKickoff = kickoffPassou ? Math.floor((agora - kickoff.getTime()) / DIA_MS) : -1;
  if (kickoffPassou) atual = 'fase-3';
  if (kickoffPassou && diasDesdeOKickoff >= 7) atual = 'fase-4';
  const emOperacao =
    e.trilho?.fase === 'operacao' || Boolean(e.trilho?.marcos.some((m) => m.tipo === 'fase.avancou' && ((m.dados ?? {}) as P).para === 'operacao'));
  if (emOperacao || (kickoffPassou && diasDesdeOKickoff >= 30)) atual = 'fase-5';
  if (e.trilho?.fase === 'encerrado') atual = 'fase-7';
  const iAtual = AREA_FASES_DO_FLUXO.findIndex((f) => f.id === atual);
  return {
    atual,
    fases: AREA_FASES_DO_FLUXO.map((f, i) => ({ id: f.id, numero: f.numero, nome: f.nome, estado: i < iAtual ? 'feita' : i === iAtual ? 'atual' : 'futura' })),
  };
}

const reais = (centavos: number): string => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaCurto = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
};
const diaDoPasso = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d);

const vazio = (): ConteudoDoItemParaOCliente => ({ resumo: null, texto: null, topicos: [], quando: null, documento: null, oQueMudou: null });

export interface DerivadoDaArea {
  conteudo: ConteudoDoItemParaOCliente;
  abre: ItemDaAreaParaOCliente['abre'];
}

/**
 * O que o OS já sabe, item a item, a partir da projeção da sala. Só os quatro
 * que a leva A alcança sem fonte nova: contrato (o documento de assinatura),
 * escopo (a proposta aceita, ou a publicada), o caminho para tirar dúvida (o
 * WhatsApp da Root, quando a mesa escreveu o número) e a linha de execução (os
 * próximos passos da sala publicada e os derivados do acompanhamento). Os
 * demais derivados (agenda, cronograma, atas) são da leva B.
 */
export function derivadosDaArea(e: Pick<EntradaDaArea, 'estado' | 'acompanhamento' | 'salaPublicada'>): Partial<Record<AreaItemId, DerivadoDaArea>> {
  const out: Partial<Record<AreaItemId, DerivadoDaArea>> = {};

  // Contrato: o documento de assinatura mais novo, como o acompanhamento já o descreve.
  const contrato = e.acompanhamento.documentos.find((d) => d.tipo === 'contrato');
  if (contrato) {
    out.contrato = {
      conteudo: { ...vazio(), resumo: `Contrato · ${contrato.estado}`, quando: contrato.em, documento: { titulo: 'Contrato', link: contrato.link ?? null } },
      abre: contrato.link ? { tipo: 'externo', url: contrato.link } : null,
    };
  }

  // Escopo: a oferta aceita (ou a recomendada da proposta publicada), com a descrição do produto.
  const p = e.estado.proposta;
  const a = e.estado.aceite;
  const ofertas = p ? [p.recomendada, ...(p.alternativa ? [p.alternativa] : [])] : [];
  const oferta = a ? ofertas.find((o) => o.produto === a.produto) ?? null : p?.recomendada ?? null;
  if (oferta || a) {
    const rotulo = oferta?.rotulo ?? a?.produto ?? 'Escopo';
    const valor = a ? a.valorCentavos : oferta?.valorCentavos ?? null;
    const parcelas = a ? a.parcelas : oferta?.parcelas ?? null;
    const linhaDoValor = valor !== null && parcelas !== null ? ` · ${reais(valor)} em ${parcelas}×` : '';
    out.escopo = {
      conteudo: {
        ...vazio(),
        resumo: `${rotulo}${linhaDoValor}${a ? ' · aceito por você' : p ? ` · proposta v${p.versao}` : ''}`,
        texto: oferta?.descricao || null,
        quando: p?.publicadaEm ?? null,
      },
      abre: p ? { tipo: 'proposta' } : null,
    };
  }

  // Tirar uma dúvida: o WhatsApp da Root, quando a mesa escreveu o número; sem ele, o marcador honesto.
  const numero = e.acompanhamento.contato.whatsapp;
  out.duvidas = {
    conteudo: {
      ...vazio(),
      resumo: numero ? 'Fale com a Root pelo WhatsApp. Respondemos em horário comercial.' : e.acompanhamento.contato.rotulo,
      topicos: numero ? ['Dúvida de uso: mande no grupo da sua empresa, a Root responde por lá.', 'Pedido de mudança no combinado: fale com quem cuida da sua conta.'] : [],
    },
    abre: numero ? { tipo: 'externo', url: `https://wa.me/${numero}` } : null,
  };

  // Linha de execução: o que vem agora (a sala publicada escreve; o acompanhamento deriva).
  const passosDaSala = (e.salaPublicada?.conteudo.proximosPassos ?? []).map((x) => `${x.oque} · ${diaDoPasso(x.quando)} · com ${x.comQuem}`);
  const passosDerivados = e.acompanhamento.proximosPassos.map((x) => {
    const quem = x.deQuem === 'voce' ? 'você' : 'Root';
    const quando = x.quando ? (x.quandoTipo === 'ate' ? ` · até ${diaCurto(x.quando)}` : ` · ${diaCurto(x.quando)}`) : '';
    return `${quem}: ${x.texto}${quando}`;
  });
  const topicos = [...passosDaSala, ...passosDerivados].slice(0, 8);
  if (topicos.length) {
    out['linha-de-execucao'] = {
      conteudo: { ...vazio(), resumo: e.acompanhamento.etapa?.rotulo ?? 'O que vem agora', texto: e.acompanhamento.etapa?.descricao ?? null, topicos },
      abre: null,
    };
  }

  return out;
}

/** O conteúdo guardado numa versão de item, no formato que o cliente lê (sem o id do item, sem o id do documento). */
export function conteudoPublicadoParaOCliente(conteudo: unknown): ConteudoDoItemParaOCliente {
  if (!ehConteudoDeItem(conteudo)) return vazio();
  const c = conteudo;
  return {
    resumo: str(c.resumo),
    texto: str(c.texto),
    topicos: Array.isArray(c.topicos) ? c.topicos.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [],
    quando: str(c.quando),
    // O link do arquivo do cliente ainda não sai pela área (leva C: o PDF do PRD, da ata inteira); o título diz que ele existe.
    documento: c.documentoId ? { titulo: 'Documento anexado pela Root', link: null } : null,
    oQueMudou: str(c.oQueMudou),
  };
}

/** A área inteira, como o `GET /sala/:token` a devolve em modo área. */
export function areaParaOCliente(e: EntradaDaArea): AreaDoClienteParaOCliente {
  const derivados = derivadosDaArea(e);
  const publicadaPorItem = new Map<string, VersaoPublicadaDoItem>();
  for (const v of e.publicadas) {
    const atual = publicadaPorItem.get(v.item);
    if (!atual || atual.numero < v.numero) publicadaPorItem.set(v.item, v);
  }
  const lidas = new Set(e.leituras.map((l) => `${l.item}:${l.versao}`));

  const itens: ItemDaAreaParaOCliente[] = AREA_ITENS.map((def) => {
    const fase = faseDoFluxoPorId(def.entraNaFase);
    const chegaNaFase = { id: fase.id, numero: fase.numero, nome: fase.nome };
    const pub = publicadaPorItem.get(def.id);
    if (pub) {
      return {
        id: def.id,
        bloco: def.bloco,
        titulo: def.titulo,
        estado: 'publicado',
        chegaNaFase,
        origem: 'publicado',
        versao: pub.numero,
        edicao: pub.edicao,
        publicadoEm: pub.publicadaEm.toISOString(),
        novo: !lidas.has(`${def.id}:${pub.numero}`),
        conteudo: conteudoPublicadoParaOCliente(pub.conteudo),
        abre: null,
      };
    }
    const der = derivados[def.id];
    if (der) {
      return { id: def.id, bloco: def.bloco, titulo: def.titulo, estado: 'publicado', chegaNaFase, origem: 'derivado', versao: null, edicao: null, publicadoEm: null, novo: false, conteudo: der.conteudo, abre: der.abre };
    }
    return { id: def.id, bloco: def.bloco, titulo: def.titulo, estado: 'vazio', chegaNaFase, origem: null, versao: null, edicao: null, publicadoEm: null, novo: false, conteudo: null, abre: null };
  });

  const ultimaPublicacao = [...publicadaPorItem.values()].map((v) => v.publicadaEm.getTime()).sort((a, b) => b - a)[0];
  return {
    empresa: e.empresa,
    atualizadoEm: ultimaPublicacao ? new Date(ultimaPublicacao).toISOString() : null,
    noAr: itens.filter((i) => i.estado === 'publicado').length,
    total: AREA_ITENS.length,
    fase: faseDoFluxo(e),
    blocos: AREA_BLOCOS.map((b) => ({ id: b, nome: AREA_ROTULO_DO_BLOCO[b].nome, paraOCliente: AREA_ROTULO_DO_BLOCO[b].paraOCliente, itens: itens.filter((i) => i.bloco === b) })),
    quemCuida: e.quemCuida,
  };
}

/**
 * A edição de cada versão de item (1ª, 2ª...): a posição entre as versões do
 * MESMO item em ordem de número. O número é único por lead e cobre a sala e os
 * itens, então "v7" pode ser a segunda ata; é esta conta que diz isso.
 */
export function edicoesPorVersao(versoes: readonly { numero: number; item: string | null }[]): Map<number, number> {
  const porItem = new Map<string, number[]>();
  for (const v of versoes) {
    if (!v.item) continue;
    const lista = porItem.get(v.item) ?? [];
    lista.push(v.numero);
    porItem.set(v.item, lista);
  }
  const out = new Map<number, number>();
  for (const numeros of porItem.values()) {
    numeros.sort((a, b) => a - b).forEach((n, i) => out.set(n, i + 1));
  }
  return out;
}
