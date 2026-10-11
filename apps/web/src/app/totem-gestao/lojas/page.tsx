'use client';

import { FormEvent, useState } from 'react';
import type { TotemGestaoLoja } from '@mktos/shared';
import { apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, Chip, inputCls } from '../../referencias/ui';
import { dataBR, useLojasDoPainel } from './apoio';

/*
 * AS LOJAS DA REDE. Loja não se apaga: desativar tira a loja dos seletores e
 * do totem, e preserva o histórico de eventos, lotes e cadastros que apontam
 * para ela. Quem só vê o painel enxerga a lista; criar e editar pedem
 * `totem.lojas`.
 */

const VAZIA = { codigo: '', nome: '', cidade: '', endereco: '' };

export default function PaginaDasLojas() {
  const { token, ready, can } = useAuth();
  const editavel = can('totem.lojas');
  const { lojas, erro: erroDaLista, recarregar } = useLojasDoPainel(token, 'todas');
  const [nova, setNova] = useState(VAZIA);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState(VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setEnviando(true);
    try {
      await acao();
      recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function criar(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    void executar(async () => {
      await apiPost('/totem-gestao/lojas', nova, token);
      setNova(VAZIA);
    });
  }

  function abrirEdicao(l: TotemGestaoLoja) {
    setEditando(l.id);
    setRascunho({ codigo: l.codigo, nome: l.nome, cidade: l.cidade ?? '', endereco: l.endereco ?? '' });
  }

  function salvar(e: FormEvent) {
    e.preventDefault();
    if (!token || !editando) return;
    void executar(async () => {
      await apiPatch(`/totem-gestao/lojas/${editando}`, rascunho, token);
      setEditando(null);
    });
  }

  function alternarAtiva(l: TotemGestaoLoja) {
    if (!token) return;
    const pergunta = l.ativa
      ? `Desativar a loja "${l.nome}"? Ela sai dos seletores do painel e não recebe totem novo. O histórico de totens, lotes e cadastros continua guardado.`
      : `Reativar a loja "${l.nome}"?`;
    if (!window.confirm(pergunta)) return;
    void executar(async () => {
      await apiPatch(`/totem-gestao/lojas/${l.id}`, { ativa: !l.ativa }, token);
    });
  }

  if (!ready) return null;
  if (!can('totem.ver')) return <p className="text-sm text-muted">Você não tem acesso ao painel do totem.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Lojas</h1>
        <p className="text-sm text-muted">
          {editavel
            ? 'As lojas da rede. Cada totem e cada lote pertencem a uma loja.'
            : 'As lojas que você pode acompanhar. Para criar ou editar uma loja, peça a permissão de lojas.'}
        </p>
      </div>

      {(erro || erroDaLista) && <p className="text-sm text-bad">{erro ?? erroDaLista}</p>}

      {editavel && (
        <Card titulo="Nova loja">
          <form onSubmit={criar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_1fr_1fr_auto]">
            <input
              className={inputCls}
              required
              maxLength={20}
              placeholder="Código, ex.: L01"
              value={nova.codigo}
              onChange={(e) => setNova({ ...nova, codigo: e.target.value })}
            />
            <input
              className={inputCls}
              required
              minLength={2}
              placeholder="Nome da loja"
              value={nova.nome}
              onChange={(e) => setNova({ ...nova, nome: e.target.value })}
            />
            <input className={inputCls} placeholder="Cidade" value={nova.cidade} onChange={(e) => setNova({ ...nova, cidade: e.target.value })} />
            <input className={inputCls} placeholder="Endereço" value={nova.endereco} onChange={(e) => setNova({ ...nova, endereco: e.target.value })} />
            <Botao type="submit" tone="brand" disabled={enviando}>
              Criar
            </Botao>
          </form>
          <p className="mt-2 text-[11px] text-muted">O código usa letras, números, hífen e sublinhado, e vira maiúsculo ao salvar.</p>
        </Card>
      )}

      <Card titulo={`Lojas · ${lojas?.length ?? 0}`}>
        {!lojas ? (
          <p className="text-[12px] text-muted">Carregando as lojas…</p>
        ) : lojas.length === 0 ? (
          <p className="text-[12px] text-muted">Nenhuma loja no seu escopo.</p>
        ) : (
          <ul className="space-y-2">
            {lojas.map((l) =>
              editando === l.id ? (
                <li key={l.id} className="rounded-lg border border-brand/40 bg-surface-2 p-3">
                  <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-2">
                    <Campo label="Código">
                      <input className={inputCls} required maxLength={20} value={rascunho.codigo} onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })} />
                    </Campo>
                    <Campo label="Nome">
                      <input className={inputCls} required minLength={2} value={rascunho.nome} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} />
                    </Campo>
                    <Campo label="Cidade">
                      <input className={inputCls} value={rascunho.cidade} onChange={(e) => setRascunho({ ...rascunho, cidade: e.target.value })} />
                    </Campo>
                    <Campo label="Endereço">
                      <input className={inputCls} value={rascunho.endereco} onChange={(e) => setRascunho({ ...rascunho, endereco: e.target.value })} />
                    </Campo>
                    <div className="flex gap-2 sm:col-span-2">
                      <Botao type="submit" tone="brand" disabled={enviando}>
                        Salvar
                      </Botao>
                      <Botao tone="ghost" onClick={() => setEditando(null)}>
                        Cancelar
                      </Botao>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={l.id} className="rounded-lg border border-border bg-surface-2 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {l.nome} <span className="font-os-mono text-[11px] text-muted">{l.codigo}</span>
                      </p>
                      <p className="text-[12px] text-muted">
                        {[l.cidade, l.endereco].filter(Boolean).join(' · ') || 'Sem endereço cadastrado'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {!l.ativa && <Chip tone="muted">Desativada</Chip>}
                      {l.exemplo && <Chip tone="warn">Exemplo</Chip>}
                      <Chip tone={l.totens > 0 ? 'good' : 'muted'}>{l.totens} totem(ns)</Chip>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">Cadastrada em {dataBR(l.criadoEm)}.</p>
                  {editavel && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Botao onClick={() => abrirEdicao(l)} disabled={enviando}>
                        Editar
                      </Botao>
                      <Botao tone={l.ativa ? 'bad' : 'default'} onClick={() => alternarAtiva(l)} disabled={enviando}>
                        {l.ativa ? 'Desativar' : 'Reativar'}
                      </Botao>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}
