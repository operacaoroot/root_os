'use client';

/*
 * O KIT E A PASTA DO CLIENTE NO CARD DA IMPLANTAÇÃO (rodada dos agentes, 21/10/2026, IM-07).
 *
 * Dentro de "Quem trabalha nesta etapa": o botão "Montar kit" (o montador do kit, IM-07,
 * monta a partir do manifesto do trilho e do contexto do cliente e grava em 03-kickoff
 * pelo arquivista), o estado do último kit e a pasta do cliente (<PastaDoCliente>).
 * Card em "Kit montado" sem kit mostra AVISO, não trava nada.
 *
 * Rotas: `GET /tenants/onboarding/trilhos/:id/kit` (`tarefas.ver`) e
 * `POST /tenants/onboarding/trilhos/:id/kit` (`tarefas.editar`).
 */
import { useCallback, useEffect, useState } from 'react';
import type { EstadoDaCopiaDoKit, KitEPastaDoCard, KitNaTela } from '@mktos/shared';

import { PastaDoCliente } from '@/components/clientes/PastaDoCliente';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { diaCurto } from '@/lib/datas-do-cartao';

const ROTULO_DA_COPIA: Record<EstadoDaCopiaDoKit, string> = {
  enviado: 'cópia em 03-kickoff',
  aguardando_aprovacao: 'cópia em 03-kickoff esperando aprovação',
  na_fila: 'cópia na fila: o cliente ainda não tem pasta',
  classificar_a_mao: 'cópia esperando classificar à mão',
  so_no_os: 'só no OS',
  erro: 'a cópia em 03-kickoff falhou',
  sem_cliente: 'sem cliente ligado: só no OS',
};

export function KitDaImplantacao({ trilhoId, token }: { trilhoId: string; token: string | null }) {
  const { can } = useAuth();
  const [dados, setDados] = useState<KitEPastaDoCard | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [montando, setMontando] = useState(false);

  const ler = useCallback(async () => {
    if (!token) return;
    try {
      setDados(await apiGet<KitEPastaDoCard>(`/tenants/onboarding/trilhos/${encodeURIComponent(trilhoId)}/kit`, token));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [trilhoId, token]);

  useEffect(() => {
    void ler();
  }, [ler]);

  const montar = async () => {
    if (!token) return;
    setMontando(true);
    setErro(null);
    try {
      const kit = await apiPost<KitNaTela>(`/tenants/onboarding/trilhos/${encodeURIComponent(trilhoId)}/kit`, {}, token);
      setDados((d) => (d ? { ...d, kit, avisoSemKit: false } : d));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setMontando(false);
    }
  };

  const kit = dados?.kit ?? null;
  return (
    <section aria-label="Kit de implantação" data-testid="kit-da-implantacao" className="space-y-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
      {dados?.avisoSemKit && (
        <p role="status" data-testid="kit-aviso" className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-warn">
          O card está em &quot;Kit montado&quot; e o kit ainda não foi montado. Monte agora ou siga: nada trava.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Kit de implantação · IM-07</span>
        {kit ? (
          <span className="text-muted" data-testid="kit-estado">
            {kit.arquivo} · {diaCurto(kit.montadoEm)} · {kit.secoes.length} seções · {ROTULO_DA_COPIA[kit.copia.estado] ?? kit.copia.estado}
          </span>
        ) : (
          <span className="text-muted">ainda não montado</span>
        )}
        {can('tarefas.editar') && (
          <button
            type="button"
            onClick={montar}
            disabled={montando || !token}
            data-testid="kit-montar"
            className="rounded border border-border px-2 py-0.5 text-[11.5px] hover:border-brand disabled:opacity-50"
          >
            {montando ? 'Montando…' : kit ? 'Montar de novo' : 'Montar kit'}
          </button>
        )}
      </div>
      {kit && kit.avisos.length > 0 && (
        <details className="text-muted">
          <summary className="cursor-pointer">{kit.avisos.length} aviso(s) do montador</summary>
          <ul className="list-disc pl-4">{kit.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      )}
      {kit?.copia.motivo && kit.copia.estado !== 'enviado' && <p className="text-muted">{kit.copia.motivo}</p>}
      {erro && <p role="alert" className="text-bad">{erro}</p>}
      {dados && (
        <div data-testid="kit-pasta">
          {/* `key`: o componente guarda o link no estado dele; quando a leitura chega, ele nasce de novo com ela. */}
          <PastaDoCliente
            key={`${dados.cliente?.partnerId ?? 'sem'}:${dados.cliente?.pastaUrl ?? ''}`}
            partnerId={dados.cliente?.partnerId ?? null}
            url={dados.cliente?.pastaUrl ?? null}
            erro={dados.cliente?.pastaErro ?? null}
            compacto
          />
        </div>
      )}
    </section>
  );
}
