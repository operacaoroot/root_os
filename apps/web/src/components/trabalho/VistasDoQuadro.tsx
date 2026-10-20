'use client';

import { useEffect, useRef, useState } from 'react';
import type { TelaDeVista, VistaFunil, VistaQuadro, VistaSalvaDto } from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

/*
 * AS VISTAS DO QUADRO (rodada do trabalho T3, 19/10/2026): os filtros, a
 * densidade e a visão do Trabalho salvos com nome, por pessoa, no servidor. A
 * padrão vale ao abrir quando o endereço não traz filtro (link copiado manda).
 *
 * Desde a rodada da interface (20/10/2026) o mesmo controle serve à Implantação
 * (`tela="implantacao"`, mesma forma do quadro) e ao Funil vivo (`tela="funil"`,
 * `VistaFunil`). Cada tela tem as suas vistas; a pessoa só vê as dela.
 */
type ConfigDaTela = VistaQuadro | VistaFunil;
const ROTULO_DA_TELA: Record<'quadro' | 'implantacao' | 'funil', string> = {
  quadro: 'do quadro', implantacao: 'da implantação', funil: 'do funil',
};

export function VistasDoQuadro<C extends ConfigDaTela = VistaQuadro>({ token, atual, aplicar, enderecoTemFiltro, tela = 'quadro', testId = 'trabalho' }: {
  token: string | null;
  atual: C;
  aplicar: (v: C) => void;
  enderecoTemFiltro: boolean;
  tela?: Extract<TelaDeVista, 'quadro' | 'implantacao' | 'funil'>;
  /** Prefixo dos `data-testid` (`<testId>-vistas`, `<testId>-vista`…). */
  testId?: string;
}) {
  const rotulo = ROTULO_DA_TELA[tela];
  const [vistas, setVistas] = useState<VistaSalvaDto[]>([]);
  const [id, setId] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const aplicou = useRef(false);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<VistaSalvaDto[]>(`/trabalho/vistas?tela=${tela}`, token)
      .then((r) => {
        if (!vivo || !Array.isArray(r)) return;
        setVistas(r);
        const padrao = r.find((v) => v.padrao);
        if (padrao && !aplicou.current && !enderecoTemFiltro) {
          aplicou.current = true;
          setId(padrao.id);
          aplicar(padrao.config as C);
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
    const nome = window.prompt(`Nome da vista ${rotulo} (por exemplo, "Meus atrasados")`)?.trim();
    if (!nome) return;
    try {
      const v = await apiPost<VistaSalvaDto>('/trabalho/vistas', { tela, nome, padrao: vistas.length === 0, config: atual }, token);
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
      setVistas((l) => l.map((x) => (x.id === v.id ? v : { ...x, padrao: false }))); setAviso(`"${v.nome}" é a sua vista padrão ${rotulo}.`);
    } catch (e) { setAviso((e as Error).message); }
  };

  return (
    <div className="flex items-center gap-1" data-testid={`${testId}-vistas`}>
      <select
        aria-label={`Vista ${rotulo}`}
        data-testid={`${testId}-vista`}
        value={id}
        onChange={(e) => {
          setId(e.target.value); setAviso(null);
          const v = vistas.find((x) => x.id === e.target.value);
          if (v) aplicar(v.config as C);
        }}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none"
      >
        <option value="">{vistas.length ? 'Vistas salvas' : 'Nenhuma vista salva'}</option>
        {vistas.map((v) => <option key={v.id} value={v.id}>{v.nome}{v.padrao ? ' (padrão)' : ''}</option>)}
      </select>
      <button type="button" data-testid={`${testId}-vista-salvar`} onClick={() => void salvarComo()} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-muted hover:text-text">Salvar vista</button>
      {vista && modificada && <button type="button" onClick={() => void atualizar()} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-muted hover:text-text">Atualizar</button>}
      {vista && !vista.padrao && <button type="button" data-testid={`${testId}-vista-padrao`} onClick={() => void padrao()} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-muted hover:text-text">Padrão</button>}
      {aviso && <span role="status" className="text-[11px] text-muted">{aviso}</span>}
    </div>
  );
}
