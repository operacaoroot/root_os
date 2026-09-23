import {
  ROTULO_DO_BLOCO,
  ROTULO_DO_NIVEL,
  ehNivel,
  temasDoConvite,
  type Bloco,
  type Nivel,
  type TemaDaEspinha,
} from './espinha';
import { ROTULO_DA_FASE } from './fases';
import { receita } from './receitas';
import type { OnboardingFase } from '@prisma/client';

/* ==========================================================================
 * O ROTEIRO DO KICKOFF — a espinha escrita como conversa
 * ==========================================================================
 *
 * Peça 1 do desenho de 23/09. Não é um roteiro de reunião comum: é o
 * formulário (blocos B, C e D) na ordem da conversa, com a pergunta de
 * aprofundamento na mão de quem conduz e a frase de consentimento antes de
 * gravar. Quem conduz sai da reunião sabendo quais temas ficaram cobertos e
 * quais vão chegar em branco para o cliente — porque a cobertura é medida
 * sobre a MESMA lista que o leitor de ata vai preencher.
 *
 * O bloco A não entra como pergunta: ele foi respondido antes da 1ª reunião,
 * e o roteiro o mostra como "o que a triagem já disse", para quem conduz não
 * perguntar de novo o que o cliente já escreveu.
 *
 * DETERMINÍSTICO. O roteirista (agente) pode personalizar as perguntas com o
 * vocabulário do cliente depois; sem modelo, este roteiro já serve.
 */

export const CONSENTIMENTO =
  'Vou gravar a nossa conversa. Tudo o que você disser aqui volta para você por escrito, para ' +
  'confirmar — assim você não preenche formulário nenhum do zero. Pode ser?';

export const COMO_CONDUZIR: readonly string[] = [
  'Uma pergunta por vez, na ordem: começa pelo que ele responde sem pensar e termina no que exige memória.',
  'Resposta curta ("sim", "depois eu vejo"): use a linha "se ficar raso", não siga em frente.',
  'Marque "coberto" só quando houver resposta que dê para escrever. O que ficar sem marca chega em branco para o cliente — e você vai saber antes dele.',
  'Nunca peça senha, token ou dado bancário. Se o cliente ditar um, interrompa: "isso entra pelo cofre, não pela gravação".',
];

export interface CabecalhoDoRoteiro {
  cliente: string;
  fase: OnboardingFase;
  perfil: string | null;
  nivel: string | null;
  receita: string | null;
  conduzidoPor: string | null;
  implantadoPor: string | null;
  kickoffEm: Date | string | null;
}

export interface ItemParaRoteiro {
  temaId: string;
  bloco: string;
  status: string;
  textoFinal: string | null;
  proposta: string | null;
}

export interface TemaNoRoteiro {
  id: string;
  n: string;
  bloco: Bloco;
  titulo: string;
  pergunta: string;
  aprofundar: string;
  obrigatorio: boolean;
  /** `obrigatório · tronco`, `opcional · ramo: entregar pronto` … */
  tag: string;
  coberto: boolean;
}

export interface BlocoNoRoteiro {
  bloco: Bloco;
  titulo: string;
  temas: TemaNoRoteiro[];
}

export interface RoteiroDoKickoff {
  titulo: string;
  cabecalho: CabecalhoDoRoteiro & { nivelRotulo: string | null; receitaNome: string | null };
  consentimento: string;
  comoConduzir: string[];
  /** O bloco A já respondido, para quem conduz não perguntar de novo. */
  triagem: { titulo: string; resposta: string }[];
  blocos: BlocoNoRoteiro[];
  cobertura: { cobertos: number; total: number; emBranco: string[]; obrigatoriosEmBranco: string[] };
  markdown: string;
}

function tagDoTema(t: TemaDaEspinha): string {
  const base = t.obrigatorio ? 'obrigatório' : 'opcional';
  if (!t.niveis) return `${base} · tronco`;
  return `${base} · ramo: ${t.niveis.map((n) => ROTULO_DO_NIVEL[n].toLowerCase()).join(' / ')}`;
}

