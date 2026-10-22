import { ehNivel, temasDoConvite, type Bloco, type BlocosDoConvite, type Nivel } from './espinha';

/* ==========================================================================
 * A TEIA DO CLIENTE — o vault dele crescendo enquanto ele responde
 * ==========================================================================
 *
 * Pedido do Rodrigo (24/09): o link do cliente "imita o Obsidian". Cada tema
 * da espinha É uma nota do vault dele (a mesma chave `onboarding:<id>` que a
 * carga guiada escreve), e as notas se ligam entre si como no grafo do
 * Obsidian. Quando ele confirma ou responde, a nota acende e as ligações
 * aparecem — a teia de contexto vai se formando na frente dele, em vez de um
 * "obrigado, recebemos" no fim.
 *
 * TRÊS ESPÉCIES DE NÓ:
 *   · tema — uma nota da espinha. `pronta` quando ele confirmou/respondeu,
 *     `rascunho` quando há proposta aprovada esperando o OK dele, `vazia`
 *     quando nada foi dito ainda;
 *   · conversa — uma nota que JÁ NASCEU da transcrição da reunião (marco
 *     `ata.notas`), com minuto e trecho. Ela existe antes de ele responder, e
 *     é o que dá ao vault dele conteúdo desde o primeiro dia;
 *   · índice — a nota-mapa (o MOC do Obsidian): liga tudo o que EXISTE de
 *     verdade — pronta e da conversa. Rascunho e vazia ainda não são nota.
 *
 * AS LIGAÇÕES ENTRE TEMAS SÃO DADO VERSIONADO (`LIGACOES_DA_ESPINHA`): o que
 * uma nota puxa da outra é conhecimento da casa, não sorteio. As notas da
 * conversa trazem as suas próprias (`liga`), escritas por quem leu a ata.
 *
 * PURO: sem banco, sem Nest. Layout é assunto da tela.
 */

export type TipoDoNo = 'tema' | 'conversa' | 'indice';
export type EstadoDoNo = 'pronta' | 'rascunho' | 'vazia' | 'conversa' | 'indice';

export interface NotaDaConversa {
  id: string;
  titulo: string;
  corpo: string;
  minuto: string | null;
  trecho?: string | null;
  liga: string[];
  tags?: string[];
}

export interface NoDaTeia {
  /** `temaId`, `conversa:<id>` ou `indice`. */
  id: string;
  tipo: TipoDoNo;
  titulo: string;
  /** A pasta no vault dele: Casa, Intenção, Operação, Da conversa. Vazia para o índice. */
  pasta: string;
  estado: EstadoDoNo;
  bloco: Bloco | null;
  temaId: string | null;
  minuto: string | null;
  /** O que a nota diz hoje: o texto final, a proposta ou o corpo da nota da conversa. */
  corpo: string | null;
  /** Ids dos nós ligados, já resolvidos das arestas. */
  ligacoes: string[];
}

export interface ArestaDaTeia {
  de: string;
  para: string;
}

export interface TeiaDoCliente {
  /** A pasta raiz do vault dele, pelo slug. */
  pasta: string;
  nos: NoDaTeia[];
  arestas: ArestaDaTeia[];
  contagem: { prontas: number; rascunhos: number; vazias: number; daConversa: number };
}

export interface ItemParaTeia {
  temaId: string;
  status: string;
  proposta: string | null;
  textoFinal: string | null;
}

export interface EstadoParaTeia {
  slug: string;
  nivel: string | null;
  blocosDoLink: BlocosDoConvite;
  itens: readonly ItemParaTeia[];
  notasDaConversa: readonly NotaDaConversa[];
  /**
   * Produção 22C (W3): a conversa de WhatsApp ligada ao cliente (o grupo
   * `ROOT | <cliente>` ou o 1:1). Só a CONTAGEM entra na teia: o link é do
   * cliente e nunca mostra texto de mensagem. Ausente ou zero = sem nó.
   */
  whatsapp?: { conversas: number; mensagens: number } | null;
}

