'use client';

/*
 * EMITIR (Contratos, F2, 02/11/2026): a seção da ficha que leva a minuta até o pedido de aprovação. Só existe antes do
 * envio (`c.emissao`); depois de ir para assinatura, o que vale é a faixa de ação.
 *
 * Passos do mockup: qual contrato, dados que entram no molde, quem assina, laudo. Ao lado, a minuta e a prévia do PDF
 * (`previa.pdf`, sempre o de agora). "Pedir aprovação e enviar" fica travado com a lista de `faltaParaEnviar`, que é da
 * API: a tela não refaz a conta. Enviar é R4: a resposta retida diz que outra pessoa titular confirma com a senha, e
 * nada aqui dá sucesso, porque nada saiu ainda.
 */
import { useEffect, useRef, useState } from 'react';
import { MODALIDADES_DE_CONTRATO, ROTULO_DA_MODALIDADE, type CampoDaEmissao, type ContratoEditarInput, type ContratoNaFicha, type EmissaoNaFicha, type ModalidadeDeContrato } from '@mktos/shared';

import { apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { quandoCurtoSP } from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, Chip, ErroDaAcao, FOCO, INPUT, ROTULO, Rotulo } from '../_ui';
import { LaudoDaMinuta, TextoDaMinuta } from '../_painel/MinutaDoContrato';
import { FaixaRetida, RetornoDaAcao, abrirPdfDaApi, useAcaoDoContrato } from './acao';
import { SignatariosDoContrato } from './SignatariosDoContrato';
import { CAMINHO_DO_REGISTRO, FRASE_RETIDA_DO_ENVIO, type PassoDoContrato } from './regras';

const DICA_DA_MODALIDADE: Record<ModalidadeDeContrato, string> = {
  implantacao: 'entregas com prazo, depois acompanhamento',
  continuidade: 'consultoria com encontros por meses',
};

const ROTULO_DA_BASE = { molde: 'molde versionado', drive: 'modelo do Drive', texto_simples: 'texto simples, a ser revisado' } as const;

