import { createHash } from 'node:crypto';

import { A_DECIDIR, TABELA_DE_PRECO, formatarReais, type ApontamentoDoLaudo, type CampoDaEmissao, type ModalidadeDeContrato, type TipoDeContrato } from '@mktos/shared';

import { documentoFormatado } from '../contrato-modelo';
import type { PedidoDePdf } from '../contrato-da-root/pdf-do-contrato';
import { moldeDoContrato } from '../contrato-da-root/moldes-do-contrato';
import { preencherMolde, type CamposDoContrato, type DadosDoContrato, type MoldePreenchido } from '../contrato-da-root/preencher-molde';
import { parcelasDoValor } from '../proposta-construtor';

/*
 * A EMISSÃO DO CONTRATO, A PARTE PURA (Contratos, F2, 02/11/2026). Sem Nest e sem banco.
 *
 * De onde sai cada coisa que entra no documento, numa ordem que não muda: a proposta aceita manda no que ela
 * diz; o que a pessoa escreveu no contrato (`dadosDoContrato.campos`) preenche o resto; o CNPJ que fatura é
 * `faturaPor`; quem assina é a lista de signatários. Faltou, é lacuna: o sistema nunca adivinha.
 *
 * ADITIVO E DISTRATO têm um texto simples próprio, sem cláusula jurídica além de partes, referência ao contrato
 * pai, o que muda (ou a data de encerramento) e "as demais cláusulas seguem válidas". É TEXTO A SER REVISADO POR
 * RODRIGO: o aviso vai junto de toda minuta que sai daqui.
 */

export const AVISO_DO_TEXTO_SIMPLES = 'Texto simples de aditivo e distrato, a ser revisado por Rodrigo antes do primeiro envio de verdade.';

/** O aceite no que a emissão lê (a forma de `AceiteDoLead`, sem a dependência do serviço). */
export interface AceiteParaEmissao {
  versao: number;
  produto: string;
  valorCentavos: number;
  parcelas: number;
  dados: { cnpj: string; razaoSocial: string; endereco: string; quemAssina: string; email: string };
}

export type CamposEscritos = Record<string, string | string[]>;

/** Os campos escritos à mão que estão no `dadosDoContrato`. Qualquer outra coisa ali não é campo. */
export function camposEscritos(dados: unknown): CamposEscritos {
  const c = ((dados ?? {}) as { campos?: unknown }).campos;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return {};
  const out: CamposEscritos = {};
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string' && !!x.trim());
  }
  return out;
}

const util = (v: string): string | undefined => (v && v.trim() && v.trim() !== A_DECIDIR ? v.trim() : undefined);

/** O que a proposta aceita diz. Entrada e saldo não estão no aceite: quem escreve é a pessoa, e o revisor confere a soma. */
export function camposDoAceite(a: AceiteParaEmissao | null): CamposDoContrato {
  if (!a) return {};
  const digitos = a.dados.cnpj.replace(/\D/g, '');
  const brutos: CamposDoContrato = {
    contratante_tipo: digitos.length === 14 ? 'PJ' : digitos.length === 11 ? 'PF' : undefined,
    contratante_nome: util(a.dados.razaoSocial),
    contratante_documento: digitos ? documentoFormatado(digitos) : undefined,
    contratante_endereco: util(a.dados.endereco),
    contratante_email: util(a.dados.email),
    contratante_representante: digitos.length === 14 ? util(a.dados.quemAssina) : undefined,
    valor_total: a.valorCentavos > 0 ? a.valorCentavos / 100 : undefined,
  };
  return Object.fromEntries(Object.entries(brutos).filter(([, v]) => v !== undefined));
}

/** Os campos do molde: o aceite manda, e o escrito preenche o resto. `sim` e `nao` são os opcionais. */
export function juntarCampos(aceite: AceiteParaEmissao | null, escritos: CamposEscritos): CamposDoContrato {
  const convertidos = Object.fromEntries(Object.entries(escritos).map(([k, v]) => [k, v === 'sim' ? true : v === 'nao' ? false : v]));
  // Apelido vazio some do texto: sem apelido não é lacuna (é a regra do `|apelido`).
  return { contratante_apelido: '', ...convertidos, ...camposDoAceite(aceite) };
}

