'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { MAQUINA_ESTEIRA, ROTULO_DA_ETAPA, type MaquinaEtapa, type MaquinaPainel, type MaquinaPost, type MemoriaPainel, type TriagemPainel } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BarraDividida, Colunas, Numero, Quadro, type Coluna } from '@/components/painel';
import { dataCurta, hojeSP } from '@/components/maquina/pecas';

/*
 * Marketing › INÍCIO (etapa 9b, pedido do Lucas em 04/11/2026: "não está nada parecido com o restante
 * do OS"). O mesmo desenho do Painel geral do Comercial: abas no topo, o cartão de destaque (o mês
 * contra a cadência), gráficos de colunas que abrem a tela de onde vêm, tabelas por pilar e formato e
 * a lista dos próximos posts. Os números são os de sempre: Triagem, Máquina (Banco e esteira) e Memória.
 */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const NOME_DO_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ROTA_DA_ETAPA: Record<MaquinaEtapa, string> = {
  ideia: '/marketing/banco',
  producao: '/marketing/producao',
  a_agendar: '/marketing/agendar',
  agendado: '/marketing/calendario',
  publicado: '/marketing/calendario',
  arquivado: '/marketing/producao',
};

function ultimosMeses(n: number, mes: string): string[] {
  const [a, m] = mes.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

interface LinhaDeGrupo { nome: string; ideias: number; producao: number; agendados: number; publicados: number }

function porGrupo(posts: MaquinaPost[], chave: (p: MaquinaPost) => string): LinhaDeGrupo[] {
  const m = new Map<string, LinhaDeGrupo>();
  for (const p of posts) {
    if (p.etapa === 'arquivado') continue;
    const nome = chave(p) || 'Sem informação';
    const l = m.get(nome) ?? { nome, ideias: 0, producao: 0, agendados: 0, publicados: 0 };
    if (p.etapa === 'ideia') l.ideias++;
    else if (p.etapa === 'producao' || p.etapa === 'a_agendar') l.producao++;
    else if (p.etapa === 'agendado') l.agendados++;
    else if (p.etapa === 'publicado') l.publicados++;
    m.set(nome, l);
  }
  return [...m.values()].sort((a, b) => b.publicados + b.agendados - (a.publicados + a.agendados) || b.ideias - a.ideias);
}

function Tabela({ linhas, onLinha }: { linhas: LinhaDeGrupo[]; onLinha: () => void }) {
  if (!linhas.length) return <p className="text-sm text-muted">Nenhum post ainda.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="com-rotulo text-left">
          <th className="py-1.5 font-normal">nome</th>
          <th className="py-1.5 text-right font-normal">ideias</th>
          <th className="py-1.5 text-right font-normal">produção</th>
          <th className="py-1.5 text-right font-normal">agendados</th>
          <th className="py-1.5 text-right font-normal">postados</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.nome} onClick={onLinha} className="cursor-pointer border-t border-border hover:bg-surface-2">
            <td className="py-2">{l.nome}</td>
            <td className="com-num py-2 text-right">{l.ideias}</td>
            <td className="com-num py-2 text-right">{l.producao}</td>
            <td className="com-num py-2 text-right">{l.agendados}</td>
            <td className="com-num py-2 text-right">{l.publicados}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MarketingInicioPage() {
  const { token, ready, can } = useAuth();
  const router = useRouter();
  const [triagem, setTriagem] = useState<TriagemPainel | null>(null);
  const [maquina, setMaquina] = useState<MaquinaPainel | null>(null);
  const [memoria, setMemoria] = useState<MemoriaPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    void apiGet<TriagemPainel>('/marketing/estudio/triagem', token).then(setTriagem).catch(() => undefined);
    void apiGet<MaquinaPainel>('/marketing/maquina', token).then(setMaquina).catch((e) => setErro((e as Error).message));
    void apiGet<MemoriaPainel>('/marketing/estudio/memoria', token).then(setMemoria).catch(() => undefined);
  }, [ready, token]);

  const hoje = hojeSP();
  const mes = hoje.slice(0, 7);
  const posts = useMemo(() => maquina?.posts ?? [], [maquina]);
  const pilares = useMemo(() => new Map((maquina?.pilares ?? []).map((p) => [p.chave, p.nome])), [maquina]);

  if (ready && !can('pauta.ver')) return <p className="text-sm text-muted">Acesso insuficiente para Marketing.</p>;

  const naEtapa = (e: MaquinaEtapa) => posts.filter((p) => p.etapa === e).length;
  const publicadosNoMes = posts.filter((p) => p.etapa === 'publicado' && p.data?.startsWith(mes)).length;
  const agendadosNoMes = posts.filter((p) => p.etapa === 'agendado' && p.data?.startsWith(mes)).length;
  const meta = maquina?.metaDoMes ?? 0;
  const falta = Math.max(0, meta - publicadosNoMes - agendadosNoMes);
  const paraAprovar = triagem?.contagem.nova ?? 0;
  const notasHoje = (memoria?.notas ?? []).filter((n) => n.criadaEm.slice(0, 10) === hoje).length;
  const proximos = posts
    .filter((p) => p.etapa === 'agendado' && p.data && p.data >= hoje)
    .sort((a, b) => `${a.data}${a.hora}`.localeCompare(`${b.data}${b.hora}`))
    .slice(0, 8);

  const esteira: Coluna[] = MAQUINA_ESTEIRA.map((e) => {
    const v = naEtapa(e);
    return { chave: e, rotulo: ROTULO_DA_ETAPA[e], v, mostra: String(v), tom: e === 'publicado' ? 'forte' : e === 'agendado' ? 'medio' : 'fraco', dica: [ROTULO_DA_ETAPA[e], `${v} post(s)`], onClick: () => router.push(ROTA_DA_ETAPA[e]) };
  });
  const porMes: Coluna[] = ultimosMeses(12, mes).map((m) => {
    const v = posts.filter((p) => p.etapa === 'publicado' && p.data?.startsWith(m)).length;
    return { chave: m, rotulo: MESES[Number(m.slice(5)) - 1], v, mostra: String(v), tom: m === mes ? 'forte' : 'medio', dica: [`${NOME_DO_MES[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`, `${v} post(s) no ar`], onClick: () => router.push('/marketing/calendario') };
  });
  const triagemCol: Coluna[] = triagem
    ? ([['nova', 'Para aprovar', '/marketing/triagem'], ['aprovada', 'Aprovadas', '/marketing/banco'], ['recusada', 'Recusadas', '/marketing/triagem'], ['reserva', 'Reserva', '/marketing/triagem']] as const).map(([k, rotulo, href]) => {
        const v = triagem.contagem[k] ?? 0;
        return { chave: k, rotulo, v, mostra: String(v), tom: k === 'nova' ? 'forte' : k === 'aprovada' ? 'medio' : 'fraco', dica: [rotulo, `${v} ideia(s)`], onClick: () => router.push(href) };
      })
    : [];

  return (
    <div className="com-tema mx-auto max-w-[1180px] space-y-6 text-text">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <div className="flex gap-1">
          <span className="-mb-px border-b-2 border-brand px-3 py-2.5 text-[0.95rem] font-medium text-text">Painel</span>
          <Link href="/marketing/producao" className="-mb-px border-b-2 border-transparent px-3 py-2.5 text-[0.95rem] text-muted hover:text-text">Produção</Link>
          <Link href="/marketing/calendario" className="-mb-px border-b-2 border-transparent px-3 py-2.5 text-[0.95rem] text-muted hover:text-text">Calendário</Link>
        </div>
        <div className="mb-2 flex items-center gap-3">
          <Link href="/marketing/triagem" className="text-sm text-muted underline hover:text-brand">aprovar ideias</Link>
          <Link href="/marketing/banco" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-black hover:brightness-110">+ ideia</Link>
        </div>
      </div>

      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {!maquina && !erro && <p className="text-muted">Carregando…</p>}

      {maquina && (
        <>
          <div className="grid gap-5 rounded-md border border-border bg-surface p-5 lg:grid-cols-[1fr_15rem]">
            <div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Numero rotulo={`Postados em ${NOME_DO_MES[Number(mes.slice(5)) - 1]}`} valor={String(publicadosNoMes)} nota={meta ? `de ${meta} da cadência do mês` : 'sem cadência definida'} onClick={() => router.push('/marketing/calendario')} />
                <Numero rotulo="Agendados no mês" valor={String(agendadosNoMes)} nota={falta ? `faltam ${falta} para a cadência` : 'cadência do mês coberta'} onClick={() => router.push('/marketing/calendario')} />
              </div>
              <div className="mt-4">
                <BarraDividida
                  rotuloDoTotal={`Cadência de ${NOME_DO_MES[Number(mes.slice(5)) - 1]}`}
                  total={`${publicadosNoMes + agendadosNoMes} de ${meta}`}
                  chamada="clique para abrir o calendário"
                  partes={[
                    { chave: 'pub', valor: publicadosNoMes, tom: 'forte', dica: ['Postados', `${publicadosNoMes}`], onClick: () => router.push('/marketing/calendario') },
                    { chave: 'ag', valor: agendadosNoMes, tom: 'medio', dica: ['Agendados', `${agendadosNoMes}`], onClick: () => router.push('/marketing/calendario') },
                    { chave: 'falta', valor: falta, tom: 'fraco', dica: ['Faltam', `${falta}`], onClick: () => router.push('/marketing/agendar') },
                  ]}
                />
              </div>
              <div className="mt-5 grid items-start gap-4 border-t border-border pt-4 sm:grid-cols-3">
                <Numero tamanho="medio" rotulo="Ideias para aprovar" valor={triagem ? String(paraAprovar) : '…'} nota={triagem ? `${triagem.contagem.aprovada} aprovadas até hoje` : undefined} onClick={() => router.push('/marketing/triagem')} />
                <Numero tamanho="medio" rotulo="Banco de ideias" valor={String(naEtapa('ideia'))} nota="antes de virar post" onClick={() => router.push('/marketing/banco')} />
                <Numero tamanho="medio" rotulo="Em produção" valor={String(naEtapa('producao') + naEtapa('a_agendar'))} nota="gravar, fazer a arte, agendar" onClick={() => router.push('/marketing/producao')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-border lg:grid-cols-1 lg:border-l lg:pl-5">
              <Numero rotulo="Cadência" valor={`${meta}`} nota="posts por mês, pelos dias da semana" tamanho="medio" onClick={() => router.push('/marketing/calendario')} />
              <Numero rotulo="Notas na Memória hoje" valor={memoria ? String(notasHoje) : '…'} nota="o que a equipe registrou" tamanho="medio" onClick={() => router.push('/marketing/memoria')} />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Quadro titulo="Esteira de produção" nota="posts em cada etapa · clique numa etapa" acao={<Link href="/marketing/producao" className="text-sm text-muted underline hover:text-brand">Produção</Link>}>
              <Colunas itens={esteira} chamada="clique para abrir" />
            </Quadro>
            <Quadro titulo="Ideias de conteúdo" nota="a triagem das ideias · clique numa coluna" acao={<Link href="/marketing/triagem" className="text-sm text-muted underline hover:text-brand">Ideias de conteúdo</Link>}>
              {triagem ? <Colunas itens={triagemCol} chamada="clique para abrir" /> : <p className="text-sm text-muted">Carregando…</p>}
            </Quadro>
          </div>

          <Quadro titulo={`Postados por mês · ${mes.slice(0, 4)}`} nota="posts no ar, pelo dia em que foram ao ar · clique num mês">
            <Colunas itens={porMes} chamada="clique para abrir o calendário" />
          </Quadro>

          <div className="grid gap-5 lg:grid-cols-2">
            <Quadro titulo="Por pilar" nota="o que cada pilar da marca tem em cada etapa">
              <Tabela linhas={porGrupo(posts, (p) => pilares.get(p.pilar) ?? p.pilar)} onLinha={() => router.push('/marketing/producao')} />
            </Quadro>
            <Quadro titulo="Por formato" nota="Reel, carrossel, comunidade e os outros">
              <Tabela linhas={porGrupo(posts, (p) => p.formato)} onLinha={() => router.push('/marketing/producao')} />
            </Quadro>
          </div>

          <Quadro titulo="Próximos posts" nota="agendados, por dia e horário" acao={<Link href="/marketing/calendario" className="text-sm text-muted underline hover:text-brand">Calendário</Link>}>
            {proximos.length === 0 ? (
              <p className="text-sm text-muted">Nada agendado daqui para frente.</p>
            ) : (
              <div className="divide-y divide-border">
                {proximos.map((p) => (
                  <Link key={p.id} href="/marketing/calendario" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 hover:bg-surface-2">
                    <span className="w-28 shrink-0 font-os-mono text-xs text-muted">{dataCurta(p.data)}{p.hora ? ` ${p.hora}` : ''}</span>
                    <span className="min-w-0 flex-1 truncate">{p.titulo}</span>
                    <span className="text-sm text-muted">{p.formato}</span>
                  </Link>
                ))}
              </div>
            )}
          </Quadro>
        </>
      )}
    </div>
  );
}
