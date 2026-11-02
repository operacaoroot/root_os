'use client';

/*
 * ABA "ÁREA DO CLIENTE" (leva A, 30/10/2026): a bancada dos quinze itens.
 *
 * A área do cliente é a sala depois do fechamento: o mesmo link `/s/<token>`
 * passa a mostrar os quatro blocos. Esta aba diz, item a item, o que já está
 * no ar (publicado pela Root ou montado pelo OS), o que está em rascunho ou na
 * porta, o que o cliente já abriu ("lido em", que ele não vê) e o que ainda
 * falta, com a fase do fluxo em que chega e a tarefa que o alimenta. Escrever
 * e publicar é por item: "publicar" pede a liberação de outra pessoa em
 * /atendimento (R3, a mesma capacidade da sala). Item derivado não se edita.
 */
import { useEffect, useState } from 'react';
import {
  AREA_AJUDA_DA_BANCADA,
  AREA_BLOCOS,
  AREA_ROTULO_DO_BLOCO,
  AREA_ROTULO_DO_ESTADO,
  type AreaDoClienteNaBancada,
  type AreaEstadoDoItem,
  type AreaItemId,
  type AreaItemRascunhoInput,
  type ItemDaAreaNaBancada,
  type VersoesDoItemDaArea,
} from '@mktos/shared';

import { apiPost, apiPut } from '@/lib/api';
import { quandoCurtoSP } from '@/lib/cockpit';

import { Aviso, BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, Erro, ErroDaAcao, INPUT, Rotulo, useCarregar } from '../_ui';
import { usePainel } from './provedor';

const TOM_DO_ESTADO: Record<AreaEstadoDoItem, 'neutro' | 'brand' | 'bom' | 'alerta' | 'ruim' | 'info'> = {
  vazio: 'neutro',
  derivado: 'info',
  rascunho: 'neutro',
  na_porta: 'alerta',
  publicado: 'brand',
  lido: 'bom',
};

