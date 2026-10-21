import { createHash } from 'node:crypto';

import type { ComercialEtapa, ComercialProduto } from '@mktos/shared';

/*
 * O IMPORTADOR DO CRM ANTIGO: A PARTE PURA (rodada de produção 1, 21/10/2026).
 *
 * O CRM que a Root usava antes do Comercial são duas listas `cadastro` do Trabalho,
 * na pasta "CRM": "Gestão de Leads" (um cartão por lead ou cliente, com o status do
 * funil antigo) e "Contratos dos clientes" (uma subtarefa por contrato, filha do
 * cartão do cliente). Aqui mora o que não precisa de banco: ler o cartão (empresa,
 * contato, campos), decidir para onde ele vai pelo NOME do status e montar o plano.
 *
 * NADA INVENTADO. A tabela de status é fechada: status que não está nela vira sobra,
 * com o motivo, e o cartão fica onde está. Campo vazio fica vazio. Nenhum nome de
 * cliente mora neste arquivo: só nomes de status, de campo e de lista.
 */

/** Os nomes das listas e da pasta do CRM antigo, normalizados (`normalizar`). */
export const PASTA_DO_CRM = 'crm';
export const LISTA_DE_LEADS = 'gestao de leads';
export const LISTA_DE_CONTRATOS = 'contratos dos clientes';
/** A lista de teste que a ata manda tirar (os cartões são arquivados, a lista também). */
export const LISTA_DE_TESTE = 'teste teste';
/** A lista solta de marketing: a tarefa vai para a pasta de marketing, e a lista vazia é arquivada. */
export const LISTA_SOLTA_DE_MARKETING = 'marketing';
export const PASTA_DE_MARKETING = 'demandas internas marketing';
export const LISTA_DE_DEMANDAS_GERAIS = 'demandas gerais';
/** A pasta que a estrutura sugerida de antes criava e a nova não cria mais: vazia, é arquivada. */
export const PASTA_ADMINISTRATIVA = 'administrativa';
/** Listas soltas que ficam onde estão sem entrar nas sobras (a ata decidiu). */
export const LISTAS_SOLTAS_QUE_FICAM = new Set(['operacao']);
/**
 * A lista solta "Comercial" (adendo A1): a lista da ÁREA Comercial, sem pasta. As tarefas
 * dela vão para a lista do comercial (`work/lista-do-comercial.ts`), ligadas ao lead que
 * o título cita quando o casamento é seguro, e a lista vazia é arquivada.
 */
export const LISTA_SOLTA_COMERCIAL = 'comercial';
/**
 * Listas soltas de um CONTATO que a ata manda tirar (adendo A2), pelo sha256 do nome
 * normalizado (`hashDoNome`): o nome de uma pessoa não entra no código. Os cartões são
 * arquivados e a lista também (a regra da "Teste teste": arquivar, nunca apagar).
 */
export const LISTAS_DE_CONTATO_A_TIRAR: readonly string[] = [
  // a lista solta de um contato, 1 cartão de lixo, a ata de 21/10 manda tirar
  '9d60c70860d2439aa41c0262e90ba579deb9b51ecbbcbcb9c9558f0b376964dc',
];

