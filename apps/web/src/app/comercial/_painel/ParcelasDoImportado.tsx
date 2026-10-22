'use client';

import { useMemo, useState } from 'react';
import {
  PARCELAS_MANUAIS_MAX,
  centavosDigitados,
  diaDeVerdade,
  diaEmSaoPaulo,
  fraseDeLigarARegua,
  parcelasEmSerie,
  somaDasParcelas,
  textoDosCentavos,
  type ContratoImportadoNaTela,
  type ResultadoDoContratoImportado,
} from '@mktos/shared';

import { apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dataDoDia, reaisOuAusente } from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, Chip, ErroDaAcao, INPUT, ROTULO } from '../_ui';

/*
 * PARCELAS DO CONTRATO IMPORTADO (produção 22, M2, 22/10/2026; sugestão 7).
 *
 * A mesa lança as parcelas à mão: em série mensal (quantidade, valor de cada e
 * 1º vencimento, que preenche as linhas) ou linha a linha, com o dia do pagamento
 * quando a parcela já foi paga fora. Valor em reais digitado, guardado em centavos
 * inteiros; datas em dia de São Paulo; a soma aparece. Cada salvar é uma versão nova
 * (outra aba salvou no meio, a API recusa e pede para recarregar).
 *
 * A régua de cobrança fica DESLIGADA até alguém ligar pelo interruptor, que mostra
 * antes a frase do que vai acontecer (a mesma que a auditoria guarda). Ligada, a
 * régua é dona das parcelas: a tela não as edita mais.
 */

interface LinhaEditada {
  valor: string;
  vence: string;
  pagaEm: string;
}

function linhaVazia(): LinhaEditada {
  return { valor: '', vence: '', pagaEm: '' };
}

/** A linha editada conferida: o valor em centavos e as datas, ou o motivo de não valer. */
function conferirLinha(l: LinhaEditada, hoje: string): { ok: true; valorCentavos: number; vence: string; pagaEm: string | null } | { ok: false; motivo: string } {
  const valorCentavos = centavosDigitados(l.valor);
  if (valorCentavos === null || valorCentavos <= 0) return { ok: false, motivo: 'valor em reais, com vírgula nos centavos' };
  if (!diaDeVerdade(l.vence)) return { ok: false, motivo: 'vencimento inválido' };
  if (l.pagaEm && !diaDeVerdade(l.pagaEm)) return { ok: false, motivo: 'dia do pagamento inválido' };
  if (l.pagaEm && l.pagaEm > hoje) return { ok: false, motivo: 'pagamento no futuro' };
  return { ok: true, valorCentavos, vence: l.vence, pagaEm: l.pagaEm || null };
}

const TOM_DO_ESTADO = { paga: 'bom', atrasada: 'ruim', pendente: 'neutro' } as const;

