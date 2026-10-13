'use client';

import type { TorreDasAutomacoes } from '@mktos/shared';
import { COMERCIAL_ROTULO_DA_AUTOMACAO } from '@mktos/shared';

import { diaHoraSP, ehNaoImplementado, horaSP, percentual, reaisOuAusente } from '@/lib/cockpit';

import { Aviso, CARTAO, Carregando, Chip, Erro, Numero, Rotulo, useCarregar } from '../_ui';

/*
 * TELA 12 · A TORRE DAS AUTOMAÇÕES (lane C). Cada automação com o nível de
 * autonomia, a última vez que rodou, o acerto do mês e a premissa conferida
 * pelo vigia. Só lê. Enquanto a API responde 501, a tela diz que a torre
 * ainda não foi entregue, sem mostrar número nenhum.
 */
export default function TorrePage() {
  const { dados: t, erro, carregando } = useCarregar<TorreDasAutomacoes>('/comercial/torre', 60_000);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <p className="text-[13.5px] text-muted">
        O vigia confere as premissas de cada automação todo dia às 08:00 e só avisa o que quebrou. A autonomia sobe de degrau com prova, e quem aprova a subida é gente.
      </p>
      {ehNaoImplementado(erro) ? (
        <Aviso>
          A torre ainda não foi entregue pela API (resposta 501). Nenhum número aparece aqui até o vigia e o relator rodarem de verdade.
        </Aviso>
      ) : (
        <Erro erro={erro} />
      )}
      {carregando && !t && !erro && <Carregando />}
      {t && (
        <>
          <section aria-label="vigia" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Numero valor={t.vigia.ultimaPassagemEm ? horaSP(t.vigia.ultimaPassagemEm) : 'ausente'} legenda={t.vigia.ultimaPassagemEm ? `última passagem do vigia · ${diaHoraSP(t.vigia.ultimaPassagemEm).slice(0, 5)}` : 'o vigia ainda não passou'} />
            <Numero valor={String(t.vigia.premissasConferidas)} legenda="premissas conferidas" />
            <Numero valor={String(t.vigia.premissasQuebradas)} legenda="premissas quebradas" tom={t.vigia.premissasQuebradas ? 'ruim' : undefined} />
            <Numero
              valor={t.custoDesconhecido && t.custoDeIaHojeCentavos == null ? 'desconhecido' : reaisOuAusente(t.custoDeIaHojeCentavos)}
              legenda={t.custoDesconhecido ? 'custo de IA hoje (parte sem preço conhecido)' : 'custo de IA hoje'}
            />
          </section>

          <section className={CARTAO} aria-label="automações">
            <Rotulo>automações</Rotulo>
            <div className="mt-2 hidden grid-cols-[170px_80px_90px_90px_minmax(0,1fr)] gap-3 border-b border-border pb-1.5 font-os-mono text-[10px] uppercase tracking-[0.12em] text-dim md:grid">
              <span>automação</span><span>autonomia</span><span>última vez</span><span>acerto 30 d</span><span>premissa conferida hoje</span>
            </div>
            <ul className="divide-y divide-border">
              {t.automacoes.map((a) => (
                <li key={a.chave} className="grid grid-cols-2 gap-x-3 gap-y-1 py-2 text-[13px] md:grid-cols-[170px_80px_90px_90px_minmax(0,1fr)]">
                  <span className="col-span-2 font-semibold md:col-span-1">{a.rotulo || COMERCIAL_ROTULO_DA_AUTOMACAO[a.chave]}</span>
                  <span><Chip tom={a.autonomia === 'A0' ? 'neutro' : 'brand'}>{a.autonomia}</Chip></span>
                  <span className="font-os-mono text-[12px] text-muted">{a.ultimaVezEm ? horaSP(a.ultimaVezEm) : 'nunca'}</span>
                  <span className="font-os-mono text-[12px]">{percentual(a.acerto30Dias)}</span>
                  <span className="col-span-2 flex gap-2 md:col-span-1">
                    <span aria-hidden className={a.premissaOk == null ? 'text-dim' : a.premissaOk ? 'text-good' : 'text-bad'}>{a.premissaOk == null ? '○' : '●'}</span>
                    <span className={a.premissaOk === false ? 'text-bad' : ''}>{a.premissa}</span>
                    <span className="sr-only">{a.premissaOk == null ? 'não conferida' : a.premissaOk ? 'ok' : 'quebrada'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
