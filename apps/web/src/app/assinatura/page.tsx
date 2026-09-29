'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, inputCls } from './ui';

/*
 * A TELA DA ASSINATURA — RF-O-03 (fatia 6.2).
 *
 * Ela tem DOIS papéis, e o segundo é o que a fatia existe para entregar:
 *
 *  1. mostrar o plano, as cobranças e o estado da conta;
 *  2. SER A TELA DE SUSPENSÃO — o único lugar que uma empresa suspensa alcança
 *     dentro do produto, e o lugar onde ela lê, com todas as letras, que NADA
 *     FOI APAGADO.
 *
 * ----------------------------------------------------------------------------
 * POR QUE A FRASE "nada foi apagado" ESTÁ NA TELA, E EM DESTAQUE
 * ----------------------------------------------------------------------------
 * Porque é a pergunta que a pessoa vai fazer, e porque a resposta errada custa o
 * cliente. Quem chega numa tela de bloqueio depois de um atraso de boleto supõe
 * o pior: que perdeu o histórico, que vai ter de reconectar tudo, que o
 * onboarding vai ser refeito. Não vai — a suspensão muda uma coluna e nada mais
 * —, e dizer isso é parte da entrega, não enfeite.
 *
 * ----------------------------------------------------------------------------
 * COMO SE CHEGA AQUI
 * ----------------------------------------------------------------------------
 * De três jeitos, e antes desta correção existia UM: digitando o endereço.
 * Agora há item de menu (`packages/shared/src/nav.ts`, seção "A conta", com
 * `dashboard.ver` — todo usuário precisa poder chegar à tela que diz por que o
 * produto parou) e há o redirecionamento do `AppShell`, que traz para cá quem
 * está bloqueado em qualquer outra tela.
 *
 * ----------------------------------------------------------------------------
 * O FORMULÁRIO DO PLANO EXISTE — ele era prometido e não existia
 * ----------------------------------------------------------------------------
 * O bloco "sem assinatura" dizia "quem administra a conta pode registrar o plano
 * abaixo" e abaixo só havia o campo da credencial. Como NENHUMA empresa tem linha
 * de assinatura, era a promessa que todo mundo lia e ninguém conseguia cumprir —
 * e sem a linha a fatia inteira fica inerte, porque `estadoDeAcesso` devolve nulo
 * e nulo não bloqueia.
 *
 * `PUT /assinatura` não mexe em acesso nenhum (ver `AssinaturaService.definir`):
 * registrar plano não reativa suspenso nem suspende ativo.
 *
 * ----------------------------------------------------------------------------
 * O QUE ELA NÃO MOSTRA
 * ----------------------------------------------------------------------------
 * A credencial do provedor. Nem inteira, nem os quatro últimos caracteres. A
 * API devolve `credencialGuardada: boolean` e é só isso que existe para mostrar
 * — "só o sufixo" é o padrão que parece inofensivo e reduz o espaço de busca de
 * quem já tem metade da chave.
 *
 * O CAMPO DE DIGITAR A CHAVE É `type="password"` E NÃO GUARDA ESTADO DEPOIS DO
 * ENVIO: o valor é limpo assim que a API confirma. Um campo controlado que
 * segure a chave em memória do browser até a navegação seguinte é o mesmo
 * descuido do lado de cá.
 */

interface CobrancaNaTela {
  referencia: string;
  status: string;
  valorCentavos: number;
  vencimento: string;
  pagoEm: string | null;
}

interface Retrato {
  existe: boolean;
  status: 'ativa' | 'inadimplente' | 'suspensa' | 'cancelada' | null;
  bloqueado: boolean;
  plano: string | null;
  valorCentavos: number | null;
  ciclo: string | null;
  diasDeCarencia: number | null;
  suspensaEm: string | null;
  motivoDaSuspensao: string | null;
  reativadaEm: string | null;
  /** Cobranças vencidas até aqui foram perdoadas por reativação explícita. */
  perdoadasAte: string | null;
  /** Há endereço da assinatura no provedor? NUNCA o identificador em si. */
  ligadaAoProvedor: boolean;
  conferidaEm: string | null;
  credencialGuardada: boolean;
  cobrancas: CobrancaNaTela[];
}

