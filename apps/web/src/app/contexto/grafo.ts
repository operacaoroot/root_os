import type {
  AgenteDoMapa,
  CatalogoDeConexoes,
  ConexaoDoMapa,
  ListaDeRotinas,
  MemoriaList,
  NotaDeContexto,
  Organograma,
  PessoaDoMapa,
  RosterDeAgentes,
  RotinaDoMapa,
} from './tipos';
import { rotuloDaNatureza } from './tipos';
import { SECOES } from '@mktos/shared';

/*
 * ============================================================================
 * O MAPA — RF-M-04: o contexto do negócio desenhado e navegável
 * ============================================================================
 *
 * Este arquivo é PURO: recebe o que as cinco rotas devolveram e produz nós,
 * arestas e coordenadas. Não busca nada, não conhece React e não guarda estado.
 * É o que permite testar o desenho sem montar a tela — e, principalmente, o que
 * mantém a regra que segue.
 *
 * ----------------------------------------------------------------------------
 * TODO PONTO DO MAPA É UM REGISTRO QUE EXISTE
 * ----------------------------------------------------------------------------
 * Não há nó de exemplo, nó de demonstração nem nó de "placeholder". Cada nó
 * carrega, em `registro`, a linha que a API devolveu — é ela que a gaveta abre.
 * Empresa sem dado nenhum não produz mapa: produz `registros === 0`, e a tela
 * mostra o caminho de carga em vez de um desenho bonito de mentira.
 *
 * ----------------------------------------------------------------------------
 * LAYOUT DETERMINÍSTICO, E POR QUE NÃO É SIMULAÇÃO DE FORÇA
 * ----------------------------------------------------------------------------
 * Nada de física. Primeiro porque grafo com força exige biblioteca nova, e
 * dependência nova é decisão humana (registrado no relatório da fatia).
 * Segundo, e mais importante: força dá posição DIFERENTE a cada carregamento
 * para o mesmo dado. Numa tela que a ROOT usa para mostrar o contexto de um
 * cliente, "a nota que estava ali em cima" tem de continuar ali em cima na
 * próxima vez. Aqui a posição é função do dado e da ordem — mesma empresa,
 * mesmo desenho.
 *
 * A forma é um núcleo (a empresa), cinco EIXOS ao redor dele (memória,
 * agentes, rotinas, conexões, gente) e os registros de cada eixo distribuídos
 * em anéis dentro do setor daquele eixo.
 *
 * ----------------------------------------------------------------------------
 * O TETO POR EIXO É PARA A TELA SEGUIR LEGÍVEL, E ELE SE DECLARA
 * ----------------------------------------------------------------------------
 * Quatro anéis cabem no quadro; o que passar disso vira um nó "+N", que abre a
 * lista COMPLETA daquele eixo na gaveta. O que não acontece é o mapa esconder
 * registro em silêncio: `excedente` diz quantos ficaram de fora, e o eixo mostra
 * o total que a API declarou, não o número de bolinhas desenhadas.
 */

export type FamiliaKey = 'memoria' | 'agentes' | 'rotinas' | 'conexoes' | 'gente';
export type Tom = 'brand' | 'good' | 'warn' | 'bad' | 'muted' | 'info';
export type AreaKey = (typeof SECOES)[number]['key'];
export type FiltroDeArea = AreaKey | 'sem-area' | '';
export const AREAS = SECOES.map(({ key, label }) => ({ key, rotulo: label }));
const CHAVES_DE_AREA = new Set<string>(AREAS.map((area) => area.key));

/** Somente executores inscritos e conhecidos recebem área por tipo. */
export const AREA_DO_EXECUTOR: Readonly<Record<string, AreaKey>> = {
  'pauta.rodada': 'conteudo',
  'pauta.coleta': 'conteudo',
  'pauta.encadear': 'conteudo',
  'pauta.publicar-agendadas': 'conteudo',
  'pauta.coletar-comentarios': 'conteudo',
  'pauta.relatorio': 'conteudo',
};

export function rotuloDaArea(chave: AreaKey): string {
  return AREAS.find((area) => area.key === chave)?.rotulo ?? chave;
}

export function areasDaNota(tags: readonly string[]): AreaKey[] {
  const encontradas = new Set<AreaKey>();
  for (const tag of tags) {
    if (!tag.startsWith('area:')) continue;
    const chave = tag.slice(5);
    if (CHAVES_DE_AREA.has(chave)) encontradas.add(chave as AreaKey);
  }
  return AREAS.map((area) => area.key).filter((chave) => encontradas.has(chave));
}

/** O lado do `viewBox`. Quadrado: o desenho é radial e não tem lado privilegiado. */
export const LADO = 1000;
const CENTRO = { x: LADO / 2, y: LADO / 2 };

