'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, inputCls } from '../referencias/ui';
import { NovaRotinaDeColeta } from './NovaRotinaDeColeta';
import { NovaRotinaDeEncadeamento } from './NovaRotinaDeEncadeamento';
import {
  ESTADOS,
  TIPO_PAUTA_COLETA,
  TIPO_PAUTA_ENCADEAR,
  type ResultadoDoRodar,
  emHoras,
  quando,
  tomDoEstado,
  type EstadoDaRotina,
  type ExecucaoResumo,
  type RotinaResumo,
  type RotinasList,
} from './tipos';
import {
  DIAS_DA_JANELA,
  LIMITE_DO_HISTORICO,
  horasDaRotina,
  totalDaSemana,
  type HorasDaRotina,
  type TotalDaSemana,
} from './horas';

/*
 * A TELA DE ROTINAS — RF-N-04.
 *
 * Até aqui `/rotinas` caía no placeholder de módulo sem tela. O que ela mostra
 * agora é dado real, e três coisas que a tela antiga de Pauta não tinha como
 * dizer:
 *
 *  · O ESTADO DECLARADO (rodando · aprendendo · planejada · pausada), separado
 *    do interruptor. "Está ligada" e "está em produção" são perguntas
 *    diferentes, e juntá-las num botão só é como a distinção se perde. NA
 *    ROTINA ESPELHADA DA PAUTA os dois andam juntos, e de propósito: lá embaixo
 *    a tela de Pauta tem um interruptor só, e deixá-lo ligado enquanto aqui se
 *    declara "pausada" faria a tela antiga dizer que está tudo de pé enquanto
 *    nada dispara.
 *  · O HISTÓRICO. Cada passagem com início, duração, desfecho e o motivo quando
 *    deu errado — em vez de um `ultimoStatus` que a próxima execução apaga.
 *  · O TEMPO DEVOLVIDO (RF-N-05), que só aparece quando ALGUÉM DECLAROU a linha
 *    de base. Sem declaração a tela mostra travessão; número inventado aqui
 *    seria pior do que número nenhum.
 *
 * O TEMPO DEVOLVIDO VIROU POR SEMANA (fatia 5.6), e mudou de fonte junto. Antes
 * a tela somava `minutosDevolvidos`, que a API calcula como linha de base ×
 * `Rotina.execucoes` — um acumulado de vida inteira que conta as passagens que
 * DERAM ERRO como tempo devolvido. Agora a conta sai do log real de passagens
 * (`/rotinas/:id/execucoes`), só com desfecho `ok`, na janela de sete dias: é o
 * número que alguém pode conferir linha a linha, e é a forma em que ele serve
 * para renovação ("esta rotina devolve X horas por semana"). A conta inteira,
 * com o que entra e o que não entra, está em `horas.ts`.
 *
 * A tela cria UM tipo de rotina: a coleta de quinta da pauta (MC5), pelo
 * `POST /rotinas`, só quando a API a oferece (executor inscrito e módulo pauta
 * contratado) e só enquanto a empresa não tem uma — a segunda dobraria Apify e
 * IA na mesma noite, e rotina não se apaga, só se desliga. O criador
 * genérico continua fora: escolher executor é decisão de produto, e cada tipo
 * novo que precisar de tela ganha o formulário dele. A rotina da pauta de antes
 * segue nascendo na tela de Pauta.
 */
