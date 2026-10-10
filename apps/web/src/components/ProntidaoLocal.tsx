'use client';

import { useEffect, useRef, useState } from 'react';
import { ProntidaoAgentesSchema, ProntidaoContextoSchema, type ProntidaoAgentes, type ProntidaoContexto } from '@mktos/shared';
import { apiGet, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Tipo = 'contexto' | 'agentes';
type Dados = { tipo: 'contexto'; valor: ProntidaoContexto } | { tipo: 'agentes'; valor: ProntidaoAgentes };
const titulos = { contexto: 'Memória e fonte declarada', agentes: 'Modelo local e acesso às fontes' };
const botao = 'min-h-11 rounded border border-border px-3 py-2 text-xs text-muted disabled:opacity-50';

export function ProntidaoLocal({ tipo }: { tipo: Tipo }) {
  const { ready, token, user, can } = useAuth();
  const permissao = tipo === 'contexto' ? 'obsidian.ver' : 'mcp.ver';
  if (!ready) return <p className="text-sm text-muted">Carregando estado declarado…</p>;
  if (!token || !user || !can(permissao)) return <section aria-label={titulos[tipo]} className="rounded border border-border bg-surface p-4"><h2 className="text-sm font-semibold">{titulos[tipo]}</h2><p className="mt-2 text-sm text-muted">Sem acesso para consultar este estado. A fonte e a disponibilidade não foram conferidas.</p></section>;
  return <Consulta key={tipo + ':' + user.id + ':' + token} tipo={tipo} token={token} pessoaId={user.id} />;
}
function Consulta({ tipo, token, pessoaId }: { tipo: Tipo; token: string; pessoaId: string }) {
  const [dados, setDados] = useState<Dados | null>(null), [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(true);
  const geracao = useRef(0), viva = useRef(true), escopo = useRef<{ orgId: string; userId: string } | null>(null);
  async function carregar() {
    if (!viva.current) return;
    const g = ++geracao.current; setOcupado(true); setDados(null); setErro(null);
    try {
      const raw = await apiGet<unknown>(tipo === 'contexto' ? '/knowledge/prontidao' : '/agents/prontidao', token);
      if (!viva.current || g !== geracao.current) return;
      let r: Dados;
      if (tipo === 'contexto') {
        const parsed = ProntidaoContextoSchema.safeParse(raw);
        if (!parsed.success) throw new Error('O estado de Contexto retornado não pôde ser validado.');
        r = { tipo, valor: parsed.data };
      } else {
        const parsed = ProntidaoAgentesSchema.safeParse(raw);
        if (!parsed.success) throw new Error('O estado de Agentes retornado não pôde ser validado.');
        r = { tipo, valor: parsed.data };
      }
      // O primeiro escopo vem do GET autorizado; nenhum tenant é deduzido do navegador.
      const s = r.valor.escopo;
      if (s.userId !== pessoaId || (escopo.current && (s.orgId !== escopo.current.orgId || s.userId !== escopo.current.userId))) {
        throw new Error('A empresa ou pessoa da consulta mudou. Confira a sessão antes de usar este estado.');
      }
      escopo.current = s; setDados(r);
    } catch (e) {
      if (!viva.current || g !== geracao.current) return;
      setDados(null);
      setErro(e instanceof ErroDaApi && [401, 403].includes(e.status) ? 'Sem acesso atual para consultar este estado. Os dados anteriores foram ocultados.'
        : e instanceof ErroDaApi && e.status === 404 ? 'Estado indisponível nesta consulta. Isso não confirma ausência de memória, fonte ou modelo.'
        : e instanceof Error ? e.message : 'Não foi possível conferir o estado declarado.');
    } finally { if (viva.current && g === geracao.current) setOcupado(false); }
  }
  useEffect(() => { viva.current = true; void carregar(); return () => { viva.current = false; ++geracao.current; }; }, [tipo, token, pessoaId]);
  return <section aria-label={titulos[tipo]} className="space-y-3 rounded border border-border bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{titulos[tipo]}</h2><button type="button" className={botao} onClick={() => void carregar()} disabled={ocupado}>Conferir estado declarado</button></div>
    {ocupado && <p role="status" className="text-sm text-muted">Consultando o registro autorizado…</p>}
    {erro && <p role="alert" className="text-sm text-muted">{erro}</p>}
    {dados?.tipo === 'contexto' && <div className="grid gap-3 text-sm sm:grid-cols-2">
      <div><h3 className="font-medium">Memória acessível</h3><p className="mt-1 text-muted">{dados.valor.memoria.estado === 'vazia_confirmada' ? '0 itens de memória legíveis para sua pessoa, conferidos nesta consulta.' : `${dados.valor.memoria.quantidade} ${dados.valor.memoria.quantidade === 1 ? 'item de memória legível' : 'itens de memória legíveis'} para sua pessoa.`}</p><p className="mt-1 text-xs text-muted">A contagem não inclui itens sem acesso e não é a contagem de agentes, rotinas ou pessoas no mapa.</p></div>
      <div><h3 className="font-medium">Fonte de importação</h3><p className="mt-1 text-muted">{dados.valor.fonte.estado === 'nao_se_aplica' ? 'Importação por pasta ou Drive não se aplica a esta empresa.' : dados.valor.fonte.estado === 'nao_configurada' ? `${dados.valor.fonte.tipo === 'pasta' ? 'Pasta' : 'Drive'} sem configuração declarada.` : `${dados.valor.fonte.tipo === 'pasta' ? 'Pasta declarada' : 'Drive declarado'}; acesso e conteúdo não verificados nesta consulta.`}</p><p className="mt-1 text-xs text-muted">Esta leitura não importa conteúdo nem acessa a fonte externa.</p></div>
    </div>}
    {dados?.tipo === 'agentes' && <div className="grid gap-3 text-sm sm:grid-cols-2">
      <div><h3 className="font-medium">Modelo local</h3><p className="mt-1 text-muted">{dados.valor.modelo.estado === 'nao_configurado' ? 'Modelo local sem configuração declarada.' : dados.valor.modelo.estado === 'configuracao_invalida' ? 'Configuração do modelo local inválida.' : 'Modelo local declarado; disponibilidade não verificada.'}</p><p className="mt-1 text-xs text-muted">Provedor local: llama.cpp. Modelo e disponibilidade não foram medidos; a consulta não inicia execução.</p></div>
      <div><h3 className="font-medium">Fontes de contexto</h3><p className="mt-1 text-muted">{dados.valor.fontes.consultaPermitida ? 'Sua pessoa pode consultar fontes de contexto.' : 'Sua pessoa não tem acesso atual para consultar fontes de contexto.'}</p><p className="mt-1 text-xs text-muted">A quantidade de fontes não é medida por esta consulta. O procedimento de cada agente mantém sua própria autorização.</p></div>
    </div>}
  </section>;
}
