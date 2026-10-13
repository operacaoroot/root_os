'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ComercialProduto } from '@mktos/shared';
import { COMERCIAL_PRODUTOS } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AUSENTE, ROTULO_DO_PRODUTO, diaHoraSP, explicarRascunho, horaSP, reaisOuAusente } from '@/lib/cockpit';

import { AbasDoLead, AguardandoAprovacao, Aviso, BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, Erro, FOCO, INPUT, Rotulo, useCarregar } from '../../../_ui';

/*
 * TELA 06 · DEPOIS DA SESSÃO (lane C). A ata chega, o leitor de ata monta o
 * diagnóstico com o minuto de cada fala, a mesa aprova (quem tem
 * `aprovacoes.decidir`, sobre a versão que leu: E-4/C-8), o construtor gera a
 * proposta e o revisor confere. Publicar vai à PORTA (R3): outra pessoa
 * confirma em /atendimento. A tela não escreve campo nenhum: cada botão é uma
 * rota que registra um fato ou pede à porta.
 */

interface Dor { n: number; texto: string; minuto: string | null; trecho?: string }
interface Diagnostico {
  eventoId: string;
  em: string;
  dores?: Dor[];
  objecoes?: string[];
  objecoesComTrecho?: { texto: string; minuto: string | null; trecho?: string }[];
  produtoSugerido?: ComercialProduto | null;
  regraDoProduto?: string | null;
  aprovadoEm?: string | null;
  aprovadoPor?: string | null;
  avisos?: string[];
  avisoDoModelo?: string | null;
  modelo?: string | null;
  caiuNoStub?: boolean;
}
interface Rascunho {
  versao: number;
  estado: string;
  conteudo: {
    produto: ComercialProduto;
    rotulo: string;
    valorCentavos: number;
    parcelas: number;
    parcelaCentavos: number;
    ultimaParcelaCentavos: number;
    formas: string[];
    descricao: string;
    descontoPct: number | null;
    alternativa: ComercialProduto | null;
    ouvimos: string[];
    comoEDiferente: string | null;
    quadroDeCustos: { mesNormalCentavos: number | null; piorMesCentavos: number | null; exemplo: boolean; origem: string } | null;
    validaAte: string | null;
    tabelaData: string;
  };
  hash: string;
  laudo: { ok: boolean; apontamentos: string[]; notas: string[] };
  dentroDaTabela: boolean;
  origem: string;
  approvalId: string | null;
  decisaoId: string | null;
  publicarEm: string | null;
  avisos: string[];
  atualizadoEm: string;
}
interface Sessao {
  diagnostico: Diagnostico | null;
  leitorDeAta: { estado: string; resultado: unknown; erro: string | null; em: string }[];
  proposta: Rascunho | null;
  versoes: Rascunho[];
}

