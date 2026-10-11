'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  TOTEM_GESTAO_MINUTOS_ONLINE,
  TOTEM_GESTAO_ROTULO_ESTADO,
  type TotemGestaoCodigoAtivacao,
  type TotemGestaoDispositivo,
  type TotemGestaoEstadoDispositivo,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, inputCls } from '../../referencias/ui';
import { codigoEmBlocos, dataBR, dataHoraBR, haQuantoTempo, horaBR, useLojasDoPainel } from '../lojas/apoio';

/*
 * OS TOTENS DA LOJA — cadastrar, ativar com código, renomear e revogar.
 *
 * O código de ativação aparece UMA vez, na resposta de criar ou de gerar código
 * novo: o banco guarda só o hash. Por isso ele fica na tela até a pessoa fechar,
 * com a validade e o passo a passo, e some ao recarregar a página.
 */

const TOM: Record<TotemGestaoEstadoDispositivo, 'good' | 'bad' | 'warn' | 'muted'> = {
  online: 'good',
  offline: 'bad',
  aguardando_ativacao: 'warn',
  codigo_expirado: 'warn',
  revogado: 'muted',
};

const ENDERECO_DO_TOTEM = 'sragranel.operacaoroot.com/totem';

export default function PaginaDosTotens() {
  const { token, ready, can } = useAuth();
  const pode = can('totem.dispositivos');
  const { lojas } = useLojasDoPainel(token, 'todas');
  const [lojaId, setLojaId] = useState('');
  const [totens, setTotens] = useState<TotemGestaoDispositivo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState({ lojaId: '', nome: '' });
  const [enviando, setEnviando] = useState(false);
  const [codigo, setCodigo] = useState<TotemGestaoCodigoAtivacao | null>(null);
  const [mostrarRevogados, setMostrarRevogados] = useState(false);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<TotemGestaoDispositivo[]>(`/totem-gestao/dispositivos${lojaId ? `?lojaId=${lojaId}` : ''}`, token)
      .then((d) => {
        setTotens(d);
        setErro(null);
      })
      .catch((e: Error) => setErro(e.message));
  }, [token, lojaId]);

  useEffect(() => {
    if (ready && pode) carregar();
  }, [ready, pode, carregar]);

  const lojasAtivas = useMemo(() => (lojas ?? []).filter((l) => l.ativa), [lojas]);
  useEffect(() => {
    if (!novo.lojaId && lojasAtivas.length === 1) setNovo((n) => ({ ...n, lojaId: lojasAtivas[0].id }));
  }, [lojasAtivas, novo.lojaId]);

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setEnviando(true);
    try {
      await acao();
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function cadastrar(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    void executar(async () => {
      const r = await apiPost<TotemGestaoCodigoAtivacao>('/totem-gestao/dispositivos', novo, token);
      setCodigo(r);
      setNovo((n) => ({ ...n, nome: '' }));
    });
  }

  function gerarCodigo(t: TotemGestaoDispositivo) {
    if (!token) return;
    const aviso =
      t.estado === 'online' || t.estado === 'offline'
        ? `Gerar um código novo para "${t.nome}"? O totem continua funcionando até o código novo ser digitado nele ou em outro aparelho.`
        : `Gerar um código novo para "${t.nome}"? O código anterior deixa de valer.`;
    if (!window.confirm(aviso)) return;
    void executar(async () => {
      setCodigo(await apiPost<TotemGestaoCodigoAtivacao>(`/totem-gestao/dispositivos/${t.id}/codigo`, {}, token));
    });
  }

  function renomear(t: TotemGestaoDispositivo) {
    if (!token) return;
    const nome = window.prompt('Novo nome do totem:', t.nome);
    if (!nome || nome.trim() === t.nome) return;
    void executar(async () => {
      await apiPatch(`/totem-gestao/dispositivos/${t.id}`, { nome }, token);
    });
  }

  function revogar(t: TotemGestaoDispositivo) {
    if (!token) return;
    if (
      !window.confirm(
        `Revogar "${t.nome}"? O aparelho perde o acesso na próxima sincronização e volta para a tela de ativação. Para usá-lo de novo, cadastre um totem novo.`,
      )
    )
      return;
    void executar(async () => {
      await apiPost(`/totem-gestao/dispositivos/${t.id}/revogar`, {}, token);
      if (codigo?.dispositivo.id === t.id) setCodigo(null);
    });
  }

  if (!ready) return null;
  if (!pode) {
    return <p className="text-sm text-muted">Você não tem permissão para cadastrar ou revogar totens.</p>;
  }

  const visiveis = (totens ?? []).filter((t) => mostrarRevogados || t.estado !== 'revogado');
  const revogados = (totens ?? []).filter((t) => t.estado === 'revogado').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Totens</h1>
          <p className="text-sm text-muted">
            Cada totem é um aparelho de uma loja. Ele aparece como ligado quando deu sinal nos últimos{' '}
            {TOTEM_GESTAO_MINUTOS_ONLINE} minutos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(lojas?.length ?? 0) > 1 && (
            <select className={`${inputCls} w-auto`} value={lojaId} onChange={(e) => setLojaId(e.target.value)} aria-label="Filtrar por loja">
              <option value="">Todas as lojas</option>
              {lojas!.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          )}
          <Botao onClick={carregar}>Atualizar</Botao>
        </div>
      </div>

      {erro && <p className="text-sm text-bad">{erro}</p>}

      {codigo && <CodigoNaTela codigo={codigo} aoFechar={() => setCodigo(null)} />}

      <Card titulo="Cadastrar um totem">
        {lojasAtivas.length === 0 ? (
          <p className="text-sm text-muted">Não há loja ativa no seu escopo. Cadastre ou reative uma loja antes de cadastrar o totem.</p>
        ) : (
          <form onSubmit={cadastrar} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <select
              className={inputCls}
              required
              value={novo.lojaId}
              onChange={(e) => setNovo({ ...novo, lojaId: e.target.value })}
              aria-label="Loja do totem"
            >
              <option value="">Escolha a loja</option>
              {lojasAtivas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
            <input
              className={inputCls}
              required
              minLength={2}
              maxLength={80}
              placeholder="Nome do totem, por exemplo Entrada"
              value={novo.nome}
              onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
            />
            <Botao type="submit" tone="brand" disabled={enviando}>
              {enviando ? 'Gerando…' : 'Gerar código'}
            </Botao>
          </form>
        )}
      </Card>

      <Card titulo={`Totens cadastrados · ${visiveis.length}`}>
        {!totens ? (
          <p className="text-[12px] text-muted">Carregando os totens…</p>
        ) : visiveis.length === 0 ? (
          <p className="text-[12px] text-muted">Nenhum totem cadastrado aqui ainda.</p>
        ) : (
          <ul className="space-y-2">
            {visiveis.map((t) => (
              <li key={t.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{t.nome}</p>
                    <p className="text-[12px] text-muted">{t.lojaNome}</p>
                  </div>
                  <Chip tone={TOM[t.estado]}>{TOTEM_GESTAO_ROTULO_ESTADO[t.estado]}</Chip>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  {t.estado === 'revogado'
                    ? `Revogado em ${dataHoraBR(t.revogadoEm)}.`
                    : t.ativadoEm
                      ? `Ativado em ${dataBR(t.ativadoEm)}. Último sinal ${haQuantoTempo(t.vistoEm)}.${t.versaoApp ? ` Versão ${t.versaoApp}.` : ''}`
                      : t.estado === 'aguardando_ativacao' && t.ativacaoExpiraEm
                        ? `O código vale até ${horaBR(t.ativacaoExpiraEm)}.`
                        : 'O código venceu sem ser usado. Gere um código novo para ativar.'}
                  {t.ativadoEm && t.ativacaoExpiraEm && ` Há um código novo pendente até ${horaBR(t.ativacaoExpiraEm)}.`}
                </p>
                {t.estado !== 'revogado' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Botao onClick={() => gerarCodigo(t)} disabled={enviando}>
                      Gerar código novo
                    </Botao>
                    <Botao onClick={() => renomear(t)} disabled={enviando}>
                      Renomear
                    </Botao>
                    <Botao tone="bad" onClick={() => revogar(t)} disabled={enviando}>
                      Revogar
                    </Botao>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {revogados > 0 && (
          <button
            type="button"
            onClick={() => setMostrarRevogados((v) => !v)}
            className="mt-3 text-[11px] text-muted underline underline-offset-2"
          >
            {mostrarRevogados ? 'Esconder os revogados' : `Mostrar os revogados (${revogados})`}
          </button>
        )}
      </Card>
    </div>
  );
}

function CodigoNaTela({ codigo, aoFechar }: { codigo: TotemGestaoCodigoAtivacao; aoFechar: () => void }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const restam = Math.ceil((new Date(codigo.expiraEm).getTime() - agora) / 60_000);
  const vencido = restam <= 0;

  return (
    <section className="rounded-xl border border-brand/40 bg-surface p-5" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            Código de ativação de {codigo.dispositivo.nome} ({codigo.dispositivo.lojaNome})
          </h2>
          <p
            className={`mt-3 select-all font-os-mono text-4xl font-bold tracking-[0.2em] sm:text-5xl ${vencido ? 'text-muted line-through' : ''}`}
          >
            {codigoEmBlocos(codigo.codigo)}
          </p>
        </div>
        <Botao tone="ghost" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
      <p className={`mt-3 text-sm ${vencido ? 'text-bad' : 'text-muted'}`}>
        {vencido
          ? 'Este código venceu. Gere um código novo na lista de totens.'
          : `O código vale até ${horaBR(codigo.expiraEm)} de ${dataBR(codigo.expiraEm)}, ou seja, por mais ${restam} minuto(s).`}
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>
          Abra <span className="font-medium">{ENDERECO_DO_TOTEM}</span> no totem e digite o código.
        </li>
        <li>O hífen é opcional, e letra minúscula também vale.</li>
        <li>Este código aparece só agora. Se você fechar esta caixa, gere outro na lista de totens.</li>
      </ol>
    </section>
  );
}
