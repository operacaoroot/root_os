/*
 * O ARMAZÉM DO QUIOSQUE: chave e valor sobre IndexedDB, sem biblioteca.
 *
 * Guarda o catálogo, a fila de eventos e a cópia do token. Quando o navegador
 * nega o IndexedDB (janela anônima, armazenamento bloqueado), o armazém cai
 * para a memória: o quiosque funciona enquanto a página estiver aberta e só
 * perde o catálogo guardado se recarregar sem rede.
 */

export interface Armazem {
  ler<T>(chave: string): Promise<T | undefined>;
  gravar(chave: string, valor: unknown): Promise<void>;
  apagar(chave: string): Promise<void>;
}

const BANCO = 'totem-quiosque';
const TABELA = 'chaves';
const VERSAO_DO_BANCO = 1;

export function armazemNaMemoria(): Armazem {
  const dados = new Map<string, unknown>();
  return {
    async ler<T>(chave: string) {
      return dados.get(chave) as T | undefined;
    },
    async gravar(chave, valor) {
      dados.set(chave, structuredClone(valor));
    },
    async apagar(chave) {
      dados.delete(chave);
    },
  };
}

function pedido<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function abrirBanco(fabrica: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = fabrica.open(BANCO, VERSAO_DO_BANCO);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(TABELA)) r.result.createObjectStore(TABELA);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba.'));
  });
}

/**
 * O armazém do aparelho. A primeira falha ao abrir o banco troca, de vez, para
 * a memória; falha numa operação isolada é repassada para quem chamou.
 */
export function armazemDoAparelho(fabrica: IDBFactory | undefined = globalThis.indexedDB): Armazem {
  const reserva = armazemNaMemoria();
  if (!fabrica) return reserva;
  let banco: Promise<IDBDatabase | null> | null = null;
  const conectar = () => (banco ??= abrirBanco(fabrica).catch(() => null));

  async function tabela(modo: IDBTransactionMode): Promise<IDBObjectStore | null> {
    const db = await conectar();
    return db ? db.transaction(TABELA, modo).objectStore(TABELA) : null;
  }

  return {
    async ler<T>(chave: string) {
      const t = await tabela('readonly');
      if (!t) return reserva.ler<T>(chave);
      return (await pedido(t.get(chave))) as T | undefined;
    },
    async gravar(chave, valor) {
      const t = await tabela('readwrite');
      if (!t) return reserva.gravar(chave, valor);
      await pedido(t.put(valor, chave));
    },
    async apagar(chave) {
      const t = await tabela('readwrite');
      if (!t) return reserva.apagar(chave);
      await pedido(t.delete(chave));
    },
  };
}
