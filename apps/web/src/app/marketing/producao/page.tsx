'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { FORMATOS_COM_REGUA, FORMATOS_SEM_DESIGN, MAQUINA_ESTEIRA, ROTULO_DA_ETAPA, type MaquinaEtapa, type MaquinaPost, type MaquinaPostSalvarInput } from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MaquinaPagina, type Contexto } from '@/components/maquina/MaquinaPagina';
import { hojeSP } from '@/components/maquina/pecas';

/*
 * Marketing › PRODUÇÃO › Quadro. Cópia do quadro do ROOT Estúdio (public/pages/producao.js):
 * uma coluna por etapa, cartão com a faixa do formato, título, resumo e "Abrir →".
 * As etapas são as da Máquina de Conteúdo (Banco → Design & Gravação → A agendar →
 * Agendado → Postado). No Banco, o cartão sem texto tem os botões de formato, como o
 * "Escolher formato" do Estúdio: escolher grava o formato, escreve o post pela régua e
 * leva para a etapa seguinte (Comunidade Wpp vai direto para A agendar).
 *
 * COMUNIDADE (27/10/2026, pedido do Lucas: "crie uma coluna só para o banco de ideias
 * para a comunidade"): os textos do agente da comunidade saem do Banco e ficam numa
 * coluna própria, na ordem do dia em que vão ao grupo (o dia vem do nome do arquivo).
 * Aprovar agenda para aquele dia; dia já passado pede outra data; Arquivar tira da fila.
 */

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** O dia sugerido: a data da peça ou, sem ela, o AAAA-MM-DD do nome do arquivo. */
const diaDaComunidade = (p: MaquinaPost) => p.data ?? (/^(\d{4}-\d{2}-\d{2})/.exec(p.numero)?.[1] ?? null);
const diaPorExtenso = (d: string) => `${SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${d.slice(8, 10)}/${d.slice(5, 7)}`;

const DICA: Record<string, string> = {
  ideia: 'Escolha como a ideia vira conteúdo.',
  producao: 'Grave ou faça a arte. Pronto manda para Agendar.',
  a_agendar: 'Pronto para ir ao ar. Escolha a data.',
  agendado: 'Com data marcada no Calendário.',
  publicado: 'Já foi ao ar.',
};
const FAIXA: Record<string, string> = { Reel: 'reel', LinkedIn: 'post', 'Comunidade Wpp': 'artigo', Story: 'reel' };
const dataCurta = (s: string) => {
  try {
    return new Date(s).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) + ', ' + new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};
function entrada(p: MaquinaPost, formato: string): MaquinaPostSalvarInput {
  return {
    numero: p.numero, titulo: p.titulo, pilar: p.pilar, formato, subtipo: formato === 'Comunidade Wpp' ? p.subtipo || 'News semanal' : '',
    tipoCard: formato === 'Reel' || formato === 'Story' ? 'video' : 'arte', prioridade: p.prioridade, headline: p.headline, subHeadline: p.subHeadline,
    roteiro: p.roteiro, slides: p.slides, design: p.design, legenda: p.legenda, cta: p.cta, porque: p.porque, fontes: p.fontes, recursos: p.recursos,
  };
}

export default function ProducaoPage() {
  const { token } = useAuth();
  const [gerando, setGerando] = useState<string | null>(null);
  return (
    <MaquinaPagina titulo="Produção" semCabecalho>
      {(ctx) => <Quadro {...ctx} token={token} gerando={gerando} setGerando={setGerando} />}
    </MaquinaPagina>
  );
}

