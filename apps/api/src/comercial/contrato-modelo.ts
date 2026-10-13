import { createHash } from 'node:crypto';
import { TABELA_DE_PRECO, formatarReais, type ComercialProduto } from '@mktos/shared';

import { parcelasDoValor } from './proposta-construtor';

/*
 * O CONTRATO DE HOMOLOGAÇÃO (lane D, 13/10/2026) — a parte pura.
 *
 * O modelo de contrato da Operação ROOT NÃO existe (lista "Falta do Rodrigo").
 * Este é o esqueleto de `homolog/fixtures/contrato-modelo.md`, copiado aqui
 * para viajar na imagem (a pasta `homolog/` não entra no build); a suíte
 * confere que os dois textos são iguais. Os campos entre chaves vêm do aceite
 * na sala e da proposta aceita, sem redigitação; as lacunas `[a decidir]`
 * ficam como estão, em vermelho.
 *
 * O texto montado é DETERMINÍSTICO (a data é a do aceite, não a de agora): o
 * hash calculado na proposta à porta é o mesmo que o efeito recalcula depois
 * da assinatura da titular. Mudou um dado do aceite no meio = hash diferente =
 * o efeito recusa.
 */

export const CONTRATO_MODELO = "# CONTRATO DE PRESTAÇÃO DE SERVIÇOS · MODELO DE HOMOLOGAÇÃO\n\n> **ATENÇÃO.** Este NÃO é o contrato da Operação ROOT. É um esqueleto de\n> homologação (13/10/2026) para o cockpit comercial exercitar a porta de\n> assinatura. O contrato de verdade será redigido pelo Rodrigo e está na lista\n> \"Falta do Rodrigo\" do `homolog/RESULTADO.md`. Toda cláusula marcada\n> <span style=\"color:#c00\">[a decidir]</span> é lacuna: nenhum valor foi\n> escolhido por quem escreveu este arquivo. Os campos entre chaves vêm do aceite\n> na sala do cliente, sem redigitação.\n\n## PARTES\n\n**CONTRATANTE:** {razaoSocial}, inscrita no CPF/CNPJ sob o nº {cnpj}, com endereço em {endereco}, neste ato representada por {quemAssina} ({email}).\n\n**CONTRATADA:** <span style=\"color:#c00\">[a decidir: razão social, CNPJ e endereço da Operação ROOT]</span>.\n\n## 1. OBJETO\n\n1.1. A CONTRATADA prestará à CONTRATANTE o serviço **{produtoRotulo}**: {produtoDescricao}\n\n1.2. Escopo detalhado, entregas e exclusões: <span style=\"color:#c00\">[a decidir]</span>.\n\n## 2. PREÇO E PAGAMENTO\n\n2.1. Valor total: **{valorTotal}**, em **{parcelas}** parcela(s) de **{valorParcela}**, por **{forma}**.\n\n2.2. Condições aceitas na proposta versão {propostaVersao} (hash {propostaHash}).\n\n2.3. Atraso: multa, juros e correção <span style=\"color:#c00\">[a decidir]</span>.\n\n## 3. PRAZO E VIGÊNCIA\n\n3.1. Vigência: <span style=\"color:#c00\">[a decidir]</span>.\n\n3.2. Renovação: <span style=\"color:#c00\">[a decidir]</span>.\n\n## 4. RESCISÃO\n\n4.1. Hipóteses, aviso prévio e efeitos: <span style=\"color:#c00\">[a decidir]</span>.\n\n## 5. DADOS PESSOAIS E CONFIDENCIALIDADE\n\n5.1. Tratamento de dados (LGPD) e sigilo: <span style=\"color:#c00\">[a decidir]</span>.\n\n## 6. FORO\n\n6.1. <span style=\"color:#c00\">[a decidir]</span>.\n\nE por estarem de acordo, as partes assinam eletronicamente.\n\n{cidadeData}\n\n______________________________\n{quemAssina} · CONTRATANTE\n\n______________________________\n<span style=\"color:#c00\">[a decidir: quem assina pela Operação ROOT]</span> · CONTRATADA\n";

export interface DadosDoContrato {
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  quemAssina: string;
  email: string;
  produto: ComercialProduto;
  valorCentavos: number;
  parcelas: number;
  forma: string;
  propostaVersao: number;
  propostaHash: string;
  /** O instante do aceite: a data do contrato. */
  aceitoEm: Date;
}

const ROTULO_DA_FORMA: Record<string, string> = { pix: 'Pix', boleto: 'boleto', cartao: 'cartão de crédito' };
const LACUNA = (o: string) => `<span style="color:#c00">[a decidir: ${o}]</span>`;

function dataPorExtensoSP(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

/** Documento formatado (CNPJ 00.000.000/0000-00 ou CPF 000.000.000-00). */
export function documentoFormatado(doc: string): string {
  const d = doc.replace(/\D/g, '');
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}

/**
 * Campo escrito pelo cliente na sala (D-5): numa linha só e com a marcação de
 * markdown e HTML escapada. Sem isso, um endereço com quebra de linha e `##`
 * viraria cláusula nova no documento que vai à assinatura.
 */
export function campoDoCliente(v: string): string {
  return String(v ?? '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_{}[\]<>#|!~]/g, (c) => `\\${c}`);
}

/** O contrato com os campos preenchidos. Campo que falta vira lacuna em vermelho, nunca valor inventado. */
export function montarContrato(d: DadosDoContrato): string {
  const linha = TABELA_DE_PRECO[d.produto];
  // D-11: a mesma conta da proposta e da cobrança. Total que divide: o texto de sempre (o hash não muda);
  // que não divide: as parcelas iguais e a última com a diferença.
  const { parcelaCentavos, ultimaParcelaCentavos } = d.parcelas > 0 ? parcelasDoValor(d.valorCentavos, d.parcelas) : { parcelaCentavos: d.valorCentavos, ultimaParcelaCentavos: d.valorCentavos };
  const valorParcela = ultimaParcelaCentavos === parcelaCentavos ? formatarReais(parcelaCentavos) : `${formatarReais(parcelaCentavos)} (a última de ${formatarReais(ultimaParcelaCentavos)})`;
  const campos: Record<string, string> = {
    razaoSocial: campoDoCliente(d.razaoSocial),
    cnpj: documentoFormatado(d.cnpj),
    endereco: campoDoCliente(d.endereco),
    quemAssina: campoDoCliente(d.quemAssina),
    email: campoDoCliente(d.email),
    produtoRotulo: linha?.rotulo ?? '',
    produtoDescricao: linha?.descricao ?? '',
    valorTotal: formatarReais(d.valorCentavos),
    parcelas: String(d.parcelas),
    valorParcela,
    forma: ROTULO_DA_FORMA[d.forma] ?? d.forma,
    propostaVersao: String(d.propostaVersao),
    propostaHash: d.propostaHash.slice(0, 12),
    cidadeData: `${LACUNA('cidade')}, ${dataPorExtensoSP(d.aceitoEm)}.`,
  };
  return CONTRATO_MODELO.replace(/\{(\w+)\}/g, (todo, chave: string) => {
    if (!(chave in campos)) return todo;
    const v = campos[chave];
    return v && v.trim() ? v : LACUNA(chave);
  });
}

export function hashDoContrato(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

/** As lacunas que o contrato montado ainda tem (para o fio e a tela). */
export function lacunasDoContrato(markdown: string): string[] {
  return [...markdown.matchAll(/\[a decidir(?::\s*([^\]]+))?\]/g)].map((m) => (m[1] ?? 'a decidir').trim());
}
