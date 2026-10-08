import type { M05EscopoDto, M05FonteAutorizadaDto } from '@mktos/shared';
import { quando } from './tipos';

export function escopoConfere(escopo: M05EscopoDto | undefined, pessoaId: string, anterior?: M05EscopoDto | null, slug?: string): escopo is M05EscopoDto {
  if (!escopo || !escopo.orgId || escopo.userId !== pessoaId) return false;
  if (anterior && (anterior.orgId !== escopo.orgId || anterior.userId !== escopo.userId || anterior.agentId !== escopo.agentId || anterior.agentSlug !== escopo.agentSlug)) return false;
  return !slug || (!!escopo.agentId && escopo.agentSlug === slug);
}

type Esperada = { itemId: string; versionId?: string; versao?: number; contentHash?: string; chave?: string; title?: string; body?: string | null };
export function retratoConfere(r: M05FonteAutorizadaDto | undefined, f: Esperada): r is M05FonteAutorizadaDto {
  return !!r && r.itemId === f.itemId && r.identidadeCanonica?.documentId === f.itemId
    && ['vault_canonica', 'manual_local'].includes(r.colecao) && r.acesso?.modelo === 'local_por_pessoa'
    && typeof r.title === 'string' && (r.body === null || typeof r.body === 'string')
    && !!r.chave && !!r.versao?.versionId && Number.isInteger(r.versao.numero) && r.versao.numero >= 1 && /^[a-f0-9]{64}$/.test(r.versao.contentHash)
    && (f.versionId === undefined || r.versao.versionId === f.versionId)
    && (f.versao === undefined || r.versao.numero === f.versao)
    && (f.contentHash === undefined || r.versao.contentHash === f.contentHash)
    && (f.chave === undefined || r.chave === f.chave) && (f.title === undefined || r.title === f.title)
    && (f.body === undefined || r.body === f.body)
    && r.citacao?.itemId === r.itemId && r.citacao.chave === r.chave
    && r.citacao.versionId === r.versao.versionId && r.citacao.versao === r.versao.numero && r.citacao.contentHash === r.versao.contentHash;
}

export class RecuperacaoIndisponivel extends Error {
  constructor() { super('Não foi possível conferir os pedidos guardados. Reabra esta tela para conferir.'); this.name = 'RecuperacaoIndisponivel'; }
}
export interface IdentificadorDePedido extends M05EscopoDto { requestId: string; operation: 'tarefa' | 'procedimento' | 'criacao'; itemId?: string }
export function chaveDoPedido(e: M05EscopoDto, operation: IdentificadorDePedido['operation'], itemId?: string) {
  return ['rootos', 'm05', e.orgId, e.userId, e.agentId ?? '', e.agentSlug ?? '', operation, itemId ?? ''].map(encodeURIComponent).join(':');
}
export function lerIdentificador(chave: string, escopo: M05EscopoDto, operation: IdentificadorDePedido['operation'], itemId?: string): IdentificadorDePedido | null {
  try {
    const direta = localStorage.getItem(chave);
    const origem = direta === null ? `${chave}:legado` : chave;
    const r: IdentificadorDePedido | null = JSON.parse(localStorage.getItem(origem) ?? 'null');
    const permitidas = ['orgId', 'userId', 'agentId', 'agentSlug', 'requestId', 'operation', 'itemId'];
    if (r && Object.keys(r).every((k) => permitidas.includes(k)) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.requestId)
      && escopoConfere(r, escopo.userId, escopo) && r.operation === operation && r.itemId === itemId) {
      if (origem !== chave) { try { localStorage.setItem(chave, JSON.stringify(r)); localStorage.removeItem(origem); } catch { /* A pista continua no storage anterior e em memória. */ } }
      return r;
    }
    if (r) localStorage.removeItem(origem);
  } catch { throw new RecuperacaoIndisponivel(); }
  return null;
}
export function migrarPedidoLegado(antiga: string, nova: string, escopo: M05EscopoDto, operation: IdentificadorDePedido['operation'], itemId?: string): IdentificadorDePedido | null {
  let pista: IdentificadorDePedido | null = null;
  try {
    const r = JSON.parse(localStorage.getItem(antiga) ?? 'null');
    const requestId = r?.requestId;
    if (typeof requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) {
      pista = { ...escopo, requestId, operation, ...(itemId ? { itemId } : {}) };
      const existente = lerIdentificador(nova, escopo, operation, itemId);
      const destino = existente && existente.requestId !== requestId ? `${nova}:legado` : nova;
      if (!guardarIdentificador(destino, pista)) {
        // Tenta sanear somente com metadados, sem apagar a única pista durável.
        guardarIdentificador(antiga, pista);
        // A abertura fica bloqueada até preservar a pista na partição autorizada.
        throw new RecuperacaoIndisponivel();
      }
    }
  } catch (e) { if (e instanceof RecuperacaoIndisponivel || !pista) throw new RecuperacaoIndisponivel(); }
  removerIdentificador(antiga);
  return pista;
}
export function guardarIdentificador(chave: string, id: IdentificadorDePedido): boolean {
  try { localStorage.setItem(chave, JSON.stringify(id)); return true; } catch { return false; }
}
export function removerIdentificador(chave: string) { try { localStorage.removeItem(chave); } catch { /* O servidor continua autoritativo. */ } }

const estados = { nao_verificada: 'não verificada', ok: 'concluída', parcial: 'parcial', falhou: 'falhou' };
export function RetratoDaFonte({ fonte, usada = false }: { fonte: M05FonteAutorizadaDto; usada?: boolean }) {
  return <section aria-label={usada ? 'Retrato da fonte usada' : 'Retrato da fonte selecionada'} className="space-y-2 rounded-root border border-border p-3 text-xs">
    <p className="font-medium">{fonte.colecao === 'vault_canonica' ? 'Vault canônica' : 'Fonte manual local'}</p>
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
      <dt className="text-dim">documento</dt><dd className="break-words">{fonte.identidadeCanonica.documentId}</dd>
      <dt className="text-dim">origem</dt><dd className="break-words">{fonte.origem.tipo}{fonte.origem.referencia ? ` · ${fonte.origem.referencia}` : ''}</dd>
      <dt className="text-dim">{usada ? 'versão usada' : 'versão selecionada'}</dt><dd>v{fonte.versao.numero}</dd>
      <dt className="text-dim">versão atual</dt><dd>v{fonte.versaoAtual}{fonte.arquivada ? ' · fonte arquivada' : ''}</dd>
      <dt className="text-dim">versão registrada</dt><dd>{quando(fonte.registradaEm)}</dd>
      <dt className="text-dim">atualizada na memória</dt><dd>{quando(fonte.atualizadaNaMemoriaEm)}</dd>
      <dt className="text-dim">acesso consultado</dt><dd>{quando(fonte.acesso.verificadoEm)} · {fonte.acesso.novoUsoPermitido ? 'novo uso permitido nesta consulta' : 'novo uso indisponível'}</dd>
      <dt className="text-dim">coleta</dt><dd>{estados[fonte.estado.coleta]}</dd>
      <dt className="text-dim">indexação</dt><dd>{estados[fonte.estado.indexacao]}</dd>
      <dt className="text-dim">projeção</dt><dd>{estados[fonte.estado.projecao]}</dd>
    </dl>
    <p className="break-words text-muted">Citação: {fonte.citacao.chave} · v{fonte.citacao.versao} · {fonte.citacao.versionId}</p>
    <p className="break-all text-muted">Hash da versão: {fonte.versao.contentHash}</p>
  </section>;
}
