'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ConexoesDeclarativasSchema,
  type ConexoesDeclarativas,
  type ConexaoDeclarativaLinha,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

const ROTA = '/integrations/catalogo-declarativo';
const CONFIGURACAO: Record<ConexaoDeclarativaLinha['configuracao']['estado'], string> = {
  nao_configurada: 'não configurado',
  declarada_sem_verificacao: 'configuração declarada · não verificada',
  desconhecida: 'configuração desconhecida',
  nao_se_aplica: 'configuração não se aplica a esta empresa',
};
const ORIGEM: Record<ConexaoDeclarativaLinha['configuracao']['origem'], string> = {
  registro_empresa: 'registro da empresa',
  declaracao_processo: 'declaração do processo',
  embutido: 'recurso local do produto',
  indisponivel: 'origem não informada nesta consulta',
  nao_se_aplica: 'não se aplica nesta empresa',
};
const STATUS = { connected: 'marcado conectado', disconnected: 'marcado desconectado', error: 'marcado com erro' };
const GRUPO: Record<string, string> = { google: 'Google' };
const SaudeManualSchema = z.object({
  estado: z.enum(['conectado', 'nao_configurado', 'erro', 'nao_verificado']),
  mensagem: z.string().nullable(),
  apuracao: z.enum(['tentativa', 'declaracao', 'nao_verificado']),
  verificadoEm: z.string().datetime(),
  latenciaMs: z.number().finite().nonnegative().nullable(),
}).strict().refine(s => s.estado !== 'conectado' || (s.apuracao === 'tentativa' && s.latenciaMs !== null));
type ObservacaoManual = z.infer<typeof SaudeManualSchema>;

const RespostaVerboSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('redirecionar'), url: z.string().url() }).strict(),
  z.object({ tipo: z.literal('manual'), instrucao: z.string() }).strict(),
  z.object({ tipo: z.literal('pronto'), detalhe: z.string() }).strict(),
  z.object({ tipo: z.literal('nao_se_aplica'), motivo: z.string() }).strict(),
  z.object({ tipo: z.literal('feito'), resumo: z.string(), numeros: z.record(z.number().finite()).optional() }).strict(),
  z.object({ tipo: z.literal('revogado'), segredos: z.array(z.string()), resumo: z.string() }).strict(),
]);
const ClickupRespostaSchema = z.object({
  tasks: z.number().int().nonnegative(), content: z.number().int().nonnegative(), lists: z.number().int().nonnegative(),
}).strict();

function quando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR');
}
function registro(row: ConexaoDeclarativaLinha) {
  if (row.registro.estado === 'ambiguo') return 'registro ambíguo · precisa de conferência';
  if (row.registro.estado === 'ausente') return 'sem registro local';
  return row.registro.status ? `registro local: ${STATUS[row.registro.status]}` : 'registro sem estado informado';
}
function textoDaObservacao(s: ObservacaoManual) {
  const estado = {
    conectado: 'respondeu à tentativa', nao_configurado: 'não configurado',
    erro: 'falha informada', nao_verificado: 'não verificado',
  }[s.estado];
  return `${s.apuracao === 'tentativa' ? 'Observação da verificação manual' : 'Declaração da consulta manual'}: ${estado}.`;
}

