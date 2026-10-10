'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PAUTA_AUTOMACAO_ROTULO, PAUTA_CHAVE_DA_AUTOMACAO, faltaNaRotinaDePublicacao,
  PautaAutomacaoHumanoPainelSchema, PautaAutomacaoSalvarHumanoSchema,
  PautaBaseHumanaSchema, PautaEscritaHumanaResultadoSchema,
  type PautaAutomacao, type PautaRotinaDaPauta, type PautaDestinoFisico,
  type PautaEscopoHumano, type PautaEscritaHumanaResultado,
} from '@mktos/shared';
import { apiGet, apiPost, apiPut, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Chip } from '../referencias/ui';

interface EnvelopeHumano {
  escopo: PautaEscopoHumano;
  autoridade: { ler: true; editar: boolean; verificadaEm: string };
}
interface Parser<T> { parse(value: unknown): T }
const iguais = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function baseHumana(destino: PautaDestinoFisico) {
  const { versao: _versao, conteudo: _conteudo, ...base } = destino;
  return PautaBaseHumanaSchema.parse(base);
}
function mesmoDestino(a: PautaDestinoFisico, b: PautaDestinoFisico) {
  return iguais(baseHumana(a), baseHumana(b)) && a.versao === b.versao;
}
export function conferirResultadoHumano(
  value: unknown,
  entrada: { escopoEsperado: PautaEscopoHumano; baseEsperada: ReturnType<typeof baseHumana>; versaoEsperada: number | null; reativar: boolean },
  acao: PautaEscritaHumanaResultado['acao'],
) {
  const r = PautaEscritaHumanaResultadoSchema.parse(value);
  const e = (entrada.versaoEsperada ?? 0) + 1;
  if (!iguais(r.escopo, entrada.escopoEsperado) || r.acao !== acao ||
      !iguais(r.baseAplicada.baseEsperada, entrada.baseEsperada) || r.baseAplicada.versaoEsperada !== entrada.versaoEsperada ||
      r.edicao.versao !== e || (entrada.baseEsperada.estado === 'existente' && r.edicao.itemId !== entrada.baseEsperada.itemId) ||
      r.reativacao.solicitada !== entrada.reativar ||
      (r.reativacao.solicitada && (r.reativacao.versao !== e + 1 || r.reativacao.versionId === r.edicao.versionId)) ||
      r.destinoFinal.itemId !== r.edicao.itemId || r.destinoFinal.chave !== entrada.baseEsperada.chave ||
      r.destinoFinal.versao < (r.reativacao.versao ?? e)) {
    throw new Error('A resposta não corresponde à edição enviada. Conserve o texto e confira o estado atual.');
  }
  return r;
}

