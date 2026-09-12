'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, Chip, inputCls } from '../../referencias/ui';

/*
 * ============================================================================
 * "AUTORIZAR O SUPORTE" — a tela do CLIENTE (RF-B-02, fatia 6.3)
 * ============================================================================
 *
 * Esta é a outra metade do console da plataforma, e a mais importante das duas:
 * o operador da ROOT não tem como entrar na conta de ninguém sem que alguém
 * DESTA tela tenha autorizado, escrito o motivo e escolhido o prazo.
 *
 * O QUE ELA DEIXA CLARO, e é por isso que ela é uma tela e não uma chamada de
 * API escondida num suporte por WhatsApp:
 *   · quem recebe o acesso, pelo e-mail;
 *   · o que ele vai ver (o escopo — hoje só contagens de diagnóstico);
 *   · até quando (no máximo 72 h, e o padrão é 1 h);
 *   · e a lista do que já foi autorizado, com um botão de revogar que vale na
 *     hora, sem esperar o prazo.
 *
 * A CASA DEFINITIVA DESTA TELA É A DE CONFIGURAÇÕES DA EMPRESA (`/config`), que
 * não é arquivo desta fatia — quatro agentes escrevem no mesmo worktree agora.
 * Ela mora aqui, ao lado do console, para a funcionalidade ficar inteira; mover
 * é copiar o arquivo e trocar o caminho. Está no relatório.
 *
 * O QUE A TELA NÃO DECIDE: a API confere as QUATRO exigências de R4 — motivo
 * escrito, alçada `titular` contra o papel LIDO DO BANCO (não o do token, que
 * dura oito horas), "é gente e não máquina" e a REAUTENTICAÇÃO de quem assina.
 * Aqui os campos só chegam preenchidos; a recusa vem de lá, com a frase que a
 * pessoa precisa ler.
 *
 * A SENHA É CAMPO DESTA TELA porque R4 exige prova de presença. Ela vai no corpo
 * do POST, é comparada com o hash pelo `ReauthService` e não fica em estado
 * nenhum depois do envio — o campo é limpo junto com os outros. Quem monta a
 * tela não decide se ela é exigida: a API responde isso em `GET /regras`
 * (`exigeSenha`), pelo mesmo motivo do prazo máximo — dois lados que afirmam a
 * mesma regra por conta própria divergem na fatia seguinte.
 */

interface Regras {
  escopos: string[];
  minutosMinimo: number;
  minutosMaximo: number;
  minutosPadrao: number;
  nivel: string;
  alcada: string;
  exigeSenha: boolean;
}

interface Acesso {
  id: string;
  operadorEmail: string;
  operadorNome: string | null;
  escopo: string;
  motivo: string;
  autorizadoPorNome: string;
  autorizadoEm: string;
  expiraEm: string;
  revogadoEm: string | null;
  estado: 'valido' | 'expirado' | 'revogado';
  segundosRestantes: number;
  usos: number;
  ultimoUsoEm: string | null;
}

const BASE = '/tenants/suporte';

