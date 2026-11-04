'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import {
  FORMATOS_COM_REGUA,
  FORMATOS_SEM_DESIGN,
  MAQUINA_ESTEIRA,
  MAQUINA_PERFIS,
  ROTULO_DA_ETAPA,
  ROTULO_DO_PERFIL,
  type MaquinaEtapa,
  type MaquinaPerfil,
  type MaquinaPost,
  type MaquinaPostSalvarInput,
} from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MaquinaPagina, type Contexto } from '@/components/maquina/MaquinaPagina';
import { CampoDeDia, hojeSP, useVisao } from '@/components/maquina/pecas';

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
 *
 * LISTA E PARA QUEM (02/11/2026, pedido do Lucas: "a visualização igual ao ClickUp, entender o
 * que já saiu e o que não saiu"): Quadro | Lista, e o filtro Para quem (Root, Pedro, Lucas,
 * Rodrigo) vale nos dois. A Lista agrupa por etapa, com Executar em e Postar em editáveis na
 * linha; dia que passou sem o post andar fica em vermelho.
 */

type FiltroDePerfil = MaquinaPerfil | 'todos' | 'sem';
const diaCurto = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');

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
        const [visao, setVisao] = useVisao('producao', 'kanban');
        const [perfil, setPerfil] = useState<FiltroDePerfil>('todos');
        const visiveis = painel.posts.filter((p) => (perfil === 'todos' ? true : perfil === 'sem' ? p.perfis.length === 0 : p.perfis.includes(perfil)));
        const por = Object.fromEntries(MAQUINA_ESTEIRA.map((e) => [e, [] as MaquinaPost[]])) as Record<MaquinaEtapa, MaquinaPost[]>;
        const comunidade: MaquinaPost[] = [];
        for (const p of [...visiveis].sort((a, b) => a.ordem - b.ordem)) {
          // Só texto já escrito (o do agente); a ideia vazia com formato sugerido fica no Banco, com os botões de formato.
          const escrita = !!(p.roteiro || p.legenda || p.slides.length);
          if (p.etapa === 'ideia' && p.formato === 'Comunidade Wpp' && escrita) comunidade.push(p);
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
            <div className="production-viewbar">
              <div className="view-toggle">
                <button className={visao !== 'lista' ? 'active' : ''} onClick={() => setVisao('kanban')}>
                  Quadro
                </button>
                <button className={visao === 'lista' ? 'active' : ''} onClick={() => setVisao('lista')}>
                  Lista
                </button>
              </div>
              <div className="filters prod-perfis" aria-label="Para quem">
                <span className="tiny muted">Para quem</span>
                {(['todos', ...MAQUINA_PERFIS, 'sem'] as FiltroDePerfil[]).map((x) => (
                  <button key={x} className={perfil === x ? 'active' : ''} onClick={() => setPerfil(x)}>
                    {x === 'todos' ? 'Todos' : x === 'sem' ? 'Sem perfil' : ROTULO_DO_PERFIL[x]}
                  </button>
                ))}
              </div>
            </div>
            {visao === 'lista' ? (
              <ListaDaProducao m={m} posts={visiveis} abrir={abrir} levar={levar} hoje={hoje} />
            ) : (
            <div className="production-board producao-board">
              {MAQUINA_ESTEIRA.map((etapa) => (
                <Fragment key={etapa}>
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
                                  onClick={() => levar(passou ? p : { ...p, data: dia ?? p.data }, 'agendado')}
                                  title="Agenda a peça. O envio da comunidade manda às 08h do dia."
                                >
                                  {passou ? 'Aprovar e escolher o dia' : `Aprovar para ${diaPorExtenso(dia!)}…`}
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
                          {(p.perfis.length > 0 || p.dataExecucao) && (
                            <div className="prod-tags">
                              {p.perfis.map((x) => (
                                <span key={x} className={`prod-tag prod-tag-${x}`}>{ROTULO_DO_PERFIL[x]}</span>
                              ))}
                              {p.dataExecucao && (
                                <span className={`badge${p.dataExecucao < hoje && (etapa === 'ideia' || etapa === 'producao') ? ' error' : ''}`}>executar {diaCurto(p.dataExecucao)}</span>
                              )}
                            </div>
                          )}
                          <div className="card-meta">
                            <span>{p.data ? `${etapa === 'publicado' ? 'foi ao ar' : 'vai ao ar'} ${diaCurto(p.data)}` : dataCurta(p.atualizadoEm)}</span>
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
                </Fragment>
              ))}
            </div>
            )}
          </div>
        );
}