function Passo({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className={`${CARTAO} space-y-2`} aria-label={titulo}>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded border border-border font-os-mono text-[11px] text-muted">{n}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

export function EmitirContrato({ c, passo, assinaturaConfigurada, podeEditar, aoMudar }: {
  c: ContratoNaFicha;
  passo: PassoDoContrato | null;
  assinaturaConfigurada: boolean;
  podeEditar: boolean;
  aoMudar: () => Promise<void>;
}) {
  const ancora = useRef<HTMLElement>(null);
  const pedido = passo === 'minuta' || passo === 'envio';
  useEffect(() => {
    if (pedido) ancora.current?.scrollIntoView?.({ block: 'start' });
  }, [pedido]);
  const e = c.emissao;
  if (!e) return null;
  const n = c.tipo === 'contrato' ? 1 : 0;
  return (
    <section ref={ancora} aria-label="emitir o contrato" data-testid="contrato-emitir" data-passo={passo ?? undefined} className={`space-y-3 rounded ${pedido ? 'outline outline-1 outline-offset-4 outline-brand' : ''}`}>
      <Rotulo>emitir</Rotulo>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          {c.tipo === 'contrato' && <QualContrato c={c} e={e} podeEditar={podeEditar} aoMudar={aoMudar} />}
          <DadosDoMolde n={n + 1} c={c} e={e} podeEditar={podeEditar} aoMudar={aoMudar} />
          <SignatariosDoContrato c={c} passo={n + 2} podeEditar={podeEditar} aoMudar={aoMudar} />
          <LaudoDoRevisor n={n + 3} c={c} e={e} podeEditar={podeEditar} aoMudar={aoMudar} />
        </div>
        <Previa c={c} e={e} />
      </div>
      <PedirAprovacao c={c} e={e} assinaturaConfigurada={assinaturaConfigurada} podeEditar={podeEditar} aoMudar={aoMudar} />
    </section>
  );
}

function QualContrato({ c, e, podeEditar, aoMudar }: { c: ContratoNaFicha; e: EmissaoNaFicha; podeEditar: boolean; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const acao = useAcaoDoContrato(aoMudar);
  const escolher = (m: ModalidadeDeContrato) => {
    if (m !== c.modalidade) void acao.rodar('modalidade', () => apiPatch(`${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}`, { modalidade: m }, token));
  };
  return (
    <Passo n={1} titulo="Qual contrato">
      <div role="group" aria-label="Modalidade" className="grid gap-2 sm:grid-cols-2">
        {MODALIDADES_DE_CONTRATO.map((m) => (
          <button key={m} type="button" data-testid={`emitir-modalidade-${m}`} aria-pressed={c.modalidade === m} disabled={!podeEditar || acao.ocupado !== null} onClick={() => escolher(m)} className={`rounded border p-2 text-left text-[12.5px] disabled:cursor-not-allowed max-md:min-h-[44px] ${c.modalidade === m ? 'border-brand' : 'border-border hover:border-brand/70'} ${FOCO}`}>
            <strong className="block font-semibold">{ROTULO_DA_MODALIDADE[m]}</strong>
            <span className="text-[11.5px] text-muted">{DICA_DA_MODALIDADE[m]}</span>
          </button>
        ))}
      </div>
      {e.molde && <p className="text-[11.5px] text-dim">Usa o molde versionado de {e.molde.data.split('-').reverse().join('/')}.</p>}
      <RetornoDaAcao acao={acao} />
    </Passo>
  );
}

/** O valor na caixa de texto. Lista é uma linha por item; salvar vira lista de novo. */
const textoDoCampo = (c: CampoDaEmissao): string => (Array.isArray(c.valor) ? c.valor.join('\n') : c.valor ?? '');

function valorParaSalvar(c: CampoDaEmissao, texto: string): string | string[] | null {
  const t = texto.trim();
  if (!t) return null;
  return c.tipo === 'lista' ? t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : t;
}

function DadosDoMolde({ n, c, e, podeEditar, aoMudar }: { n: number; c: ContratoNaFicha; e: EmissaoNaFicha; podeEditar: boolean; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const salvando = useAcaoDoContrato(aoMudar);
  const gerando = useAcaoDoContrato(aoMudar);
  const [editados, setEditados] = useState<Record<string, string>>({});
  const [fatura, setFatura] = useState<string | null>(null);
  const caminho = `${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}`;
  const doAceite = e.campos.filter((x) => x.fonte === 'aceite');
  const aEscrever = e.campos.filter((x) => x.fonte !== 'aceite');
  const sujo = Object.keys(editados).length > 0 || (fatura !== null && fatura.trim() !== (c.faturaPor ?? ''));

  const salvar = async () => {
    const campos = Object.fromEntries(aEscrever.filter((x) => x.nome in editados).map((x) => [x.nome, valorParaSalvar(x, editados[x.nome]!)]));
    const corpo: ContratoEditarInput = { ...(Object.keys(campos).length ? { campos } : {}), ...(fatura !== null ? { faturaPor: fatura.trim() || null } : {}) };
    const valeu = await salvando.rodar('salvar', () => apiPatch(caminho, corpo, token), 'Dados salvos. Gere a minuta de novo para eles entrarem no texto.');
    if (valeu) {
      setEditados({});
      setFatura(null);
    }
  };

  const faltando = aEscrever.filter((x) => x.fonte === 'falta').length;
  const semMolde = c.tipo === 'contrato' && !c.modalidade;
  return (
    <Passo n={n} titulo={c.tipo === 'contrato' ? 'Dados que entram no molde' : 'Dados que entram no texto'}>
      {!e.temAceite && <p className="text-[12.5px] text-warn" data-testid="emitir-sem-aceite">Este lead não tem proposta aceita: os dados do contratante viram lacuna, e o envio fica travado.</p>}
      {doAceite.length > 0 && (
        <dl className="grid gap-x-3 gap-y-1 text-[12.5px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" data-testid="emitir-do-aceite">
          {doAceite.map((x) => (
            <div key={x.nome} className="contents">
              <dt className="text-muted">{x.rotulo}</dt>
              <dd className="min-w-0 break-words">{textoDoCampo(x)} <Chip>da proposta aceita</Chip></dd>
            </div>
          ))}
        </dl>
      )}
      <label className="flex flex-col gap-1">
        <span className={`${ROTULO} ${c.faturaPor ? '' : '!text-warn'}`}>CNPJ que fatura</span>
        <input data-testid="emitir-fatura-por" className={`${INPUT} max-md:min-h-[44px]`} disabled={!podeEditar} maxLength={200} placeholder="a decidir pelos sócios" value={fatura ?? c.faturaPor ?? ''} onChange={(ev) => setFatura(ev.target.value)} data-painel-ignorar={fatura === null ? '' : undefined} />
      </label>
      {!semMolde && aEscrever.map((x) => {
        const valor = editados[x.nome] ?? textoDoCampo(x);
        const mudar = (v: string) => setEditados((m) => ({ ...m, [x.nome]: v }));
        const ignorar = x.nome in editados ? {} : { 'data-painel-ignorar': '' };
        return (
          <label key={x.nome} className="flex flex-col gap-1">
            <span className={`${ROTULO} ${x.fonte === 'falta' ? '!text-warn' : ''}`}>{x.rotulo}</span>
            {x.tipo === 'lista' ? (
              <textarea data-testid={`emitir-campo-${x.nome}`} className={`${INPUT} min-h-[64px]`} disabled={!podeEditar} value={valor} onChange={(ev) => mudar(ev.target.value)} {...ignorar} />
            ) : x.tipo === 'opcional' ? (
              <select data-testid={`emitir-campo-${x.nome}`} className={`${INPUT} max-md:min-h-[44px]`} disabled={!podeEditar} value={valor} onChange={(ev) => mudar(ev.target.value)}>
                <option value="">a decidir</option>
                <option value="sim">Sim, a cláusula entra</option>
                <option value="nao">Não, a cláusula sai</option>
              </select>
            ) : (
              <input data-testid={`emitir-campo-${x.nome}`} className={`${INPUT} max-md:min-h-[44px]`} disabled={!podeEditar} maxLength={4000} value={valor} onChange={(ev) => mudar(ev.target.value)} {...ignorar} />
            )}
          </label>
        );
      })}
      {faltando > 0 && <p className="text-[12px] text-dim">{faltando === 1 ? '1 campo em branco vira lacuna.' : `${faltando} campos em branco viram lacuna.`} O sistema nunca preenche por conta própria.</p>}
      {podeEditar && (
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="emitir-salvar-dados" className={BOTAO} disabled={!sujo || salvando.ocupado !== null} onClick={() => void salvar()}>Salvar dados</button>
          <button type="button" data-testid="emitir-gerar-minuta" className={BOTAO_PRIMARIO} disabled={sujo || semMolde || gerando.ocupado !== null} title={sujo ? 'Salve os dados antes de gerar.' : undefined} onClick={() => void gerando.rodar('gerar', () => apiPost(`${caminho}/minuta`, {}, token))}>
            {gerando.ocupado ? 'Gerando…' : e.minuta ? 'Gerar a minuta de novo' : 'Gerar minuta'}
          </button>
        </div>
      )}
      <RetornoDaAcao acao={salvando} />
      <RetornoDaAcao acao={gerando} />
    </Passo>
  );
}

function LaudoDoRevisor({ n, c, e, podeEditar, aoMudar }: { n: number; c: ContratoNaFicha; e: EmissaoNaFicha; podeEditar: boolean; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const acao = useAcaoDoContrato(aoMudar);
  const laudo = e.minuta?.laudo;
  return (
    <Passo n={n} titulo="Laudo do revisor">
      {!e.minuta ? (
        <p className="text-[12.5px] text-muted">O laudo sai junto com a minuta.</p>
      ) : laudo && Array.isArray(laudo.apontamentos) ? (
        <LaudoDaMinuta laudo={laudo} />
      ) : (
        <p className="text-[12.5px] text-muted">A minuta ainda não foi revisada.</p>
      )}
      {podeEditar && e.minuta && (
        <button type="button" data-testid="emitir-revisar" className={BOTAO} disabled={acao.ocupado !== null} onClick={() => void acao.rodar('revisar', () => apiPost(`${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}/revisar`, {}, token))}>
          {acao.ocupado ? 'Revisando…' : 'Rodar o revisor de novo'}
        </button>
      )}
      <RetornoDaAcao acao={acao} />
    </Passo>
  );
}

function Previa({ c, e }: { c: ContratoNaFicha; e: EmissaoNaFicha }) {
  const { token } = useAuth();
  const [erro, setErro] = useState<unknown>(null);
  const [abrindo, setAbrindo] = useState(false);
  const m = e.minuta;
  const abrir = async () => {
    setErro(null);
    setAbrindo(true);
    try {
      await abrirPdfDaApi(`${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}/previa.pdf`, token);
    } catch (err) {
      setErro(err);
    } finally {
      setAbrindo(false);
    }
  };
  return (
    <section className={`${CARTAO} min-w-0 space-y-2`} aria-label="prévia do documento" data-testid="emitir-previa">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Rotulo>o que vai para a ZapSign</Rotulo>
        {m && <button type="button" data-testid="emitir-abrir-previa" className={BOTAO} disabled={abrindo} onClick={() => void abrir()}>{abrindo ? 'Abrindo…' : 'Abrir a prévia em PDF'}</button>}
      </div>
      {!m ? (
        <p className="text-[12.5px] text-muted">Ainda não há minuta. Ela sai dos dados ao lado, e o que faltar fica marcado como lacuna.</p>
      ) : (
        <>
          <p className="text-[11.5px] text-dim" data-testid="emitir-origem">
            Rascunho · {ROTULO_DA_BASE[m.base]} · {m.origem === 'modelo' ? 'redigida pelo construtor' : 'preenchida pelo sistema'}{m.geradaEm ? ` · ${quandoCurtoSP(m.geradaEm)}` : ''}
          </p>
          {m.desatualizada && <p role="status" data-testid="emitir-desatualizada" className="rounded border border-warn/50 bg-warn/10 px-2 py-1 text-[12.5px]">Os dados mudaram depois que esta minuta foi gerada. Gere de novo para o texto acompanhar.</p>}
          {m.lacunas.length > 0 && (
            <ul className="list-disc pl-5 text-[12.5px] text-warn" aria-label="lacunas da minuta" data-testid="emitir-lacunas">
              {m.lacunas.map((l) => <li key={l}>{l}</li>)}
            </ul>
          )}
          <TextoDaMinuta conteudo={m.conteudo} />
          {m.avisos.length > 0 && (
            <ul className="text-[11.5px] text-dim" aria-label="avisos da minuta" data-testid="emitir-avisos">
              {m.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </>
      )}
      <ErroDaAcao erro={erro} />
    </section>
  );
}

function PedirAprovacao({ c, e, assinaturaConfigurada, podeEditar, aoMudar }: { c: ContratoNaFicha; e: EmissaoNaFicha; assinaturaConfigurada: boolean; podeEditar: boolean; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const acao = useAcaoDoContrato(aoMudar);
  const falta = c.faltaParaEnviar;
  const naFila = !!e.envioNaFila || acao.retida;
  const travado = falta.length > 0 || naFila || !assinaturaConfigurada || acao.ocupado !== null;
  return (
    <section className={`${CARTAO} space-y-2`} aria-label="pedir aprovação" data-testid="emitir-rodape">
      <div data-testid="contrato-falta-para-enviar" className="text-[13px]">
        {falta.length > 0 ? (
          <>
            <p><strong>{falta.length === 1 ? 'Falta 1 item para pedir aprovação:' : `Faltam ${falta.length} itens para pedir aprovação:`}</strong></p>
            <ul className="mt-1 list-disc pl-5 text-[12.5px] text-muted">
              {falta.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </>
        ) : (
          <p><strong>Nada falta para pedir aprovação.</strong> <span className="text-muted">Nada saiu para assinatura ainda.</span></p>
        )}
      </div>
      <p className="text-[12.5px] text-muted">Enviar é ação R4: outra pessoa titular confere o conteúdo exato e confirma com a senha. O hash do PDF vai junto: se a minuta mudar, a aprovação cai e nada sai.</p>
      {podeEditar && (
        <button
          type="button"
          data-testid="contrato-pedir-envio"
          className={BOTAO_PRIMARIO}
          disabled={travado}
          onClick={() => void acao.rodar('enviar', () => apiPost(`${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}/enviar`, {}, token))}
        >
          {acao.ocupado ? 'Pedindo…' : 'Pedir aprovação e enviar'}
        </button>
      )}
      {naFila && <FaixaRetida testId="contrato-envio-retido" frase={FRASE_RETIDA_DO_ENVIO} />}
      <ErroDaAcao erro={acao.erro} />
    </section>
  );
}