/** A contratada: o documento é `faturaPor` (D6); o resto é campo escrito. O aceite nunca fala por ela. */
export function contratadaDoContrato(faturaPor: string | null, escritos: CamposEscritos): NonNullable<DadosDoContrato['contratada']> {
  const texto = (k: string) => (typeof escritos[k] === 'string' ? (escritos[k] as string) : null);
  const f = faturaPor?.trim() ?? '';
  const digitos = f.replace(/\D/g, '');
  return {
    nome: texto('contratada_nome'),
    qualificacao: texto('contratada_qualificacao'),
    documento: !f ? null : digitos.length === 14 && !/[a-z]/i.test(f) ? `CNPJ ${documentoFormatado(digitos)}` : f,
    pix: texto('contratada_pix'),
  };
}

const ROTULO_DO_TIPO_DE_SERVICO: Record<'aditivo' | 'distrato', string> = { aditivo: 'ADITIVO CONTRATUAL', distrato: 'DISTRATO' };

// -------------------------------------------------------------------------
// Aditivo e distrato
// -------------------------------------------------------------------------

export interface PaiDoFilho {
  numero: string | null;
  modalidade: string | null;
  assinadoEm: Date | null;
  hash: string | null;
}

const dataBr = (d: Date): string => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** A frase que aponta o contrato pai só com o que está gravado: sem número, sem data ou sem hash, a parte some. */
export function referenciaAoPai(pai: PaiDoFilho): string {
  const nome = pai.modalidade === 'implantacao' ? 'de implantação e acompanhamento' : pai.modalidade === 'continuidade' ? 'de consultoria e acompanhamento' : '';
  const partes = [`Contrato de Prestação de Serviços${nome ? ` ${nome}` : ''}`];
  if (pai.numero) partes.push(`nº ${pai.numero}`);
  if (pai.assinadoEm) partes.push(`assinado em ${dataBr(pai.assinadoEm)}`);
  if (pai.hash) partes.push(`documento de código ${pai.hash.slice(0, 12)}`);
  return partes.join(', ');
}

/** O texto-base do aditivo e do distrato, nos mesmos `[[campos]]` dos moldes. */
export function moldeDoFilho(tipo: 'aditivo' | 'distrato'): string {
  const miolo = tipo === 'aditivo'
    ? ['As partes alteram o contrato referido acima no seguinte:', '', '- (a) [[lista:mudancas]]']
    : ['As partes encerram o contrato referido acima, com última data de vigência em [[data_de_encerramento]].'];
  return [
    `# ${tipo === 'aditivo' ? 'ADITIVO AO CONTRATO DE PRESTAÇÃO DE SERVIÇOS' : 'DISTRATO DO CONTRATO DE PRESTAÇÃO DE SERVIÇOS'}`,
    '',
    'CONTRATADA: [[contratada_nome]], [[contratada_qualificacao]] (doravante “CONTRATADA” ou “Root”).',
    '',
    'CONTRATANTE: [[contratante_nome]], [[contratante_qualificacao]] (doravante “CONTRATANTE”).',
    '',
    'Este instrumento se refere ao [[referencia_ao_contrato]].',
    '',
    ...miolo,
    '',
    'As demais cláusulas seguem válidas.',
    '',
    'E, por estarem assim justas e contratadas, as partes assinam este instrumento eletronicamente.',
    '',
  ].join('\n');
}