export const RAIO_DO_NUCLEO = 46;
export const RAIO_DO_EIXO = 27;
export const RAIO_DO_NO = 17;
/** A distância do rótulo ao centro do ponto. O desenho e a moldura usam a mesma. */
export const DESLOCAMENTO_DO_ROTULO = RAIO_DO_NO + 13;

/*
 * ----------------------------------------------------------------------------
 * A CAIXA DO RÓTULO — de onde sai TODA a geometria daqui para baixo
 * ----------------------------------------------------------------------------
 * O que decide o desenho não é o ponto (17 de raio): é o NOME embaixo dele. O
 * rótulo é cortado em doze letras e desenhado em 10px de fonte monoespaçada, em
 * que cada letra ocupa perto de 0,6em — ou seja, uma caixa de 72 por 10
 * unidades deste `viewBox`, centrada no ponto.
 *
 * Daí saem as três medidas que mandam: o passo mínimo dentro de um anel, o vão
 * entre dois anéis e até onde o anel externo pode ir sem que o rótulo do ponto
 * mais lateral passe da borda. A versão anterior media só a altura, e o rótulo
 * do ponto mais à esquerda do eixo de gente saía do quadro pela lateral com os
 * eixos cheios — a moldura estava sendo conferida em uma dimensão só.
 */

/** O corte do rótulo. `curto()` em `Mapa.tsx` usa este mesmo número. */
export const MAX_LETRAS_DO_ROTULO = 12;
/** Largura de uma letra em 10px de fonte monoespaçada, neste `viewBox`. */
const LARGURA_DA_LETRA = 6;
/** A caixa do rótulo, e a metade dela para cada lado do ponto. */
export const LARGURA_DO_ROTULO = MAX_LETRAS_DO_ROTULO * LARGURA_DA_LETRA;
export const METADE_DO_ROTULO = LARGURA_DO_ROTULO / 2;
/** O quanto o rótulo desce abaixo da linha de base (a perna do "p", do "g"). */
export const DESCIDA_DO_ROTULO = 3;
/** Folga entre o que o desenho alcança e a borda do quadro. */
const MARGEM_DO_QUADRO = 4;

/**
 * Acima disto o eixo é DENSO e os rótulos deixam de caber lado a lado.
 *
 * Não é gosto: num eixo cheio o passo entre dois pontos do mesmo anel é o
 * mínimo declarado abaixo, e vinte nomes visíveis ao mesmo tempo viram uma
 * faixa de texto. Eixo denso desenha o rótulo só do ponto selecionado, do que a
 * busca marcou e daquele sob o cursor — que é também como se lê um mapa de
 * verdade: a paisagem primeiro, o nome depois.
 */
export const LIMITE_DE_ROTULO_SEMPRE = 12;

const RAIO_DA_FAMILIA = 168;
/** A abertura do setor de cada eixo. Os 10° que sobram são a calha entre eixos. */
const SETOR_GRAUS = 62;
/**
 * Passo mínimo entre dois pontos do MESMO anel: a largura da caixa do rótulo.
 *
 * Menos do que isso e o nome de um registro invade o do vizinho. Aumentar custa
 * pontos por anel — é a troca consciente entre quantos registros cabem e
 * quantos dá para ler.
 */
const ESPACO_MINIMO = LARGURA_DO_ROTULO;

const ANEL_INTERNO = 268;
/**
 * Até onde o anel externo pode ir.
 *
 * O ponto mais extremo de um setor precisa caber COM o rótulo: meia caixa para
 * o lado (no eixo de gente há ponto a 180°, encostado na lateral esquerda) e a
 * descida do rótulo para baixo. Vale a maior das duas exigências.
 */
const ANEL_EXTERNO =
  LADO / 2 - Math.max(METADE_DO_ROTULO, DESLOCAMENTO_DO_ROTULO + DESCIDA_DO_ROTULO) - MARGEM_DO_QUADRO;
/** Os quatro anéis, igualmente espaçados entre o interno e o externo. */
const PASSO_ENTRE_ANEIS = (ANEL_EXTERNO - ANEL_INTERNO) / 3;
const ANEIS = [0, 1, 2, 3].map((i) => ANEL_INTERNO + i * PASSO_ENTRE_ANEIS);

export interface DescricaoDeFamilia {
  key: FamiliaKey;
  rotulo: string;
  /** O que o eixo é, em uma linha. Aparece na legenda e no mapa vazio. */
  descricao: string;
  anguloGraus: number;
  /** A tela que manda nesse assunto. `null` = mora aqui mesmo. */
  rota: string | null;
  /**
   * A rota da API que alimenta o eixo, e a permissão que ela exige.
   *
   * OS DOIS CAMPOS SÃO LIDOS PELA TELA — `page.tsx` percorre `FAMILIAS` para
   * buscar. Numa versão anterior a permissão estava declarada aqui e a tela
   * pedia `can('obsidian.ver')` na mão, linha a linha: a declaração era
   * decoração, e as duas listas podiam divergir sem que nada reclamasse.
   */
  consulta: string;
  permissao: string;
  icone: string;
}