export function ParcelasDoImportado({ leadId, contrato: c, podeEditar, aoMudar }: {
  leadId: string;
  contrato: ContratoImportadoNaTela;
  podeEditar: boolean;
  aoMudar?: () => void | Promise<void>;
}) {
  const p = c.parcelasManuais ?? null;
  const ligada = !!c.regua?.ligada;
  const [editando, setEditando] = useState(false);
  const [ligando, setLigando] = useState(false);

  return (
    <section className="relative z-10 min-w-0 space-y-2 rounded border border-border px-3 py-2" aria-label="parcelas do contrato importado" data-testid="parcelas-do-importado">
      <div className="flex flex-wrap items-center gap-2">
        <span className={ROTULO}>Parcelas</span>
        {p && <span className="font-os-mono text-[12px] tabular-nums text-text" data-testid="parcelas-soma">soma {reaisOuAusente(p.somaCentavos)}</span>}
        {p && <span className="text-[11.5px] text-dim">versão {p.versao}{p.por ? ` · por ${p.por}` : ''}</span>}
      </div>

      {editando ? (
        <EditorDeParcelas
          leadId={leadId}
          contrato={c}
          aoCancelar={() => setEditando(false)}
          aoSalvar={async () => { setEditando(false); await aoMudar?.(); }}
        />
      ) : p ? (
        <ul className="divide-y divide-border text-[12.5px]" data-testid="parcelas-lista">
          {p.linhas.map((l) => (
            <li key={`${l.n}-${l.vence}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 tabular-nums">
              <span className="font-os-mono">{l.n}/{p.linhas.length}</span>
              <span className="text-text">{reaisOuAusente(l.valorCentavos)}</span>
              <Chip tom={TOM_DO_ESTADO[l.estado]}>{l.estado}</Chip>
              <span>{l.estado === 'paga' && l.pagaEm ? `paga em ${dataDoDia(l.pagaEm)}` : `vence ${dataDoDia(l.vence)}`}</span>
              {l.aviso && <span className="text-warn">aviso {l.aviso}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px]" data-testid="parcelas-vazio">Nenhuma parcela lançada. A mesa decide quantidade, valores e vencimentos.</p>
      )}

      {!editando && podeEditar && !ligada && (
        <button type="button" className={BOTAO} data-testid="parcelas-editar" onClick={() => setEditando(true)}>
          {p ? 'Editar parcelas' : 'Lançar parcelas'}
        </button>
      )}

      <InterruptorDaRegua
        leadId={leadId}
        contrato={c}
        podeEditar={podeEditar && !editando}
        ligando={ligando}
        aoAbrir={() => setLigando(true)}
        aoFechar={() => setLigando(false)}
        aoMudar={aoMudar}
      />
    </section>
  );
}

function EditorDeParcelas({ leadId, contrato: c, aoCancelar, aoSalvar }: {
  leadId: string;
  contrato: ContratoImportadoNaTela;
  aoCancelar: () => void;
  aoSalvar: () => Promise<void>;
}) {
  const { token } = useAuth();
  const hoje = diaEmSaoPaulo();
  const atuais = c.parcelasManuais?.linhas ?? [];
  const [linhas, setLinhas] = useState<LinhaEditada[]>(
    atuais.length ? atuais.map((l) => ({ valor: textoDosCentavos(l.valorCentavos), vence: l.vence, pagaEm: l.pagaEm ?? '' })) : [linhaVazia()],
  );
  const [quantidade, setQuantidade] = useState('12');
  const [valorDaSerie, setValorDaSerie] = useState('');
  const [primeiro, setPrimeiro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);

  const conferidas = useMemo(() => linhas.map((l) => conferirLinha(l, hoje)), [linhas, hoje]);
  const validas = conferidas.filter((x): x is Extract<typeof x, { ok: true }> => x.ok);
  const todasValem = conferidas.length > 0 && validas.length === conferidas.length;
  const soma = somaDasParcelas(validas);

  const qtd = Number(quantidade);
  const centavosDaSerie = centavosDigitados(valorDaSerie);
  const serieValida = Number.isInteger(qtd) && qtd >= 1 && qtd <= PARCELAS_MANUAIS_MAX && centavosDaSerie !== null && centavosDaSerie > 0 && diaDeVerdade(primeiro);

  function gerar() {
    if (!serieValida || centavosDaSerie === null) return;
    setLinhas(parcelasEmSerie(qtd, centavosDaSerie, primeiro).map((l) => ({ valor: textoDosCentavos(l.valorCentavos), vence: l.vence, pagaEm: '' })));
  }

  function mudar(i: number, campo: keyof LinhaEditada, valor: string) {
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: valor } : l)));
  }

  async function salvar() {
    if (!todasValem) return;
    setEnviando(true); setErro(null);
    try {
      await apiPut<ResultadoDoContratoImportado>(`/comercial/contratos/${encodeURIComponent(leadId)}/importados/parcelas`, {
        origem: c.origem,
        versaoEsperada: c.parcelasManuais?.versao ?? 0,
        linhas: validas.map((l) => ({ valorCentavos: l.valorCentavos, vence: l.vence, pagaEm: l.pagaEm })),
      }, token);
      await aoSalvar();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3" data-testid="parcelas-editor">
      <fieldset className="min-w-0 space-y-2">
        <legend className={ROTULO}>Em série, mensal</legend>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex w-24 flex-col gap-1">
            <span className="text-[11.5px] text-muted">Quantidade</span>
            <input className={INPUT} inputMode="numeric" data-testid="parcelas-serie-quantidade" value={quantidade} onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="flex w-32 flex-col gap-1">
            <span className="text-[11.5px] text-muted">Valor de cada (R$)</span>
            <input className={INPUT} inputMode="decimal" placeholder="1.500,00" data-testid="parcelas-serie-valor" value={valorDaSerie} onChange={(e) => setValorDaSerie(e.target.value)} />
          </label>
          <label className="flex w-40 flex-col gap-1">
            <span className="text-[11.5px] text-muted">1º vencimento</span>
            <input className={INPUT} type="date" data-testid="parcelas-serie-vencimento" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} />
          </label>
          <button type="button" className={BOTAO} data-testid="parcelas-gerar" disabled={!serieValida} onClick={gerar}>Preencher as linhas</button>
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className={ROTULO}>Linha a linha</legend>
        <ol className="space-y-2">
          {linhas.map((l, i) => {
            const v = conferidas[i];
            return (
              <li key={i} className="flex min-w-0 flex-wrap items-end gap-2" data-testid={`parcelas-linha-${i}`}>
                <span className="w-6 pb-2 font-os-mono text-[12px] text-dim">{i + 1}</span>
                <label className="flex w-32 flex-col gap-1">
                  <span className="text-[11.5px] text-muted">Valor (R$)</span>
                  <input className={INPUT} inputMode="decimal" data-testid={`parcelas-linha-${i}-valor`} value={l.valor} onChange={(e) => mudar(i, 'valor', e.target.value)} />
                </label>
                <label className="flex w-40 flex-col gap-1">
                  <span className="text-[11.5px] text-muted">Vence</span>
                  <input className={INPUT} type="date" data-testid={`parcelas-linha-${i}-vence`} value={l.vence} onChange={(e) => mudar(i, 'vence', e.target.value)} />
                </label>
                <label className="flex w-40 flex-col gap-1">
                  <span className="text-[11.5px] text-muted">Paga em (se já foi)</span>
                  <input className={INPUT} type="date" max={hoje} data-testid={`parcelas-linha-${i}-paga`} value={l.pagaEm} onChange={(e) => mudar(i, 'pagaEm', e.target.value)} />
                </label>
                <button type="button" className={BOTAO} aria-label={`Tirar a linha ${i + 1}`} disabled={linhas.length === 1} onClick={() => setLinhas((ls) => ls.filter((_, k) => k !== i))}>Tirar</button>
                {!v.ok && (l.valor || l.vence) && <span className="w-full text-[11.5px] text-warn">{v.motivo}</span>}
              </li>
            );
          })}
        </ol>
        <button type="button" className={BOTAO} data-testid="parcelas-mais-linha" disabled={linhas.length >= PARCELAS_MANUAIS_MAX} onClick={() => setLinhas((ls) => [...ls, linhaVazia()])}>+ linha</button>
      </fieldset>

      <p className="text-[12.5px] tabular-nums text-text" data-testid="parcelas-soma-editada">
        {validas.length} parcela{validas.length === 1 ? '' : 's'} · soma {reaisOuAusente(soma)}
      </p>
      <ErroDaAcao erro={erro} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BOTAO_PRIMARIO} data-testid="parcelas-salvar" disabled={!todasValem || enviando} onClick={() => void salvar()}>
          {enviando ? 'Salvando…' : 'Salvar parcelas'}
        </button>
        <button type="button" className={BOTAO} onClick={aoCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

function InterruptorDaRegua({ leadId, contrato: c, podeEditar, ligando, aoAbrir, aoFechar, aoMudar }: {
  leadId: string;
  contrato: ContratoImportadoNaTela;
  podeEditar: boolean;
  ligando: boolean;
  aoAbrir: () => void;
  aoFechar: () => void;
  aoMudar?: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const [ciente, setCiente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const p = c.parcelasManuais ?? null;
  const ligada = !!c.regua?.ligada;

  if (ligada) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px]" data-testid="regua-do-importado-estado" data-ligada="sim">
        <span role="switch" aria-checked="true" aria-disabled="true" aria-label="Régua de cobrança deste contrato" className="inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-brand px-0.5">
          <span className="ml-auto h-4 w-4 rounded-full bg-bg" />
        </span>
        <span>
          Régua de cobrança ligada{c.regua?.em ? ` em ${dataDoDia(c.regua.em.slice(0, 10))}` : ''}{c.regua?.por ? ` por ${c.regua.por}` : ''}. As parcelas não se editam mais por aqui.
        </span>
      </div>
    );
  }

  async function ligar() {
    if (!p || !ciente) return;
    setEnviando(true); setErro(null);
    try {
      await apiPost<ResultadoDoContratoImportado>(`/comercial/contratos/${encodeURIComponent(leadId)}/importados/regua`, { origem: c.origem, versaoDasParcelas: p.versao, ciente: true }, token);
      aoFechar();
      await aoMudar?.();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-w-0 space-y-2 text-[12px]" data-testid="regua-do-importado-estado" data-ligada="nao">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked="false"
          aria-label="Ligar a régua de cobrança deste contrato"
          data-testid="regua-do-importado-ligar"
          disabled={!podeEditar || !p || ligando}
          onClick={() => { setCiente(false); aoAbrir(); }}
          className="inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-surface px-0.5 transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="h-4 w-4 rounded-full bg-dim" />
        </button>
        <span>
          {p ? 'Ligar a régua de cobrança deste contrato.' : 'A régua liga depois que as parcelas forem lançadas.'} Desligada, nenhum aviso de cobrança sai deste contrato.
        </span>
      </div>
      {ligando && p && (
        <div className="space-y-2 rounded border border-warn/50 bg-warn/10 p-2" role="alert" data-testid="regua-do-importado-confirmacao">
          <p data-testid="regua-do-importado-frase">{fraseDeLigarARegua(p.linhas, diaEmSaoPaulo())}</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" data-testid="regua-do-importado-ciente" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
            Li e quero ligar a régua deste contrato.
          </label>
          <ErroDaAcao erro={erro} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BOTAO_PRIMARIO} data-testid="regua-do-importado-confirmar" disabled={!ciente || enviando} onClick={() => void ligar()}>
              {enviando ? 'Ligando…' : 'Ligar a régua'}
            </button>
            <button type="button" className={BOTAO} onClick={aoFechar}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
