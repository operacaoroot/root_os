'use client';

import { useMemo, useState } from 'react';
import { CalendarPlus, Video, MapPin } from 'lucide-react';
import { montarTituloDeReuniao, RESPONSAVEL_TODOS, type ModalidadeDeReuniao } from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, inputCls } from '../referencias/ui';
import { foiRetida, type RespostaDeEscrita } from './tipos';

/*
 * ============================================================================
 * MARCAR REUNIÃO — o formulário que NÃO tem campo de título
 * ============================================================================
 *
 * É o ponto do produto onde o padrão da casa deixa de ser combinado e vira
 * mecanismo. Ninguém digita "Reunião c/ Andrade": escolhe se é cliente ou
 * interna, se é online ou presencial, quem atende — e o título se monta.
 *
 * A PRÉ-VISUALIZAÇÃO EXISTE POR UM MOTIVO PRÁTICO: quem marca precisa ver, antes
 * de mandar, a linha exata que vai aparecer na agenda dos outros. Ela usa a
 * MESMA função que o servidor usa para escrever (`montarTituloDeReuniao`, no
 * shared), e não uma interpolação parecida escrita aqui — duas gramáticas é como
 * a tela passa a prometer um título e a API a gravar outro.
 */

interface Props {
  /** Nomes que já apareceram na agenda ou nos trilhos, para o datalist. */
  clientes: string[];
  responsaveis: string[];
  /** Quando a reunião entra de verdade (ou vai para a fila), a grade recarrega. */
  aoMarcar: () => void;
}

