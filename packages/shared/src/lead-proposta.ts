import { z } from 'zod';

/*
 * PROPOSTA E ACEITE COMERCIAL (ROOT-49, contrato C-03, padrão P-b) — o que a
 * tela, a API e o teste entendem do mesmo pedido.
 *
 * O PERCURSO MÍNIMO, SEM TABELA NOVA. A proposta é um documento que mora FORA
 * do OS (link + sha256) e o aceite é um `LeadEvent` de tipo `aceite` (ou
 * `recusa`). As CONDIÇÕES — valor em negociação, datas, periodicidade — são
 * campos do card comercial do Trabalho, LIDAS na hora e nunca copiadas para o
 * lead: o card segue sendo a única verdade, e o evento guarda só o HASH das
 * condições que a pessoa viu ao decidir. Se o card mudar depois, o aceite com o
 * hash velho é recusado (409) com a diferença na mão.
 *
 * NADA SAI DO OS: nenhuma assinatura eletrônica, cobrança nem e-mail. E este
 * percurso NÃO cria `Contract` nem lançamento financeiro (C-04): proposta
 * aceita é um fato comercial; o contrato recorrente do Financeiro é outro
 * objeto e nasce por outro caminho.
 *
 * Arquivo do card (C-10) como documento da proposta é LACUNA: o serviço de
 * arquivos do Trabalho (ROOT-44) ainda não existe na base, e por isso o
 * documento só entra por referência externa.
 */

const texto = (max: number) => z.string().trim().min(1).max(max);

const SHA256 = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{64}$/, 'sha256 deve ter 64 caracteres hexadecimais');

/** https, sem usuário e senha no endereço: o link é exibido na tela e guardado no evento. */
const LINK_HTTPS = z
  .string()
  .trim()
  .max(2000)
  .refine((valor) => {
    try {
      const u = new URL(valor);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'use um endereço https, sem usuário e senha');

// ---------- Condições (lidas do card) ----------

export const LEAD_CONDICAO_TIPOS = ['moeda', 'data', 'periodicidade'] as const;
export type LeadCondicaoTipo = (typeof LEAD_CONDICAO_TIPOS)[number];

export const LeadCondicaoCampoSchema = z
  .object({
    campoId: texto(64),
    nome: texto(200),
    tipo: z.enum(LEAD_CONDICAO_TIPOS),
    /** `moeda` vem no texto canônico `BRL 1500.00`; `data` e `periodicidade`, como o card guarda. */
    valor: z.string().max(500).nullable(),
  })
  .strict();
export type LeadCondicaoCampo = z.infer<typeof LeadCondicaoCampoSchema>;

export const LeadCondicoesSchema = z
  .object({
    cardId: texto(64),
    inicio: z.string().max(40).nullable(),
    vencimento: z.string().max(40).nullable(),
    campos: z.array(LeadCondicaoCampoSchema).max(50),
  })
  .strict();
export type LeadCondicoes = z.infer<typeof LeadCondicoesSchema>;

export interface LeadDiferencaDeCondicao {
  /** `inicio`, `vencimento` ou `campo:<campoId>` — estável para a tela comparar. */
  chave: string;
  rotulo: string;
  /** O que a pessoa tinha visto ao decidir (`condicoesVistas`). */
  vista: string | null;
  /** O que o card tem agora. */
  atual: string | null;
}

// ---------- Proposta (documento externo) ----------

export const LeadPropostaDocumentoSchema = z
  .object({
    tipo: z.literal('link'),
    url: LINK_HTTPS,
    /** sha256 do conteúdo do documento, como o time o guarda: prova de QUAL versão foi enviada. */
    sha256: SHA256,
    titulo: texto(200).optional(),
  })
  .strict();
export type LeadPropostaDocumento = z.infer<typeof LeadPropostaDocumentoSchema>;

export const LeadPropostaRegistroSchema = z
  .object({
    documento: LeadPropostaDocumentoSchema,
    /**
     * O card comercial (`WorkTask.id`). Sem ele, vale o card do lead de origem
     * `clickup` (o `externalId` do card é a origem) ou o da última proposta.
     */
    cardId: texto(64).optional(),
  })
  .strict();
export type LeadPropostaRegistroInput = z.infer<typeof LeadPropostaRegistroSchema>;

// ---------- Aceite e recusa ----------

export const LEAD_EVIDENCIA_TIPOS = ['arquivo', 'link', 'mensagem'] as const;
export const LEAD_MENSAGEM_CANAIS = ['whatsapp', 'email', 'reuniao', 'outro'] as const;

export const LeadEvidenciaSchema = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('arquivo'),
      nome: texto(200),
      /** O arquivo mora fora do OS; o hash prova qual foi. */
      sha256: SHA256,
    })
    .strict(),
  z.object({ tipo: z.literal('link'), url: LINK_HTTPS }).strict(),
  z
    .object({
      tipo: z.literal('mensagem'),
      canal: z.enum(LEAD_MENSAGEM_CANAIS),
      /** O texto em que a pessoa aceitou (ou recusou), copiado como veio. */
      texto: z.string().trim().min(3).max(2000),
      recebidaEm: z.string().datetime().optional(),
    })
    .strict(),
]);
export type LeadEvidencia = z.infer<typeof LeadEvidenciaSchema>;

