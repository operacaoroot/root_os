import { z } from 'zod';

import type { SubpastaDoCliente } from './pasta-do-cliente.js';

/*
 * OS AGENTES DO COMERCIAL DA RODADA DE 21/10/2026 (lane A2): o que a tela e a
 * API leem do mesmo jeito.
 *
 *   · CO-11 Vigia das 08h: o resumo de três linhas no topo da passagem;
 *   · CO-10 Fechador e as duas portas do card: a pasta do cliente na ficha;
 *   · CO-13 Construtor e CO-14 Revisor do contrato da Root: a minuta e o laudo;
 *   · CO-15 Formulário do site: o schema do corpo público e as origens do CORS;
 *   · CO-16 Triagem do WhatsApp: as cinco classes e o limiar de confiança.
 *
 * Nada aqui fala com banco nem com modelo.
 */

// ---------------------------------------------------------------------------
// CO-11 · o resumo do vigia
// ---------------------------------------------------------------------------

/**
 * As três linhas do topo da passagem do vigia. `origem`: `modelo` (as três do
 * modelo passaram na conferência dos números), `sistema` (nenhuma passou, ou o
 * modelo não respondeu) ou `misto` (uma linha do modelo trocada pela do sistema).
 * Os números são SEMPRE os do sistema: linha do modelo com número que não bate
 * sai, e o aviso diz qual.
 */
export interface ResumoDoVigia {
  linhas: string[];
  origem: 'modelo' | 'sistema' | 'misto';
  avisos: string[];
}

// ---------------------------------------------------------------------------
// A pasta do cliente na ficha do comercial (CO-10)
// ---------------------------------------------------------------------------

/** O ponteiro da pasta (`Partner.pastaDrive*`) como a ficha do lead o mostra. */
export interface PastaDoClienteNaFicha {
  partnerId: string | null;
  url: string | null;
  erro: string | null;
}

/** O resultado da porta da pasta como a tela o recebe (o mesmo `ResultadoDaPasta` da API, achatado). */
export interface PastaPedidaNaTela {
  estado: 'pronta' | 'aguardando_aprovacao' | 'sem_raiz' | 'erro' | 'sem_porta';
  url?: string | null;
  motivo?: string | null;
  approvalId?: string | null;
}

// ---------------------------------------------------------------------------
// CO-13 e CO-14 · o contrato da Root
// ---------------------------------------------------------------------------

/** A nota da memória com o NOME do arquivo do modelo (primeira linha) e, opcional, o id da pasta (segunda). */
export const NOTA_DO_MODELO_DE_CONTRATO = 'comercial.contrato.modelo';
/** Onde o modelo mora no Drive da Root. */
export const PASTA_DOS_MODELOS_DE_CONTRATO = '70-modelos/contratos';
/** A recusa sem o modelo cadastrado, com a frase exata do roteiro. */
export const RECUSA_SEM_MODELO_DE_CONTRATO = '[a decidir] O modelo de contrato da Root ainda não foi cadastrado';
/** A subpasta da pasta do cliente que recebe a minuta e o contrato assinado. */
export const SUBPASTA_DO_CONTRATO: SubpastaDoCliente = '02-contrato';

/** As duas marcas da minuta: o que o sistema inseriu e o que falta. A tela pinta cada uma. */
export const MARCA_DE_INSERIDO = '⟦inserido: ';
export const MARCA_DE_LACUNA = '⟦lacuna: ';
export const FECHA_MARCA = '⟧';

/** Um trecho da minuta para a tela: texto do modelo, inserção ou lacuna (sem HTML). */
export interface TrechoDaMinuta {
  tipo: 'texto' | 'inserido' | 'lacuna';
  texto: string;
}

/** Corta a minuta nos trechos que a tela pinta (puro; a API e a tela leem a mesma regra). */
export function trechosDaMinuta(conteudo: string): TrechoDaMinuta[] {
  const saida: TrechoDaMinuta[] = [];
  const re = /⟦(inserido|lacuna): ([^⟧]*)⟧/g;
  let i = 0;
  for (let m = re.exec(conteudo); m; m = re.exec(conteudo)) {
    if (m.index > i) saida.push({ tipo: 'texto', texto: conteudo.slice(i, m.index) });
    saida.push({ tipo: m[1] === 'inserido' ? 'inserido' : 'lacuna', texto: m[2] });
    i = m.index + m[0].length;
  }
  if (i < conteudo.length) saida.push({ tipo: 'texto', texto: conteudo.slice(i) });
  return saida;
}

export const GRAVIDADES_DO_LAUDO = ['critica', 'alta', 'media', 'baixa'] as const;
export type GravidadeDoLaudo = (typeof GRAVIDADES_DO_LAUDO)[number];
export const ROTULO_DA_GRAVIDADE: Record<GravidadeDoLaudo, string> = { critica: 'crítica', alta: 'alta', media: 'média', baixa: 'baixa' };