/**
 * `porque` É O CONTRATO, e ele existe porque a tela mentia.
 *
 * A primeira escrita traduzia QUALQUER `leituraCompleta: false` como "não
 * consegui falar com o provedor de cobrança agora". Duas das quatro causas não
 * têm nada a ver com comunicação — "esta empresa não tem assinatura" e "a
 * assinatura não está ligada a nada no provedor" —, e como NENHUMA empresa tem
 * linha de assinatura hoje, uma dessas duas era a resposta de cem por cento dos
 * cliques. A tela mentia sobre a causa no único estado que existe.
 */
type PorqueDaConferencia =
  | 'ok'
  | 'sem_assinatura'
  | 'sem_endereco_no_provedor'
  | 'sem_credencial'
  | 'provedor_indisponivel';

interface Conferencia {
  conferida: boolean;
  leituraCompleta: boolean;
  de: string | null;
  para: string | null;
  porque: PorqueDaConferencia;
  motivo: string;
}

/** `49700` → `R$ 497,00`. Vírgula decimal e ponto de milhar, como manda a casa. */
function emReais(centavos: number | null): string {
  if (centavos === null) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** ISO → `11/09/2026`. Sem depender do locale do processo. */
function data(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const ROTULO: Record<string, { texto: string; cor: string }> = {
  ativa: { texto: 'em dia', cor: 'text-good' },
  inadimplente: { texto: 'pagamento em atraso', cor: 'text-warn' },
  suspensa: { texto: 'acesso suspenso', cor: 'text-bad' },
  cancelada: { texto: 'assinatura encerrada', cor: 'text-bad' },
};

const ROTULO_COBRANCA: Record<string, string> = {
  aberta: 'em aberto',
  paga: 'paga',
  vencida: 'vencida',
  cancelada: 'cancelada',
};

/**
 * O que dizer para cada causa de "não deu para conferir".
 *
 * Cada frase diz a VERDADE daquela causa e o que fazer a respeito. A antiga
 * ("não consegui falar com o provedor, tente de novo em alguns minutos") mandava
 * a pessoa esperar por uma coisa que nunca ia acontecer sozinha nos dois
 * primeiros casos.
 */
const PORQUE_NAO_CONFERIU: Record<Exclude<PorqueDaConferencia, 'ok'>, string> = {
  sem_assinatura:
    'Esta empresa ainda não tem assinatura registrada, então não há o que conferir — e também ' +
    'não há o que suspender: sem assinatura, o acesso segue liberado. Quem administra a conta ' +
    'registra o plano aqui embaixo.',
  sem_endereco_no_provedor:
    'O plano está registrado, mas ainda não está ligado a nenhuma assinatura no provedor de ' +
    'cobrança — sem esse endereço não há a quem perguntar. Enquanto estiver assim, ninguém é ' +
    'suspenso por ela. Quem administra a conta preenche o identificador da assinatura no ' +
    'provedor aqui embaixo.',
  sem_credencial:
    'Não há credencial de cobrança guardada no cofre desta empresa (ou ela foi revogada), então ' +
    'não dá para perguntar ao provedor. Enquanto estiver assim, ninguém é suspenso. Quem ' +
    'administra a conta guarda a chave no bloco de credencial, mais abaixo.',
  provedor_indisponivel:
    'Não consegui falar com o provedor de cobrança agora. Nada mudou por causa disso — nem para ' +
    'bloquear, nem para liberar. Tente de novo em alguns minutos.',
};

export default function AssinaturaPage() {
  const { token, ready, can } = useAuth();
  const [retrato, setRetrato] = useState<Retrato | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [chave, setChave] = useState('');

  /*
   * O formulário do plano. Começa vazio e é PREENCHIDO pela resposta da API
   * quando já existe linha (ver `carregar`) — em vez de ser controlado pelo
   * `retrato` direto, para que digitar não seja desfeito pela releitura que vem
   * depois de cada ação.
   */
  const [plano, setPlano] = useState('');
  const [valor, setValor] = useState('');
  const [ciclo, setCiclo] = useState<'mensal' | 'anual'>('mensal');
  const [carencia, setCarencia] = useState('7');
  const [assinaturaNoProvedor, setAssinaturaNoProvedor] = useState('');
  const [formularioTocado, setFormularioTocado] = useState(false);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiGet<Retrato>('/assinatura', token);
      setRetrato(r);
      setErro(null);
      // Só semeia o formulário enquanto ninguém digitou nele. Sobrescrever o que
      // a pessoa está escrevendo, a cada releitura, é como um formulário perde o
      // que foi digitado sem ninguém entender por quê.
      if (!formularioTocado && r.existe) {
        setPlano(r.plano ?? '');
        setValor(r.valorCentavos === null ? '' : (r.valorCentavos / 100).toFixed(2).replace('.', ','));
        setCiclo(r.ciclo === 'anual' ? 'anual' : 'mensal');
        setCarencia(String(r.diasDeCarencia ?? 7));
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'não consegui ler a assinatura');
    }
  }, [token, formularioTocado]);

  useEffect(() => {
    if (ready && token) void carregar();
  }, [ready, token, carregar]);

  /**
   * "Já paguei, confere aí."
   *
   * A resposta da API distingue três desfechos e a tela precisa distinguir os
   * três também: reativou, continua como estava, ou NÃO CONSEGUIMOS PERGUNTAR.
   * Juntar o terceiro com o segundo ("nada mudou") é o que faria alguém que
   * pagou concluir que o pagamento não valeu.
   */
  async function conferir() {
    if (!token) return;
    setOcupado('conferir');
    setAviso(null);
    setErro(null);
    try {
      const r = await apiPost<Conferencia>('/assinatura/conferir', {}, token);
      if (r.porque && r.porque !== 'ok') {
        // A CAUSA, e não "falha de comunicação" para tudo. Ver `PORQUE_NAO_CONFERIU`.
        setAviso(PORQUE_NAO_CONFERIU[r.porque]);
      } else if (!r.leituraCompleta) {
        // API mais velha que esta tela: sem o código, o melhor que dá para dizer
        // é o que se sabe — que não terminou e que nada mudou por isso.
        setAviso(PORQUE_NAO_CONFERIU.provedor_indisponivel);
      } else if (r.para) {
        setAviso(`Estado atualizado: ${ROTULO[r.para]?.texto ?? r.para}. ${r.motivo}`);
      } else {
        setAviso(`Conferido agora. ${r.motivo}`);
      }
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'não consegui conferir');
    } finally {
      setOcupado(null);
    }
  }

  /**
   * Registra ou altera o plano — o formulário que a tela PROMETIA e não tinha.
   *
   * O texto de "sem assinatura" dizia "quem administra a conta pode registrar o
   * plano abaixo" e abaixo não havia nada além do campo da credencial. Como
   * nenhuma empresa tem linha de assinatura, era a promessa que todo mundo lia e
   * ninguém conseguia cumprir — e sem a linha, a fatia inteira fica inerte.
   *
   * `PUT /assinatura` NÃO muda o estado de acesso de propósito (ver
   * `AssinaturaService.definir`): registrar plano não reativa suspenso nem
   * suspende ativo. Por isso este formulário aparece também com a conta
   * bloqueada, e não reativa nada por efeito colateral.
   */
  async function salvarPlano() {
    if (!token) return;
    const centavos = Math.round(Number(String(valor).replace(',', '.')) * 100);
    if (!plano.trim()) {
      setErro('o plano precisa de um nome');
      return;
    }
    if (!Number.isInteger(centavos) || centavos < 0) {
      setErro('o valor precisa ser um número em reais, como 497 ou 497,00');
      return;
    }
    setOcupado('plano');
    setErro(null);
    try {
      await apiPut<Retrato>(
        '/assinatura',
        {
          plano: plano.trim(),
          valorCentavos: centavos,
          ciclo,
          diasDeCarencia: Number(carencia),
          // String vazia vira `null`: quem apagou o campo está dizendo "não há
          // endereço", e mandar `''` gravaria um endereço vazio que o conector
          // usaria como se fosse um.
          provedorAssinaturaId: assinaturaNoProvedor.trim() || null,
        },
        token,
      );
      setAviso(
        'Plano registrado. Isto NÃO mexeu no acesso: registrar plano não reativa nem suspende ' +
          'ninguém — quem move acesso é a conferência com o provedor, e ela exige prova.',
      );
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'não consegui salvar o plano');
    } finally {
      setOcupado(null);
    }
  }

  async function guardarChave() {
    if (!token || !chave.trim()) return;
    setOcupado('chave');
    try {
      await apiPut<{ guardada: boolean }>('/assinatura/credencial', { chave }, token);
      // Limpa NA HORA: o valor não fica em memória do browser depois do envio.
      setChave('');
      setAviso('Credencial guardada no cofre desta empresa, cifrada. Ela não volta por aqui.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'não consegui guardar a credencial');
    } finally {
      setOcupado(null);
    }
  }

  if (!ready) return <p className="text-sm text-muted">carregando…</p>;

  const status = retrato?.status ?? null;
  const bloqueado = retrato?.bloqueado ?? false;
  const podeAdministrar = can('admin.usuarios');

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-4">
      <header>
        <h1 className="font-os-mono text-[13px] font-bold uppercase tracking-[0.16em] text-text">
          Plano e assinatura
        </h1>
        <p className="mt-1 text-[12px] text-muted">
          O contrato desta empresa com a ROOT: plano, cobranças e estado do acesso.
        </p>
      </header>

      {erro && (
        <div className="rounded-xl border border-bad/40 bg-bad/5 p-4 text-[12px] text-bad">{erro}</div>
      )}

      {/*
       * O BLOCO DE SUSPENSÃO vem primeiro e ocupa espaço de propósito: quando ele
       * aparece, é a única coisa que a pessoa precisa ler.
       */}
      {bloqueado && (
        <section className="rounded-xl border border-bad/50 bg-bad/5 p-5">
          <h2 className="font-os-mono text-[11px] font-bold uppercase tracking-[0.16em] text-bad">
            {status === 'cancelada' ? 'Assinatura encerrada' : 'Acesso suspenso'}
          </h2>
          <p className="mt-2 text-[13px] leading-[1.7] text-text">
            <strong>Nada foi apagado.</strong> Seus leads, tarefas, conteúdos, conexões e todo o
            contexto carregado continuam exatamente onde estavam. A suspensão desliga o acesso às
            telas, e só isso: assim que o pagamento for confirmado, tudo volta inteiro, sem perda e
            sem refazer nenhuma configuração.
          </p>
          {retrato?.motivoDaSuspensao && (
            <p className="mt-3 text-[12px] text-muted">
              Motivo registrado: {retrato.motivoDaSuspensao}
              {retrato.suspensaEm ? ` (desde ${data(retrato.suspensaEm)})` : ''}
            </p>
          )}
          {/*
            O BOTÃO É DE QUEM ADMINISTRA A CONTA, e a linha alternativa existe
            para o resto não ficar olhando um botão que vai levar 403.

            Conferir dispara chamada externa com a credencial de cobrança da
            empresa e APLICA o que o provedor responder — inclusive quando o
            provedor discorda de uma reativação feita à mão. Enquanto esta rota
            não exigia permissão, qualquer usuário desfazia com um clique o que
            um administrador tinha acabado de decidir.
          */}
          <div className="mt-4">
            {podeAdministrar ? (
              <Botao tone="brand" onClick={conferir} disabled={ocupado === 'conferir'}>
                {ocupado === 'conferir' ? 'conferindo…' : 'já paguei — conferir agora'}
              </Botao>
            ) : (
              <p className="text-[12px] text-muted">
                Quem administra a conta desta empresa pode conferir o pagamento com o provedor por
                esta mesma tela, e o acesso volta na hora em que o provedor confirmar.
              </p>
            )}
          </div>
        </section>
      )}

      {aviso && (
        <div className="rounded-xl border border-border bg-surface-2 p-4 text-[12px] text-text">
          {aviso}
        </div>
      )}

      {retrato && !retrato.existe && (
        <Card titulo="sem assinatura">
          <p className="text-[12.5px] leading-[1.7] text-muted">
            Esta empresa ainda não tem assinatura registrada. O acesso segue liberado — ausência de
            assinatura nunca bloqueia ninguém.
            {podeAdministrar
              ? ' Quem administra a conta registra o plano no bloco abaixo.'
              : ' Quem administra a conta é quem registra o plano.'}
          </p>
        </Card>
      )}

      {retrato?.existe && (
        <Card titulo="o plano">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12.5px] sm:grid-cols-4">
            <div>
              <dt className="text-[11px] text-muted">plano</dt>
              <dd className="text-text">{retrato.plano}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">valor</dt>
              <dd className="text-text">
                {emReais(retrato.valorCentavos)}
                <span className="text-muted">/{retrato.ciclo === 'anual' ? 'ano' : 'mês'}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">estado</dt>
              <dd className={status ? (ROTULO[status]?.cor ?? 'text-text') : 'text-text'}>
                {status ? (ROTULO[status]?.texto ?? status) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">carência</dt>
              <dd className="text-text">{retrato.diasDeCarencia} dia(s) após o vencimento</dd>
            </div>
          </dl>
          <p className="mt-4 text-[11px] text-muted">
            Última conferência com o provedor: {data(retrato.conferidaEm)}
            {retrato.conferidaEm === null && ' — ainda não conseguimos perguntar'}
            {!retrato.ligadaAoProvedor &&
              ' · esta assinatura ainda não está ligada a nenhuma assinatura no provedor, então não há a quem perguntar'}
          </p>
          {retrato.perdoadasAte && (
            <p className="mt-2 text-[11px] text-muted">
              Reativada por decisão em {data(retrato.perdoadasAte)}: as cobranças vencidas até essa
              data não suspendem mais esta conta, mesmo que o provedor continue apontando atraso
              nelas. As seguintes, sim.
            </p>
          )}
          {!bloqueado && podeAdministrar && (
            <div className="mt-4">
              <Botao onClick={conferir} disabled={ocupado === 'conferir'}>
                {ocupado === 'conferir' ? 'conferindo…' : 'conferir com o provedor'}
              </Botao>
            </div>
          )}
        </Card>
      )}

      {retrato?.existe && (
        <Card titulo="cobranças">
          {retrato.cobrancas.length === 0 ? (
            <p className="text-[12px] text-muted">
              Nenhuma cobrança espelhada ainda. Isso não é inadimplência: sem cobrança vencida, não
              há o que suspender.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  <tr>
                    <th className="py-2 pr-4">vencimento</th>
                    <th className="py-2 pr-4">valor</th>
                    <th className="py-2 pr-4">estado</th>
                    <th className="py-2">pago em</th>
                  </tr>
                </thead>
                <tbody>
                  {retrato.cobrancas.map((c) => (
                    <tr key={c.referencia} className="border-t border-border">
                      <td className="py-2 pr-4 text-text">{data(c.vencimento)}</td>
                      <td className="py-2 pr-4 text-text">{emReais(c.valorCentavos)}</td>
                      <td
                        className={`py-2 pr-4 ${c.status === 'vencida' ? 'text-bad' : c.status === 'paga' ? 'text-good' : 'text-muted'}`}
                      >
                        {ROTULO_COBRANCA[c.status] ?? c.status}
                      </td>
                      <td className="py-2 text-muted">{data(c.pagoEm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {podeAdministrar && (
        <Card titulo={retrato?.existe ? 'alterar o plano' : 'registrar o plano'}>
          <p className="mb-4 text-[12px] leading-[1.7] text-muted">
            Registrar ou alterar o plano <strong>não mexe no acesso de ninguém</strong>: não reativa
            uma conta suspensa nem suspende uma ativa. Quem move acesso é a conferência com o
            provedor, que exige prova de cobrança vencida — e a reativação explícita, que é outro
            botão.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="plano" hint="o nome como o cliente o vê">
              <input
                className={inputCls}
                value={plano}
                onChange={(e) => {
                  setFormularioTocado(true);
                  setPlano(e.target.value);
                }}
                placeholder="root-os"
              />
            </Campo>
            <Campo label="valor (R$)" hint="por ciclo; use vírgula decimal">
              <input
                className={inputCls}
                inputMode="decimal"
                value={valor}
                onChange={(e) => {
                  setFormularioTocado(true);
                  setValor(e.target.value);
                }}
                placeholder="497,00"
              />
            </Campo>
            <Campo label="ciclo">
              <select
                className={inputCls}
                value={ciclo}
                onChange={(e) => {
                  setFormularioTocado(true);
                  setCiclo(e.target.value === 'anual' ? 'anual' : 'mensal');
                }}
              >
                <option value="mensal">mensal</option>
                <option value="anual">anual</option>
              </select>
            </Campo>
            <Campo label="carência (dias)" hint="dias após o vencimento antes de a suspensão valer">
              <input
                className={inputCls}
                inputMode="numeric"
                value={carencia}
                onChange={(e) => {
                  setFormularioTocado(true);
                  setCarencia(e.target.value);
                }}
                placeholder="7"
              />
            </Campo>
            <div className="sm:col-span-2">
              <Campo
                label="assinatura no provedor"
                hint={
                  retrato?.ligadaAoProvedor
                    ? 'já ligada; deixe em branco para manter como está'
                    : 'sem isto não há a quem perguntar, e ninguém é suspenso por esta assinatura'
                }
              >
                <input
                  className={inputCls}
                  value={assinaturaNoProvedor}
                  onChange={(e) => {
                    setFormularioTocado(true);
                    setAssinaturaNoProvedor(e.target.value);
                  }}
                  placeholder="sub_000000000000"
                />
              </Campo>
            </div>
          </div>
          <div className="mt-4">
            <Botao tone="brand" onClick={salvarPlano} disabled={ocupado === 'plano'}>
              {ocupado === 'plano' ? 'salvando…' : retrato?.existe ? 'salvar plano' : 'registrar plano'}
            </Botao>
          </div>
        </Card>
      )}

      {podeAdministrar && (
        <Card titulo="credencial do provedor">
          <p className="mb-3 text-[12px] leading-[1.7] text-muted">
            A chave de API do provedor de cobrança fica no cofre desta empresa, cifrada, e é
            emprestada por segundos a cada consulta. Ela não é exibida aqui — nem em parte —
            porque não existe motivo para exibi-la.
          </p>
          <p className="mb-3 text-[12px]">
            Estado:{' '}
            <span className={retrato?.credencialGuardada ? 'text-good' : 'text-warn'}>
              {retrato?.credencialGuardada ? 'guardada' : 'não configurada'}
            </span>
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Campo label="nova chave" hint="substitui a anterior; a antiga deixa de valer na hora">
                <input
                  type="password"
                  autoComplete="off"
                  className={inputCls}
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  placeholder="chave de API do provedor"
                />
              </Campo>
            </div>
            <Botao onClick={guardarChave} disabled={ocupado === 'chave' || chave.trim().length < 10}>
              {ocupado === 'chave' ? 'guardando…' : 'guardar no cofre'}
            </Botao>
          </div>
        </Card>
      )}
    </div>
  );
}
