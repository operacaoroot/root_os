import { formatarReais } from '@mktos/shared';

import { inteiroPorExtenso, reaisPorExtenso } from './extenso';

/*
 * PREENCHER O MOLDE DO CONTRATO DA ROOT (Contratos, F2, 02/11/2026) — puro, sem Nest.
 *
 * Porta para TypeScript da lógica de `scripts/preencher.py` da skill root-contrato, sobre o
 * TEXTO do molde em vez do .docx (D2b do roteiro). O que faz, na ordem do script:
 *   1. monta a qualificação do CONTRATANTE (PJ ou PF) a partir dos campos soltos;
 *   2. resolve `[[opcional:x]]` e expande `[[lista:x]]` em alíneas, com a pontuação e as
 *      letras refeitas;
 *   3. troca `[[campo]]` e os formatos `|reais`, `|num`, `|num_f`, `|ordinal`, `|apelido`;
 *   4. troca a concordância para "o CONTRATANTE" quando `contratante_genero` = m;
 *   5. confere as somas (só avisa).
 *
 * NUNCA INVENTA DADO: campo sem valor vira `⟦lacuna: campo⟧`, a mesma marca da minuta
 * (`minuta.ts`), e o PDF recusa enquanto houver uma. O valor entra numa passada só: um
 * `[[campo]]` escrito dentro de um valor não é expandido, vira lacuna.
 *
 * Duas diferenças de propósito para o script: texto vazio e `null` valem lacuna em todo
 * campo (o script aceitava `""` em `[[x]]` e `null` em `[[opcional:x]]`; só `|apelido`
 * continua sumindo com vazio); e o nome da parte no parágrafo de qualificação leva `**`,
 * que no .docx era o negrito do run.
 */

export type CamposDoContrato = Record<string, unknown>;

/** O que é do contrato, não do aceite (D6: o CNPJ que fatura é campo do contrato). */
export interface DadosDoContrato {
  contratada?: {
    nome?: string | null;
    qualificacao?: string | null;
    /** "CNPJ 00.000.000/0000-00", como vai ao bloco de assinatura. */
    documento?: string | null;
    pix?: string | null;
  };
  /** Quem assina (D4, D7). Sem isto, um bloco por parte, como no .docx. */
  signatarios?: ReadonlyArray<{ nome: string; papel: 'cliente' | 'root' }>;
}

/** Um bloco de assinatura: a linha, o nome em negrito e as linhas abaixo dele. */
export interface BlocoDeAssinatura {
  nome: string;
  linhas: string[];
}

export interface MoldePreenchido {
  texto: string;
  /** O nome de cada lacuna, sem repetir, na ordem do texto. */
  lacunas: string[];
  /** Soma que não fecha, valor mal formado, concordância trocada. */
  avisos: string[];
  signatarios: BlocoDeAssinatura[];
}

const TOKEN = /\[\[([^\]]+)\]\]/g;
const ALINEA = /^- \(([a-z]+)\) /;

function marcaDeLacuna(nome: string): string {
  return `⟦lacuna: ${nome.replace(/[⟦⟧]/g, '').trim() || 'a decidir'}⟧`;
}

function nomeDoToken(corpo: string): string {
  return corpo
    .replace(/^(?:preencher|lista|opcional):\s*/, '')
    .split('|')[0]
    .trim();
}

/** Um valor pronto para entrar no texto: uma linha, sem marca forjada, `[[x]]` vira lacuna. */
function limparValor(v: unknown): string {
  return String(v)
    .replace(/[⟦⟧]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TOKEN, (_t, corpo: string) => marcaDeLacuna(nomeDoToken(corpo)));
}

function temValor(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// ------------------------------------------------------------------- formatos ---

/** 3970, 3970.5, "3970", "3.970,00", "R$ 1.234.567,89" em centavos. Lança se não for valor. */
export function centavosDoValor(v: unknown): number {
  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else {
    let s = String(v).replace(/R\$/g, '').replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`valor em reais ilegível: "${String(v)}"`);
    n = Number(s);
  }
  if (!Number.isFinite(n) || n < 0) throw new Error(`valor em reais ilegível: "${String(v)}"`);
  return Math.round(n * 100);
}