/**
 * OS CINCO EIXOS, na ordem em que saem do topo e giram no sentido horário.
 *
 * A memória fica no topo porque ela é o assunto da tela: o resto do mapa existe
 * para mostrar o que a empresa TEM em volta do que ela SABE.
 */
export const FAMILIAS: ReadonlyArray<DescricaoDeFamilia> = [
  {
    key: 'memoria',
    rotulo: 'Memória',
    descricao: 'regras da casa, decisões, dicionário — o contexto versionado',
    anguloGraus: -90,
    rota: null,
    consulta: '/memoria',
    permissao: 'obsidian.ver',
    icone: 'Brain',
  },
  {
    key: 'agentes',
    rotulo: 'Agentes',
    descricao: 'quem trabalha, com procedimento e dono',
    anguloGraus: -18,
    rota: '/agentes',
    consulta: '/agents',
    permissao: 'mcp.ver',
    icone: 'Bot',
  },
  {
    key: 'rotinas',
    rotulo: 'Rotinas',
    descricao: 'o que roda sozinho, e em que estado',
    anguloGraus: 54,
    rota: '/rotinas',
    consulta: '/rotinas',
    permissao: 'automacoes.ver',
    icone: 'Repeat',
  },
  {
    key: 'conexoes',
    rotulo: 'Conexões',
    /*
     * "EM USO" ESTÁ ESCRITO porque o número diz isso e não outra coisa. O
     * catálogo tem linha para todo conector que o produto suporta; o mapa conta
     * só as que ESTA empresa autorizou — sem a palavra, a legenda parecia estar
     * contando o catálogo, e um "3" ao lado de "Conexões" viraria pergunta.
     *
     * `?sondar=0`: abrir o mapa NÃO sonda fornecedor nenhum. Ver `page.tsx`.
     */
    descricao: 'o que alimenta a central — conta só as em uso por esta empresa',
    anguloGraus: 126,
    rota: '/conexoes',
    consulta: '/integrations/catalog?sondar=0',
    permissao: 'dashboard.ver',
    icone: 'Cable',
  },
  {
    key: 'gente',
    rotulo: 'Gente',
    descricao: 'quem responde por cada agente',
    anguloGraus: 198,
    rota: '/organograma',
    consulta: '/organograma',
    permissao: 'dashboard.ver',
    icone: 'Users',
  },
];

/** O descritor de um eixo, pela chave. Quem chama sabe que a chave existe. */
export function familiaPorChave(key: FamiliaKey): DescricaoDeFamilia {
  const f = FAMILIAS.find((x) => x.key === key);
  if (!f) throw new Error(`família desconhecida no mapa: ${key}`);
  return f;
}

export type RegistroDoNo =
  | { familia: 'memoria'; nota: NotaDeContexto }
  | { familia: 'agentes'; agente: AgenteDoMapa }
  | { familia: 'rotinas'; rotina: RotinaDoMapa }
  | { familia: 'conexoes'; conexao: ConexaoDoMapa }
  | { familia: 'gente'; pessoa: PessoaDoMapa };

/**
 * Um registro do mapa, ainda sem lugar no desenho.
 *
 * É o que a gaveta lista quando alguém abre um eixo: ali aparecem TODOS os
 * registros daquele eixo, inclusive os que o teto de desenho deixou de fora.
 */
export interface ItemDoEixo {
  /** Único no mapa inteiro: `nota:<id>`, `agente:<slug>`, `conexao:<key>`… */
  id: string;
  familia: FamiliaKey;
  rotulo: string;
  /** A segunda linha: natureza, estado, papel. O que distingue este ponto. */
  sub: string;
  tom: Tom;
  areas: AreaKey[];
  /** De onde veio a classificação; nulo significa que nada foi declarado. */
  origemDaArea: string | null;
  registro: RegistroDoNo;
}

export interface NoDoMapa extends ItemDoEixo {
  x: number;
  y: number;
}

export interface ArestaDoMapa {
  id: string;
  de: string;
  para: string;
  /**
   * `estrutura` = o desenho do mapa (núcleo → eixo → nó).
   * `relacao`   = vínculo que EXISTE no dado: rotina→agente, agente→dono,
   *               nota→nota que ela substitui. É o que dá sentido ao grafo.
   */
  tipo: 'estrutura' | 'relacao';
}

export type EstadoDoEixo = 'ok' | 'vazio' | 'sem_permissao' | 'erro' | 'carregando';