export default function RotinasPage() {
  const { token, ready, can } = useAuth();
  const [data, setData] = useState<RotinasList | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [historico, setHistorico] = useState<Record<string, ExecucaoResumo[]>>({});
  const [minutos, setMinutos] = useState<Record<string, string>>({});
  /*
   * O HISTÓRICO QUE ALIMENTA A MEDIÇÃO — separado do que o botão "Histórico"
   * abre, e de propósito.
   *
   * O de baixo é para LER (30 linhas, sob demanda, quando alguém expande). Este
   * é para CONTAR: vai até o teto do endpoint e é buscado sozinho, para cada
   * rotina que tem linha de base declarada. Reaproveitar um no outro faria a
   * medição depender de alguém ter clicado, e o número da tela apareceria e
   * sumiria conforme o que estivesse aberto.
   */
  const [passagens, setPassagens] = useState<Record<string, ExecucaoResumo[]>>({});

  const editavel = can('automacoes.executar');

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<RotinasList>('/rotinas', token)
      .then(setData)
      .catch((e: Error) => setErro(e.message));
  }, [token]);

  useEffect(() => {
    if (ready) carregar();
  }, [ready, carregar]);

  /*
   * Uma busca por rotina COM LINHA DE BASE — as outras não têm o que medir, e
   * pedir o histórico delas seria consulta paga por nada. Falha de uma não
   * derruba as outras nem vira tarja vermelha: a rotina fica sem medição, o
   * total diz quantas ficaram de fora, e é isso que a tela mostra.
   */
  useEffect(() => {
    if (!token || !data) return;
    const alvos = data.items.filter((r) => r.minutosPorExecucao !== null);
    if (alvos.length === 0) return;
    let vivo = true;
    Promise.all(
      alvos.map((r) =>
        apiGet<ExecucaoResumo[]>(`/rotinas/${r.id}/execucoes?limite=${LIMITE_DO_HISTORICO}`, token)
          .then((linhas) => [r.id, linhas] as const)
          .catch(() => [r.id, null] as const),
      ),
    ).then((pares) => {
      if (!vivo) return;
      const lidas: Record<string, ExecucaoResumo[]> = {};
      for (const [id, linhas] of pares) if (linhas) lidas[id] = linhas;
      setPassagens(lidas);
    });
    return () => {
      vivo = false;
    };
  }, [token, data]);

  async function agir(id: string, fn: () => Promise<unknown>) {
    setErro(null);
    setAviso(null);
    setOcupado(id);
    try {
      await fn();
      carregar();
      if (aberta === id) await abrirHistorico(id, true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function abrirHistorico(id: string, forcar = false) {
    if (!forcar && aberta === id) {
      setAberta(null);
      return;
    }
    setAberta(id);
    try {
      const linhas = await apiGet<ExecucaoResumo[]>(`/rotinas/${id}/execucoes?limite=30`, token);
      setHistorico((h) => ({ ...h, [id]: linhas }));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const rodando = data?.items.filter((r) => r.estado === 'rodando').length ?? 0;
  const emFalha = data?.items.filter((r) => r.ultimoStatus?.startsWith('erro')).length ?? 0;

  /*
   * A MEDIÇÃO, uma por rotina, refeita a cada render. É aritmética sobre o que
   * já está em memória — nenhuma busca acontece aqui. `agora` é lido uma vez
   * por render para que todas as rotinas sejam medidas contra o MESMO instante.
   */
  const agora = Date.now();
  const medidas: Record<string, HorasDaRotina> = {};
  for (const r of data?.items ?? []) medidas[r.id] = horasDaRotina(r, passagens[r.id], agora);
  const total = totalDaSemana(Object.values(medidas));

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        O trabalho que acontece sozinho nesta empresa. Cada rotina tem um horário, um estado
        declarado e um histórico — e só dispara quando o estado e o interruptor concordam.
      </p>

      {erro && (
        <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>
      )}

      {aviso && (
        <div role="status" className="rounded-root border border-brand/40 bg-brand/10 p-3 text-sm">
          Não rodou: {aviso}
        </div>
      )}

      {data?.descobertaCega && (
        <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          <strong>Nenhuma rotina está disparando — em empresa nenhuma.</strong> A pergunta que
          descobre quais empresas têm rotina roda fora de requisição, sem empresa na sessão, e o
          isolamento por linha a devolve vazia. Não é falta de rotina: é a conexão desta API não
          atravessar a policy. O conserto é de infraestrutura (dar <code className="text-xs">BYPASSRLS</code>{' '}
          ao papel da aplicação, ou mover a descoberta para um comando de manutenção) e está em{' '}
          <code className="text-xs">docs/DEPLOY.md</code>. O que esta tela mostra abaixo é o estado
          guardado, não o que está acontecendo.
        </div>
      )}

      {data && data.avisos.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <p className="font-medium">A última reconciliação com a tela de Pauta tropeçou:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {data.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {data && !data.agendadorAtivo && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <code className="text-xs">ROTINAS_CRON=off</code> — nenhuma rotina dispara sozinha nesta
          instância. Dá para rodar na mão pelo botão de cada uma.
        </div>
      )}

      {data?.pautaDesligadaPorVariavel && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          <code className="text-xs">PAUTA_CRON=off</code> — as rotinas de pauta ficam de fora do
          agendador. A variável é apelido de compatibilidade: para pausar uma rotina, use o estado
          aqui; para desligar o agendador inteiro, <code className="text-xs">ROTINAS_CRON=off</code>.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Numero label="Rodando" valor={rodando} />
        <Numero label="Com erro na última" valor={emFalha} tom={emFalha > 0 ? 'bad' : undefined} />
        <Numero
          label="Horas devolvidas / semana"
          valor={total.vazio ? '—' : `${emHoras(total.minutos)}${total.parciais > 0 ? '+' : ''}`}
          // Enquanto a lista não chegou, a legenda NÃO pode dizer "nenhuma
          // rotina para medir": é uma afirmação sobre a empresa, e ainda não se
          // sabe nada sobre ela.
          nota={data ? notaDoTotal(total) : 'carregando…'}
        />
        <Numero label="Rotinas" valor={data?.items.length ?? 0} />
      </div>

      {/*
        A PROCEDÊNCIA DO NÚMERO, na tela e não só no código.
        Ele vai para conversa de renovação, e quem o apresenta precisa conseguir
        responder "de onde saiu isso?" sem abrir o repositório.
      */}
      <p className="text-[11px] leading-[1.6] text-muted">
        <span className="text-text">Como esta conta é feita:</span> passagens com desfecho{' '}
        <code className="text-[10px]">ok</code> nos últimos {DIAS_DA_JANELA} dias, contadas uma a uma
        no histórico de cada rotina, multiplicadas pelos minutos que alguém declarou aqui como linha
        de base — o tempo que uma pessoa gastava por execução. Passagem que falhou não devolve tempo
        e não entra. Rotina sem linha de base declarada fica <span className="text-text">fora</span>{' '}
        da conta: não entra como zero nem com estimativa. O sinal{' '}
        <span className="text-text">+</span> quer dizer que alguma rotina passou mais de{' '}
        {LIMITE_DO_HISTORICO} vezes na semana e o histórico lido não cobre os {DIAS_DA_JANELA} dias
        inteiros — ali o número é piso, não total.
      </p>

      {editavel &&
        data?.tiposDisponiveis?.includes(TIPO_PAUTA_COLETA) &&
        !data.items.some((r) => r.tipo === TIPO_PAUTA_COLETA) && (
          <NovaRotinaDeColeta token={token} onCriada={carregar} />
        )}

      {editavel &&
        data?.tiposDisponiveis?.includes(TIPO_PAUTA_ENCADEAR) &&
        !data.items.some((r) => r.tipo === TIPO_PAUTA_ENCADEAR) && (
          <NovaRotinaDeEncadeamento token={token} onCriada={carregar} />
        )}

      {data && data.items.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Nenhuma rotina nesta empresa ainda. A rotina de pauta aparece aqui sozinha assim que for
            criada na tela de Pauta; a coleta de quinta nasce pelo botão acima.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {data?.items.map((r) => (
          <Linha
            key={r.id}
            rotina={r}
            medida={medidas[r.id]}
            editavel={editavel}
            ocupado={ocupado === r.id}
            aberta={aberta === r.id}
            historico={historico[r.id] ?? []}
            minutos={minutos[r.id] ?? ''}
            onMinutos={(v) => setMinutos((m) => ({ ...m, [r.id]: v }))}
            onAbrir={() => abrirHistorico(r.id)}
            onRodar={() =>
              agir(r.id, async () => {
                // A passagem pulada não grava histórico: sem isto o clique não dá retorno nenhum.
                const res = await apiPost<ResultadoDoRodar>(`/rotinas/${r.id}/rodar`, {}, token);
                if (res?.status === 'pulada') setAviso(res.resumo);
              })
            }
            onEstado={(estado) => agir(r.id, () => apiPatch(`/rotinas/${r.id}`, { estado }, token))}
            onAtivo={(ativo) => agir(r.id, () => apiPatch(`/rotinas/${r.id}`, { ativo }, token))}
            onLinhaDeBase={(n) =>
              agir(r.id, async () => {
                await apiPatch(`/rotinas/${r.id}`, { minutosPorExecucao: n }, token);
                setMinutos((m) => ({ ...m, [r.id]: '' }));
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A legenda do total. Ela diz o que ficou DE FORA, porque é isso que decide se
 * o número pode ser apresentado como "o tempo que o OS devolve nesta empresa"
 * ou só como "o que deu para medir até agora".
 */
function notaDoTotal(t: TotalDaSemana): string {
  const fora: string[] = [];
  if (t.semLinhaDeBase > 0) fora.push(`${t.semLinhaDeBase} sem linha de base declarada`);
  if (t.semHistorico > 0) fora.push(`${t.semHistorico} com o histórico ainda não lido`);

  if (t.vazio) {
    return fora.length
      ? `nada medido — ${fora.join('; ')}`
      : 'nenhuma rotina para medir nesta empresa';
  }

  const partes = [`${t.contadas} rotina(s) medida(s)`];
  if (t.parciais > 0) partes.push(`${t.parciais} com a semana só parcialmente coberta`);
  if (fora.length) partes.push(`fora da conta: ${fora.join('; ')}`);
  return partes.join(' · ');
}

/**
 * A linha de tempo devolvido de UMA rotina, em uma frase.
 *
 * Devolve `null` quando não há nada honesto a dizer — e nesse caso a tela não
 * escreve nada, em vez de escrever um zero.
 */
function fraseDaMedida(m: HorasDaRotina | undefined): string | null {
  if (!m) return null;
  if (m.estado === 'sem-linha-de-base') return 'tempo devolvido: falta declarar a linha de base';
  if (m.estado === 'sem-historico') return 'tempo devolvido: lendo o histórico…';
  const conta = `${m.execucoesNaSemana} × ${m.minutosPorExecucao}min nos últimos ${DIAS_DA_JANELA} dias`;
  const piso = m.janelaCoberta ? '' : ' · no mínimo: a semana não coube no histórico';
  return `${emHoras(m.minutosNaSemana ?? 0)}/semana devolvidos (${conta})${piso}`;
}

function Numero({
  label,
  valor,
  nota,
  tom,
}: {
  label: string;
  valor: number | string;
  nota?: string;
  tom?: 'bad';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tom === 'bad' ? 'text-bad' : ''}`}>{valor}</p>
      {nota && <p className="mt-1 text-[11px] text-muted">{nota}</p>}
    </div>
  );
}

function Linha({
  rotina: r,
  medida,
  editavel,
  ocupado,
  aberta,
  historico,
  minutos,
  onMinutos,
  onAbrir,
  onRodar,
  onEstado,
  onAtivo,
  onLinhaDeBase,
}: {
  rotina: RotinaResumo;
  medida: HorasDaRotina | undefined;
  editavel: boolean;
  ocupado: boolean;
  aberta: boolean;
  historico: ExecucaoResumo[];
  minutos: string;
  onMinutos: (v: string) => void;
  onAbrir: () => void;
  onRodar: () => void;
  onEstado: (estado: EstadoDaRotina) => void;
  onAtivo: (ativo: boolean) => void;
  onLinhaDeBase: (n: number) => void;
}) {
  const n = Number(minutos);
  const minutosValidos = minutos !== '' && Number.isInteger(n) && n >= 0 && n <= 1440;
  const frase = fraseDaMedida(medida);

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={tomDoEstado(r.estado)}>
              {ESTADOS.find((e) => e.valor === r.estado)?.rotulo ?? r.estado}
            </Chip>
            {!r.ativo && <Chip tone="warn">interruptor desligado</Chip>}
            {!r.temExecutor && <Chip tone="bad">sem executor</Chip>}
            <code className="text-[11px] text-muted">{r.cron}</code>
            <Chip>{r.tz}</Chip>
            {r.agenteSlug && <Chip>{r.agenteSlug}</Chip>}
          </div>

          <p className="mt-1 text-sm">
            {r.nome} <span className="text-muted">· {r.slug}</span>
          </p>

          <p className="mt-0.5 text-[11px] text-muted">
            {r.dispara
              ? `próxima: ${quando(r.proximaExecucaoEm)}`
              : 'não dispara no estado atual'}
            {' · '}última: {quando(r.ultimaExecucaoEm)}
            {' · '}
            {r.execucoes} execução(ões), {r.falhas} falha(s)
          </p>

          {frase && (
            <p
              className={`mt-0.5 text-[11px] ${
                medida?.estado === 'medida' ? 'text-good' : 'text-muted'
              }`}
            >
              {frase}
            </p>
          )}

          {r.ultimoStatus && (
            <p
              className={`mt-0.5 text-xs ${r.ultimoStatus.startsWith('erro') ? 'text-bad' : 'text-muted'}`}
            >
              {r.ultimoStatus}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${inputCls} w-auto py-1 text-xs`}
            value={r.estado}
            onChange={(e) => onEstado(e.target.value as EstadoDaRotina)}
            disabled={!editavel || ocupado}
            title={
              r.origem === 'pauta'
                ? `${ESTADOS.find((e) => e.valor === r.estado)?.explica} — nesta rotina o estado ` +
                  'também liga e desliga o interruptor da tela de Pauta'
                : ESTADOS.find((e) => e.valor === r.estado)?.explica
            }
          >
            {ESTADOS.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.rotulo}
              </option>
            ))}
          </select>

          <Botao
            tone="brand"
            onClick={onRodar}
            disabled={!editavel || ocupado || !r.temExecutor}
            title={r.temExecutor ? 'roda agora, sem esperar o horário' : 'esta rotina não tem executor inscrito'}
          >
            {ocupado ? 'Rodando…' : 'Rodar agora'}
          </Botao>

          <Botao onClick={() => onAtivo(!r.ativo)} disabled={!editavel || ocupado}>
            {r.ativo ? 'Desligar' : 'Ligar'}
          </Botao>

          <Botao tone="ghost" onClick={onAbrir}>
            {aberta ? 'Fechar histórico' : 'Histórico'}
          </Botao>
        </div>
      </div>

      {aberta && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">
                Linha de base — minutos que uma pessoa gastava por execução (RF-N-05)
              </span>
              <input
                type="number"
                min={0}
                max={1440}
                className={`${inputCls} w-48`}
                placeholder={r.minutosPorExecucao?.toString() ?? 'ninguém declarou'}
                value={minutos}
                onChange={(e) => onMinutos(e.target.value)}
                disabled={!editavel || ocupado}
              />
            </label>
            <Botao onClick={() => onLinhaDeBase(n)} disabled={!editavel || ocupado || !minutosValidos}>
              Declarar
            </Botao>
          </div>

          <ContaDoTempo medida={medida} />

          {historico.length === 0 ? (
            <p className="text-xs text-muted">Nenhuma passagem registrada ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-1 pr-3">quando</th>
                    <th className="py-1 pr-3">desfecho</th>
                    <th className="py-1 pr-3">origem</th>
                    <th className="py-1 pr-3">duração</th>
                    <th className="py-1">o que aconteceu</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((e) => (
                    <tr key={e.id} className="border-t border-border/60">
                      <td className="whitespace-nowrap py-1 pr-3 text-muted">{quando(e.inicioEm)}</td>
                      <td className="py-1 pr-3">
                        <Chip tone={e.status === 'ok' ? 'good' : e.status === 'erro' ? 'bad' : 'muted'}>
                          {e.status}
                        </Chip>
                      </td>
                      <td className="py-1 pr-3 text-muted">{e.origem}</td>
                      <td className="whitespace-nowrap py-1 pr-3 text-muted">
                        {e.duracaoMs === null ? '—' : `${(e.duracaoMs / 1000).toFixed(1)}s`}
                      </td>
                      <td className={`py-1 ${e.erro ? 'text-bad' : ''}`}>{e.erro ?? e.resumo ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A conta aberta, dentro do histórico da rotina.
 *
 * Existe para que ninguém precise confiar no número da linha de cima: aqui
 * estão as duas parcelas, de onde cada uma vem e até onde o histórico lido
 * alcança. É o que separa "horas devolvidas" de um número inventado numa tela
 * que o cliente vê.
 */
function ContaDoTempo({ medida }: { medida: HorasDaRotina | undefined }) {
  if (!medida) return null;

  if (medida.estado === 'sem-linha-de-base') {
    return (
      <div className="mb-3 rounded-lg border border-border/60 px-3 py-2 text-[11px] text-muted">
        <p className="text-text">Tempo devolvido: não dá para calcular ainda.</p>
        <p className="mt-1">
          Falta a metade que ninguém mede sozinho — quantos minutos uma pessoa gastava por execução.
          Declare acima, e a conta passa a sair do histórico real desta rotina. Enquanto isso a
          rotina fica fora do total da empresa: entrar com zero ou com um chute seria pior do que
          ficar de fora.
        </p>
      </div>
    );
  }

  if (medida.estado === 'sem-historico') {
    return (
      <div className="mb-3 rounded-lg border border-border/60 px-3 py-2 text-[11px] text-muted">
        Lendo as passagens desta rotina para calcular o tempo devolvido…
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-border/60 px-3 py-2 text-[11px] leading-[1.6] text-muted">
      <p className="text-text">
        Tempo devolvido: {emHoras(medida.minutosNaSemana ?? 0)} por semana
        {!medida.janelaCoberta && ' (no mínimo)'}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>
          <span className="text-text">{medida.execucoesNaSemana}</span> passagem(ns) com desfecho{' '}
          <code className="text-[10px]">ok</code> nos últimos {DIAS_DA_JANELA} dias — contadas no
          histórico abaixo, uma a uma. Falhas não entram.
        </li>
        <li>
          × <span className="text-text">{medida.minutosPorExecucao} min</span> por execução — a
          linha de base declarada por uma pessoa nesta tela, não uma estimativa.
        </li>
        <li>
          Acumulado desde sempre: {emHoras(medida.minutosAcumulados ?? 0)} em{' '}
          {medida.execucoesBemSucedidas} passagem(ns) bem-sucedida(s) — o contador da rotina menos
          as falhas.
        </li>
        {medida.cobreDesde && (
          <li>
            O histórico lido alcança até {quando(medida.cobreDesde)}
            {medida.janelaCoberta
              ? ' — cobre a semana inteira.'
              : ` — NÃO cobre os ${DIAS_DA_JANELA} dias: a rotina passou mais de ${LIMITE_DO_HISTORICO} vezes, e o que está acima é piso.`}
          </li>
        )}
      </ul>
    </div>
  );
}
