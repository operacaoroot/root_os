'use client';

import { useState, type ReactNode } from 'react';
import { textoDoEstadoDoCartao, type CartaoDeConexao as Linha, type QuemUsaOConector } from '@mktos/shared';

/*
 * O CARTÃO DE CONEXÃO — rodada dos agentes, lane A6 (21/10/2026).
 *
 * UM componente de layout para TODO conector da tela de Conexões. O servidor
 * decide (`GET /integrations/cartoes`); o cartão só desenha, sempre na mesma
 * ordem:
 *
 *   1. nome e estado, no vocabulário único (Conectado · Não configurado ·
 *      Erro: <motivo> · Desligado; "Não verificado" só em linha sem sonda);
 *   2. para que serve;
 *   3. quem usa (agentes, rotinas e automações do cadastro único);
 *   4. a medição (com a hora), a conta ligada, a última sincronização e a
 *      credencial no cofre (o fato, nunca o valor);
 *   5. o conteúdo próprio do conector, quando há (o QR da Evolution, a senha do
 *      Zap do Granola), como filho;
 *   6. as ações: Conectar, Testar, Desconectar e Desligar (ou Religar).
 *
 * Desconectar QUEIMA a credencial desta empresa e só existe quando ela é da
 * empresa; Desligar PAUSA (a credencial fica) e pede motivo. As duas pedem uma
 * segunda confirmação, e nenhuma é a mesma rota da outra.
 */

export interface AcoesDoCartao {
  conectar?: () => void;
  testar?: () => void;
  sincronizar?: () => void;
  desconectar?: (motivo: string) => void;
  desligar?: (motivo: string) => void;
  religar?: () => void;
}

const COR: Record<Linha['estado'], string> = {
  conectado: 'border-good/30 bg-good/10 text-good',
  nao_configurado: 'border-border bg-surface-2 text-muted',
  erro: 'border-bad/30 bg-bad/10 text-bad',
  desligado: 'border-warn/40 bg-warn/10 text-warn',
  nao_verificado: 'border-border bg-surface-2 text-muted',
};

const TIPO: Record<QuemUsaOConector['tipo'], string> = { agente: 'agente', rotina: 'rotina', automacao: 'automação' };
const ESTADO_DA_FUNCAO: Record<QuemUsaOConector['estado'], string> = {
  ativo: '',
  desligado: ' · desligado',
  'so-homologacao': ' · só homologação',
  aposentado: ' · aposentado',
};

export function quandoFoi(iso: string | null, agora = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((agora - t) / 1000));
  const absoluto = new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
  if (s < 60) return `${absoluto} (há ${s} s)`;
  if (s < 3600) return `${absoluto} (há ${Math.round(s / 60)} min)`;
  return absoluto;
}

const botao = 'rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50';

