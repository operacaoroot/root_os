'use client';

import { useEffect, useState } from 'react';
import type { ChartAccountList, FinanceAccountList, PartnerList } from '@mktos/shared';
import { apiPatch, apiPost } from '@/lib/api';

/*
 * CRIAR, EDITAR E BAIXAR UM TÍTULO (layout 26/10/2026, P-23 e P-24).
 *
 * A API já fazia tudo (`POST/PATCH /finance/transactions`); faltava a tela. Uma
 * janela só, no meio da tela, para quatro usos:
 *   · novo       "+ A receber" / "+ A pagar" em A Pagar/Receber (nasce previsto);
 *   · editar     valor, vencimento, descrição, parceiro, conta e observação;
 *   · baixar     pede a data e o valor pago (antes baixava sem perguntar);
 *   · movimento  na Conciliação, cria o título a partir do movimento do banco
 *                e já concilia os dois.
 * Nada aqui muda regra: aprovação acima do limite, rateio e sincronização do
 * banco continuam com a API.
 */

export type ModoDaJanela =
  | { tipo: 'novo'; lado: 'entrada' | 'saida' }
  | { tipo: 'editar'; id: string; lado: 'entrada' | 'saida'; descricao: string; valor: number; vencimento: string | null; parceiro: string | null }
  | { tipo: 'baixar'; id: string; descricao: string; valor: number }
  | { tipo: 'movimento'; movimentoId: string; lado: 'entrada' | 'saida'; descricao: string; valor: number; data: string; contaId: string };

const hoje = () => new Date().toISOString().slice(0, 10);
const diaDe = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const ENTRADA = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';