/** Minúsculas, sem acento, só letras e números separados por um espaço. */
export function normalizar(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** O sha256 do nome normalizado: para achar uma lista sem escrever o nome dela no código. */
export function hashDoNome(nome: string | null | undefined): string {
  return createHash('sha256').update(normalizar(nome)).digest('hex');
}

export type DestinoDoStatus =
  | { tipo: 'lead'; etapa: Extract<ComercialEtapa, 'qualificacao' | 'follow_up'> }
  | { tipo: 'cliente'; etapaDoCard: string | null };

/**
 * A REGRA DE ETAPA, pelo nome do status do cartão (normalizado). Kickoff e Implantação
 * abrem o card da implantação; Recorrente e Depoimento ficam só com o contrato vivo
 * (decisão do orquestrador, 21/10/2026: já passaram da implantação).
 */
export const DESTINO_DO_STATUS: Readonly<Record<string, DestinoDoStatus>> = {
  validar: { tipo: 'lead', etapa: 'qualificacao' },
  followup: { tipo: 'lead', etapa: 'follow_up' },
  'follow up': { tipo: 'lead', etapa: 'follow_up' },
  kickoff: { tipo: 'cliente', etapaDoCard: 'Kickoff marcado' },
  // A implantação do CRM antigo começa depois do kickoff: a primeira etapa depois dele no
  // modelo "Onboarding de cliente". A equipe avança à mão o que já andou mais.
  implantacao: { tipo: 'cliente', etapaDoCard: 'Kit montado' },
  recorrente: { tipo: 'cliente', etapaDoCard: null },
  'depoimento e indicacao': { tipo: 'cliente', etapaDoCard: null },
};

export function destinoDoStatus(status: string): DestinoDoStatus | null {
  return DESTINO_DO_STATUS[normalizar(status)] ?? null;
}

export interface CampoDoCartao {
  nome: string;
  tipo: string;
  /** Valor em texto (texto, data AAAA-MM-DD, moeda "BRL 1500.00"); nas listas, o nome da opção. */
  valor: string | null;
}

export interface CartaoDoCrm {
  id: string;
  titulo: string;
  descricao: string | null;
  /** O nome normalizado da lista (`gestao de leads` ou `contratos dos clientes`). */
  lista: string;
  status: string;
  parentId: string | null;
  archived: boolean;
  criadoEm: Date;
  assigneeUserId: string | null;
  campos: CampoDoCartao[];
}

/** O valor do campo pelo nome normalizado (o primeiro que casar). */
export function campo(c: Pick<CartaoDoCrm, 'campos'>, ...nomes: string[]): string | null {
  for (const n of nomes) {
    const achado = c.campos.find((x) => normalizar(x.nome) === n);
    const v = achado?.valor?.trim();
    if (v) return v;
  }
  return null;
}

/** Empresa = o que vem antes do parêntese no título; contato = o que está dentro. Sem parêntese, só a empresa. */
export function empresaEContato(titulo: string): { empresa: string | null; contato: string | null } {
  const t = titulo.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*?)\s*\(([^)]*)\)/);
  const limpar = (s: string) => s.replace(/^[\s\-–—|·:]+|[\s\-–—|·:]+$/g, '').trim();
  if (!m) return { empresa: limpar(t) || null, contato: null };
  return { empresa: limpar(m[1]) || null, contato: limpar(m[2]) || null };
}

