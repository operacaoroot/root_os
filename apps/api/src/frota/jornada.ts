import type { Jornada } from './frota.schemas';

/*
 * JORNADA — o que a tela da Frota lê da jornada que a casa relata.
 *
 * A casa manda o backlog inteiro (kit-jornada json); aqui sai o recorte que
 * responde às duas perguntas do painel: "o que está acontecendo" (fase atual,
 * o que anda, o que regrediu) e "o que está pendente e esperando quem". Puro:
 * nada de banco, para o teste medir a regra sem Nest.
 */

export type ItemDaJornada = Jornada['itens'][number];

/** Quem trava um item "esperando": o texto livre da casa vira um de três grupos. */
export function quemTrava(espera: string | undefined): 'cliente' | 'root' | 'terceiro' {
  const t = (espera ?? '').trim().toLowerCase();
  if (/^(root|nós|nos|operador|operadora)\b/.test(t)) return 'root';
  if (/^(cliente|dono|contratante)\b/.test(t) || !t) return 'cliente';
  return 'terceiro';
}

const enxuto = (i: ItemDaJornada) => ({
  id: i.id,
  fase: i.fase,
  item: i.item,
  quem: i.quem ?? null,
  situacao: i.situacao,
  espera: i.espera ?? null,
  quando: i.quando ?? null,
  nota: i.nota ?? null,
  autoTexto: i.autoTexto ?? null,
  projeto: i.projeto,
});
export type ItemEnxuto = ReturnType<typeof enxuto>;

export function resumoDaJornada(j: Jornada | null | undefined) {
  if (!j) return null;
  const fase = j.faseAtual == null ? null : j.fases.find((f) => f.n === j.faseAtual) ?? null;
  const esperando = j.itens.filter((i) => i.situacao === 'esperando');
  const porQuem = { cliente: 0, root: 0, terceiro: 0 };
  for (const i of esperando) porQuem[quemTrava(i.espera)] += 1;
  return {
    pct: j.pct,
    feitos: j.feitos,
    validos: j.validos,
    faseAtual: j.faseAtual,
    faseNome: fase?.nome ?? null,
    temNota: j.arquivo,
    geradoEm: j.geradoEm ?? null,
    fases: j.fases.map((f) => ({ n: f.n, nome: f.nome, conta: f.total - f.na, feito: f.feito, esperando: f.esperando, andamento: f.andamento, regrediu: f.regrediu })),
    esperando: esperando.length,
    porQuem,
    andamento: j.itens.filter((i) => i.situacao === 'andamento').length,
    regrediu: j.itens.filter((i) => i.situacao === 'regrediu').map(enxuto),
    // o próximo passo: o primeiro a fazer da fase atual (a ordem é a do catálogo)
    proximo: j.itens.filter((i) => i.situacao === 'afazer' && i.fase === j.faseAtual).slice(0, 3).map(enxuto),
  };
}
export type ResumoDaJornada = NonNullable<ReturnType<typeof resumoDaJornada>>;

/** O quadro da frota inteira: tudo que está parado, andando ou regrediu, com a casa. */
export function quadroDaFrota(casas: { id: string; casa: string; jornada: Jornada | null | undefined }[]) {
  const linhas: (ItemEnxuto & { casaId: string; casa: string; trava: 'cliente' | 'root' | 'terceiro' | null })[] = [];
  for (const c of casas) {
    for (const i of c.jornada?.itens ?? []) {
      if (i.situacao !== 'esperando' && i.situacao !== 'andamento' && i.situacao !== 'regrediu') continue;
      linhas.push({ ...enxuto(i), casaId: c.id, casa: c.casa, trava: i.situacao === 'esperando' ? quemTrava(i.espera) : null });
    }
  }
  // o mais antigo primeiro: o que espera há mais tempo é o que mais pesa
  const porData = (a: { quando: string | null }, b: { quando: string | null }) => (a.quando ?? '9999').localeCompare(b.quando ?? '9999');
  return {
    regrediu: linhas.filter((l) => l.situacao === 'regrediu'),
    cliente: linhas.filter((l) => l.trava === 'cliente').sort(porData),
    root: linhas.filter((l) => l.trava === 'root').sort(porData),
    terceiro: linhas.filter((l) => l.trava === 'terceiro').sort(porData),
    andamento: linhas.filter((l) => l.situacao === 'andamento').sort(porData),
  };
}

const ROTULO: Record<string, string> = { afazer: 'a fazer', andamento: 'em andamento', esperando: 'esperando', feito: 'feito', na: 'não se aplica', regrediu: 'regrediu' };

/** O que mudou na jornada entre dois relatos (vira evento do registro). Sem jornada antes, nada. */
export function mudancasDaJornada(antes: Jornada | null | undefined, agora: Jornada | null | undefined) {
  if (!antes || !agora) return [];
  const velho = new Map(antes.itens.map((i) => [i.id, i.situacao]));
  const out: { id: string; de: string; para: string; texto: string }[] = [];
  for (const i of agora.itens) {
    const de = velho.get(i.id);
    if (de === undefined || de === i.situacao) continue;
    const quem = i.situacao === 'esperando' && i.espera ? ` (por ${i.espera})` : '';
    out.push({ id: i.id, de, para: i.situacao, texto: `Jornada ${i.id} · ${i.item.slice(0, 120)}: ${ROTULO[de] ?? de} → ${ROTULO[i.situacao] ?? i.situacao}${quem}${i.nota ? `. ${i.nota.slice(0, 160)}` : ''}` });
  }
  return out.slice(0, 30);
}
