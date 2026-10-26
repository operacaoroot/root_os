'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BOTAO, BOTAO_PRIMARIO, ErroDaAcao, INPUT } from '../_ui';

/*
 * "+ LEAD" (layout 26/10/2026): o mesmo botão no Painel geral, no Funil de vendas,
 * na Lista de leads e em Propostas. Empresa, contato, telefone e e-mail; entra
 * pela entrada idempotente do OS (`POST /leads/entrada`, origem manual), a
 * empresa vai para a ficha pela correção de identidade (fato no fio, sem
 * automação) e o lead abre no painel dele, no Funil (E1 · Novo lead).
 */
export function NovoLead({ origem, className = '' }: { origem: string; className?: string }) {
  const { token, can } = useAuth();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [empresa, setEmpresa] = useState('');
  const [contato, setContato] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  if (!can('leads.editar')) return null;

  async function criar() {
    const nome = contato.trim() || empresa.trim();
    if (!nome) { setErro(new Error('Diga a empresa ou o nome do contato.')); return; }
    setOcupado(true);
    setErro(null);
    try {
      const ref = `${origem}:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
      const l = await apiPost<{ id: string }>('/leads/entrada', {
        origem: { tipo: 'manual', ref },
        nome,
        ...(telefone.trim() ? { telefone: telefone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      }, token);
      if (empresa.trim() && contato.trim()) {
        await apiPost(`/comercial/lead/${encodeURIComponent(l.id)}/identidade`, { empresa: empresa.trim() }, token);
      }
      setAberto(false);
      setEmpresa(''); setContato(''); setTelefone(''); setEmail('');
      router.push(`/comercial/funil?lead=${encodeURIComponent(l.id)}&aba=fio`);
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div ref={caixa} className={`relative ${className}`}>
      <button type="button" data-testid={`novo-lead-${origem}`} aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className={BOTAO_PRIMARIO}>
        + lead
      </button>
      {aberto && (
        <form
          data-testid="novo-lead-form"
          onSubmit={(e) => { e.preventDefault(); void criar(); }}
          className="absolute right-0 top-full z-50 mt-1 w-[min(22rem,92vw)] space-y-2 rounded-lg border border-border bg-bg p-3 shadow-2xl"
        >
          <p className="text-[13px] font-semibold">Novo lead</p>
          <label className="block text-[11px] text-muted">Empresa
            <input autoFocus value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="ex.: Sr. aGranel" className={INPUT} />
          </label>
          <label className="block text-[11px] text-muted">Contato
            <input value={contato} onChange={(e) => setContato(e.target.value)} placeholder="quem fala pela empresa" className={INPUT} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-muted">Telefone
              <input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" placeholder="(61) 99999-0000" className={INPUT} />
            </label>
            <label className="block text-[11px] text-muted">E-mail
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={INPUT} />
            </label>
          </div>
          <ErroDaAcao erro={erro} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAberto(false)} className={BOTAO}>cancelar</button>
            <button type="submit" disabled={ocupado} className={BOTAO_PRIMARIO}>criar e abrir</button>
          </div>
        </form>
      )}
    </div>
  );
}
