'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ETAPAS_DO_QUADRO, ROTULO_DA_ETAPA_DO_QUADRO, type ContratoNoQuadro, type ContratoVivo, type EtapaDoQuadro, type QuadroDeContratos, type ResultadoDoLote } from '@mktos/shared';

import { useAuth } from '@/lib/auth';
import { diaDeHojeSP, reaisOuAusente } from '@/lib/cockpit';

import { BOTAO, CARTAO, Carregando, Erro, ErroDaAcao, FOCO, INPUT, ROTULO, useCarregar } from '../_ui';
import { useMudouNoPainel, usePainel } from '../_painel/provedor';
import { ContratosVivos } from '../_contratos/ContratosVivos';
import { ListaDeContratos, ResultadoDoLoteNaTela, enviarLote } from '../_contratos/ListaDeContratos';
import { NovoContrato } from '../_contratos/NovoContrato';
import { QuadroDeContratosView } from '../_contratos/QuadroDeContratosView';
import { CAMINHO_DO_QUADRO, FRASE_SEM_ZAPSIGN, PASSO_DA_ACAO, acaoNaTela, dataCompleta, filtrarContratos, urlComVisao, visaoDaUrl, type VisaoDosContratos } from '../_contratos/regras';

/*
 * TELA 11 · OS CONTRATOS (lane C; quadro e lista na fase F4, 02/11/2026). Do fechamento
 * ao fim do contrato, numa tela só: o quadro é o padrão, `?visao=lista` é a mesma base
 * em tabela com ações em lote, e `?visao=vivos` guarda a lista da T8 (parcelas, saúde,
 * importados e o encerramento pelas rotas antigas). Cada cartão abre o painel do lead na
 * aba Contrato. Nenhum exemplo aqui: o que aparece é o que a API devolveu.
 */
