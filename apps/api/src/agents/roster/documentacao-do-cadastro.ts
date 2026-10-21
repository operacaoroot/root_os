import {
  CADASTRO_DE_FUNCOES,
  escolherModelo,
  variavelDoEsforco,
  variavelDoModelo,
  type FuncaoDoCadastro,
  type TipoDaFuncao,
} from '@mktos/shared';

import { ambienteDosModelos } from '../../llm/modelo-da-chamada';

/*
 * A DOCUMENTAÇÃO DOS AGENTES, SAÍDA DO CADASTRO ÚNICO (rodada dos agentes, 21/10/2026, A1).
 *
 * `scripts/gerar-documentacao.ts` junta esta página às do estado da empresa. Três
 * seções, como a tela de Agentes: Agentes (decidem com modelo), Rotinas (relógio,
 * sem modelo) e Automações e integrações (reagem a evento ou sincronizam). Cada
 * linha diz para que serve, estado, dono, modelo e esforço (agentes), gatilho e
 * frequência, e onde mexer. O modelo é o EFETIVO neste ambiente (a variável por
 * função, senão o cadastro), com a origem dita.
 *
 * Puro: não lê banco nem disco. O dono é o PADRÃO do cadastro; a Equipe troca no
 * banco, e a página diz isso.
 */

const SECOES: ReadonlyArray<{ tipo: TipoDaFuncao; titulo: string; descricao: string }> = [
  { tipo: 'agente', titulo: 'Agentes', descricao: 'Decidem com modelo de linguagem.' },
  { tipo: 'rotina', titulo: 'Rotinas', descricao: 'Rodam no relógio, sem modelo de linguagem.' },
  {
    tipo: 'automacao',
    titulo: 'Automações e integrações',
    descricao: 'Reagem a um evento ou sincronizam uma integração, sem modelo de linguagem.',
  },
];

const ESTADO: Record<FuncaoDoCadastro['estado'], string> = {
  ativo: 'ativo',
  desligado: 'desligado',
  'so-homologacao': 'só homologação',
  aposentado: 'aposentado',
};

const DONO: Record<FuncaoDoCadastro['dono'], string> = { rodrigo: 'Rodrigo', lucas: 'Lucas', pedro: 'Pedro' };

/** Texto do cadastro numa linha de markdown: sem quebra e sem começar bloco. */
function linha(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function modeloDe(f: FuncaoDoCadastro, ambiente: Readonly<Record<string, string | undefined>>): string {
  if (f.tipo !== 'agente') return f.modeloExterno ? `sem modelo de linguagem (usa ${f.modeloExterno})` : 'sem modelo';
  if (!f.modelo) return f.modeloExterno ? `modelo externo: ${f.modeloExterno}` : 'sem modelo no cadastro';
  const e = escolherModelo(f.id, { modelo: f.modelo, esforco: f.esforco ?? 'medium' }, ambienteDosModelos(ambiente));
  const origem = e.origem === 'variavel' ? `por variável (${variavelDoModelo(f.id)} / ${variavelDoEsforco(f.id)})` : 'pelo cadastro';
  return `${e.modelo} · esforço ${e.esforco} · ${origem}`;
}

function bloco(f: FuncaoDoCadastro, ambiente: Readonly<Record<string, string | undefined>>): string {
  const partes = [
    `### ${f.id} · ${linha(f.nome)}`,
    '',
    `- Para que serve: ${linha(f.paraQueServe)}`,
    `- Estado: ${ESTADO[f.estado]}${f.soNoPapel ? ' (só no papel, sem código ainda)' : ''} · Dono padrão: ${DONO[f.dono]} · Área: ${f.area}`,
    `- Modelo: ${modeloDe(f, ambiente)}`,
    `- Gatilho: ${linha(f.gatilho) || 'não declarado'} · Frequência: ${linha(f.frequencia) || 'não declarada'}`,
  ];
  if (f.rotina) partes.push(`- Rotina no histórico: \`${f.rotina}\` (tela /rotinas)`);
  if (f.le || f.escreve) partes.push(`- Lê: ${linha(f.le) || 'nada declarado'} · Escreve: ${linha(f.escreve) || 'nada declarado'}`);
  if (f.capacidades.length) partes.push(`- Capacidades: ${f.capacidades.map((c) => `\`${c}\``).join(', ')}${f.nivel ? ` (${linha(f.nivel)})` : ''}`);
  partes.push(`- Onde mexer: ${f.onde ? `\`${linha(f.onde)}\`` : 'ainda sem código'}`);
  partes.push(`- Slug: \`${f.slug}\``);
  return partes.join('\n');
}

export interface PaginaDoCadastro {
  nome: string;
  corpo: string;
  tipo: string;
  titulo: string;
}

/** A página `agentes-do-cadastro.md`, com as três seções. */
export function paginaDoCadastro(
  ambiente: Readonly<Record<string, string | undefined>> = process.env,
  cadastro: readonly FuncaoDoCadastro[] = CADASTRO_DE_FUNCOES,
): PaginaDoCadastro {
  const corpo: string[] = [
    '# Agentes, rotinas e automações',
    '',
    'Gerado do cadastro único (`packages/shared/src/agentes.ts`). O dono é o padrão por área; ' +
      'a troca feita na Equipe vive no banco e vale por cima desta página.',
    '',
    SECOES.map((s) => `- ${s.titulo}: ${cadastro.filter((f) => f.tipo === s.tipo).length}`).join('\n'),
  ];
  for (const s of SECOES) {
    const itens = cadastro.filter((f) => f.tipo === s.tipo);
    corpo.push('', `## ${s.titulo} (${itens.length})`, '', s.descricao);
    for (const f of itens) corpo.push('', bloco(f, ambiente));
  }
  return { nome: 'agentes-do-cadastro.md', corpo: corpo.join('\n') + '\n', tipo: 'cadastro-de-agentes', titulo: 'Agentes, rotinas e automações' };
}