export const PASTA_DO_BLOCO: Record<Bloco, string> = {
  A: 'Triagem',
  B: 'Casa',
  C: 'Intenção',
  D: 'Operação',
};

export const PASTA_DA_CONVERSA = 'Da conversa';
export const ID_DO_INDICE = 'indice';
/** O nó da conversa de WhatsApp com a casa (produção 22C): uma nota "da conversa", ligada aos canais. */
export const ID_DO_WHATSAPP = 'conversa:whatsapp';

/** O que uma nota puxa da outra. Simétrico; a ordem dos pares não importa. */
export const LIGACOES_DA_ESPINHA: readonly [string, string][] = [
  ['negocio', 'cliente-ideal'],
  ['negocio', 'oferta-e-preco'],
  ['negocio', 'vocabulario'],
  ['negocio', 'decisao-recente'],
  ['cliente-ideal', 'oferta-e-preco'],
  ['cliente-ideal', 'canais'],
  ['oferta-e-preco', 'numeros-que-importam'],
  ['numeros-que-importam', 'd-linha-de-base'],
  ['numeros-que-importam', 'decisao-recente'],
  ['vocabulario', 'regras-da-casa'],
  ['regras-da-casa', 'd-acessos'],
  ['regras-da-casa', 'c-duvidas'],
  ['canais', 'c-desejo'],
  ['decisao-recente', 'c-desejo'],
  ['c-desejo', 'd-primeira-pergunta'],
  ['c-desejo', 'c-dia-a-dia'],
  ['c-duvidas', 'd-dupla'],
  ['d-dupla', 'd-acessos'],
  ['d-dupla', 'd-status'],
  ['d-dupla', 'd-turma'],
  ['d-linha-de-base', 'd-primeira-pergunta'],
  ['d-ambiente', 'd-acessos'],
  ['d-anexos', 'negocio'],
  ['d-anexos', 'd-acessos'],
  ['a-empresa', 'negocio'],
  ['a-sistemas', 'd-acessos'],
  ['a-tarefa-que-toma-tempo', 'd-linha-de-base'],
  ['a-tirar-do-prato', 'c-desejo'],
  ['a-uso-de-ia', 'regras-da-casa'],
];

export function idDaNotaDaConversa(id: string): string {
  return `conversa:${id}`;
}

function estadoDoTema(i: ItemParaTeia | undefined): EstadoDoNo {
  const s = i?.status ?? 'em-branco';
  if (s === 'confirmado' || s === 'corrigido' || s === 'respondido') return 'pronta';
  if (s === 'aprovado' && (i?.proposta ?? '').trim()) return 'rascunho';
  return 'vazia';
}

