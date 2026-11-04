'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useConsultaPorEscopo } from '@/lib/consulta-por-escopo';
import { BOTAO_DA_CARTEIRA, CAMPO_DA_CARTEIRA } from './SelecaoDaCarteira';

type Registro = { clienteId: string };
export type PaginaDaCarteira<T> = { items: T[]; total: number; page: number; limit: number };
type Apresentacao<T extends Registro> = {
  identificar: (registro: T) => string | undefined;
  titulo: (registro: T) => string;
  subtitulo?: (registro: T) => ReactNode;
  detalhe: (registro: T) => ReactNode;
};
type Consulta<T extends Registro> = Apresentacao<T> & { base: string; clienteId: string; token: string };
type Props<T extends Registro, P extends PaginaDaCarteira<T>> = Consulta<T> & {
  rotulo: string;
  buscaRotulo: string;
  vazio: string;
  resumo?: (pagina: P, busca: string) => ReactNode;
};
const limite = 30;

export function RegistrosPaginadosDaCarteira<T extends Registro, P extends PaginaDaCarteira<T> = PaginaDaCarteira<T>>(
  { rotulo, buscaRotulo, vazio, resumo, ...consulta }: Props<T, P>,
) {
  const { base, clienteId, token, identificar, titulo, subtitulo } = consulta;
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [id, setId] = useState<string | null>(null);
  const origem = useRef<HTMLButtonElement | null>(null);

  const query = new URLSearchParams({ clienteId, page: String(pagina), limit: String(limite) });
  if (busca) query.set('q', busca);
  const resultado = useConsultaPorEscopo<P>(`${base}?${query}`, token);
  const dados = resultado?.dados;
  const valido = dados && Array.isArray(dados.items) && Number.isSafeInteger(dados.total) && dados.total >= dados.items.length
    && dados.page === pagina && dados.limit === limite
    && dados.items.every((r) => r?.clienteId === clienteId && identificar(r));

  function trocarPagina(proxima: number) {
    setId(null);
    setPagina(proxima);
  }

  return (
    <section aria-label={rotulo} className="space-y-3">
      <form role="search" className="flex max-w-md flex-wrap gap-2" onSubmit={(e) => {
        e.preventDefault();
        trocarPagina(1);
        setBusca(texto.trim());
      }}>
        <input type="search" aria-label={buscaRotulo} placeholder={buscaRotulo} maxLength={120}
          className={`min-w-0 flex-1 ${CAMPO_DA_CARTEIRA}`} value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className={BOTAO_DA_CARTEIRA}>Buscar</button>
      </form>
      {id && (
        <DetalheDaCarteira key={id} id={id} {...consulta} fechar={() => {
          setId(null);
          origem.current?.focus();
        }} />
      )}
      {!resultado && <p role="status" className="text-sm text-muted">Carregando registros…</p>}
      {resultado?.erro && <p role="alert" className="text-sm text-bad">{resultado.erro}</p>}
      {resultado && !resultado.erro && !valido && (
        <p role="alert" className="text-sm text-bad">A lista recebida não corresponde ao cliente selecionado.</p>
      )}
      {valido && (
        <>
          {resumo?.(dados, busca)}
          {dados.items.length === 0 && <p className="text-sm text-muted">{vazio}</p>}
          <ul className="divide-y divide-border rounded-root border border-border bg-surface empty:hidden">
            {dados.items.map((r) => (
              <li key={identificar(r)} className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 px-3 py-1 text-sm">
                <button type="button" className="min-h-11 min-w-0 break-words text-left text-brand underline"
                  onClick={(e) => {
                    origem.current = e.currentTarget;
                    setId(identificar(r) ?? null);
                  }}>
                  {titulo(r)}
                </button>
                {subtitulo && <span className="text-muted">{subtitulo(r)}</span>}
              </li>
            ))}
          </ul>
          {(pagina > 1 || dados.total > limite) && (
            <nav aria-label="Páginas de resultados" className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className={BOTAO_DA_CARTEIRA} disabled={pagina === 1} onClick={() => trocarPagina(pagina - 1)}>Anterior</button>
              <span className="text-muted">Página {pagina}</span>
              <button type="button" className={BOTAO_DA_CARTEIRA} disabled={pagina * limite >= dados.total} onClick={() => trocarPagina(pagina + 1)}>Próxima</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function DetalheDaCarteira<T extends Registro>({ base, id, clienteId, token, identificar, titulo, detalhe, fechar }: Consulta<T> & {
  id: string; fechar: () => void;
}) {
  const painel = useRef<HTMLElement>(null);
  useLayoutEffect(() => painel.current?.focus(), []);
  const resultado = useConsultaPorEscopo<T>(`${base}/${encodeURIComponent(id)}?clienteId=${encodeURIComponent(clienteId)}`, token);
  const registro = resultado?.dados;
  const valido = registro && registro.clienteId === clienteId && identificar(registro) === id;
  return (
    <section ref={painel} tabIndex={-1} aria-label="Detalhe do registro" className="space-y-3 rounded-root border border-border bg-surface p-4 text-sm">
      <button type="button" className={BOTAO_DA_CARTEIRA} onClick={fechar}>Fechar detalhe</button>
      {!resultado && <p role="status" className="text-muted">Carregando detalhe…</p>}
      {resultado && !valido && <p role="alert" className="text-bad">Registro indisponível para este cliente.</p>}
      {valido && <><h2 className="text-base font-semibold">{titulo(registro)}</h2>{detalhe(registro)}</>}
    </section>
  );
}
