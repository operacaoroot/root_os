'use client';

import { useEffect, useState } from 'react';
import { PAUTA_FONTE_ROTULOS, type PautaFonteList } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';
import { useModulos } from '@/components/modulos';

const linkCls = 'inline-flex min-h-11 items-center underline underline-offset-4 text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

export function InsumosDaColeta() {
  const { token, ready, can } = useAuth();
  const { modulos } = useModulos();
  // `ligado()` admite módulo desconhecido; esta leitura exige confirmação.
  if (!ready || !token || !can('pauta.ver')) return null;
  if (modulos === null) return <p className="text-sm text-muted">Fontes de conteúdo: módulo ainda não conferido.</p>;
  if (!modulos.includes('pauta')) return null;
  return <PainelDeInsumos key={token} token={token} podeEditarPauta={can('pauta.editar')}
    podeVerTrabalho={can('tarefas.ver') && modulos.includes('trabalho')}
    podeVerContexto={can('obsidian.ver')} />;
}

function PainelDeInsumos({ token, podeEditarPauta, podeVerTrabalho, podeVerContexto }: {
  token: string; podeEditarPauta: boolean; podeVerTrabalho: boolean; podeVerContexto: boolean;
}) {
  const [dados, setDados] = useState<PautaFonteList | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let vivo = true;
    setErro(null);
    setDados(null);
    apiGet<PautaFonteList>('/pauta/fontes', token)
      .then((resposta) => { if (vivo) setDados(resposta); })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [token, tentativa]);

  return <section aria-labelledby="insumos-titulo" className="rounded-root border border-brand/30 bg-surface p-4 sm:p-5">
    <h2 id="insumos-titulo" className="font-semibold">Entradas da coleta de conteúdo</h2>
    <p className="mt-2 max-w-3xl text-sm text-muted">
      Veja as fontes no Radar e confira o resultado em Pauta. O estado ativo não confirma a conexão.
      Feeds, buscas, perfis e Gmail usam coletores; os links do WhatsApp dependem do recebimento pelo grupo conectado.
    </p>
    <ol className="mt-3 grid gap-3 text-sm lg:grid-cols-3">
      <li className="rounded-lg border border-border p-3"><a className={linkCls} href="/referencias#radar">{podeEditarPauta ? '1. Configurar fontes no Radar' : '1. Consultar fontes no Radar'}</a>
        <p className="text-muted">Feeds, buscas, perfis e newsletters. Cada fonte mantém suas capturas e o último erro registrado.</p></li>
      <li className="rounded-lg border border-border p-3"><a className={linkCls} href="/referencias#captura">{podeEditarPauta ? '2. Enviar material em Captura' : '2. Consultar capturas'}</a>
        <p className="text-muted">Links, textos e imagens entram como referências. O envio manual não inclui o material automaticamente na rodada.</p></li>
      <li className="rounded-lg border border-border p-3"><a className={linkCls} href="/pauta">3. Conferir a rodada em Pauta</a>
        <p className="text-muted">Revise os itens coletados antes de produzir. Coleta, aprovação e publicação são etapas distintas.</p></li>
    </ol>

    <div className="mt-4" aria-live="polite">
      {!dados && !erro && <p className="text-sm text-muted">Consultando fontes cadastradas…</p>}
      {erro && <div className="rounded-lg border border-warn/40 p-3 text-sm">
        <p>Não foi possível conferir as fontes. As rotinas e seu histórico continuam disponíveis abaixo.</p>
        <p className="mt-1 break-words text-muted">{erro}</p>
        <button className={`${linkCls} mt-1`} onClick={() => setTentativa((n) => n + 1)}>Tentar novamente</button>
      </div>}
      {dados && <>
        <p className="text-sm font-medium">{dados.items.filter((f) => f.ativo).length} de {dados.items.length} fontes ativas</p>
        <p className="mt-1 text-sm text-muted">{dados.apifyConfigurado
          ? 'Apify tem configuração cadastrada; a validade da conexão não foi testada nesta consulta.'
          : 'Apify não configurado: buscas e perfis dependem dessa configuração para a coleta.'}</p>
        {dados.items.length === 0 ? <p className="mt-3 text-sm">Nenhuma fonte cadastrada. Comece pelo Radar.</p> :
          <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">Ver fontes e últimas leituras</summary>
          <ul className="mt-2 grid gap-3 xl:grid-cols-2">
            {dados.items.map((fonte) => <li key={fonte.id} className="min-w-0 rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-medium">{fonte.nome}</h3>
                <span className="rounded border border-border px-2 py-0.5 text-xs">{fonte.ativo ? 'Ativa' : 'Pausada'}</span>
              </div>
              <p className="mt-1 text-muted">{PAUTA_FONTE_ROTULOS[fonte.tipo]}</p>
              <dl className="mt-2 space-y-1">
                <div><dt className="inline text-muted">Última leitura registrada: </dt><dd className="inline">{fonte.ultimaLeitura
                  ? new Date(fonte.ultimaLeitura).toLocaleString('pt-BR') : 'sem leitura registrada'}</dd></div>
                <div><dt className="inline text-muted">Capturas registradas: </dt><dd className="inline">{fonte.capturas}</dd></div>
              </dl>
              {fonte.ultimoErro ? <p className="mt-2 break-words text-warn">Último erro ou aviso: {fonte.ultimoErro}</p> :
                <p className="mt-2 text-muted">{fonte.ultimaLeitura ? 'Nenhum erro ou aviso registrado.' : 'Resultado da coleta ainda não conferido.'}</p>}
              {fonte.tipo === 'gmail' && <p className="mt-2 break-words text-muted">
                Gmail: {fonte.handle ? `etiqueta cadastrada “${fonte.handle}”.` : 'etiqueta não informada.'} Conta e acesso à etiqueta não conferidos aqui.
              </p>}
              {fonte.tipo === 'manual' && <p className="mt-2 text-muted">Recebimento manual; a conexão do grupo não é conferida nesta tela.</p>}
            </li>)}
          </ul></details>}
      </>}
    </div>
    <p className="mt-4 text-sm text-muted">Roteiros e materiais autorais prontos continuam no card de Trabalho. O guia de marca fica no conhecimento da empresa.</p>
    <div className="mt-1 flex flex-wrap gap-x-5 text-sm">
      {podeVerTrabalho && <a className={linkCls} href="/trabalho?lista=901328341450">Continuar a produção editorial</a>}
      {podeVerContexto && <a className={linkCls} href="/contexto">Consultar conhecimento da empresa</a>}
    </div>
  </section>;
}
