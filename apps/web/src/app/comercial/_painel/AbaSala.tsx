'use client';

/*
 * ABA SALA (rodada da implantação I3, 18/10/2026): a bancada da sala publicada
 * por versão.
 *
 * O que o cliente vê no link é a ÚLTIMA versão publicada. Aqui a bancada
 * escreve o rascunho (próximos passos com o quê, quando e com quem; o
 * combinado; quem cuida da conta) e vê, ao lado, o que sai do fio sozinho (as
 * estações e os publicados). "Publicar" pede a liberação de outra pessoa em
 * /atendimento (R3): até ela assinar, o cliente continua na versão anterior.
 *
 * L6 (leva 5, 27/10/2026): a aba diz o que falta e oferece o botão que resolve.
 * Lead sem sala: "criar a sala agora" (o mesmo caminho da reação `sala.abrir`).
 * Sala vencida, revogada ou com cifra que este ambiente não abre: "gerar link
 * novo" (o link antigo deixa de abrir; o novo sai uma vez, para a área de
 * transferência). Sem próximo passo escrito, a aba avisa antes do clique em
 * publicar, em vez de deixar a API recusar.
 */
import { useEffect, useState } from 'react';
import {
  SALA_AJUDA_DO_PAINEL,
  SALA_WHATSAPP_PLACEHOLDER,
  type ConteudoDaSalaPublicada,
  type EstadoDaSalaNoPainel,
  type LinkDaSalaCopiado,
  type PassoDaSalaPublicada,
  type VersoesDaSala,
} from '@mktos/shared';

import { apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { quandoCurtoSP } from '@/lib/cockpit';

import { Aviso, BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, Erro, ErroDaAcao, INPUT, Rotulo, useCarregar } from '../_ui';
import { usePainel } from './provedor';

const ROTULO_DO_ESTADO: Record<VersoesDaSala['rascunho']['estado'], string> = {
  novo: 'ainda sem rascunho gravado',
  rascunho: 'rascunho',
  na_porta: 'esperando a liberação de outra pessoa',
};

export function AbaSala({ leadId, aoMudar }: { leadId: string; aoMudar: () => Promise<void> }) {
  const painel = usePainel();
  const { dados, erro, carregando, recarregar, token } = useCarregar<VersoesDaSala>(`/comercial/lead/${encodeURIComponent(leadId)}/sala/versoes`);
  const [passos, setPassos] = useState<PassoDaSalaPublicada[]>([]);
  const [combinado, setCombinado] = useState<string[]>([]);
  const [quem, setQuem] = useState<{ nome: string; papel: string }>({ nome: '', papel: '' });
  const [nome, setNome] = useState('');
  const [sujo, setSujo] = useState(false);
  const [ocupado, setOcupado] = useState<'salvar' | 'publicar' | null>(null);
  const [erroDaAcao, setErroDaAcao] = useState<unknown>(null);

  // O formulário parte do rascunho de agora sempre que ele chega e ninguém está escrevendo.
  useEffect(() => {
    if (!dados || sujo) return;
    const c = dados.rascunho.conteudo;
    setNome(c.nome);
    setPassos(c.proximosPassos);
    setCombinado(c.combinado);
    setQuem(c.quemCuida ?? { nome: '', papel: '' });
  }, [dados, sujo]);

  if (carregando && !dados) return <Carregando linhas={3} altura="h-24" />;
  if (!dados) return <Erro erro={erro} aoTentar={() => void recarregar()} />;

  const corpo = () => ({
    nome: nome.trim() || undefined,
    proximosPassos: passos.map((p) => ({ oque: p.oque.trim(), quando: p.quando, comQuem: p.comQuem.trim() })),
    combinado: combinado.map((c) => c.trim()).filter(Boolean),
    quemCuida: quem.nome.trim() ? { nome: quem.nome.trim(), papel: quem.papel.trim() } : null,
  });

  async function salvar(): Promise<boolean> {
    setOcupado('salvar');
    setErroDaAcao(null);
    try {
      await apiPut(`/comercial/lead/${encodeURIComponent(leadId)}/sala/rascunho`, corpo(), token);
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
      const r = await apiPost<{ estado: string; approvalId: string | null }>(`/comercial/lead/${encodeURIComponent(leadId)}/sala/publicar`, {}, token);
      painel.avisar(r.approvalId ? 'Pedido de publicação na fila: outra pessoa libera em /atendimento.' : 'Sala publicada.');
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
  const mudar = <T,>(f: (v: T) => void) => (v: T) => { setSujo(true); f(v); };
  const semPasso = passos.filter((p) => p.oque.trim()).length === 0;

  return (
    <div className="space-y-4" data-testid="aba-sala">
      {/* A chave muda quando a versão anda (publicar, pedir liberação): o quadro relê o estado. */}
      <EstadoDaSala
        key={`${r.versao}:${r.estado}:${pub?.versao ?? 0}:${dados.temSala ? 1 : 0}`}
        leadId={leadId}
        temSala={dados.temSala}
        aoMudar={async () => {
          await recarregar();
          await aoMudar();
        }}
      />
      {!dados.temSala && (
        <Aviso tom="ruim">
          Este lead ainda não tem sala, e sem sala não há link para o cliente nem versão para publicar. Use "criar a sala agora" no quadro acima.
        </Aviso>
      )}
      <section className={CARTAO} aria-label="o que o cliente vê agora">
        <Rotulo>no ar para o cliente</Rotulo>
        {pub ? (
          <p className="mt-1 text-[13px]" data-testid="sala-no-ar">
            <Chip tom="bom">versão {pub.versao}</Chip> publicada {quandoCurtoSP(pub.publicadaEm)} · {pub.conteudo.nome}
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-muted" data-testid="sala-no-ar">Nenhuma versão publicada: o cliente vê a sala de antes, sem o quadro de implantação.</p>
        )}
      </section>

      <section className={CARTAO} aria-label="rascunho da próxima versão">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Rotulo>rascunho · versão {r.versao}</Rotulo>
          <Chip tom={r.estado === 'na_porta' ? 'alerta' : 'neutro'}>{ROTULO_DO_ESTADO[r.estado]}</Chip>
        </div>
        {r.estado === 'na_porta' && (
          <p className="mt-2 text-[12.5px] text-muted">
            A versão {r.versao} espera a liberação de outra pessoa em <a className="underline" href="/atendimento">/atendimento</a>. Mudar o rascunho agora devolve a versão a rascunho e o pedido deixa de valer.
          </p>
        )}

        <label className="mt-3 block text-[12px] text-muted" htmlFor="sala-nome">nome da sala</label>
        <input id="sala-nome" className={INPUT} value={nome} maxLength={80} onChange={(e) => mudar(setNome)(e.target.value)} />

        <fieldset className="mt-4">
          <legend className="text-[12px] text-muted">próximos passos · o quê, quando, com quem</legend>
          <ul className="mt-1 space-y-2">
            {passos.map((p, i) => (
              <li key={i} className="grid gap-1.5 md:grid-cols-[minmax(0,1fr)_9.5rem_10rem_auto]">
                <input aria-label={`passo ${i + 1}: o quê`} className={INPUT} value={p.oque} maxLength={140} placeholder="o quê" onChange={(e) => mudar(setPassos)(passos.map((x, j) => (j === i ? { ...x, oque: e.target.value } : x)))} />
                <input aria-label={`passo ${i + 1}: quando`} type="date" className={INPUT} value={p.quando} onChange={(e) => mudar(setPassos)(passos.map((x, j) => (j === i ? { ...x, quando: e.target.value } : x)))} />
                <input aria-label={`passo ${i + 1}: com quem`} className={INPUT} value={p.comQuem} maxLength={60} placeholder="com quem" onChange={(e) => mudar(setPassos)(passos.map((x, j) => (j === i ? { ...x, comQuem: e.target.value } : x)))} />
                <button type="button" className={BOTAO} onClick={() => mudar(setPassos)(passos.filter((_, j) => j !== i))} aria-label={`tirar o passo ${i + 1}`}>tirar</button>
              </li>
            ))}
          </ul>
          {passos.length < 8 && (
            <button type="button" data-testid="sala-passo-novo" className={`mt-2 ${BOTAO}`} onClick={() => mudar(setPassos)([...passos, { oque: '', quando: '', comQuem: '' }])}>
              acrescentar passo
            </button>
          )}
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-[12px] text-muted">o combinado</legend>
          <ul className="mt-1 space-y-1.5">
            {combinado.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <input aria-label={`combinado ${i + 1}`} className={INPUT} value={c} maxLength={160} onChange={(e) => mudar(setCombinado)(combinado.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" className={BOTAO} onClick={() => mudar(setCombinado)(combinado.filter((_, j) => j !== i))} aria-label={`tirar o combinado ${i + 1}`}>tirar</button>
              </li>
            ))}
          </ul>
          {combinado.length < 6 && (
            <button type="button" className={`mt-2 ${BOTAO}`} onClick={() => mudar(setCombinado)([...combinado, ''])}>acrescentar linha</button>
          )}
        </fieldset>

        <fieldset className="mt-4 grid gap-1.5 md:grid-cols-2">
          <legend className="text-[12px] text-muted">quem cuida da conta</legend>
          <input aria-label="nome de quem cuida da conta" className={INPUT} value={quem.nome} maxLength={80} placeholder="nome" onChange={(e) => mudar(setQuem)({ ...quem, nome: e.target.value })} />
          <input aria-label="papel de quem cuida da conta" className={INPUT} value={quem.papel} maxLength={80} placeholder="papel" onChange={(e) => mudar(setQuem)({ ...quem, papel: e.target.value })} />
        </fieldset>

        <p className="mt-3 text-[12px] text-muted">
          WhatsApp na sala: {SALA_WHATSAPP_PLACEHOLDER} na versão; o número que o cliente vê vem da nota da memória <span className="font-os-mono">comercial.whatsapp.numero</span> (primeira linha, só dígitos com o 55), sem republicar.
        </p>

        {dados.temSala && semPasso && (
          <p className="mt-3 text-[12.5px] text-muted" data-testid="sala-falta-passo" role="status">
            Para publicar a primeira versão, escreva ao menos um próximo passo (o quê, quando e com quem) em "acrescentar passo".
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" data-testid="sala-salvar" className={BOTAO} disabled={!!ocupado || !sujo} onClick={() => void salvar()}>
            {ocupado === 'salvar' ? 'gravando…' : 'gravar rascunho'}
          </button>
          <button
            type="button"
            data-testid="sala-publicar"
            className={BOTAO_PRIMARIO}
            disabled={!!ocupado || !dados.temSala || semPasso}
            title={!dados.temSala ? 'Crie a sala antes de publicar.' : semPasso ? 'Escreva ao menos um próximo passo antes de publicar.' : undefined}
            onClick={() => void publicar()}
          >
            {ocupado === 'publicar' ? 'pedindo…' : pub ? `publicar a versão ${r.versao}` : `publicar a primeira versão (${r.versao})`}
          </button>
          {sujo && <span className="text-[12px] text-muted">há mudança não gravada</span>}
        </div>
        <ErroDaAcao erro={erroDaAcao} />
      </section>

      <PreviaDerivada c={r.conteudo} />

      {dados.historico.length > 0 && (
        <section className={CARTAO} aria-label="versões publicadas">
          <Rotulo>versões</Rotulo>
          <ul className="mt-2 space-y-1 text-[12.5px]">
            {dados.historico.map((h) => (
              <li key={h.versao} className="flex flex-wrap gap-2">
                <span className="font-os-mono">v{h.versao}</span>
                <span className="text-muted">{h.estado === 'publicada' ? 'no ar' : 'substituída'}{h.publicadaEm ? ` · ${quandoCurtoSP(h.publicadaEm)}` : ''}</span>
                <span className="font-os-mono text-[10.5px] text-dim">{h.hash.slice(0, 12)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Erro erro={erro} aoTentar={() => void recarregar()} />
    </div>
  );
}

/**
 * QUANDO A SALA ENTRA (rodada de produção 1, P9): a linha do tempo real da
 * sala deste lead, lida do que está gravado. "Copiar link da sala" só aparece
 * para quem tem `leads.editar`; o link sai da API só nessa resposta, vai para a
 * área de transferência e não fica guardado na tela.
 *
 * L6: com `leads.editar`, o quadro oferece também "criar a sala agora" (sem
 * sala) e "gerar link novo" (sala com link que não abre). Os dois recarregam a
 * linha do tempo e avisam a bancada (`aoMudar`), que relê as versões.
 */
function EstadoDaSala({ leadId, temSala, aoMudar }: { leadId: string; temSala: boolean; aoMudar: () => Promise<void> }) {
  const { can } = useAuth();
  const { dados, erro, token, recarregar } = useCarregar<EstadoDaSalaNoPainel>(`/comercial/lead/${encodeURIComponent(leadId)}/sala/estado`);
  const [ocupado, setOcupado] = useState<'copiar' | 'criar' | 'renovar' | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const [erroDaCopia, setErroDaCopia] = useState<unknown>(null);
  const podeCopiar = can('leads.editar');
  const base = `/comercial/lead/${encodeURIComponent(leadId)}/sala`;

  /** O link que a API devolveu uma vez vai à área de transferência; sem ela, aparece para copiar à mão. */
  async function entregarLink(r: LinkDaSalaCopiado, frase: string) {
    try {
      await navigator.clipboard.writeText(r.link);
      setCopiado(`${frase} Ele vale até ${quandoCurtoSP(r.validaAte)}.`);
    } catch {
      // Sem área de transferência (navegador sem permissão): o link aparece para copiar à mão.
      setManual(r.link);
    }
  }

  async function copiar() {
    setOcupado('copiar');
    setErroDaCopia(null);
    setCopiado(null);
    setManual(null);
    try {
      await entregarLink(await apiPost<LinkDaSalaCopiado>(`${base}/link`, {}, token), 'Link copiado.');
    } catch (e) {
      setErroDaCopia(e);
    } finally {
      setOcupado(null);
    }
  }

  async function criar() {
    setOcupado('criar');
    setErroDaCopia(null);
    setCopiado(null);
    try {
      await apiPost<EstadoDaSalaNoPainel>(base, {}, token);
      await recarregar();
      await aoMudar();
      setCopiado('Sala criada. Copie o link e mande ao cliente; a primeira versão pode ser publicada agora.');
    } catch (e) {
      setErroDaCopia(e);
    } finally {
      setOcupado(null);
    }
  }

  async function renovar() {
    if (!window.confirm('Gerar um link novo? O link antigo, se o cliente o tiver, deixa de abrir. Nada mais muda na sala.')) return;
    setOcupado('renovar');
    setErroDaCopia(null);
    setCopiado(null);
    setManual(null);
    try {
      const r = await apiPost<LinkDaSalaCopiado>(`${base}/renovar`, {}, token);
      await recarregar();
      await aoMudar();
      await entregarLink(r, 'Link novo copiado. Mande ao cliente.');
    } catch (e) {
      setErroDaCopia(e);
    } finally {
      setOcupado(null);
    }
  }

  const linkNaoAbre = Boolean(dados && dados.temSala && !dados.linkDisponivel);

  return (
    <section className={CARTAO} aria-label="estado da sala" data-testid="sala-estado">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Rotulo>quando a sala entra</Rotulo>
        <div className="flex flex-wrap gap-2">
          {podeCopiar && dados && !dados.temSala && (
            <button type="button" data-testid="sala-criar" className={BOTAO_PRIMARIO} disabled={!!ocupado} onClick={() => void criar()}>
              {ocupado === 'criar' ? 'criando…' : 'criar a sala agora'}
            </button>
          )}
          {podeCopiar && dados?.linkDisponivel && (
            <button type="button" data-testid="sala-copiar-link" className={BOTAO} disabled={!!ocupado} onClick={() => void copiar()}>
              {ocupado === 'copiar' ? 'copiando…' : 'Copiar link da sala'}
            </button>
          )}
          {podeCopiar && linkNaoAbre && (
            <button type="button" data-testid="sala-renovar-link" className={BOTAO} disabled={!!ocupado} onClick={() => void renovar()}>
              {ocupado === 'renovar' ? 'gerando…' : 'gerar link novo'}
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-[12.5px] text-muted" data-testid="sala-ajuda">{SALA_AJUDA_DO_PAINEL}</p>
      {!podeCopiar && temSala && (
        <p className="mt-1 text-[12px] text-dim">Copiar o link, criar a sala e gerar link novo pedem a permissão de editar leads.</p>
      )}
      {!dados && !erro && <p className="mt-2 text-[12.5px] text-dim">carregando…</p>}
      {dados && (
        <ol className="mt-3 space-y-2" data-testid="sala-marcos">
          {dados.marcos.map((m) => (
            <li key={m.tipo} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px]" data-testid={`sala-marco-${m.tipo}`}>
              <Chip tom={m.tom}>{m.rotulo}</Chip>
              {m.em && <span className="font-os-mono text-[11px] text-dim">{quandoCurtoSP(m.em)}</span>}
              <span className="text-muted">{m.detalhe}</span>
              {m.link && (
                <a className="underline" href={m.link}>
                  abrir Aprovações
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
      {copiado && <p className="mt-2 text-[12.5px] text-good" role="status">{copiado}</p>}
      {manual && (
        <label className="mt-2 block text-[12px] text-muted">
          Copie o link à mão:
          <input className={INPUT} readOnly value={manual} onFocus={(e) => e.currentTarget.select()} data-testid="sala-link-manual" />
        </label>
      )}
      <ErroDaAcao erro={erroDaCopia} />
      <Erro erro={erro} aoTentar={() => void recarregar()} />
    </section>
  );
}

/** O que sai do fio sozinho: as estações e os publicados, como entrariam na versão agora. */
function PreviaDerivada({ c }: { c: ConteudoDaSalaPublicada }) {
  return (
    <section className={CARTAO} aria-label="o que sai do fio">
      <Rotulo>vem do fio · não se digita</Rotulo>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {c.estacoes.map((e) => (
          <li key={e.chave}>
            <Chip tom={e.estado === 'feita' ? 'bom' : e.estado === 'atual' ? 'brand' : 'neutro'}>
              {e.rotulo}{e.em ? ` · ${quandoCurtoSP(e.em)}` : ''}{e.estado === 'atual' ? ' · agora' : ''}
            </Chip>
          </li>
        ))}
      </ol>
      <ul className="mt-2 space-y-0.5 text-[12.5px]">
        {c.publicados.map((p) => (
          <li key={p.tipo} className={p.disponivel ? '' : 'text-dim'}>{p.titulo} · {p.estado}</li>
        ))}
      </ul>
    </section>
  );
}