export default function ContratosPage() {
  // O endereço só existe no navegador: lido depois de montar, como o funil.
  const [visao, setVisao] = useState<VisaoDosContratos | null>(null);
  useEffect(() => setVisao(visaoDaUrl(window.location.search)), []);
  const mudarVisao = (v: VisaoDosContratos) => {
    setVisao(v);
    window.history.replaceState(null, '', urlComVisao(window.location.pathname, window.location.search, v));
  };

  const quadro = useCarregar<QuadroDeContratos>(visao && visao !== 'vivos' ? CAMINHO_DO_QUADRO : null, 60_000);
  const vivos = useCarregar<ContratoVivo[]>('/comercial/contratos', 60_000);
  const recarregarTudo = useCallback(async () => {
    await Promise.all([quadro.recarregar(), vivos.recarregar()]);
  }, [quadro, vivos]);
  useMudouNoPainel(recarregarTudo);

  const painel = usePainel();
  const { can, token } = useAuth();
  const editar = can('leads.editar');

  const [busca, setBusca] = useState('');
  const [dono, setDono] = useState('');
  const [etapa, setEtapa] = useState<'' | EtapaDoQuadro>('');

  const itens = useMemo(() => quadro.dados?.itens ?? [], [quadro.dados]);
  const cnpjs = useMemo(() => new Map((vivos.dados ?? []).flatMap((v) => (v.cnpj ? [[v.leadId, v.cnpj] as const] : []))), [vivos.dados]);
  const donos = useMemo(() => [...new Set(itens.map((c) => c.dono).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [itens]);
  // A coluna é o filtro do quadro: o de etapa só existe na lista.
  const visiveis = useMemo(
    () => filtrarContratos(itens, { busca, dono, etapa: visao === 'lista' ? etapa : '' }, cnpjs),
    [itens, busca, dono, etapa, visao, cnpjs],
  );

  // O gesto abre o passo na aba Contrato. Nada é gravado aqui.
  const abrirPasso = (item: ContratoNoQuadro, destino: EtapaDoQuadro, origem: Element | null) => {
    const acao = acaoNaTela(item, destino);
    if (acao) painel.abrir(item.leadId, 'contrato', origem, PASSO_DA_ACAO[acao]);
  };

  const emAssinatura = visiveis.filter((c) => c.etapa === 'em_assinatura' && !c.fantasma);
  const [conferindo, setConferindo] = useState(false);
  const [erroDaConferencia, setErroDaConferencia] = useState<unknown>(null);
  const [respostaDaConferencia, setRespostaDaConferencia] = useState<ResultadoDoLote | null>(null);
  const conferirTodas = async () => {
    setConferindo(true);
    setErroDaConferencia(null);
    setRespostaDaConferencia(null);
    try {
      setRespostaDaConferencia(await enviarLote({ acao: 'conferir', ids: emAssinatura.map((c) => c.id) }, token));
      await quadro.recarregar();
    } catch (e) {
      setErroDaConferencia(e);
    } finally {
      setConferindo(false);
    }
  };

  return (
    <div className="min-w-0 space-y-3" data-testid="contratos-tela">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="formato de visualização" className="inline-flex overflow-hidden rounded border border-border">
          {(['quadro', 'lista'] as const).map((v) => (
            <button
              key={v}
              type="button"
              data-testid={`contratos-visao-${v}`}
              aria-pressed={visao === v}
              onClick={() => mudarVisao(v)}
              className={`px-2.5 py-1.5 text-[12.5px] max-md:min-h-[44px] ${visao === v ? 'bg-brand/10 text-brand' : 'text-muted hover:text-text'} ${FOCO}`}
            >
              {v === 'quadro' ? 'Quadro' : 'Lista'}
            </button>
          ))}
        </div>
        {visao !== 'vivos' && (
          <>
            <input
              data-testid="contratos-busca-quadro"
              aria-label="Buscar contrato"
              placeholder="empresa, CNPJ, nº do contrato"
              className={`${INPUT} !w-[250px] max-w-full font-os-mono max-md:min-h-[44px]`}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <select data-testid="contratos-filtro-dono" aria-label="Sócio" className={`${INPUT} !w-auto max-md:min-h-[44px]`} value={dono} onChange={(e) => setDono(e.target.value)}>
              <option value="">Todos os sócios</option>
              {donos.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {visao === 'lista' && (
              <select data-testid="contratos-filtro-etapa" aria-label="Etapa" className={`${INPUT} !w-auto max-md:min-h-[44px]`} value={etapa} onChange={(e) => setEtapa(e.target.value as '' | EtapaDoQuadro)}>
                <option value="">Todas as etapas</option>
                {ETAPAS_DO_QUADRO.map((x) => <option key={x} value={x}>{ROTULO_DA_ETAPA_DO_QUADRO[x]}</option>)}
              </select>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 min-[820px]:ml-auto">
          {visao !== 'vivos' && editar && <NovoContrato itens={itens} aoCriar={async (leadId) => { await quadro.recarregar(); painel.abrir(leadId, 'contrato', null, 'minuta'); }} />}
          {visao !== 'vivos' && editar && (
            <button type="button" data-testid="contratos-conferir-todas" className={BOTAO} disabled={conferindo || emAssinatura.length === 0} onClick={() => void conferirTodas()}>
              {conferindo ? 'Conferindo…' : 'Conferir assinaturas'}
            </button>
          )}
          <button
            type="button"
            data-testid="contratos-visao-vivos"
            aria-pressed={visao === 'vivos'}
            className={`${BOTAO} ${visao === 'vivos' ? 'border-brand text-brand' : ''}`}
            onClick={() => mudarVisao(visao === 'vivos' ? 'quadro' : 'vivos')}
          >
            Parcelas e encerramento
          </button>
        </div>
      </div>

      {visao === 'vivos' && <ContratosVivos dados={vivos.dados} erro={vivos.erro} carregando={vivos.carregando} recarregar={vivos.recarregar} />}

      {visao && visao !== 'vivos' && (
        <>
          <p className="text-[13px] text-muted">Do fechamento ao fim do contrato, numa tela só. A assinatura muda sozinha pela ZapSign: arrastar só abre o passo seguinte, nunca marca como assinado.</p>
          {quadro.dados && !quadro.dados.assinaturaConfigurada && (
            <p role="status" data-testid="contratos-sem-zapsign" className="rounded border border-warn/50 bg-warn/10 px-3 py-2 text-[13px]">{FRASE_SEM_ZAPSIGN}</p>
          )}
          <Erro erro={quadro.erro} aoTentar={() => void quadro.recarregar()} />
          {quadro.carregando && !quadro.dados && !quadro.erro && <Carregando linhas={2} altura="h-32" />}
          {quadro.dados && <Contagens quadro={quadro.dados} />}
          <ErroDaAcao erro={erroDaConferencia} />
          {respostaDaConferencia && <ResultadoDoLoteNaTela resposta={respostaDaConferencia} itens={itens} />}
          {quadro.dados && visao === 'quadro' && (
            <QuadroDeContratosView itens={visiveis} hoje={diaDeHojeSP()} podeMover={editar} aoMover={abrirPasso} />
          )}
          {quadro.dados && visao === 'lista' && <ListaDeContratos itens={visiveis} podeAgir={editar} aoMudar={quadro.recarregar} />}
        </>
      )}
    </div>
  );
}

/** As contagens do topo: os totais da API, sem filtro nenhum. */
function Contagens({ quadro }: { quadro: QuadroDeContratos }) {
  const { porEtapa, contratadoCentavos } = quadro.totais;
  const semVigencia = quadro.itens.filter((c) => !c.fantasma && c.etapa === 'ativo' && !c.vigenciaFim).length;
  const numeros: { chave: string; rotulo: string; valor: string; dica: string; atencao: boolean }[] = [
    { chave: 'a_emitir', rotulo: 'A emitir', valor: String(porEtapa.a_emitir), dica: 'fechados sem contrato no sistema', atencao: porEtapa.a_emitir > 0 },
    { chave: 'em_assinatura', rotulo: 'Em assinatura', valor: String(porEtapa.em_assinatura + porEtapa.minuta), dica: 'minuta + ZapSign', atencao: false },
    { chave: 'renovar', rotulo: 'A renovar', valor: String(porEtapa.renovar), dica: semVigencia > 0 ? `${semVigencia} sem vigência lançada ficam fora desta conta` : 'vence em até 60 dias ou já venceu', atencao: porEtapa.renovar > 0 },
    { chave: 'a_encerrar', rotulo: 'A encerrar', valor: String(porEtapa.a_encerrar), dica: 'cliente saiu, contrato ficou', atencao: porEtapa.a_encerrar > 0 },
    { chave: 'contratado', rotulo: 'Contratado', valor: reaisOuAusente(contratadoCentavos), dica: `dados do OS em ${dataCompleta(diaDeHojeSP())}`, atencao: false },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="contratos-contagens">
      {numeros.map((n) => (
        <div key={n.chave} data-testid={`contratos-kpi-${n.chave}`} className={`${CARTAO} min-w-0 !p-3`}>
          <p className={`font-os-mono text-[21px] leading-none tabular-nums ${n.atencao ? 'text-warn' : ''}`}>{n.valor}</p>
          <p className={`mt-1.5 ${ROTULO}`}>{n.rotulo}</p>
          <p className="mt-0.5 text-[11px] text-dim">{n.dica}</p>
        </div>
      ))}
    </div>
  );
}
