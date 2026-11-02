import { z } from 'zod';

/*
 * A ÁREA DO CLIENTE (leva A, 30/10/2026) — a parte que o código precisa.
 *
 * A área do cliente é a Sala do Cliente (`/s/<token>`) depois do negócio
 * fechado: o mesmo link muda de modo e mostra QUATRO BLOCOS com os QUINZE
 * itens do painel do Fluxo do cliente v6. O desenho inteiro (fonte no OS de
 * cada item, levas, decisões abertas) mora em
 * `apps/api/src/platform/area-do-cliente.json`, lido em Contexto › Área do
 * cliente. Este arquivo é a fonte do CÓDIGO: os ids, os blocos, as fases do
 * fluxo e os tipos que a API, a página do cliente e a bancada compartilham.
 * Um teste da API confere que os ids daqui e os do JSON são os mesmos.
 *
 * Três regras que valem em todo item:
 *   · o que o OS já sabe chega sozinho (`derivado`) e nunca é digitado;
 *   · o que a Root escreve passa pela porta (R3, a MESMA capacidade da sala,
 *     `comercial.sala.publicar`) antes de o cliente ver;
 *   · o que não chegou aparece como vazio, dizendo em que fase do fluxo chega.
 *
 * O link do documento NÃO entra no texto: o item referencia o arquivo pelo id
 * (`ArquivoDoCliente`), e a página monta o caminho que o cliente pode abrir.
 */

// ---------------------------------------------------------------------------
// Blocos e fases
// ---------------------------------------------------------------------------

export const AREA_BLOCOS = ['onde-estamos', 'o-combinado', 'como-usar', 'novidades'] as const;
export type AreaBloco = (typeof AREA_BLOCOS)[number];

export const AREA_ROTULO_DO_BLOCO: Record<AreaBloco, { nome: string; paraOCliente: string }> = {
  'onde-estamos': { nome: 'Onde estamos', paraOCliente: 'O que está sendo feito, quando nos encontramos e o que ficou combinado em cada reunião.' },
  'o-combinado': { nome: 'O combinado', paraOCliente: 'Os documentos que valem: contrato, escopo, PRD e arquitetura. Versão vigente e o que mudou.' },
  'como-usar': { nome: 'Como usar', paraOCliente: 'Acessos, cofre, glossário, vídeos e o caminho para tirar dúvida, no celular.' },
  novidades: { nome: 'Novidades da Root', paraOCliente: 'O que mudou na plataforma e o que chega em breve.' },
};

/** As sete fases do Fluxo do cliente v6, no nome curto que o cliente lê. */
export const AREA_FASES_DO_FLUXO = [
  { id: 'fase-1', numero: 1, nome: 'Fechamento' },
  { id: 'fase-2', numero: 2, nome: 'Abertura' },
  { id: 'fase-3', numero: 3, nome: 'Primeira semana' },
  { id: 'fase-4', numero: 4, nome: 'Construção' },
  { id: 'fase-5', numero: 5, nome: 'Acompanhamento' },
  { id: 'fase-6', numero: 6, nome: 'Satisfação e indicação' },
  { id: 'fase-7', numero: 7, nome: 'Continuidade ou fim' },
] as const;
export type AreaFaseId = (typeof AREA_FASES_DO_FLUXO)[number]['id'];

export function faseDoFluxoPorId(id: AreaFaseId): (typeof AREA_FASES_DO_FLUXO)[number] {
  return AREA_FASES_DO_FLUXO.find((f) => f.id === id) ?? AREA_FASES_DO_FLUXO[0];
}

// ---------------------------------------------------------------------------
// Os quinze itens
// ---------------------------------------------------------------------------

/** `derivado`: o OS monta sozinho. `escrito`: a Root escreve e publica. `misto`: os dois. */
export type AreaComoChega = 'derivado' | 'escrito' | 'misto';

export interface DefinicaoDoItemDaArea {
  id: string;
  bloco: AreaBloco;
  /** O título que o cliente lê. */
  titulo: string;
  /** A tarefa do Fluxo v6 que alimenta o item; nula nos dois que ainda não têm tarefa (decisão D5). */
  tarefaDoFluxo: string | null;
  entraNaFase: AreaFaseId;
  comoChega: AreaComoChega;
}