/** Cada chamada conserva seu próprio destino, rascunho, revisão e escopo. Não há storage de corpos. */
export function useEdicaoHumana<T extends EnvelopeHumano>(config: {
  token: string | null;
  path: string;
  schema: Parser<T>;
  destino: (p: T) => PautaDestinoFisico;
  texto: (p: T) => string;
  conferir?: (p: T) => boolean;
}) {
  const { user } = useAuth();
  const identidade = `${config.token ?? ''}|${user?.id ?? ''}|${user?.permissions.join(',') ?? ''}|${config.path}`;
  const identidadeRef = useRef(identidade); identidadeRef.current = identidade;
  const configRef = useRef(config); configRef.current = config;
  const geracao = useRef(0);
  const leitura = useRef(0);
  const revisao = useRef(0);
  const dono = useRef<PautaEscopoHumano | null>(null);
  const trava = useRef(false);
  const [estado, setEstado] = useState<{ identidade: string; atual: T | null; base: T | null; texto: string; autorizado: boolean; privado: boolean; bloqueado: boolean; ocupado: boolean; retomavel: boolean; mensagem: string | null; recibo: PautaEscritaHumanaResultado | null }>({ identidade, atual: null, base: null, texto: '', autorizado: false, privado: false, bloqueado: false, ocupado: false, retomavel: false, mensagem: null, recibo: null });
  const estadoRef = useRef(estado); estadoRef.current = estado;
  const valido = useCallback((id: string, g: number) => identidadeRef.current === id && geracao.current === g, []);
  const retirar = useCallback((e: unknown) => {
    const acesso = e instanceof ErroDaApi && [401, 403].includes(e.status);
    setEstado(s => ({ ...s, atual: null, autorizado: false, privado: acesso || s.privado,
      retomavel: false, base: acesso ? null : s.base, recibo: acesso ? null : s.recibo, bloqueado: true,
      mensagem: acesso ? 'A leitura atual foi recusada. O conteúdo foi retirado; confira novamente quando tiver acesso.' : 'Não foi possível conferir o destino. O texto local foi conservado.' }));
  }, []);
  const ler = useCallback(async (inicial = false) => {
    const id = identidadeRef.current, g = geracao.current, seq = ++leitura.current, rev = revisao.current;
    const c = configRef.current;
    if (!c.token || !user?.id) return null;
    try {
      const p = c.schema.parse(await apiGet<unknown>(c.path, c.token));
      if (!valido(id, g) || seq !== leitura.current) return null;
      if (p.escopo.actorId !== user.id || (dono.current && !iguais(dono.current, p.escopo))) {
        dono.current = null;
        setEstado(s => ({ ...s, atual: null, base: null, texto: '', autorizado: false, privado: true, bloqueado: true, recibo: null, mensagem: 'O escopo ou destino mudou. Reabra esta tela na sessão atual.' }));
        return null;
      }
      if (c.conferir && !c.conferir(p)) { retirar(new Error('Destino divergente')); return null; }
      dono.current = p.escopo;
      setEstado(s => ({ ...s, atual: p, autorizado: true, privado: false,
        ...(inicial && rev === revisao.current ? { base: p, texto: c.texto(p), bloqueado: false } : {}),
        retomavel: !inicial, mensagem: inicial ? null : s.mensagem }));
      return p;
    } catch (e) {
      if (valido(id, g) && seq === leitura.current) retirar(e);
      return null;
    }
  }, [user?.id, valido, retirar]);
  useEffect(() => {
    geracao.current++; leitura.current++; revisao.current++; dono.current = null; trava.current = false;
    setEstado({ identidade, atual: null, base: null, texto: '', autorizado: false, privado: false, bloqueado: false, ocupado: false, retomavel: false, mensagem: null, recibo: null });
    void ler(true);
    return () => { geracao.current++; leitura.current++; };
  }, [identidade, ler]);
  const visivel = estado.identidade === identidade && estado.autorizado && !estado.privado;
  const alterar = (texto: string) => { revisao.current++; setEstado(s => ({ ...s, texto })); };
  const adotar = (manterTexto = true) => {
    const s = estadoRef.current;
    if (s.identidade !== identidade || !s.autorizado || !s.atual || trava.current || !s.retomavel) return;
    const atual = s.atual;
    revisao.current++;
    setEstado(v => ({ ...v, base: atual, texto: manterTexto ? v.texto : configRef.current.texto(atual), bloqueado: false, retomavel: false, mensagem: null, recibo: null }));
  };
  const enviar = async (op: { path?: string; schema: Parser<unknown>; campos: Record<string, unknown>; acao: PautaEscritaHumanaResultado['acao']; reativar?: boolean; method?: 'PUT' | 'POST'; resultado?: (v: unknown) => unknown }) => {
    const s = estadoRef.current, c = configRef.current;
    if (trava.current || s.identidade !== identidade || !s.autorizado || !s.base || !s.atual?.autoridade.editar || s.bloqueado) return null;
    const id = identidade, g = geracao.current, rev = revisao.current;
    const destino = c.destino(s.base);
    const comum = { escopoEsperado: s.base.escopo, baseEsperada: baseHumana(destino), versaoEsperada: destino.versao, reativar: op.reativar ?? false };
    let entrada: unknown;
    try { entrada = op.schema.parse({ ...comum, ...op.campos }); }
    catch (e) { setEstado(v => ({ ...v, mensagem: e instanceof Error ? e.message : 'Revise os campos antes de salvar.' })); return null; }
    trava.current = true; setEstado(v => ({ ...v, ocupado: true, mensagem: null }));
    try {
      const atual = await ler();
      if (!valido(id, g) || rev !== revisao.current || !atual) return null;
      if (!atual.autoridade.editar || !iguais(atual.escopo, comum.escopoEsperado) || !mesmoDestino(destino, c.destino(atual))) {
        setEstado(v => ({ ...v, bloqueado: true, mensagem: 'O destino mudou desde a base escolhida. Confira e escolha como retomar; o texto local foi conservado.' })); return null;
      }
      const raw = await (op.method === 'POST' ? apiPost<unknown>(op.path ?? c.path, entrada, c.token) : apiPut<unknown>(op.path ?? c.path, entrada, c.token));
      if (!valido(id, g)) return null;
      if (rev !== revisao.current) { setEstado(v => ({ ...v, bloqueado: true, retomavel: false, mensagem: 'Chegou uma resposta para o texto anterior. O texto mais recente foi conservado; confira o estado atual antes de salvar.' })); return null; }
      const r = conferirResultadoHumano(op.resultado ? op.resultado(raw) : raw, comum, op.acao);
      setEstado(v => ({ ...v, recibo: r, bloqueado: true, retomavel: false, mensagem: `Nota salva: versão ${r.edicao.versao}${r.reativacao.solicitada ? `; reativação na versão ${r.reativacao.versao}` : destino.estado === 'existente' && destino.arquivada ? ', mantendo arquivada' : ''}. Rastro adicional: ${r.registroMudanca === 'nao_conferido' ? 'não conferido' : r.registroMudanca === 'registrado' ? 'registrado' : 'falhou'}. Confira o estado atual antes de outra edição.` }));
      return { raw, resultado: r };
    } catch (e) {
      if (!valido(id, g)) return null;
      if (e instanceof ErroDaApi && [401, 403].includes(e.status)) retirar(e);
      else setEstado(v => ({ ...v, bloqueado: true, retomavel: false, mensagem: e instanceof ErroDaApi && e.status === 409
        ? 'Conflito: a base foi alterada. O texto local foi conservado; confira o estado atual.'
        : e instanceof ErroDaApi && e.status === 400 ? `A edição foi recusada: ${e.message}`
        : 'A resposta não confirmou a edição. O texto e a base foram conservados; ler o estado atual não confirma a autoria desta chamada.' }));
      return null;
    } finally { if (valido(id, g)) { trava.current = false; setEstado(v => ({ ...v, ocupado: false })); } }
  };
  const executarExterno = async <R,>(fn: () => Promise<R>) => {
    const s = estadoRef.current;
    if (trava.current || s.identidade !== identidade || !s.autorizado || s.bloqueado || !s.atual?.autoridade.editar) return null;
    const id = identidade, g = geracao.current, rev = revisao.current;
    trava.current = true; setEstado(v => ({ ...v, ocupado: true, mensagem: null }));
    try {
      const p = await ler();
      if (!p || !valido(id, g) || rev !== revisao.current || !p.autoridade.editar) return null;
      const r = await fn();
      if (!valido(id, g)) return null;
      if (rev !== revisao.current) { setEstado(v => ({ ...v, bloqueado: true, retomavel: false, mensagem: 'A ação respondeu depois de outra edição local. Seu texto foi conservado; confira o estado atual.' })); return null; }
      // Releitura operacional separada; não altera base, texto ou confirma uma chamada perdida.
      const depois = await ler();
      if (!depois || !valido(id, g) || rev !== revisao.current) return null;
      setEstado(v => ({ ...v, bloqueado: true, retomavel: false, mensagem: 'A ação respondeu. Confira o destino e escolha a base da próxima edição; seu texto local foi conservado.' }));
      return r;
    } catch (e) {
      if (valido(id, g)) {
        if (e instanceof ErroDaApi && [401, 403].includes(e.status)) retirar(e);
        else setEstado(v => ({ ...v, bloqueado: true, retomavel: false, mensagem: 'A resposta da ação não foi confirmada. O texto local foi conservado.' }));
      }
      return null;
    } finally { if (valido(id, g)) { trava.current = false; setEstado(v => ({ ...v, ocupado: false })); } }
  };
  return { atual: visivel ? estado.atual : null, base: visivel ? estado.base : null, texto: visivel ? estado.texto : '',
    visivel, privado: estado.privado, retomavel: estado.retomavel, ocupado: estado.ocupado, bloqueado: estado.bloqueado,
    editavel: visivel && !!estado.base && !!estado.atual?.autoridade.editar && !estado.bloqueado && !estado.ocupado,
    mensagem: estado.identidade === identidade ? estado.mensagem : null,
    recibo: visivel ? estado.recibo : null,
    destinoBase: visivel && estado.base ? config.destino(estado.base) : null,
    destinoAtual: visivel && estado.atual ? config.destino(estado.atual) : null,
    alterar, adotar, conferir: () => ler(), enviar, executarExterno, invalidar: retirar };
}