export interface EixoDoMapa extends DescricaoDeFamilia {
  x: number;
  y: number;
  /** Quantos nós foram desenhados neste eixo. */
  mostrados: number;
  /** O total que A API declarou. `null` quando a fonte não respondeu. */
  total: number | null;
  /** Quantos registros carregados passam pelos filtros locais. */
  totalNoRecorte: number;
  excedente: number;
  estado: EstadoDoEixo;
  erro: string | null;
}

export interface Mapa {
  nucleo: { x: number; y: number; rotulo: string };
  eixos: EixoDoMapa[];
  /** O que foi DESENHADO — o que coube nos quatro anéis de cada eixo. */
  nos: NoDoMapa[];
  /** TUDO que existe, eixo a eixo, inclusive o que não coube. É o que a gaveta lista. */
  catalogo: Record<FamiliaKey, ItemDoEixo[]>;
  arestas: ArestaDoMapa[];
  /** Soma de TUDO que se conhece, inclusive gente. */
  registros: number;
  /**
   * Soma só do que é CONTEXTO CARREGADO — memória, agentes, rotinas, conexões.
   *
   * GENTE NÃO ENTRA, e é esta linha que torna alcançável o estado de empresa
   * vazia. `GET /organograma` devolve, no mínimo, a própria pessoa que está
   * logada: enquanto ela contava, a soma nunca era zero, nenhum tenant real
   * chegava ao caminho de carga e o que a pessoa via no primeiro dia era um
   * mapa com um ponto só — ela mesma. Quem olha a tela não é contexto que a
   * empresa carregou.
   */
  registrosDeContexto: number;
}

/** O que cada fonte devolveu, ou por que não devolveu. */
export interface Fonte<T> {
  dado: T | null;
  erro?: string | null;
  semPermissao?: boolean;
}

export interface FontesDoMapa {
  memoria: Fonte<MemoriaList>;
  agentes: Fonte<RosterDeAgentes>;
  rotinas: Fonte<ListaDeRotinas>;
  conexoes: Fonte<CatalogoDeConexoes>;
  organograma: Fonte<Organograma>;
  /** O nome da empresa no núcleo. Sem nome, o núcleo diz o genérico. */
  empresa?: string | null;
}

/* ------------------------------------------------------------- geometria -- */

function polar(anguloGraus: number, raio: number): { x: number; y: number } {
  const rad = (anguloGraus * Math.PI) / 180;
  return { x: CENTRO.x + Math.cos(rad) * raio, y: CENTRO.y + Math.sin(rad) * raio };
}

/** Quantos nós cabem num anel, dado o comprimento do arco do setor. */
function capacidadeDoAnel(raio: number): number {
  const arco = ((SETOR_GRAUS * Math.PI) / 180) * raio;
  return Math.max(3, Math.floor(arco / ESPACO_MINIMO));
}

/** O teto por eixo: o que os quatro anéis comportam. */
export const TETO_POR_EIXO = ANEIS.reduce((s, r) => s + capacidadeDoAnel(r), 0);

/**
 * O menor vão que o desenho GARANTE entre dois pontos quaisquer.
 *
 * É medido, não declarado por gosto — e a diferença custou uma revisão. O
 * arquivo anunciava 72 como distância mínima, mas 72 é o passo dentro de um
 * anel: entre dois anéis vizinhos o vão é outro, e é ele que manda no pior
 * caso. Aqui os dois entram na conta, e é este número que a suíte cobra. Ele é
 * o vão ENTRE CENTROS: o ponto tem `RAIO_DO_NO` e o rótulo, meia caixa.
 */
export const DISTANCIA_MINIMA_ENTRE_PONTOS = Math.min(
  PASSO_ENTRE_ANEIS,
  ...ANEIS.map(
    (raio) => 2 * raio * Math.sin((SETOR_GRAUS * Math.PI) / 180 / capacidadeDoAnel(raio) / 2),
  ),
);

/**
 * Distribui `quantidade` pontos dentro do setor de um eixo.
 *
 * Anel a anel, e dentro de cada anel espalhados por igual — o meio-passo
 * (`i + 0.5`) existe para que um anel com um ponto só o ponha no eixo do setor,
 * e não na borda dele.
 */
function posicoesDoSetor(anguloGraus: number, quantidade: number): { x: number; y: number }[] {
  const saida: { x: number; y: number }[] = [];
  let restam = quantidade;
  for (const raio of ANEIS) {
    if (restam <= 0) break;
    const neste = Math.min(restam, capacidadeDoAnel(raio));
    const meia = SETOR_GRAUS / 2;
    for (let i = 0; i < neste; i++) {
      const t = (i + 0.5) / neste;
      saida.push(polar(anguloGraus - meia + t * SETOR_GRAUS, raio));
    }
    restam -= neste;
  }
  return saida;
}

