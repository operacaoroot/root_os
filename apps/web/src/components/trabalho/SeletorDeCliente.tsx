'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { TrabClienteDto } from '@mktos/shared';
import { apiGet } from '@/lib/api';

/*
 * O SELETOR DE CLIENTE (rodada do trabalho T4, 19/10/2026). Toda tarefa nova é
 * ligada a um cliente; o trabalho da própria empresa vai para o cliente da casa
 * ("<empresa> (interno)", que nasce na primeira escolha). Busca por nome ou CNPJ
 * em `GET /trabalho/clientes`, o cadastro que o fechamento comercial escreve.
 *
 * Combobox do teclado: setas andam, Enter escolhe, Esc fecha.
 */

export interface ClienteEscolhido { id: string; nome: string }

export function SeletorDeCliente({ valor, onEscolher, token, rotulo = 'Cliente', obrigatorio = false, desabilitado = false, testid = 'seletor-de-cliente' }: {
  valor: ClienteEscolhido | null;
  onEscolher: (c: ClienteEscolhido) => void;
  token: string | null;
  rotulo?: string;
  obrigatorio?: boolean;
  desabilitado?: boolean;
  testid?: string;
}) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<TrabClienteDto[]>([]);
  const [ativo, setAtivo] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const idLista = useId();
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto || !token) return;
    let vivo = true;
    const t = setTimeout(() => {
      apiGet<TrabClienteDto[]>(`/trabalho/clientes${busca.trim() ? `?q=${encodeURIComponent(busca.trim())}` : ''}`, token)
        .then((r) => { if (vivo) { setOpcoes(Array.isArray(r) ? r : []); setAtivo(0); setErro(null); } })
        .catch((e: Error) => { if (vivo) setErro(e.message); });
    }, 150);
    return () => { vivo = false; clearTimeout(t); };
  }, [aberto, busca, token]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const escolher = (c: TrabClienteDto) => {
    onEscolher({ id: c.id, nome: c.nome });
    setAberto(false);
    setBusca('');
  };

  return (
    <div ref={caixa} className="relative" data-testid={testid}>
      <input
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-label={rotulo}
        aria-required={obrigatorio}
        disabled={desabilitado}
        value={aberto ? busca : valor?.nome ?? ''}
        placeholder={obrigatorio ? 'Escolha o cliente *' : 'Escolha o cliente'}
        onFocus={() => setAberto(true)}
        onClick={() => setAberto(true)}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { if (aberto) { e.stopPropagation(); setAberto(false); } return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo((i) => Math.min(i + 1, Math.max(opcoes.length - 1, 0))); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && aberto && opcoes[ativo]) { e.preventDefault(); e.stopPropagation(); escolher(opcoes[ativo]); }
        }}
        className={`w-full rounded-lg border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-brand-dim disabled:opacity-60 ${obrigatorio && !valor ? 'border-warn/60' : 'border-border'}`}
      />
      {aberto && (
        <ul id={idLista} role="listbox" aria-label={`${rotulo}: opções`} className="absolute left-0 right-0 z-[60] mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {erro && <li className="px-2 py-1.5 text-[12px] text-bad">{erro}</li>}
          {!erro && opcoes.length === 0 && <li className="px-2 py-1.5 text-[12px] text-muted">Nenhum cliente com esse nome.</li>}
          {opcoes.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === ativo}
              data-testid={`opcao-cliente-${c.interno ? 'interno' : c.id}`}
              onMouseDown={(e) => { e.preventDefault(); escolher(c); }}
              onMouseEnter={() => setAtivo(i)}
              className={`cursor-pointer px-2 py-1.5 text-[13px] ${i === ativo ? 'bg-brand/15 text-text' : 'text-text'}`}
            >
              {c.nome}
              {c.interno && <span className="ml-1 text-[11px] text-muted">· trabalho da casa</span>}
              {c.cnpj && <span className="ml-1 font-os-mono text-[10.5px] text-muted">{c.cnpj}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
