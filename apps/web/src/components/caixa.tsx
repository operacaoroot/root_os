'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { CaixaContador } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * ==========================================================================
 * O SELO DA CAIXA — quantos itens esperam por mim, na casca do OS (fatia A7)
 * ==========================================================================
 *
 * A fatia pede o contador na casca "e, se o número puder estar desatualizado,
 * ele não mente sobre isso". Três decisões saem daí, e as três são sobre não
 * mentir:
 *
 *  1. O NÚMERO É MEDIDO, NÃO ESTIMADO, e vem da MESMA montagem que a tela
 *     `/caixa` usa (`GET /api/caixa/contador` deriva de `CaixaService.montar`).
 *     Um `count()` próprio no servidor seria mais barato e diria outro número:
 *     o impedimento da porta não cabe em SQL. Duas aritméticas para o mesmo
 *     número é o defeito que a fatia A3 acabou de pagar nas horas devolvidas;
 *  2. ELE TEM HORA, e a hora vai no `title`. O selo não é ao vivo: ele é medido
 *     na montagem e a cada navegação. Selo sem hora vira promessa de tempo real
 *     que ninguém cumpriu — e aqui a diferença importa, porque o item pode ter
 *     sido assinado por outra pessoa há dois minutos;
 *  3. "NÃO SEI" NÃO É ZERO. Enquanto a resposta não chega, e SE ELA FALHAR, o
 *     selo não aparece com `0` — ele fica ausente enquanto carrega e vira `?`
 *     quando a medição falha, com o motivo no `title`. Um zero falso é pior que
 *     nenhum selo: zero é a única leitura que faz a pessoa deixar de abrir a
 *     tela.
 *
 * BATEU NO TETO, O SELO ESCREVE "N+". Os eixos têm teto no servidor (50 cada), e
 * o total é PISO quando algum deles corta. Ver `o-que-espera.ts`.
 *
 * ----------------------------------------------------------------------------
 * POR QUE REMEDIR A CADA NAVEGAÇÃO, E NÃO NUM CRONÔMETRO
 * ----------------------------------------------------------------------------
 * Mesma escolha do `PortaDaAssinatura`, logo ao lado no `AppShell`: a navegação
 * é o momento em que a pessoa está olhando a barra, e é quando o número precisa
 * estar certo. Um cronômetro de fundo custaria uma consulta por minuto por aba
 * aberta para atualizar um número que ninguém está lendo — e a caixa não é
 * barata, porque ela pergunta à porta o que ela recusaria hoje.
 *
 * `recarregar()` existe para a própria tela `/caixa` remedir o selo depois de
 * mostrar a lista: as duas superfícies passam a dizer o mesmo número no mesmo
 * instante, em vez de a barra ficar com a contagem da navegação anterior.
 */

export interface CaixaContextValue {
  /** `null` = ainda não sei (carregando ou falhou). Nunca zero por falta de dado. */
  contador: CaixaContador | null;
  /** A medição falhou? O selo diz "?" e explica no title. */
  falhou: boolean;
  carregando: boolean;
  recarregar: () => void;
}

const CaixaContext = createContext<CaixaContextValue | null>(null);

const VAZIO: CaixaContextValue = {
  contador: null,
  falhou: false,
  carregando: false,
  recarregar: () => {},
};

export function CaixaProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const pathname = usePathname();
  const [contador, setContador] = useState<CaixaContador | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [carregando, setCarregando] = useState(false);
  /** Muda para forçar uma nova medição sem depender de navegação. */
  const [rodada, setRodada] = useState(0);

  const recarregar = useCallback(() => setRodada((n) => n + 1), []);

  useEffect(() => {
    if (!token) {
      setContador(null);
      setFalhou(false);
      return;
    }
    let vivo = true;
    setCarregando(true);
    apiGet<CaixaContador>('/caixa/contador', token)
      .then((r) => {
        if (!vivo) return;
        setContador(r);
        setFalhou(false);
      })
      .catch(() => {
        /*
         * API velha, rede caída, sessão expirando, módulo do servidor fora do
         * grafo: o selo NÃO cai para zero. Ele passa a dizer "?" — a diferença
         * entre "nada te espera" e "não consegui perguntar" é a única que
         * importa para quem confia na barra.
         */
        if (!vivo) return;
        setContador(null);
        setFalhou(true);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [token, pathname, rodada]);

  return (
    <CaixaContext.Provider value={{ contador, falhou, carregando, recarregar }}>
      {children}
    </CaixaContext.Provider>
  );
}

/**
 * Fora do provedor devolve o estado "não sei" em vez de lançar — a mesma escolha
 * de `useModulos`, e pelo mesmo motivo: a `Sidebar` aparece em teste e em página
 * que não monta a casca inteira, e derrubar a árvore por causa de um selo
 * cosmético seria trocar um número a menos na barra por uma tela branca.
 */
export function useCaixa(): CaixaContextValue {
  return useContext(CaixaContext) ?? VAZIO;
}

/** O que o selo escreve: `null` = não desenhar nada. */
export function textoDoSelo(v: CaixaContextValue): string | null {
  if (v.falhou) return '?';
  if (!v.contador) return null;
  if (v.contador.quantos === 0) return null;
  return v.contador.parcial ? `${v.contador.quantos}+` : String(v.contador.quantos);
}

/**
 * O `title` do selo — a frase que carrega a hora da medição e o que o número
 * inclui. É aqui que o selo se recusa a mentir: sem esta frase, um `4` na barra
 * afirma "agora mesmo há 4", e ele afirma "às 14:32 havia 4".
 */
export function tituloDoSelo(v: CaixaContextValue): string {
  if (v.falhou) {
    return 'Não consegui medir o que espera por você agora — este "?" não é zero. Abra a Caixa para tentar de novo.';
  }
  if (!v.contador) return 'Medindo o que espera por você…';
  const hora = new Date(v.contador.medidoEm).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const partes = [
    `${v.contador.aprovacoes} aprovação(ões) que você pode assinar`,
    `${v.contador.tarefas} tarefa(s) sua(s) parada(s)`,
  ].join(' e ');
  const piso = v.contador.parcial
    ? ' Algum eixo bateu no teto da consulta, então este número é um PISO.'
    : '';
  return `${partes}. Medido às ${hora}; remede quando você troca de tela.${piso}`;
}