export function CartaoDeConexao({
  linha,
  acoes = {},
  ocupado = false,
  largo = false,
  children,
}: {
  linha: Linha;
  acoes?: AcoesDoCartao;
  ocupado?: boolean;
  /** Ocupa a linha inteira da grade (conectores com conteúdo próprio grande). */
  largo?: boolean;
  children?: ReactNode;
}) {
  const [confirmar, setConfirmar] = useState<'desconectar' | 'desligar' | null>(null);
  const [motivo, setMotivo] = useState('');
  const estado = textoDoEstadoDoCartao(linha.estado, linha.motivo);
  const daEmpresa = linha.contrato?.escopoDaCredencial === 'empresa';
  const nomeDoAlvo = linha.grupo ? `${linha.contrato?.rotulo ?? linha.nome} (todas as superfícies)` : linha.nome;

  const fechar = () => {
    setConfirmar(null);
    setMotivo('');
  };

  return (
    <section
      aria-label={linha.nome}
      data-conector={linha.key}
      className={`flex min-w-0 flex-col rounded-xl border bg-surface p-4 ${largo ? 'md:col-span-2 xl:col-span-3' : ''} ${linha.estado === 'desligado' ? 'border-warn/40' : 'border-border'}`}
    >
      {/* 1. nome e estado */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 text-[1.02rem] font-semibold text-text">{linha.nome}</h2>
        {linha.estado !== 'erro' && (
          <span data-testid={`estado-${linha.key}`} className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${COR[linha.estado]}`}>
            {estado}
          </span>
        )}
      </div>
      {linha.estado === 'erro' && (
        <p data-testid={`estado-${linha.key}`} className={`mt-2 break-words rounded border px-2 py-1 text-xs font-medium ${COR.erro}`}>
          {estado}
        </p>
      )}
      {linha.estado !== 'erro' && linha.estado !== 'conectado' && linha.motivo && (
        <p className="mt-1 break-words text-[11px] text-muted">{linha.motivo}</p>
      )}

      {/* 2. para que serve */}
      <p className="mt-2 text-xs text-text">{linha.paraQueServe}</p>

      {/* 3. quem usa */}
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-muted">Quem usa</div>
        {linha.usadoPor.length ? (
          <ul className="mt-1 flex flex-wrap gap-1" aria-label={`Quem usa ${linha.nome}`}>
            {linha.usadoPor.map((u) => (
              <li key={u.id} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text" title={u.id}>
                {u.nome} <span className="text-muted">({TIPO[u.tipo]}{ESTADO_DA_FUNCAO[u.estado]})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-muted">Nenhum agente nem rotina usa este conector hoje.</p>
        )}
      </div>

      {/* 4. medição, conta, sincronização, cofre */}
      <dl className="mt-3 grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-muted">Medido em</dt>
        <dd className="text-text" data-testid={`medido-${linha.key}`}>
          {linha.estado === 'desligado' ? 'não medido: desligado' : quandoFoi(linha.medidoEm)}
          {linha.latenciaMs !== null && linha.estado !== 'desligado' ? ` · ${linha.latenciaMs} ms` : ''}
        </dd>
        <dt className="text-muted">Conta ligada</dt>
        <dd className="min-w-0 break-words text-text">{linha.conta ?? '—'}</dd>
        <dt className="text-muted">Última sincronização</dt>
        <dd className="text-text">{quandoFoi(linha.ultimaSincronizacao)}</dd>
        <dt className="text-muted">Credencial</dt>
        <dd className="text-text">
          {linha.credencialNoCofre
            ? 'guardada no cofre desta empresa'
            : linha.contrato?.escopoDaCredencial === 'processo'
              ? 'do processo (ambiente da API)'
              : 'nenhuma guardada'}
        </dd>
        {linha.contrato && linha.contrato.linhasIrmas.length > 0 && (
          <>
            <dt className="text-muted">Mesma credencial</dt>
            <dd className="text-text">{linha.contrato.linhasIrmas.join(', ')}</dd>
          </>
        )}
        {linha.desligado && linha.desligadoEm && (
          <>
            <dt className="text-muted">Desligado em</dt>
            <dd className="text-warn">{quandoFoi(linha.desligadoEm)}</dd>
          </>
        )}
      </dl>

      {/* 5. o conteúdo próprio do conector */}
      {children && <div className="mt-3 border-t border-border pt-3">{children}</div>}

      {/* 6. as ações */}
      <div className="mt-auto pt-4">
        <div className="flex flex-wrap gap-2">
          {acoes.conectar && !linha.desligado && (
            <button type="button" disabled={ocupado} onClick={acoes.conectar} className={`${botao} border-brand/50 text-brand`}>Conectar</button>
          )}
          {acoes.testar && (
            <button type="button" disabled={ocupado} onClick={acoes.testar} className={`${botao} border-border text-muted`}
              title="Sonda agora. Desligado, nada é chamado.">Testar</button>
          )}
          {acoes.sincronizar && !linha.desligado && (
            <button type="button" disabled={ocupado} onClick={acoes.sincronizar} className={`${botao} border-border text-muted`}>Sincronizar</button>
          )}
          {acoes.desconectar && daEmpresa && (
            <button type="button" disabled={ocupado} onClick={() => { setConfirmar('desconectar'); setMotivo(''); }}
              className={`${botao} border-bad/40 text-bad`}>Desconectar</button>
          )}
          {linha.desligado
            ? acoes.religar && (
              <button type="button" disabled={ocupado} onClick={acoes.religar} className={`${botao} border-warn/40 text-warn`}>Religar</button>
            )
            : acoes.desligar && (
              <button type="button" disabled={ocupado} onClick={() => { setConfirmar('desligar'); setMotivo(''); }}
                className={`${botao} border-border text-muted`}>Desligar</button>
            )}
        </div>

        {confirmar && (
          <div className={`mt-3 space-y-2 rounded-lg border p-2 text-[11px] ${confirmar === 'desconectar' ? 'border-bad/40' : 'border-warn/40'}`}>
            <p className={confirmar === 'desconectar' ? 'text-bad' : 'text-text'}>
              {confirmar === 'desconectar'
                ? `Desconectar queima a credencial de ${linha.contrato?.rotulo ?? linha.nome} desta empresa no cofre. Não tem volta: para usar de novo, é preciso conectar outra vez. Para só pausar, use Desligar.`
                : `Desligar ${nomeDoAlvo} pausa o conector nesta empresa: a credencial fica guardada. ${linha.textoDoDesligamento}`}
            </p>
            <label className="block">
              <span className="text-muted">Motivo</span>
              <input value={motivo} maxLength={500} disabled={ocupado} onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text" />
            </label>
            <div className="flex gap-3">
              <button type="button" disabled={ocupado} className="font-medium text-bad disabled:opacity-50"
                onClick={() => {
                  const m = motivo.trim();
                  if (confirmar === 'desconectar') acoes.desconectar?.(m);
                  else acoes.desligar?.(m);
                  fechar();
                }}>
                {confirmar === 'desconectar' ? 'Desconectar agora' : 'Desligar agora'}
              </button>
              <button type="button" onClick={fechar} className="text-muted">Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