type ControleHumano = {
  destinoBase: PautaDestinoFisico | null; destinoAtual: PautaDestinoFisico | null;
  mensagem: string | null; visivel: boolean; ocupado: boolean; bloqueado: boolean; retomavel: boolean;
  conferir: () => Promise<unknown>; adotar: (manterTexto?: boolean) => void;
};
export function ConferenciaEdicaoHumana({ editor }: { editor: ControleHumano }) {
  const d = editor.destinoAtual, b = editor.destinoBase;
  return <div className="space-y-2 text-xs">
    {b && <p className="text-muted">Base da edição: {b.estado === 'ausente' ? 'ausência autorizada' : `versão ${b.versao} · ${b.arquivada ? 'arquivada' : 'ativa'}`}.</p>}
    {editor.mensagem && <p role="status" className="text-warn whitespace-pre-wrap">{editor.mensagem}</p>}
    <div className="flex flex-wrap gap-2">
      <Botao tone="ghost" disabled={editor.ocupado} onClick={() => void editor.conferir()}>Conferir estado atual</Botao>
      {editor.visivel && d && <>
        <Botao tone="ghost" disabled={editor.ocupado || !editor.retomavel} onClick={() => editor.adotar(true)}>Retomar com esta base e meu texto</Botao>
        <Botao tone="ghost" disabled={editor.ocupado || !editor.retomavel} onClick={() => { if (window.confirm('Descartar o texto local e usar o conteúdo atual?')) editor.adotar(false); }}>Descartar texto e usar atual</Botao>
      </>}
    </div>
    {d && <details className="rounded border border-border p-2"><summary className="cursor-pointer">Estado atual conferido: {d.estado === 'ausente' ? 'destino ausente' : `versão ${d.versao} · ${d.arquivada ? 'arquivada' : 'ativa'}`}</summary>
      <p className="mt-2 text-muted">Esta leitura não é recibo de uma chamada anterior.</p>
      {d.estado === 'existente' && <><p className="mt-1 break-all">{d.chave} · {d.kind} · origem {d.origem.tipo}</p><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{d.conteudo.corpo}</pre></>}
    </details>}
  </div>;
}