export default function DepoisDaSessaoPage() {
  const { id } = useParams<{ id: string }>();
  const { dados, erro, carregando, recarregar } = useCarregar<Sessao>(id ? `/comercial/lead/${id}/sessao` : null, 15_000);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/comercial/lead/${id}`} className={`text-[12px] text-muted hover:text-brand ${FOCO}`}>← fio do lead</Link>
        {id && <span className="ml-auto"><AbasDoLead leadId={id} atual="sessao" /></span>}
      </div>
      <Erro erro={erro} />
      {carregando && !dados && <Carregando />}
      {dados && id && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <DiagnosticoDaAta leadId={id} s={dados} aoMudar={recarregar} />
            <SubirAta leadId={id} temDiagnostico={!!dados.diagnostico} aoMudar={recarregar} />
          </div>
          <Proposta leadId={id} s={dados} aoMudar={recarregar} />
        </div>
      )}
    </div>
  );
}

type Acao = (rota: string, corpo?: unknown) => Promise<unknown>;

function useAcao(aoMudar: () => Promise<void>) {
  const { token } = useAuth();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const agir: Acao = async (rota, corpo = {}) => {
    setOcupado(rota);
    setErro(null);
    try {
      const r = await apiPost<unknown>(rota, corpo, token);
      await aoMudar();
      return r;
    } catch (e) {
      setErro(e);
      return null;
    } finally {
      setOcupado(null);
    }
  };
  return { agir, ocupado, erro };
}

function DiagnosticoDaAta({ leadId, s, aoMudar }: { leadId: string; s: Sessao; aoMudar: () => Promise<void> }) {
  const { agir, ocupado, erro } = useAcao(aoMudar);
  const { can } = useAuth();
  // E-4/C-8: o portão de E5 é decisão de mesa; a API recusa quem não tem a permissão.
  const podeAprovar = can('aprovacoes.decidir');
  const d = s.diagnostico;
  const ultimoLeitor = s.leitorDeAta[0];

  return (
    <section className={`${CARTAO} space-y-3`} aria-label="diagnóstico">
      <div className="flex flex-wrap items-center gap-2">
        <Rotulo>da ata · com minuto</Rotulo>
        {d?.aprovadoEm ? <Chip tom="bom">aprovado</Chip> : d ? <Chip tom="alerta">esperando aprovação da mesa</Chip> : null}
      </div>
      {!d && (
        <p className="text-[12.5px] text-muted">
          Ainda não há diagnóstico. Quando a ata chega, o leitor de ata monta as dores com o minuto de cada fala.
          {ultimoLeitor && ` Última leitura: ${ultimoLeitor.estado}${ultimoLeitor.erro ? ` (${ultimoLeitor.erro})` : ''} às ${horaSP(ultimoLeitor.em)}.`}
        </p>
      )}
      {d && (
        <>
          <ul className="space-y-1.5">
            {(d.dores ?? []).map((x) => (
              <li key={x.n} className="grid grid-cols-[48px_minmax(0,1fr)] gap-2 text-[13px]">
                <span className="font-os-mono text-brand">{x.minuto ?? '--:--'}</span>
                <span>{x.trecho ? `“${x.trecho}”` : x.texto}</span>
              </li>
            ))}
            {(d.dores ?? []).length === 0 && <li className="text-[12.5px] text-muted">Nenhuma dor com trecho conferido na ata.</li>}
          </ul>

          <Rotulo>diagnóstico montado</Rotulo>
          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[13px]">
            {(d.dores ?? []).map((x) => (
              <div key={x.n} className="contents">
                <dt className="text-muted">dor {x.n}</dt>
                <dd>{x.texto}</dd>
              </div>
            ))}
            {(d.objecoes ?? []).map((o) => (
              <div key={o} className="contents">
                <dt className="text-muted">objeção</dt>
                <dd>{o}</dd>
              </div>
            ))}
            <dt className="text-muted">produto</dt>
            <dd>{d.produtoSugerido ? ROTULO_DO_PRODUTO[d.produtoSugerido] : AUSENTE}</dd>
          </dl>
          {d.regraDoProduto && <p className="text-[11.5px] text-dim">{d.regraDoProduto}</p>}
          {(d.avisos ?? []).map((a) => <Aviso key={a}>{a}</Aviso>)}
          {d.avisoDoModelo && <Aviso>{d.avisoDoModelo}</Aviso>}
          <p className="text-[11.5px] text-dim">
            montado em {diaHoraSP(d.em)}{d.modelo ? ` · modelo ${d.modelo}` : ''}
            {d.aprovadoEm ? ` · aprovado por ${d.aprovadoPor ?? AUSENTE} em ${diaHoraSP(d.aprovadoEm)}` : ''}
          </p>
          {!d.aprovadoEm && podeAprovar && (
            <button
              type="button"
              className={BOTAO_PRIMARIO}
              disabled={!!ocupado}
              onClick={() => void agir(`/comercial/lead/${leadId}/diagnostico/aprovar`, { eventoId: d.eventoId })}
            >
              {ocupado ? 'aprovando…' : 'aprovar este diagnóstico'}
            </button>
          )}
          {!d.aprovadoEm && !podeAprovar && (
            <p className="text-[12px] text-muted">Quem aprova é a mesa: um perfil que decide aprovações. Seu perfil acompanha.</p>
          )}
        </>
      )}
      <Erro erro={erro} />
    </section>
  );
}

function SubirAta({ leadId, temDiagnostico, aoMudar }: { leadId: string; temDiagnostico: boolean; aoMudar: () => Promise<void> }) {
  const { agir, ocupado, erro } = useAcao(aoMudar);
  const [texto, setTexto] = useState('');
  const [fonte, setFonte] = useState<'granola' | 'texto' | 'arquivo'>('texto');
  const [feito, setFeito] = useState<string | null>(null);

  async function lerArquivo(arq: File | undefined) {
    if (!arq) return;
    setTexto(await arq.text());
    setFonte('arquivo');
  }

  const curto = texto.trim().length < 200;
  // C-9: o teto do schema da ata (400 mil caracteres). Acima dele a tela avisa antes de enviar.
  const longo = texto.length > 400_000;

  return (
    <section className={`${CARTAO} space-y-2`} aria-label="ata">
      <Rotulo>a ata da sessão</Rotulo>
      <p className="text-[12.5px] text-muted">
        Cole a transcrição ou escolha o arquivo de texto. Só o hash fica no fio; o texto é lido e descartado.
      </p>
      <textarea className={`${INPUT} min-h-[120px] font-os-mono text-[12px]`} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="transcrição da conversa (mínimo de 200 caracteres)" />
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <label className={`${BOTAO} cursor-pointer`}>
          escolher arquivo
          <input type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={(e) => void lerArquivo(e.target.files?.[0])} />
        </label>
        <select aria-label="fonte da ata" className={`${INPUT} w-auto`} value={fonte} onChange={(e) => setFonte(e.target.value as typeof fonte)}>
          <option value="texto">texto colado</option>
          <option value="granola">Granola</option>
          <option value="arquivo">arquivo</option>
        </select>
        <span className="font-os-mono text-[11px] text-dim">{texto.trim().length} caracteres</span>
      </div>
      {longo && <Aviso tom="ruim">A ata passa de 400 mil caracteres, o teto da API. Divida a transcrição em duas partes ou suba o resumo da sessão.</Aviso>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BOTAO_PRIMARIO}
          disabled={curto || longo || !!ocupado}
          onClick={async () => {
            const r = await agir(`/comercial/lead/${leadId}/ata`, { texto, fonte });
            if (r) setFeito('Ata recebida. O leitor de ata monta o diagnóstico em seguida.');
          }}
        >
          subir ata
        </button>
        {temDiagnostico && (
          <button
            type="button"
            className={BOTAO}
            disabled={curto || !!ocupado}
            onClick={async () => {
              const r = await agir(`/comercial/lead/${leadId}/diagnostico/gerar`, { texto });
              if (r) setFeito('Diagnóstico refeito a partir deste texto.');
            }}
          >
            refazer diagnóstico com este texto
          </button>
        )}
      </div>
      {feito && <Aviso tom="bom">{feito}</Aviso>}
      <Erro erro={erro} />
    </section>
  );
}

function Proposta({ leadId, s, aoMudar }: { leadId: string; s: Sessao; aoMudar: () => Promise<void> }) {
  const { agir, ocupado, erro } = useAcao(aoMudar);
  const [produto, setProduto] = useState<'' | ComercialProduto>('');
  const p = s.proposta;
  const estado = p ? explicarRascunho(p.estado, p.publicarEm) : null;
  const podeGerar = !!s.diagnostico?.aprovadoEm;

  return (
    <section className={`${CARTAO} space-y-3`} aria-label="proposta">
      <div className="flex flex-wrap items-center gap-2">
        <Rotulo>proposta</Rotulo>
        {p && <Chip tom={p.dentroDaTabela ? 'bom' : 'alerta'}>{p.dentroDaTabela ? 'dentro da tabela' : 'fora da tabela'}</Chip>}
        {p && <Chip>v{p.versao}</Chip>}
      </div>

      {!p && (
        <p className="text-[12.5px] text-muted">
          {podeGerar ? 'Diagnóstico aprovado. A proposta pode ser gerada pela tabela.' : 'A proposta nasce depois que a mesa aprova o diagnóstico.'}
        </p>
      )}

      {p && estado && (
        <>
          <h3 className="text-[15px] font-semibold">
            {p.conteudo.rotulo} · {reaisOuAusente(p.conteudo.valorCentavos)} · {p.conteudo.parcelas}× de {reaisOuAusente(p.conteudo.parcelaCentavos)}
            {p.conteudo.ultimaParcelaCentavos !== p.conteudo.parcelaCentavos && ` (última ${reaisOuAusente(p.conteudo.ultimaParcelaCentavos)})`}
          </h3>
          <p className="text-[13px]">Estado: <span className="font-semibold">{estado.rotulo}</span></p>
          {estado.aguardaAprovacao && <AguardandoAprovacao approvalId={p.approvalId} oQue="A publicação da proposta foi à porta (R3)." />}
          {estado.naFilaDeDecisoes && (
            <Aviso>
              O revisor apontou algo ou a proposta saiu da tabela: ela espera uma decisão na{' '}
              <Link href={p.decisaoId ? `/comercial#dec-${p.decisaoId}` : '/comercial'} className={`underline ${FOCO}`}>
                fila de decisões do comercial
              </Link>
              , não em /atendimento.
            </Aviso>
          )}
          {p.conteudo.descontoPct != null && <p className="text-[12.5px] text-muted">desconto aprovado de {p.conteudo.descontoPct}%</p>}
          <p className="text-[12.5px] text-muted">{p.conteudo.descricao}</p>
          {p.conteudo.comoEDiferente && <p className="text-[12.5px]"><span className="text-muted">como é diferente:</span> {p.conteudo.comoEDiferente}</p>}
          <p className="text-[12.5px] text-muted">
            custos de terceiros: mês normal {reaisOuAusente(p.conteudo.quadroDeCustos?.mesNormalCentavos)} · pior mês {reaisOuAusente(p.conteudo.quadroDeCustos?.piorMesCentavos)}
            {p.conteudo.quadroDeCustos?.exemplo && ' (valores de exemplo, a decidir)'}
            {' · '}vale até {p.conteudo.validaAte ? diaHoraSP(p.conteudo.validaAte).slice(0, 5) : AUSENTE} · tabela de {p.conteudo.tabelaData}
          </p>

          <div>
            <Rotulo>laudo do revisor</Rotulo>
            <ul className="mt-1 space-y-1 text-[12.5px]">
              {p.laudo.apontamentos.map((a) => <li key={a} className="text-bad">apontamento: {a}</li>)}
              {p.laudo.notas.map((n) => <li key={n} className="text-muted">conferido: {n}</li>)}
            </ul>
            {!p.laudo.ok && <p className="mt-1 text-[12px]">Com apontamento, a proposta não vai à porta: foi para a fila de decisões.</p>}
          </div>
          {p.avisos.map((a) => <Aviso key={a}>{a}</Aviso>)}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {p && ['pronta', 'agendada', 'segurada'].includes(p.estado) && (
          <button type="button" className={BOTAO_PRIMARIO} disabled={!!ocupado} onClick={() => void agir(`/comercial/lead/${leadId}/proposta/publicar`)}>
            liberar para publicar
          </button>
        )}
        {p && ['pronta', 'agendada', 'na_porta', 'na_fila'].includes(p.estado) && (
          <button type="button" className={BOTAO} disabled={!!ocupado} onClick={() => void agir(`/comercial/lead/${leadId}/proposta/segurar`)}>
            segurar
          </button>
        )}
        {podeGerar && (
          <>
            <select aria-label="produto" className={`${INPUT} w-auto`} value={produto} onChange={(e) => setProduto(e.target.value as '' | ComercialProduto)}>
              <option value="">produto do diagnóstico</option>
              {COMERCIAL_PRODUTOS.map((x) => <option key={x} value={x}>{ROTULO_DO_PRODUTO[x]}</option>)}
            </select>
            <button type="button" className={BOTAO} disabled={!!ocupado} onClick={() => void agir(`/comercial/lead/${leadId}/proposta/gerar`, produto ? { produto } : {})}>
              {p ? 'refazer proposta' : 'gerar proposta'}
            </button>
          </>
        )}
      </div>
      <p className="text-[11.5px] text-dim">Publicar vai à porta em nome de quem pediu. Quem pediu não confirma o próprio pedido.</p>
      <Erro erro={erro} />

      {s.versoes.length > 1 && (
        <div>
          <Rotulo>versões</Rotulo>
          <ul className="mt-1 divide-y divide-border text-[12.5px]">
            {s.versoes.map((v) => (
              <li key={v.versao} className="flex flex-wrap gap-2 py-1">
                <span className="font-os-mono">v{v.versao}</span>
                <span>{reaisOuAusente(v.conteudo.valorCentavos)}</span>
                <span className="text-muted">{explicarRascunho(v.estado, v.publicarEm).rotulo}</span>
                <span className="ml-auto text-dim">{diaHoraSP(v.atualizadoEm)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
