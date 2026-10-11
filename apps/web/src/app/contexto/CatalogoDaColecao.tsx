'use client';

import { useEffect, useRef, useState } from 'react';
import type { CatalogoDaVersaoDto, M05EscopoDto } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { quando } from './tipos';
import { MovimentoDaColecao, catalogoDoMovimentoConfere, type NotaDoMovimento, type VersaoDoMovimento } from './MovimentoDaColecao';

type Props = {
  notaId: string; versionId: string; versao: number; contentHash: string; escopo: M05EscopoDto;
  atual: NotaDoMovimento; escolhida: VersaoDoMovimento; onIndisponivel: () => void;
  onFonteConferida: (nota: NotaDoMovimento, historico: VersaoDoMovimento[]) => void;
};

export function CatalogoDaColecao(props: Props) {
  const { ready, token, user, can } = useAuth();
  if (!ready) return <p className="text-xs text-muted">Carregando acesso ao catálogo…</p>;
  if (!token || !user || !can('obsidian.ver') || props.escopo.userId !== user.id) return <p className="text-xs text-muted">Catálogo indisponível para esta conta.</p>;
  return <LeituraDoCatalogo key={`${token}:${user.id}:${props.escopo.orgId}:${props.notaId}:${props.versionId}:${props.contentHash}`} {...props} token={token} />;
}

function confere(r: CatalogoDaVersaoDto, p: Props) {
  return p.escolhida.id === p.versionId && p.escolhida.versao === p.versao && p.escolhida.contentHash === p.contentHash
    && p.escolhida.escopo.orgId === p.escopo.orgId && p.escolhida.escopo.userId === p.escopo.userId
    && p.atual.escopo.orgId === p.escopo.orgId && p.atual.escopo.userId === p.escopo.userId
    && catalogoDoMovimentoConfere(r, { notaId: p.notaId, versionId: p.versionId, versao: p.versao,
      contentHash: p.contentHash, escopo: p.escopo, itemId: p.escolhida.retratoFonte.itemId });
}

function LeituraDoCatalogo(props: Props & { token: string }) {
  const { notaId, versionId, token } = props;
  const [dados, setDados] = useState<CatalogoDaVersaoDto | null>(null);
  const [erro, setErro] = useState<string | null>(null), [carregando, setCarregando] = useState(true);
  const [releitura, setReleitura] = useState(0);
  const indisponivel = useRef(props.onIndisponivel); indisponivel.current = props.onIndisponivel;
  useEffect(() => {
    let vigente = true; setDados(null); setErro(null); setCarregando(true);
    apiGet<CatalogoDaVersaoDto>(`/knowledge/colecao/notas/${encodeURIComponent(notaId)}/versoes/${encodeURIComponent(versionId)}`, token)
      .then((r) => {
        if (!vigente) return;
        if (!confere(r, props)) throw Object.assign(new Error('Catálogo indisponível para esta versão.'), { status: 403 });
        setDados(r);
      })
      .catch((e) => {
        if (!vigente) return;
        setDados(null);
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) { setErro('Catálogo indisponível para esta conta ou versão.'); indisponivel.current(); }
        else setErro('Não foi possível consultar o catálogo. Nenhuma captura foi iniciada.');
      })
      .finally(() => { if (vigente) setCarregando(false); });
    return () => { vigente = false; };
  }, [notaId, versionId, token, props.versao, props.contentHash, props.escopo.orgId, props.escopo.userId, releitura]);
  const selecao = dados?.catalogo.selecaoVerificada, captura = dados?.catalogo.ultimaCaptura;
  return <section aria-label="Catálogo de coleção da versão" className="space-y-2 rounded-root border border-border p-3 text-xs">
    <h4 className="font-semibold">Catálogo de coleção</h4>
    <p className="text-muted">Metadados da captura registrada. Esta consulta não relê a fonte externa.</p>
    {carregando && <p role="status">Conferindo a associação da versão…</p>}
    {erro && <div className="space-y-2"><p role="alert" className="text-muted">{erro}</p><button type="button" className="text-brand underline" onClick={() => setReleitura((v) => v + 1)}>Consultar catálogo novamente</button></div>}
    {dados && <>
      {selecao ? <>
        <p className={selecao.atual ? 'text-text' : 'text-warn'}>{selecao.atual ? 'Captura atual da coleção.' : 'Registro histórico da coleção; não é uma captura atual.'} {dados.capturaCorrespondeAVersaoEscolhida ? 'Inclui a versão aberta.' : 'Aponta para outra versão da fonte.'}</p>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">coleção</dt><dd className="break-all">{selecao.colecaoId}</dd>
          <dt className="text-muted">conferida em</dt><dd>{quando(selecao.verificadaEm)}</dd>
          <dt className="text-muted">versão na captura</dt><dd>v{selecao.membro.versao}</dd>
          <dt className="text-muted">chave do membro</dt><dd className="break-all">{selecao.membro.chave}</dd>
        </dl>
        <details><summary className="cursor-pointer text-muted">Conferir associação e geração</summary><dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1"><dt>item associado</dt><dd className="break-all">{dados.associacao.itemId}</dd><dt>versão aberta</dt><dd className="break-all">{dados.versionId}</dd><dt>geração da captura</dt><dd className="break-all">{selecao.geracao}</dd><dt>hash do membro</dt><dd className="break-all">{selecao.membro.contentHash}</dd></dl></details>
      </> : <p className="text-muted">Não há seleção verificada disponível para este item.</p>}
      {captura && <p className={captura.estado === 'falhou' ? 'text-warn' : 'text-muted'}>Última tentativa registrada: {captura.estado === 'falhou' ? 'falhou' : captura.estado === 'classificado' ? 'classificada, ainda sem projeção confirmada' : 'projetada'} · {quando(captura.registradaEm)}.</p>}
      <MovimentoDaColecao notaId={notaId} escopo={props.escopo} atual={props.atual} escolhida={props.escolhida}
        catalogo={dados} onIndisponivel={() => indisponivel.current()} onFonteConferida={props.onFonteConferida}
        onCatalogoConferido={setDados} />
    </>}
  </section>;
}