export default function AutorizarSuporte() {
  const { token, ready } = useAuth();
  const [regras, setRegras] = useState<Regras | null>(null);
  const [acessos, setAcessos] = useState<Acesso[]>([]);
  const [email, setEmail] = useState('');
  const [motivo, setMotivo] = useState('');
  const [senha, setSenha] = useState('');
  const [minutos, setMinutos] = useState(60);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const [r, a] = await Promise.all([
        apiGet<Regras>(`${BASE}/regras`, token),
        apiGet<Acesso[]>(BASE, token),
      ]);
      setRegras(r);
      setMinutos(r.minutosPadrao);
      setAcessos(a);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  async function autorizar() {
    if (!token) return;
    setSalvando(true);
    setErro(null);
    try {
      await apiPost<Acesso>(
        BASE,
        {
          operadorEmail: email,
          escopo: regras?.escopos[0] ?? 'diagnostico',
          motivo,
          minutos,
          // Só vai quando a API diz que exige. Mandar um campo vazio faria a
          // recusa chegar como "senha incorreta" em vez de "falta a senha".
          ...(regras?.exigeSenha ? { senha } : {}),
        },
        token,
      );
      setEmail('');
      setMotivo('');
      setSenha('');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
      // A senha sai do estado mesmo quando a autorização FALHA: um campo de
      // senha que sobrevive a um erro é um campo de senha esquecido na tela.
      setSenha('');
    } finally {
      setSalvando(false);
    }
  }

  async function revogar(id: string) {
    if (!token) return;
    try {
      await apiDelete<Acesso>(`${BASE}/${id}`, token);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-os-mono text-[13px] font-bold tracking-[-0.01em] text-text">
          Acesso de suporte
        </h1>
        <p className="mt-1 max-w-[720px] text-[11.5px] leading-[1.6] text-muted">
          Ninguém da ROOT enxerga os dados desta empresa. Quando o suporte precisar olhar alguma
          coisa, é aqui que você autoriza — com prazo, com motivo escrito, e com registro no rastro.
          Você pode revogar a qualquer momento, sem esperar o prazo acabar.
        </p>
      </header>

      {erro && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-[11.5px] text-bad">
          {erro}
        </div>
      )}

      <Card titulo="autorizar">
        <div className="grid gap-3 md:grid-cols-3">
          <Campo label="e-mail de quem vai receber o acesso">
            <input
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="suporte@operacaoroot.com"
            />
          </Campo>
          <Campo
            label="prazo (minutos)"
            hint={
              regras
                ? `entre ${regras.minutosMinimo} e ${regras.minutosMaximo} (${Math.round(
                    regras.minutosMaximo / 60,
                  )} h)`
                : undefined
            }
          >
            <input
              className={inputCls}
              type="number"
              value={minutos}
              min={regras?.minutosMinimo}
              max={regras?.minutosMaximo}
              onChange={(e) => setMinutos(Number(e.target.value))}
            />
          </Campo>
          <Campo label="o que o suporte vai ver">
            {/* Escopo é lista fechada e hoje tem um item só. O campo existe
                mesmo assim: quando houver o segundo, a tela não muda. */}
            <input className={inputCls} value={regras?.escopos[0] ?? 'diagnostico'} disabled />
          </Campo>
        </div>
        <div className="mt-3">
          <Campo
            label="motivo"
            hint="fica no rastro desta empresa e é o que explica a concessão depois."
          >
            <input
              className={inputCls}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ex.: o agente parou de publicar e abrimos chamado"
            />
          </Campo>
        </div>
        {regras?.exigeSenha && (
          <div className="mt-3">
            <Campo
              label="sua senha"
              hint="conceder acesso à empresa exige confirmar que é você, agora."
            >
              <input
                className={inputCls}
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Campo>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Botao tone="brand" onClick={() => void autorizar()} disabled={salvando}>
            {salvando ? 'autorizando…' : 'autorizar'}
          </Botao>
          {regras && (
            <span className="text-[11px] text-muted">
              Isto é uma ação {regras.nivel} — só quem tem alçada {regras.alcada} no cadastro desta
              empresa pode assinar
              {regras.exigeSenha ? ', e a senha é conferida na hora.' : '.'}
            </span>
          )}
        </div>
      </Card>

      <Card titulo="quem tem (ou teve) acesso">
        {acessos.length === 0 ? (
          <p className="text-[11.5px] text-muted">Ninguém. Nenhum acesso de suporte foi autorizado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[11.5px]">
              <thead className="font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="py-2">quem</th>
                  <th>escopo</th>
                  <th>motivo</th>
                  <th>estado</th>
                  <th>vence</th>
                  <th className="text-right">usos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {acessos.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2 text-text">{a.operadorEmail}</td>
                    <td>{a.escopo}</td>
                    <td className="max-w-[280px] truncate text-muted" title={a.motivo}>
                      {a.motivo}
                    </td>
                    <td>
                      <Chip tone={a.estado === 'valido' ? 'good' : 'muted'}>{a.estado}</Chip>
                    </td>
                    <td className="text-muted">{quando(a.expiraEm)}</td>
                    <td className="text-right">{a.usos}</td>
                    <td className="text-right">
                      {a.estado === 'valido' && (
                        <Botao tone="bad" onClick={() => void revogar(a.id)}>
                          revogar
                        </Botao>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function quando(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
