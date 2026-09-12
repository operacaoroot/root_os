'use client';

import { useCallback, useEffect, useState } from 'react';
import { CODIGO_CONECTOR_DESLIGADO, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Item } from './Item';
import { EXPLICACAO_DA_GAVETA, TITULO_DA_GAVETA } from './ui';
import type { Confirmacao, Fila, Gaveta, ItemDaFila } from './tipos';

/*
 * A FILA DE APROVAÇÃO — RF-A-05, fatia 3.10.
 *
 * Aprovar era coisa de linha de comando (`node dist/scripts/aprovar.js`). Esta
 * tela é a mesma fila, com o que o terminal não conseguia mostrar: o conteúdo
 * exato que vai sair, os gatilhos que acenderam o degrau e quem, hoje, pode
 * assinar. Aprovar aqui EXECUTA e fecha o evento — o botão chama
 * `POST /approvals/:id/confirm`, que confirma e dispara pela porta.
 *
 * ---------------------------------------------------------------------------
 * A PERMISSÃO, QUE ERA O MOTIVO DE A TELA NÃO FUNCIONAR
 * ---------------------------------------------------------------------------
 * Até esta fatia o menu exigia `whatsapp.enviar` e a API exigia `mcp.executar`:
 * a tela aparecia para um público e respondia a outro. Agora os dois lados
 * pedem `aprovacoes.ver` (abrir a fila) e `aprovacoes.decidir` (assinar) — duas
 * chaves criadas para isto, porque `mcp.executar` mora nas contas de serviço da
 * IA e `whatsapp.enviar` amarraria a fila a um canal que ela não tem.
 *
 * ---------------------------------------------------------------------------
 * DUAS CHAVES, E ELAS NÃO VEEM A MESMA COISA
 * ---------------------------------------------------------------------------
 * `aprovacoes.ver` abre a fila; `aprovacoes.decidir` assina — e só a segunda
 * recebe o CONTEÚDO EXATO da ação retida. Esta rota é a primeira do repositório
 * a devolver por HTTP os argumentos de uma chamada de ferramenta (o corpo de uma
 * mensagem de WhatsApp, por exemplo), e é a assinatura informada que justifica a
 * exposição: quem vai responder pelo envio precisa ler o que assina. Quem só
 * acompanha a fila a vê inteira, sem o texto. Decisão do Pedro, registrada.
 *
 * ---------------------------------------------------------------------------
 * A TELA NÃO CALCULA NADA, E ISSO É O DESENHO
 * ---------------------------------------------------------------------------
 * Nível, gatilhos, alçada mínima, quem pode assinar e o porquê de o botão não
 * aparecer: tudo chega pronto de `GET /approvals/fila`, calculado a partir do
 * BANCO — a mesma leitura que a trava de `confirm` faz a cada decisão (papel do
 * banco, não do token, que vale oito horas). Uma segunda conta aqui no
 * navegador seria uma promessa que a API recusa, que é exatamente o defeito que
 * esta fatia veio consertar.
 *
 * ---------------------------------------------------------------------------
 * O QUE A TELA PRECISA DIZER EM VOZ ALTA
 * ---------------------------------------------------------------------------
 * Quem propõe não assina (invariante 7 da escada). Hoje a empresa da ROOT tem
 * um usuário só com alçada — então uma ação que ele mesmo disparou fica sem
 * ninguém para confirmar. Isso é decisão de operação registrada, não defeito, e
 * a tela diz isso com todas as letras em vez de mostrar uma fila que não anda.
 */

const ORDEM: Gaveta[] = ['esperando', 'confirmada', 'expirou', 'recusada'];

/** O que a caixa de erro precisa saber: a frase, e se há caminho de conserto. */
interface Erro {
  texto: string;
  conectorDesligado: boolean;
}

