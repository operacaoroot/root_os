'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Chip } from '../../../referencias/ui';
import { dataBR, type RoteiroDoKickoff } from '../../tipos';

/*
 * O ROTEIRO DO KICKOFF, para imprimir ou levar no celular. É a espinha escrita
 * como conversa: consentimento antes de gravar, como conduzir, o que a triagem
 * já disse, os temas na ordem com a pergunta "se ficar raso", e a cobertura.
 */
export default function RoteiroPage() {
  const { id } = useParams<{ id: string }>();
  const { token, ready, can } = useAuth();
  const [r, setR] = useState<RoteiroDoKickoff | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = () => {
    if (!token) return;
    apiGet<RoteiroDoKickoff>(`/tenants/onboarding/trilhos/${id}/roteiro`, token).then(setR).catch((e: Error) => setErro(e.message));
  };
  useEffect(() => {
    if (ready) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, id]);

  async function personalizar() {
    if (!token) return;
    setOcupado(true);
    setErro(null);
    try {
      await apiPost(`/tenants/onboarding/trilhos/${id}/roteiro/personalizar`, {}, token);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!ready) return null;
  if (!r) return <p className="text-sm text-muted">{erro ?? 'carregando…'}</p>;

  return (
    <div className="mx-auto max-w-[860px] space-y-6 print:max-w-none">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/onboarding/${id}`} className="text-sm text-muted underline underline-offset-2">← voltar ao trilho</Link>
        <div className="flex gap-2">
          {can('tarefas.editar') && (
            <Botao onClick={personalizar} disabled={ocupado} title="O roteirista reescreve as perguntas com o vocabulário do cliente">
              {ocupado ? 'personalizando…' : 'Personalizar com o roteirista'}
            </Botao>
          )}
          <Botao onClick={() => navigator.clipboard.writeText(r.markdown)}>Copiar markdown</Botao>
          <Botao tone="brand" onClick={() => window.print()}>Imprimir</Botao>
        </div>
      </div>
      {erro && <p className="text-sm text-bad">{erro}</p>}

      <header>
        <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Peça 1 · roteiro do kickoff</p>
        <h1 className="text-2xl font-semibold">{r.titulo}</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          {[r.cabecalho.perfil && `Perfil ${r.cabecalho.perfil}`, r.cabecalho.nivelRotulo ? `Nível: ${r.cabecalho.nivelRotulo}` : 'Nível: a decidir', r.cabecalho.receitaNome && `Receita: ${r.cabecalho.receitaNome}`, `Conduz: ${r.cabecalho.conduzidoPor ?? '?'}${r.cabecalho.implantadoPor ? ` + ${r.cabecalho.implantadoPor} (implanta)` : ''}`, r.cabecalho.kickoffEm && `Data: ${dataBR(r.cabecalho.kickoffEm)}`].filter(Boolean).join(' · ')}
        </p>
      </header>

      <section className="rounded-xl border border-brand/40 bg-brand/10 p-4">
        <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">Antes de apertar gravar — diga assim</p>
        <p className="mt-1 text-[15px] leading-relaxed">“{r.consentimento}”</p>
      </section>

      <section>
        <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Como conduzir</h2>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13px]">
          {r.comoConduzir.map((c, i) => <li key={i}>{c}</li>)}
        </ol>
      </section>

      {r.triagem.length > 0 && (
        <section>
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">O que a triagem já disse (não pergunte de novo)</h2>
          <ul className="mt-1 space-y-1 text-[13px]">
            {r.triagem.map((t) => <li key={t.titulo}><span className="font-medium">{t.titulo}:</span> {t.resposta}</li>)}
          </ul>
        </section>
      )}

      {r.blocos.map((b) => (
        <section key={b.bloco} className="space-y-3">
          <h2 className="text-lg font-semibold">Bloco {b.bloco} · {b.titulo}</h2>
          {b.temas.map((t) => (
            <div key={t.id} className="rounded-xl border border-border bg-surface p-4 print:break-inside-avoid">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-os-mono text-[11px] text-muted">{t.n}</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t.titulo}</span>
                <Chip tone={t.obrigatorio ? 'brand' : 'muted'}>{t.tag}</Chip>
                {t.coberto && <Chip tone="good">coberto</Chip>}
              </div>
              <p className="mt-2 text-[16px] font-medium leading-snug">{t.pergunta}</p>
              <p className="mt-1 text-[13px] text-muted"><span className="font-semibold text-warn">Se ficar raso →</span> {t.aprofundar}</p>
            </div>
          ))}
        </section>
      ))}

      <section className="rounded-xl border border-border bg-surface-2 p-4">
        <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Ao sair da reunião</p>
        <p className="mt-1 text-[14px]">
          {r.cobertura.cobertos} de {r.cobertura.total} temas cobertos.{' '}
          {r.cobertura.emBranco.length ? `Chegam em branco para o cliente: ${r.cobertura.emBranco.join(', ')}.` : 'Nada chega em branco: o cliente só confirma.'}
        </p>
        <p className="mt-1 text-[12px] text-muted">A ata vai para o leitor de ata; as propostas aparecem na bancada para aprovação.</p>
      </section>
    </div>
  );
}
