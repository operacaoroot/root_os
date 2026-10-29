'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROTULO_DO_MOTIVO_DO_PARECIDO, type LeadParecido, type LeadsParecidosResposta } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { partesDoLead } from '@/lib/nome-do-lead';
import { BOTAO, BOTAO_PRIMARIO, ErroDaAcao, INPUT } from '../_ui';

/*
 * "+ LEAD" (layout 26/10/2026): o mesmo botão no Painel geral, no Funil de vendas,
 * na Lista de leads e em Propostas. Empresa, contato, telefone e e-mail; entra
 * pela entrada idempotente do OS (`POST /leads/entrada`, origem manual), a
 * empresa vai para a ficha pela correção de identidade (fato no fio, sem
 * automação) e o lead abre no painel dele, no Funil (E1 · Novo lead).
 *
 * O LEAD QUE JÁ EXISTE (29/10/2026): enquanto a pessoa digita, a tela pergunta
 * se já há lead com o mesmo telefone, e-mail, empresa ou contato
 * (`GET /comercial/leads/parecidos`). Achou: "abrir" leva ao card (follow-up é
 * etapa do mesmo card); "venda nova deste cliente" cria o lead ligado ao mesmo
 * cadastro (`POST /comercial/lead/:id/venda-nova`), só para quem já é cliente;
 * e o botão de criar vira "criar mesmo assim", para outra empresa de nome parecido.
 */
function referenciaDoClique(origem: string): string {
  return `${origem}:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;
}

export function NovoLead({ origem, className = '' }: { origem: string; className?: string }) {
  const { token, can } = useAuth();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [empresa, setEmpresa] = useState('');
  const [contato, setContato] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [parecidos, setParecidos] = useState<LeadParecido[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const procura = useRef(0);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  // A procura do parecido: espera a pessoa parar de digitar; falha ou resposta velha não atrapalha quem cria.
  useEffect(() => {
    if (!aberto) return;
    const q = new URLSearchParams();
    if (empresa.trim().length >= 3) q.set('empresa', empresa.trim());
    if (contato.trim().length >= 3) q.set('contato', contato.trim());
    if (telefone.replace(/\D/g, '').length >= 10) q.set('telefone', telefone.trim());
    if (email.includes('@')) q.set('email', email.trim());
    const vez = ++procura.current;
    if (![...q.keys()].length) { setParecidos([]); return; }
    const t = setTimeout(() => {
      apiGet<LeadsParecidosResposta>(`/comercial/leads/parecidos?${q.toString()}`, token)
        .then((r) => { if (vez === procura.current) setParecidos(r.parecidos); })
        .catch(() => { if (vez === procura.current) setParecidos([]); });
    }, 350);
    return () => clearTimeout(t);
  }, [aberto, empresa, contato, telefone, email, token]);

  if (!can('leads.editar')) return null;

  function limpar() {
    setAberto(false);
    setEmpresa(''); setContato(''); setTelefone(''); setEmail('');
    setParecidos([]);
  }

  function abrir(leadId: string) {
    limpar();
    router.push(`/comercial/funil?lead=${encodeURIComponent(leadId)}&aba=geral`);
  }

  async function criar() {
    const nome = contato.trim() || empresa.trim();
    if (!nome) { setErro(new Error('Diga a empresa ou o nome do contato.')); return; }
    setOcupado(true);
    setErro(null);
    try {
      const l = await apiPost<{ id: string }>('/leads/entrada', {
        origem: { tipo: 'manual', ref: referenciaDoClique(origem) },
        nome,
        ...(telefone.trim() ? { telefone: telefone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      }, token);
      if (empresa.trim() && contato.trim()) {
        await apiPost(`/comercial/lead/${encodeURIComponent(l.id)}/identidade`, { empresa: empresa.trim() }, token);
      }
      abrir(l.id);
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(false);
    }
  }

  async function vendaNova(p: LeadParecido) {
    setOcupado(true);
    setErro(null);
    try {
      const l = await apiPost<{ id: string }>(`/comercial/lead/${encodeURIComponent(p.leadId)}/venda-nova`, {
        ref: referenciaDoClique(origem),
        ...(contato.trim() ? { contato: contato.trim() } : {}),
        ...(telefone.trim() ? { telefone: telefone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      }, token);
      abrir(l.id);
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
          {parecidos.length > 0 && (
            <div data-testid="novo-lead-parecidos" role="status" className="space-y-1.5 rounded border border-warn/50 bg-warn/10 p-2">
              <p className="text-[12px] font-semibold">Já existe no funil</p>
              <ul className="space-y-1.5">
                {parecidos.map((p) => {
                  const n = partesDoLead(p.nome, p.empresa);
                  return (
                    <li key={p.leadId} data-testid={`novo-lead-parecido-${p.leadId}`} className="rounded border border-border bg-bg p-2">
                      <p className="truncate text-[12.5px] font-semibold" title={n.titulo}>
                        {n.titulo}
                        {n.pessoa && <span className="font-normal text-muted"> · {n.pessoa}</span>}
                      </p>
                      <p className="text-[11px] text-muted">
                        {p.rotuloDaEtapa}
                        {p.rotuloDoProduto ? ` · ${p.rotuloDoProduto}` : ''}
                        {' · '}
                        {p.motivos.map((m) => ROTULO_DO_MOTIVO_DO_PARECIDO[m]).join(', ')}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <button type="button" data-testid={`novo-lead-abrir-${p.leadId}`} onClick={() => abrir(p.leadId)} className={BOTAO}>abrir</button>
                        {p.cadastroId && (
                          <button type="button" data-testid={`novo-lead-venda-nova-${p.leadId}`} disabled={ocupado} onClick={() => void vendaNova(p)} className={BOTAO}>
                            venda nova deste cliente
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-muted">
                Follow-up é no card que já existe: abra e mova para E7. Venda nova só aparece para quem já é cliente. Se for outra empresa, crie mesmo assim.
              </p>
            </div>
          )}
          <ErroDaAcao erro={erro} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAberto(false)} className={BOTAO}>cancelar</button>
            <button type="submit" disabled={ocupado} className={parecidos.length ? BOTAO : BOTAO_PRIMARIO}>
              {parecidos.length ? 'criar mesmo assim' : 'criar e abrir'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
