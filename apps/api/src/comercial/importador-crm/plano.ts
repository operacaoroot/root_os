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
export const LISTAS_SOLTAS_QUE_FICAM = new Set(['comercial', 'operacao']);

/** Minúsculas, sem acento, só letras e números separados por um espaço. */
export function normalizar(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
