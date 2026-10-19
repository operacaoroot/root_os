'use client';

import { useEffect, useState } from 'react';
import { formatarReais, type ConteudoDoFechamento } from '@mktos/shared';
import { apiBlob, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * O FECHAMENTO, COMO A TITULAR O LÊ ANTES DE ASSINAR (rodada do trabalho T1b,
 * revisão P2-1, 19/10/2026).
 *
 * O pedido de `comercial.fechamento.executar` guarda só o lead, a chave e o
 * hash. Para quem fechou FORA do sistema, este R4 é a única conferência humana
 * dos dados que uma pessoa declarou e do PDF assinado: não há Pix nem ZapSign
 * no meio. O cartão busca o que o hash prende, com o hash RECALCULADO agora, e
 * o PDF que a declaração cita. Como a proposta e a sala: o botão de assinar só
 * aparece com o conteúdo carregado e conferindo.
 */

export const CAPACIDADE_DO_FECHAMENTO = 'comercial.fechamento.executar';

const dia = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d || '[a decidir]');
const FORMA: Record<string, string> = { pix: 'Pix', boleto: 'boleto', cartao: 'cartão' };

/** O lead do pedido: dos argumentos, ou da chave `fech-<lead>-v<n>` do recurso. */
export function leadDoFechamento(conteudo: Record<string, unknown> | null, recursoId: string): string | null {
  if (conteudo && typeof conteudo.leadId === 'string' && conteudo.leadId) return conteudo.leadId;
  const m = /^fech-(.+)-v\d+$/.exec(recursoId);
  return m ? m[1] : null;
}

export function CartaoDoFechamento({
  leadId,
  hashAssinado,
  onPronto,
}: {
  leadId: string | null;
  hashAssinado: string | null;
  onPronto: (ok: boolean) => void;
}) {
  const { token } = useAuth();
  const [c, setC] = useState<ConteudoDoFechamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroDoPdf, setErroDoPdf] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) {
      setErro('o pedido não diz qual lead fecha');
      onPronto(false);
      return;
    }
    let vivo = true;
    const q = hashAssinado ? `?hash=${encodeURIComponent(hashAssinado)}` : '';
    apiGet<ConteudoDoFechamento>(`/comercial/fechamentos/${encodeURIComponent(leadId)}/conteudo${q}`, token)
      .then((r) => {
        if (!vivo) return;
        setC(r);
        // Quem fechou fora só se assina com o PDF que a declaração cita.
        onPronto(r.confere && (r.origem === 'sala' || !!r.fora?.anexo));
      })
      .catch((e) => {
        if (!vivo) return;
        setErro((e as Error).message);
        onPronto(false);
      });
    return () => {
      vivo = false;
    };
  }, [leadId, hashAssinado, token, onPronto]);

  async function baixar() {
    if (!c?.fora?.anexo) return;
    setErroDoPdf(null);
    try {
      const blob = await apiBlob(`/comercial/lead/${encodeURIComponent(c.leadId)}/contrato-anexado?sha=${c.fora.anexo.sha256}`, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = c.fora.anexo.nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErroDoPdf((e as Error).message);
    }
  }

  if (erro) {
    return (
      <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad" data-testid="fechamento-sem-conteudo">
        O conteúdo do fechamento não carregou ({erro}). Sem ver o que vai ser escrito, não assine.
      </p>
    );
  }
  if (!c) return <p className="text-xs text-muted">Carregando o conteúdo do fechamento…</p>;

  const f = c.fora;
  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-xs" data-testid="cartao-do-fechamento" aria-label="O que o fechamento vai escrever">
      {!c.confere && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-bad" data-testid="fechamento-divergente">
          O conteúdo mudou depois do pedido: o hash de agora não é o que esta aprovação prende. O fechamento não sai com esta assinatura.
        </p>
      )}
      <p className="text-sm font-medium">
        {c.dados.razaoSocial || c.nome}
        <span className="text-muted">
          {' '}
          · {f ? `fechado fora do sistema, registrado à mão${f.por ? ` por ${f.por}` : ''}` : `aceite na sala, versão ${c.versao}`}
        </span>
      </p>
      <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="text-muted">CNPJ ou CPF</dt>
        <dd>{c.dados.cnpj || '[a decidir]'}</dd>
        <dt className="text-muted">quem assina</dt>
        <dd>
          {c.dados.quemAssina || '[a decidir]'}
          {c.dados.email ? ` · ${c.dados.email}` : ''}
        </dd>
        <dt className="text-muted">endereço</dt>
        <dd>{c.dados.endereco || '[a decidir]'}</dd>
        <dt className="text-muted">produto</dt>
        <dd>{c.rotuloDoProduto}</dd>
        <dt className="text-muted">valor</dt>
        <dd data-testid="fechamento-valor">
          {formatarReais(c.valorCentavos)} em {c.parcelas}× por {FORMA[c.forma] ?? c.forma}
        </dd>
        {f && (
          <>
            <dt className="text-muted">assinado em</dt>
            <dd>{dia(f.assinadoEm)}</dd>
            <dt className="text-muted">1º vencimento</dt>
            <dd>{dia(f.primeiroVencimento)}</dd>
            <dt className="text-muted">cobrança</dt>
            <dd data-testid="fechamento-cobranca">
              {f.criarCobranca ? `cobrança nova no Asaas, 1ª parcela em ${dia(f.primeiroVencimento)}` : `nenhuma cobrança nova: ${f.motivoSemCobranca ?? '[a decidir]'}`}
            </dd>
            <dt className="text-muted">contrato assinado</dt>
            <dd>
              {f.anexo ? (
                <button type="button" className="underline decoration-dotted hover:text-brand" onClick={() => void baixar()} data-testid="fechamento-pdf">
                  baixar o PDF ({f.anexo.nome})
                </button>
              ) : (
                <span className="text-bad">o PDF que a declaração cita não está anexado</span>
              )}
              {erroDoPdf && <span className="block text-bad">o PDF não baixou ({erroDoPdf})</span>}
            </dd>
          </>
        )}
      </dl>
      <p className="font-mono text-[10px] text-muted">
        chave {c.chave} · hash de agora {c.hashDeAgora.slice(0, 12)}… · {c.confere ? 'confere com o da aprovação' : 'NÃO confere com o da aprovação'}
      </p>
    </section>
  );
}
