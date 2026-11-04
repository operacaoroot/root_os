'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MaquinaPainel, MemoriaPainel, TriagemPainel } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Numero, Quadro } from '@/components/painel';
import { dataCurta, hojeSP } from '@/components/maquina/pecas';

/*
 * Marketing › INÍCIO (etapa 9, decisão do Lucas em 04/11/2026): o mesmo painel das outras áreas
 * (Quadro e Numero, como o Comercial). Os números são os de antes, da Triagem, da Máquina (Banco e
 * esteira) e da Memória; cada um abre a tela de onde vem. Nada novo é calculado no servidor.
 */

export default function MarketingInicioPage() {
  const { token, ready, can } = useAuth();
  const router = useRouter();
  const [triagem, setTriagem] = useState<TriagemPainel | null>(null);
  const [maquina, setMaquina] = useState<MaquinaPainel | null>(null);
  const [memoria, setMemoria] = useState<MemoriaPainel | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    void apiGet<TriagemPainel>('/marketing/estudio/triagem', token).then(setTriagem).catch(() => undefined);
    void apiGet<MaquinaPainel>('/marketing/maquina', token).then(setMaquina).catch(() => undefined);
    void apiGet<MemoriaPainel>('/marketing/estudio/memoria', token).then(setMemoria).catch(() => undefined);
  }, [ready, token]);

  if (ready && !can('pauta.ver')) return <p className="text-sm text-muted">Acesso insuficiente para Marketing.</p>;

  const hoje = hojeSP();
  const mes = hoje.slice(0, 7);
  const posts = maquina?.posts ?? [];
  const conta = (etapas: string[]) => posts.filter((p) => etapas.includes(p.etapa)).length;
  const publicadosNoMes = posts.filter((p) => p.etapa === 'publicado' && p.data?.startsWith(mes)).length;
  const agendadosNoMes = posts.filter((p) => p.etapa === 'agendado' && p.data?.startsWith(mes)).length;
  const meta = maquina?.metaDoMes ?? 0;
  const proximos = posts
    .filter((p) => p.etapa === 'agendado' && p.data && p.data >= hoje)
    .sort((a, b) => `${a.data}${a.hora}`.localeCompare(`${b.data}${b.hora}`))
    .slice(0, 6);
  const notasHoje = (memoria?.notas ?? []).filter((n) => n.criadaEm.slice(0, 10) === hoje).length;
  const n = (v: number | null | undefined, carregado: unknown) => (carregado ? String(v ?? 0) : '…');

  return (
    <div className="space-y-4">
      <Quadro titulo="Marketing" nota="o que está esperando você e como vai o mês · clique num número para abrir">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Numero rotulo="Ideias para aprovar" valor={n(triagem?.contagem.nova, triagem)} nota={triagem ? `${triagem.contagem.aprovada} aprovadas até hoje` : undefined} onClick={() => router.push('/marketing/triagem')} />
          <Numero rotulo="No Banco de ideias" valor={n(conta(['ideia']), maquina)} nota="antes de virar post" onClick={() => router.push('/marketing/banco')} />
          <Numero rotulo="Em produção" valor={n(conta(['producao', 'a_agendar']), maquina)} nota="gravar, fazer a arte, agendar" onClick={() => router.push('/marketing/producao')} />
          <Numero rotulo="Notas na Memória hoje" valor={n(notasHoje, memoria)} nota="o que a equipe registrou" onClick={() => router.push('/marketing/memoria')} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-3">
          <Numero tamanho="medio" rotulo="Publicados no mês" valor={n(publicadosNoMes, maquina)} nota={meta ? `de ${meta} da cadência` : 'sem cadência definida'} onClick={() => router.push('/marketing/calendario')} />
          <Numero tamanho="medio" rotulo="Agendados no mês" valor={n(agendadosNoMes, maquina)} nota="ainda vão ao ar" onClick={() => router.push('/marketing/calendario')} />
          <Numero tamanho="medio" rotulo="Faltam para a meta" valor={maquina ? String(Math.max(0, meta - publicadosNoMes - agendadosNoMes)) : '…'} nota="contando os agendados" onClick={() => router.push('/marketing/agendar')} />
        </div>
      </Quadro>
      <Quadro titulo="Próximos posts" nota="agendados, por dia e horário" acao={<Link href="/marketing/calendario" className="text-sm text-muted underline hover:text-brand">Calendário</Link>}>
        {!maquina ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : proximos.length === 0 ? (
          <p className="text-sm text-muted">Nada agendado daqui para frente.</p>
        ) : (
          <ul className="divide-y divide-border">
            {proximos.map((p) => (
              <li key={p.id} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 font-os-mono text-xs text-muted">{dataCurta(p.data)}{p.hora ? ` ${p.hora}` : ''}</span>
                <span className="min-w-0 flex-1 truncate">{p.titulo}</span>
                <span className="text-xs text-muted">{p.formato}</span>
              </li>
            ))}
          </ul>
        )}
      </Quadro>
    </div>
  );
}