export function JanelaDeTitulo({ modo, partners, chart, accounts, token, onFechar, onSalvo, onError }: {
  modo: ModoDaJanela;
  partners: PartnerList | null;
  chart: ChartAccountList | null;
  accounts: FinanceAccountList | null;
  token: string | null;
  onFechar: () => void;
  onSalvo: (mensagem: string) => void;
  onError: (e: unknown) => void;
}) {
  const lancaveis = (chart?.items ?? []).filter((c) => c.permiteLancamento && c.ativo);
  const [descricao, setDescricao] = useState('descricao' in modo ? modo.descricao : '');
  const [valor, setValor] = useState('valor' in modo ? String(modo.valor) : '');
  const [data, setData] = useState(modo.tipo === 'editar' ? diaDe(modo.vencimento) : modo.tipo === 'movimento' ? diaDe(modo.data) : hoje());
  const [parceiro, setParceiro] = useState('');
  const [conta, setConta] = useState('');
  const [banco, setBanco] = useState(modo.tipo === 'movimento' ? modo.contaId : accounts?.items[0]?.id ?? '');
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const titulo = modo.tipo === 'novo' ? (modo.lado === 'entrada' ? 'Novo a receber' : 'Novo a pagar')
    : modo.tipo === 'editar' ? 'Editar lançamento'
    : modo.tipo === 'baixar' ? 'Baixar lançamento'
    : 'Criar título a partir do movimento';

  const salvar = async () => {
    const quanto = Number(valor.replace(',', '.'));
    if (!(quanto > 0)) { onError('Informe um valor maior que zero.'); return; }
    if (modo.tipo !== 'baixar' && !descricao.trim()) { onError('Informe a descrição.'); return; }
    if (!data) { onError(modo.tipo === 'baixar' ? 'Informe a data do pagamento.' : 'Informe o vencimento.'); return; }
    setSalvando(true);
    try {
      if (modo.tipo === 'baixar') {
        await apiPatch(`/finance/transactions/${modo.id}`, { status: 'realizado', paidAt: data, amount: quanto }, token);
        onSalvo(`Baixado: ${modo.descricao}.`);
      } else if (modo.tipo === 'editar') {
        await apiPatch(`/finance/transactions/${modo.id}`, {
          description: descricao.trim(), amount: quanto, dueDate: data,
          ...(parceiro ? { partnerId: parceiro === '-' ? null : parceiro } : {}),
          ...(conta ? { chartAccountId: conta } : {}),
          ...(obs.trim() ? { notes: obs.trim() } : {}),
        }, token);
        onSalvo('Lançamento atualizado.');
      } else {
        if (!banco) { onError('Escolha a conta bancária.'); setSalvando(false); return; }
        const lado = modo.lado;
        const criado = await apiPost<{ id: string }>('/finance/transactions', {
          accountId: banco, type: lado, status: 'previsto', description: descricao.trim(), amount: quanto,
          date: data, dueDate: data, partnerId: parceiro && parceiro !== '-' ? parceiro : null,
          chartAccountId: conta || null, notes: obs.trim() || null,
        }, token);
        if (modo.tipo === 'movimento') {
          await apiPost('/finance/conciliacao/match', { movimentoId: modo.movimentoId, tituloId: criado.id }, token);
          onSalvo('Título criado e conciliado com o movimento.');
        } else {
          onSalvo(lado === 'entrada' ? 'A receber criado.' : 'A pagar criado.');
        }
      }
    } catch (e) {
      onError(e);
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] rounded-xl border border-border bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded px-2 text-xl leading-none text-muted hover:text-text">×</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {modo.tipo !== 'baixar' && (
            <label className="block sm:col-span-2 text-sm"><span className="mb-1 block text-muted">Descrição</span>
              <input id="titulo-descricao" className={ENTRADA} value={descricao} onChange={(e) => setDescricao(e.target.value)} autoFocus /></label>
          )}
          {modo.tipo === 'baixar' && <p className="sm:col-span-2 text-sm text-muted">{modo.descricao}</p>}
          <label className="block text-sm"><span className="mb-1 block text-muted">{modo.tipo === 'baixar' ? 'Valor pago (R$)' : 'Valor (R$)'}</span>
            <input id="titulo-valor" className={ENTRADA} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
          <label className="block text-sm"><span className="mb-1 block text-muted">{modo.tipo === 'baixar' ? 'Pago em' : 'Vencimento'}</span>
            <input id="titulo-data" type="date" className={ENTRADA} value={data} onChange={(e) => setData(e.target.value)} /></label>
          {modo.tipo !== 'baixar' && (
            <>
              <label className="block text-sm"><span className="mb-1 block text-muted">Cliente ou fornecedor</span>
                <select id="titulo-parceiro" className={ENTRADA} value={parceiro} onChange={(e) => setParceiro(e.target.value)}>
                  <option value="">{modo.tipo === 'editar' ? `Manter (${modo.parceiro ?? 'nenhum'})` : 'Nenhum'}</option>
                  {modo.tipo === 'editar' && <option value="-">Tirar o parceiro</option>}
                  {partners?.items.map((p) => <option key={p.id} value={p.id}>{p.nomeFantasia || p.razaoSocial}</option>)}
                </select></label>
              <label className="block text-sm"><span className="mb-1 block text-muted">Conta do plano (DRE)</span>
                <select id="titulo-conta" className={ENTRADA} value={conta} onChange={(e) => setConta(e.target.value)}>
                  <option value="">{modo.tipo === 'editar' ? 'Manter a atual' : 'Sem conta ainda'}</option>
                  {lancaveis.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nome}</option>)}
                </select></label>
              {modo.tipo !== 'editar' && (
                <label className="block sm:col-span-2 text-sm"><span className="mb-1 block text-muted">Conta bancária</span>
                  <select id="titulo-banco" className={ENTRADA} value={banco} onChange={(e) => setBanco(e.target.value)}>
                    <option value="">Escolher…</option>
                    {accounts?.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select></label>
              )}
              <label className="block sm:col-span-2 text-sm"><span className="mb-1 block text-muted">Observação</span>
                <input id="titulo-obs" className={ENTRADA} value={obs} onChange={(e) => setObs(e.target.value)} placeholder={modo.tipo === 'movimento' ? 'Ex.: parte paga pela ROOT, parte do Lucas' : ''} /></label>
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2">Cancelar</button>
          <button type="button" disabled={salvando} onClick={() => void salvar()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60">
            {salvando ? 'Salvando…' : modo.tipo === 'baixar' ? 'Baixar' : modo.tipo === 'movimento' ? 'Criar e conciliar' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
