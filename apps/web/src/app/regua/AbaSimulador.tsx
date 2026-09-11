'use client';

import { useState, type ReactNode } from 'react';
import { FlaskConical, Lock } from 'lucide-react';
import { apiPost } from '@/lib/api';
import type {
  Efeito,
  PainelDaRegua,
  PedidoDeSimulacao,
  ResultadoDaSimulacao,
  SinalId,
} from './tipos';
import { Cartao, Etiqueta, Selo, inputCls } from './ui';

/*
 * O SIMULADOR — RF-P-09.
 *
 * O operador descreve uma ação hipotética e recebe o nível calculado, quais
 * gatilhos acenderam e o que seria exigido dele. É a peça que faz a régua
 * deixar de ser abstrata.
 *
 * O CÁLCULO É DO SERVIDOR. Este arquivo monta um pedido, faz UMA chamada e
 * desenha a resposta. Ele não sabe somar gatilho, não sabe que R4 exige
 * reautenticação e não sabe que sinal sobe um degrau — tudo isso chega pronto
 * de `POST /api/policy/simular`, que chama a MESMA `avaliar()` que a porta
 * chama em produção. Uma cópia da escada aqui seria uma segunda régua: no dia
 * em que a política mudasse, a tela continuaria ensinando o antigo.
 *
 * SIMULAR NÃO É EXECUTAR. A rota não cria aprovação, não chama efeito e não
 * grava decisão; o único registro do lado de lá é uma linha de log marcada como
 * consulta. O aviso ao lado do botão existe para que isso também seja verdade
 * para quem está olhando a tela.
 *
 * A PROCEDÊNCIA EXTERNA É DE MÃO ÚNICA e o controle também é: marcada, não
 * desmarca. Não é capricho de interface — é o comportamento do runtime
 * (RF-G-07), onde conteúdo externo só eleva nível e a bandeira não tem volta.
 * Quem quiser simular sem ela recomeça a simulação, que é exatamente o que
 * acontece de verdade.
 */

const SUPOSICOES: { id: SinalId; rotulo: string }[] = [
  { id: 'destinatario_novo', rotulo: 'destinatário sem histórico' },
  { id: 'volume_atipico', rotulo: 'volume atípico' },
  { id: 'erro_recente', rotulo: 'o agente errou nas últimas 24h' },
];