function inteiroDoValor(v: unknown): number {
  const c = centavosDoValor(v);
  if (c % 100 !== 0) throw new Error(`esperava número inteiro, veio "${String(v)}"`);
  return c / 100;
}

/** O extenso de `extenso.ts` no feminino ("duas", "duzentas", "duas mil"); milhão segue masculino. */
function inteiroNoFeminino(n: number): string {
  const texto = inteiroPorExtenso(n);
  const corte = /milh(?:ão|ões)/g;
  let inicio = 0;
  for (const m of texto.matchAll(corte)) inicio = (m.index ?? 0) + m[0].length;
  return (
    texto.slice(0, inicio) +
    texto
      .slice(inicio)
      .replace(/\bum\b/g, 'uma')
      .replace(/\bdois\b/g, 'duas')
      .replace(/(\p{L}+)entos\b/gu, '$1entas')
  );
}

const ORDINAL_UNIDADE = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono'];
const ORDINAL_DEZENA = ['', 'décimo', 'vigésimo', 'trigésimo', 'quadragésimo', 'quinquagésimo', 'sexagésimo', 'septuagésimo', 'octogésimo', 'nonagésimo'];
const ORDINAL_CENTENA = ['', 'centésimo', 'ducentésimo', 'trecentésimo', 'quadringentésimo', 'quingentésimo', 'sexcentésimo', 'septingentésimo', 'octingentésimo', 'noningentésimo'];

function ordinalPorExtenso(n: number): string {
  if (n < 1 || n > 999) throw new Error(`ordinal só de 1 a 999, veio ${n}`);
  return [ORDINAL_CENTENA[Math.floor(n / 100)], ORDINAL_DEZENA[Math.floor((n % 100) / 10)], ORDINAL_UNIDADE[n % 10]].filter(Boolean).join(' ');
}

const FORMATOS: Record<string, (v: unknown) => string> = {
  reais: (v) => {
    const c = centavosDoValor(v);
    return `${formatarReais(c)} (${reaisPorExtenso(c)})`;
  },
  num: (v) => {
    const n = inteiroDoValor(v);
    return `${n} (${inteiroPorExtenso(n)})`;
  },
  num_f: (v) => {
    const n = inteiroDoValor(v);
    return `${n} (${inteiroNoFeminino(n)})`;
  },
  ordinal: (v) => {
    const n = inteiroDoValor(v);
    return `${n}º (${ordinalPorExtenso(n)})`;
  },
};

// --------------------------------------------------------- qualificação PJ/PF ---

const LUGAR_MASCULINO = new Set(['largo', 'beco', 'conjunto', 'condomínio', 'parque', 'setor', 'sítio', 'loteamento', 'lote', 'km']);

function preposicaoDoEndereco(endereco: string): string {
  const primeira = endereco.trim().split(' ')[0].toLowerCase().replace(/\.+$/, '');
  return LUGAR_MASCULINO.has(primeira) ? 'no' : 'na';
}

function comecaCom(v: unknown, letra: string, padrao: string): boolean {
  return String(v ?? padrao).toLowerCase().startsWith(letra);
}