export default function AtendimentoPage() {
  const { token, ready } = useAuth();
  const [fila, setFila] = useState<Fila | null>(null);
  const [erro, setErro] = useState<Erro | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /*
   * A recusa de CONECTOR DESLIGADO chega com código estável (`conector_desligado`)
   * e o cliente de API já sabe traduzi-la — reaproveitar é obrigatório, porque a
   * alternativa (casar por substring da frase em português) quebra na primeira
   * reescrita do texto. Ver `lib/api.ts` e `/pauta`, que faz o mesmo.
   */
  const mostrarErro = useCallback((e: unknown) => {
    const codigo = (e as { codigo?: string | null }).codigo ?? null;
    setErro({
      texto: (e as Error).message,
      conectorDesligado: codigo === CODIGO_CONECTOR_DESLIGADO,
    });
  }, []);

  /*
   * RECARREGAR NÃO APAGA ERRO, e isso já foi defeito aqui.
   *
   * Toda decisão termina recarregando a fila — inclusive a que FALHOU, porque o
   * estado do item pode ter mudado do outro lado. Enquanto esta função limpava
   * o erro ao dar certo, a sequência era: confirmar → 403 de conector desligado
   * → recarregar → a caixa vermelha some. A pessoa clicava, nada acontecia e
   * nada era dito. Quem limpa é quem começa uma ação nova (e o botão Atualizar).
   */
  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setFila(await apiGet<Fila>('/approvals/fila', token));
    } catch (e) {
      mostrarErro(e);
    }
  }, [token, mostrarErro]);

  useEffect(() => {
    if (!ready || !token) return;
    void carregar();
  }, [ready, token, carregar]);

  const atualizar = () => {
    setErro(null);
    setAviso(null);
    void carregar();
  };

  const aprovar = async (id: string, motivo: string, senha: string) => {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      // Corpo enxuto de propósito: `ConfirmarSchema` é `.strict()`, e campo
      // desconhecido numa confirmação R4 é 400.
      const corpo: Record<string, unknown> = {};
      if (motivo.trim()) corpo.motivo = motivo.trim();
      if (senha) corpo.reauth = { senha };
      const r = await apiPost<Confirmacao>(`/approvals/${id}/confirm`, corpo, token);
      setAviso(descreverExecucao(r));
    } catch (e) {
      mostrarErro(e);
    } finally {
      setOcupado(false);
      await carregar();
    }
  };

  const recusar = async (id: string) => {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await apiPost(`/approvals/${id}/reject`, {}, token);
      setAviso('Recusada. Nada saiu, e a recusa está no rastro.');
    } catch (e) {
      mostrarErro(e);
    } finally {
      setOcupado(false);
      await carregar();
    }
  };

  const porGaveta = (g: Gaveta): ItemDaFila[] => fila?.itens.filter((i) => i.gaveta === g) ?? [];
  const esperando = porGaveta('esperando');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            O que o sistema preparou e não executou sozinho. Cada item mostra o conteúdo exato que
            vai sair, o degrau em que parou e quem pode assinar. Aprovar aqui executa a ação.
          </p>
          {fila && (
            <p className="mt-1 text-xs text-muted">
              {esperando.length} esperando · sua alçada: {fila.eu.alcada}
              {fila.eu.decide ? '' : ' · seu perfil não decide nesta fila'}
              {fila.eu.veConteudo ? '' : ' · sem o conteúdo das ações (só quem decide o vê)'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={atualizar}
          className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
        >
          Atualizar
        </button>
      </header>

      {fila && <Censo fila={fila} />}
      {fila && <Corte fila={fila} />}

      {aviso && (
        <div className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {aviso}
        </div>
      )}

      {erro && (
        <div className="space-y-1 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          <div>{erro.texto}</div>
          {erro.conectorDesligado && (
            <div>
              Nada foi enviado e a aprovação continua PENDENTE na fila.{' '}
              <a href="/conexoes" className="font-medium underline">
                religar em Conexões
              </a>{' '}
              e este mesmo botão volta a funcionar, sem nova autorização.
            </div>
          )}
        </div>
      )}

      {!fila && !erro && <p className="text-sm text-muted">Carregando a fila…</p>}

      {fila &&
        ORDEM.map((g) => {
          const itens = porGaveta(g);
          if (!itens.length && g !== 'esperando') return null;
          return (
            <section key={g} className="space-y-3">
              <div>
                <h2 className="text-sm font-medium">
                  {TITULO_DA_GAVETA[g]}{' '}
                  <span className="text-muted">({itens.length})</span>
                </h2>
                <p className="text-xs text-muted">{EXPLICACAO_DA_GAVETA[g]}</p>
              </div>
              {itens.length ? (
                itens.map((i) => (
                  <Item
                    key={i.id}
                    item={i}
                    // `decideNestaSessao`, não `decide`: a trava da rota lê a
                    // permissão do TOKEN, que dura horas. Quem foi promovido no
                    // meio da sessão já decide segundo o banco e ainda levaria
                    // "Permissão insuficiente" — o botão viria com recusa dentro.
                    euDecido={fila.eu.decideNestaSessao}
                    souOProponente={i.proponente.id === fila.eu.id}
                    ocupado={ocupado}
                    aoAprovar={(id, motivo, senha) => void aprovar(id, motivo, senha)}
                    aoRecusar={(id) => void recusar(id)}
                  />
                ))
              ) : (
                <p className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">
                  Nada esperando gente. Toda ação que a régua reteve já foi decidida.
                </p>
              )}
            </section>
          );
        })}
    </div>
  );
}

/**
 * O CENSO DE QUEM ASSINA — a honestidade que esta fila precisava.
 *
 * Com uma pessoa só com alçada, tudo o que ela mesma propõe fica sem aprovador
 * (invariante 7). Sem este aviso, a tela pareceria quebrada; com ele, o operador
 * sabe que a fila está funcionando exatamente como desenhada e qual é o
 * caminho — um segundo usuário com alçada.
 */
function Censo({ fila }: { fila: Fila }) {
  const { pessoasQueDecidem, porAlcada } = fila.censo;
  if (pessoasQueDecidem > 1) return null;
  return (
    <div
      className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
      data-testid="censo-alerta"
    >
      Esta empresa tem {pessoasQueDecidem === 0 ? 'nenhuma pessoa' : 'uma pessoa só'} com alçada para
      aprovar ({porAlcada.titular} titular, {porAlcada.responsavel} responsável, {porAlcada.operador}{' '}
      operador). Como quem propõe uma ação não pode assiná-la, tudo o que essa pessoa disparar fica
      retido até expirar. Não é defeito da fila: é a regra de duas pessoas. Para destravar, crie um
      segundo usuário com alçada em Régua → Quem autoriza.
    </div>
  );
}

/**
 * O TETO DA FILA, DITO EM VOZ ALTA.
 *
 * A resposta traz no máximo 100 linhas vivas e 60 encerradas. Enquanto o total
 * reportado era o número DEPOIS do corte, uma empresa com 300 ações esperando
 * via "100 esperando" e acreditava. Um item que não aparece é um item que
 * ninguém decide — e expira sozinho.
 */
function Corte({ fila }: { fila: Fila }) {
  if (!fila.truncado && !fila.censo.truncado) return null;
  return (
    <div
      className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
      data-testid="corte-alerta"
    >
      {fila.truncado && (
        <div>
          Esta empresa tem {fila.total} aprovações e a tela está mostrando {fila.mostrando} (teto de{' '}
          {fila.tetos.vivas} vivas e {fila.tetos.fechadas} encerradas por consulta). O que não
          aparece aqui continua correndo o prazo — decida as mais antigas primeiro.
        </div>
      )}
      {fila.censo.truncado && (
        <div>
          O censo de quem assina foi calculado sobre {fila.censo.pessoasLidas} de{' '}
          {fila.censo.pessoasAtivas} pessoas ativas: trate os números de alçada como amostra.
        </div>
      )}
    </div>
  );
}

/** O que dizer depois de aprovar. Os três desfechos possíveis são diferentes. */
function descreverExecucao(r: Confirmacao): string {
  if (r.execucao.status === 'executado') return `Aprovada e EXECUTADA: ${r.summary}.`;
  if (r.execucao.status === 'sem_efeito') {
    return `Aprovada, mas NÃO executada: ${r.execucao.motivo}`;
  }
  return `Aprovada: ${r.summary}. Esta é da superfície antiga — quem executa é a rota que carrega o token.`;
}