export function AbaSimulador({ painel, token }: { painel: PainelDaRegua; token: string | null }) {
  const [modo, setModo] = useState<'catalogo' | 'descrita'>('catalogo');
  const [capabilityId, setCapabilityId] = useState(painel.capacidades[0]?.id ?? '');
  const [descricao, setDescricao] = useState('');
  const [efeito, setEfeito] = useState<Efeito>(painel.efeitoNeutro);
  const [horario, setHorario] = useState('');
  const [valor, setValor] = useState('');
  const [suposicoes, setSuposicoes] = useState<SinalId[]>([]);
  const [externa, setExterna] = useState(false);
  const [aprovacaoR2, setAprovacaoR2] = useState(true);

  const [resultado, setResultado] = useState<ResultadoDaSimulacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  const mudarEfeito = <K extends keyof Efeito>(campo: K, v: Efeito[K]) =>
    setEfeito((e) => ({ ...e, [campo]: v }));

  const recomecar = () => {
    setResultado(null);
    setErro(null);
    setExterna(false);
    setSuposicoes([]);
    setHorario('');
    setValor('');
    setEfeito(painel.efeitoNeutro);
  };

  const simular = () => {
    const pedido: PedidoDeSimulacao = {
      sinais: suposicoes,
      procedenciaExterna: externa || undefined,
      aprovacaoR2Ligada: aprovacaoR2,
      ...(horario ? { horario } : {}),
      ...(valor !== '' ? { valorCentavos: Number(valor) } : {}),
      ...(modo === 'catalogo'
        ? { capabilityId }
        : { efeito, descricao: descricao.trim() || undefined }),
    };
    setRodando(true);
    setErro(null);
    apiPost<ResultadoDaSimulacao>('/policy/simular', pedido, token)
      .then((r) => setResultado(r))
      .catch((e: Error) => {
        setResultado(null);
        setErro(e.message);
      })
      .finally(() => setRodando(false));
  };

  return (
    <div className="space-y-5">
      <Cartao
        titulo="Simular uma ação hipotética"
        aviso="A conta é feita pela mesma régua que a porta usa. Nada aqui executa, aprova ou registra ação nenhuma — é uma pergunta."
      >
        <fieldset className="space-y-4">
          <legend className="sr-only">A ação</legend>

          <div className="flex flex-wrap gap-2">
            <Escolha ativo={modo === 'catalogo'} onClick={() => setModo('catalogo')}>
              Escolher do catálogo
            </Escolha>
            <Escolha ativo={modo === 'descrita'} onClick={() => setModo('descrita')}>
              Descrever o efeito
            </Escolha>
          </div>

          {modo === 'catalogo' ? (
            <div>
              <label htmlFor="sim-capacidade" className="mb-1 block text-xs text-muted">
                Capacidade
              </label>
              <select
                id="sim-capacidade"
                value={capabilityId}
                onChange={(e) => setCapabilityId(e.target.value)}
                className={`w-full ${inputCls}`}
              >
                {painel.capacidades.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nivel} · {c.id}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label htmlFor="sim-descricao" className="mb-1 block text-xs text-muted">
                  O que a ação faz, em uma frase
                </label>
                <input
                  id="sim-descricao"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="mandar o relatório fechado para o cliente"
                  className={`w-full ${inputCls}`}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Caixa
                  id="ef-escreve"
                  marcado={efeito.escreveForaDoOS}
                  onChange={(v) => mudarEfeito('escreveForaDoOS', v)}
                  rotulo="escreve fora do OS"
                />
                <Caixa
                  id="ef-artefato"
                  marcado={efeito.produzArtefato}
                  onChange={(v) => mudarEfeito('produzArtefato', v)}
                  rotulo="produz artefato"
                />
                <Caixa
                  id="ef-externa"
                  marcado={efeito.exposicaoExterna}
                  onChange={(v) => mudarEfeito('exposicaoExterna', v)}
                  rotulo="sai para fora (cliente, público)"
                />
                <Caixa
                  id="ef-destruicao"
                  marcado={efeito.destruicao}
                  onChange={(v) => mudarEfeito('destruicao', v)}
                  rotulo="apaga dado ou derruba acesso"
                />
                <Caixa
                  id="ef-legal"
                  marcado={efeito.obrigacaoLegal}
                  onChange={(v) => mudarEfeito('obrigacaoLegal', v)}
                  rotulo="cria obrigação legal"
                />
                <Lista
                  id="ef-reversibilidade"
                  rotulo="Reversibilidade"
                  valor={efeito.reversibilidade}
                  opcoes={['automatica', 'manual', 'nenhuma']}
                  onChange={(v) => mudarEfeito('reversibilidade', v as Efeito['reversibilidade'])}
                />
                <Lista
                  id="ef-financeiro"
                  rotulo="Impacto financeiro"
                  valor={efeito.impactoFinanceiro}
                  opcoes={['nenhum', 'obrigacao', 'movimento']}
                  onChange={(v) =>
                    mudarEfeito('impactoFinanceiro', v as Efeito['impactoFinanceiro'])
                  }
                />
                <Lista
                  id="ef-sensibilidade"
                  rotulo="Sensibilidade do dado"
                  valor={efeito.sensibilidade}
                  opcoes={['publica', 'interna', 'confidencial', 'restrita']}
                  onChange={(v) => mudarEfeito('sensibilidade', v as Efeito['sensibilidade'])}
                />
                <div>
                  <label htmlFor="ef-alcance" className="mb-1 block text-xs text-muted">
                    Alcance (quantos destinatários ou registros)
                  </label>
                  <input
                    id="ef-alcance"
                    type="number"
                    min={1}
                    value={efeito.alcance ?? 1}
                    onChange={(e) => mudarEfeito('alcance', Math.max(1, Number(e.target.value)))}
                    className={`w-full ${inputCls}`}
                  />
                </div>
              </div>
            </div>
          )}
        </fieldset>
      </Cartao>

      <Cartao
        titulo="O momento"
        aviso="Horário e valor são conferidos contra os limites DESTA empresa; o resto é suposição sua — na execução real quem mede é o histórico."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="sim-horario" className="mb-1 block text-xs text-muted">
              Hora da execução (janela {painel.limites.janelaHoraria[0]}–
              {painel.limites.janelaHoraria[1]})
            </label>
            <input
              id="sim-horario"
              type="time"
              value={horario}
              onChange={(e) => setHorario(e.target.value)}
              className={`w-full ${inputCls}`}
            />
          </div>
          <div>
            <label htmlFor="sim-valor" className="mb-1 block text-xs text-muted">
              Valor envolvido, em centavos (teto {painel.limites.tetoCustoCentavosPorExecucao})
            </label>
            <input
              id="sim-valor"
              type="number"
              min={0}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className={`w-full ${inputCls}`}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {SUPOSICOES.map((s) => (
            <Caixa
              key={s.id}
              id={`sim-${s.id}`}
              marcado={suposicoes.includes(s.id)}
              onChange={(v) =>
                setSuposicoes((atual) =>
                  v ? [...atual, s.id] : atual.filter((x) => x !== s.id),
                )
              }
              rotulo={s.rotulo}
            />
          ))}

          <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3">
            <Lock size={14} className="mt-0.5 text-warn" aria-hidden />
            <div>
              <Caixa
                id="sim-externa"
                marcado={externa}
                onChange={(v) => setExterna(v || externa)}
                desabilitado={externa}
                rotulo="o pedido veio de mensagem, documento ou página"
              />
              <p className="mt-1 text-xs text-muted">
                Procedência externa é de mão única: no runtime existe marcar, não existe
                desmarcar. Para simular sem ela, recomece a simulação.
              </p>
            </div>
          </div>

          <Caixa
            id="sim-aprovacao-r2"
            marcado={aprovacaoR2}
            onChange={setAprovacaoR2}
            rotulo="aprovação de R2 ligada (só vale no degrau configurável)"
          />
        </div>
      </Cartao>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={simular}
          disabled={rodando || (modo === 'catalogo' && !capabilityId)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
        >
          <FlaskConical size={15} aria-hidden /> {rodando ? 'Simulando…' : 'Simular'}
        </button>
        <button
          onClick={recomecar}
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-text"
        >
          Recomeçar
        </button>
        <span className="text-xs text-muted">
          Simular não executa: nenhuma aprovação é criada e nada entra no rastro como ação.
        </span>
      </div>

      {erro && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">
          {erro}
        </div>
      )}

      {resultado && <Resultado r={resultado} />}
    </div>
  );
}