type PropsDoInterruptor = {
  qual: PautaAutomacao; ligada: boolean | undefined; token: string | null; podeMudar: boolean; podeLigar?: boolean;
  rotina?: PautaRotinaDaPauta; onMudou: () => void; onErro: (m: string) => void;
};
export function InterruptorDaAutomacao(props: PropsDoInterruptor) {
  const { user } = useAuth();
  return <InterruptorDaSessao key={`${props.token ?? ''}|${user?.id ?? ''}|${user?.permissions.join(',') ?? ''}|${props.qual}`} {...props} />;
}
function InterruptorDaSessao(props: PropsDoInterruptor) {
  const { qual, token, podeMudar, onMudou } = props;
  const editor = useEdicaoHumana({ token, path: `/pauta/automacao/${qual}`, schema: PautaAutomacaoHumanoPainelSchema,
    destino: p => p.destino, texto: () => '', conferir: p => p.qual === qual && p.destino.chave === PAUTA_CHAVE_DA_AUTOMACAO[qual] });
  const [confirmando, setConfirmando] = useState(false);
  const [alvo, setAlvo] = useState(false);
  const [motivo, setMotivo] = useState('');
  useEffect(() => { setConfirmando(false); setMotivo(''); }, [token, qual]);
  const p = editor.atual;
  const rotulo = PAUTA_AUTOMACAO_ROTULO[qual];
  const ligada = p?.operacao.ligada;
  const semRotina = ligada && qual === 'publicacao' ? faltaNaRotinaDePublicacao(p?.operacao.rotina ?? undefined) : null;
  const salvar = async (reativar = false) => {
    const r = await editor.enviar({ schema: PautaAutomacaoSalvarHumanoSchema, campos: { qualEsperado: qual, ligada: alvo, motivo }, acao: 'mudar_interruptor', reativar });
    if (r) { setConfirmando(false); onMudou(); }
  };
  return <div className="space-y-2" aria-label={`Interruptor da ${rotulo}`}>
    {p && <div className="flex flex-wrap items-center gap-2"><Chip tone={semRotina ? 'bad' : ligada ? 'good' : 'warn'}>{semRotina ? `${rotulo} ligada, mas ${semRotina}` : `${rotulo} ${ligada ? 'ligada' : 'desligada'}`}</Chip>
      {podeMudar && editor.editavel && !confirmando && (ligada || p.operacao.podeLigar) && <Botao onClick={() => { setAlvo(!ligada); setConfirmando(true); }}>{ligada ? 'Desligar' : 'Ligar'}</Botao>}
      {semRotina && <a href="/rotinas" className="text-brand underline">Abrir rotinas</a>}
    </div>}
    {p?.operacao.impedimentos.map(m => <p key={m} className="text-xs text-muted">{m}</p>)}
    <ConferenciaEdicaoHumana editor={editor} />
    {confirmando && editor.visivel && <div className="space-y-2 rounded border border-warn/40 p-3 text-xs">
      <p>Confirmar configuração: {alvo ? 'ligar' : 'desligar'} {rotulo}. A configuração não comprova execução da rotina.</p>
      <label className="block">Motivo<input className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm" value={motivo} onChange={e => { setMotivo(e.target.value); editor.alterar(e.target.value); }} disabled={editor.ocupado} maxLength={300} /></label>
      <div className="flex flex-wrap gap-2">
        <Botao onClick={() => void salvar()} disabled={!editor.editavel || motivo.trim().length < 10 || (alvo && !p?.operacao.podeLigar)}>{editor.destinoBase?.estado === 'existente' && editor.destinoBase.arquivada ? 'Salvar mantendo arquivada' : 'Confirmar configuração'}</Botao>
        {editor.destinoBase?.estado === 'existente' && editor.destinoBase.arquivada && <Botao onClick={() => void salvar(true)} disabled={!editor.editavel || motivo.trim().length < 10 || (alvo && !p?.operacao.podeLigar)}>Salvar e reativar</Botao>}
        <Botao tone="ghost" disabled={editor.ocupado} onClick={() => setConfirmando(false)}>Manter</Botao>
      </div>
    </div>}
  </div>;
}
