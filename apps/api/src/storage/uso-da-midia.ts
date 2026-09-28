/*
 * O USO DO STORAGE PELA MÍDIA DAS PEÇAS (MD4) — a conta, sem Nest e sem rede.
 *
 * O mp4 do corte (até 300 MB) e os PNG e JPEG das peças moram no MinIO da VPS,
 * no mesmo disco do Postgres e do backup diário. Cada render grava uma chave
 * nova (o sha256 vai no nome) e nada apaga: a troca de candidato do corte
 * (MD13), o re-render depois de editar ou de trocar a transcrição e o envio que
 * cai no 409 do trecho mudado deixam objetos que nenhuma peça referencia.
 *
 * Aqui só se separa o que é referenciado (alguma `PautaPeca.meta` aponta para
 * a chave) do que é órfão, com a idade de cada um. Quem lista o bucket, lê as
 * peças e remove é `src/scripts/storage-uso.ts`, à mão: manutenção que apaga é
 * comando que alguém dá, nunca rotina.
 */

/** Os prefixos da mídia das peças: o mp4 do corte (`pauta/pecas/<id>/…`) e as imagens (`pauta/peca/<id>-n-sha.png|jpg`). */
export const PREFIXOS_DA_MIDIA_DAS_PECAS = ['pauta/pecas/', 'pauta/peca/'] as const;

/** O órfão mais novo que isto não é removido: pode ser um envio que ainda vai ser gravado na peça. */
export const DIAS_MINIMOS_PARA_REMOVER = 7;

export interface ObjetoDoStorage {
  chave: string;
  bytes: number;
  modificadoEm: Date;
}

/** As chaves do storage que a meta de uma peça referencia: o mp4 do corte e cada imagem. */
export function chavesDaMeta(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object') return [];
  const m = meta as { video?: { chave?: unknown } | null; imagens?: unknown };
  const saida: string[] = [];
  if (m.video && typeof m.video.chave === 'string' && m.video.chave) saida.push(m.video.chave);
  if (Array.isArray(m.imagens)) {
    for (const i of m.imagens) {
      const chave = (i as { chave?: unknown } | null)?.chave;
      if (typeof chave === 'string' && chave) saida.push(chave);
    }
  }
  return saida;
}

export interface UsoDoStorage {
  objetos: number;
  bytes: number;
  referenciados: { objetos: number; bytes: number };
  orfaos: { objetos: number; bytes: number };
  /** Os órfãos com pelo menos `dias` de idade, do mais velho: o que a remoção levaria. */
  removiveis: Array<ObjetoDoStorage & { idadeDias: number }>;
}

export function usoDoStorage(objetos: readonly ObjetoDoStorage[], referenciadas: ReadonlySet<string>, agora: Date, dias: number): UsoDoStorage {
  const uso: UsoDoStorage = { objetos: 0, bytes: 0, referenciados: { objetos: 0, bytes: 0 }, orfaos: { objetos: 0, bytes: 0 }, removiveis: [] };
  for (const o of objetos) {
    uso.objetos++;
    uso.bytes += o.bytes;
    if (referenciadas.has(o.chave)) {
      uso.referenciados.objetos++;
      uso.referenciados.bytes += o.bytes;
      continue;
    }
    uso.orfaos.objetos++;
    uso.orfaos.bytes += o.bytes;
    const idadeDias = Math.floor((agora.getTime() - o.modificadoEm.getTime()) / 86_400_000);
    if (idadeDias >= dias) uso.removiveis.push({ ...o, idadeDias });
  }
  uso.removiveis.sort((a, b) => a.modificadoEm.getTime() - b.modificadoEm.getTime());
  return uso;
}

/** Bytes como a pessoa lê: `1,5 GB`, `320 MB`, `12 KB`. */
export function formatarBytes(n: number): string {
  const unidades = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < unidades.length - 1) {
    v /= 1024;
    i++;
  }
  const texto = i === 0 ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 });
  return `${texto} ${unidades[i]}`;
}

/**
 * Por que a remoção não pode rodar, ou nulo. Um bucket com mídia e nenhuma
 * chave referenciada é o sinal de que a leitura das peças não atravessou o
 * isolamento por linha (RLS FORCE devolve zero linha em silêncio): remover ali
 * apagaria a mídia de todas as peças.
 */
export function motivoParaNaoRemover(uso: UsoDoStorage, pecasLidas: number, falhas: number): string | null {
  if (falhas > 0) return `a leitura das peças falhou em ${falhas} empresa(s): sem saber o que é referenciado, nada é removido.`;
  if (uso.objetos > 0 && (pecasLidas === 0 || uso.referenciados.objetos === 0)) {
    return 'há mídia no storage e nenhuma peça a referencia: a leitura das peças provavelmente não atravessou o isolamento (use a conexão dona, DATABASE_URL). Nada é removido.';
  }
  return null;
}