export function montarTeia(e: EstadoParaTeia): TeiaDoCliente {
  const nivel: Nivel | null = ehNivel(e.nivel) ? e.nivel : null;
  const temas = temasDoConvite(e.blocosDoLink, nivel);
  const porTema = new Map(e.itens.map((i) => [i.temaId, i]));

  const nos: NoDaTeia[] = temas.map((t) => {
    const i = porTema.get(t.id);
    const estado = estadoDoTema(i);
    return {
      id: t.id,
      tipo: 'tema',
      titulo: t.titulo,
      pasta: PASTA_DO_BLOCO[t.bloco],
      estado,
      bloco: t.bloco,
      temaId: t.id,
      minuto: null,
      corpo: estado === 'pronta' ? (i?.textoFinal ?? '').trim() || null : estado === 'rascunho' ? (i?.proposta ?? '').trim() || null : null,
      ligacoes: [],
    };
  });

  for (const n of e.notasDaConversa) {
    if (!n?.id || !n.titulo) continue;
    nos.push({
      id: idDaNotaDaConversa(n.id),
      tipo: 'conversa',
      titulo: n.titulo,
      pasta: PASTA_DA_CONVERSA,
      estado: 'conversa',
      bloco: null,
      temaId: null,
      minuto: n.minuto ?? null,
      corpo: (n.corpo ?? '').trim() || null,
      ligacoes: [],
    });
  }

  const zap = e.whatsapp;
  if (zap && zap.conversas > 0) {
    const m = Math.max(0, Math.floor(zap.mensagens));
    nos.push({
      id: ID_DO_WHATSAPP,
      tipo: 'conversa',
      titulo: 'WhatsApp com a Root',
      pasta: PASTA_DA_CONVERSA,
      estado: 'conversa',
      bloco: null,
      temaId: null,
      minuto: null,
      corpo: `${zap.conversas === 1 ? 'Uma conversa' : `${zap.conversas} conversas`} com a Root no WhatsApp${m ? `, ${m === 1 ? '1 mensagem' : `${m} mensagens`} guardadas` : ''}.`,
      ligacoes: [],
    });
  }

  nos.push({
    id: ID_DO_INDICE,
    tipo: 'indice',
    titulo: 'Índice',
    pasta: '',
    estado: 'indice',
    bloco: null,
    temaId: null,
    minuto: null,
    corpo: null,
    ligacoes: [],
  });

  const existe = new Set(nos.map((n) => n.id));
  const chaves = new Set<string>();
  const arestas: ArestaDaTeia[] = [];
  const ligar = (a: string, b: string) => {
    if (a === b || !existe.has(a) || !existe.has(b)) return;
    const chave = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (chaves.has(chave)) return;
    chaves.add(chave);
    arestas.push({ de: a, para: b });
  };

  for (const [a, b] of LIGACOES_DA_ESPINHA) ligar(a, b);
  for (const n of e.notasDaConversa) {
    for (const alvo of n.liga ?? []) ligar(idDaNotaDaConversa(n.id), alvo);
  }
  // A conversa de WhatsApp puxa os canais e o dia a dia (quando o tema existe no convite).
  ligar(ID_DO_WHATSAPP, 'canais');
  ligar(ID_DO_WHATSAPP, 'c-dia-a-dia');
  // O índice liga o que EXISTE: nota pronta e nota da conversa. É ele que cresce a cada resposta.
  for (const n of nos) {
    if (n.estado === 'pronta' || n.estado === 'conversa') ligar(ID_DO_INDICE, n.id);
  }

  const porNo = new Map(nos.map((n) => [n.id, n]));
  for (const a of arestas) {
    porNo.get(a.de)?.ligacoes.push(a.para);
    porNo.get(a.para)?.ligacoes.push(a.de);
  }

  return {
    pasta: `${e.slug}/`,
    nos,
    arestas,
    contagem: {
      prontas: nos.filter((n) => n.estado === 'pronta').length,
      rascunhos: nos.filter((n) => n.estado === 'rascunho').length,
      vazias: nos.filter((n) => n.estado === 'vazia').length,
      daConversa: nos.filter((n) => n.estado === 'conversa').length,
    },
  };
}

/** Lê o marco `ata.notas` com tolerância: o que não tiver id e título não entra. */
export function notasDaConversaDe(dados: unknown): NotaDaConversa[] {
  const lista = (dados as { notas?: unknown } | null)?.notas;
  if (!Array.isArray(lista)) return [];
  const saida: NotaDaConversa[] = [];
  for (const n of lista) {
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const titulo = typeof o.titulo === 'string' ? o.titulo.trim() : '';
    if (!id || !titulo) continue;
    saida.push({
      id,
      titulo,
      corpo: typeof o.corpo === 'string' ? o.corpo : '',
      minuto: typeof o.minuto === 'string' && o.minuto.trim() ? o.minuto.trim() : null,
      trecho: typeof o.trecho === 'string' ? o.trecho : null,
      liga: Array.isArray(o.liga) ? o.liga.filter((x): x is string => typeof x === 'string') : [],
      tags: Array.isArray(o.tags) ? o.tags.filter((x): x is string => typeof x === 'string') : [],
    });
  }
  return saida;
}