function formatarData(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const data = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Um item "cobre" o tema quando existe com qualquer coisa além de em-branco. */
export function temaCoberto(status: string | undefined): boolean {
  return !!status && status !== 'em-branco' && status !== 'descartado';
}

export function montarRoteiro(
  cab: CabecalhoDoRoteiro,
  itens: readonly ItemParaRoteiro[],
  temasDoBlocoA: readonly TemaDaEspinha[],
): RoteiroDoKickoff {
  const nivel: Nivel | null = ehNivel(cab.nivel) ? cab.nivel : null;
  const porTema = new Map(itens.map((i) => [i.temaId, i]));
  const temas = temasDoConvite('BCD', nivel);

  let n = 0;
  const blocos: BlocoNoRoteiro[] = (['B', 'C', 'D'] as Bloco[]).map((bloco) => ({
    bloco,
    titulo: ROTULO_DO_BLOCO[bloco],
    temas: temas
      .filter((t) => t.bloco === bloco)
      .map((t) => {
        n += 1;
        return {
          id: t.id,
          n: String(n).padStart(2, '0'),
          bloco,
          titulo: t.titulo,
          pergunta: t.pergunta,
          aprofundar: t.aprofundar,
          obrigatorio: t.obrigatorio,
          tag: tagDoTema(t),
          coberto: temaCoberto(porTema.get(t.id)?.status),
        };
      }),
  }));

  const todos = blocos.flatMap((b) => b.temas);
  const emBranco = todos.filter((t) => !t.coberto);
  const cobertura = {
    cobertos: todos.length - emBranco.length,
    total: todos.length,
    emBranco: emBranco.map((t) => t.titulo),
    obrigatoriosEmBranco: emBranco.filter((t) => t.obrigatorio).map((t) => t.titulo),
  };

  const triagem = temasDoBlocoA
    .map((t) => {
      const item = porTema.get(t.id);
      const resposta = item?.textoFinal ?? item?.proposta ?? null;
      return resposta ? { titulo: t.titulo, resposta } : null;
    })
    .filter((x): x is { titulo: string; resposta: string } => !!x);

  const r = receita(cab.receita);
  const cabecalho = {
    ...cab,
    nivelRotulo: nivel ? ROTULO_DO_NIVEL[nivel] : null,
    receitaNome: r?.nome ?? null,
  };

  const titulo = `Kickoff — ${cab.cliente}`;
  const md: string[] = [];
  md.push(`# ${titulo}`);
  md.push('');
  md.push(
    [
      cab.perfil ? `Perfil ${cab.perfil}` : null,
      cabecalho.nivelRotulo ? `Nível: ${cabecalho.nivelRotulo}` : 'Nível: a decidir',
      cabecalho.receitaNome ? `Receita: ${cabecalho.receitaNome}` : null,
      `Conduz: ${cab.conduzidoPor ?? '?'}${cab.implantadoPor ? ` + ${cab.implantadoPor} (implanta)` : ''}`,
      formatarData(cab.kickoffEm) ? `Data: ${formatarData(cab.kickoffEm)}` : null,
      `Fase: ${ROTULO_DA_FASE[cab.fase]}`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  md.push('');
  md.push('## Antes de apertar gravar — diga assim');
  md.push('');
  md.push(`> ${CONSENTIMENTO}`);
  md.push('');
  md.push('## Como conduzir');
  md.push('');
  for (const [i, c] of COMO_CONDUZIR.entries()) md.push(`${i + 1}. ${c}`);
  md.push('');
  if (triagem.length) {
    md.push('## O que a triagem já disse (não pergunte de novo)');
    md.push('');
    for (const t of triagem) md.push(`- **${t.titulo}:** ${t.resposta}`);
    md.push('');
  }
  for (const b of blocos) {
    md.push(`## Bloco ${b.bloco} · ${b.titulo}`);
    md.push('');
    for (const t of b.temas) {
      md.push(`### ${t.n} · ${t.titulo}  \`${t.tag}\`${t.coberto ? ' · coberto' : ''}`);
      md.push('');
      md.push(`**${t.pergunta}**`);
      md.push('');
      md.push(`*Se ficar raso →* ${t.aprofundar}`);
      md.push('');
    }
  }
  md.push('## Ao sair da reunião');
  md.push('');
  md.push(
    `${cobertura.cobertos} de ${cobertura.total} temas cobertos. ` +
      (emBranco.length
        ? `Chegam em branco para o cliente: ${cobertura.emBranco.join(', ')}.`
        : 'Nada chega em branco: o cliente só confirma.'),
  );
  md.push('');
  md.push('A ata vai para o leitor de ata; as propostas aparecem na bancada para aprovação.');

  return {
    titulo,
    cabecalho,
    consentimento: CONSENTIMENTO,
    comoConduzir: [...COMO_CONDUZIR],
    triagem,
    blocos,
    cobertura,
    markdown: md.join('\n'),
  };
}
