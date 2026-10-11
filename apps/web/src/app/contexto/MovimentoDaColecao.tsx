'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MovimentoExplicitoPreviaSchema, MovimentoExplicitoPreviaResultadoSchema, MovimentoExplicitoIntencaoSchema,
  MovimentoExplicitoCapturarSchema, MovimentoExplicitoConfirmarSchema, MovimentoExplicitoCancelarPreviaSchema,
  MovimentoExplicitoCancelarSchema, MovimentoExplicitoResultadoSchema,
  MovimentoExplicitoCancelamentoPreviaResultadoSchema, AliasDoContextoConsultaSchema, AliasDoContextoSchema,
  type CatalogoDaVersaoDto, type M05EscopoDto, type M05FonteAutorizadaDto,
  type MovimentoExplicitoPreviaResultado, type MovimentoExplicitoIntencao,
  type MovimentoExplicitoResultado, type MovimentoExplicitoCancelamentoPreviaResultado, type AliasDoContexto,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { escopoConfere, retratoConfere } from './RetratoDaFonte';
import { quando, type NotaDeContexto, type VersaoDeNota } from './tipos';

export type NotaDoMovimento = NotaDeContexto & { escopo: M05EscopoDto; retratoFonte: M05FonteAutorizadaDto };
export type VersaoDoMovimento = VersaoDeNota & { escopo: M05EscopoDto; retratoFonte: M05FonteAutorizadaDto };
type Props = {
  notaId: string; escopo: M05EscopoDto; atual: NotaDoMovimento; escolhida: VersaoDoMovimento;
  catalogo: CatalogoDaVersaoDto; onIndisponivel: () => void;
  onFonteConferida: (nota: NotaDoMovimento, historico: VersaoDoMovimento[]) => void;
  onCatalogoConferido: (catalogo: CatalogoDaVersaoDto) => void;
};
type Esperada = { notaId: string; versionId: string; versao: number; contentHash: string; escopo: M05EscopoDto; itemId: string };
type Identificador = { orgId: string; actorId: string; itemId: string; requestId: string; tipo: 'movimento_colecao' };
type Pendente = Extract<MovimentoExplicitoResultado, { estado: 'pendente_de_captura_verificada' }>;
type Terminal = Extract<MovimentoExplicitoResultado, { estado: 'confirmado' | 'cancelado' }>;
type Fotografia = { nota: NotaDoMovimento; escolhida: VersaoDoMovimento; catalogo: CatalogoDaVersaoDto };
type Rodada = { ciclo: number; identidade: string; revisao: number; base: NotaDoMovimento };
const INP = 'mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-2 text-sm text-text disabled:opacity-60';
const BTN = 'rounded-root border border-border px-3 py-2 text-xs text-brand disabled:opacity-60';
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const positivo = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const status = (e: unknown) => (e as { status?: number })?.status;
const conflito = (texto: string) => Object.assign(new Error(texto), { status: 409 });
const escopoDoMovimento = (e: { orgId: string; actorId: string }, s: M05EscopoDto) =>
  e.orgId === s.orgId && e.actorId === s.userId;
const bytesDoCaminho = (caminho: string) => [...new TextEncoder().encode(caminho)].map((b) => b.toString(16).padStart(2, '0')).join('');
const prefixo = (e: M05EscopoDto, itemId: string) => ['rootos', 'movimento', e.orgId, e.userId, itemId].map(encodeURIComponent).join(':') + ':pedido:';
const chave = (e: M05EscopoDto, id: Identificador) => prefixo(e, id.itemId) + id.requestId;

function identificadorConfere(r: unknown, e: M05EscopoDto, itemId: string): r is Identificador {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const v = r as Partial<Identificador>;
  return Object.keys(v).length === 5 && Object.keys(v).every((k) => ['orgId', 'actorId', 'itemId', 'requestId', 'tipo'].includes(k))
    && v.orgId === e.orgId && v.actorId === e.userId && v.itemId === itemId
    && uuid(v.orgId) && uuid(v.actorId) && uuid(v.itemId) && uuid(v.requestId) && v.tipo === 'movimento_colecao';
}
function lerGuardados(e: M05EscopoDto, itemId: string): Identificador[] {
  const inicio = prefixo(e, itemId), ids: Identificador[] = [];
  for (let n = 0; n < localStorage.length; n++) {
    const k = localStorage.key(n); if (!k?.startsWith(inicio)) continue;
    const r: unknown = JSON.parse(localStorage.getItem(k) ?? 'null');
    if (!identificadorConfere(r, e, itemId) || k !== chave(e, r)) throw new Error('Não foi possível conferir os identificadores guardados.');
    ids.push(r);
  }
  return ids.sort((a, b) => a.requestId.localeCompare(b.requestId));
}
function guardar(e: M05EscopoDto, id: Identificador): boolean {
  try {
    const k = chave(e, id), texto = JSON.stringify(id), anterior = localStorage.getItem(k);
    if (anterior !== null && anterior !== texto) return false;
    localStorage.setItem(k, texto); return localStorage.getItem(k) === texto;
  } catch { return false; }
}

