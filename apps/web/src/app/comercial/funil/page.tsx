'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { CartaoDoFunil, ComercialDestinoDoMover, ComercialFiltrosDoFunil, ComercialMotivoDeSaida, ComercialResultadoDoMover, ComercialSaida, FichaDoLead, FunilVivo, VistaFunil } from '@mktos/shared';
import { COMERCIAL_MOTIVOS_DE_SAIDA, COMERCIAL_ROTULO_DA_ETAPA, COMERCIAL_SAIDAS, ROTULO_DO_TIPO_DE_NEGOCIO, filtrosDoFunilVazios } from '@mktos/shared';

import { AvatarDaPessoa } from '@/components/AvatarDaPessoa';
import { BotaoDeFiltros } from '@/components/filtros/BotaoDeFiltros';
import { VistasDoQuadro } from '@/components/trabalho/VistasDoQuadro';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';
import { ROTULO_DO_MOTIVO, ROTULO_DO_PRODUTO, diaSP } from '@/lib/cockpit';

import { Aviso, BarraDaSaude, BOTAO, BOTAO_PRIMARIO, Carregando, Chip, Erro, FOCO, INPUT, useCarregar } from '../_ui';
import { LinkDoLead, useMudouNoPainel } from '../_painel/provedor';
import { moverFocoNoFunil } from '../_painel/teclado';
import {
  aplicarMovimentosLocais,
  avisoDaConfirmacao,
  cartaoDepoisDoMover,
  cartaoOtimista,
  destinoDaColuna,
  fraseDoErro,
  locaisQueAindaValem,
  moverCartao,
  opcoesDoMenu,
  precisaDeConfirmacao,
  rotuloCurto,
  voltaEmDoDia,
  type MovimentosLocais,
} from '../_funil/mover';
import { BotaoDoMenuDoLead, MenuDoLeadProvider, alvoDoMenuDoLead, useMenuDoLead } from '../_funil/MenuDoLead';
import { caminhoDoFunil, configDaVistaDoFunil, definicoesDosFiltros, escreverEnderecoDoFunil, lerEnderecoDoFunil, valoresDoPainel, type ListaNoEndereco, type VisaoDoFunil } from '../_funil/filtros-do-funil';
import { COLUNAS_PADRAO, lerColunas, lerOrdem } from '../_funil/lista-do-funil';
import { ListaDoFunil, SeletorDeColunas } from '../_funil/ListaDoFunil';
import { RegistrarFechadoFora } from '../_funil/RegistrarFechadoFora';
import { NovoLead } from '../_funil/NovoLead';
import { BlocoDeTarefasDoComercial } from '../_funil/TarefasDoComercial';
import { contagemDeTarefas, proximaAcaoDoCartao, type LinhaDaProximaAcao } from '../_funil/proxima-acao-do-cartao';
import { partesDoLead } from '@/lib/nome-do-lead';
import { SeletorDeDensidade, useDensidade } from '@/components/SeletorDeDensidade';
import type { Densidade } from '@/lib/quadro-denso';

/*
 * TELA 04 · O FUNIL VIVO (lane C; painel na lane UX; mover na rodada do painel, P5;
 * mover sem limitação, filtros num botão e a lista na rodada da interface, U4).
 *
 * O cartão anda sozinho quando o fato chega. Uma PESSOA também pode movê-lo,
 * para QUALQUER etapa (decisão do dono do produto, 20/10/2026): arrastando para
 * outra coluna ou pelo menu "Mover para" (teclado e celular). A mudança grava na
 * hora, sem pedido nem assinatura; a tela diz só a mensagem ("Movido para…", e
 * "sem as conclusões de…" quando ficou portão para trás), e o cartão guarda o
 * balão do que falta até os fatos chegarem. Saída leva o motivo no mesmo gesto.
 *
 * No cabeçalho, o par [Vistas] [Filtros (n)] das tarefas, com o responsável
 * primeiro, e a troca Quadro · Lista. O estado mora no endereço. As colunas
 * rolam para o lado; as setas do teclado andam entre os cartões.
 *
 * Adendo de 21/10/2026 (§A1): no topo, o bloco recolhível "Tarefas do comercial"
 * (as sem lead, com o filtro "Responsável" valendo para ele), nos dois formatos.
 * No cartão, a tarefa aberta mais antiga do lead: como a próxima ação quando vem
 * antes da da ficha, senão como segunda linha, e a contagem das abertas.
 *
 * Produção 22B (I5, 22/10/2026): o formato Lista virou tabela de verdade
 * (`_funil/ListaDoFunil.tsx`): larguras ajustáveis guardadas no navegador,
 * ordenação pelo cabeçalho e colunas visíveis no painel de Filtros, as duas no
 * endereço e na vista salva. O quadro não mudou.
 *
 * Leva 5 (L5, 27/10/2026): o funil ficou fluido. O cartão ANDA NA HORA
 * (`MovimentosLocais` por cima do que a API deu) e volta com o aviso se a API
 * negar; a coluna não recarrega inteira: o cartão é refeito com a resposta do
 * mover e relido sozinho (`GET /comercial/lead/:id`); a entrada na coluna nova
 * tem 150 ms de transição. Arrastar ou escolher E8/E9 abre a confirmação com o
 * aviso da regra em vez de mover calado. Leva 5 (L2): botão direito e "⋯" no
 * cartão e na linha abrem o `MenuDoLead` (abrir, mover, copiar link da sala,
 * vincular WhatsApp, editar valor, histórico). `mover.service.ts` não mudou.
 */