export function AbaAreaDoCliente({ leadId, aoMudar }: { leadId: string; aoMudar: () => Promise<void> }) {
  const { dados, erro, carregando, recarregar } = useCarregar<AreaDoClienteNaBancada>(`/comercial/lead/${encodeURIComponent(leadId)}/area`);
  const [aberto, setAberto] = useState<AreaItemId | null>(null);

  if (carregando && !dados) return <Carregando linhas={4} altura="h-20" />;
  if (!dados) return <Erro erro={erro} aoTentar={() => void recarregar()} />;

  const mudou = async () => {
    await recarregar();
    await aoMudar();
  };

  return (
    <div className="space-y-4" data-testid="aba-area-do-cliente">
      <section className={CARTAO} aria-label="a área do cliente">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Rotulo>área do cliente</Rotulo>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tom={dados.modo === 'area' ? 'bom' : 'neutro'} title={dados.modo === 'area' ? 'O link do cliente já abre a área.' : 'O link ainda abre a sala de sempre; a área abre quando o negócio fechar ou o card da implantação existir.'}>
              {dados.modo === 'area' ? 'no link do cliente' : 'ainda em modo sala'}
            </Chip>
            <Chip tom={dados.noAr ? 'brand' : 'neutro'} title="Itens que o cliente já vê (publicados pela Root ou montados pelo OS), de quinze.">
              <span data-testid="area-no-ar">{dados.noAr}/{dados.total}</span> no ar
            </Chip>
          </div>
        </div>
        <p className="mt-1 text-[12.5px] text-muted">{AREA_AJUDA_DA_BANCADA}</p>
        {!dados.temSala && (
          <Aviso tom="ruim">Este lead ainda não tem sala, e a área mora na sala. Crie a sala na aba Sala antes de publicar um item.</Aviso>
        )}
      </section>

      {AREA_BLOCOS.map((bloco) => {
        const itens = dados.itens.filter((i) => i.bloco === bloco);
        return (
          <section key={bloco} className={CARTAO} aria-label={AREA_ROTULO_DO_BLOCO[bloco].nome} data-testid={`area-bancada-bloco-${bloco}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Rotulo>{AREA_ROTULO_DO_BLOCO[bloco].nome}</Rotulo>
              <span className="font-os-mono text-[10.5px] text-dim">
                {itens.filter((i) => i.estado === 'publicado' || i.estado === 'lido' || i.estado === 'derivado').length}/{itens.length} no ar
              </span>
            </div>
            <ul className="mt-2 divide-y divide-border">
              {itens.map((i) => (
                <li key={i.id} className="py-2" data-testid={`area-bancada-item-${i.id}`} data-estado={i.estado}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold">{i.titulo}</span>
                        <Chip tom={TOM_DO_ESTADO[i.estado]}>{AREA_ROTULO_DO_ESTADO[i.estado]}</Chip>
                        {i.publicada && <span className="font-os-mono text-[10.5px] text-muted">{i.publicada.edicao}ª edição · v{i.publicada.versao} · {quandoCurtoSP(i.publicada.publicadaEm)}</span>}
                        {i.lidoEm && <span className="font-os-mono text-[10.5px] text-good">lido {quandoCurtoSP(i.lidoEm)}</span>}
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted">{i.nota}</p>
                      <p className="mt-0.5 text-[11.5px] text-dim">
                        fase {i.entraNaFase.numero} · {i.entraNaFase.nome}
                        {i.tarefaDoFluxo ? ` · tarefa ${i.tarefaDoFluxo}` : ' · sem tarefa no fluxo v6 (decisão D5)'}
                        {i.fonte ? ` · ${i.fonte}` : ''}
                      </p>
                    </div>
                    {i.acao !== 'nada' && dados.temSala && (
                      <button
                        type="button"
                        className={i.acao === 'publicar' ? BOTAO_PRIMARIO : BOTAO}
                        aria-expanded={aberto === i.id}
                        onClick={() => setAberto(aberto === i.id ? null : i.id)}
                        data-testid={`area-bancada-acao-${i.id}`}
                      >
                        {aberto === i.id ? 'fechar' : i.acao === 'publicar' ? 'revisar e publicar' : i.publicada ? 'escrever a próxima edição' : 'escrever'}
                      </button>
                    )}
                    {i.acao === 'nada' && i.aberta?.estado === 'na_porta' && (
                      <a className={`${BOTAO}`} href="/atendimento">abrir Aprovações</a>
                    )}
                  </div>
                  {aberto === i.id && <EditorDoItem leadId={leadId} item={i} aoMudar={mudou} />}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <Erro erro={erro} aoTentar={() => void recarregar()} />
    </div>
  );
}

const ROTULO_DO_RASCUNHO: Record<VersoesDoItemDaArea['rascunho']['estado'], string> = {
  novo: 'ainda sem rascunho gravado',
  rascunho: 'rascunho',
  na_porta: 'esperando a liberação de outra pessoa',
};

const vazio = (): Required<Pick<AreaItemRascunhoInput, 'resumo' | 'texto' | 'topicos' | 'oQueMudou'>> & { quando: string } => ({ resumo: '', texto: '', topicos: [], quando: '', oQueMudou: '' });

/** O editor de UM item: o rascunho (resumo, texto, tópicos, data, o que mudou), gravar e publicar, e o histórico. */
function EditorDoItem({ leadId, item, aoMudar }: { leadId: string; item: ItemDaAreaNaBancada; aoMudar: () => Promise<void> }) {
  const painel = usePainel();
  const caminho = `/comercial/lead/${encodeURIComponent(leadId)}/area/${encodeURIComponent(item.id)}`;
  const { dados, erro, carregando, recarregar, token } = useCarregar<VersoesDoItemDaArea>(`${caminho}/versoes`);
  const [f, setF] = useState(vazio());
  const [sujo, setSujo] = useState(false);
  const [ocupado, setOcupado] = useState<'salvar' | 'publicar' | null>(null);
  const [erroDaAcao, setErroDaAcao] = useState<unknown>(null);

  useEffect(() => {
    if (!dados || sujo) return;
    const e = dados.rascunho.escrito;
    setF({ resumo: e?.resumo ?? '', texto: e?.texto ?? '', topicos: e?.topicos ?? [], quando: e?.quando ?? '', oQueMudou: e?.oQueMudou ?? '' });
  }, [dados, sujo]);

  if (carregando && !dados) return <Carregando linhas={2} altura="h-16" />;
  if (!dados) return <Erro erro={erro} aoTentar={() => void recarregar()} />;

  const corpo = (): AreaItemRascunhoInput => ({
    ...(f.resumo.trim() ? { resumo: f.resumo.trim() } : {}),
    ...(f.texto.trim() ? { texto: f.texto.trim() } : {}),
    ...(f.topicos.map((t) => t.trim()).filter(Boolean).length ? { topicos: f.topicos.map((t) => t.trim()).filter(Boolean) } : {}),
    ...(f.quando ? { quando: f.quando } : {}),
    ...(f.oQueMudou.trim() ? { oQueMudou: f.oQueMudou.trim() } : {}),
  });
  const temAlgo = Boolean(f.resumo.trim() || f.texto.trim() || f.topicos.some((t) => t.trim()));
  const mudar = <K extends keyof ReturnType<typeof vazio>>(k: K) => (v: ReturnType<typeof vazio>[K]) => {
    setSujo(true);
    setF((x) => ({ ...x, [k]: v }));
  };

  async function salvar(): Promise<boolean> {
    setOcupado('salvar');
    setErroDaAcao(null);
    try {
      await apiPut(`${caminho}/rascunho`, corpo(), token);
      setSujo(false);
      await recarregar();
      return true;
    } catch (e) {
      setErroDaAcao(e);
      return false;
    } finally {
      setOcupado(null);
    }
  }

  async function publicar() {
    if (sujo && !(await salvar())) return;
    setOcupado('publicar');
    setErroDaAcao(null);
    try {
      const r = await apiPost<{ estado: string; approvalId: string | null }>(`${caminho}/publicar`, {}, token);
      painel.avisar(r.approvalId ? `"${item.titulo}" na fila: outra pessoa libera em /atendimento.` : `"${item.titulo}" publicado na área do cliente.`);
      await recarregar();
      await aoMudar();
    } catch (e) {
      setErroDaAcao(e);
    } finally {
      setOcupado(null);
    }
  }

  const r = dados.rascunho;
  const pub = dados.publicada;
  return (
    <div className="mt-3 space-y-3 rounded border border-border bg-bg p-3" data-testid={`area-editor-${item.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-muted">
          {pub ? `no ar: ${pub.edicao}ª edição (v${pub.versao}), ${quandoCurtoSP(pub.publicadaEm)}` : 'nada no ar ainda'}
        </span>
        <Chip tom={r.estado === 'na_porta' ? 'alerta' : 'neutro'}>{ROTULO_DO_RASCUNHO[r.estado]} · v{r.versao}</Chip>
      </div>
      {r.estado === 'na_porta' && (
        <p className="text-[12.5px] text-muted">
          A versão {r.versao} espera a liberação de outra pessoa em <a className="underline" href="/atendimento">/atendimento</a>. Mudar o rascunho agora devolve a versão a rascunho e o pedido deixa de valer.
        </p>
      )}

      <label className="block text-[12px] text-muted">
        resumo · a linha que o cliente vê no slot
        <input className={`${INPUT} mt-1`} value={f.resumo} maxLength={400} onChange={(e) => mudar('resumo')(e.target.value)} placeholder="ex.: Ata da reunião de abertura: três combinados e dois próximos passos" />
      </label>
      <label className="block text-[12px] text-muted">
        texto
        <textarea className={`${INPUT} mt-1`} rows={5} value={f.texto} maxLength={4000} onChange={(e) => mudar('texto')(e.target.value)} />
      </label>
      <fieldset>
        <legend className="text-[12px] text-muted">tópicos · combinados, passos, entradas</legend>
        <ul className="mt-1 space-y-1.5">
          {f.topicos.map((t, i) => (
            <li key={i} className="flex gap-1.5">
              <input aria-label={`tópico ${i + 1}`} className={INPUT} value={t} maxLength={200} onChange={(e) => mudar('topicos')(f.topicos.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" className={BOTAO} onClick={() => mudar('topicos')(f.topicos.filter((_, j) => j !== i))} aria-label={`tirar o tópico ${i + 1}`}>tirar</button>
            </li>
          ))}
        </ul>
        {f.topicos.length < 20 && (
          <button type="button" className={`mt-2 ${BOTAO}`} onClick={() => mudar('topicos')([...f.topicos, ''])}>acrescentar tópico</button>
        )}
      </fieldset>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="block text-[12px] text-muted">
          data a que o item se refere
          <input type="date" className={`${INPUT} mt-1`} value={f.quando} onChange={(e) => mudar('quando')(e.target.value)} />
        </label>
        <label className="block text-[12px] text-muted">
          o que mudou nesta edição
          <input className={`${INPUT} mt-1`} value={f.oQueMudou} maxLength={300} onChange={(e) => mudar('oQueMudou')(e.target.value)} placeholder="só na segunda edição em diante" />
        </label>
      </div>
      <p className="text-[11.5px] text-dim">Link em claro não entra: anexe o documento ao cliente e a próxima leva o referencia pelo id. O texto segue a escrita da Root.</p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid={`area-item-salvar-${item.id}`} className={BOTAO} disabled={!!ocupado || !sujo || !temAlgo} onClick={() => void salvar()}>
          {ocupado === 'salvar' ? 'gravando…' : 'gravar rascunho'}
        </button>
        <button
          type="button"
          data-testid={`area-item-publicar-${item.id}`}
          className={BOTAO_PRIMARIO}
          disabled={!!ocupado || !dados.temSala || !temAlgo}
          title={!dados.temSala ? 'Crie a sala antes de publicar.' : !temAlgo ? 'Escreva ao menos o resumo antes de publicar.' : undefined}
          onClick={() => void publicar()}
        >
          {ocupado === 'publicar' ? 'pedindo…' : pub ? `publicar a ${pub.edicao + 1}ª edição` : 'publicar a primeira edição'}
        </button>
        {sujo && <span className="text-[12px] text-muted">há mudança não gravada</span>}
      </div>
      <ErroDaAcao erro={erroDaAcao} />

      {dados.historico.length > 0 && (
        <ul className="space-y-0.5 text-[12px]" aria-label="edições">
          {dados.historico.map((h) => (
            <li key={h.versao} className="flex flex-wrap gap-2">
              <span className="font-os-mono">{h.edicao}ª · v{h.versao}</span>
              <span className="text-muted">{h.estado === 'publicada' ? 'no ar' : 'substituída'}{h.publicadaEm ? ` · ${quandoCurtoSP(h.publicadaEm)}` : ''}</span>
              <span className="font-os-mono text-[10.5px] text-dim">{h.hash.slice(0, 12)}</span>
            </li>
          ))}
        </ul>
      )}
      <Erro erro={erro} aoTentar={() => void recarregar()} />
    </div>
  );
}