/** Na ordem em que aparecem na tela, bloco a bloco. */
export const AREA_ITENS = [
  // Onde estamos
  { id: 'cronograma', bloco: 'onde-estamos', titulo: 'Cronograma', tarefaDoFluxo: '09', entraNaFase: 'fase-2', comoChega: 'misto' },
  { id: 'linha-de-execucao', bloco: 'onde-estamos', titulo: 'Linha de execução', tarefaDoFluxo: '10', entraNaFase: 'fase-2', comoChega: 'derivado' },
  { id: 'agenda', bloco: 'onde-estamos', titulo: 'Agenda das reuniões', tarefaDoFluxo: '14', entraNaFase: 'fase-2', comoChega: 'derivado' },
  { id: 'atas', bloco: 'onde-estamos', titulo: 'Atas', tarefaDoFluxo: '18', entraNaFase: 'fase-3', comoChega: 'misto' },
  // O combinado
  { id: 'contrato', bloco: 'o-combinado', titulo: 'Contrato', tarefaDoFluxo: '01', entraNaFase: 'fase-1', comoChega: 'derivado' },
  { id: 'escopo', bloco: 'o-combinado', titulo: 'Escopo', tarefaDoFluxo: '01', entraNaFase: 'fase-1', comoChega: 'derivado' },
  { id: 'prd', bloco: 'o-combinado', titulo: 'PRD', tarefaDoFluxo: '21', entraNaFase: 'fase-3', comoChega: 'escrito' },
  { id: 'arquitetura', bloco: 'o-combinado', titulo: 'Arquitetura e tecnologia', tarefaDoFluxo: '21', entraNaFase: 'fase-3', comoChega: 'escrito' },
  // Como usar
  { id: 'instrucoes-de-acesso', bloco: 'como-usar', titulo: 'Instruções de acesso e de uso', tarefaDoFluxo: '11', entraNaFase: 'fase-2', comoChega: 'escrito' },
  { id: 'cofre', bloco: 'como-usar', titulo: 'Cofre de acessos', tarefaDoFluxo: '20', entraNaFase: 'fase-3', comoChega: 'misto' },
  { id: 'central-glossario', bloco: 'como-usar', titulo: 'Glossário e central de dúvidas', tarefaDoFluxo: '12', entraNaFase: 'fase-2', comoChega: 'misto' },
  { id: 'videos', bloco: 'como-usar', titulo: 'Vídeos de treinamento', tarefaDoFluxo: '22', entraNaFase: 'fase-3', comoChega: 'escrito' },
  { id: 'manutencao', bloco: 'como-usar', titulo: 'Instruções de manutenção', tarefaDoFluxo: null, entraNaFase: 'fase-4', comoChega: 'escrito' },
  { id: 'duvidas', bloco: 'como-usar', titulo: 'Tirar uma dúvida', tarefaDoFluxo: '22', entraNaFase: 'fase-2', comoChega: 'derivado' },
  // Novidades
  { id: 'novidades', bloco: 'novidades', titulo: 'Novidades da Root', tarefaDoFluxo: null, entraNaFase: 'fase-5', comoChega: 'escrito' },
] as const satisfies readonly DefinicaoDoItemDaArea[];

export type AreaItemId = (typeof AREA_ITENS)[number]['id'];
export const AREA_IDS_DOS_ITENS = AREA_ITENS.map((i) => i.id) as readonly AreaItemId[];
export const AREA_TOTAL_DE_ITENS = AREA_ITENS.length;

export function ehItemDaArea(v: unknown): v is AreaItemId {
  return typeof v === 'string' && (AREA_IDS_DOS_ITENS as readonly string[]).includes(v);
}

export function itemDaArea(id: AreaItemId): DefinicaoDoItemDaArea {
  return AREA_ITENS.find((i) => i.id === id)!;
}

/** Os itens que a Root escreve (os `derivado` não têm rascunho: o OS monta sozinho). */
export const AREA_ITENS_ESCRITOS = AREA_ITENS.filter((i) => i.comoChega !== 'derivado').map((i) => i.id) as readonly AreaItemId[];