type Coluna = FunilVivo['colunas'][number];
type AvisoDoCartao = { texto: string; tom: 'neutro' | 'bom' | 'ruim' };

export default function FunilVivoPage() {
  const { token, can } = useAuth();
  // T1b: a porta única de quem fechou fora do sistema (a implantação não tem mais "+ adicionar").
  const [registrando, setRegistrando] = useState(false);

  /* O estado no ENDEREÇO: lido na abertura (o `?filtro=` antigo é traduzido e sai), escrito a cada mudança. */
  const [pronto, setPronto] = useState(false);
  const [enderecoTemFiltro, setEnderecoTemFiltro] = useState(false);
  const [visao, setVisao] = useState<VisaoDoFunil>('quadro');
  const [filtros, setFiltros] = useState<ComercialFiltrosDoFunil>(filtrosDoFunilVazios);
  // I5: as colunas visíveis e a ordem da lista, também no endereço e na vista salva.
  const [lista, setLista] = useState<ListaNoEndereco>({ colunas: COLUNAS_PADRAO, ordem: null });
  const gravar = useCallback((v: VisaoDoFunil, f: ComercialFiltrosDoFunil, l: ListaNoEndereco) => {
    const busca = escreverEnderecoDoFunil(window.location.search, v, f, l);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${busca}${window.location.hash}`);
  }, []);
  useEffect(() => {
    const e = lerEnderecoDoFunil(window.location.search);
    setVisao(e.visao);
    setFiltros(e.filtros);
    setLista({ colunas: e.colunas, ordem: e.ordem });
    setEnderecoTemFiltro(e.temFiltro);
    if (e.migrou) gravar(e.visao, e.filtros, { colunas: e.colunas, ordem: e.ordem });
    setPronto(true);
  }, [gravar]);
  const mudarFiltros = (f: ComercialFiltrosDoFunil) => {
    setFiltros(f);
    gravar(visao, f, lista);
  };
  const mudarVisao = (v: VisaoDoFunil) => {
    setVisao(v);
    gravar(v, filtros, lista);
  };
  const mudarLista = (l: ListaNoEndereco) => {
    setLista(l);
    gravar(visao, filtros, l);
  };

  // A busca por texto espera a pessoa parar de digitar antes de ir à API.
  const [qBusca, setQBusca] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQBusca(filtros.q), 300);
    return () => window.clearTimeout(t);
  }, [filtros.q]);
  const caminho = pronto ? caminhoDoFunil({ ...filtros, q: qBusca }) : null;
  const { dados, erro, carregando, recarregar } = useCarregar<FunilVivo>(caminho, 30_000);
  useMudouNoPainel(recarregar);

  const definicoes = useMemo(() => definicoesDosFiltros(dados?.donos ?? []), [dados?.donos]);
  const vistaAtual: VistaFunil = configDaVistaDoFunil(visao, filtros, lista);

  const [avisos, setAvisos] = useState<Record<string, AvisoDoCartao>>({});
  const [saidaAberta, setSaidaAberta] = useState<{ leadId: string; saida: ComercialSaida | null } | null>(null);
  const [ocupados, setOcupados] = useState<Record<string, boolean>>({});
  const ocupar = (leadId: string, sim: boolean) => setOcupados(({ [leadId]: _, ...resto }) => (sim ? { ...resto, [leadId]: true } : resto));
  const [arrastando, setArrastando] = useState<CartaoDoFunil | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  // L5: os cartões que a tela moveu e a API ainda não devolveu na lista; a confirmação de E8/E9 aberta.
  const [locais, setLocais] = useState<MovimentosLocais>({});
  const [confirmacao, setConfirmacao] = useState<{ leadId: string; destino: ComercialDestinoDoMover } | null>(null);
  useEffect(() => {
    if (dados) setLocais((l) => locaisQueAindaValem(dados.colunas, l));
  }, [dados]);
  // Layout 26/10: a mesma densidade de todo quadro do OS (compacto · médio · cheio).
  const [densidade, escolherDensidade] = useDensidade();

  const avisar = (leadId: string, texto: string, tom: AvisoDoCartao['tom'] = 'neutro') => setAvisos((a) => ({ ...a, [leadId]: { texto, tom } }));
  const calar = (leadId: string) => setAvisos(({ [leadId]: _, ...resto }) => resto);

  /** L5: relê SÓ o cartão (a ficha do lead) e refaz o que a etapa nova muda: próxima ação, saúde, balão. */
  async function refrescarCartao(leadId: string) {
    try {
      const f = await apiGet<FichaDoLead>(`/comercial/lead/${encodeURIComponent(leadId)}`, token);
      // Resposta fora do formato (dublê, rota antiga) não derruba o quadro: o tique de 30 s refaz o cartão.
      if (!f || typeof f !== 'object' || typeof (f as { etapa?: unknown }).etapa !== 'string') return;
      setLocais((l) => {
        const atual = l[leadId];
        if (!atual || atual.etapa !== f.etapa) return l;
        return {
          ...l,
          [leadId]: {
            ...atual,
            etapaDesde: f.etapaDesde,
            proximaAcao: f.proximaAcao,
            saude: f.saude,
            balao: f.balao ?? atual.balao ?? null,
            motivoSaida: f.motivoSaida,
            voltaEm: f.voltaEm,
            produto: f.produto,
            perfil: f.perfil,
            donoId: f.dono?.id ?? atual.donoId ?? null,
            dono: f.dono?.nome ?? atual.dono ?? null,
          },
        };
      });
    } catch {
      /* a leitura de 30 s refaz o cartão inteiro; aqui nada quebra */
    }
  }

  /** L5: o resultado do mover entra no cartão na hora (pelo quadro, pelo menu do lead ou pela saída). */
  function aplicarMover(c: CartaoDoFunil, r: ComercialResultadoDoMover) {
    setLocais((l) => ({ ...l, [c.leadId]: cartaoDepoisDoMover(c, r) }));
    void refrescarCartao(c.leadId);
  }

  async function agir(c: CartaoDoFunil, d: ComercialDestinoDoMover, confirmado = false) {
    calar(c.leadId);
    if (!d.permitido) return avisar(c.leadId, d.motivo ? `${d.motivo}.` : 'Não deu para mover.');
    if (d.caminho === 'saida') return setSaidaAberta({ leadId: c.leadId, saida: (COMERCIAL_SAIDAS as readonly string[]).includes(d.para) ? (d.para as ComercialSaida) : null });
    // L5: E8 e E9 abrem a confirmação com o aviso da regra em vez de mover calado.
    if (precisaDeConfirmacao(d) && !confirmado) return setConfirmacao({ leadId: c.leadId, destino: d });
    setConfirmacao(null);
    // L5: o cartão anda na hora; se a API negar, volta.
    setLocais((l) => ({ ...l, [c.leadId]: cartaoOtimista(c, d.para) }));
    ocupar(c.leadId, true);
    try {
      const r = await moverCartao(c.leadId, { para: d.para }, token);
      aplicarMover(c, r);
      avisar(c.leadId, r.mensagem || `Movido para ${COMERCIAL_ROTULO_DA_ETAPA[r.para]}.`, r.pendencias?.length ? 'neutro' : 'bom');
    } catch (e) {
      setLocais(({ [c.leadId]: _, ...resto }) => resto);
      avisar(c.leadId, fraseDoErro(e), 'ruim');
    } finally {
      ocupar(c.leadId, false);
    }
  }

  function soltar(e: React.DragEvent, coluna: Coluna) {
    e.preventDefault();
    setSobre(null);
    const id = e.dataTransfer?.getData('text/plain') || arrastando?.leadId;
    const c = dados?.colunas.flatMap((x) => x.cartoes).find((x) => x.leadId === id);
    setArrastando(null);
    if (!c || c.etapa === coluna.etapa) return;
    if (coluna.etapa === 'saidas') return setSaidaAberta({ leadId: c.leadId, saida: null });
    void agir(c, destinoDaColuna(c, coluna.etapa));
  }

  // L5: as colunas da tela são as da API com os movimentos locais por cima.
  const colunas = aplicarMovimentosLocais(dados?.colunas ?? [], locais);
  const cartoes = colunas.flatMap((c) => c.cartoes);
  const editar = can('leads.editar');

  return (
    <MenuDoLeadProvider
      onMovido={(leadId, r) => {
        const c = cartoes.find((x) => x.leadId === leadId);
        if (c) aplicarMover(c, r);
        else void recarregar();
      }}
    >
    <div className="flex min-w-0 flex-col gap-3 md:min-h-[calc(100dvh-52px-2rem)] min-[820px]:min-h-[calc(100dvh-46px-3rem)]">
      {/* L5: a entrada do cartão na coluna nova, em 150 ms (com movimento reduzido a classe motion-safe nem aplica). */}
      <style>{`@keyframes funil-cartao-entra { from { transform: translateY(-6px) scale(0.98); opacity: 0.35; } to { transform: none; opacity: 1; } }`}</style>
      <header className="min-w-0 shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div role="group" aria-label="formato de visualização" className="inline-flex overflow-hidden rounded border border-border">
            {(['quadro', 'lista'] as const).map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`funil-visao-${v}`}
                aria-pressed={visao === v}
                onClick={() => mudarVisao(v)}
                className={`px-2.5 py-1.5 text-[12.5px] max-md:min-h-[44px] ${visao === v ? 'bg-brand/10 text-brand' : 'text-muted hover:text-text'} ${FOCO}`}
              >
                {v === 'quadro' ? 'Quadro' : 'Lista'}
              </button>
            ))}
          </div>
          {pronto && (
            <VistasDoQuadro<VistaFunil>
              token={token}
              tela="funil"
              testId="funil"
              atual={vistaAtual}
              enderecoTemFiltro={enderecoTemFiltro}
              aplicar={(v) => {
                const f = { ...filtrosDoFunilVazios(), ...v.filtros };
                const l: ListaNoEndereco = { colunas: lerColunas(v.colunas), ordem: lerOrdem(v.ordem) };
                setVisao(v.visao);
                setFiltros(f);
                setLista(l);
                gravar(v.visao, f, l);
              }}
            />
          )}
          {visao === 'quadro' && <SeletorDeDensidade densidade={densidade} aoEscolher={escolherDensidade} testId="funil-densidade" />}
          <BotaoDeFiltros
            testId="funil-filtros"
            alinhar="esquerda"
            filtros={definicoes}
            valores={valoresDoPainel(filtros)}
            aoMudar={(chave, valor) => mudarFiltros({ ...filtros, [chave]: valor })}
            aoLimparTudo={() => mudarFiltros(filtrosDoFunilVazios())}
            extra={visao === 'lista' ? <SeletorDeColunas colunas={lista.colunas} aoMudar={(colunas) => mudarLista({ ...lista, colunas })} /> : undefined}
          />
          <NovoLead origem="funil" className="min-[820px]:ml-auto" />
          {editar && (
            <button
              type="button"
              data-testid="funil-registrar-fechado-fora"
              aria-expanded={registrando}
              onClick={() => setRegistrando((v) => !v)}
              className={BOTAO}
            >
              Registrar cliente já fechado
            </button>
          )}
          <Link href="/caixa?aba=decisoes" className={BOTAO}>decisões em Pendências</Link>
        </div>
        <p className="text-[12.5px] text-muted">
          O cartão anda sozinho com os fatos. Para mover à mão, arraste para outra coluna ou use &quot;mover&quot;: a etapa muda na hora, para qualquer etapa. Etapa que fica para trás sem as conclusões aparece no cartão até os fatos chegarem. Setas do teclado andam entre os cartões, Enter abre o lead.
        </p>
        {registrando && <RegistrarFechadoFora aoFechar={() => setRegistrando(false)} aoRegistrar={() => void recarregar()} />}
        <Erro erro={erro} aoTentar={() => void recarregar()} />
        {/* C-20: acima do teto de leitura a API corta os mais antigos na etapa e diz quantos ficaram de fora. */}
        {dados?.aviso && <Aviso>{dados.aviso}</Aviso>}
        {(carregando || !pronto) && !dados && !erro && <Carregando linhas={2} altura="h-32" />}
      </header>

      {pronto && <BlocoDeTarefasDoComercial pessoa={filtros.dono} />}

      {dados && visao === 'lista' && <ListaDoFunil cartoes={cartoes} colunas={lista.colunas} ordem={lista.ordem} aoOrdenar={(ordem) => mudarLista({ ...lista, ordem })} />}

      {dados && visao === 'quadro' && (
        <div className="relative flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:snap-none" onKeyDown={moverFocoNoFunil}
          onDragOver={(e) => {
            // Layout 26/10: arrastando um cartão perto da borda, o quadro anda para o lado (as colunas da direita chegam).
            if (!arrastando) return;
            const q = e.currentTarget.getBoundingClientRect();
            const borda = 90;
            if (e.clientX > q.right - borda) e.currentTarget.scrollLeft += 18;
            else if (e.clientX < q.left + borda) e.currentTarget.scrollLeft -= 18;
          }}
        >
          {colunas.map((col) => {
            const alvo = arrastando && arrastando.etapa !== col.etapa;
            return (
              <section
                key={col.etapa}
                aria-label={col.etapa === 'saidas' ? 'Saídas' : COMERCIAL_ROTULO_DA_ETAPA[col.etapa]}
                data-coluna-do-funil
                data-testid={`funil-coluna-${col.etapa}`}
                className={`flex w-[17rem] min-w-0 shrink-0 snap-start flex-col rounded border bg-surface p-2 max-md:max-h-[72dvh] max-md:w-[86%] ${sobre === col.etapa && alvo ? 'border-brand' : 'border-border'}`}
                onDragOver={(e) => {
                  if (!arrastando) return;
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = alvo ? 'move' : 'none';
                  if (sobre !== col.etapa) setSobre(col.etapa);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null);
                }}
                onDrop={(e) => soltar(e, col)}
              >
                <h2
                  tabIndex={-1}
                  data-cabecalho-da-coluna
                  className={`flex shrink-0 items-baseline justify-between rounded-sm px-1 pb-2 font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted ${FOCO}`}
                >
                  <span className="truncate" title={col.rotulo}>{col.etapa === 'saidas' ? 'Saídas' : COMERCIAL_ROTULO_DA_ETAPA[col.etapa]}</span>
                  <span className="tabular-nums">{col.cartoes.length}</span>
                </h2>
                <ul className="relative min-h-0 flex-1 space-y-2 pr-0.5 max-md:overflow-y-auto">
                  {col.cartoes.map((c) => (
                    <li key={c.leadId}>
                      <Cartao
                        c={c}
                        aviso={avisos[c.leadId] ?? null}
                        ocupado={!!ocupados[c.leadId]}
                        podeMover={editar}
                        densidade={densidade}
                        recemMovido={!!locais[c.leadId]}
                        saida={saidaAberta?.leadId === c.leadId ? saidaAberta : null}
                        confirmacao={confirmacao?.leadId === c.leadId ? confirmacao.destino : null}
                        aoEscolher={(d) => void agir(c, d)}
                        aoConfirmar={(d) => void agir(c, d, true)}
                        aoCancelarConfirmacao={() => setConfirmacao(null)}
                        aoFecharSaida={() => setSaidaAberta(null)}
                        aoSairFeito={(mensagem, r) => {
                          setSaidaAberta(null);
                          avisar(c.leadId, mensagem, 'bom');
                          // L5: a saída também anda na hora; sem a resposta (dublê antigo), relê a lista.
                          if (r) aplicarMover(c, r);
                          else void recarregar();
                        }}
                        aoArrastar={(sim) => setArrastando(sim ? c : null)}
                        aoCalar={() => calar(c.leadId)}
                      />
                    </li>
                  ))}
                  {col.cartoes.length === 0 && <li className="px-1 py-2 text-[12px] text-dim">ninguém aqui</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
    </MenuDoLeadProvider>
  );
}

/** Uma linha de próxima ação: o texto e o tempo, com o atraso da tarefa em destaque. */
function TextoDaAcao({ linha }: { linha: LinhaDaProximaAcao | null }) {
  if (!linha) return <>próxima ação ausente</>;
  return (
    <>
      {linha.texto}
      {linha.quando && <span className={linha.atrasada ? 'text-warn' : 'text-dim'}> · {linha.quando}</span>}
    </>
  );
}

function Cartao({
  c,
  aviso,
  ocupado,
  podeMover,
  saida,
  confirmacao,
  recemMovido = false,
  aoEscolher,
  aoConfirmar,
  aoCancelarConfirmacao,
  aoFecharSaida,
  aoSairFeito,
  aoArrastar,
  aoCalar,
  densidade = 'cheio',
}: {
  densidade?: Densidade;
  c: CartaoDoFunil;
  aviso: AvisoDoCartao | null;
  ocupado: boolean;
  podeMover: boolean;
  /** L5: o cartão acabou de ser movido pela tela (anima a entrada na coluna). */
  recemMovido?: boolean;
  saida: { leadId: string; saida: ComercialSaida | null } | null;
  /** L5: o destino E8/E9 à espera de confirmação neste cartão. */
  confirmacao: ComercialDestinoDoMover | null;
  aoEscolher: (d: ComercialDestinoDoMover) => void;
  aoConfirmar: (d: ComercialDestinoDoMover) => void;
  aoCancelarConfirmacao: () => void;
  aoFecharSaida: () => void;
  aoSairFeito: (mensagem: string, resultado?: ComercialResultadoDoMover) => void;
  aoArrastar: (sim: boolean) => void;
  aoCalar: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  // L2: o menu do lead (botão direito, Shift+F10, tecla Menu e o "⋯").
  const menuDoLead = useMenuDoLead();
  const paraOMenu = { id: c.leadId, nome: c.nome, empresa: c.empresa, etapa: c.etapa, voltaPara: c.voltaPara ?? null };
  const { principal, segunda } = proximaAcaoDoCartao(c);
  const contagem = contagemDeTarefas(c.tarefasAbertas);
  const naSaida = (COMERCIAL_SAIDAS as readonly string[]).includes(c.etapa);
  const rotuloDaSaida = naSaida && c.motivoSaida ? `${COMERCIAL_ROTULO_DA_ETAPA[c.etapa].replace('Saída · ', '').toLowerCase()} · ${ROTULO_DO_MOTIVO[c.motivoSaida]}` : null;
  const fecharMenu = () => {
    setMenu(false);
    botao.current?.focus();
  };

  return (
    <div
      data-testid={`funil-card-${c.leadId}`}
      data-recem-movido={recemMovido || undefined}
      draggable={podeMover && !ocupado}
      {...alvoDoMenuDoLead(menuDoLead, paraOMenu)}
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', c.leadId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        aoArrastar(true);
      }}
      onDragEnd={() => aoArrastar(false)}
      onClick={(e) => {
        // O cartão inteiro abre o painel; o menu, os formulários e o próprio link cuidam de si.
        if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="menu"]')) return;
        e.currentTarget.querySelector<HTMLAnchorElement>('[data-cartao-do-funil]')?.click();
      }}
      className={`cursor-pointer rounded border bg-surface p-2.5 transition-[border-color,transform,opacity,box-shadow] duration-150 hover:border-brand/70 ${recemMovido ? 'motion-safe:animate-[funil-cartao-entra_150ms_ease-out]' : ''} ${ocupado ? 'opacity-80' : ''} ${c.balao || c.avisoDoMover ? 'border-warn/70' : c.precisaDeDecisao ? 'border-brand/60' : c.parado ? 'border-warn/60' : 'border-border-strong shadow-sm'}`}
    >
      <div className="flex items-start gap-2">
        <LinkDoLead leadId={c.leadId} aba="geral" data-cartao-do-funil className={`min-w-0 flex-1 rounded-sm ${FOCO}`}>
          {/* Layout 26/10 (P-22): empresa no título, representante embaixo. */}
          <p className="truncate text-[13.5px] font-semibold" title={partesDoLead(c.nome, c.empresa).titulo}>{partesDoLead(c.nome, c.empresa).titulo}</p>
          {partesDoLead(c.nome, c.empresa).pessoa && <p className="truncate text-[11.5px] text-muted">{partesDoLead(c.nome, c.empresa).pessoa}</p>}
        </LinkDoLead>
        {podeMover && (
          <button
            ref={botao}
            type="button"
            data-testid={`funil-mover-${c.leadId}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={`mover ${c.empresa ?? c.nome} para outra etapa`}
            aria-disabled={ocupado}
            onClick={() => {
              if (!ocupado) setMenu((m) => !m);
            }}
            className={`shrink-0 rounded border border-border px-1.5 font-os-mono text-[10px] text-muted max-md:min-h-[44px] max-md:min-w-[44px] ${ocupado ? 'cursor-not-allowed opacity-50' : 'hover:border-brand hover:text-text'} ${FOCO}`}
          >
            mover
          </button>
        )}
        <BotaoDoMenuDoLead lead={paraOMenu} className="mt-0.5" />
      </div>
      {confirmacao && (
        <div data-testid={`funil-confirmar-${c.leadId}`} role="group" aria-label={`confirmar mover ${c.empresa ?? c.nome}`} className="mt-2 space-y-1.5 rounded border border-warn/50 bg-warn/10 p-2 text-[12px]">
          <p>Mover para <strong>{COMERCIAL_ROTULO_DA_ETAPA[confirmacao.para]}</strong>?</p>
          <p className="text-[11.5px] text-warn">{avisoDaConfirmacao(confirmacao)}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" autoFocus data-testid={`funil-confirmar-mover-${c.leadId}`} onClick={() => aoConfirmar(confirmacao)} className={BOTAO_PRIMARIO}>mover mesmo assim</button>
            <button type="button" onClick={aoCancelarConfirmacao} className={BOTAO}>cancelar</button>
          </div>
        </div>
      )}
      {menu && (
        <MenuMover
          c={c}
          botao={botao}
          aoEscolher={(d) => {
            fecharMenu();
            aoEscolher(d);
          }}
          aoFechar={fecharMenu}
          aoSair={() => setMenu(false)}
        />
      )}
      <BarraDaSaude saude={c.saude} />
      {densidade !== 'compacto' && <>
      <p className="mt-1.5 break-words text-[12px] text-muted" data-testid={`funil-proxima-${c.leadId}`}>
        {rotuloDaSaida ?? <TextoDaAcao linha={principal} />}
        {c.voltaEm && <span className="text-dim"> · volta {diaSP(c.voltaEm)}</span>}
      </p>
      {!rotuloDaSaida && segunda && (
        <p className="mt-0.5 break-words text-[11.5px] text-dim" data-testid={`funil-segunda-${c.leadId}`}>
          <TextoDaAcao linha={segunda} />
        </p>
      )}
      </>}
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="font-os-mono text-[10px] text-dim">{rotuloCurto(c.etapa)}</span>
        {/* O responsável só com a imagem, o nome no balão (I6). */}
        {c.dono && <AvatarDaPessoa nome={c.dono} pessoaId={c.donoId ?? null} tamanho="p" rotulo={`Responsável: ${c.dono}`} />}
        {c.perfil && <Chip>{c.perfil}</Chip>}
        {c.produto && <Chip>{ROTULO_DO_PRODUTO[c.produto]}</Chip>}
        {/* Layout 26/10: o negócio que não gera caixa ganha selo (pagante, o padrão, não). */}
        {c.tipoNegocio && c.tipoNegocio !== 'pagante' && <Chip tom="info" title="Tipo do negócio: não gera caixa para a ROOT">{ROTULO_DO_TIPO_DE_NEGOCIO[c.tipoNegocio].toLowerCase()}</Chip>}
        {/* Layout 26/10: o onboarding já começou (card na Implantação antes do fechamento): não é card repetido. */}
        {c.onboardingCardId && (
          <Link
            href={`/trabalho/implantacao?tarefa=${encodeURIComponent(c.onboardingCardId)}`}
            data-testid={`funil-onboarding-${c.leadId}`}
            title="O onboarding começou antes do fechamento: abrir o card na Implantação"
            className="rounded border border-brand/50 px-1.5 font-os-mono text-[10px] text-brand hover:bg-brand/10"
          >
            onboarding iniciado →
          </Link>
        )}
        {c.precisaDeDecisao && <Chip tom="brand">decisão sua</Chip>}
        {c.parado && <Chip tom="alerta">parado {c.diasNaEtapa} d</Chip>}
        {contagem && <Chip title="tarefas do comercial abertas deste lead">{contagem}</Chip>}
        {/* No compacto e no médio os avisos viram selo; no cheio vêm por extenso. */}
        {densidade !== 'cheio' && c.balao && <Chip tom="alerta" title={`movido com pendências: ${c.balao.pendencias.join('; ')}`}>pendências {c.balao.pendencias.length}</Chip>}
        {densidade !== 'cheio' && c.avisoDoMover && <Chip tom="alerta" title={c.avisoDoMover.texto}>movido à mão</Chip>}
      </div>

      {densidade === 'cheio' && c.balao && (
        <div role="note" data-testid={`funil-balao-${c.leadId}`} className="mt-2 rounded border border-warn/50 bg-warn/10 px-2 py-1.5 text-[11.5px] leading-snug">
          <p className="font-os-mono text-[9.5px] uppercase tracking-[0.12em] text-warn">movido com pendências</p>
          <p className="mt-0.5 text-text">{c.balao.pendencias.join('; ')}</p>
          <p className="mt-0.5 text-dim">{c.balao.movidoPor ? `por ${c.balao.movidoPor} · ` : ''}{diaSP(c.balao.em)} · some quando o que falta chegar</p>
        </div>
      )}

      {densidade === 'cheio' && c.avisoDoMover && (
        <div role="note" data-testid={`funil-aviso-mao-${c.leadId}`} className="mt-2 rounded border border-warn/50 bg-warn/10 px-2 py-1.5 text-[11.5px] leading-snug">
          <p className="font-os-mono text-[9.5px] uppercase tracking-[0.12em] text-warn">movido à mão</p>
          <p className="mt-0.5 text-text">{c.avisoDoMover.texto}</p>
          <p className="mt-0.5 text-dim">{c.avisoDoMover.por ? `por ${c.avisoDoMover.por} · ` : ''}{diaSP(c.avisoDoMover.em)}</p>
        </div>
      )}

      {saida && <FormDaSaida c={c} inicial={saida.saida} aoFechar={aoFecharSaida} aoFeito={aoSairFeito} />}

      {aviso && (
        <div className="mt-2 flex items-start gap-1.5" aria-live="polite" data-testid={`funil-mensagem-${c.leadId}`}>
          <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>
          <button type="button" className={BOTAO} onClick={aoCalar}>ok</button>
        </div>
      )}
    </div>
  );
}

