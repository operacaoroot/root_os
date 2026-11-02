'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { IDEIAS_POR_DIA, RELEVANCIA_QUE_FURA_O_CORTE, type FluxoDasIdeias as Fluxo, type FluxoEtapa } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Marketing › Ideias de conteúdo › Fontes › "Como as ideias chegam" (30/10/2026, pedido do
 * Lucas: quantas vão ser, como e que horas sai). Três passos: a coleta (rotina da pauta),
 * a IA das ideias (rotina do Marketing, agente CT-21) e a aprovação. Só leitura: ligar,
 * desligar e rodar agora ficam num lugar só, IA e automações › Rotinas automáticas (02/11/2026).
 */

const dataHora = (s: string | null) => {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};
const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FluxoDasIdeias() {
  const { token, ready } = useAuth();
  const [fluxo, setFluxo] = useState<Fluxo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setFluxo(await apiGet<Fluxo>('/marketing/estudio/fluxo', token));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  if (!fluxo) return erro ? <div className="notice warn">{erro}</div> : null;
  const { coleta, ia, fontes, apify, agora } = fluxo;

  const estado = (e: FluxoEtapa) => <span className={`badge${e.ativo ? ' success' : ''}`}>{e.ativo ? 'Ligada' : 'Desligada'}</span>;
  const rodape = (e: FluxoEtapa) => (
    <div className="fluxo-rodape">
      {e.ultimaEm ? (
        <p>
          <strong>Última:</strong> {dataHora(e.ultimaEm)}
          {e.ultimoResumo ? ` · ${e.ultimoResumo}` : ''}
        </p>
      ) : (
        <p>Ainda não rodou.</p>
      )}
      <p>
        <strong>Próxima:</strong> {e.ativo ? dataHora(e.proximaEm) : 'desligada, não roda'}
      </p>
    </div>
  );

  return (
    <section className="panel fluxo">
      <div className="row between">
        <div>
          <h2>Como as ideias chegam</h2>
          <span className="muted tiny">
            Duas etapas rodam sozinhas toda noite. Para ligar, desligar ou rodar agora: <Link href="/rotinas">IA e automações › Rotinas automáticas</Link>.
          </span>
        </div>
        <Link className="ideias-link-btn" href="/marketing/triagem?ver=todas">
          Ver as {agora.paraAvaliar} para avaliar
        </Link>
      </div>
      {erro && <div className="notice warn">{erro}</div>}
      {!fluxo.iaConfigurada && <div className="notice warn">A IA está sem chave no servidor: a etapa 2 não monta cards até a chave voltar.</div>}
      <ol className="fluxo-etapas">
        <li className={`fluxo-etapa${coleta?.ativo ? '' : ' fluxo-off'}`}>
          <div className="row between">
            <span className="eyebrow">1 · Coleta</span>
            {coleta && estado(coleta)}
          </div>
          <h3>{coleta ? coleta.quando : 'Sem rotina de coleta'}</h3>
          <p>
            {fontes.ligadas} {fontes.ligadas === 1 ? 'fonte ligada' : 'fontes ligadas'}. {fontes.perfis} {fontes.perfis === 1 ? 'perfil' : 'perfis'} pelo Apify, até {fontes.postsPorPerfil} posts novos cada:{' '}
            <strong>até {fontes.itensPorDiaPerfis} posts por coleta</strong>
            {fontes.gratis ? `, mais o que ${fontes.gratis} ${fontes.gratis === 1 ? 'site ou canal trouxer' : 'sites e canais trouxerem'} (grátis)` : ''}. Post repetido não entra de novo.
          </p>
          {apify && (
            <p className="fluxo-custo">
              Apify: {usd(apify.usadoUsd)} de {usd(apify.tetoUsd)} no ciclo
              {apify.custoPorColeta ? ` · cerca de ${usd(apify.custoPorColeta)} por perfil` : ''}
              {apify.diasQueDa !== null ? ` · com todos os perfis, o crédito dá para mais ${apify.diasQueDa} ${apify.diasQueDa === 1 ? 'dia' : 'dias'} de coleta` : ''}. Em 90% do crédito a coleta de perfis para até o ciclo virar
              {apify.voltaEm ? ` (${new Date(apify.voltaEm).toLocaleDateString('pt-BR')})` : ''}.
            </p>
          )}
          {coleta && rodape(coleta)}
        </li>
        <li className={`fluxo-etapa${ia.ativo ? '' : ' fluxo-off'}`}>
          <div className="row between">
            <span className="eyebrow">2 · IA monta as ideias</span>
            {estado(ia)}
          </div>
          <h3>{ia.quando}</h3>
          <p>
            Lê o que a coleta e a Memória trouxeram, até 200 itens por noite, com a marca, as réguas e o que vocês aprovaram e recusaram. Escreve título, gancho, formato e por que tem a ver. O que está fora do tema vai para <em>Descartadas pela IA</em>.
          </p>
          <p>
            <strong>Curadoria:</strong> das fontes, só as {IDEIAS_POR_DIA} de maior relevância do dia chegam para avaliar. A que a IA dá {RELEVANCIA_QUE_FURA_O_CORTE} ou mais entra mesmo passando de {IDEIAS_POR_DIA}. O resto fica na <em>Reserva</em>, de onde dá para aprovar ou trazer. Nota que vocês mandam da Memória não entra no corte.
          </p>
          <p className="fluxo-agora">
            <strong>{agora.esperandoIa}</strong> esperando a IA{agora.semLeitura ? ` · ${agora.semLeitura} cards sem leitura` : ''}
          </p>
          {rodape(ia)}
        </li>
        <li className="fluxo-etapa">
          <span className="eyebrow">3 · Vocês aprovam</span>
          <h3>Em Para aprovar</h3>
          <p>Aprovar manda a ideia para o Banco da Produção; recusar ensina a IA (o peso da fonte desce).</p>
          <p className="fluxo-agora">
            <strong>{agora.paraAvaliar}</strong> para avaliar · {agora.reserva} na Reserva · {agora.aprovadasSemana} aprovadas nos últimos 7 dias · {agora.descartadasIa} descartadas pela IA
          </p>
        </li>
      </ol>
    </section>
  );
}