/* ------------------------------------------------- normalização por eixo -- */

function tomDaNota(n: NotaDeContexto): Tom {
  if (n.arquivadoEm) return 'muted';
  if (n.kind === 'decisao' || n.kind === 'regra') return 'brand';
  return 'info';
}

/**
 * O tom de um estado DECLARADO — e esta função atende DOIS vocabulários.
 *
 * Desde a fatia A2 o agente tem enum próprio (`planejado`, `ativo`, `pausado`,
 * `encerrado`) e a rotina ficou com o antigo (`rodando`, `aprendendo`,
 * `planejado`, `pausado`). As duas famílias passam por aqui, e é de propósito
 * que a mesma ideia tenha a mesma cor nas duas: `ativo` e `rodando` querem dizer
 * "está em produção", com nomes diferentes porque as duas famílias divergiram.
 */
function tomDoEstado(estado: string): Tom {
  if (estado === 'ativo' || estado === 'rodando') return 'good';
  if (estado === 'aprendendo') return 'brand';
  if (estado === 'pausado') return 'warn';
  // `encerrado`, `planejado` e o que ninguém previu: apagado. Estado
  // desconhecido NUNCA sai verde — cor de "está funcionando" é a única que não
  // se pode dar por omissão.
  return 'muted';
}

/**
 * O tom de uma conexão vem da SAÚDE, não do `status`.
 *
 * `status` é registro de banco e continua dizendo "conectado" depois de o token
 * ter sido revogado do outro lado; saúde é tentativa. É a mesma decisão da tela
 * de Conexões, e o mapa não pode discordar dela — duas telas com selos
 * diferentes sobre o mesmo conector é pior do que não ter selo.
 *
 * NO MAPA A SAÚDE CHEGA SEM MEDIÇÃO (`?sondar=0`), e por isso a conexão fica
 * cinza aqui: verde exigiria uma tentativa, e nesta tela ninguém tentou. Cinza
 * quer dizer "não medido agora", que é a verdade — e a regra continua escrita
 * assim para o dia em que esta tela voltar a receber saúde apurada. Quem quer o
 * selo medido abre Conexões, que é a tela cujo trabalho é medir.
 */
function tomDaConexao(c: ConexaoDoMapa): Tom {
  if (c.desligado) return 'warn';
  const estado = c.saude?.estado;
  if (estado === 'conectado' && c.saude?.apuracao === 'tentativa') return 'good';
  if (estado === 'erro') return 'bad';
  if (estado === 'conectado') return 'warn';
  if (c.status === 'error') return 'bad';
  return 'muted';
}

/** A conexão entra no mapa quando ela é DESTA empresa, não quando existe no catálogo. */
function conexaoEstaEmUso(c: ConexaoDoMapa): boolean {
  if (c.status === 'connected' || c.status === 'error') return true;
  const estado = c.saude?.estado;
  return estado === 'conectado' || estado === 'erro';
}

function notaParaNo(n: NotaDeContexto): ItemDoEixo {
  const areas = areasDaNota(n.tags);
  return {
    id: `nota:${n.id}`,
    familia: 'memoria',
    rotulo: n.title,
    sub: `${rotuloDaNatureza(n.kind)} · ${n.procedencia}`,
    tom: tomDaNota(n),
    areas,
    origemDaArea: areas.length ? `etiquetas ${areas.map((area) => `area:${area}`).join(', ')}` : null,
    registro: { familia: 'memoria', nota: n },
  };
}

function agenteParaNo(a: AgenteDoMapa): ItemDoEixo {
  const rebaixado = a.rebaixadoAte && new Date(a.rebaixadoAte).getTime() > Date.now();
  return {
    id: `agente:${a.slug}`,
    familia: 'agentes',
    rotulo: a.nome,
    sub: rebaixado ? `${a.estado} · autonomia rebaixada` : a.estado,
    tom: rebaixado ? 'warn' : tomDoEstado(a.estado),
    areas: [],
    origemDaArea: null,
    registro: { familia: 'agentes', agente: a },
  };
}

function rotinaParaNo(r: RotinaDoMapa): ItemDoEixo {
  const area = AREA_DO_EXECUTOR[r.tipo];
  return {
    id: `rotina:${r.id}`,
    familia: 'rotinas',
    rotulo: r.nome,
    sub: r.dispara ? `${r.estado} · ${r.cron}` : `${r.estado} · não dispara`,
    tom: r.ultimoStatus === 'erro' ? 'bad' : tomDoEstado(r.estado),
    areas: area ? [area] : [],
    origemDaArea: area ? `tipo do executor: ${r.tipo}` : null,
    registro: { familia: 'rotinas', rotina: r },
  };
}