/**
 * O menu "Mover para": cada etapa e cada saída, menos a de agora. Todas valem
 * (U4); a linha de apoio diz o que o mover à mão não faz (E8, E9) e as saídas
 * avisam que levam o motivo. Esc e a escolha fecham e devolvem o foco ao botão;
 * Tab para fora ou clique fora fecham sem roubar o foco de onde ele foi.
 */
function MenuMover({
  c,
  botao,
  aoEscolher,
  aoFechar,
  aoSair,
}: {
  c: CartaoDoFunil;
  botao: React.RefObject<HTMLButtonElement | null>;
  aoEscolher: (d: ComercialDestinoDoMover) => void;
  aoFechar: () => void;
  aoSair: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  // Layout 26/10: o menu abre por cima da tela (fixo, junto do botão), não dentro da coluna, que cortava as etapas.
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const b = botao.current?.getBoundingClientRect();
      if (!b) return;
      const largura = 256;
      const left = Math.max(8, Math.min(b.right - largura, window.innerWidth - largura - 8));
      const embaixo = window.innerHeight - b.bottom - 12;
      const emCima = b.top - 12;
      if (embaixo >= 320 || embaixo >= emCima) setPos({ top: b.bottom + 4, left, maxH: embaixo });
      else setPos({ top: Math.max(8, b.top - 4 - Math.min(emCima, 560)), left, maxH: Math.min(emCima, 560) });
    };
    medir();
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => { window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true); };
  }, [botao]);
  useEffect(() => {
    caixa.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }, [pos !== null]);
  const opcoes = opcoesDoMenu(c);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={caixa}
      role="menu"
      aria-label={`Mover ${c.empresa ?? c.nome} para`}
      onBlur={(e) => {
        const para = e.relatedTarget as Node | null;
        // O clique no próprio botão "mover" é dele (alterna); o resto fora do menu fecha.
        if (para && (caixa.current?.contains(para) || botao.current?.contains(para))) return;
        aoSair();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          aoFechar();
          return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const itens = Array.from(caixa.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = itens.indexOf(document.activeElement as HTMLElement);
        itens[(i + (e.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length]?.focus();
      }}
      style={pos ? { position: 'fixed', top: pos.top, left: pos.left, width: 256, maxHeight: pos.maxH } : { position: 'fixed', visibility: 'hidden' }}
      className="z-50 overflow-y-auto rounded border border-border bg-surface-2 p-1 shadow-2xl"
    >
      <p className="px-2 pb-1 pt-0.5 font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">mover para</p>
      {opcoes.map((d) => (
        <button
          key={d.para}
          type="button"
          role="menuitem"
          data-testid={`funil-mover-para-${d.para}`}
          aria-disabled={!d.permitido}
          aria-describedby={d.dica || d.motivo ? `funil-mover-porque-${c.leadId}-${d.para}` : undefined}
          onClick={() => {
            if (d.permitido) aoEscolher(d);
          }}
          className={`block w-full rounded-sm px-2 py-1.5 text-left text-[12.5px] max-md:min-h-[44px] ${d.permitido ? 'hover:bg-brand/10' : 'cursor-not-allowed text-dim'} ${FOCO}`}
        >
          <span className="block">
            {COMERCIAL_ROTULO_DA_ETAPA[d.para]}
            {d.caminho === 'saida' && <span className="text-dim"> · pede motivo</span>}
          </span>
          {(d.dica || d.motivo) && (
            <span id={`funil-mover-porque-${c.leadId}-${d.para}`} className="mt-0.5 block text-[11px] leading-snug text-dim">
              {d.motivo ?? d.dica}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/**
 * A SAÍDA PELO MOVER (U4): qual saída e o motivo num campo de texto, no mesmo
 * gesto. O motivo não trava: sem ele, a API grava "sem motivo informado" e o
 * cartão ganha o aviso. O tipo do motivo (para o relatório de perdas), a data
 * de volta da geladeira e o parceiro são opcionais.
 */
function FormDaSaida({ c, inicial, aoFechar, aoFeito }: { c: CartaoDoFunil; inicial: ComercialSaida | null; aoFechar: () => void; aoFeito: (mensagem: string, resultado?: ComercialResultadoDoMover) => void }) {
  const { token } = useAuth();
  const opcoes = COMERCIAL_SAIDAS.filter((s) => s !== c.etapa);
  const [saida, setSaida] = useState<ComercialSaida | ''>(inicial && inicial !== c.etapa ? inicial : '');
  const [motivo, setMotivo] = useState('');
  const [tipo, setTipo] = useState<ComercialMotivoDeSaida | ''>('');
  const [volta, setVolta] = useState('');
  const [parceiro, setParceiro] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const id = `funil-saida-${c.leadId}`;

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!saida) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await moverCartao(
        c.leadId,
        {
          para: saida,
          ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
          ...(tipo ? { tipoDeMotivo: tipo } : {}),
          ...(saida === 'geladeira' && volta ? { voltaEm: voltaEmDoDia(volta) } : {}),
          ...(saida === 'parceiro' && parceiro.trim() ? { parceiro: parceiro.trim() } : {}),
        },
        token,
      );
      aoFeito(r.mensagem || `Movido para ${COMERCIAL_ROTULO_DA_ETAPA[saida]}.`, r && typeof r === 'object' && 'para' in r ? r : undefined);
    } catch (er) {
      setErro(er);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form data-testid={id} onSubmit={registrar} className="mt-2 space-y-1.5 rounded border border-border bg-surface-2 p-2 text-[12px]" aria-label={`Mover ${c.empresa ?? c.nome} para uma saída`}>
      <p className="font-os-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">saída</p>
      <label className="block">
        <span className="text-muted">qual saída</span>
        <select value={saida} onChange={(e) => setSaida(e.target.value as ComercialSaida)} className={INPUT} required>
          <option value="">escolha</option>
          {opcoes.map((s) => <option key={s} value={s}>{COMERCIAL_ROTULO_DA_ETAPA[s].replace('Saída · ', '')}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-muted">motivo</span>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className={INPUT}
          maxLength={400}
          data-testid={`${id}-motivo`}
          aria-describedby={`${id}-dica`}
          placeholder="escreva o motivo"
        />
        <span id={`${id}-dica`} className="mt-0.5 block text-[11px] text-dim">Sem motivo escrito, fica &quot;sem motivo informado&quot; e o cartão ganha o aviso.</span>
      </label>
      <label className="block">
        <span className="text-muted">tipo do motivo, para o relatório (opcional)</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as ComercialMotivoDeSaida)} className={INPUT}>
          <option value="">outro</option>
          {COMERCIAL_MOTIVOS_DE_SAIDA.filter((m) => m !== 'outro').map((m) => <option key={m} value={m}>{ROTULO_DO_MOTIVO[m]}</option>)}
        </select>
      </label>
      {saida === 'geladeira' && (
        <label className="block">
          <span className="text-muted">volta em (opcional)</span>
          <input type="date" value={volta} onChange={(e) => setVolta(e.target.value)} className={INPUT} />
        </label>
      )}
      {saida === 'parceiro' && (
        <label className="block">
          <span className="text-muted">para quem (opcional)</span>
          <input value={parceiro} onChange={(e) => setParceiro(e.target.value)} className={INPUT} maxLength={120} />
        </label>
      )}
      <Erro erro={erro} />
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" disabled={!saida || enviando} className={BOTAO_PRIMARIO}>mover para a saída</button>
        <button type="button" onClick={aoFechar} className={BOTAO}>cancelar</button>
      </div>
    </form>
  );
}