export function itemTemRascunho(id: AreaItemId): boolean {
  return (AREA_ITENS_ESCRITOS as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 * O estado de um item. Para o cliente só existem `vazio` e `publicado` (com o
 * selo "novo" até abrir). A bancada vê os outros quatro: `derivado` (o OS
 * montou e já aparece), `rascunho`, `na_porta` (esperando a segunda pessoa) e
 * `lido` (o cliente abriu; a data fica na bancada, nunca no link: decisão D6).
 */
export const AREA_ESTADOS_DO_ITEM = ['vazio', 'derivado', 'rascunho', 'na_porta', 'publicado', 'lido'] as const;
export type AreaEstadoDoItem = (typeof AREA_ESTADOS_DO_ITEM)[number];

export const AREA_ROTULO_DO_ESTADO: Record<AreaEstadoDoItem, string> = {
  vazio: 'ainda não chegou',
  derivado: 'o OS montou sozinho',
  rascunho: 'rascunho',
  na_porta: 'aguardando liberação',
  publicado: 'no ar',
  lido: 'lido',
};

// ---------------------------------------------------------------------------
// O que a Root escreve num item (o rascunho) e o que fica guardado na versão
// ---------------------------------------------------------------------------

const texto = (max: number) => z.string().trim().min(1).max(max);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const LINK = /https?:\/\/|www\./i;

const semLink = (v: unknown): boolean => {
  if (typeof v === 'string') return !LINK.test(v);
  if (Array.isArray(v)) return v.every(semLink);
  return true;
};

/**
 * O rascunho de um item: um resumo (a linha do slot), o texto, tópicos (os
 * passos, as entradas do glossário, os combinados), a data a que o item se
 * refere, o documento referenciado pelo id e o que mudou nesta versão.
 * Link em claro não entra em campo nenhum: o documento vai como arquivo do
 * cliente, e a área monta o caminho que ele pode abrir.
 */
export const AreaItemRascunhoSchema = z
  .object({
    resumo: texto(400).optional(),
    texto: z.string().trim().max(4000).optional(),
    topicos: z.array(texto(200)).max(20).optional(),
    /** AAAA-MM-DD: a data da ata, da reunião, da entrega. */
    quando: z.string().regex(DATA, 'data no formato AAAA-MM-DD').nullable().optional(),
    /** O `ArquivoDoCliente` que o item referencia (o PDF do PRD, da ata inteira). */
    documentoId: z.string().uuid().nullable().optional(),
    oQueMudou: texto(300).optional(),
  })
  .strict()
  .refine((r) => Boolean(r.resumo || (r.texto && r.texto.trim()) || (r.topicos && r.topicos.length) || r.documentoId), {
    message: 'escreva ao menos o resumo, o texto, um tópico ou referencie um documento',
  })
  .refine((r) => semLink(r.resumo) && semLink(r.texto) && semLink(r.topicos) && semLink(r.oQueMudou), {
    message: 'link em claro não entra na área: anexe o documento ao cliente e referencie pelo id',
  });
export type AreaItemRascunhoInput = z.infer<typeof AreaItemRascunhoSchema>;

/** O que `SalaVersao.conteudo` guarda numa versão de item: o id do item e o escrito. */
export type ConteudoGuardadoDoItemDaArea = AreaItemRascunhoInput & { item: AreaItemId };

export function ehConteudoDeItem(c: unknown): c is ConteudoGuardadoDoItemDaArea {
  return Boolean(c && typeof c === 'object' && ehItemDaArea((c as { item?: unknown }).item));
}

// ---------------------------------------------------------------------------
// O que o cliente recebe no `GET /sala/:token` em modo área
// ---------------------------------------------------------------------------

export interface ConteudoDoItemParaOCliente {
  resumo: string | null;
  texto: string | null;
  topicos: string[];
  /** AAAA-MM-DD ou ISO, conforme a fonte. */
  quando: string | null;
  /** O documento referenciado, quando há; `link` só quando o cliente pode abrir agora. */
  documento: { titulo: string; link: string | null } | null;
  oQueMudou: string | null;
}

export interface ItemDaAreaParaOCliente {
  id: AreaItemId;
  bloco: AreaBloco;
  titulo: string;
  estado: 'vazio' | 'publicado';
  /** Em que fase do fluxo o item chega (o vazio diz; o publicado informa). */
  chegaNaFase: { id: AreaFaseId; numero: number; nome: string };
  /** `derivado` = o OS montou do que já sabe; `publicado` = versão escrita pela Root. Nulo no vazio. */
  origem: 'derivado' | 'publicado' | null;
  /** O número da versão na sala (o que a leitura grava) e a edição do item (1ª, 2ª...). Nulos no derivado e no vazio. */
  versao: number | null;
  edicao: number | null;
  publicadoEm: string | null;
  /** Publicado e ainda não aberto pelo cliente. */
  novo: boolean;
  conteudo: ConteudoDoItemParaOCliente | null;
  /** Um caminho que o cliente pode abrir: a página da proposta (relativo ao token) ou um link externo dele. */
  abre: { tipo: 'proposta' } | { tipo: 'externo'; url: string } | null;
}

export interface BlocoDaAreaParaOCliente {
  id: AreaBloco;
  nome: string;
  paraOCliente: string;
  itens: ItemDaAreaParaOCliente[];
}

export interface FaseDaAreaParaOCliente {
  id: AreaFaseId;
  numero: number;
  nome: string;
  estado: 'feita' | 'atual' | 'futura';
}

export interface AreaDoClienteParaOCliente {
  empresa: string;
  /** A última publicação de item, ou nula (a área acabou de abrir). */
  atualizadoEm: string | null;
  /** Itens preenchidos (publicados ou derivados) de quinze. */
  noAr: number;
  total: number;
  fase: { atual: AreaFaseId; fases: FaseDaAreaParaOCliente[] };
  blocos: BlocoDaAreaParaOCliente[];
  quemCuida: { nome: string; papel: string } | null;
}

/** O que o cliente manda ao abrir um item publicado: a leitura daquela versão. */
export const AreaLeituraSchema = z
  .object({
    item: z.string().refine(ehItemDaArea, 'item desconhecido'),
    versao: z.number().int().min(1),
  })
  .strict();
export type AreaLeituraInput = z.infer<typeof AreaLeituraSchema>;

// ---------------------------------------------------------------------------
// A bancada (aba "Área do cliente" no painel do lead)
// ---------------------------------------------------------------------------

export type AcaoDoItemNaBancada = 'escrever' | 'publicar' | 'nada';

export interface ItemDaAreaNaBancada {
  id: AreaItemId;
  bloco: AreaBloco;
  titulo: string;
  tarefaDoFluxo: string | null;
  entraNaFase: { id: AreaFaseId; numero: number; nome: string };
  comoChega: AreaComoChega;
  estado: AreaEstadoDoItem;
  /** De onde o item vem no OS hoje (o texto do desenho). */
  fonte: string;
  publicada: { versao: number; edicao: number; publicadaEm: string; publicadaPor: string | null; hash: string } | null;
  aberta: { versao: number; estado: 'rascunho' | 'na_porta'; approvalId: string | null; atualizadoEm: string } | null;
  /** Quando o cliente abriu a versão publicada (só a bancada vê). */
  lidoEm: string | null;
  acao: AcaoDoItemNaBancada;
  /** Uma linha que explica o estado ("o OS monta sozinho: vem do contrato assinado"). */
  nota: string | null;
}

export interface AreaDoClienteNaBancada {
  leadId: string;
  temSala: boolean;
  /** `sala` enquanto o lead está no comercial; `area` depois do fechamento (ou do card na Onboarding). */
  modo: 'sala' | 'area';
  noAr: number;
  total: number;
  itens: ItemDaAreaNaBancada[];
}

/** O rascunho, a publicada e o histórico de UM item (a bancada edita por aqui). */
export interface VersoesDoItemDaArea {
  leadId: string;
  item: AreaItemId;
  rascunho: {
    versao: number;
    estado: 'rascunho' | 'na_porta' | 'novo';
    escrito: AreaItemRascunhoInput | null;
    hash: string | null;
    approvalId: string | null;
    atualizadoEm: string | null;
  };
  publicada: { versao: number; edicao: number; publicadaEm: string; escrito: AreaItemRascunhoInput; hash: string; publicadaPor: string | null } | null;
  historico: { versao: number; edicao: number; estado: 'publicada' | 'substituida'; publicadaEm: string | null; hash: string }[];
  temSala: boolean;
}

export const AREA_AJUDA_DA_BANCADA =
  'A área do cliente é a sala depois do fechamento: o mesmo link passa a mostrar os quatro blocos. ' +
  'O que o OS já sabe entra sozinho. O que você escreve aqui só aparece para o cliente depois que outra pessoa liberar em Aprovações.';