function Resultado({ r }: { r: ResultadoDaSimulacao }) {
  return (
    <div className="space-y-4" aria-live="polite">
      <Cartao titulo="Resultado da simulação">
        <div className="flex flex-wrap items-center gap-3">
          <Selo nivel={r.nivel} grande marca="nivel-calculado" />
          <div>
            <div className="text-sm font-medium">{r.acao.rotulo}</div>
            <div className="text-xs text-muted">{r.motivo}</div>
          </div>
          {!r.permitido && (
            <span className="rounded bg-bad/15 px-2 py-1 text-[11px] text-bad">
              o OS não executa
            </span>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">
          Nível base {r.nivelBase}
          {r.nivelBase !== r.nivel && ` · elevado para ${r.nivel} pelos sinais acesos`} · régua
          versão {r.politica.versao}
        </p>
      </Cartao>

      {r.avisos.length > 0 && (
        <div className="space-y-2">
          {r.avisos.map((a) => (
            <p
              key={a}
              className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-2 text-sm text-warn"
            >
              {a}
            </p>
          ))}
        </div>
      )}

      <Cartao titulo="Gatilhos acesos">
        {r.gatilhos.length === 0 ? (
          <p className="text-sm text-muted">Nenhum — a ação não tem efeito classificável.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {r.gatilhos.map((g) => (
              <li key={`${g.campo}:${g.valor}`} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px]">{g.campo}</span>
                <Etiqueta>{g.elevaPara}</Etiqueta>
                <span className="text-muted">{g.texto}</span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao titulo="Sinais acesos">
        {r.sinais.length === 0 ? (
          <p className="text-sm text-muted">Nenhum. O nível é o do efeito, sem escalonamento.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {r.sinais.map((s) => (
              <li key={s.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px]">{s.id}</span>
                  <Etiqueta>{s.origem}</Etiqueta>
                  {s.maoUnica && (
                    <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
                      de mão única
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted">{s.porque}</p>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao titulo="O que seria exigido de você">
        <ul className="space-y-3 text-sm">
          {r.exigencias.map((e) => (
            <li key={e.chave}>
              <div className="font-medium">{e.titulo}</div>
              <div className="text-xs text-muted">{e.detalhe}</div>
            </li>
          ))}
        </ul>
      </Cartao>
    </div>
  );
}

function Escolha({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={`rounded-lg border px-3 py-1.5 text-sm ${
        ativo ? 'border-brand-dim bg-brand/15 text-brand' : 'border-border text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function Caixa({
  id,
  marcado,
  onChange,
  rotulo,
  desabilitado = false,
}: {
  id: string;
  marcado: boolean;
  onChange: (v: boolean) => void;
  rotulo: string;
  desabilitado?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={marcado}
        disabled={desabilitado}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-current"
      />
      <span className={desabilitado ? 'text-muted' : ''}>{rotulo}</span>
    </label>
  );
}

function Lista({
  id,
  rotulo,
  valor,
  opcoes,
  onChange,
}: {
  id: string;
  rotulo: string;
  valor: string;
  opcoes: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted">
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full ${inputCls}`}
      >
        {opcoes.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