/** As regras do revisor (código puro). O que regra nenhuma pega, o modelo aponta como `modelo`. */
export const REGRAS_DO_REVISOR = [
  'valor_por_extenso',
  'valor_da_proposta',
  'remissao_quebrada',
  'parte_divergente',
  'cnpj_divergente',
  'lacuna_aberta',
  'placeholder',
  'marca_de_insercao',
  'modelo',
] as const;
export type RegraDoRevisor = (typeof REGRAS_DO_REVISOR)[number];

export interface ApontamentoDoLaudo {
  gravidade: GravidadeDoLaudo;
  regra: RegraDoRevisor;
  titulo: string;
  /** O trecho da minuta que sustenta o apontamento (literal), quando há. */
  trecho: string | null;
  detalhe: string;
  origem: 'regra' | 'modelo';
}

export interface LaudoDoContrato {
  apontamentos: ApontamentoDoLaudo[];
  geradoEm: string;
  /** O modelo foi ouvido (as regras rodam sempre). */
  porModelo: boolean;
  avisos: string[];
  hashDaMinuta: string;
}

export interface MinutaDoContratoNaTela {
  documentoId: string;
  versaoDaProposta: number;
  hash: string;
  conteudo: string;
  inseridos: number;
  lacunas: string[];
  origem: 'modelo' | 'sistema';
  avisos: string[];
  modeloDoDrive: { nome: string; id: string; pastaConferida: boolean };
  geradaEm: string;
  laudo: LaudoDoContrato | null;
}

// ---------------------------------------------------------------------------
// CO-15 · o formulário do site
// ---------------------------------------------------------------------------

/** As únicas origens com CORS na rota pública do formulário (sem barra no fim). */
export const ORIGENS_DO_FORMULARIO_DO_SITE = ['https://operacaoroot.com', 'https://www.operacaoroot.com'] as const;
/** O nome do campo-isca: humano não vê e não preenche; robô preenche. */
export const CAMPO_ISCA_DO_FORMULARIO = 'website';
/** O maior corpo aceito (bytes). O schema já corta cada campo; isto corta antes de ler. */
export const CORPO_MAXIMO_DO_FORMULARIO = 16 * 1024;
/** Quantos envios por origem (IP) por hora. */
export const TETO_DO_FORMULARIO_POR_HORA = 10;
/** A resposta pública, igual para lead novo, repetido, isca e retido: nada ecoa do lado de dentro. */
export const RESPOSTA_DO_FORMULARIO = { ok: true as const, mensagem: 'Recebemos o seu contato. A Root responde em breve.' };

const vazioVira = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opcional = <T extends z.ZodTypeAny>(s: T) => z.preprocess(vazioVira, s.optional());

/**
 * O corpo do formulário. `k` é a chave da empresa (o id dela no OS, o mesmo do
 * pixel): sem ela não se sabe de quem é o lead, e chave que não resolve é 404.
 * Pelo menos um contato (e-mail ou telefone). O texto é DADO: vai ao fio e à
 * tela, nunca a prompt.
 */
export const FormularioDoSiteSchema = z
  .object({
    k: z.string().trim().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'chave da empresa inválida'),
    nome: z.string().trim().min(2, 'Informe o nome.').max(200),
    email: opcional(z.string().trim().toLowerCase().email('E-mail inválido.').max(254)),
    telefone: opcional(z.string().trim().regex(/^[0-9+() .-]{8,40}$/, 'Telefone inválido.')),
    empresa: opcional(z.string().trim().max(200)),
    mensagem: opcional(z.string().trim().max(2000)),
    [CAMPO_ISCA_DO_FORMULARIO]: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.email && !v.telefone) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Informe um e-mail ou um telefone.' });
    const digitos = (v.telefone ?? '').replace(/\D/g, '');
    if (v.telefone && (digitos.length < 10 || digitos.length > 15)) ctx.addIssue({ code: 'custom', path: ['telefone'], message: 'Telefone inválido.' });
  });
export type FormularioDoSite = z.infer<typeof FormularioDoSiteSchema>;

// ---------------------------------------------------------------------------
// CO-16 · a triagem do WhatsApp
// ---------------------------------------------------------------------------

export const CLASSES_DA_TRIAGEM = ['lead_novo', 'duvida_de_lead', 'documento', 'cliente_ativo', 'outro'] as const;
export type ClasseDaTriagem = (typeof CLASSES_DA_TRIAGEM)[number];
export const ROTULO_DA_CLASSE_DA_TRIAGEM: Record<ClasseDaTriagem, string> = {
  lead_novo: 'lead novo',
  duvida_de_lead: 'dúvida de lead',
  documento: 'documento',
  cliente_ativo: 'cliente ativo',
  outro: 'outro',
};
/** Abaixo disto, a mensagem vira pendência para uma pessoa. */
export const LIMIAR_DE_CONFIANCA_DA_TRIAGEM = 0.7;
/** O interruptor por empresa: a nota da memória com `ligada` na primeira linha. */
export const NOTA_DA_TRIAGEM_DO_WHATSAPP = 'comercial.whatsapp.triagem';
/** O tipo da pendência (combinado na Lane 0). */
export const TIPO_DA_PENDENCIA_DA_TRIAGEM = 'whatsapp.triagem';