/** O que um aditivo ou distrato acrescenta aos campos do contrato pai. */
export function camposDoFilho(tipo: 'aditivo' | 'distrato', dados: unknown, vigenciaFim: Date | null, pai: PaiDoFilho): CamposDoContrato {
  const mudancas = String(((dados ?? {}) as { mudancas?: unknown }).mudancas ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return {
    referencia_ao_contrato: referenciaAoPai(pai),
    ...(tipo === 'aditivo' && mudancas.length ? { mudancas } : {}),
    ...(tipo === 'distrato' && vigenciaFim ? { data_de_encerramento: dataBr(vigenciaFim) } : {}),
  };
}

// -------------------------------------------------------------------------
// O preenchimento e o pedido do PDF
// -------------------------------------------------------------------------

export interface EntradaDoPreenchimento {
  tipo: TipoDeContrato;
  modalidade: string | null;
  faturaPor: string | null;
  dados: unknown;
  vigenciaFim: Date | null;
  /** Os campos escritos do contrato pai, no aditivo e no distrato. */
  camposDoPai?: CamposEscritos;
  pai?: PaiDoFilho;
  aceite: AceiteParaEmissao | null;
  signatarios: ReadonlyArray<{ nome: string; papel: string; ordem: number }>;
}

export function textoBaseDoRegistro(e: Pick<EntradaDoPreenchimento, 'tipo' | 'modalidade'>): { texto: string; tipoDoServico: string; base: 'molde' | 'texto_simples' } {
  if (e.tipo !== 'contrato') return { texto: moldeDoFilho(e.tipo), tipoDoServico: ROTULO_DO_TIPO_DE_SERVICO[e.tipo], base: 'texto_simples' };
  const m = moldeDoContrato(e.modalidade as ModalidadeDeContrato);
  return { texto: m.texto, tipoDoServico: m.tipoDoServico, base: 'molde' };
}

/** O preenchimento determinístico do registro: o passo do sistema, que vale sem IA nenhuma. */
export function preencherRegistro(e: EntradaDoPreenchimento): MoldePreenchido & { tipoDoServico: string; base: 'molde' | 'texto_simples' } {
  const { texto, tipoDoServico, base } = textoBaseDoRegistro(e);
  const escritos = { ...(e.camposDoPai ?? {}), ...camposEscritos(e.dados) };
  const campos = {
    ...juntarCampos(e.aceite, escritos),
    ...(e.tipo === 'contrato' ? {} : camposDoFilho(e.tipo, e.dados, e.vigenciaFim, e.pai ?? { numero: null, modalidade: null, assinadoEm: null, hash: null })),
  };
  const signatarios = [...e.signatarios]
    .sort((a, b) => a.ordem - b.ordem)
    .map((s) => ({ nome: s.nome, papel: s.papel === 'root' ? ('root' as const) : ('cliente' as const) }));
  const r = preencherMolde(texto, campos, { contratada: contratadaDoContrato(e.faturaPor, escritos), ...(signatarios.length ? { signatarios } : {}) });
  return { ...r, tipoDoServico, base };
}

/** O rodapé de toda página. Sem nome ou sem documento da contratada, a lacuna aparece e o PDF recusa. */
export function rodapeDaContratada(faturaPor: string | null, escritos: CamposEscritos): string {
  const c = contratadaDoContrato(faturaPor, escritos);
  return [c.nome ?? '⟦lacuna: contratada_nome⟧', c.documento ?? '⟦lacuna: contratada_documento⟧'].join(' · ');
}

/** O pedido do PDF: os mesmos insumos dão os mesmos bytes, e é isso que o efeito confere de novo. */
export function pedidoDoPdf(texto: string, e: EntradaDoPreenchimento, anexoFinal: string | null): PedidoDePdf {
  const r = preencherRegistro(e);
  const escritos = { ...(e.camposDoPai ?? {}), ...camposEscritos(e.dados) };
  return {
    texto,
    tipoDoServico: r.tipoDoServico,
    rodape: rodapeDaContratada(e.faturaPor, escritos),
    signatarios: r.signatarios,
    ...(anexoFinal ? { anexoFinal } : {}),
  };
}

// -------------------------------------------------------------------------
// A proposta aceita como parte final
// -------------------------------------------------------------------------

/** Texto que veio de fora não forja marca de lacuna nem de campo no PDF. */
const limpo = (v: unknown): string => String(v ?? '').replace(/[⟦⟧]/g, '').replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();

/**
 * O OS não guarda a proposta como um texto corrido: guarda a versão publicada no fio. O anexo é escrito a partir dela,
 * só com o que a versão aceita diz. Sem a publicada daquela versão (fechado fora, por exemplo), não há anexo.
 */
export function textoDaProposta(publicada: unknown, a: AceiteParaEmissao): string | null {
  const p = (publicada ?? null) as Record<string, unknown> | null;
  if (!p || Number(p.versao) !== a.versao) return null;
  const linha = TABELA_DE_PRECO[a.produto as keyof typeof TABELA_DE_PRECO];
  const { parcelaCentavos, ultimaParcelaCentavos } = a.parcelas > 0 ? parcelasDoValor(a.valorCentavos, a.parcelas) : { parcelaCentavos: a.valorCentavos, ultimaParcelaCentavos: a.valorCentavos };
  const ouvimos = Array.isArray(p.ouvimos) ? p.ouvimos.map(limpo).filter(Boolean) : [];
  const como = limpo(p.comoEDiferente);
  const formas = Array.isArray(p.formas) ? p.formas.map(limpo).filter(Boolean) : [];
  const linhas = [
    `Proposta versão ${a.versao}${typeof p.hash === 'string' ? `, código ${p.hash.slice(0, 12)}` : ''}.`,
    `Serviço: ${linha?.rotulo ?? a.produto}.${linha?.descricao ? ` ${limpo(linha.descricao)}` : ''}`,
    `Valor: ${formatarReais(a.valorCentavos)} em ${a.parcelas} parcela(s) de ${formatarReais(parcelaCentavos)}${ultimaParcelaCentavos !== parcelaCentavos ? `, a última de ${formatarReais(ultimaParcelaCentavos)}` : ''}.`,
    ...(formas.length ? [`Formas de pagamento: ${formas.join(', ')}.`] : []),
    ...(typeof p.validaAte === 'string' && p.validaAte ? [`Válida até ${limpo(p.validaAte)}.`] : []),
    ...(ouvimos.length ? ['O que ouvimos:', ...ouvimos.map((o, i) => `- (${String.fromCharCode(97 + (i % 26))}) ${o}`)] : []),
    ...(como ? [`Como é diferente: ${como}`] : []),
  ];
  return linhas.join('\n\n');
}

// -------------------------------------------------------------------------
// As conferências
// -------------------------------------------------------------------------

/**
 * A IA não reescreve o molde: cada trecho literal do preenchimento precisa continuar na resposta, na ordem. A marca
 * pode mudar de lacuna para inserção; a cláusula, não. Mudar cláusula é decisão dos sócios (`moldes-do-contrato.ts`).
 */
export function mantemAsClausulas(saida: string, preenchido: string): boolean {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const resposta = norm(saida);
  let desde = 0;
  for (const trecho of preenchido.split(/⟦(?:inserido|lacuna): [^⟧]*⟧/g).map(norm).filter((t) => t.length >= 12)) {
    const i = resposta.indexOf(trecho, desde);
    if (i < 0) return false;
    desde = i + trecho.length;
  }
  return true;
}

/** Grave é crítica ou alta. A lacuna aberta já tem linha própria no que falta para enviar. */
export function apontamentosGraves(apontamentos: readonly ApontamentoDoLaudo[]): ApontamentoDoLaudo[] {
  return apontamentos.filter((a) => (a.gravidade === 'critica' || a.gravidade === 'alta') && a.regra !== 'lacuna_aberta');
}

/** O que a minuta guarda para saber se ficou velha: modalidade, CNPJ que fatura e campos escritos. */
export function assinaturaDaEntrada(e: { modalidade: string | null; faturaPor: string | null; campos: CamposEscritos }): string {
  const ordenados = Object.fromEntries(Object.entries(e.campos).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify([e.modalidade, e.faturaPor?.trim() ?? '', ordenados]), 'utf8').digest('hex');
}

const ROTULOS: Record<string, string> = {
  contratante_nome: 'Razão social do contratante',
  contratante_documento: 'CNPJ ou CPF do contratante',
  contratante_endereco: 'Endereço do contratante',
  contratante_email: 'E-mail do contratante',
  contratante_apelido: 'Apelido do contratante (opcional)',
  contratante_representante: 'Quem representa o contratante',
  contratante_representante_cpf: 'CPF de quem representa',
  contratante_nacionalidade: 'Nacionalidade',
  contratante_estado_civil: 'Estado civil',
  contratante_profissao: 'Profissão',
  contratante_genero: 'Concordância do contratante (f ou m)',
  contratada_nome: 'Nome da contratada',
  contratada_qualificacao: 'Qualificação da contratada',
  contratada_pix: 'Chave Pix da contratada',
  valor_total: 'Valor total',
  valor_entrada: 'Valor da entrada',
  valor_saldo: 'Valor do saldo',
  valor_parcela: 'Valor de cada parcela do saldo',
  numero_parcelas: 'Número de parcelas do saldo',
  objeto_implantacao: 'O que será implantado',
  entregas: 'Entregas (uma por linha)',
  exclusoes: 'O que não entra (uma por linha)',
  pauta_encontros: 'Pauta dos encontros (uma por linha)',
  prazo_implantacao_dias: 'Prazo da implantação, em dias',
  prazo_acompanhamento_dias: 'Prazo do acompanhamento, em dias',
  prazo_meses: 'Prazo, em meses',
  numero_encontros: 'Número de encontros',
  periodicidade_encontros: 'Periodicidade dos encontros',
  frequencia_encontros: 'Frequência dos encontros',
  duracao_encontro_horas: 'Duração do encontro, em horas',
  data_primeiro_encontro: 'Data do primeiro encontro',
  acessos_contratante: 'Acessos que o contratante libera',
  participantes_encontros: 'Quem participa dos encontros',
  condutor: 'Quem conduz os encontros',
  foco_consultoria: 'Foco da consultoria',
  credito_continuidade: 'Abater o valor em contrato de continuidade',
};

const rotuloDoCampo = (nome: string): string => ROTULOS[nome] ?? nome.replace(/_/g, ' ');

/** Campos que não são da pessoa: a qualificação se monta sozinha, o documento da contratada é `faturaPor`. */
const FORA_DA_TELA = new Set(['contratante_qualificacao', 'contratada_documento', 'contratante_tipo', 'contratante_assinante', 'contratante_documento_assinatura', 'contratante_representacao', 'contratante_representante_genero']);

/** O que a seção "Dados que entram no molde" mostra: cada campo e de onde ele vem. */
export function camposParaATela(e: Pick<EntradaDoPreenchimento, 'tipo' | 'modalidade' | 'dados' | 'aceite' | 'camposDoPai' | 'faturaPor'>): CampoDaEmissao[] {
  const { texto } = textoBaseDoRegistro(e);
  const doAceite = camposDoAceite(e.aceite);
  const escritos = { ...(e.camposDoPai ?? {}), ...camposEscritos(e.dados) };
  const vistos = new Map<string, CampoDaEmissao['tipo']>();
  for (const m of texto.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const bruto = m[1].trim();
    const nome = bruto.replace(/^(?:lista|opcional):/, '').split('|')[0];
    if (!vistos.has(nome)) vistos.set(nome, bruto.startsWith('lista:') ? 'lista' : bruto.startsWith('opcional:') ? 'opcional' : 'texto');
  }
  // A qualificação do contratante pede campos soltos; só os do tipo de parte certo aparecem.
  const pj = String(doAceite.contratante_tipo ?? 'PJ') === 'PJ';
  const daQualificacao = pj ? ['contratante_documento', 'contratante_endereco', 'contratante_email', 'contratante_representante', 'contratante_representante_cpf'] : ['contratante_documento', 'contratante_endereco', 'contratante_email', 'contratante_nacionalidade', 'contratante_estado_civil', 'contratante_profissao'];
  for (const nome of ['contratante_genero', ...daQualificacao]) if (!vistos.has(nome)) vistos.set(nome, 'texto');
  if (e.tipo !== 'contrato') {
    vistos.delete('referencia_ao_contrato');
    vistos.delete('mudancas');
    vistos.delete('data_de_encerramento');
  }
  return [...vistos.entries()]
    .filter(([nome]) => !FORA_DA_TELA.has(nome))
    .map(([nome, tipo]) => {
      const aceito = doAceite[nome];
      const escrito = escritos[nome];
      const valor = aceito !== undefined ? (nome === 'valor_total' ? formatarReais(Math.round(Number(aceito) * 100)) : String(aceito)) : escrito ?? null;
      // Apelido e concordância têm padrão: em branco não é falta.
      const opcional = nome === 'contratante_apelido' || nome === 'contratante_genero';
      const fonte: CampoDaEmissao['fonte'] = aceito !== undefined ? 'aceite' : escrito !== undefined || opcional ? 'contrato' : 'falta';
      return { nome, rotulo: rotuloDoCampo(nome), tipo, fonte, valor };
    });
}