function Quadro({ m, painel, abrir, novo, levar, token, gerando, setGerando }: Contexto & { token: string | null; gerando: string | null; setGerando: (id: string | null) => void }) {
        const por = Object.fromEntries(MAQUINA_ESTEIRA.map((e) => [e, [] as MaquinaPost[]])) as Record<MaquinaEtapa, MaquinaPost[]>;
        const comunidade: MaquinaPost[] = [];
        for (const p of [...painel.posts].sort((a, b) => a.ordem - b.ordem)) {
          if (p.etapa === 'ideia' && p.formato === 'Comunidade Wpp') comunidade.push(p);
          else if (por[p.etapa]) por[p.etapa].push(p);
        }
        comunidade.sort((a, b) => (diaDaComunidade(a) ?? '9').localeCompare(diaDaComunidade(b) ?? '9'));
        const hoje = hojeSP();
        const escolher = async (p: MaquinaPost, formato: string) => {
          setGerando(p.id);
          const salvo = await m.salvar(p.id, entrada(p, formato));
          if (salvo) {
            await m.agir(() => apiPost(`/marketing/estudio/posts/${p.id}/gerar`, {}, token));
            await m.mudarEtapa(p.id, FORMATOS_SEM_DESIGN.includes(formato) ? 'a_agendar' : 'producao');
            await m.recarregar();
          }
          setGerando(null);
        };
        return (
          <div className="estudio">
            <div className="row between" style={{ margin: '0 0 16px' }}>
              <span className="muted">{painel.posts.filter((p) => p.etapa !== 'arquivado').length} posts na esteira</span>
              <div className="row">
                {m.editavel && <button onClick={() => novo()}>+ Novo post</button>}
                <Link className="producao-link-btn" href="/marketing/triagem">
                  Avaliar ideias
                </Link>
              </div>
            </div>
            <div className="production-board producao-board">
              {MAQUINA_ESTEIRA.map((etapa) => (
                <Fragment key={etapa}>
                <section className={`production-column producao-col-${etapa}`}>
                  <header>
                    <h2>{ROTULO_DA_ETAPA[etapa]}</h2>
                    <span>{por[etapa].length}</span>
                  </header>
                  <p className="tiny muted">{DICA[etapa]}</p>
                  {por[etapa].length === 0 && <p className="board-empty">Nada aqui.</p>}
                  {por[etapa].map((p) => {
                    const semTexto = !p.roteiro && !p.legenda && p.slides.length === 0;
                    return (
                      <div
                        key={p.id}
                        className="content-card board-card producao-card"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button, a')) return;
                          abrir(p.id);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className={`card-art ${FAIXA[p.formato] ?? ''}`}>
                          <span>
                            {p.formato}
                            {p.subtipo ? ` · ${p.subtipo}` : ''}
                          </span>
                        </div>
                        <div className="card-body">
                          <h3>{p.titulo}</h3>
                          {(p.headline || p.porque) && <p>{p.headline || p.porque}</p>}
                          {etapa === 'ideia' && semTexto && m.editavel && (
                            <div className="producao-formats">
                              {FORMATOS_COM_REGUA.map((f) => (
                                <button key={f} className={`small${f === p.formato ? ' primary' : ''}`} disabled={gerando === p.id} onClick={() => void escolher(p, f)} title={f === p.formato ? 'Formato sugerido' : ''}>
                                  {f}
                                </button>
                              ))}
                            </div>
                          )}
                          {gerando === p.id && <span className="badge running">Escrevendo pela régua…</span>}
                          <div className="card-meta">
                            <span>{p.data ? `vai ao ar ${p.data.slice(8, 10)}/${p.data.slice(5, 7)}` : dataCurta(p.atualizadoEm)}</span>
                            <a
                              className="board-open"
                              href={`?post=${p.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                abrir(p.id);
                              }}
                            >
                              Abrir →
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </section>
                {etapa === 'ideia' && (
                  <section className="production-column producao-col-comunidade">
                    <header>
                      <h2>Comunidade · para aprovar</h2>
                      <span>{comunidade.length}</span>
                    </header>
                    <p className="tiny muted">Textos do agente do grupo, na ordem do dia em que vão ao ar.</p>
                    {comunidade.length === 0 && <p className="board-empty">Nenhum texto novo do agente.</p>}
                    {comunidade.map((p) => {
                      const dia = diaDaComunidade(p);
                      const passou = !dia || dia < hoje;
                      return (
                        <div
                          key={p.id}
                          className="content-card board-card producao-card"
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('button, a')) return;
                            abrir(p.id);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="card-art artigo">
                            <span>{dia ? diaPorExtenso(dia) : 'sem dia'}{p.subtipo ? ` · ${p.subtipo}` : ''}</span>
                          </div>
                          <div className="card-body">
                            <h3>{p.titulo}</h3>
                            {p.roteiro && <p>{p.roteiro}</p>}
                            {passou && <span className="badge">{dia ? 'O dia já passou' : 'Sem dia no arquivo'}</span>}
                            {m.editavel && (
                              <div className="producao-formats">
                                <button
                                  className="small primary"
                                  onClick={() => (passou ? levar(p, 'agendado') : void m.mudarEtapa(p.id, 'agendado', dia))}
                                  title="Agenda a peça. O envio da comunidade manda às 08h do dia."
                                >
                                  {passou ? 'Aprovar e escolher o dia' : `Aprovar para ${diaPorExtenso(dia!)}`}
                                </button>
                                <button className="small" onClick={() => void m.mudarEtapa(p.id, 'arquivado')}>
                                  Arquivar
                                </button>
                              </div>
                            )}
                            <div className="card-meta">
                              <span>{dataCurta(p.atualizadoEm)}</span>
                              <a
                                className="board-open"
                                href={`?post=${p.id}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  abrir(p.id);
                                }}
                              >
                                Ler e editar →
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </section>
                )}
                </Fragment>
              ))}
            </div>
          </div>
        );
}