/** A qualificação, o assinante e o documento da assinatura, quando não vêm prontos. */
function montarQualificacao(c: CamposDoContrato): CamposDoContrato {
  const ou = (chave: string, rotulo: string) => (temValor(c[chave]) ? String(c[chave]) : `[[preencher: ${rotulo}]]`);
  const tipo = String(c.contratante_tipo ?? '').toUpperCase();
  const feminino = comecaCom(c.contratante_genero, 'f', 'f');
  const endereco = String(c.contratante_endereco ?? '');
  const prep = endereco ? preposicaoDoEndereco(endereco) : 'na';
  const enderecoTexto = ou('contratante_endereco', 'endereço completo com CEP');
  const email = ou('contratante_email', 'e-mail do contratante');
  const doc = ou('contratante_documento', tipo === 'PJ' ? 'CNPJ' : 'CPF');
  let novos: CamposDoContrato = {};
  if (tipo === 'PJ') {
    const representante = ou('contratante_representante', 'nome do representante');
    const cpf = ou('contratante_representante_cpf', 'CPF do representante');
    const repFeminina = comecaCom(c.contratante_representante_genero, 'f', 'm');
    const forma = temValor(c.contratante_representacao) ? String(c.contratante_representacao) : repFeminina ? 'por sua sócia-administradora' : 'por seu sócio-administrador';
    novos = {
      contratante_qualificacao: `inscrita no CNPJ sob o nº ${doc}, com sede ${prep} ${enderecoTexto}, e-mail ${email}, neste ato representada ${forma}, **${representante}**, ${repFeminina ? 'inscrita' : 'inscrito'} no CPF sob o nº ${cpf}`,
      contratante_assinante: temValor(c.contratante_representante) ? c.contratante_representante : '[[preencher: representante que assina]]',
      contratante_documento_assinatura: `CNPJ ${doc}`,
    };
  } else if (tipo === 'PF') {
    novos = {
      contratante_qualificacao: `${ou('contratante_nacionalidade', 'nacionalidade')}, ${ou('contratante_estado_civil', 'estado civil')}, ${ou('contratante_profissao', 'profissão')}, ${feminino ? 'inscrita' : 'inscrito'} no CPF sob o nº ${doc}, ${feminino ? 'residente e domiciliada' : 'residente e domiciliado'} ${prep} ${enderecoTexto}, e-mail ${email}`,
      contratante_assinante: '',
      contratante_documento_assinatura: `CPF ${doc}`,
    };
  }
  return { ...novos, ...c };
}

// ------------------------------------------------------------------- listas ---

function textoDoItem(item: unknown): string {
  if (item !== null && typeof item === 'object') {
    const { titulo, texto } = item as { titulo?: unknown; texto?: unknown };
    const t = String(titulo ?? '').trim().replace(/:+$/, '');
    const corpo = String(texto ?? '').trim();
    return t ? `**${t}:** ${corpo}` : corpo;
  }
  return String(item).trim();
}

/** Último item em ".", penúltimo em "; e", demais em ";". Com alíneas fixas depois, todos em ";". */
function pontuar(textos: string[], fechaOGrupo: boolean): string[] {
  return textos.map((bruto, i) => {
    const t = bruto.trimEnd().replace(/[;.,]\s*(?:e|ou)?\s*$/, '');
    if (fechaOGrupo && i === textos.length - 1) return `${t}.`;
    if (fechaOGrupo && i === textos.length - 2) return `${t}; e`;
    return `${t};`;
  });
}

function letraDaAlinea(i: number): string {
  const letra = (n: number) => String.fromCharCode(97 + n);
  return i < 26 ? letra(i) : letra(Math.floor(i / 26) - 1) + letra(i % 26);
}

/** As letras de cada grupo de alíneas de novo a partir de (a). Linha em branco não fecha o grupo. */
function reletrar(linhas: readonly string[]): string[] {
  let i = 0;
  return linhas.map((linha) => {
    if (ALINEA.test(linha)) return linha.replace(ALINEA, `- (${letraDaAlinea(i++)}) `);
    if (linha.trim()) i = 0;
    return linha;
  });
}