export function catalogoDoMovimentoConfere(r: CatalogoDaVersaoDto, p: Esperada): boolean {
  const a = r?.associacao, c = r?.catalogo, s = c?.selecaoVerificada;
  if (!r || !a || !c) return false;
  if (r?.notaId !== p.notaId || r?.versionId !== p.versionId || a?.origem !== 'context_item_version'
    || a.itemId !== p.itemId || a.versao !== p.versao || a.contentHash !== p.contentHash || c?.itemId !== p.itemId
    || !c.escopo || !escopoDoMovimento(c.escopo, p.escopo) || c.capturaExternaAgora !== false
    || typeof c.movimentoDisponivel !== 'boolean' || typeof c.colecaoBloqueadaPorMovimento !== 'boolean'
    || typeof c.autoridadeDoMovimento?.registrarIntencao !== 'boolean'
    || typeof c.autoridadeDoMovimento.verificadaEm !== 'string'
    || typeof r.capturaCorrespondeAVersaoEscolhida !== 'boolean'
    || !c.atual || !uuid(c.atual.versionId) || !positivo(c.atual.versao) || !sha(c.atual.contentHash)
    || typeof c.atual.chave !== 'string' || typeof c.atual.sourceType !== 'string'
    || (c.atual.sourceRef !== null && typeof c.atual.sourceRef !== 'string') || typeof c.atual.arquivada !== 'boolean') return false;
  if (s && (!uuid(s.id) || !s.colecaoId || !/^[1-9][0-9]*$/.test(s.geracao) || !sha(s.membershipDigest)
    || typeof s.atual !== 'boolean' || !s.membro || !uuid(s.membro.id) || s.membro.itemId !== p.itemId
    || !uuid(s.membro.versionId) || !positivo(s.membro.versao) || !sha(s.membro.contentHash))) return false;
  const m = c.movimentoPendente;
  if (m && (!uuid(m.intentId) || m.itemId !== p.itemId || !m.colecaoId || m.revision !== 1
    || typeof m.iniciadaPorAtorAtual !== 'boolean'
    || (m.iniciadaPorAtorAtual ? !uuid(m.requestId) || !sha(m.intentMark) : m.requestId !== null || m.intentMark !== null))) return false;
  const mesma = !!s && s.membro.versionId === p.versionId && s.membro.versao === p.versao && s.membro.contentHash === p.contentHash;
  return mesma === r.capturaCorrespondeAVersaoEscolhida;
}

function previaConfere(r: MovimentoExplicitoPreviaResultado, e: M05EscopoDto, itemId: string) {
  return escopoDoMovimento(r.escopo, e) && r.itemId === itemId && r.payload.itemId === itemId
    && r.atual.versao === r.payload.expectedItemVersion
    && r.escolhida.versionId === r.payload.selectedVersionId && r.escolhida.contentHash === r.payload.selectedContentHash
    && r.oldSelection.id === r.payload.oldSelectionId && r.oldSelection.membro.id === r.payload.oldMemberId
    && r.oldSelection.colecaoId === r.colecaoId && r.oldSelection.membro.chave === r.origem.chave
    && igual(r.oldSelection.membro.caminho, r.origem.caminho) && igual(r.payload.destino, r.destino.caminho)
    && r.atual.chave === r.origem.chave && r.atual.sourceRef === r.origem.sourceRef
    && r.oldSelection.membro.contentHash === r.atual.contentHash && r.escolhida.versao <= r.atual.versao;
}
function provaConfere(prova: Pendente['candidatos'][number]['prova'], previa: MovimentoExplicitoPreviaResultado, purpose: 'movimento' | 'retorno') {
  const antiga = previa.oldSelection.membro, destino = purpose === 'movimento' ? previa.destino : previa.origem;
  return prova.colecaoId === previa.colecaoId && prova.marca.repositorioId === previa.oldSelection.marca.repositorioId
    && prova.membro.chave === destino.chave && igual(prova.membro.caminho, destino.caminho)
    && prova.membro.blobGit === antiga.blobGit && prova.membro.hashArquivo === antiga.hashArquivo
    && prova.membro.contentHash === antiga.contentHash && prova.membro.metadataHash === antiga.metadataHash;
}
function resultadoConfere(r: MovimentoExplicitoResultado, id: Identificador, e: M05EscopoDto): boolean {
  if (!escopoDoMovimento(r.escopo, e) || id.orgId !== e.orgId || id.actorId !== e.userId) return false;
  if (r.estado === 'ausencia_conferida') return r.requestId === id.requestId;
  if (r.disponibilidadeAtual.itemId !== id.itemId) return false;
  if (r.estado === 'pendente_de_captura_verificada') {
    const i = r.intencao, p = i.previa;
    return i.requestId === id.requestId && i.itemId === id.itemId && previaConfere(p, e, id.itemId)
      && r.candidatos.every((c) => c.id === c.prova.candidateId && provaConfere(c.prova, p, c.purpose))
      && new Set(r.candidatos.map((c) => c.purpose)).size === r.candidatos.length;
  }
  const c = r.recibo;
  return c.orgId === e.orgId && c.actorId === e.userId && c.requestId === id.requestId && c.itemId === id.itemId
    && c.oldSelection.membro.chave === c.origem.chave && igual(c.oldSelection.membro.caminho, c.origem.caminho)
    && c.oldSelection.membro.contentHash === c.anterior.contentHash && c.escolhida.versao <= c.anterior.versao
    && c.candidate.colecaoId === c.oldSelection.colecaoId
    && c.candidate.marca.repositorioId === c.oldSelection.marca.repositorioId
    && c.candidate.membro.blobGit === c.oldSelection.membro.blobGit
    && c.candidate.membro.hashArquivo === c.oldSelection.membro.hashArquivo
    && c.candidate.membro.contentHash === c.oldSelection.membro.contentHash
    && c.candidate.membro.metadataHash === c.oldSelection.membro.metadataHash
    && (c.tipo === 'confirmado'
      ? c.nova.versao === c.anterior.versao + 1 && c.nova.versionId !== c.anterior.versionId
        && c.nova.contentHash === c.anterior.contentHash && c.candidate.membro.chave === c.destino.chave
        && igual(c.candidate.membro.caminho, c.destino.caminho)
      : c.retorno.versao === c.currentItemVersion && c.candidate.membro.chave === c.origem.chave
        && igual(c.candidate.membro.caminho, c.origem.caminho));
}

