'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BrandbookDocumentoSchema,
  type BrandbookDocumento,
  type BrandbookPainel,
  type BrandbookPrevia,
  type BrandbookColeta,
  type BrandbookReferenciaRoot,
  PAUTA_SECOES_DA_MARCA,
  PAUTA_TETO_DE_PILARES,
  PAUTA_TETO_DO_PERFIL_DA_MARCA,
  type PautaMarcaPainel,
  type PautaMarcaDestino,
  type PautaMarcaPrevia,
  type PautaMarcaAplicarInput,
} from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPost, apiPut, ErroDaApi } from '@/lib/api';
import { BookOpen, Plus, Pencil } from 'lucide-react';
import { LivroDaMarca } from './LivroDaMarca';
import { CriadorDoBrandbook } from './CriadorDoBrandbook';
import { aplicarColeta, copiarBrandbook, novoBrandbook } from './brandbook-formulario';

/* Perfil e pilares existentes permanecem separados. O livro aprovado tem
 * preferência na Pauta; o criador salva rascunho e exige uma prévia revisada. */

const MODELO = PAUTA_SECOES_DA_MARCA.map((s) => `## ${s}\n`).join('\n');

const EXEMPLO_DE_PILARES = [
  '// um pilar por linha: Nome | cor | descrição',
  '// a cor é opcional; sem ela, entra a da paleta da marca',
  'Bastidores | #9bdb1f | como a Root trabalha por dentro',
  'Números | #ff1f6b | o que deu certo e quanto custou',
].join('\n');

const areaCls =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-os-mono text-sm outline-none focus:border-brand-dim disabled:opacity-50';

