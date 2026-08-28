import { classificar, avaliar, type Capacidade, type Decisao } from './escada.js';
import type { Politica } from './esquema.js';

/*
 * A trava que o documento normativo exige: `04-ESCADA-R0-R5.md` diz que o
 * código é "o espelho executável deste texto, e teste-politica.ts reprova
 * quando os dois divergem".
 *
 * O laço vinha de scripts/verificar.ts e virou função para que o CLI e o
 * vitest chamem exatamente o mesmo código. A lógica mudou de casa; a garantia
 * não. Se alguém "melhorar" classificar() ao portar, isto fica vermelho.
 */

export interface LinhaVerificacao {
  id: string;
  declarado: string;
  calculado: string;
  ok: boolean;
}

export function verificarCatalogo(pol: Pick<Politica, 'capacidades'>): LinhaVerificacao[] {
  return pol.capacidades.map((c) => {
    const calculado = classificar(c.efeito as Capacidade['efeito']);
    return { id: c.id, declarado: c.nivel, calculado, ok: calculado === c.nivel };
  });
}

export interface CasoDeDecisao {
  nome: string;
  decisao: Decisao;
}

/**
 * Os cinco casos que o anexo imprime, para que o comportamento — e não só a
 * classificação — fique preso ao documento. Recebe as capacidades por id para
 * servir tanto ao catálogo ROOT quanto ao do marketing-os.
 */
export function casosDeDecisao(
  pol: Pick<Politica, 'capacidades'>,
  ids: { externo: string; interno: string },
): CasoDeDecisao[] {
  const acha = (id: string) => {
    const c = pol.capacidades.find((x) => x.id === id);
    if (!c) throw new Error(`capacidade "${id}" não existe no catálogo`);
    return c as unknown as Capacidade;
  };
  const externo = acha(ids.externo);
  const interno = acha(ids.interno);

  return [
    { nome: 'saída externa, normal', decisao: avaliar(externo) },
    {
      nome: 'saída externa, destinatário novo',
      decisao: avaliar(externo, { sinais: ['destinatario_novo'] }),
    },
    {
      nome: 'registro interno, aprovação desligada',
      decisao: avaliar(interno, { aprovacaoR2Ligada: false }),
    },
    {
      nome: 'registro interno, fonte não confiável',
      decisao: avaliar(interno, { sinais: ['fonte_nao_confiavel'] }),
    },
    { nome: 'ferramenta desconhecida', decisao: avaliar(null) },
  ];
}