export function MovimentoDaColecao(props: Props) {
  const { token, user } = useAuth();
  const itemId = props.catalogo.associacao.itemId;
  const identidade = [token ?? '', user?.id ?? '', props.escopo.orgId, props.escopo.userId, itemId, props.escolhida.id, props.escolhida.contentHash].join('|');
  const tela = useRef(identidade); tela.current = identidade;
  const atuais = useRef(props); atuais.current = props;
  const ciclo = useRef(0), revisao = useRef(0), trava = useRef(false);
  const envioOriginal = useRef<MovimentoExplicitoIntencao | null>(null);
  const intencaoLida = useRef<Pendente['intencao'] | null>(null);
  const ultimaProvaEnviada = useRef<{ tipo: 'confirmado' | 'cancelado'; candidateId: string; captureMarkHash: string } | null>(null);
  const [aberto, setAberto] = useState(false), [ocupado, setOcupado] = useState(false);
  const [caminho, setCaminho] = useState(''), [motivo, setMotivo] = useState(''), [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [previa, setPrevia] = useState<MovimentoExplicitoPreviaResultado | null>(null);
  const [pedido, setPedido] = useState<Identificador | null>(null), [guardados, setGuardados] = useState<Identificador[]>([]);
  const [resultado, setResultado] = useState<MovimentoExplicitoResultado | null>(null);
  const [cancelamento, setCancelamento] = useState<MovimentoExplicitoCancelamentoPreviaResultado | null>(null);
  const [alias, setAlias] = useState<AliasDoContexto | null>(null);
  const [erro, setErro] = useState<string | null>(null), [storageBloqueado, setStorageBloqueado] = useState(false);
  const [conferiPedido, setConferiPedido] = useState(false), [aprovar, setAprovar] = useState(false), [conferiRecibo, setConferiRecibo] = useState(false);
  const [divergente, setDivergente] = useState(false);
  const pendente = resultado?.estado === 'pendente_de_captura_verificada' ? resultado : null;
  const terminal: Terminal | null = resultado?.estado === 'confirmado' || resultado?.estado === 'cancelado' ? resultado : null;
  const candidata = pendente?.candidatos.find((c) => c.purpose === 'movimento' && c.atual) ?? null;

  useEffect(() => {
    try {
      const ids = lerGuardados(props.escopo, itemId);
      setGuardados(ids); setPedido(ids[0] ?? null); if (ids.length) setAberto(true);
    } catch { setStorageBloqueado(true); setErro('Não foi possível conferir os identificadores guardados. Nenhuma intenção nova será enviada.'); }
    return () => { ++ciclo.current; };
  }, [identidade]);

  const requestIdDeclarado = props.catalogo.catalogo.movimentoPendente?.iniciadaPorAtorAtual
    ? props.catalogo.catalogo.movimentoPendente.requestId : null;
  useEffect(() => {
    if (!requestIdDeclarado) return;
    try {
      const id: Identificador = { orgId: props.escopo.orgId, actorId: props.escopo.userId, itemId, requestId: requestIdDeclarado, tipo: 'movimento_colecao' };
      if (!guardar(props.escopo, id)) {
        setStorageBloqueado(true); setPedido((anterior) => anterior ?? id); setAberto(true);
        setErro('O identificador está apenas nesta tela. Não foi possível guardá-lo para recuperar após reabrir.'); return;
      }
      const ids = lerGuardados(props.escopo, itemId);
      setGuardados(ids); setPedido((anterior) => anterior ?? id); setAberto(true);
    } catch { setStorageBloqueado(true); setErro('Não foi possível conferir os identificadores guardados.'); }
  }, [identidade, requestIdDeclarado]);

  const fotografia = (): Rodada => ({ ciclo: ciclo.current, identidade, revisao: revisao.current, base: atuais.current.atual });
  const vigente = (r: Rodada) => r.ciclo === ciclo.current && r.identidade === tela.current && r.revisao === revisao.current;
  const privar = () => {
    ++ciclo.current; trava.current = false; setOcupado(false); setPrevia(null); setResultado(null); setCancelamento(null); setAlias(null);
    envioOriginal.current = null; intencaoLida.current = null; ultimaProvaEnviada.current = null;
    setCaminho(''); setMotivo(''); setMotivoCancelamento(''); atuais.current.onIndisponivel();
  };
  const erroDaAcao = (e: unknown) => {
    if (status(e) === 401 || status(e) === 403 || (e as { fonteIndisponivel?: boolean })?.fonteIndisponivel) { privar(); return; }
    setPrevia(null); setCancelamento(null); setAlias(null); setAprovar(false);
    setErro(status(e) === 409 ? 'A fonte, a captura ou o pedido mudou. Seu texto e o identificador foram preservados; confira o pedido antes de continuar.'
      : status(e) === 400 || Array.isArray((e as { issues?: unknown[] })?.issues) ? 'Os dados não foram aceitos. Confira o caminho e o motivo; o pedido guardado foi mantido.'
      : 'Não foi possível concluir a conferência. O identificador guardado foi mantido; consulte o pedido original.');
  };
  const operar = async (acao: (r: Rodada) => Promise<void>) => {
    if (trava.current || !token || !user || user.id !== props.escopo.userId) return;
    const r = fotografia(); trava.current = true; setOcupado(true); setErro(null);
    try { await acao(r); } catch (e) { if (vigente(r)) erroDaAcao(e); }
    finally { if (vigente(r)) { trava.current = false; setOcupado(false); } }
  };
  const conferirFonte = async (r: Rodada, escrita: boolean, usoNovo = false): Promise<Fotografia | null> => {
    const p = atuais.current;
    let nota: NotaDoMovimento, historico: VersaoDoMovimento[], catalogo: CatalogoDaVersaoDto;
    try {
      [nota, historico, catalogo] = await Promise.all([
        apiGet<NotaDoMovimento>('/memoria/' + encodeURIComponent(p.notaId), token),
        apiGet<VersaoDoMovimento[]>('/memoria/' + encodeURIComponent(p.notaId) + '/versoes', token),
        apiGet<CatalogoDaVersaoDto>('/knowledge/colecao/notas/' + encodeURIComponent(p.notaId) + '/versoes/' + encodeURIComponent(p.escolhida.id), token),
      ]);
    } catch (e) {
      if ([401, 403, 404].includes(status(e) ?? 0)) throw Object.assign(new Error('Fonte não disponível.'), { fonteIndisponivel: true });
      throw e;
    }
    if (!vigente(r)) return null;
    if (!user || nota.id !== p.notaId || !escopoConfere(nota.escopo, user.id, p.escopo)
      || !retratoConfere(nota.retratoFonte, { itemId, chave: nota.chave, versao: nota.versao, contentHash: nota.contentHash, title: nota.title, body: nota.body })
      || !Array.isArray(historico) || historico.some((v) => !escopoConfere(v.escopo, user.id, p.escopo)
        || !retratoConfere(v.retratoFonte, { itemId, versionId: v.id, versao: v.versao, contentHash: v.contentHash, title: v.title, body: v.body })))
      throw Object.assign(new Error('A fonte não confere.'), { fonteIndisponivel: true });
    const escolhida = historico.find((v) => v.id === p.escolhida.id);
    if (!escolhida || escolhida.versao !== p.escolhida.versao || escolhida.contentHash !== p.escolhida.contentHash)
      throw conflito('A versão escolhida mudou.');
    if (!catalogoDoMovimentoConfere(catalogo, { notaId: p.notaId, versionId: escolhida.id, versao: escolhida.versao,
      contentHash: escolhida.contentHash, escopo: p.escopo, itemId })) throw Object.assign(new Error('A associação não confere.'), { fonteIndisponivel: true });
    const c = catalogo.catalogo;
    if (c.atual.versionId !== nota.retratoFonte.versao.versionId || c.atual.versao !== nota.versao || c.atual.contentHash !== nota.contentHash
      || c.atual.chave !== nota.chave || c.atual.sourceType !== nota.sourceType || c.atual.sourceRef !== nota.sourceRef
      || c.atual.arquivada !== !!nota.arquivadoEm) throw conflito('A fonte mudou durante a consulta.');
    if (escrita && !c.autoridadeDoMovimento.registrarIntencao) throw Object.assign(new Error('Acesso insuficiente.'), { status: 403 });
    atuais.current.onFonteConferida(nota, historico); atuais.current.onCatalogoConferido(catalogo);
    if (usoNovo && (nota.versao !== r.base.versao || nota.contentHash !== r.base.contentHash || nota.chave !== r.base.chave
      || nota.sourceType !== r.base.sourceType || nota.sourceRef !== r.base.sourceRef || nota.arquivadoEm
      || nota.retratoFonte.acesso.novoUsoPermitido !== true || escolhida.retratoFonte.acesso.novoUsoPermitido !== true
      || !c.movimentoDisponivel || c.colecaoBloqueadaPorMovimento || c.movimentoPendente)) throw conflito('Confira a fonte atual antes de iniciar.');
    return { nota, escolhida, catalogo };
  };
  const guardarPedido = (id: Identificador) => {
    if (!guardar(props.escopo, id)) { setStorageBloqueado(true); setErro('Nenhum novo envio foi feito: não foi possível guardar seu identificador.'); return false; }
    setPedido(id); setAberto(true);
    try { setGuardados(lerGuardados(props.escopo, itemId)); } catch { setStorageBloqueado(true); return false; }
    return true;
  };
  const receber = (r: MovimentoExplicitoResultado, id: Identificador) => {
    if (!resultadoConfere(r, id, props.escopo)) throw Object.assign(new Error('A resposta não confere.'), { fonteIndisponivel: true });
    const anterior = intencaoLida.current, original = envioOriginal.current;
    let diferente = false;
    if (r.estado === 'pendente_de_captura_verificada') {
      if (anterior && (r.intencao.id !== anterior.id || r.intencao.intentMark !== anterior.intentMark || !igual(r.intencao.previa, anterior.previa)))
        throw Object.assign(new Error('A intenção mudou de identidade.'), { fonteIndisponivel: true });
      diferente = !!original && (!igual(original.payload, r.intencao.previa.payload) || original.marcaServer !== r.intencao.previa.marcaServer);
      intencaoLida.current = r.intencao;
    } else if (r.estado !== 'ausencia_conferida') {
      const c = r.recibo;
      if (anterior && (c.intentId !== anterior.id || !igual(c.escolhida, anterior.previa.escolhida)
        || !igual(c.anterior, { versionId: anterior.previa.atual.versionId, versao: anterior.previa.atual.versao, contentHash: anterior.previa.atual.contentHash })
        || !igual(c.oldSelection, anterior.previa.oldSelection) || !igual(c.origem, anterior.previa.origem) || !igual(c.destino, anterior.previa.destino)))
        throw Object.assign(new Error('O recibo não corresponde à intenção.'), { fonteIndisponivel: true });
      diferente = !!original && (c.escolhida.versionId !== original.payload.selectedVersionId || c.escolhida.contentHash !== original.payload.selectedContentHash
        || c.anterior.versao !== original.payload.expectedItemVersion || c.oldSelection.id !== original.payload.oldSelectionId
        || c.oldSelection.membro.id !== original.payload.oldMemberId || !igual(c.destino.caminho, original.payload.destino));
      const envio = ultimaProvaEnviada.current;
      if (envio && (envio.tipo !== c.tipo || envio.candidateId !== c.candidate.candidateId || envio.captureMarkHash !== c.candidate.captureMarkHash)) diferente = true;
    }
    setPedido(id); setResultado(r); setDivergente(diferente); setConferiPedido(false); setConferiRecibo(false); setAprovar(false);
    setCancelamento(null); setAlias(null); setPrevia(null);
  };
  const entregar = async (r: MovimentoExplicitoResultado, id: Identificador, rodada: Rodada) => {
    if (!vigente(rodada)) return;
    const f = await conferirFonte(rodada, false); if (!f || !vigente(rodada)) return;
    if (r.estado === 'pendente_de_captura_verificada') {
      const m = f.catalogo.catalogo.movimentoPendente;
      if (!m?.iniciadaPorAtorAtual || m.requestId !== id.requestId || m.intentId !== r.intencao.id
        || m.itemId !== id.itemId || m.revision !== r.intencao.revision || m.intentMark !== r.intencao.intentMark
        || m.colecaoId !== r.intencao.previa.colecaoId) throw conflito('O pedido pendente mudou durante a conferência.');
    }
    receber(r, id);
  };
  const conferirArmazenamento = () => void operar(async (rodada) => {
    if (!await conferirFonte(rodada, false) || !vigente(rodada)) return;
    if (pedido && !guardar(props.escopo, pedido)) throw new Error('Não foi possível guardar o identificador.');
    const ids = lerGuardados(props.escopo, itemId);
    setGuardados(ids); setPedido((anterior) => anterior ?? ids[0] ?? null); setStorageBloqueado(false);
  });
  const recuperar = (id: Identificador) => void operar(async (rodada) => {
    if (!await conferirFonte(rodada, false)) return;
    const r = MovimentoExplicitoResultadoSchema.parse(await apiGet<unknown>('/knowledge/colecao/movimentos/' + encodeURIComponent(id.requestId), token));
    await entregar(r, id, rodada);
  });
  const conferirCaminho = () => void operar(async (rodada) => {
    if (pedido || guardados.length || storageBloqueado) return;
    const f = await conferirFonte(rodada, true, true); if (!f || !vigente(rodada)) return;
    const s = f.catalogo.catalogo.selecaoVerificada;
    if (!s?.atual || !s.marcaPersistida || !s.membro.provaPersistida || s.membro.versionId !== f.nota.retratoFonte.versao.versionId
      || s.membro.versao !== f.nota.versao || s.membro.contentHash !== f.nota.contentHash
      || f.catalogo.catalogo.ultimaCaptura?.estado === 'falhou') throw conflito('A captura atual não confere.');
    const payload = MovimentoExplicitoPreviaSchema.parse({ itemId, expectedItemVersion: f.nota.versao,
      selectedVersionId: f.escolhida.id, selectedContentHash: f.escolhida.contentHash,
      oldSelectionId: s.id, oldMemberId: s.membro.id, destino: { caminhoUtf8: caminho, caminhoBytesHex: bytesDoCaminho(caminho) }, motivo });
    const p = MovimentoExplicitoPreviaResultadoSchema.parse(await apiPost<unknown>('/knowledge/colecao/movimentos/previa', payload, token));
    if (!vigente(rodada)) return;
    const depois = await conferirFonte(rodada, true, true); if (!depois || !vigente(rodada)) return;
    if (!previaConfere(p, props.escopo, itemId) || !igual(p.payload, payload) || p.escolhida.versao !== f.escolhida.versao
      || p.atual.versionId !== f.nota.retratoFonte.versao.versionId || p.atual.contentHash !== f.nota.contentHash
      || p.oldSelection.id !== s.id || p.oldSelection.membro.id !== s.membro.id
      || !igual(p.oldSelection.marca, s.marcaPersistida) || p.oldSelection.membershipDigest !== s.membershipDigest
      || !igual(p.oldSelection.membro.caminho, { caminhoUtf8: s.membro.provaPersistida.caminhoUtf8, caminhoBytesHex: s.membro.provaPersistida.caminhoBytesHex })
      || p.oldSelection.membro.blobGit !== s.membro.provaPersistida.blobGit || p.oldSelection.membro.hashArquivo !== s.membro.provaPersistida.hashArquivo
      || p.oldSelection.membro.metadataHash !== s.membro.provaPersistida.metadataHash || p.oldSelection.membro.contentHash !== s.membro.contentHash
      || depois.nota.versao !== payload.expectedItemVersion || depois.catalogo.catalogo.selecaoVerificada?.id !== payload.oldSelectionId)
      throw conflito('A prévia não corresponde à fonte conferida.');
    setPrevia(p); setResultado(null);
  });
  const registrar = (repetir = false) => void operar(async (rodada) => {
    if (storageBloqueado) return;
    let body = repetir ? envioOriginal.current : null;
    if (repetir) {
      if (!pedido || !body || pedido.requestId !== body.requestId) return;
      if (!await conferirFonte(rodada, true)) return;
    } else {
      if (!previa || pedido) return;
      const anteriores = lerGuardados(props.escopo, itemId);
      if (anteriores.length) { setGuardados(anteriores); setPedido(anteriores[0]); throw conflito('Há um pedido guardado.'); }
      const f = await conferirFonte(rodada, true, true); if (!f || !vigente(rodada)) return;
      if (!previaConfere(previa, props.escopo, itemId) || f.nota.versao !== previa.payload.expectedItemVersion
        || f.nota.retratoFonte.versao.versionId !== previa.atual.versionId
        || f.catalogo.catalogo.selecaoVerificada?.id !== previa.payload.oldSelectionId
        || caminho !== previa.payload.destino.caminhoUtf8 || motivo !== previa.payload.motivo) throw conflito('Confira novamente a proposta.');
      body = MovimentoExplicitoIntencaoSchema.parse({ requestId: crypto.randomUUID(), marcaServer: previa.marcaServer, payload: previa.payload });
    }
    if (!body || !vigente(rodada)) return;
    const id: Identificador = { orgId: props.escopo.orgId, actorId: props.escopo.userId, itemId, requestId: body.requestId, tipo: 'movimento_colecao' };
    envioOriginal.current = body;
    if (!guardarPedido(id)) return;
    const r = MovimentoExplicitoResultadoSchema.parse(await apiPost<unknown>('/knowledge/colecao/movimentos/intencoes', body, token));
    await entregar(r, id, rodada);
  });
  const capturar = () => void operar(async (rodada) => {
    if (!pedido || !pendente || !conferiPedido) return;
    if (!guardarPedido(pedido)) return;
    if (!await conferirFonte(rodada, true)) return;
    const body = MovimentoExplicitoCapturarSchema.parse({ requestId: pedido.requestId, expectedIntentRevision: pendente.intencao.revision, intentMark: pendente.intencao.intentMark });
    const r = MovimentoExplicitoResultadoSchema.parse(await apiPost<unknown>('/knowledge/colecao/movimentos/' + encodeURIComponent(pedido.requestId) + '/captura', body, token));
    await entregar(r, pedido, rodada);
  });
  const confirmar = () => void operar(async (rodada) => {
    if (!pedido || !pendente || !candidata || !aprovar || !conferiPedido) return;
    if (!guardarPedido(pedido)) return;
    if (!await conferirFonte(rodada, true)) return;
    const body = MovimentoExplicitoConfirmarSchema.parse({ requestId: pedido.requestId, expectedIntentRevision: pendente.intencao.revision,
      intentMark: pendente.intencao.intentMark, newSelection: candidata.prova, aprovacao: true });
    ultimaProvaEnviada.current = { tipo: 'confirmado', candidateId: candidata.prova.candidateId, captureMarkHash: candidata.prova.captureMarkHash };
    const r = MovimentoExplicitoResultadoSchema.parse(await apiPost<unknown>('/knowledge/colecao/movimentos/' + encodeURIComponent(pedido.requestId) + '/confirmar', body, token));
    await entregar(r, pedido, rodada);
  });
  const conferirRetorno = () => void operar(async (rodada) => {
    if (!pedido || !pendente || !conferiPedido || !motivoCancelamento.trim()) return;
    if (!guardarPedido(pedido)) return;
    const f = await conferirFonte(rodada, true); if (!f || !vigente(rodada)) return;
    const body = MovimentoExplicitoCancelarPreviaSchema.parse({ requestId: pedido.requestId, expectedIntentRevision: pendente.intencao.revision,
      intentMark: pendente.intencao.intentMark, currentItemVersion: f.nota.versao, motivo: motivoCancelamento });
    const r = MovimentoExplicitoCancelamentoPreviaResultadoSchema.parse(await apiPost<unknown>('/knowledge/colecao/movimentos/' + encodeURIComponent(pedido.requestId) + '/cancelamento/previa', body, token));
    if (!vigente(rodada)) return;
    const depois = await conferirFonte(rodada, false); if (!depois || !vigente(rodada)) return;
    if (!escopoDoMovimento(r.escopo, props.escopo) || r.intentId !== pendente.intencao.id || r.requestId !== pedido.requestId
      || r.intentMark !== pendente.intencao.intentMark || r.currentItemVersion !== body.currentItemVersion || r.currentItemVersion !== depois.nota.versao
      || r.motivo !== body.motivo || !provaConfere(r.cancelSelection, pendente.intencao.previa, 'retorno')) throw conflito('O retorno não confere.');
    setCancelamento(r); setAlias(null); setAprovar(false);
  });
  const cancelar = () => void operar(async (rodada) => {
    if (!pedido || !pendente || !cancelamento || !conferiPedido || motivoCancelamento !== cancelamento.motivo) return;
    if (!guardarPedido(pedido)) return;
    const f = await conferirFonte(rodada, true); if (!f || !vigente(rodada)) return;
    if (f.nota.versao !== cancelamento.currentItemVersion) throw conflito('A versão atual mudou.');
    const body = MovimentoExplicitoCancelarSchema.parse({ requestId: pedido.requestId, expectedIntentRevision: pendente.intencao.revision,
      intentMark: pendente.intencao.intentMark, currentItemVersion: cancelamento.currentItemVersion, motivo: cancelamento.motivo,
      marcaCancelamento: cancelamento.marcaCancelamento, cancelSelection: cancelamento.cancelSelection });
    ultimaProvaEnviada.current = { tipo: 'cancelado', candidateId: cancelamento.cancelSelection.candidateId, captureMarkHash: cancelamento.cancelSelection.captureMarkHash };
    const r = MovimentoExplicitoResultadoSchema.parse(await apiPost<unknown>('/knowledge/colecao/movimentos/' + encodeURIComponent(pedido.requestId) + '/cancelar', body, token));
    await entregar(r, pedido, rodada);
  });
  const conferirAlias = () => void operar(async (rodada) => {
    if (!terminal || terminal.estado !== 'confirmado' || !pedido) return;
    const c = terminal.recibo;
    if (!await conferirFonte(rodada, false)) return;
    const consulta = AliasDoContextoConsultaSchema.parse({ itemId, chave: c.origem.chave });
    const r = AliasDoContextoSchema.parse(await apiGet<unknown>('/knowledge/colecao/aliases?' + new URLSearchParams(consulta).toString(), token));
    if (!vigente(rodada)) return;
    const f = await conferirFonte(rodada, false); if (!f || !vigente(rodada)) return;
    if (!escopoDoMovimento(r.escopo, props.escopo) || r.itemId !== itemId || r.aliasId !== c.aliasId || r.intentId !== c.intentId
      || r.collectionId !== c.oldSelection.colecaoId || r.chaveConsultada !== c.origem.chave || r.disponibilidadeAtual.itemId !== itemId
      || r.chaveCanonicaAtual !== r.disponibilidadeAtual.chaveAtual || r.chaveCanonicaAtual !== f.nota.chave) throw conflito('A referência não confere.');
    setAlias(r);
  });
  const retirar = () => void operar(async (rodada) => {
    if (!pedido || !terminal || !conferiRecibo) return;
    if (!await conferirFonte(rodada, false) || !vigente(rodada)) return;
    const real = MovimentoExplicitoResultadoSchema.parse(await apiGet<unknown>('/knowledge/colecao/movimentos/' + encodeURIComponent(pedido.requestId), token));
    if (!vigente(rodada) || !await conferirFonte(rodada, false) || !vigente(rodada)) return;
    if (!resultadoConfere(real, pedido, props.escopo) || (real.estado !== 'confirmado' && real.estado !== 'cancelado')
      || real.recibo.id !== terminal.recibo.id || real.recibo.receiptHash !== terminal.recibo.receiptHash) throw conflito('O recibo terminal não foi conferido.');
    try {
      localStorage.removeItem(chave(props.escopo, pedido));
      if (localStorage.getItem(chave(props.escopo, pedido)) !== null) throw new Error('Identificador ainda guardado.');
      const ids = lerGuardados(props.escopo, itemId); setGuardados(ids); setPedido(ids[0] ?? null); setStorageBloqueado(false);
    } catch { setStorageBloqueado(true); setErro('O recibo foi conferido, mas não foi possível retirar o identificador local.'); return; }
    envioOriginal.current = null; intencaoLida.current = null; ultimaProvaEnviada.current = null;
    setResultado(null); setCancelamento(null); setPrevia(null); setAlias(null); setConferiRecibo(false); setConferiPedido(false); setAprovar(false); setDivergente(false);
  });
  const editar = (campo: 'caminho' | 'motivo' | 'cancelamento', valor: string) => {
    ++revisao.current; setPrevia(null); setCancelamento(null); setAprovar(false); setErro(null);
    if (campo === 'caminho') setCaminho(valor); else if (campo === 'motivo') setMotivo(valor); else setMotivoCancelamento(valor);
  };
  const escolherPedido = (id: Identificador) => {
    if (ocupado) return;
    ++ciclo.current; setPedido(id); setResultado(null); setCancelamento(null); setAlias(null); setPrevia(null); setErro(null);
    setConferiPedido(false); setConferiRecibo(false); setAprovar(false); setDivergente(false);
    envioOriginal.current = null; intencaoLida.current = null; ultimaProvaEnviada.current = null;
  };
  const c = props.catalogo.catalogo;
  const podeIniciar = c.autoridadeDoMovimento.registrarIntencao && c.movimentoDisponivel && !c.colecaoBloqueadaPorMovimento
    && !c.movimentoPendente && props.atual.retratoFonte.acesso.novoUsoPermitido && props.escolhida.retratoFonte.acesso.novoUsoPermitido;
  return <section aria-label="Mudar caminho na coleção" className="space-y-3 border-t border-border pt-3">
    <button type="button" className="text-brand underline" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>{aberto ? 'Ocultar mudança de caminho' : 'Mudar caminho'}</button>
    {aberto && <div className="space-y-3">
      <p className="text-muted">A versão aberta continua preservada. O OS registra a mudança; você move o arquivo e registra o Git na fonte.</p>
      {erro && <p role="alert" className="text-warn">{erro}</p>}
      {storageBloqueado && <div className="space-y-2"><p className="text-warn">Novos envios bloqueados até conferir o armazenamento dos identificadores.</p><button type="button" className={BTN} disabled={ocupado} onClick={conferirArmazenamento}>Conferir armazenamento dos pedidos</button></div>}
      {guardados.length > 1 && <div className="space-y-1"><p>Há mais de um identificador guardado para este item. Confira cada pedido antes de iniciar outro.</p>{guardados.map((id) => <button type="button" key={id.requestId} disabled={ocupado} aria-pressed={pedido?.requestId === id.requestId} className="mr-2 text-brand underline" onClick={() => escolherPedido(id)}>Pedido {id.requestId}</button>)}</div>}
      {pedido && <div className="space-y-2 rounded-root border border-border p-2">
        <p className="break-all">Pedido guardado: {pedido.requestId}</p>
        <button type="button" disabled={ocupado} className={BTN} onClick={() => recuperar(pedido)}>Conferir pedido original</button>
        {resultado?.estado === 'ausencia_conferida' && <p role="status">A consulta ainda não encontrou o pedido. O identificador foi mantido porque o envio anterior pode terminar depois.</p>}
        {resultado?.estado === 'ausencia_conferida' && envioOriginal.current && <button type="button" disabled={ocupado || storageBloqueado} className={BTN} onClick={() => registrar(true)}>Reenviar a mesma intenção</button>}
        {!resultado && <p className="text-muted">Consulte o pedido antes de qualquer outro envio. Esta consulta não inicia captura nem move arquivos.</p>}
      </div>}
      {!pedido && !guardados.length && <>
        {!podeIniciar && <p className="text-muted">{c.colecaoBloqueadaPorMovimento ? 'Há um movimento pendente na coleção. Não é possível iniciar outro agora.'
          : c.movimentoPendente ? 'Há um movimento pendente deste item. Somente quem o iniciou pode concluir ou cancelar.'
          : !c.autoridadeDoMovimento.registrarIntencao ? 'O acesso atual permite consultar este catálogo, mas não mudar o caminho.'
          : 'Esta fonte ainda não tem as condições necessárias para mudar o caminho. Confira a versão atual e a captura da coleção.'}</p>}
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); conferirCaminho(); }}>
          <label className="block">Caminho de destino na mesma coleção<input className={INP} value={caminho} disabled={ocupado || !podeIniciar || storageBloqueado} onChange={(e) => editar('caminho', e.target.value)} /></label>
          <p className="text-muted">{new TextEncoder().encode(caminho).byteLength}/4096 bytes UTF-8 · {caminho.length}/1000 unidades de texto. O caminho é enviado como foi escrito.</p>
          <label className="block">Motivo<textarea className={INP} value={motivo} disabled={ocupado || !podeIniciar || storageBloqueado} onChange={(e) => editar('motivo', e.target.value)} /></label>
          <button type="submit" disabled={ocupado || !podeIniciar || storageBloqueado || !caminho || !motivo.trim()} className={BTN}>Conferir caminho proposto</button>
        </form>
      </>}
      {previa && !pedido && <div className="space-y-2 rounded-root border border-border p-2">
        <p>Versão atual conferida: v{previa.atual.versao}. Versão aberta: v{previa.escolhida.versao}.</p>
        <p className="break-all">De: {previa.origem.caminho.caminhoUtf8}</p><p className="break-all">Para: {previa.destino.caminho.caminhoUtf8}</p>
        <p>A prévia não capturou a fonte nem moveu o arquivo. Registrar a intenção reserva este destino.</p>
        <button type="button" disabled={ocupado || storageBloqueado} className={BTN} onClick={() => registrar()}>Registrar intenção neste destino</button>
      </div>}
      {pendente && pedido && <div className="space-y-3 rounded-root border border-border p-2">
        <p role="status">Intenção registrada. Mova o arquivo e registre a mudança no Git fora do OS; depois capture a coleção para conferir.</p>
        <p className="break-all">De: {pendente.intencao.previa.origem.caminho.caminhoUtf8}</p>
        <p className="break-all">Para: {pendente.intencao.previa.destino.caminho.caminhoUtf8}</p>
        <p>Versão escolhida neste pedido: v{pendente.intencao.previa.escolhida.versao}. Base da mudança: v{pendente.intencao.previa.atual.versao}.</p>
        {divergente && <p className="text-warn">Este é o pedido recuperado. Ele não confirma a proposta diferente que estava nesta tela.</p>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={conferiPedido} disabled={ocupado} onChange={(e) => { setConferiPedido(e.target.checked); setAprovar(false); }} />Conferi a origem, o destino e a versão do pedido original.</label>
        <button type="button" className={BTN} disabled={ocupado || storageBloqueado || !conferiPedido || !c.autoridadeDoMovimento.registrarIntencao} onClick={capturar}>Capturar coleção para conferir movimento</button>
        <p className="text-muted">{pendente.historicoDeCandidatos.parcial ? 'Mostrando a última captura de cada finalidade; o histórico completo foi preservado.' : 'Capturas registradas deste pedido.'} Total: {pendente.historicoDeCandidatos.total}.</p>
        {pendente.candidatos.map((v) => <p key={v.id}>{v.purpose === 'movimento' ? 'Movimento' : 'Retorno'} · {quando(v.capturadaEm)} · {v.atual ? 'candidata atual' : 'registro histórico'}</p>)}
        {candidata && <div className="space-y-2">
          <p className="break-all">Candidata de movimento: {candidata.prova.membro.caminho.caminhoUtf8}</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={aprovar} disabled={ocupado || !conferiPedido} onChange={(e) => setAprovar(e.target.checked)} />Aprovo registrar esta mudança conferida, mantendo o item e seu histórico.</label>
          <button type="button" disabled={ocupado || storageBloqueado || !conferiPedido || !aprovar || !c.autoridadeDoMovimento.registrarIntencao} className={BTN} onClick={confirmar}>Confirmar mudança registrada</button>
        </div>}
        <details className="space-y-2"><summary className="cursor-pointer text-brand">Cancelar após restaurar a origem</summary>
          <p>Restaure o caminho original e deixe o destino ausente na fonte, com o Git registrado. A ação abaixo captura esse retorno; ela não restaura arquivos.</p>
          <label className="block">Motivo do cancelamento<textarea className={INP} value={motivoCancelamento} disabled={ocupado} onChange={(e) => editar('cancelamento', e.target.value)} /></label>
          <button type="button" disabled={ocupado || storageBloqueado || !conferiPedido || !motivoCancelamento.trim() || !c.autoridadeDoMovimento.registrarIntencao} className={BTN} onClick={conferirRetorno}>Capturar retorno e conferir cancelamento</button>
          {cancelamento && <div className="space-y-2"><p>Origem restaurada e destino ausente na captura conferida. O cancelamento conserva a versão v{cancelamento.currentItemVersion}.</p><button type="button" className={BTN} disabled={ocupado || storageBloqueado || !conferiPedido || !c.autoridadeDoMovimento.registrarIntencao} onClick={cancelar}>Confirmar cancelamento</button></div>}
        </details>
      </div>}
      {terminal && <div className="space-y-2 rounded-root border border-border p-2">
        <p role="status">{terminal.estado === 'confirmado' ? 'Mudança registrada no recibo.' : 'Cancelamento registrado; a versão existente foi preservada.'}{terminal.replayed ? ' Este recibo já existia.' : ''}</p>
        {divergente && <p className="text-warn">O recibo confirma o pedido original; ele não confirma a proposta ou a captura diferente desta tela.</p>}
        <p className="break-all">Origem do pedido: {terminal.recibo.origem.caminho.caminhoUtf8}</p><p className="break-all">Destino do pedido: {terminal.recibo.destino.caminho.caminhoUtf8}</p>
        <p>Versão escolhida: v{terminal.recibo.escolhida.versao}. {terminal.estado === 'confirmado' ? 'Versão registrada: v' + terminal.recibo.nova.versao : 'Versão conservada: v' + terminal.recibo.retorno.versao}.</p>
        <p className="text-muted break-all">Estado observado na resposta: v{terminal.disponibilidadeAtual.versao} · {terminal.disponibilidadeAtual.chaveAtual}{terminal.disponibilidadeAtual.arquivada ? ' · arquivada' : ''}. Esta observação pode ser posterior ao recibo.</p>
        {terminal.estado === 'confirmado' && <button type="button" className={BTN} disabled={ocupado} onClick={conferirAlias}>Conferir referência pelo caminho anterior</button>}
        {alias && <p className="break-all">A referência {alias.chaveConsultada} aponta diretamente para este mesmo item. Chave atual: {alias.chaveCanonicaAtual}. A versão aberta e sua citação foram mantidas.</p>}
        <details><summary className="cursor-pointer text-muted">Conferir recibo e versão</summary><p className="break-all">Recibo: {terminal.recibo.id} · {terminal.recibo.receiptHash}</p><p className="break-all">Versão escolhida: {terminal.recibo.escolhida.versionId} · {terminal.recibo.escolhida.contentHash}</p></details>
        <label className="flex items-start gap-2"><input type="checkbox" checked={conferiRecibo} disabled={ocupado} onChange={(e) => setConferiRecibo(e.target.checked)} />Conferi o recibo deste pedido.</label>
        <button type="button" disabled={ocupado || !conferiRecibo} className={BTN} onClick={retirar}>Retirar identificador local conferido</button>
      </div>}
      {ocupado && <p role="status">Conferindo o pedido e o acesso atual…</p>}
    </div>}
  </section>;
}