function conexaoParaNo(c: ConexaoDoMapa): ItemDoEixo {
  const saude = c.saude?.estado ?? 'nao_verificado';
  return {
    id: `conexao:${c.key}`,
    familia: 'conexoes',
    rotulo: c.label,
    sub: c.desligado ? 'desligada por decisão' : saude.replace(/_/g, ' '),
    tom: tomDaConexao(c),
    areas: [],
    origemDaArea: null,
    registro: { familia: 'conexoes', conexao: c },
  };
}

function pessoaParaNo(p: PessoaDoMapa): ItemDoEixo {
  const papeis = p.papeis === null ? 'papel não vem desta fonte' : (p.papeis.join(', ') || 'sem papel declarado');
  return {
    id: `pessoa:${p.id}`,
    familia: 'gente',
    rotulo: p.nome,
    sub: papeis,
    tom: p.ativo === false ? 'muted' : 'info',
    areas: [],
    origemDaArea: null,
    registro: { familia: 'gente', pessoa: p },
  };
}

/** Achata o organograma numa lista de gente, sem repetir quem está em dois pilares. */
export function gentePorPilar(org: Organograma): PessoaDoMapa[] {
  const vistos = new Map<string, PessoaDoMapa>();
  for (const grupo of org.pilares) for (const p of grupo.pessoas) vistos.set(p.id, p);
  for (const p of org.semPilar.pessoas) if (!vistos.has(p.id)) vistos.set(p.id, p);
  return [...vistos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/* ------------------------------------------------------------- montagem -- */

function estadoDoEixo(fonte: Fonte<unknown>, quantidade: number): EstadoDoEixo {
  if (fonte.semPermissao) return 'sem_permissao';
  if (fonte.erro) return 'erro';
  if (!fonte.dado) return 'carregando';
  return quantidade > 0 ? 'ok' : 'vazio';
}

function relacoesPresentes(nos: NoDoMapa[]): ArestaDoMapa[] {
  const existe = new Set(nos.map((no) => no.id));
  const relacoes: ArestaDoMapa[] = [];
  for (const no of nos) {
    if (no.registro.familia === 'agentes' && no.registro.agente.dono) {
      const dono = `pessoa:${no.registro.agente.dono.id}`;
      if (existe.has(dono)) relacoes.push({ id: `r:${no.id}-${dono}`, de: no.id, para: dono, tipo: 'relacao' });
    }
    if (no.registro.familia === 'rotinas' && no.registro.rotina.agenteSlug) {
      const agente = `agente:${no.registro.rotina.agenteSlug}`;
      if (existe.has(agente)) relacoes.push({ id: `r:${no.id}-${agente}`, de: no.id, para: agente, tipo: 'relacao' });
    }
    if (no.registro.familia === 'memoria' && no.registro.nota.supersedesId) {
      const anterior = `nota:${no.registro.nota.supersedesId}`;
      if (existe.has(anterior)) relacoes.push({ id: `r:${no.id}-${anterior}`, de: no.id, para: anterior, tipo: 'relacao' });
    }
  }
  return relacoes;
}

/**
 * Monta o mapa inteiro a partir do que as cinco rotas devolveram.
 *
 * A ORDEM DENTRO DE CADA EIXO É, LITERALMENTE, A DA API — nenhum critério é
 * acrescentado aqui. Reordenar por conta própria faria a tela discordar da
 * lista que a pessoa vê em `/agentes` e em `/rotinas`, e é justamente o eixo do
 * meio do anel que ela lembra de cor depois da terceira apresentação. A única
 * exceção é `gentePorPilar`, que ordena por nome porque a fonte vem agrupada
 * por pilar e não tem ordem própria a respeitar.
 */
export function montarMapa(fontes: FontesDoMapa): Mapa {
  const porFamilia: Record<FamiliaKey, ItemDoEixo[]> = {
    memoria: (fontes.memoria.dado?.itens ?? []).map(notaParaNo),
    agentes: (fontes.agentes.dado?.items ?? []).map(agenteParaNo),
    rotinas: (fontes.rotinas.dado?.items ?? []).map(rotinaParaNo),
    conexoes: (fontes.conexoes.dado?.items ?? []).filter(conexaoEstaEmUso).map(conexaoParaNo),
    gente: fontes.organograma.dado ? gentePorPilar(fontes.organograma.dado).map(pessoaParaNo) : [],
  };

  /*
   * O TOTAL DE CADA EIXO VEM DA API, e não de `length` deste lado.
   *
   * A memória declara `total`; o organograma declara `totais.pessoas`. Onde a
   * rota não declara total, o total É o tamanho da lista que ela acabou de
   * devolver — que é a mesma coleção desenhada, e portanto não tem como
   * divergir do que está na tela. O que NÃO se faz aqui é recontar depois de
   * filtrar: o eixo de conexões mostra quantas estão em uso e diz isso, em vez
   * de anunciar o catálogo inteiro como se fosse desta empresa.
   */
  const totais: Record<FamiliaKey, number | null> = {
    memoria: fontes.memoria.dado ? fontes.memoria.dado.total : null,
    agentes: fontes.agentes.dado ? fontes.agentes.dado.items.length : null,
    rotinas: fontes.rotinas.dado ? fontes.rotinas.dado.items.length : null,
    conexoes: fontes.conexoes.dado ? porFamilia.conexoes.length : null,
    gente: fontes.organograma.dado ? fontes.organograma.dado.totais.pessoas : null,
  };

  const fontePor: Record<FamiliaKey, Fonte<unknown>> = {
    memoria: fontes.memoria,
    agentes: fontes.agentes,
    rotinas: fontes.rotinas,
    conexoes: fontes.conexoes,
    gente: fontes.organograma,
  };

  const nos: NoDoMapa[] = [];
  const arestas: ArestaDoMapa[] = [];
  const eixos: EixoDoMapa[] = [];

  for (const familia of FAMILIAS) {
    const candidatos = porFamilia[familia.key];
    const desenhados = candidatos.slice(0, TETO_POR_EIXO);
    const excedente = Math.max(candidatos.length - desenhados.length, 0);
    const posicoes = posicoesDoSetor(familia.anguloGraus, desenhados.length);
    const eixo = polar(familia.anguloGraus, RAIO_DA_FAMILIA);

    eixos.push({
      ...familia,
      x: eixo.x,
      y: eixo.y,
      mostrados: desenhados.length,
      total: totais[familia.key],
      totalNoRecorte: candidatos.length,
      excedente,
      estado: estadoDoEixo(fontePor[familia.key], candidatos.length),
      erro: fontePor[familia.key].erro ?? null,
    });

    arestas.push({ id: `e:nucleo-${familia.key}`, de: 'nucleo', para: `eixo:${familia.key}`, tipo: 'estrutura' });

    desenhados.forEach((no, i) => {
      nos.push({ ...no, x: posicoes[i].x, y: posicoes[i].y });
      arestas.push({ id: `e:${familia.key}-${no.id}`, de: `eixo:${familia.key}`, para: no.id, tipo: 'estrutura' });
    });
  }

  /*
   * AS ARESTAS DE RELAÇÃO — as três que EXISTEM no dado, e só elas.
   *
   * Não se deduz vínculo aqui. Ligar nota a conector por causa do prefixo da
   * procedência, ou agente a conexão por causa do nome da capacidade, seria
   * desenhar uma relação que ninguém declarou — e num mapa a linha entre dois
   * pontos é lida como fato.
   */
  arestas.push(...relacoesPresentes(nos));

  const registros = FAMILIAS.reduce((s, f) => s + porFamilia[f.key].length, 0);
  const registrosDeContexto = EIXOS_DE_CONTEXTO.reduce((s, k) => s + porFamilia[k].length, 0);

  return {
    nucleo: { x: CENTRO.x, y: CENTRO.y, rotulo: fontes.empresa?.trim() || 'A empresa' },
    eixos,
    nos,
    catalogo: porFamilia,
    arestas,
    registros,
    registrosDeContexto,
  };
}

export interface RecorteDoMapa {
  area: FiltroDeArea;
  familia: FamiliaKey | '';
  busca: string;
  idsDaBusca?: ReadonlySet<string> | null;
}

function normalizarBusca(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

/** Reposiciona só os registros do recorte; IDs, fontes e estados ficam intactos. */
export function recortarMapa(base: Mapa, filtro: RecorteDoMapa): Mapa {
  if (!filtro.area && !filtro.familia && !filtro.busca.trim()) return base;
  const busca = normalizarBusca(filtro.busca.trim());
  const catalogo = {} as Record<FamiliaKey, ItemDoEixo[]>;
  const eixos: EixoDoMapa[] = [];
  const nos: NoDoMapa[] = [];
  const arestas: ArestaDoMapa[] = [];

  for (const eixo of base.eixos) {
    const itens = base.catalogo[eixo.key].filter((item) =>
      (!filtro.familia || item.familia === filtro.familia) &&
      (!filtro.area || (filtro.area === 'sem-area' ? item.areas.length === 0 : item.areas.includes(filtro.area))) &&
      (!busca || normalizarBusca(`${item.rotulo} ${item.sub}`).includes(busca) || !!filtro.idsDaBusca?.has(item.id)));
    catalogo[eixo.key] = itens;
    const desenhados = itens.slice(0, TETO_POR_EIXO);
    const posicoes = posicoesDoSetor(eixo.anguloGraus, desenhados.length);
    eixos.push({ ...eixo, mostrados: desenhados.length, totalNoRecorte: itens.length,
      excedente: Math.max(itens.length - desenhados.length, 0) });
    arestas.push({ id: `e:nucleo-${eixo.key}`, de: 'nucleo', para: `eixo:${eixo.key}`, tipo: 'estrutura' });
    desenhados.forEach((item, i) => {
      nos.push({ ...item, x: posicoes[i].x, y: posicoes[i].y });
      arestas.push({ id: `e:${eixo.key}-${item.id}`, de: `eixo:${eixo.key}`, para: item.id, tipo: 'estrutura' });
    });
  }
  arestas.push(...relacoesPresentes(nos));
  return { ...base, eixos, nos, catalogo, arestas,
    registros: FAMILIAS.reduce((total, familia) => total + catalogo[familia.key].length, 0),
    registrosDeContexto: EIXOS_DE_CONTEXTO.reduce((total, key) => total + catalogo[key].length, 0) };
}

/**
 * OS EIXOS QUE RESPONDEM PELA PERGUNTA "esta empresa carregou contexto?".
 *
 * Gente está fora de propósito. `GET /organograma` devolve sempre, no mínimo,
 * quem está logado: com gente na conta, a soma nunca dá zero, e o estado de
 * empresa vazia — que é justamente o que esta tela precisa mostrar bem no
 * primeiro dia — vira inalcançável em produção. Pessoa que abre a tela não é
 * contexto carregado.
 */
export const EIXOS_DE_CONTEXTO: ReadonlyArray<FamiliaKey> = [
  'memoria',
  'agentes',
  'rotinas',
  'conexoes',
];

/**
 * O que a tela pode AFIRMAR sobre a empresa.
 *
 * `carregando`    — alguma fonte ainda não voltou. Não se afirma nada.
 * `com_contexto`  — há registro carregado; desenha o mapa.
 * `desconhecida`  — ninguém conseguiu olhar algum eixo (erro ou sem permissão)
 *                   e o resto está vazio. NÃO é vazio: é não sei.
 * `vazia`         — os quatro eixos de contexto foram consultados, responderam,
 *                   e todos vieram sem nada.
 *
 * A REGRA DURA: vazio exige que NENHUM dos eixos que contam esteja em erro, sem
 * permissão ou carregando. A versão anterior pedia só que ALGUÉM tivesse
 * olhado, e com isso um eixo vazio no meio de quatro em erro — ou de quatro sem
 * permissão — fazia a manchete anunciar que não havia o que desenhar sobre uma
 * empresa que podia ter vinte agentes e oito conexões. Um 500 numa rota, ou um
 * papel sem uma permissão, produzia exatamente essa frase.
 */
export type EstadoDaEmpresa = 'carregando' | 'com_contexto' | 'desconhecida' | 'vazia';

export function estadoDaEmpresa(mapa: Mapa): EstadoDaEmpresa {
  const contam = mapa.eixos.filter((e) => EIXOS_DE_CONTEXTO.includes(e.key));
  if (contam.some((e) => e.estado === 'ok')) return 'com_contexto';
  if (contam.some((e) => e.estado === 'carregando')) return 'carregando';
  if (contam.some((e) => e.estado === 'erro' || e.estado === 'sem_permissao')) return 'desconhecida';
  return 'vazia';
}

/** Os eixos de contexto que ninguém conseguiu ver — o que a tela precisa CONFESSAR. */
export function eixosIncertos(mapa: Mapa): EixoDoMapa[] {
  return mapa.eixos.filter(
    (e) =>
      EIXOS_DE_CONTEXTO.includes(e.key) && (e.estado === 'erro' || e.estado === 'sem_permissao'),
  );
}

/**
 * Onde fica o "+N" de um eixo: entre o eixo e o primeiro anel.
 *
 * Do lado de fora do último anel ele sairia do quadro; aqui ele lê como o que é
 * — uma nota do eixo, não mais um registro.
 */
export function posicaoDoExcedente(anguloGraus: number): { x: number; y: number } {
  return polar(anguloGraus, RAIO_DA_FAMILIA + 48);
}

/** O caminho do traço entre dois pontos. Reta para estrutura, arco para relação. */
export function traco(
  de: { x: number; y: number },
  para: { x: number; y: number },
  tipo: 'estrutura' | 'relacao',
): string {
  if (tipo === 'estrutura') return `M ${de.x} ${de.y} L ${para.x} ${para.y}`;
  const dx = para.x - de.x;
  const dy = para.y - de.y;
  const raio = Math.hypot(dx, dy) * 1.15;
  return `M ${de.x} ${de.y} A ${raio} ${raio} 0 0 1 ${para.x} ${para.y}`;
}
