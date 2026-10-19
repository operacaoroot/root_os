import { z } from 'zod';

/*
 * A SALA PUBLICADA POR VERSÃO (rodada da implantação I3, 18/10/2026).
 *
 * A bancada monta o RASCUNHO da sala do cliente; publicar é a capacidade
 * `comercial.sala.publicar` (R3) pela porta, e uma segunda pessoa libera em
 * /atendimento. O cliente, no link `/s/<token>`, lê só a ÚLTIMA versão
 * publicada: o rascunho nunca sai da bancada.
 *
 * O que a versão congela (prancheta 2 do mockup aprovado): o nome da sala,
 * "Onde estamos" (as cinco estações, com data só nas feitas), "Próximos passos"
 * (o quê, quando, com quem), "Publicado para você" (proposta, contrato, roteiro
 * do kickoff, kit), "O combinado" e "quem cuida da conta". As estações e os
 * publicados são DERIVADOS do fio e do trilho na hora de publicar, nunca
 * digitados; os passos, o combinado e quem cuida são escritos pela bancada.
 *
 * O link de cada publicado NÃO entra na versão: o token da sala só existe em
 * hash no banco, e a página do cliente monta o endereço com o token que ela já
 * tem. A versão diz o quê e em que estado.
 */

export const SALA_ESTACOES = ['conversa', 'acordo', 'kickoff', 'contexto', 'frente'] as const;
export type SalaEstacao = (typeof SALA_ESTACOES)[number];
export const SALA_ROTULO_DA_ESTACAO: Record<SalaEstacao, string> = {
  conversa: 'Conversa',
  acordo: 'Acordo',
  kickoff: 'Kickoff',
  contexto: 'Contexto',
  frente: 'Frente rodando',
};

export interface EstacaoDaSalaPublicada {
  chave: SalaEstacao;
  rotulo: string;
  estado: 'feita' | 'atual' | 'futura';
  /** Só nas feitas, e só de fonte com data (fato do fio, marco do trilho, horário gravado). */
  em: string | null;
}

export interface PassoDaSalaPublicada {
  oque: string;
  /** AAAA-MM-DD. */
  quando: string;
  comQuem: string;
}

export const SALA_TIPOS_DE_PUBLICADO = ['proposta', 'contrato', 'roteiro', 'kit'] as const;
export type SalaTipoDePublicado = (typeof SALA_TIPOS_DE_PUBLICADO)[number];

export interface PublicadoNaSalaVersao {
  tipo: SalaTipoDePublicado;
  titulo: string;
  /** O estado em palavras ("publicada v2 · aceita", "aguardando a sua assinatura"...). */
  estado: string;
  /** Falso = aparece esmaecido ("chega após o kickoff"). */
  disponivel: boolean;
}

export interface ConteudoDaSalaPublicada {
  nome: string;
  estacoes: EstacaoDaSalaPublicada[];
  proximosPassos: PassoDaSalaPublicada[];
  publicados: PublicadoNaSalaVersao[];
  combinado: string[];
  quemCuida: { nome: string; papel: string } | null;
  /** O número da Root é decisão pendente da mesa: até lá a sala mostra o marcador. */
  whatsapp: { numero: string | null; rotulo: string };
}

/** O que o cliente recebe no `GET /sala/:token`: a última publicada, nunca o rascunho. */
export interface SalaVersaoPublica {
  versao: number;
  publicadaEm: string;
  conteudo: ConteudoDaSalaPublicada;
}

export const SALA_ESTADOS_DA_VERSAO = ['rascunho', 'na_porta', 'publicada', 'substituida'] as const;
export type SalaEstadoDaVersao = (typeof SALA_ESTADOS_DA_VERSAO)[number];

/** A bancada: o rascunho (com o conteúdo como sairia agora), a publicada e o histórico. */
export interface VersoesDaSala {
  leadId: string;
  rascunho: {
    versao: number;
    estado: 'rascunho' | 'na_porta' | 'novo';
    conteudo: ConteudoDaSalaPublicada;
    hash: string;
    approvalId: string | null;
    atualizadoEm: string | null;
  };
  publicada: (SalaVersaoPublica & { hash: string; publicadaPor: string | null }) | null;
  historico: { versao: number; estado: SalaEstadoDaVersao; publicadaEm: string | null; hash: string }[];
  /** A sala existe? Sem ela não há link para publicar. */
  temSala: boolean;
}

/** O número da Root ainda não foi decidido pela mesa (RODADA-IMPLANTACAO: "O que esta rodada NÃO decide"). */
export const SALA_WHATSAPP_PLACEHOLDER = '[NÚMERO DA ROOT]';

/**
 * O combinado do mockup aprovado. Resposta e horários vieram do desenho; o que
 * o mockup só nomeia ("Claude do 1º mês") fica com a lacuna à vista até a mesa
 * escrever, e a bancada edita antes de publicar.
 */
export const SALA_COMBINADO_PADRAO: readonly string[] = [
  'Resposta em até 4 horas úteis',
  'Retornos às 08:30, 13:00 e 18:00',
  'Claude do 1º mês: [a decidir pela mesa]',
];

const texto = (max: number) => z.string().trim().min(1).max(max);

export const SalaRascunhoSchema = z.object({
  nome: texto(80).optional(),
  proximosPassos: z.array(z.object({
    oque: texto(140),
    quando: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD'),
    comQuem: texto(60),
  }).strict()).max(8),
  combinado: z.array(texto(160)).max(6),
  quemCuida: z.object({ nome: texto(80), papel: z.string().trim().max(80) }).strict().nullable(),
}).strict();
export type SalaRascunhoInput = z.infer<typeof SalaRascunhoSchema>;