const HOJE_AS_9 = (): string => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function MarcarReuniao({ clientes, responsaveis, aoMarcar }: Props) {
  const { token } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<'cliente' | 'interna'>('cliente');
  const [modalidade, setModalidade] = useState<ModalidadeDeReuniao>('online');
  const [cliente, setCliente] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [inicio, setInicio] = useState(HOJE_AS_9);
  const [duracao, setDuracao] = useState(60);
  const [pauta, setPauta] = useState('');
  const [local, setLocal] = useState('');
  const [convidados, setConvidados] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [fila, setFila] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /** O título como vai ficar — ou o que ainda falta para ele existir. */
  const previa = useMemo(() => {
    try {
      return montarTituloDeReuniao(
        tipo === 'cliente'
          ? { tipo: 'cliente', modalidade, cliente, responsavel }
          : { tipo: 'interna', modalidade, responsavel },
      );
    } catch (e) {
      return (e as Error).message;
    }
  }, [tipo, modalidade, cliente, responsavel]);

  const previaPronta = tipo === 'cliente' ? !!cliente.trim() && !!responsavel.trim() : !!responsavel.trim();

  const marcar = () => {
    setErro(null);
    if (!previaPronta) { setErro('Falta quem — o cliente e/ou o responsável.'); return; }
    if (!inicio) { setErro('Falta a data e a hora.'); return; }
    const emails = convidados.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
    const invalido = emails.find((v) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
    if (invalido) { setErro(`"${invalido}" não parece um e-mail.`); return; }

    setEnviando(true);
    apiPost<RespostaDeEscrita & { link?: string; titulo?: string; meet?: string | null }>(
      '/google/calendar/reuniao',
      {
        tipo,
        modalidade,
        ...(tipo === 'cliente' ? { cliente: cliente.trim() } : {}),
        responsavel: responsavel.trim(),
        inicio: new Date(inicio).toISOString(),
        duracaoMinutos: duracao,
        ...(pauta.trim() ? { pauta: pauta.trim() } : {}),
        ...(modalidade === 'presencial' && local.trim() ? { local: local.trim() } : {}),
        ...(emails.length ? { convidados: emails } : {}),
      },
      token,
    )
      .then((r) => {
        setEnviando(false);
        if (foiRetida(r)) {
          setFila(
            `${r.mensagem ?? 'A reunião foi para a fila de aprovações e precisa da confirmação de outra pessoa. Nada foi criado na agenda ainda.'}` +
              `${r.approvalId ? ` (aprovação ${r.approvalId})` : ''}`,
          );
          setOk(null);
          return;
        }
        setOk(`✅ ${r.titulo ?? previa} na agenda.${r.meet ? ` Meet: ${r.meet}` : ''}`);
        setFila(null);
        setCliente(''); setPauta(''); setConvidados(''); setLocal('');
        aoMarcar();
      })
      .catch((e) => { setEnviando(false); setErro(e.message); });
  };

  if (!aberto) {
    return (
      <Botao tone="brand" onClick={() => setAberto(true)}>
        <span className="inline-flex items-center gap-1.5"><CalendarPlus size={15} /> Marcar reunião</span>
      </Botao>
    );
  }

  return (
    <Card
      titulo="Marcar reunião"
      acao={<Botao tone="ghost" onClick={() => setAberto(false)}>fechar</Botao>}
    >
      <div className="space-y-4">
        {/* o título, montado — e não digitado */}
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted">Vai entrar na agenda como</p>
          <p className={`font-os-mono text-sm ${previaPronta ? 'text-text' : 'text-muted'}`}>{previa}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Com quem">
            <div className="flex gap-2">
              {(['cliente', 'interna'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${tipo === t ? 'border-brand-dim bg-brand/10 text-text' : 'border-border bg-surface-2 text-muted hover:text-text'}`}
                >
                  {t === 'cliente' ? 'Cliente' : 'Interna'}
                </button>
              ))}
            </div>
          </Campo>

          <Campo label="Como" hint={modalidade === 'online' ? 'Online nasce com link do Meet.' : 'Presencial não cria sala — diz onde é.'}>
            <div className="flex gap-2">
              {(['online', 'presencial'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModalidade(m)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${modalidade === m ? 'border-brand-dim bg-brand/10 text-text' : 'border-border bg-surface-2 text-muted hover:text-text'}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {m === 'online' ? <Video size={14} /> : <MapPin size={14} />}
                    {m === 'online' ? 'Online' : 'Presencial'}
                  </span>
                </button>
              ))}
            </div>
          </Campo>

          {tipo === 'cliente' && (
            <Campo label="Cliente" hint="O nome como a Root chama o cliente — é ele que vai no título.">
              <input
                className={inputCls}
                list="agenda-clientes"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Andrade Peças"
              />
              <datalist id="agenda-clientes">
                {clientes.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Campo>
          )}

          <Campo label={tipo === 'cliente' ? 'Responsável pelo atendimento' : 'Quem conduz'} hint={`Um sócio, ou "${RESPONSAVEL_TODOS}".`}>
            <input
              className={inputCls}
              list="agenda-responsaveis"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              placeholder="Pedro"
            />
            <datalist id="agenda-responsaveis">
              {[...responsaveis, RESPONSAVEL_TODOS].map((r) => <option key={r} value={r} />)}
            </datalist>
          </Campo>

          <Campo label="Quando">
            <input type="datetime-local" className={inputCls} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </Campo>

          <Campo label="Duração">
            <select className={inputCls} value={duracao} onChange={(e) => setDuracao(Number(e.target.value))}>
              {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </Campo>

          {modalidade === 'presencial' && (
            <Campo label="Onde">
              <input className={inputCls} value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Sala da Root" />
            </Campo>
          )}

          <Campo label="Convidados" hint="E-mails separados por vírgula. Eles recebem o convite do Google.">
            <input className={inputCls} value={convidados} onChange={(e) => setConvidados(e.target.value)} placeholder="cliente@empresa.com" />
          </Campo>
        </div>

        <Campo label="Pauta" hint="Vai na descrição do evento.">
          <textarea className={`${inputCls} min-h-[70px]`} value={pauta} onChange={(e) => setPauta(e.target.value)} />
        </Campo>

        {ok && <div className="rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-sm text-good">{ok}</div>}
        {fila && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn">
            <span>⏳ {fila}</span>
            <a href="/atendimento" className="underline underline-offset-2 hover:opacity-80">Ir para a fila</a>
          </div>
        )}
        {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted">
            Marcar reunião é escrita fora do OS (R3): ela vai para a fila de aprovações e quem
            confirma tem de ser outra pessoa. Tudo fica no rastro.
          </p>
          <Botao tone="brand" onClick={marcar} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Marcar'}
          </Botao>
        </div>
      </div>
    </Card>
  );
}
