import {
  TOTEM_EVENTOS_POR_LOTE,
  TotemEventoQuiosqueSchema,
  totemLimparTermo,
  type TotemEventoQuiosque,
  type TotemTipoEvento,
} from '@mktos/shared';

import { ErroDaApi } from '@/lib/api';
import { ehSemRede, ehTotemDesativado } from '@/lib/totem/api-publica';
import type { Armazem } from './armazem';

/*
 * A FILA DE EVENTOS DO QUIOSQUE. Busca, busca sem resultado, ficha aberta e
 * sincronização entram aqui na hora, com id gerado no aparelho, e sobem em
 * lotes de até 200 quando há rede. Reenviar o mesmo lote não duplica nada na
 * API (o id é a chave), então a fila só tira do aparelho o que a API aceitou.
 *
 * O termo passa por `totemLimparTermo` ANTES de entrar na fila: CPF ou
 * telefone digitado na busca não chega nem a ser gravado no aparelho.
 */

const CHAVE = 'totem.fila';
/** Uns dez dias de loja movimentada sem rede; passou disso, sai o mais antigo. */
export const TOTEM_FILA_MAXIMA = 2000;

export interface DadosDoEvento {
  produtoId?: string | null;
  termo?: string | null;
}

export function novoEvento(
  tipo: TotemTipoEvento,
  dados: DadosDoEvento = {},
  agora: Date = new Date(),
  gerarId: () => string = () => crypto.randomUUID(),
): TotemEventoQuiosque | null {
  const r = TotemEventoQuiosqueSchema.safeParse({
    id: gerarId(),
    tipo,
    produtoId: dados.produtoId ?? null,
    termo: totemLimparTermo(dados.termo),
    ocorridoEm: agora.toISOString(),
  });
  return r.success ? r.data : null;
}

export type EnviarEventos = (eventos: TotemEventoQuiosque[]) => Promise<void>;

export interface FilaDeEventos {
  /** Lê do aparelho o que sobrou da última vez. */
  carregar(): Promise<void>;
  registrar(tipo: TotemTipoEvento, dados?: DadosDoEvento): Promise<void>;
  /**
   * Manda tudo em lotes. Sem rede ou com teto estourado, para e guarda o
   * resto; 401 sobe para quem chamou, que desativa o aparelho.
   */
  descarregar(enviar: EnviarEventos): Promise<number>;
  tamanho(): number;
  limpar(): Promise<void>;
}

function eventosValidos(bruto: unknown): TotemEventoQuiosque[] {
  if (!Array.isArray(bruto)) return [];
  const ok: TotemEventoQuiosque[] = [];
  for (const item of bruto) {
    const r = TotemEventoQuiosqueSchema.safeParse(item);
    if (r.success) ok.push(r.data);
  }
  return ok;
}

export function criarFila(armazem: Armazem): FilaDeEventos {
  let eventos: TotemEventoQuiosque[] = [];
  let enviando: Promise<number> | null = null;

  const salvar = () => armazem.gravar(CHAVE, eventos).catch(() => undefined);

  function acrescentar(novos: readonly TotemEventoQuiosque[]): void {
    const ids = new Set(eventos.map((e) => e.id));
    eventos = [...eventos, ...novos.filter((e) => !ids.has(e.id))].slice(-TOTEM_FILA_MAXIMA);
  }

  async function enviarTudo(enviar: EnviarEventos): Promise<number> {
    let enviados = 0;
    while (eventos.length) {
      const lote = eventos.slice(0, TOTEM_EVENTOS_POR_LOTE);
      try {
        await enviar(lote);
      } catch (e) {
        if (ehTotemDesativado(e)) throw e;
        // 400 é lote que a API nunca vai aceitar: descartar destrava a fila.
        // Qualquer outra falha (sem rede, 429, 5xx) guarda o lote para depois.
        if (ehSemRede(e) || !(e instanceof ErroDaApi && e.status === 400)) break;
      }
      const ids = new Set(lote.map((ev) => ev.id));
      eventos = eventos.filter((ev) => !ids.has(ev.id));
      enviados += lote.length;
      await salvar();
    }
    return enviados;
  }

  return {
    async carregar() {
      const guardados = eventosValidos(await armazem.ler(CHAVE).catch(() => undefined));
      acrescentar(guardados);
    },
    async registrar(tipo, dados) {
      const ev = novoEvento(tipo, dados);
      if (!ev) return;
      acrescentar([ev]);
      await salvar();
    },
    descarregar(enviar) {
      enviando ??= enviarTudo(enviar).finally(() => {
        enviando = null;
      });
      return enviando;
    },
    tamanho() {
      return eventos.length;
    },
    async limpar() {
      eventos = [];
      await armazem.apagar(CHAVE).catch(() => undefined);
    },
  };
}