/** Opcionais e listas: a parte do preenchimento que muda a estrutura do texto. */
function resolverEstrutura(molde: string, campos: CamposDoContrato): string[] {
  const entrada = molde.split('\n');
  const saida: string[] = [];
  entrada.forEach((linha, n) => {
    const opcional = linha.match(/\[\[opcional:([a-z0-9_]+)\]\]/);
    if (opcional) {
      const valor = campos[opcional[1]];
      if (valor === null || valor === undefined) saida.push(linha);
      else if (valor) saida.push(linha.replace(opcional[0], ''));
      return;
    }
    const lista = linha.match(/\[\[lista:([a-z0-9_]+)\]\]/);
    if (lista && Array.isArray(campos[lista[1]])) {
      const itens = campos[lista[1]] as unknown[];
      const seguinte = entrada.slice(n + 1).find((l) => l.trim());
      const textos = pontuar(itens.map(textoDoItem), !seguinte || !ALINEA.test(seguinte));
      for (const t of textos) saida.push(`- (a) ${limparValor(t)}`);
      return;
    }
    saida.push(linha);
  });
  return reletrar(saida);
}

// ------------------------------------------------------------ concordância (m) ---

const ARTIGO_MASCULINO: Record<string, string> = { a: 'o', à: 'ao', da: 'do', pela: 'pelo', na: 'no', A: 'O', À: 'Ao', Da: 'Do', Pela: 'Pelo', Na: 'No' };

