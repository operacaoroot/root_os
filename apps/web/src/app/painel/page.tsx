'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PainelComercial, PainelDeTarefas } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useModulos } from '@/components/modulos';
import { Numero, Quadro, brl } from '@/components/painel';
import { PilulaCustoIa } from './custo-ia/Pilula';

/*
 * PAINEL GERAL DA EMPRESA (versão final, 19/10/2026).
 *
 * O resumo das tarefas que morava aqui (gráficos por prazo, por pessoa e por
 * área) virou a Visão geral do Dia a dia, organizado por pasta e lista: aqui
 * ele seria duplicata e saiu. O que fica é a empresa numa linha por motor,
 * cada uma levando ao painel dono do número: tarefas (Visão geral), comercial
 * (Painel geral do Comercial) e o custo de IA do dia. Cada bloco só aparece
 * para quem tem a permissão e o módulo dele; número que não carregou fica
 * ausente, sem zero inventado.
 */
export default function PainelGeralDaEmpresa() {
  const { token, ready, user, can } = useAuth();
  const { ligado } = useModulos();
  const verTarefas = can('tarefas.ver') && ligado('trabalho');
  const verComercial = can('leads.ver') && ligado('leads');
  const [tarefas, setTarefas] = useState<PainelDeTarefas | null>(null);
  const [comercial, setComercial] = useState<PainelComercial | null>(null);
  const [erro, setErro] = useState<{ tarefas?: string; comercial?: string }>({});

  useEffect(() => {
    if (!ready || !token) return;
    if (verTarefas) apiGet<PainelDeTarefas>('/trabalho/todas', token).then(setTarefas).catch((e) => setErro((x) => ({ ...x, tarefas: e.message })));
    if (verComercial) apiGet<PainelComercial>('/comercial/painel', token).then(setComercial).catch((e) => setErro((x) => ({ ...x, comercial: e.message })));
  }, [ready, token, verTarefas, verComercial]);

  const abertas = tarefas?.tarefas.filter((t) => t.situacao !== 'feita') ?? [];
  const seteDiasAtras = new Date(Date.now() - 7 * 86400e3).toISOString();

  return (
    <div className="com-tema mx-auto max-w-[1240px] space-y-5 text-text">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-muted">
          Sessão de <span className="text-text">{user?.name}</span> · a empresa numa tela. Cada bloco abre o painel dono do número.
        </p>
        <PilulaCustoIa />
      </div>

      {verTarefas && (
        <Quadro titulo="Tarefas" nota="todas as pastas do Trabalho" acao={<Link href="/dia-a-dia" className="text-sm text-muted underline hover:text-brand">Visão geral</Link>}>
          {erro.tarefas ? (
            <p className="text-sm text-bad">{erro.tarefas}</p>
          ) : !tarefas ? (
            <p className="text-sm text-muted">Carregando…</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Numero rotulo="Abertas" valor={String(abertas.length)} tamanho="medio" />
              <Numero rotulo="Atrasadas" valor={String(abertas.filter((t) => t.situacao === 'atrasada').length)} tamanho="medio" />
              <Numero rotulo="Feitas na semana" valor={String(tarefas.tarefas.filter((t) => t.situacao === 'feita' && t.updatedAt >= seteDiasAtras).length)} tamanho="medio" />
            </div>
          )}
        </Quadro>
      )}

      {verComercial && (
        <Quadro titulo="Comercial" nota={comercial ? `o ano de ${comercial.ano}` : 'o ano'} acao={<Link href="/comercial" className="text-sm text-muted underline hover:text-brand">Painel geral do Comercial</Link>}>
          {erro.comercial ? (
            <p className="text-sm text-bad">{erro.comercial}</p>
          ) : !comercial ? (
            <p className="text-sm text-muted">Carregando…</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Numero rotulo="Em negociação" valor={brl(comercial.totais.emNegociacao)} nota={`${comercial.totais.abertos} aberto(s)`} tamanho="medio" />
              <Numero rotulo={`Fechado em ${comercial.ano}`} valor={brl(comercial.totais.valorGanhoNoAno)} nota={`${comercial.totais.ganhosNoAno} contrato(s)`} tamanho="medio" />
              <Numero rotulo="Contratos vivos" valor={String(comercial.totais.contratosVivos)} tamanho="medio" />
              <Numero rotulo="Conversão no ano" valor={comercial.totais.conversao == null ? '—' : `${comercial.totais.conversao}%`} tamanho="medio" />
            </div>
          )}
        </Quadro>
      )}

      {!verTarefas && !verComercial && <p className="text-muted">Sem acesso às tarefas nem ao comercial.</p>}
    </div>
  );
}