/** A ordem dos grupos da Lista: o que está andando primeiro, o Banco depois e o que já saiu no fim. */
const GRUPOS_DA_LISTA: MaquinaEtapa[] = ['producao', 'a_agendar', 'agendado', 'ideia', 'publicado'];
const DESCRICAO_DO_GRUPO: Partial<Record<MaquinaEtapa, string>> = { publicado: 'já saiu', agendado: 'vai sair', a_agendar: 'pronto, sem dia', producao: 'em execução', ideia: 'ainda não começou' };

/** A Lista, como no ClickUp: um grupo por etapa, que abre e fecha, e as datas editáveis na linha. */
function ListaDaProducao({ m, posts, abrir, levar, hoje }: Pick<Contexto, 'm' | 'abrir' | 'levar'> & { posts: MaquinaPost[]; hoje: string }) {
  const [fechados, setFechados] = useState<Set<MaquinaEtapa>>(() => new Set());
  const naEsteira = posts.filter((p) => p.etapa !== 'arquivado');
  const saiu = naEsteira.filter((p) => p.etapa === 'publicado').length;
  // Dentro do grupo: por dia de postar, depois por dia de executar; sem dia no fim, na ordem da esteira.
  const chave = (p: MaquinaPost) => p.data ?? p.dataExecucao ?? '9999';
  return (
    <div className="prod-lista-wrap">
      <p className="tiny muted prod-resumo">
        <strong>{saiu}</strong> já saíram · <strong>{naEsteira.length - saiu}</strong> ainda não saíram
      </p>
      {GRUPOS_DA_LISTA.map((etapa) => {
        const doGrupo = naEsteira.filter((p) => p.etapa === etapa).sort((a, b) => chave(a).localeCompare(chave(b)) || a.ordem - b.ordem);
        const fechado = fechados.has(etapa);
        return (
          <section key={etapa} className={`prod-grupo prod-grupo-${etapa}`}>
            <button
              className="prod-grupo-cab"
              onClick={() => setFechados((s) => {
                const n = new Set(s);
                if (n.has(etapa)) n.delete(etapa);
                else n.add(etapa);
                return n;
              })}
            >
              <span className="prod-seta">{fechado ? '▸' : '▾'}</span>
              <span className={`prod-status prod-status-${etapa}`}>{ROTULO_DA_ETAPA[etapa]}</span>
              <span className="muted tiny">{doGrupo.length} · {DESCRICAO_DO_GRUPO[etapa]}</span>
            </button>
            {!fechado && doGrupo.length > 0 && (
              <div className="prod-tabela" role="table">
                <div className="prod-linha prod-linha-cab" role="row">
                  <span>Post</span>
                  <span>Para quem</span>
                  <span>Executar em</span>
                  <span>Postar em</span>
                  <span>Status</span>
                </div>
                {doGrupo.map((p) => {
                  const atrasoExec = !!p.dataExecucao && p.dataExecucao < hoje && (p.etapa === 'ideia' || p.etapa === 'producao');
                  const atrasoPost = !!p.data && p.data < hoje && p.etapa !== 'publicado';
                  return (
                    <div key={p.id} className="prod-linha" role="row">
                      <button className="prod-nome" onClick={() => abrir(p.id)}>
                        <strong>{p.titulo}</strong>
                        <span className="tiny muted">
                          {p.formato}
                          {p.subtipo ? ` · ${p.subtipo}` : ''}
                          {p.comentarioDaIdeia ? ' · com comentário' : ''}
                        </span>
                      </button>
                      <span className="prod-tags">
                        {p.perfis.length ? p.perfis.map((x) => <span key={x} className={`prod-tag prod-tag-${x}`}>{ROTULO_DO_PERFIL[x]}</span>) : <span className="tiny muted">—</span>}
                      </span>
                      <span className={atrasoExec ? 'prod-atraso' : ''}>
                        <CampoDeDia className="prod-dia" valor={p.dataExecucao} desligado={!m.editavel} titulo="Dia de gravar o vídeo ou fazer a arte" onGravar={(v) => void m.planejar(p.id, { dataExecucao: v })} />
                      </span>
                      <span className={atrasoPost ? 'prod-atraso' : ''}>
                        <CampoDeDia className="prod-dia" valor={p.data} desligado={!m.editavel} titulo="Dia de ir ao ar" onGravar={(v) => void m.planejar(p.id, { data: v })} />
                      </span>
                      <select className="prod-select" value={p.etapa} disabled={!m.editavel} onChange={(e) => levar(p, e.target.value as MaquinaEtapa)}>
                        {[...MAQUINA_ESTEIRA, 'arquivado' as const].map((x) => (
                          <option key={x} value={x}>
                            {ROTULO_DA_ETAPA[x]}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
