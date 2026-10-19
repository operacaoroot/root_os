'use client';

import { useEffect, useRef, useState } from 'react';
import type { VistaQuadro, VistaSalvaDto } from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

/*
 * AS VISTAS DO QUADRO (rodada do trabalho T3, 19/10/2026): os filtros, a
 * densidade e a visão do Trabalho salvos com nome, por pessoa, no servidor. A
 * padrão vale ao abrir quando o endereço não traz filtro (link copiado manda).
 */
export function VistasDoQuadro({ token, atual, aplicar, enderecoTemFiltro }: {
  token: string | null;
  atual: VistaQuadro;
  aplicar: (v: VistaQuadro) => void;
  enderecoTemFiltro: boolean;
}) {
  const [vistas, setVistas] = useState<VistaSalvaDto[]>([]);
  const [id, setId] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const aplicou = useRef(false);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<VistaSalvaDto[]>('/trabalho/vistas?tela=quadro', token)
      .then((r) => {
        if (!vivo || !Array.isArray(r)) return;
        setVistas(r);
        const padrao = r.find((v) => v.padrao);
        if (padrao && !aplicou.current && !enderecoTemFiltro) {
          aplicou.current = true;
          setId(padrao.id);
          aplicar(padrao.config as VistaQuadro);
        }
      })
      .catch(() => { /* sem vistas: o quadro segue */ });
    return () => { vivo = false; };
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const vista = vistas.find((v) => v.id === id) ?? null;
  const modificada = !!vista && JSON.stringify(vista.config) !== JSON.stringify(atual);

  const salvarComo = async () => {
    const nome = window.prompt('Nome da vista do quadro (por exemplo, "Meus atrasados")')?.trim();
    if (!nome) return;
    try {
      const v = await apiPost<VistaSalvaDto>('/trabalho/vistas', { tela: 'quadro', nome, padrao: vistas.length === 0, config: atual }, token);
      setVistas((l) => [...l, v]); setId(v.id); setAviso(`Vista "${v.nome}" salva.`);
    } catch (e) { setAviso((e as Error).message); }
  };
  const atualizar = async () => {
    if (!vista) return;
    try {
      const v = await apiPatch<VistaSalvaDto>(`/trabalho/vistas/${vista.id}`, { config: atual }, token);
      setVistas((l) => l.map((x) => (x.id === v.id ? v : x))); setAviso(`Vista "${v.nome}" atualizada.`);
    } catch (e) { setAviso((e as Error).message); }
  };
  const padrao = async () => {
    if (!vista) return;
    try {
      const v = await apiPatch<VistaSalvaDto>(`/trabalho/vistas/${vista.id}`, { padrao: true }, token);
      setVistas((l) => l.map((x) => (x.id === v.id ? v : { ...x, padrao: false }))); setAviso(`"${v.nome}" é a sua vista padrão do quadro.`);
    } catch (e) { setAviso((e as Error).message); }
  };

  return (
    <div className="flex items-center gap-1" data-testid="trabalho-vistas">
      <select
        aria-label="Vista do quadro"
        data-testid="trabalho-vista"
        value={id}
        onChange={(e) => {
          setId(e.target.value); setAviso(null);
          const v = vistas.find((x) => x.id === e.target.value);
          if (v) aplicar(v.config as VistaQuadro);
        }}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none"
      >
        <option value="">{vistas.length ? 'Vistas salvas' : 'Nenhuma vista salva'}</option>
        {vistas.map((v) => <option key={v.id} value={v.id}>{v.nome}{v.padrao ? ' (padrão)' : ''}</option>)}
      </select>
      <button type="button" data-testid="trabalho-vista-salvar" onClick={() => void salvarComo()} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-muted hover:text-text">Salvar vista</button>
      {vista && modificada && <button type="button" onClick={() => void atualizar()} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-muted hover:text-text">Atualizar</button>}
      {vista && !vista.padrao && <button type="button" data-testid="trabalho-vista-padrao" onClick={() => void padrao()} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-muted hover:text-text">Padrão</button>}
      {aviso && <span role="status" className="text-[11px] text-muted">{aviso}</span>}
    </div>
  );
}