export function CatalogoDeclarativo({ token, pessoaId, podeSincronizarTarefas }: {
  token: string;
  pessoaId: string;
  podeSincronizarTarefas: boolean;
}) {
  const [data, setData] = useState<ConexoesDeclarativas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [observacoes, setObservacoes] = useState<Record<string, ObservacaoManual>>({});
  const [ocupacao, setOcupacao] = useState<string | null>(null);
  const [abrindoMotivo, setAbrindoMotivo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [queimando, setQueimando] = useState<string | null>(null);
  const [motivoQueima, setMotivoQueima] = useState('');
  const escopo = useRef<ConexoesDeclarativas['escopo'] | null>(null);
  const geracao = useRef(0);
  const vivo = useRef(true);
  const ocupado = useRef(false);
  const tarefasPermitidas = useRef(podeSincronizarTarefas);
  tarefasPermitidas.current = podeSincronizarTarefas;

  function retirarDados() {
    setData(null);
    setAviso(null);
    setObservacoes({});
    setAbrindoMotivo(null);
    setMotivo('');
    setQueimando(null);
    setMotivoQueima('');
  }

  async function ler(rodada: number) {
    const raw = await apiGet<unknown>(ROTA, token);
    if (!vivo.current || rodada !== geracao.current) return null;
    const resultado = ConexoesDeclarativasSchema.safeParse(raw);
    if (!resultado.success || resultado.data.escopo.userId !== pessoaId) throw new Error('consulta_invalida');
    const atual = resultado.data;
    if (escopo.current && (escopo.current.orgId !== atual.escopo.orgId ||
      escopo.current.userId !== atual.escopo.userId)) throw new Error('escopo_alterado');
    if (!escopo.current) escopo.current = atual.escopo;
    return atual;
  }

  async function atualizar() {
    if (ocupado.current) return;
    ocupado.current = true;
    const rodada = ++geracao.current;
    const vigente = () => vivo.current && rodada === geracao.current;
    retirarDados();
    setErro(null);
    setOcupacao('Atualizando cadastro…');
    try {
      const atual = await ler(rodada);
      if (atual && vigente()) setData(atual);
    } catch {
      if (vigente()) {
        retirarDados();
        setErro('Não foi possível conferir o cadastro para esta sessão. Atualize ou confira seu acesso.');
      }
    } finally {
      if (vigente()) {
        ocupado.current = false;
        setOcupacao(null);
      }
    }
  }

  useEffect(() => {
    vivo.current = true;
    ocupado.current = false;
    void atualizar();
    return () => {
      vivo.current = false;
      geracao.current++;
    };
    // O componente é remontado quando pessoa/token mudam na página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoaId, token]);

  // Todas as ações são cliques explícitos. O GET declarativo reconfere o escopo
  // antes do efeito e antes de aceitar qualquer conclusão da resposta.
  async function executar<T>(
    chave: string,
    nome: string,
    gerencial: boolean,
    chamada: (linha: ConexaoDeclarativaLinha) => Promise<T>,
    concluir: (resposta: T, antes: ConexaoDeclarativaLinha, atual: ConexoesDeclarativas) => void,
  ) {
    if (ocupado.current || !data || !vivo.current) return;
    const escolhida = data.items.find(i => i.key === chave);
    if (!escolhida) return;
    ocupado.current = true;
    const rodada = ++geracao.current;
    const vigente = () => vivo.current && rodada === geracao.current;
    retirarDados();
    setErro(null);
    setOcupacao(nome);
    try {
      const pre = await ler(rodada);
      if (!pre || !vigente()) return;
      const linha = pre.items.find(i => i.key === chave);
      if (!linha || (gerencial && !pre.autoridadeGerenciar)) throw new Error('acao_indisponivel');
      if (linha.contrato?.chave !== escolhida.contrato?.chave || linha.grupo !== escolhida.grupo ||
        linha.managed !== escolhida.managed) throw new Error('alvo_alterado');
      setData(pre);
      const resposta = await chamada(linha);
      if (!vigente()) return;
      const atual = await ler(rodada);
      if (!atual || !vigente()) return;
      if (gerencial && !atual.autoridadeGerenciar) throw new Error('acesso_alterado');
      setData(atual);
      concluir(resposta, linha, atual);
    } catch {
      if (vigente()) {
        retirarDados();
        setErro('Não foi possível conferir a ação para esta sessão. A consulta e as observações anteriores foram retiradas. Atualize o cadastro antes de continuar.');
      }
    } finally {
      if (vigente()) {
        ocupado.current = false;
        setOcupacao(null);
      }
    }
  }

  const chaveDoContrato = (linha: ConexaoDeclarativaLinha) => {
    if (!linha.contrato) throw new Error('contrato_indisponivel');
    return encodeURIComponent(linha.contrato.chave);
  };
  const alvoDe = (linha: ConexaoDeclarativaLinha) => encodeURIComponent(linha.grupo ?? linha.key);
  const nomeDoAlvo = (linha: ConexaoDeclarativaLinha) => linha.grupo ? (GRUPO[linha.grupo] ?? linha.grupo) : linha.label;

  function marcarRegistro(row: ConexaoDeclarativaLinha) {
    const desejado = row.registro.status === 'connected' ? 'disconnected' : 'connected';
    void executar(row.key, 'Atualizando registro local…', true, linha => {
      if (linha.registro.estado === 'ambiguo') throw new Error('registro_ambiguo');
      return apiPut<unknown>(`/integrations/${encodeURIComponent(linha.key)}`, {
        status: desejado,
      }, token);
    }, (_, antes, atual) => {
      const depois = atual.items.find(i => i.key === antes.key);
      if (!depois || depois.registro.estado !== 'unico' || depois.registro.status !== desejado) throw new Error('registro_nao_conferido');
      setAviso('O registro local foi conferido com o estado solicitado. Isso não verifica a conexão externa.');
    });
  }

  function mandar(row: ConexaoDeclarativaLinha, desligar: boolean, motivoTexto?: string) {
    void executar(row.key, desligar ? 'Desligando…' : 'Religando…', true,
      linha => desligar
        ? apiPost<unknown>(`/integrations/${alvoDe(linha)}/desligamento`, { motivo: motivoTexto || undefined }, token)
        : apiDelete<unknown>(`/integrations/${alvoDe(linha)}/desligamento`, token),
      (_, antes, atual) => {
        const depois = atual.items.find(i => i.key === antes.key);
        if (!depois || depois.desligado !== desligar) throw new Error('pausa_nao_conferida');
        setAviso('O estado de desligamento solicitado foi conferido no cadastro. A aplicação da pausa aparece em cada linha.');
      });
  }

  function chamarVerbo(row: ConexaoDeclarativaLinha, caminho: 'autorizacao' | 'sincronizacao' | 'revogacao', corpo: unknown = {}) {
    void executar(row.key, 'Conferindo ação manual…', true,
      linha => apiPost<unknown>(`/integrations/${chaveDoContrato(linha)}/${caminho}`, corpo, token),
      (raw, antes, atual) => {
        const resposta = RespostaVerboSchema.parse(raw);
        const tipos: Record<typeof caminho, readonly string[]> = {
          autorizacao: ['redirecionar', 'manual', 'pronto', 'nao_se_aplica'],
          sincronizacao: ['feito', 'nao_se_aplica'], revogacao: ['revogado', 'nao_se_aplica'],
        };
        if (!tipos[caminho].includes(resposta.tipo)) throw new Error('resposta_incompativel');
        const depois = atual.items.find(i => i.key === antes.key);
        if (!depois || depois.contrato?.chave !== antes.contrato?.chave) throw new Error('contrato_alterado');
        if (resposta.tipo === 'redirecionar') {
          const destino = new URL(resposta.url);
          if (destino.username || destino.password || (destino.protocol !== 'https:' &&
            !(destino.protocol === 'http:' && destino.origin === window.location.origin))) throw new Error('destino_invalido');
          window.location.assign(destino.href);
          return;
        }
        const textos = {
          manual: 'Configuração manual necessária. Consulte os requisitos desta linha.',
          pronto: 'A API informou autorização já disponível. Essa resposta não é uma nova verificação externa.',
          nao_se_aplica: 'A API informou que esta ação não se aplica a este conector.',
          feito: 'A API informou a conclusão da sincronização solicitada. Esta resposta não inclui recibo próprio.',
          revogado: 'A API informou a revogação da credencial. O cadastro foi conferido novamente.',
        };
        setAviso(textos[resposta.tipo]);
      });
  }

  function verificar(row: ConexaoDeclarativaLinha) {
    void executar(row.key, 'Consultando verificação manual…', false,
      linha => apiGet<unknown>(`/integrations/${chaveDoContrato(linha)}/saude`, token),
      (raw, antes, atual) => {
        const observacao = SaudeManualSchema.parse(raw);
        const contrato = antes.contrato;
        if (!contrato) throw new Error('contrato_indisponivel');
        const alcance = new Set([antes.key, ...contrato.linhasIrmas]);
        const linhas = atual.items.filter(i => alcance.has(i.key) && i.contrato?.chave === contrato.chave);
        if (!linhas.some(i => i.key === antes.key)) throw new Error('contrato_alterado');
        setObservacoes(Object.fromEntries(linhas.map(i => [i.key, { ...observacao, mensagem: null }])));
      });
  }

  function syncClickup(row: ConexaoDeclarativaLinha) {
    void executar(row.key, 'Sincronizando tarefas por solicitação manual…', false,
      linha => {
        if (linha.key !== 'clickup' || !tarefasPermitidas.current) throw new Error('acao_indisponivel');
        return apiPost<unknown>('/integrations/clickup/sync', {}, token);
      }, raw => {
        if (!tarefasPermitidas.current) throw new Error('acesso_alterado');
        const r = ClickupRespostaSchema.parse(raw);
        setAviso(`Resposta da sincronização manual: ${r.tasks} tarefa(s), ${r.content} conteúdo(s), ${r.lists} lista(s). Esta resposta não inclui recibo próprio.`);
      });
  }

  const gerenciar = data?.autoridadeGerenciar === true;
  const bloqueado = ocupacao !== null;

  return (
    <div className="space-y-5">
      <a href="/marketing/preparacao" className="text-sm text-brand underline">Dono e operadores das contas de Marketing</a>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-text">Configuração local · sem verificação externa nesta consulta</p>
          <p className="mt-1 text-xs text-muted">Registro, configuração declarada, pausa e recibo aparecem separados.</p>
        </div>
        <button type="button" disabled={bloqueado} onClick={() => void atualizar()}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">Atualizar cadastro</button>
      </div>
      {ocupacao && <p className="text-sm text-muted" role="status">{ocupacao}</p>}
      {erro && <p className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad" role="alert">{erro}</p>}
      {aviso && <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm" role="status">
        {aviso}<button type="button" onClick={() => setAviso(null)} className="ml-3 text-xs text-muted underline">fechar</button>
      </div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map(i => (
          <div key={i.key} className={`flex flex-col rounded-xl border bg-surface p-4 ${i.desligado ? 'border-warn/40' : 'border-border'}`}>
            <div className="flex items-start justify-between gap-2">
              <div><h2 className="font-medium text-text">{i.label}</h2><p className="mt-1 text-[11px] text-muted">{i.category} · {i.authType}</p></div>
              {i.desligado && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">
                {i.aplicacaoDoDesligamento === 'recusa' ? 'pausado' : 'pausa registrada'}
              </span>}
            </div>
            <p className="mt-3 text-xs text-text">{CONFIGURACAO[i.configuracao.estado]}</p>
            <p className="mt-1 text-[11px] text-muted">Origem: {ORIGEM[i.configuracao.origem]}</p>
            <p className={`mt-1 text-[11px] ${i.registro.estado === 'ambiguo' ? 'text-warn' : 'text-muted'}`}>{registro(i)}</p>
            {i.contrato && <p className="mt-1 text-[11px] text-muted">Escopo declarado: {i.contrato.escopoDaCredencial === 'empresa' ? 'empresa' : 'processo'}.
              {i.contrato.linhasIrmas.length > 0 && <> Linhas da mesma credencial: {i.contrato.linhasIrmas.join(', ')}.</>}
            </p>}
            <p className="mt-2 text-[11px] text-muted">Recibo próprio: não fornecido por esta consulta.</p>
            {i.key === 'obsidian' && <a href="/contexto" className="mt-2 text-[11px] text-brand underline">Ver declaração da fonte em Contexto</a>}
            <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer text-brand">Ver requisitos</summary><p className="mt-1">{i.requires}</p>
              <p className="mt-1">Descritor e requisitos não confirmam autorização nem disponibilidade da operação.</p>
            </details>
            {i.desligado && <div className="mt-3 text-[11px] text-warn">
              {i.desligadoEm && <p>Pausa registrada em {quando(i.desligadoEm)}.</p>}
              <p className="mt-1">{i.textoDoDesligamento}</p>
            </div>}
            {observacoes[i.key] && <div className="mt-3 rounded-lg border border-border bg-surface-2 p-2.5 text-[11px] text-muted">
              <p className={observacoes[i.key].estado === 'erro' ? 'text-bad' : 'text-text'}>{textoDaObservacao(observacoes[i.key])}</p>
              <p className="mt-1">{observacoes[i.key].apuracao === 'tentativa' ? 'Medição' : 'Declaração'} de {quando(observacoes[i.key].verificadoEm)}
                {observacoes[i.key].latenciaMs !== null && ` · ${observacoes[i.key].latenciaMs} ms`}.</p>
              <p className="mt-1">Observação desta ação, sem recibo próprio e sem garantia de disponibilidade atual.</p>
            </div>}
            <div className="mt-4 space-y-2">
              {i.contrato && <div className="flex flex-wrap gap-1">
                <button type="button" disabled={bloqueado} onClick={() => verificar(i)}
                  title="Consulta manual. A API pode reutilizar a medição dos últimos 30 segundos."
                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted disabled:opacity-50">Verificar</button>
                {gerenciar && <>
                  <button type="button" disabled={bloqueado} onClick={() => chamarVerbo(i, 'autorizacao')}
                    className="rounded-lg border border-border px-2 py-1 text-[11px] text-brand disabled:opacity-50">Autorizar</button>
                  <button type="button" disabled={bloqueado} onClick={() => chamarVerbo(i, 'sincronizacao')}
                    className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted disabled:opacity-50">Sincronizar</button>
                </>}
              </div>}
              {i.key === 'clickup' && podeSincronizarTarefas && <button type="button" disabled={bloqueado} onClick={() => syncClickup(i)}
                className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-brand disabled:opacity-50">Sincronizar tarefas</button>}
              {i.managed ? gerenciar ? <button type="button" disabled={bloqueado || i.registro.estado === 'ambiguo'} onClick={() => marcarRegistro(i)}
                className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">
                {i.registro.status === 'connected' ? 'Marcar registro desconectado' : 'Marcar registro conectado'}
              </button> : <p className="text-[11px] text-muted">Gerência não autorizada nesta consulta.</p>
                : gerenciar && ['gmail', 'gcal', 'gdocs', 'drive'].includes(i.key) ? <a href="/google" className="inline-block text-[11px] text-brand underline">Gerenciar Google</a>
                : !i.contrato ? <p className="text-[11px] text-muted">Sem contrato de ciclo de vida nesta consulta.</p> : null}
              {gerenciar && (i.desligado ? <button type="button" disabled={bloqueado} onClick={() => mandar(i, false)}
                className="w-full rounded-lg border border-warn/40 px-3 py-1.5 text-xs text-warn disabled:opacity-50">Religar {nomeDoAlvo(i)}</button>
                : abrindoMotivo === i.key ? <div className="space-y-2 rounded-lg border border-warn/30 p-2">
                  <label htmlFor={`motivo-${i.key}`} className="text-[11px] text-muted">Motivo do desligamento</label>
                  <input id={`motivo-${i.key}`} value={motivo} maxLength={500} disabled={bloqueado} onChange={e => setMotivo(e.target.value)}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs" />
                  <div className="flex gap-2">
                    <button type="button" disabled={bloqueado} onClick={() => mandar(i, true, motivo)} className="text-xs text-bad disabled:opacity-50">Desligar agora</button>
                    <button type="button" disabled={bloqueado} onClick={() => { setAbrindoMotivo(null); setMotivo(''); }} className="text-xs text-muted">Cancelar</button>
                  </div>
                </div> : <><button type="button" disabled={bloqueado} onClick={() => { setAbrindoMotivo(i.key); setMotivo(''); }}
                  className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">
                  Desligar {nomeDoAlvo(i)}{i.grupo ? ' (todas as superfícies)' : ''}</button>
                  <p className={`text-[10px] ${i.aplicacaoDoDesligamento === 'recusa' ? 'text-muted' : 'text-warn'}`}>{i.textoDoDesligamento}</p></>)}
              {gerenciar && i.contrato?.escopoDaCredencial === 'empresa' && (queimando === i.contrato.chave
                ? <div className="space-y-2 rounded-lg border border-bad/40 p-2">
                  <p className="text-[11px] text-bad">Revogar a credencial de {i.contrato.rotulo} desta empresa. Será necessário autorizar novamente. Para pausar, use Desligar.</p>
                  <input value={motivoQueima} maxLength={500} disabled={bloqueado} onChange={e => setMotivoQueima(e.target.value)}
                    aria-label="Motivo da revogação" className="w-full rounded border border-border bg-surface px-2 py-1 text-xs" />
                  <div className="flex gap-2">
                    <button type="button" disabled={bloqueado} onClick={() => chamarVerbo(i, 'revogacao', { motivo: motivoQueima || undefined })}
                      className="text-xs text-bad disabled:opacity-50">Queimar credencial</button>
                    <button type="button" disabled={bloqueado} onClick={() => { setQueimando(null); setMotivoQueima(''); }} className="text-xs text-muted">Cancelar</button>
                  </div>
                </div> : <button type="button" disabled={bloqueado} onClick={() => { setQueimando(i.contrato!.chave); setMotivoQueima(''); }}
                  className="w-full rounded-lg border border-bad/40 px-3 py-1.5 text-[11px] text-bad disabled:opacity-50">Revogar credencial de {i.contrato.rotulo}</button>)}
            </div>
          </div>
        ))}
      </div>
      {data && <p className="text-[11px] text-muted">Fonte: cadastro interno · gerado {quando(data.source.generatedAt)}. Nenhuma sonda nesta leitura.</p>}
    </div>
  );
}