export const LEAD_DECISOES = ['aceite', 'recusa'] as const;
export type LeadDecisao = (typeof LEAD_DECISOES)[number];

export const LeadDecisaoSchema = z
  .object({
    decisao: z.enum(LEAD_DECISOES),
    evidencia: LeadEvidenciaSchema,
    /** Hash das condições que a pessoa viu (`GET .../proposta/condicoes`). */
    condicoesHash: SHA256,
    /** O que a pessoa viu: só serve para a API devolver a diferença quando o card mudou. */
    condicoesVistas: LeadCondicoesSchema.optional(),
    motivo: texto(500).optional(),
  })
  .strict();
export type LeadDecisaoInput = z.infer<typeof LeadDecisaoSchema>;

// ---------- Leitura e respostas ----------

export type LeadPropostaEstado = 'sem_proposta' | 'proposta_registrada' | 'aceite_registrado' | 'recusa_registrada';

export interface LeadPropostaResumo {
  eventoId: string;
  documento: LeadPropostaDocumento;
  cardId: string;
  condicoesHash: string;
  registradaEm: string;
  ator: string | null;
}

export interface LeadDecisaoResumo {
  eventoId: string;
  decisao: LeadDecisao;
  propostaEventoId: string;
  condicoesHash: string;
  evidencia: LeadEvidencia;
  motivo: string | null;
  registradaEm: string;
  ator: string | null;
}

/** `GET /leads/:id/proposta` (`leads.ver`): o estado e o que foi registrado, sem ler o card. */
export interface LeadPropostaLeitura {
  estado: LeadPropostaEstado;
  proposta: LeadPropostaResumo | null;
  /** Só quando a última coisa que aconteceu foi uma decisão. */
  decisao: LeadDecisaoResumo | null;
}

/** `GET /leads/:id/proposta/condicoes` (`leads.ver` + `tarefas.ver`): as condições do card, lidas agora. */
export interface LeadCondicoesLeitura {
  card: { id: string; titulo: string } | null;
  /** Por que não há condições (sem card ligado, card sem valor…). */
  motivo: string | null;
  condicoes: LeadCondicoes | null;
  hash: string | null;
  /** Alguma proposta registrada foi feita com estas mesmas condições (o critério da decisão)? Nulo sem proposta ou sem condições. */
  propostaVigente: boolean | null;
  /** A proposta mais recente feita com estas condições: a que a decisão vai citar. Nulo quando nenhuma vale. */
  propostaVigenteResumo: LeadPropostaResumo | null;
}

export interface LeadPropostaResposta {
  id: string;
  eventoId: string;
  /** O mesmo registro já existia: nenhum evento novo. */
  replayed: boolean;
  cardId: string;
  condicoesHash: string;
}

export interface LeadDecisaoResposta {
  id: string;
  eventoId: string;
  decisao: LeadDecisao;
  replayed: boolean;
  /** Em replay: a evidência enviada agora é a mesma que ficou gravada? */
  evidenciaIgual: boolean;
  propostaEventoId: string;
  condicoesHash: string;
}

/** O `code` do 409 de uma decisão que já existe mas foi superada por outra decisão sobre as mesmas condições. */
export const CODIGO_DECISAO_SUPERADA = 'decisao_superada';

/**
 * Corpo do 409 quando a decisão pedida já está registrada para estas condições,
 * mas não é a mais recente: depois dela veio a outra (aceite, recusa, aceite).
 * Nada é gravado; a tela mostra a frase e o estado de agora.
 */
export interface LeadDecisaoSuperadaCorpo {
  code: typeof CODIGO_DECISAO_SUPERADA;
  message: string;
  /** A decisão que vale hoje para as condições do pedido. */
  decisaoAtual: LeadDecisao;
  eventoAtualId: string;
}

/** Corpo do 409 quando as condições do card mudaram desde o que a pessoa viu. */
export interface LeadCondicoesMudaramCorpo {
  message: string;
  atualHash: string;
  atual: LeadCondicoes;
  /** Nulo quando o pedido não trouxe `condicoesVistas`. */
  diferenca: LeadDiferencaDeCondicao[] | null;
}