export default function MarcaPage() {
  const { token, ready, can, user } = useAuth();
  const podeEditarPauta = can('pauta.editar');
  const podeLerLivro = can('pauta.ver');
  const podeLerFonte = podeLerLivro && can('obsidian.ver');
  const podeGravarLivro = podeEditarPauta && can('obsidian.ver');
  const identidade = `${token ?? ''}:${user?.id ?? ''}:${podeLerLivro}:${podeLerFonte}:${podeGravarLivro}`;
  const sessao = useRef(identidade);
  sessao.current = identidade;
  const [identidadeDoEstado, setIdentidadeDoEstado] = useState(identidade);
  const revisaoPrevia = useRef<Record<PautaMarcaDestino, number>>({ perfil: 0, pilares: 0 });
  const revisaoPainel = useRef(0);
  const escritaEmCurso = useRef<symbol | null>(null);
  const [painel, setPainel] = useState<PautaMarcaPainel | null>(null);
  const [perfil, setPerfil] = useState('');
  const [pilares, setPilares] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<'perfil' | 'pilares' | null>(null);
  const [previas, setPrevias] = useState<Record<PautaMarcaDestino, PautaMarcaPrevia | null>>({ perfil: null, pilares: null });
  const [textos, setTextos] = useState<Record<PautaMarcaDestino, string>>({ perfil: '', pilares: '' });
  const [aplicando, setAplicando] = useState<PautaMarcaDestino | null>(null);
  const [livro, setLivro] = useState<BrandbookPainel | null>(null);
  const [referencia, setReferencia] = useState<BrandbookReferenciaRoot | null>(null);
  const [livroCarregado, setLivroCarregado] = useState(false);
  const [erroLivro, setErroLivro] = useState<string | null>(null);
  const [criadorAberto, setCriadorAberto] = useState(false);
  const [criadorId, setCriadorId] = useState(0);
  const [documentoLocal, setDocumentoLocal] = useState<BrandbookDocumento | null>(null);
  const [versaoBase, setVersaoBase] = useState<number | null>(null);
  const [previaLivro, setPreviaLivro] = useState<BrandbookPrevia | null>(null);
  const [aprovado, setAprovado] = useState(false);
  const [conflitoLivro, setConflitoLivro] = useState(false);
  const [operacaoLivro, setOperacaoLivro] = useState<string | null>(null);
  const [avisosDaColeta, setAvisosDaColeta] = useState<string[]>([]);
  const [visaoDoLivro, setVisaoDoLivro] = useState<'ativo' | 'rascunho'>('ativo');
  const [confirmaDesativar, setConfirmaDesativar] = useState(false);
  const leituraDoLivro = useRef(0);
  const revisaoLocal = useRef(0);
  const localAtual = useRef(documentoLocal);
  localAtual.current = documentoLocal;
  const livroArquivado = livro?.estado === 'arquivado';
  const livroAtivo = livro && !livroArquivado ? livro.ativo : null;
  const editavel = podeEditarPauta && livroCarregado && !livroAtivo && !livroArquivado;
  const podeAplicar = editavel && can('obsidian.ver');
  const ocupado = operacaoLivro !== null || salvando !== null || aplicando !== null;
  const alterado = documentoLocal !== null && (!livro?.rascunho ||
    JSON.stringify(documentoLocal) !== JSON.stringify(livro.rascunho));
  const documentoDoLivro = livroArquivado ? livro?.rascunho ?? livro?.ativo?.documento ?? null :
    visaoDoLivro === 'rascunho' && livro?.rascunho ? livro.rascunho : livroAtivo?.documento ?? livro?.rascunho ?? referencia?.documento ?? null;
  const mostrandoReferencia = !!documentoDoLivro && !livroArquivado && !livroAtivo && !livro?.rascunho;


  useEffect(() => {
    let cancelada = false;
    const leitura = ++revisaoPainel.current;
    escritaEmCurso.current = null;
    setPainel(null);
    setPerfil('');
    setPilares('');
    setPrevias({ perfil: null, pilares: null });
    setTextos({ perfil: '', pilares: '' });
    setErro(null);
    setSalvando(null);
    setAplicando(null);
    revisaoPrevia.current.perfil++;
    revisaoPrevia.current.pilares++;
    setIdentidadeDoEstado(identidade);
    if (!ready || !token || !podeLerLivro) return;
    apiGet<PautaMarcaPainel>('/pauta/marca', token)
      .then((p) => {
        if (cancelada || sessao.current !== identidade || revisaoPainel.current !== leitura) return;
        setPainel(p);
        setPerfil(p.perfil ?? '');
        setPilares(p.pilaresTexto);
      })
      .catch((e: Error) => { if (!cancelada && sessao.current === identidade) setErro(e.message); });
    return () => { cancelada = true; };
  }, [ready, token, podeLerFonte, identidade, podeLerLivro]);

  useEffect(() => {
    const leitura = ++leituraDoLivro.current;
    let cancelada = false;
    revisaoLocal.current++;
    setLivro(null); setReferencia(null); setLivroCarregado(false); setErroLivro(null);
    setCriadorAberto(false); setDocumentoLocal(null); setVersaoBase(null);
    setPreviaLivro(null); setAprovado(false); setConflitoLivro(false); setOperacaoLivro(null);
    setAvisosDaColeta([]); setVisaoDoLivro('ativo'); setConfirmaDesativar(false);
    if (!ready || !token || !podeLerLivro) return;
    const valida = () => !cancelada && sessao.current === identidade && leituraDoLivro.current === leitura;
    (async () => {
      try {
        const p = await apiGet<BrandbookPainel>('/pauta/marca/brandbook', token);
        if (!valida()) return;
        setLivro(p); setLivroCarregado(true); setVersaoBase(p.versao);
        if (!p.rascunho && !p.ativo) {
          const r = await apiGet<BrandbookReferenciaRoot>('/pauta/marca/brandbook/referencia-root', token);
          if (valida()) setReferencia(r);
        }
      } catch (e) {
        if (valida()) setErroLivro((e as Error).message);
      }
    })();
    return () => { cancelada = true; };
  }, [ready, token, identidade, podeLerLivro]);

  function iniciarCriador(base?: BrandbookDocumento) {
    if (!podeGravarLivro || !livroCarregado || livroArquivado || ocupado || escritaEmCurso.current) return;
    revisaoLocal.current++;
    const preservando = base === undefined && localAtual.current !== null;
    setDocumentoLocal(copiarBrandbook(base ?? localAtual.current ?? livro?.rascunho ?? livroAtivo?.documento ?? novoBrandbook()));
    setVersaoBase(livro?.versao ?? null); setPreviaLivro(null); setAprovado(false);
    setErroLivro(null); if (!preservando) setConflitoLivro(false); setAvisosDaColeta([]);
    setCriadorId((n) => n + 1); setCriadorAberto(true);
  }

  function alterarLivro(d: BrandbookDocumento) {
    if (!podeGravarLivro || livroArquivado || escritaEmCurso.current) return;
    revisaoLocal.current++;
    setDocumentoLocal(d); setPreviaLivro(null); setAprovado(false); setErroLivro(null);
  }

  function erroDoLivro(e: unknown) {
    setPreviaLivro(null); setAprovado(false);
    if (e instanceof ErroDaApi && e.status === 409) {
      setConflitoLivro(true);
      setErroLivro('O livro mudou enquanto você editava. Seu texto local foi preservado.');
    } else setErroLivro((e as Error).message);
  }

  async function atualizarPautaAposLivro() {
    if (!token || !podeLerLivro) return;
    const leitura = ++revisaoPainel.current;
    try {
      const p = await apiGet<PautaMarcaPainel>('/pauta/marca', token);
      if (sessao.current !== identidade || revisaoPainel.current !== leitura) return;
      setPainel(p); setPerfil(p.perfil ?? ''); setPilares(p.pilaresTexto);
      setPrevias({ perfil: null, pilares: null }); setTextos({ perfil: '', pilares: '' });
    } catch (e) {
      if (sessao.current === identidade) setErro(`O livro foi atualizado, mas a leitura da Pauta falhou: ${(e as Error).message}`);
    }
  }

  async function salvarLivro() {
    const d = localAtual.current;
    if (!d || !token || !podeGravarLivro || livroArquivado || conflitoLivro || escritaEmCurso.current) return;
    const validado = BrandbookDocumentoSchema.safeParse(d);
    if (!validado.success) {
      setErroLivro(validado.error.issues.map((i) => `${i.path.join('.') || 'Livro'}: ${i.message}`).join(' · '));
      return;
    }
    const escrita = Symbol('salvar-livro'); escritaEmCurso.current = escrita;
    const revisao = revisaoLocal.current;
    setOperacaoLivro('Salvando rascunho…'); setErroLivro(null); setPreviaLivro(null); setAprovado(false);
    ++leituraDoLivro.current; ++revisaoPainel.current;
    try {
      const p = await apiPut<BrandbookPainel>('/pauta/marca/brandbook/rascunho', { versaoEsperada: versaoBase, documento: validado.data }, token);
      if (sessao.current !== identidade || escritaEmCurso.current !== escrita) return;
      setLivro(p); setVersaoBase(p.versao); setReferencia(null); setVisaoDoLivro('rascunho');
      if (revisaoLocal.current === revisao) setDocumentoLocal(copiarBrandbook(p.rascunho ?? validado.data));
    } catch (e) {
      if (sessao.current === identidade) erroDoLivro(e);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) { escritaEmCurso.current = null; setOperacaoLivro(null); }
    }
  }

  async function conferirLivro() {
    if (!token || !podeGravarLivro || livroArquivado || !livro?.rascunho || !versaoBase || alterado || conflitoLivro ||
      versaoBase !== livro.versao || escritaEmCurso.current) return;
    const escrita = Symbol('previa-livro'); escritaEmCurso.current = escrita;
    const revisao = revisaoLocal.current;
    setOperacaoLivro('Conferindo prévia…'); setErroLivro(null); setPreviaLivro(null); setAprovado(false);
    try {
      const p = await apiPost<BrandbookPrevia>('/pauta/marca/brandbook/previa', { versaoEsperada: versaoBase }, token);
      if (sessao.current !== identidade || escritaEmCurso.current !== escrita || revisaoLocal.current !== revisao) return;
      const documento = BrandbookDocumentoSchema.parse(p.documento);
      if (p.versao !== versaoBase || !/^[a-f0-9]{64}$/.test(p.draftHash) ||
        JSON.stringify(documento) !== JSON.stringify(BrandbookDocumentoSchema.parse(livro.rascunho))) {
        setConflitoLivro(true);
        throw new Error('A prévia não corresponde ao rascunho salvo. Atualize a versão antes de continuar.');
      }
      setPreviaLivro({ ...p, documento });
    } catch (e) {
      if (sessao.current === identidade) erroDoLivro(e);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) { escritaEmCurso.current = null; setOperacaoLivro(null); }
    }
  }

  async function ativarLivro() {
    const p = previaLivro;
    if (!token || !podeGravarLivro || livroArquivado || !aprovado || !p || p.pendencias.length || alterado || conflitoLivro ||
      p.versao !== versaoBase || p.versao !== livro?.versao || escritaEmCurso.current) return;
    const escrita = Symbol('ativar-livro'); escritaEmCurso.current = escrita;
    setOperacaoLivro('Ativando versão aprovada…'); setErroLivro(null);
    ++leituraDoLivro.current; ++revisaoPainel.current;
    try {
      const novo = await apiPost<BrandbookPainel>('/pauta/marca/brandbook/ativar', { versaoEsperada: p.versao, draftHash: p.draftHash, aprovacao: true }, token);
      if (sessao.current !== identidade || escritaEmCurso.current !== escrita) return;
      setLivro(novo); setVersaoBase(novo.versao); setVisaoDoLivro('ativo'); setCriadorAberto(false);
      setPreviaLivro(null); setAprovado(false); setConfirmaDesativar(false);
      await atualizarPautaAposLivro();
    } catch (e) {
      if (sessao.current === identidade) erroDoLivro(e);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) { escritaEmCurso.current = null; setOperacaoLivro(null); }
    }
  }

  async function desativarLivro() {
    if (!token || !podeGravarLivro || !livro || livro.versao === null || livroArquivado ||
      !livroAtivo || !confirmaDesativar || escritaEmCurso.current) return;
    const versaoEsperada = livro.versao;
    const escrita = Symbol('desativar-livro'); escritaEmCurso.current = escrita;
    setOperacaoLivro('Desativando livro…'); setErroLivro(null);
    ++leituraDoLivro.current; ++revisaoPainel.current;
    try {
      const novo = await apiPost<BrandbookPainel>('/pauta/marca/brandbook/desativar', { versaoEsperada }, token);
      if (sessao.current !== identidade || escritaEmCurso.current !== escrita) return;
      setLivro(novo); setVersaoBase(novo.versao); setPreviaLivro(null); setAprovado(false); setConfirmaDesativar(false);
      setVisaoDoLivro('rascunho');
      await atualizarPautaAposLivro();
    } catch (e) {
      if (sessao.current === identidade) erroDoLivro(e);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) { escritaEmCurso.current = null; setOperacaoLivro(null); }
    }
  }

  async function atualizarVersaoDoLivro() {
    if (!token || !podeLerLivro || escritaEmCurso.current) return;
    const escrita = Symbol('atualizar-base-livro'); escritaEmCurso.current = escrita;
    setOperacaoLivro('Atualizando versão de destino…'); setErroLivro(null);
    ++leituraDoLivro.current;
    try {
      const novo = await apiGet<BrandbookPainel>('/pauta/marca/brandbook', token);
      if (sessao.current !== identidade || escritaEmCurso.current !== escrita) return;
      setLivro(novo); setVersaoBase(novo.versao); setConflitoLivro(false); setPreviaLivro(null); setAprovado(false);
    } catch (e) {
      if (sessao.current === identidade) erroDoLivro(e);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) { escritaEmCurso.current = null; setOperacaoLivro(null); }
    }
  }

  async function coletarSite(url: string) {
    if (!token || !podeEditarPauta || !podeGravarLivro || livroArquivado || !localAtual.current || escritaEmCurso.current) return;
    const escrita = Symbol('coletar-site'); escritaEmCurso.current = escrita;
    const revisao = revisaoLocal.current;
    const documento = localAtual.current;
    setOperacaoLivro('Coletando site…'); setErroLivro(null); setAvisosDaColeta([]);
    try {
      const coleta = await apiPost<BrandbookColeta>('/pauta/marca/brandbook/coletar-site', { url }, token);
      if (sessao.current !== identidade || escritaEmCurso.current !== escrita || revisaoLocal.current !== revisao) return;
      const proposto = aplicarColeta(documento, coleta);
      const validado = BrandbookDocumentoSchema.safeParse(proposto);
      if (!validado.success) throw new Error(`A coleta não cabe no rascunho: ${validado.error.issues.map((i) => i.message).join(' · ')}`);
      revisaoLocal.current++;
      setDocumentoLocal(validado.data); setPreviaLivro(null); setAprovado(false); setAvisosDaColeta(coleta.avisos);
    } catch (e) {
      if (sessao.current === identidade) setErroLivro((e as Error).message);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) { escritaEmCurso.current = null; setOperacaoLivro(null); }
    }
  }

  async function carregarPrevia(qual: PautaMarcaDestino) {
    if (!podeLerFonte || !token) return;
    const sequencia = ++revisaoPrevia.current[qual];
    setErro(null);
    try {
      const p = await apiGet<PautaMarcaPrevia>(`/pauta/marca/projecao/${qual}`, token);
      if (sessao.current !== identidade || revisaoPrevia.current[qual] !== sequencia) return;
      setPrevias((v) => ({ ...v, [qual]: p }));
      setTextos((v) => ({ ...v, [qual]: p.textoProposto }));
    } catch (e) {
      if (sessao.current === identidade && revisaoPrevia.current[qual] === sequencia) setErro((e as Error).message);
    }
  }

  async function aplicar(qual: PautaMarcaDestino) {
    const p = previas[qual];
    if (!podeAplicar || !painel || !p || !token || escritaEmCurso.current ||
        !p.fonteContextItemId || !p.fonteVersao || !p.fonteHash || !p.secoesUsadas.length) return;
    const escrita = Symbol('aplicar');
    escritaEmCurso.current = escrita;
    ++revisaoPainel.current;
    setAplicando(qual);
    setErro(null);
    const corpo: PautaMarcaAplicarInput = {
      fonteContextItemId: p.fonteContextItemId, fonteVersao: p.fonteVersao, fonteHash: p.fonteHash,
      destinoContextItemId: p.destinoContextItemId, destinoVersao: p.destinoVersao,
      destinoHash: p.destinoHash, secoesUsadas: p.secoesUsadas, textoFinal: textos[qual],
    };
    try {
      const novo = await apiPost<PautaMarcaPainel>(`/pauta/marca/projecao/${qual}`, corpo, token);
      if (sessao.current !== identidade) return;
      setPainel(novo);
      if (qual === 'perfil') setPerfil(novo.perfil ?? '');
      else setPilares(novo.pilaresTexto);
      await carregarPrevia(qual);
    } catch (e) {
      if (sessao.current === identidade) setErro(`${(e as Error).message} Atualize a prévia antes de tentar novamente.`);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) {
        escritaEmCurso.current = null;
        setAplicando(null);
      }
    }
  }

  async function salvar(qual: 'perfil' | 'pilares') {
    if (!editavel || !painel || !token || escritaEmCurso.current) return;
    const escrita = Symbol('salvar');
    escritaEmCurso.current = escrita;
    ++revisaoPainel.current;
    setSalvando(qual);
    setErro(null);
    try {
      const corpo =
        qual === 'perfil'
          ? { perfil, versao: painel?.perfilVersao ?? undefined }
          : { pilares, versao: painel?.pilaresVersao ?? undefined };
      const caminho = qual === 'perfil' ? '/pauta/marca' : '/pauta/marca/pilares';
      const p = await apiPut<PautaMarcaPainel>(caminho, corpo, token);
      if (sessao.current !== identidade) return;
      setPainel(p);
      if (qual === 'perfil') setPerfil(p.perfil ?? '');
      else setPilares(p.pilaresTexto);
      if (podeLerFonte) await carregarPrevia(qual);
    } catch (e) {
      if (sessao.current === identidade) setErro((e as Error).message);
    } finally {
      if (sessao.current === identidade && escritaEmCurso.current === escrita) {
        escritaEmCurso.current = null;
        setSalvando(null);
      }
    }
  }

  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (identidadeDoEstado !== identidade) return <p className="text-muted">Atualizando acesso…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="font-os-mono text-[10px] uppercase tracking-[0.15em] text-muted">Contexto / Marca</p><h1 className="mt-1 text-xl font-semibold">Marca</h1><p className="mt-1 text-sm text-muted">Livro da marca, identidade visual e orientações de escrita.</p></div>
        {podeGravarLivro && livroCarregado && !livroArquivado && <div className="flex flex-wrap gap-2">
          <button type="button" disabled={ocupado || criadorAberto} onClick={() => iniciarCriador(novoBrandbook())} className="inline-flex min-h-11 items-center gap-2 border border-brand-dim px-3 text-sm text-brand hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"><Plus size={15} /> Criar do zero</button>
          {(documentoLocal || livro?.rascunho || livroAtivo) && <button type="button" disabled={ocupado || criadorAberto} onClick={() => iniciarCriador()} className="inline-flex min-h-11 items-center gap-2 border border-border px-3 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"><Pencil size={15} /> {documentoLocal && alterado ? 'Retomar rascunho local' : 'Editar rascunho'}</button>}
        </div>}
      </div>
      {!podeLerLivro ? <p className="text-sm text-muted">Sua conta precisa de acesso à Pauta para consultar o livro da marca.</p> : <>
        {erroLivro && !criadorAberto && <p role="alert" className="border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erroLivro}</p>}
        {!livroCarregado && !erroLivro && <p role="status" className="text-sm text-muted">Carregando livro da marca…</p>}
        {mostrandoReferencia && <div className="flex items-start gap-3 border border-border bg-surface p-4 text-sm"><BookOpen size={18} className="mt-0.5 shrink-0 text-brand" /><div><p className="font-medium">Referência ROOT</p><p className="mt-1 text-muted">Guia canônico, somente leitura. Esta referência ainda não é o livro ativo desta empresa.</p></div></div>}
        {livroArquivado && <p role="status" className="border border-warn/40 bg-warn/10 p-4 text-sm">Livro arquivado. Consulta disponível; criação, edição e ativação estão bloqueadas.</p>}
        {livroAtivo && <div className="space-y-3 border border-good/30 bg-good/5 p-4 text-sm"><p className="font-medium text-good">Livro aprovado em uso na Pauta</p><p className="text-muted">Aprovado por {livroAtivo.aprovadoPor} em {new Date(livroAtivo.aprovadoEm).toLocaleString('pt-BR')}. Perfil e pilares abaixo usam esta fonte enquanto o livro estiver ativo.</p>{podeGravarLivro && <details><summary className="cursor-pointer text-xs text-muted">Desativar uso na Pauta</summary><label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmaDesativar} disabled={ocupado} onChange={(e) => setConfirmaDesativar(e.target.checked)} /><span>Quero desativar o livro e voltar aos campos separados de perfil e pilares.</span></label><button type="button" disabled={ocupado || !confirmaDesativar} onClick={() => void desativarLivro()} className="mt-3 min-h-11 border border-border px-3 text-sm disabled:opacity-50">Desativar livro</button></details>}</div>}
        {livroAtivo && livro?.rascunho && <div className="flex flex-wrap gap-2" role="group" aria-label="Versão do livro exibida">{(['ativo', 'rascunho'] as const).map((v) => <button key={v} type="button" aria-pressed={visaoDoLivro === v} onClick={() => setVisaoDoLivro(v)} className={`min-h-11 border px-3 text-sm ${visaoDoLivro === v ? 'border-brand-dim text-brand' : 'border-border text-muted'}`}>{v === 'ativo' ? 'Livro ativo' : 'Rascunho salvo'}</button>)}</div>}
        {criadorAberto && documentoLocal && podeGravarLivro && !livroArquivado && <CriadorDoBrandbook key={`${identidade}:${criadorId}`} documento={documentoLocal} ocupado={ocupado} operacao={operacaoLivro} alterado={alterado} versao={versaoBase} previa={previaLivro} aprovado={aprovado} conflito={conflitoLivro} erro={erroLivro} avisosDaColeta={avisosDaColeta} onAlterar={alterarLivro} onColetar={coletarSite} onSalvar={salvarLivro} onPrevia={conferirLivro} onAtivar={ativarLivro} onAprovar={setAprovado} onAtualizarVersao={atualizarVersaoDoLivro} onFechar={() => { if (!alterado || window.confirm('Fechar o criador? Seu texto local ficará nesta página para retomar. Recarregar ou sair da página pode perdê-lo.')) setCriadorAberto(false); }} />}
        {documentoDoLivro && <LivroDaMarca key={`${identidade}:${mostrandoReferencia ? 'referencia' : visaoDoLivro}`} documento={documentoDoLivro} fonteCompleta={mostrandoReferencia ? referencia!.fonte.texto : undefined} origem={mostrandoReferencia ? referencia!.fonte.nome : livroArquivado ? 'Livro arquivado — somente consulta' : visaoDoLivro === 'rascunho' || !livroAtivo ? 'Rascunho salvo da empresa — ainda não aprovado' : 'Livro ativo da empresa'} versao={mostrandoReferencia ? referencia!.fonte.versao : visaoDoLivro === 'ativo' && livroAtivo ? null : livro?.versao} hash={mostrandoReferencia ? referencia!.fonte.hash : visaoDoLivro === 'ativo' && livroAtivo ? livroAtivo.draftHash : livro?.hash} onUsarBase={mostrandoReferencia && podeGravarLivro && !ocupado && !criadorAberto ? () => iniciarCriador(referencia!.documento) : undefined} />}
        {livroCarregado && !livroArquivado && !documentoDoLivro && !erroLivro && <p className="text-sm text-muted">Nenhum livro próprio salvo. Você pode criar um brandbook do zero.</p>}
      </>}
      <div className="border-t border-border pt-5"><h2 className="text-lg font-semibold">Perfil e pilares da Pauta</h2><p className="mt-1 text-sm text-muted">{livroArquivado ? 'Livro arquivado. A edição do perfil e dos pilares está bloqueada.' : livroAtivo ? 'Leitura da fonte ativa. Desative o livro para editar os campos separados.' : 'Configuração existente dos pedidos de conteúdo. O criador do brandbook fica acima.'}</p></div>

      {erro && (
        <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>
      )}

      {painel?.avisos.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {painel.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5" aria-labelledby="projecao-titulo">
        <h2 id="projecao-titulo" className="font-semibold">Guia de marca na Memória</h2>
        <p className="mt-1 text-sm text-muted">
          Confira os trechos do guia e edite o texto curto antes de aplicar. Perfil e pilares são
          versões separadas; cada botão grava apenas o destino indicado.
        </p>
        {!podeLerFonte ? (
          <p className="mt-3 text-sm text-muted">Para consultar a fonte, sua conta precisa de acesso à Pauta e à Memória.</p>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {(['perfil', 'pilares'] as const).map((qual) => {
              const p = previas[qual];
              const titulo = qual === 'perfil' ? 'Perfil' : 'Pilares';
              const aplicavel = p && p.fonteContextItemId && p.fonteVersao && p.fonteHash &&
                p.secoesUsadas.length > 0 && !['fonte_ausente', 'fonte_arquivada'].includes(p.estado) &&
                textos[qual].length <= PAUTA_TETO_DO_PERFIL_DA_MARCA &&
                (qual !== 'perfil' || textos[qual].trim().length >= 80);
              return (
                <div key={qual} className="rounded-lg border border-border bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">{titulo}</h3>
                    <button type="button" onClick={() => carregarPrevia(qual)}
                      aria-label={`${p ? 'Atualizar prévia' : 'Conferir guia'} de ${titulo.toLowerCase()}`}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-brand-dim focus-visible:outline-2 focus-visible:outline-brand">
                      {p ? 'Atualizar prévia' : 'Conferir guia'}
                    </button>
                  </div>
                  {p && (
                    <div className="mt-3 space-y-3 text-sm">
                      <p aria-live="polite" className="text-muted">
                        {p.estado === 'ja_aplicado' ? 'Esta projeção já está aplicada.' :
                          p.estado === 'fonte_alterada' ? 'O guia mudou desde a aplicação anterior.' :
                          p.estado === 'destino_alterado' ? 'O destino mudou desde a aplicação anterior.' :
                          p.estado === 'pronto' ? 'Prévia pronta para revisão.' : p.aviso}
                      </p>
                      {p.aviso && !['fonte_ausente', 'fonte_arquivada', 'excede_limite'].includes(p.estado) &&
                        <p className="text-warn">{p.aviso}</p>}
                      {p.fonteContextItemId && (
                        <p className="break-all font-os-mono text-xs text-muted">
                          Fonte: {p.fonteChave} · v{p.fonteVersao} · sha256:{p.fonteHash?.slice(0, 12)}
                        </p>
                      )}
                      {p.secoesUsadas.length > 0 && (
                        <div>
                          <p className="font-medium">Trechos usados</p>
                          <ul className="mt-1 list-disc pl-5 text-muted">
                            {p.secoesUsadas.map((s) => <li key={s.titulo}>{s.titulo} · {s.hash.slice(0, 12)}</li>)}
                          </ul>
                        </div>
                      )}
                      {p.diferenca && p.textoAtual && (
                        <details>
                          <summary className="cursor-pointer font-medium">Ver texto atual antes de trocar</summary>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border p-2 font-os-mono text-xs">{p.textoAtual}</pre>
                        </details>
                      )}
                      {p.secoesUsadas.length > 0 && (
                        <>
                          <label htmlFor={`projecao-${qual}`} className="block font-medium">Texto proposto para {titulo.toLowerCase()}</label>
                          <textarea id={`projecao-${qual}`} value={textos[qual]}
                            onChange={(e) => {
                              revisaoPrevia.current[qual]++;
                              setTextos((v) => ({ ...v, [qual]: e.target.value }));
                            }}
                            disabled={!podeAplicar || ocupado} rows={qual === 'perfil' ? 14 : 8}
                            className={areaCls} />
                          <p className="font-os-mono text-xs text-muted">{textos[qual].length} / {PAUTA_TETO_DO_PERFIL_DA_MARCA} caracteres</p>
                          {podeAplicar && (
                            <button type="button" onClick={() => aplicar(qual)}
                              disabled={!painel || !aplicavel || ocupado}
                              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50">
                              {aplicando === qual ? 'Aplicando…' : `Aplicar somente ${titulo.toLowerCase()}`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
            O perfil da marca
          </h2>
          <span className="font-os-mono text-[11px] tabular-nums text-muted">
            {perfil.length} / {PAUTA_TETO_DO_PERFIL_DA_MARCA}
          </span>
        </div>
        <textarea
          aria-label="Perfil da marca"
          value={perfil}
          onChange={(e) => setPerfil(e.target.value)}
          disabled={!editavel || !painel || ocupado}
          rows={16}
          placeholder={MODELO}
          className={areaCls}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editavel && (
            <button
              onClick={() => salvar('perfil')}
              disabled={!painel || ocupado || !perfil.trim()}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {salvando === 'perfil' ? 'Salvando…' : 'Salvar o perfil'}
            </button>
          )}
          {editavel && !perfil.trim() && (
            <button
              onClick={() => setPerfil(MODELO)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-brand-dim"
            >
              Começar pelas seções
            </button>
          )}
          {painel?.perfilVersao ? (
            <span className="font-os-mono text-[11px] text-muted">versão {painel.perfilVersao}</span>
          ) : null}
          {painel?.projecoes?.perfil && (
            <span className="font-os-mono text-[11px] text-muted">
              Guia v{painel.projecoes.perfil.fonteVersao} aplicado no perfil v{painel.projecoes.perfil.versaoDestino}
              {painel.projecoes.perfil.atual ? ' · vigente' : ' · substituído por edição posterior'}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
            Os pilares
          </h2>
          <span className="font-os-mono text-[11px] tabular-nums text-muted">
            {painel?.pilares.length ?? 0} / {PAUTA_TETO_DE_PILARES}
          </span>
        </div>
        <textarea
          aria-label="Pilares de conteúdo"
          value={pilares}
          onChange={(e) => setPilares(e.target.value)}
          disabled={!editavel || !painel || ocupado}
          rows={8}
          placeholder={EXEMPLO_DE_PILARES}
          className={areaCls}
        />
        {painel?.pilares.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {painel.pilares.map((p) => (
              <span
                key={p.chave}
                className="rounded px-2 py-0.5 text-xs"
                style={{ backgroundColor: `${p.cor}22`, color: p.cor }}
                title={p.descricao}
              >
                {p.nome}
              </span>
            ))}
          </div>
        ) : null}
        {painel?.projecoes?.pilares && (
          <p className="mt-2 font-os-mono text-[11px] text-muted">
            Guia v{painel.projecoes.pilares.fonteVersao} aplicado nos pilares v{painel.projecoes.pilares.versaoDestino}
            {painel.projecoes.pilares.atual ? ' · vigente' : ' · substituído por edição posterior'}
          </p>
        )}
        {editavel && (
          <div className="mt-3">
            <button
              onClick={() => salvar('pilares')}
              disabled={!painel || ocupado}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {salvando === 'pilares' ? 'Salvando…' : 'Salvar os pilares'}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
          O que os pedidos à IA recebem agora
        </h2>
        {painel?.bloco ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 font-os-mono text-xs text-muted">
            {painel.bloco}
          </pre>
        ) : (
          <p className="text-sm text-muted">
            Nada ainda. Sem marca escrita e sem pilar, os pedidos à IA continuam como eram antes —
            nenhuma linha a mais.
          </p>
        )}
      </section>
    </div>
  );
}
