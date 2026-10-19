import { z } from 'zod';

import { COMERCIAL_FORMAS_DE_PAGAMENTO, COMERCIAL_PRODUTOS, TABELA_DE_PRECO, type ComercialFormaDePagamento, type ComercialProduto } from './comercial.js';

/*
 * O CLIENTE QUE FECHOU FORA DO SISTEMA (rodada do trabalho T1b, 19/10/2026).
 *
 * A implantação não tem mais "+ adicionar": o cliente nasce do contrato
 * assinado no funil. Quem assinou antes do OS, ou por indicação direta, entra
 * por UMA porta, no comercial: "Registrar cliente já fechado", no Funil vivo.
 *
 * A pessoa digita os dados do aceite e anexa o contrato já assinado (PDF). Isso
 * entra no fio como `aceite.declarado` e `contrato.anexado`, com a procedência
 * escrita: é o que uma pessoa DECLAROU, nunca o aceite do cliente na sala. Daí
 * o lead vai à MESMA transação de fechamento (chave `fech-<lead>-v<n>`, R4 pela
 * porta, titular com senha, segunda pessoa). As diferenças:
 *   · a assinatura: o contrato já está assinado, nada vai à ZapSign;
 *   · a cobrança: o padrão é NÃO criar cobrança nova no Asaas (o cliente pode
 *     já pagar por fora). Sem marcar, a escrita da cobrança fica `pulado` com
 *     o motivo que a pessoa escreveu; marcando, a cobrança nasce como a do funil.
 * Dado que não existe fica `[a decidir]`, nunca inventado.
 */

export const PROCEDENCIA_DO_FECHADO_FORA = 'registrado à mão: contrato assinado fora do sistema';
export const A_DECIDIR = '[a decidir]';
/** O PDF do contrato assinado: o mesmo teto do arquivo da sala. */
export const FECHADO_FORA_MAX_BYTES = 10 * 1024 * 1024;

/** Os produtos com preço na tabela de 04/10 (os sem preço são `[a decidir]` e não fecham). */
export const PRODUTOS_COM_PRECO: readonly ComercialProduto[] = COMERCIAL_PRODUTOS.filter((p) => TABELA_DE_PRECO[p] !== null);

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD').refine((v) => !Number.isNaN(new Date(`${v}T12:00:00-03:00`).getTime()), 'data inválida');
const texto = (min: number, max: number) => z.string().trim().min(min).max(max);

export const ClienteFechadoForaSchema = z
  .object({
    razaoSocial: texto(2, 200),
    /** CNPJ ou CPF; só os dígitos contam. */
    cnpj: z.string().trim().refine((v) => [11, 14].includes(v.replace(/\D/g, '').length), 'CNPJ (14 dígitos) ou CPF (11 dígitos)'),
    quemAssina: texto(2, 200),
    email: z.string().trim().toLowerCase().email().max(254),
    /** O WhatsApp do contato: o portão de novo lead e o grupo do cliente pedem. */
    telefone: z.string().trim().refine((v) => { const d = v.replace(/\D/g, ''); return d.length >= 10 && d.length <= 13; }, 'WhatsApp com DDD'),
    /** Opcional: vazio vira `[a decidir]` no contrato e no manifesto. */
    endereco: z.string().trim().max(300).optional(),
    produto: z.enum(COMERCIAL_PRODUTOS).refine((p) => TABELA_DE_PRECO[p] !== null, 'produto sem preço na tabela de 04/10: [a decidir]'),
    valorCentavos: z.number().int().positive().max(100_000_000),
    parcelas: z.number().int().min(1).max(60),
    forma: z.enum(COMERCIAL_FORMAS_DE_PAGAMENTO),
    /** A data de assinatura que está no contrato. */
    assinadoEm: dia,
    /** O 1º vencimento combinado com o cliente (o contrato do Financeiro conta as parcelas a partir dele). */
    primeiroVencimento: dia,
    /** Padrão seguro: NÃO criar cobrança nova. Só com a pessoa marcando. */
    criarCobranca: z.boolean().default(false),
    /** Sem cobrança nova, o porquê (ex.: "o cliente já paga por boleto do banco"). */
    motivoSemCobranca: z.string().trim().max(300).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.criarCobranca && !(v.motivoSemCobranca && v.motivoSemCobranca.length >= 3)) {
      ctx.addIssue({ code: 'custom', path: ['motivoSemCobranca'], message: 'sem cobrança nova, diga por quê (ex.: o cliente já paga por fora)' });
    }
    if (v.criarCobranca && v.motivoSemCobranca) {
      ctx.addIssue({ code: 'custom', path: ['motivoSemCobranca'], message: 'com cobrança nova não há motivo para pular' });
    }
    if (v.valorCentavos < v.parcelas) ctx.addIssue({ code: 'custom', path: ['parcelas'], message: 'as parcelas não fecham o valor' });
    if (v.primeiroVencimento < v.assinadoEm) ctx.addIssue({ code: 'custom', path: ['primeiroVencimento'], message: 'o 1º vencimento vem depois da assinatura' });
  });
export type ClienteFechadoForaInput = z.infer<typeof ClienteFechadoForaSchema>;

/** O que a rota devolve: o lead, o anexo e onde o fechamento parou (na fila da titular, em regra). */
export interface ClienteFechadoForaResposta {
  leadId: string;
  leadNovo: boolean;
  /** `false` quando o mesmo registro chegou de novo (nada foi gravado duas vezes). */
  registroNovo: boolean;
  versao: number;
  chave: string;
  anexo: { sha256: string; nome: string; bytes: number };
  fechamento: { estado: string; approvalId: string | null; pulado: string | null };
}

/** O valor da tabela para o produto (a tela pré-preenche; a pessoa corrige com o que está no contrato). */
export function condicoesDaTabela(produto: ComercialProduto): { valorCentavos: number; parcelas: number; formas: readonly ComercialFormaDePagamento[] } | null {
  const l = TABELA_DE_PRECO[produto];
  return l ? { valorCentavos: l.valorCentavos, parcelas: l.parcelas, formas: l.formas as readonly ComercialFormaDePagamento[] } : null;
}

/** O PDF do contrato assinado fora, como as telas mostram (nunca o conteúdo: só o que o fio guarda). */
export interface ContratoAnexadoNaTela {
  nome: string;
  bytes: number;
  sha256: string;
  assinadoEm: string;
  por: string | null;
}

/**
 * Revisão P2-1: o que a titular assina no R4 do fechamento, para o cartão de `/atendimento`
 * (`GET /comercial/fechamentos/:leadId/conteudo?hash=`). O hash é RECALCULADO agora; `confere`
 * falso = o conteúdo mudou depois do pedido, e o botão não acende.
 */
export interface ConteudoDoFechamento {
  leadId: string;
  nome: string;
  origem: 'fora' | 'sala';
  versao: number;
  chave: string;
  produto: ComercialProduto;
  rotuloDoProduto: string;
  valorCentavos: number;
  parcelas: number;
  forma: string;
  dados: { cnpj: string; razaoSocial: string; endereco: string; quemAssina: string; email: string };
  fora: {
    assinadoEm: string;
    primeiroVencimento: string;
    criarCobranca: boolean;
    motivoSemCobranca: string | null;
    por: string | null;
    anexo: ContratoAnexadoNaTela | null;
  } | null;
  hashDeAgora: string;
  hashAssinado: string | null;
  confere: boolean;
}
