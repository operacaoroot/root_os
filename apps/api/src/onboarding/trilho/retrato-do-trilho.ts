import { ContextKind, ContextSource } from '@prisma/client';

import { CHAVE_DO_RETRATO } from '../../agents/roster';
import { ROTULO_DO_BLOCO, ehNivel, obrigatorios, temaDaEspinha, type Bloco, type Nivel } from './espinha';
import { formatarData } from './mensagens';

/* ==========================================================================
 * O RETRATO DO TRILHO — o OS lê de volta o que o cliente confirmou
 * ==========================================================================
 *
 * É o "doce na boca": o formulário não termina em "obrigado, recebemos",
 * termina entregando. Cada parte cita de onde veio — a reunião e o minuto,
 * quem confirmou, quem corrigiu, quem respondeu por áudio.
 *
 * CONSTRUÍDO, NÃO PEDIDO AO MODELO, pelo mesmo motivo de `retrato.ts`: a
 * primeira resposta do produto não pode sair sem fonte, e a única maneira de
 * garantir isso é ela SER as fontes. O parágrafo é o texto confirmado; a
 * etiqueta é a procedência.
 *
 * A PRIMEIRA PERGUNTA é respondida com honestidade: quase sempre "ainda não
 * consigo, preciso de X conectado", com o próximo passo ao lado. Prometer a
 * resposta antes de existir conector seria exatamente a promessa que a mesa
 * pediu para tirar do pitch.
 */

export interface ItemParaRetrato {
  temaId: string;
  bloco: string;
  status: string;
  tipo: string;
  textoFinal: string | null;
  proposta: string | null;
  fonteMinuto: string | null;
  respondidoPor: string | null;
  respondidoVia: string | null;
  respondidoEm: Date | null;
}

export interface ParteDoRetrato {
  temaId: string;
  bloco: Bloco;
  titulo: string;
  texto: string;
  fonte: string;
}

export interface RetratoDoTrilho {
  texto: string;
  partes: ParteDoRetrato[];
  /** Obrigatórios do nível que ficaram sem resposta. O retrato os declara. */
  pendentes: string[];
  primeiraPergunta: { pergunta: string | null; resposta: string };
  /** A nota que o retrato vira na memória do cliente, quando ela existe. */
  nota: {
    chave: string;
    titulo: string;
    corpo: string;
    kind: ContextKind;
    tags: string[];
    sourceType: ContextSource;
    sourceRef: string;
    motivo: string;
  } | null;
}

function fonteDoItem(i: ItemParaRetrato, kickoffEm: Date | string | null): string {
  const reuniao = kickoffEm ? `reunião de ${formatarData(kickoffEm)}` : 'reunião';
  const minuto = i.fonteMinuto ? ` · ${i.fonteMinuto}` : '';
  const quem = i.respondidoPor ? ` por ${i.respondidoPor}` : '';
  const quando = i.respondidoEm ? ` em ${formatarData(i.respondidoEm)}` : '';
  if (i.status === 'confirmado') return `${reuniao}${minuto} · confirmado${quem}`;
  if (i.status === 'corrigido') return `${reuniao}${minuto} · corrigido${quem}${quando}`;
  const via = i.respondidoVia === 'audio' ? ' por áudio' : '';
  return `respondido${via}${quem}${quando}`;
}

export function montarRetratoDoTrilho(args: {
  cliente: string;
  nivel: string | null;
  kickoffEm: Date | string | null;
  itens: readonly ItemParaRetrato[];
  proximoPasso: string | null;
}): RetratoDoTrilho {
  const nivel: Nivel | null = ehNivel(args.nivel) ? args.nivel : null;
  const respondidos = args.itens.filter(
    (i) => ['confirmado', 'corrigido', 'respondido'].includes(i.status) && (i.textoFinal ?? '').trim(),
  );

  const partes: ParteDoRetrato[] = [];
  for (const bloco of ['A', 'B', 'C', 'D'] as Bloco[]) {
    for (const i of respondidos.filter((x) => x.bloco === bloco)) {
      const tema = temaDaEspinha(i.temaId);
      if (!tema) continue;
      partes.push({
        temaId: i.temaId,
        bloco,
        titulo: tema.titulo,
        texto: (i.textoFinal ?? '').trim(),
        fonte: fonteDoItem(i, args.kickoffEm),
      });
    }
  }

  const porTema = new Map(respondidos.map((i) => [i.temaId, i]));
  const pendentes = [...obrigatorios('A', nivel), ...obrigatorios('BCD', nivel)]
    .filter((t) => !porTema.has(t.id))
    .map((t) => t.titulo);

  const perguntaItem = porTema.get('d-primeira-pergunta');
  const pergunta = perguntaItem?.textoFinal?.trim() || null;
  const sistema =
    porTema.get('d-acessos')?.textoFinal?.trim() ||
    porTema.get('a-sistemas')?.textoFinal?.trim() ||
    null;
  const resposta = pergunta
    ? `Ainda não consigo responder: preciso ${sistema ? `de "${sistema.slice(0, 80)}" conectado` : 'da fonte de dados conectada'}.` +
      (args.proximoPasso ? ` Próximo passo: ${args.proximoPasso}.` : ' O próximo passo é a conexão da primeira fonte.') +
      ' Essa resposta é o que define a implantação como pronta.'
    : 'Você ainda não me disse qual pergunta quer ver respondida na primeira semana — é ela que define a implantação como pronta.';

  const linhas: string[] = [`O que o ROOT OS entendeu da ${args.cliente}:`, ''];
  let blocoAtual: Bloco | null = null;
  for (const p of partes) {
    if (p.bloco !== blocoAtual) {
      blocoAtual = p.bloco;
      linhas.push(`## ${ROTULO_DO_BLOCO[p.bloco]}`);
      linhas.push('');
    }
    linhas.push(`**${p.titulo}.** ${p.texto}`);
    linhas.push(`_(${p.fonte})_`);
    linhas.push('');
  }
  if (pendentes.length) {
    linhas.push(`Ainda sem resposta: ${pendentes.join(', ')}.`);
    linhas.push('');
  }
  linhas.push('## A sua primeira pergunta');
  linhas.push('');
  if (pergunta) {
    linhas.push(`"${pergunta}"`);
    linhas.push('');
  }
  linhas.push(resposta);

  const texto = linhas.join('\n').trim();

  return {
    texto,
    partes,
    pendentes,
    primeiraPergunta: { pergunta, resposta },
    nota: partes.length
      ? {
          chave: CHAVE_DO_RETRATO,
          titulo: 'Retrato do onboarding',
          corpo: texto,
          kind: ContextKind.nota,
          tags: ['onboarding', 'retrato'],
          sourceType: ContextSource.promocao,
          sourceRef: 'onboarding:trilho:retrato',
          motivo: 'retrato do onboarding — leitura de volta do que o cliente confirmou pelo link',
        }
      : null,
  };
}
