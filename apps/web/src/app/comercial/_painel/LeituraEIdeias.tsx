'use client';

/*
 * LEITURA E IDEIAS (rodada da implantação I4). O que o cliente leu na página da
 * proposta e o que anotou nela, lido de `GET /comercial/lead/:id/reacoes`. Só a
 * versão vigente: proposta nova zera a conversa, e a leitura da antiga ficaria
 * falando de condições que já não valem.
 *
 * A releitura é leve e própria (a cada 20 s, só com a aba do navegador visível):
 * a ideia que o cliente acabou de mandar aparece aqui sem ninguém recarregar. O
 * fio da aba ao lado já se relê a cada 30 s pela ficha do painel.
 *
 * O texto é do cliente: chega mascarado da API e é renderizado como texto.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PROPOSTA_ROTULO_DA_SECAO, PROPOSTA_SECOES, type ReacoesDaPropostaDoLead } from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { diaSemanaSP, horaSP, quandoCurtoSP } from '@/lib/cockpit';

import { CARTAO, Rotulo } from '../_ui';

export const RELEITURA_DAS_REACOES_MS = 20_000;

function duracao(segundos: number): string {
  if (segundos < 60) return `${segundos} s`;
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function LeituraEIdeias({ leadId }: { leadId: string }) {
  const { token } = useAuth();
  const [dados, setDados] = useState<ReacoesDaPropostaDoLead | null>(null);
  const [erro, setErro] = useState(false);
  const vivo = useRef(true);

  const ler = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiGet<ReacoesDaPropostaDoLead>(`/comercial/lead/${encodeURIComponent(leadId)}/reacoes`, token);
      if (vivo.current) {
        setDados(r);
        setErro(false);
      }
    } catch {
      if (vivo.current) setErro(true);
    }
  }, [leadId, token]);

  useEffect(() => {
    vivo.current = true;
    void ler();
    const t = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void ler();
    }, RELEITURA_DAS_REACOES_MS);
    return () => {
      vivo.current = false;
      clearInterval(t);
    };
  }, [ler]);

  if (erro && !dados) {
    return (
      <section className={CARTAO} aria-label="leitura e ideias">
        <Rotulo>leitura e ideias</Rotulo>
        <p className="mt-2 text-[12.5px] text-muted">Não deu para ler as reações agora. Tentamos de novo em instantes.</p>
      </section>
    );
  }
  if (!dados || dados.versaoVigente == null) return null;

  const v = dados.versaoVigente;
  const leitura = dados.leitura.filter((l) => l.versao === v);
  const anotacoes = dados.anotacoes.filter((a) => a.versao === v).slice().reverse();
  const fazSentido = new Set(dados.fazSentido.filter((f) => f.versao === v).map((f) => f.secao));

  return (
    <section className={CARTAO} aria-label="leitura e ideias" data-testid="leitura-e-ideias">
      <Rotulo>leitura e ideias · proposta v{v}</Rotulo>
      <p className="mt-1 font-os-mono text-[11.5px] tabular-nums text-muted">
        {dados.acessosDaSala} {dados.acessosDaSala === 1 ? 'acesso' : 'acessos'} à sala
        {dados.ultimoAcessoEm ? ` · último ${quandoCurtoSP(dados.ultimoAcessoEm)}` : ''}
      </p>
      <ul className="mt-2 grid gap-1 text-[12.5px] sm:grid-cols-3">
        {PROPOSTA_SECOES.map((s, i) => {
          const l = leitura.find((x) => x.secao === s);
          return (
            <li key={s} className="rounded border border-border px-2 py-1.5">
              <span className="font-os-mono text-[10.5px] text-dim">{`${String(i + 1).padStart(2, '0')} · ${PROPOSTA_ROTULO_DA_SECAO[s].toLowerCase()}`}</span>
              <span className="block tabular-nums">
                {l ? `${l.acessos} ${l.acessos === 1 ? 'visita' : 'visitas'} · ${duracao(l.segundos)}` : 'não lida'}
                {fazSentido.has(s) ? ' · faz sentido' : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {anotacoes.length === 0 ? (
        <p className="mt-2 text-[12px] text-dim">Nenhuma ideia ou dúvida deixada nesta versão.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {anotacoes.map((a) => (
            <li key={a.id} className="py-1.5 text-[12.5px]" data-anotacao={a.tipo}>
              <p className="font-os-mono text-[10.5px] text-muted">
                {a.tipo === 'ideia' ? 'ideia' : 'dúvida'} · {PROPOSTA_ROTULO_DA_SECAO[a.secao].toLowerCase()} · {diaSemanaSP(a.em)} {horaSP(a.em)}
              </p>
              <p className="whitespace-pre-wrap break-words">{a.texto}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