/** "BRL 1500.00" (o texto canônico da moeda do Trabalho) ou "1500,00" em centavos; ilegível = nulo. */
export function centavosDaMoeda(v: string | null): number | null {
  if (!v) return null;
  const s = v.replace(/^[A-Z]{3}\s+/, '').trim();
  let n: number;
  if (/^\d+(\.\d{1,2})?$/.test(s)) n = Number(s);
  else if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(s) || /^\d+(,\d{1,2})?$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else return null;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** AAAA-MM-DD válido, ou nulo. */
export function diaDoCampo(v: string | null): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** O CNPJ (14 dígitos) do campo CNPJ, ou escrito no título ou na descrição. */
export function cnpjDoCartao(c: Pick<CartaoDoCrm, 'campos' | 'titulo' | 'descricao'>): string | null {
  const doCampo = (campo(c, 'cnpj', 'cnpj cpf', 'documento') ?? '').replace(/\D/g, '');
  if (doCampo.length === 14) return doCampo;
  const texto = `${c.titulo}\n${c.descricao ?? ''}`;
  const m = texto.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
  const d = m ? m[0].replace(/\D/g, '') : '';
  return d.length === 14 ? d : null;
}

/** O produto do campo "Produto": o do catálogo do Comercial quando casa; o rótulo fica sempre. */
export function produtoDoCartao(c: Pick<CartaoDoCrm, 'campos'>): { produto: ComercialProduto | null; rotulo: string | null } {
  const rotulo = campo(c, 'produto');
  const n = normalizar(rotulo);
  if (n === 'imersao') return { produto: 'imersao', rotulo };
  if (n === 'operacao root' || n === 'operacao') return { produto: 'operacao', rotulo };
  return { produto: null, rotulo };
}

/** E-mail que passa no formato; senão nulo (o schema da entrada recusaria). */
export function emailDoCartao(c: Pick<CartaoDoCrm, 'campos'>): string | null {
  const e = (campo(c, 'e mail', 'email') ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

export function telefoneDoCartao(c: Pick<CartaoDoCrm, 'campos'>): string | null {
  const t = (campo(c, 'telefone', 'whatsapp', 'celular') ?? '').trim();
  return t.replace(/\D/g, '').length >= 8 ? t.slice(0, 40) : null;
}

/** O que o cartão de lead diz, já lido. */
export interface DadosDoLead {
  empresa: string;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  cnpj: string | null;
  produto: ComercialProduto | null;
  produtoRotulo: string | null;
  valorCentavos: number | null;
  valorRecorrenteCentavos: number | null;
  /** AAAA-MM-DD do campo "Data de Cadastro do Lead", ou nulo. */
  cadastradoEm: string | null;
  vendedor: string | null;
}

export function dadosDoLead(c: CartaoDoCrm): DadosDoLead {
  const { empresa, contato } = empresaEContato(c.titulo);
  const p = produtoDoCartao(c);
  return {
    empresa: (empresa ?? campo(c, 'empresa') ?? c.titulo).slice(0, 200),
    contato: contato ?? campo(c, 'contato'),
    telefone: telefoneDoCartao(c),
    email: emailDoCartao(c),
    cnpj: cnpjDoCartao(c),
    produto: p.produto,
    produtoRotulo: p.rotulo,
    valorCentavos: centavosDaMoeda(campo(c, 'valor da proposta', 'valor')),
    valorRecorrenteCentavos: centavosDaMoeda(campo(c, 'valor recorrente mes', 'valor recorrente')),
    cadastradoEm: diaDoCampo(campo(c, 'data de cadastro do lead', 'data de cadastro')),
    vendedor: campo(c, 'vendedor'),
  };
}

export interface DadosDoContrato {
  titulo: string;
  produto: ComercialProduto | null;
  produtoRotulo: string | null;
  valorCentavos: number | null;
  fechadoEm: string | null;
}

export function dadosDoContrato(c: CartaoDoCrm): DadosDoContrato {
  const p = produtoDoCartao(c);
  return {
    titulo: c.titulo.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Contrato',
    produto: p.produto,
    produtoRotulo: p.rotulo,
    valorCentavos: centavosDaMoeda(campo(c, 'valor', 'valor do contrato')),
    fechadoEm: diaDoCampo(campo(c, 'fechado em', 'data de fechamento', 'inicio')),
  };
}

/** O plano de um cartão de lead ou cliente. */
export interface CartaoNoPlano {
  cartao: CartaoDoCrm;
  destino: DestinoDoStatus;
  dados: DadosDoLead;
  contratos: { cartao: CartaoDoCrm; dados: DadosDoContrato }[];
}

export interface SobraDoPlano {
  cartaoId: string;
  titulo: string;
  onde: string;
  motivo: string;
}

export interface PlanoDoCrm {
  cartoes: CartaoNoPlano[];
  sobras: SobraDoPlano[];
}

/**
 * Monta o plano: cada cartão de "Gestão de Leads" (sem pai) pelo status; cada
 * subtarefa de "Contratos dos clientes" no cartão de cliente que é o pai dela.
 * A ordem é a de criação (e o id no empate): a mesma em toda passada.
 */
export function montarPlano(cartoes: readonly CartaoDoCrm[]): PlanoDoCrm {
  const ordem = [...cartoes].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime() || a.id.localeCompare(b.id));
  const sobras: SobraDoPlano[] = [];
  const noPlano = new Map<string, CartaoNoPlano>();
  const nomeDaLista = (l: string) => (l === LISTA_DE_LEADS ? 'CRM / Gestão de Leads' : l === LISTA_DE_CONTRATOS ? 'CRM / Contratos dos clientes' : l);
  for (const c of ordem) {
    if (c.lista !== LISTA_DE_LEADS) continue;
    if (c.parentId) {
      sobras.push({ cartaoId: c.id, titulo: c.titulo, onde: nomeDaLista(c.lista), motivo: 'subtarefa de um cartão de lead: fica onde está' });
      continue;
    }
    const destino = destinoDoStatus(c.status);
    if (!destino) {
      sobras.push({ cartaoId: c.id, titulo: c.titulo, onde: nomeDaLista(c.lista), motivo: `status "${c.status}" fora da regra de etapa: fica onde está, nada inventado` });
      continue;
    }
    noPlano.set(c.id, { cartao: c, destino, dados: dadosDoLead(c), contratos: [] });
  }
  for (const c of ordem) {
    if (c.lista !== LISTA_DE_CONTRATOS) continue;
    const pai = c.parentId ? noPlano.get(c.parentId) : undefined;
    if (!pai) {
      sobras.push({ cartaoId: c.id, titulo: c.titulo, onde: nomeDaLista(c.lista), motivo: 'contrato sem cartão de cliente como pai na Gestão de Leads: fica onde está' });
      continue;
    }
    if (pai.destino.tipo !== 'cliente') {
      sobras.push({ cartaoId: c.id, titulo: c.titulo, onde: nomeDaLista(c.lista), motivo: `contrato de um cartão em "${pai.cartao.status}", que não é de cliente: fica onde está` });
      continue;
    }
    pai.contratos.push({ cartao: c, dados: dadosDoContrato(c) });
  }
  return { cartoes: [...noPlano.values()], sobras };
}

/** O lead que já existe e é o mesmo cliente: pelo CNPJ, senão pelo nome normalizado da empresa. */
export interface LeadExistente {
  id: string;
  nome: string;
  empresa: string | null;
  cnpj: string | null;
  /** O contato do cartão do CRM (o que estava no parêntese), quando o lead veio de lá. */
  contato?: string | null;
}

export function acharLeadDuplicado(
  d: Pick<DadosDoLead, 'cnpj' | 'empresa'>,
  leads: readonly LeadExistente[],
): { id: string; como: 'cnpj' | 'nome' } | null {
  const doc = (d.cnpj ?? '').replace(/\D/g, '');
  if (doc.length === 14) {
    const l = leads.find((x) => (x.cnpj ?? '').replace(/\D/g, '') === doc);
    if (l) return { id: l.id, como: 'cnpj' };
  }
  const alvo = normalizar(d.empresa);
  if (alvo.length >= 3) {
    const l = leads.find((x) => normalizar(x.empresa) === alvo || normalizar(x.nome) === alvo);
    if (l) return { id: l.id, como: 'nome' };
  }
  return null;
}

/** A etapa do lead já está no alvo ou além dele (no funil ativo)? Então o importador não move. */
const ORDEM: readonly ComercialEtapa[] = ['novo_lead', 'qualificacao', 'reuniao_agendada', 'sessao', 'diagnostico', 'proposta', 'follow_up', 'contrato', 'fechado'];
export function precisaMover(de: ComercialEtapa, para: ComercialEtapa): 'mover' | 'ja_esta' | 'alem' | 'saida' {
  if (de === para) return 'ja_esta';
  const i = ORDEM.indexOf(de);
  if (i < 0) return 'saida';
  return i < ORDEM.indexOf(para) ? 'mover' : 'alem';
}

/** O vendedor do cartão vira o dono quando casa, sem ambiguidade, com o primeiro nome de uma pessoa ativa. */
export function donoPeloVendedor(vendedor: string | null, pessoas: readonly { id: string; nome: string | null }[]): string | null {
  const v = normalizar(vendedor);
  if (!v) return null;
  const casam = pessoas.filter((p) => normalizar(p.nome).split(' ')[0] === v.split(' ')[0]);
  return casam.length === 1 ? casam[0].id : null;
}

/** A etapa da lista de destino para uma tarefa movida: o mesmo nome; senão a primeira do mesmo tipo; senão a primeira. */
export function etapaNoDestino<T extends { id: string; name: string; type: string }>(etapas: readonly T[], atual: { name: string; type: string }): T | null {
  return etapas.find((e) => normalizar(e.name) === normalizar(atual.name))
    ?? etapas.find((e) => e.type === atual.type)
    ?? etapas[0]
    ?? null;
}

/*
 * A LISTA SOLTA "COMERCIAL" (adendo A1, 21/10/2026): QUAL TAREFA CITA QUAL LEAD.
 *
 * As tarefas dela são do comercial, não leads. A que cita um lead pelo nome no título
 * passa a apontar para ele; a que não cita fica como tarefa do comercial sem lead. A
 * regra é pelo TÍTULO, escrita aqui, sem nome nenhum:
 *
 *  1. O NOME CITADO. O título é partido no separador com espaços (" — ", " – " ou " - ").
 *     Se a primeira parte começa por um prefixo de ação que é sempre seguido de um nome
 *     (FUP, Follow up, Proposta, Marcar/Agendar/Remarcar/Confirmar reunião, Indicação,
 *     Acionar indicação), o nome é o resto dela, sem os conectivos ("com o", "do"...); se
 *     ela é SÓ o prefixo ("Marcar reunião - X"), o nome é a parte seguinte. Sem prefixo,
 *     a forma "<Nome> — <ação>" vale quando a segunda parte começa por um verbo de ação e
 *     a primeira não. O resto é TAREFA INTERNA (sem nome citado). Verbo genérico no
 *     começo ("Cobrar...", "Checar...") NÃO é prefixo: o que vem depois dele não é um nome.
 *  2. INDICAÇÃO. "Indicação do X" cita quem indicou, que não é o lead: ambígua, sempre.
 *  3. O CASAMENTO, contra os leads que existem e os que o CRM cria na mesma passada. As
 *     chaves de cada lead são as do dedupe do importador (nome normalizado do lead, da
 *     empresa e do contato) mais a parte do nome antes de "|" ou "(" (empresa) e a de
 *     depois (contato). Liga quando o citado é IGUAL a uma chave, ou quando COMEÇA pela
 *     chave de empresa em palavras inteiras ("Proposta X e instalação" casa com "X | Y").
 *     Igual ganha de começa; dois leads no mesmo degrau é ambíguo.
 *  4. AMBÍGUO NUNCA LIGA: um nome só que só é igual ao contato de alguém, ou a nada
 *     (primeiro nome sozinho); nome parecido sem ser igual (prefixo comum de 4+ letras,
 *     uma palavra igual sem o resto, grafia abreviada); mais de um lead candidato. Vai às
 *     sobras do plano com o motivo e entra como tarefa do comercial sem lead.
 *  5. CITADO SEM CASAR E SEM PARECIDO, com duas palavras ou mais: o importador cria o lead
 *     em Qualificação (origem `cartao:<id da tarefa>`). Tarefa concluída liga a lead que
 *     existe, mas nunca cria lead: o histórico não abre conversa nova.
 */

/** Prefixos de ação (tokens normalizados) que são sempre seguidos do nome de quem se trata. */
const PREFIXOS_COM_NOME: readonly { tokens: readonly string[]; indicacao?: true }[] = [
  { tokens: ['acionar', 'indicacao'], indicacao: true },
  { tokens: ['indicacao'], indicacao: true },
  { tokens: ['marcar', 'reuniao'] },
  { tokens: ['agendar', 'reuniao'] },
  { tokens: ['remarcar', 'reuniao'] },
  { tokens: ['confirmar', 'reuniao'] },
  { tokens: ['follow', 'up'] },
  { tokens: ['followup'] },
  { tokens: ['fup'] },
  { tokens: ['proposta'] },
];

/** Conectivos que separam o prefixo do nome ("com o", "do", "para a"...). */
const CONECTIVOS = new Set(['com', 'o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'de', 'para', 'pra', 'pro', 'ao', 'aos', 'na', 'no']);

/** Verbos que abrem uma ação: na forma "<Nome> — <ação>", a ação começa por um deles e o nome não. */
const VERBOS_DE_ACAO = new Set([
  'marcar', 'agendar', 'remarcar', 'confirmar', 'cobrar', 'fazer', 'enviar', 'mandar', 'ligar', 'retomar',
  'responder', 'falar', 'chamar', 'lembrar', 'acompanhar', 'verificar', 'checar', 'conferir', 'atualizar',
  'estudar', 'colher', 'entrar', 'entrada', 'criar', 'montar', 'revisar', 'preparar', 'organizar', 'acionar',
  'abastecer', 'definir', 'testar', 'fup', 'follow', 'followup', 'proposta', 'reuniao', 'indicacao', 'apresentar',
]);

/** Palavras que não identificam ninguém: não contam como "uma palavra igual". */
const PALAVRAS_SEM_PESO = new Set([...CONECTIVOS, 'e', 'ltda', 'me', 'epp', 'eireli', 'sa', 'cia', 'grupo', 'empresa']);

export type CitacaoDoTitulo =
  | { tipo: 'interna' }
  | { tipo: 'indicacao'; nome: string }
  | { tipo: 'citado'; nome: string };

type Palavra = { original: string; norm: string };

function palavrasDe(s: string): Palavra[] {
  return s.split(/\s+/).map((original) => ({ original, norm: normalizar(original) })).filter((p) => p.norm);
}

function semConectivosNaFrente(ps: Palavra[]): Palavra[] {
  let i = 0;
  while (i < ps.length && CONECTIVOS.has(ps[i].norm)) i++;
  return ps.slice(i);
}

const textoDe = (ps: Palavra[]) => ps.map((p) => p.original).join(' ').replace(/^[\s\-–—|·:,.;]+|[\s\-–—|·:,.;]+$/g, '').trim();

/** O nome que o título cita (passos 1 e 2 da regra), ou "interna". */
export function citacaoDoTitulo(titulo: string): CitacaoDoTitulo {
  const t = String(titulo ?? '').replace(/\s+/g, ' ').trim();
  const partes = t.split(/\s+[—–-]\s+/).map((x) => x.trim()).filter(Boolean);
  if (!partes.length) return { tipo: 'interna' };
  const esq = palavrasDe(partes[0]);
  const prefixo = PREFIXOS_COM_NOME.find((p) => p.tokens.every((tk, i) => esq[i]?.norm === tk));
  if (prefixo) {
    let nome = textoDe(semConectivosNaFrente(esq.slice(prefixo.tokens.length)));
    if (!nome && partes[1]) nome = textoDe(semConectivosNaFrente(palavrasDe(partes[1])));
    if (!normalizar(nome)) return { tipo: 'interna' };
    return prefixo.indicacao ? { tipo: 'indicacao', nome } : { tipo: 'citado', nome };
  }
  if (partes.length >= 2) {
    const dir = palavrasDe(partes[1]);
    if (esq.length && dir.length && VERBOS_DE_ACAO.has(dir[0].norm) && !VERBOS_DE_ACAO.has(esq[0].norm)) {
      const nome = textoDe(esq);
      if (normalizar(nome)) return { tipo: 'citado', nome };
    }
  }
  return { tipo: 'interna' };
}

export interface ChaveDoLead {
  texto: string;
  tipo: 'empresa' | 'contato';
}

/** As chaves de casamento de um lead (passo 3 da regra), normalizadas, com 3+ letras. */
export function chavesDoLead(l: Pick<LeadExistente, 'nome' | 'empresa' | 'contato'>): ChaveDoLead[] {
  const out = new Map<string, ChaveDoLead>();
  const por = (s: string | null | undefined, tipo: ChaveDoLead['tipo']) => {
    const n = normalizar(s);
    if (n.length < 3) return;
    // A mesma chave como empresa e como contato vale como empresa (a mais forte).
    if (!out.has(n) || tipo === 'empresa') out.set(n, { texto: n, tipo });
  };
  for (const s of [l.nome, l.empresa]) {
    if (!s) continue;
    por(s, 'empresa');
    const m = s.match(/^([^|(]*)[|(]\s*([^|)]*)/);
    if (m) {
      por(m[1], 'empresa');
      por(m[2], 'contato');
    }
  }
  por(l.contato, 'contato');
  return [...out.values()];
}

function prefixoComum(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Parecido sem ser igual (passo 4): prefixo comum de 4+ letras, ou uma palavra de peso igual. */
export function nomeParecido(citado: string, chave: string): boolean {
  const a = normalizar(citado);
  const b = normalizar(chave);
  if (!a || !b || a === b) return false;
  if (prefixoComum(a.replace(/ /g, ''), b.replace(/ /g, '')) >= 4) return true;
  const deB = new Set(b.split(' ').filter((p) => p.length >= 3 && !PALAVRAS_SEM_PESO.has(p)));
  return a.split(' ').some((p) => deB.has(p));
}

export type CasamentoDoCitado =
  | { tipo: 'lead'; leadId: string; como: 'igual' | 'comeca' }
  | { tipo: 'ambigua'; motivo: string; candidatos: string[] }
  | { tipo: 'nenhum' };

type LeadParaCasar = Pick<LeadExistente, 'id' | 'nome' | 'empresa' | 'contato'>;

/** O lead que o nome citado aponta (passos 3 e 4), ou por que não liga. */
export function casarCitado(nome: string, leads: readonly LeadParaCasar[]): CasamentoDoCitado {
  const c = normalizar(nome);
  if (c.length < 3) return { tipo: 'ambigua', motivo: 'nome citado curto demais', candidatos: [] };
  const umaPalavra = !c.includes(' ');
  const comChaves = leads.map((l) => ({ id: l.id, chaves: chavesDoLead(l) }));
  const unicos = (ids: string[]) => [...new Set(ids)];

  // Um nome só liga só à chave de EMPRESA igual; igual só ao contato é primeiro nome sozinho.
  const iguais = unicos(comChaves.filter((l) => l.chaves.some((k) => k.texto === c && (!umaPalavra || k.tipo === 'empresa'))).map((l) => l.id));
  if (iguais.length === 1) return { tipo: 'lead', leadId: iguais[0], como: 'igual' };
  if (iguais.length > 1) return { tipo: 'ambigua', motivo: `mais de um lead com o mesmo nome (${iguais.length})`, candidatos: iguais };
  if (umaPalavra) {
    const soContato = unicos(comChaves.filter((l) => l.chaves.some((k) => k.texto === c)).map((l) => l.id));
    if (soContato.length) return { tipo: 'ambigua', motivo: 'primeiro nome sozinho: igual só ao contato de um lead', candidatos: soContato };
  }

  const comecam = unicos(comChaves.filter((l) => l.chaves.some((k) => k.tipo === 'empresa' && c.startsWith(`${k.texto} `))).map((l) => l.id));
  if (comecam.length === 1) return { tipo: 'lead', leadId: comecam[0], como: 'comeca' };
  if (comecam.length > 1) return { tipo: 'ambigua', motivo: `o citado começa pelo nome de mais de um lead (${comecam.length})`, candidatos: comecam };

  const parecidos = unicos(comChaves.filter((l) => l.chaves.some((k) => nomeParecido(c, k.texto))).map((l) => l.id));
  if (parecidos.length) {
    return { tipo: 'ambigua', motivo: `nome parecido com ${parecidos.length} lead(s) sem ser igual (prefixo comum, palavra igual sem o resto ou grafia abreviada)`, candidatos: parecidos };
  }
  if (umaPalavra) return { tipo: 'ambigua', motivo: 'um nome só, sem lead igual: pode ser o primeiro nome de alguém', candidatos: [] };
  return { tipo: 'nenhum' };
}

export type DestinoDaTarefaDoComercial =
  | { tipo: 'lead'; leadId: string; como: 'igual' | 'comeca'; citado: string }
  | { tipo: 'criar'; nome: string }
  | { tipo: 'interna'; motivo: string }
  | { tipo: 'ambigua'; motivo: string; citado: string };

/** A regra inteira para uma tarefa da lista solta "Comercial" (passos 1 a 5). */
export function destinoDaTarefaDoComercial(titulo: string, concluida: boolean, leads: readonly LeadParaCasar[]): DestinoDaTarefaDoComercial {
  const cit = citacaoDoTitulo(titulo);
  if (cit.tipo === 'interna') return { tipo: 'interna', motivo: 'o título não cita ninguém: tarefa do comercial sem lead' };
  if (cit.tipo === 'indicacao') return { tipo: 'ambigua', motivo: 'indicação: quem o título cita é quem indicou, não o lead', citado: cit.nome };
  const m = casarCitado(cit.nome, leads);
  if (m.tipo === 'lead') return { tipo: 'lead', leadId: m.leadId, como: m.como, citado: cit.nome };
  if (m.tipo === 'ambigua') return { tipo: 'ambigua', motivo: m.motivo, citado: cit.nome };
  if (concluida) return { tipo: 'interna', motivo: 'concluída, citando quem não é lead: o histórico não cria lead' };
  return { tipo: 'criar', nome: cit.nome.slice(0, 200) };
}