/** "a CONTRATANTE" vira "o CONTRATANTE" e afins. Imperfeito como o do script: pede revisão, e o aviso diz. */
function masculinizar(texto: string): { texto: string; trocas: number } {
  let trocas = 0;
  const conta = (de: string | RegExp, para: string, t: string) =>
    t.replace(de as RegExp, (...a) => {
      trocas += 1;
      return typeof de === 'string' ? para : para.replace('$1', String(a[1]));
    });
  let t = texto.replace(/(^|[\s“(])(a|à|da|pela|na|A|À|Da|Pela|Na) CONTRATANTE\b/gm, (_t, antes: string, artigo: string) => {
    trocas += 1;
    return `${antes}${ARTIGO_MASCULINO[artigo]} CONTRATANTE`;
  });
  t = conta(/DA CONTRATANTE/g, 'DO CONTRATANTE', t);
  t = t.replace(/CONTRATANTE figura como controladora/g, 'CONTRATANTE figura como controlador');
  t = conta(/propriedade exclusiva desta\./g, 'propriedade exclusiva deste.', t);
  t = conta(/, e ela poderá/g, ', e ele poderá', t);
  return { texto: t, trocas };
}

// ------------------------------------------------------------------- somas ---

function conferirSomas(c: CamposDoContrato): string[] {
  const avisos: string[] = [];
  try {
    const { valor_total: total, valor_entrada: entrada, valor_saldo: saldo, numero_parcelas: parcelas, valor_parcela: parcela } = c;
    if (temValor(total) && temValor(entrada) && temValor(saldo) && centavosDoValor(entrada) + centavosDoValor(saldo) !== centavosDoValor(total)) {
      avisos.push(`soma não fecha: entrada ${formatarReais(centavosDoValor(entrada))} + saldo ${formatarReais(centavosDoValor(saldo))} é diferente do total ${formatarReais(centavosDoValor(total))}`);
    }
    if (temValor(parcelas) && temValor(parcela) && temValor(saldo) && inteiroDoValor(parcelas) * centavosDoValor(parcela) !== centavosDoValor(saldo)) {
      avisos.push(`parcelas não fecham: ${String(parcelas)} x ${formatarReais(centavosDoValor(parcela))} é diferente do saldo ${formatarReais(centavosDoValor(saldo))}`);
    }
  } catch (e) {
    avisos.push(`não deu para conferir as somas: ${(e as Error).message}`);
  }
  return avisos;
}

// ---------------------------------------------------------------- assinaturas ---

function blocosDeAssinatura(c: CamposDoContrato, signatarios: DadosDoContrato['signatarios']): BlocoDeAssinatura[] {
  const ou = (chave: string) => (temValor(c[chave]) ? limparValor(c[chave]) : marcaDeLacuna(chave));
  const contratada = ou('contratada_nome');
  const contratante = ou('contratante_nome');
  const docContratada = ou('contratada_documento');
  const docContratante = ou('contratante_documento_assinatura');
  if (signatarios?.length) {
    return signatarios.map((s) => ({
      nome: limparValor(s.nome),
      linhas: s.papel === 'root' ? ['CONTRATADA', contratada, docContratada] : ['CONTRATANTE', contratante, docContratante],
    }));
  }
  const assinante = c.contratante_assinante;
  return [
    { nome: contratada, linhas: [docContratada, 'CONTRATADA'] },
    { nome: contratante, linhas: ['CONTRATANTE', ...(temValor(assinante) ? [limparValor(assinante)] : []), docContratante] },
  ];
}

// ---------------------------------------------------------------- a entrada ---

function juntarCampos(aceite: CamposDoContrato, contrato: DadosDoContrato): CamposDoContrato {
  const campos = Object.fromEntries(Object.entries(aceite).filter(([k]) => !k.startsWith('_')));
  const { contratada } = contrato;
  if (!contratada) return campos;
  // Com a contratada no contrato, é ela e só ela: campo vazio ali é lacuna, nunca o valor do aceite.
  return {
    ...campos,
    contratada_nome: contratada.nome,
    contratada_qualificacao: contratada.qualificacao,
    contratada_documento: contratada.documento,
    contratada_pix: contratada.pix,
  };
}

/**
 * Preenche o texto de um molde (`moldeDoContrato(m).texto`) com os dados do aceite e do
 * contrato. O contrato vence o aceite na contratada; quem faltar vira `⟦lacuna: campo⟧`.
 */
export function preencherMolde(molde: string, aceite: CamposDoContrato, contrato: DadosDoContrato = {}): MoldePreenchido {
  const campos = montarQualificacao(juntarCampos(aceite, contrato));
  const avisos: string[] = [];

  const resolver = (corpo: string): string | null => {
    if (/^(?:preencher|lista|opcional):/.test(corpo)) return null;
    const [nomeBruto, formato] = corpo.split('|');
    const nome = nomeBruto.trim();
    const valor = campos[nome];
    if (formato === 'apelido') {
      if (valor === null || valor === undefined) return null;
      const apelido = limparValor(valor);
      return apelido ? ` ou “${apelido}”` : '';
    }
    if (!temValor(valor)) return null;
    if (!formato) return limparValor(valor);
    const formatar = FORMATOS[formato];
    if (!formatar) {
      avisos.push(`campo ${nome}: formato desconhecido "${formato}"`);
      return null;
    }
    try {
      return formatar(valor);
    } catch (e) {
      avisos.push(`campo ${nome}: ${(e as Error).message}`);
      return null;
    }
  };

  const linhas = resolverEstrutura(molde, campos).map((linha) => {
    const parte = /^CONTRAT(?:ADA|ANTE): /.test(linha);
    return linha.replace(TOKEN, (_t, corpo: string) => {
      const valor = resolver(corpo);
      if (valor === null) return marcaDeLacuna(nomeDoToken(corpo));
      // O nome da parte vai em negrito, como no run do .docx.
      return parte && /^contrat(?:ada|ante)_nome$/.test(corpo) ? `**${valor}**` : valor;
    });
  });

  let texto = linhas.join('\n').replace(/\n{3,}/g, '\n\n');
  if (comecaCom(campos.contratante_genero, 'm', 'f')) {
    const r = masculinizar(texto);
    texto = r.texto;
    avisos.push(`concordância trocada para o masculino (${r.trocas} trocas): revise "o CONTRATANTE", "controlador" e "deste".`);
  }
  avisos.push(...conferirSomas(campos));

  const signatarios = blocosDeAssinatura(campos, contrato.signatarios);
  const todoOTexto = [texto, ...signatarios.flatMap((s) => [s.nome, ...s.linhas])].join('\n');
  const lacunas = [...new Set([...todoOTexto.matchAll(/⟦lacuna: ([^⟧]*)⟧/g)].map((m) => m[1].trim()))];
  return { texto, lacunas, avisos, signatarios };
}
