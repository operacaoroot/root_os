import { A_DECIDIR, PROCEDENCIA_DO_FECHADO_FORA, TABELA_DE_PRECO, type ClienteFechadoForaInput, type ComercialProduto } from '@mktos/shared';

import type { AceiteDoLead } from './dinheiro.service';
import { hashDoConteudo } from './eventos';
import type { FormaDeCobranca } from './portas/cobranca.port';
import { parcelasDoValor } from './proposta-construtor';

/*
 * O CLIENTE QUE FECHOU FORA DO SISTEMA, a parte pura (rodada do trabalho T1b,
 * 19/10/2026). Sem Nest e sem banco: a suíte mede tudo isto sem subir nada.
 *
 * O aceite declarado vira o MESMO `AceiteDoLead` que o fechamento lê do aceite
 * da sala, com o campo `fora` dizendo de onde veio. O `hash` dele cobre todos os
 * campos declarados e o sha256 do PDF anexado: é o `propostaHash` do pedido de
 * `comercial.fechamento.executar` que a titular assina, e o efeito o recalcula.
 * Mudou um dado (ou o arquivo) depois do pedido, o efeito recusa sem escrever.
 */

/** O que o fechamento precisa saber do registro à mão (vai em `AceiteDoLead.fora`). */
export interface DeclaracaoDoFechadoFora {
  assinadoEm: string;
  primeiroVencimento: string;
  criarCobranca: boolean;
  motivoSemCobranca: string | null;
  arquivoSha256: string;
  /** Quem registrou: não assina o próprio registro (segunda pessoa). */
  porId: string;
  por: string | null;
}

/** O que entra no hash: os dados declarados e o arquivo. A ordem das chaves não muda nada. */
export function camposDaDeclaracao(input: ClienteFechadoForaInput, arquivoSha256: string) {
  return {
    razaoSocial: input.razaoSocial.trim(),
    cnpj: input.cnpj.replace(/\D/g, ''),
    quemAssina: input.quemAssina.trim(),
    email: input.email.trim().toLowerCase(),
    endereco: input.endereco?.trim() || A_DECIDIR,
    produto: input.produto,
    valorCentavos: input.valorCentavos,
    parcelas: input.parcelas,
    forma: input.forma,
    assinadoEm: input.assinadoEm,
    primeiroVencimento: input.primeiroVencimento,
    criarCobranca: input.criarCobranca,
    motivoSemCobranca: input.criarCobranca ? null : (input.motivoSemCobranca?.trim() ?? null),
    arquivoSha256,
  };
}

export type CamposDaDeclaracao = ReturnType<typeof camposDaDeclaracao>;

/** O hash da declaração (sha256 hexa, 64): o mesmo registro de novo cai no mesmo hash. */
export function hashDaDeclaracao(c: CamposDaDeclaracao): string {
  return hashDoConteudo({ tipo: 'aceite.declarado', ...c });
}

/** O payload do `aceite.declarado`. */
export function payloadDaDeclaracao(c: CamposDaDeclaracao, versao: number, quem: { id: string; nome: string | null }) {
  return { ...c, versao, hash: hashDaDeclaracao(c), procedencia: PROCEDENCIA_DO_FECHADO_FORA, por: quem.nome, porId: quem.id };
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * O `AceiteDoLead` de um `aceite.declarado` gravado. O hash é RECALCULADO dos
 * campos do payload (nunca o que o payload diz de si), para o efeito comparar
 * com o pedido assinado. Payload torto = nulo (o fechamento diz que falta o aceite).
 */
export function aceiteDaDeclaracao(payload: unknown, em: Date): AceiteDoLead | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const produto = s(p.produto) as ComercialProduto;
  if (!(produto in TABELA_DE_PRECO) || !TABELA_DE_PRECO[produto]) return null;
  const c: CamposDaDeclaracao = {
    razaoSocial: s(p.razaoSocial),
    cnpj: s(p.cnpj),
    quemAssina: s(p.quemAssina),
    email: s(p.email),
    endereco: s(p.endereco) || A_DECIDIR,
    produto,
    valorCentavos: Number(p.valorCentavos),
    parcelas: Number(p.parcelas),
    forma: s(p.forma) as FormaDeCobranca,
    assinadoEm: s(p.assinadoEm),
    primeiroVencimento: s(p.primeiroVencimento),
    criarCobranca: p.criarCobranca === true,
    motivoSemCobranca: typeof p.motivoSemCobranca === 'string' ? p.motivoSemCobranca : null,
    arquivoSha256: s(p.arquivoSha256),
  };
  if (!c.cnpj || !c.razaoSocial || !Number.isInteger(c.valorCentavos) || !Number.isInteger(c.parcelas) || c.parcelas < 1 || !/^[0-9a-f]{64}$/.test(c.arquivoSha256)) return null;
  return {
    versao: Number(p.versao ?? 1) || 1,
    produto,
    valorCentavos: c.valorCentavos,
    parcelas: c.parcelas,
    forma: c.forma,
    hash: hashDaDeclaracao(c),
    em,
    dados: { cnpj: c.cnpj, razaoSocial: c.razaoSocial, endereco: c.endereco, quemAssina: c.quemAssina, email: c.email },
    fora: {
      assinadoEm: c.assinadoEm,
      primeiroVencimento: c.primeiroVencimento,
      criarCobranca: c.criarCobranca,
      motivoSemCobranca: c.motivoSemCobranca,
      arquivoSha256: c.arquivoSha256,
      porId: s(p.porId),
      por: typeof p.por === 'string' ? p.por : null,
    },
  };
}

/** Soma meses a um dia AAAA-MM-DD; o dia que não existe no mês cai no último (31/01 + 1 = 28 ou 29/02). */
export function somarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/**
 * As parcelas do contrato do Financeiro quando NÃO há cobrança no Asaas: a
 * conta sai do valor, das parcelas e do 1º vencimento declarados (mensal, a
 * última absorve a diferença, como a cobrança e a proposta). A próxima é a
 * primeira que vence hoje ou depois; passadas todas, a última.
 */
export function parcelasDoContratoFora(valorCentavos: number, parcelas: number, primeiroVencimento: string, hoje: string): {
  parcelaCentavos: number;
  ultimaParcelaCentavos: number;
  vencimentos: string[];
  proximo: string;
} {
  const { parcelaCentavos, ultimaParcelaCentavos } = parcelasDoValor(valorCentavos, parcelas);
  const vencimentos = Array.from({ length: Math.max(1, parcelas) }, (_, i) => somarMeses(primeiroVencimento, i));
  const proximo = vencimentos.find((v) => v >= hoje) ?? vencimentos[vencimentos.length - 1];
  return { parcelaCentavos, ultimaParcelaCentavos, vencimentos, proximo };
}

/** O PDF de verdade começa com `%PDF-` (o tipo que o navegador diz não basta). */
export function ehPdf(buffer: Buffer): boolean {
  return buffer.length > 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** A chave do PDF no storage: por lead e pelo conteúdo (o mesmo arquivo cai na mesma chave). */
export function chaveDoAnexo(leadId: string, sha256: string): string {
  return `comercial/lead/${leadId}/contrato-assinado-${sha256}.pdf`;
}
