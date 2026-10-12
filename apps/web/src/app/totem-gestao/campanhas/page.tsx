'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TOTEM_ACOES_CAMPANHA,
  TOTEM_BOTAO_PADRAO,
  TOTEM_ROTULO_DA_ACAO,
  TOTEM_TIPOS_BENEFICIO,
  type TotemAcaoCampanha,
  type TotemCampanhaResumo,
  type TotemLojaDoEscopo,
  type TotemTipoBeneficio,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, Chip, inputCls } from '@/app/referencias/ui';
import { EnvioDeImagem } from '@/components/totem/EnvioDeImagem';
import { enderecoDaImagem } from '@/components/totem/imagem';
import { SeletorDeProdutos } from './SeletorDeProdutos';
import {
  ROTULO_DO_TIPO,
  corpoDaCampanha,
  formularioDaCampanha,
  formularioVazio,
  podeMexerNaCampanha,
  situacaoDaCampanha,
  textoDaAcao,
  textoDasLojas,
  textoDoBotao,
  textoDoPeriodo,
  type FormularioDaCampanha,
} from './campanha-na-tela';

/*
 * As campanhas (frente D): os banners da tela inicial do totem. Cada uma tem
 * imagem, chamada e um botão, e o botão abre o cadastro com cupom, abre uma
 * lista de produtos ou não existe, quando a campanha só divulga.
 */

const EXPLICACAO_DA_ACAO: Record<TotemAcaoCampanha, string> = {
  cadastro: 'O botão abre o cadastro com CPF e telefone, e a pessoa ganha o cupom desta campanha.',
  produtos: 'O botão abre a lista de produtos que você escolher, como lançamentos ou ofertas da semana.',
  nenhuma: 'O banner só informa, sem botão. Serve para aviso, horário especial ou novidade da loja.',
};

type Edicao = { modo: 'nova' } | { modo: 'editar'; campanha: TotemCampanhaResumo };

export default function PaginaDasCampanhas() {
  const { token, ready, can } = useAuth();
  const [campanhas, setCampanhas] = useState<TotemCampanhaResumo[] | null>(null);
  const [lojas, setLojas] = useState<TotemLojaDoEscopo[]>([]);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const podeVer = can('totem.campanhas');
  const cuidaDaRede = can('totem.rede');

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<TotemCampanhaResumo[]>('/totem-campanhas', token)
      .then(setCampanhas)
      .catch((e: Error) => setErro(e.message));
  }, [token]);

  useEffect(() => {
    if (!ready || !token || !podeVer) return;
    carregar();
    apiGet<TotemLojaDoEscopo[]>('/totem-campanhas/lojas', token)
      .then(setLojas)
      .catch(() => setLojas([]));
  }, [ready, token, podeVer, carregar]);

  async function acao(pedido: () => Promise<unknown>, sucesso: string) {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await pedido();
      setAviso(sucesso);
      carregar();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function alternar(c: TotemCampanhaResumo) {
    void acao(
      () => apiPatch(`/totem-campanhas/${c.id}`, { ativa: !c.ativa }, token),
      c.ativa ? `A campanha "${c.nome}" foi desativada.` : `A campanha "${c.nome}" foi ativada.`,
    );
  }

  function apagar(c: TotemCampanhaResumo) {
    if (!window.confirm(`Apagar a campanha "${c.nome}"? Não dá para desfazer.`)) return;
    void acao(() => apiDelete(`/totem-campanhas/${c.id}`, token), `A campanha "${c.nome}" foi apagada.`);
  }

  async function salvar(corpo: unknown) {
    if (!edicao) return false;
    const ok =
      edicao.modo === 'nova'
        ? await acao(() => apiPost('/totem-campanhas', corpo, token), 'Campanha criada.')
        : await acao(() => apiPatch(`/totem-campanhas/${edicao.campanha.id}`, corpo, token), 'Campanha salva.');
    if (ok) setEdicao(null);
    return ok;
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Campanhas</h1>
          <p className="max-w-2xl text-sm text-muted">
            Cada campanha é um banner na tela inicial do totem, com imagem, chamada e um botão. Os banners passam na
            ordem que você definir. Na campanha de cadastro, cada pessoa recebe um cupom por campanha; quando há mais de
            uma no ar na mesma loja, o cadastro e o QR da etiqueta usam a que começou por último.
          </p>
        </div>
        {ready && podeVer && !edicao && (
          <Botao tone="brand" onClick={() => setEdicao({ modo: 'nova' })}>
            Nova campanha
          </Botao>
        )}
      </div>

      {!ready && <p className="text-sm text-muted">Carregando…</p>}
      {ready && !podeVer && <p className="text-sm text-muted">O seu acesso não inclui as campanhas.</p>}

      {erro && (
        <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {erro}
        </div>
      )}
      {aviso && (
        <div role="status" className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {aviso}
        </div>
      )}

      {ready && podeVer && edicao && (
        <FormularioDeCampanha
          key={edicao.modo === 'nova' ? 'nova' : edicao.campanha.id}
          inicial={edicao.modo === 'nova' ? formularioVazio() : formularioDaCampanha(edicao.campanha)}
          editando={edicao.modo === 'editar'}
          beneficioTravado={edicao.modo === 'editar' && edicao.campanha.cupons.emitidos > 0}
          lojas={lojas}
          cuidaDaRede={cuidaDaRede}
          token={token}
          ocupado={ocupado}
          aoSalvar={salvar}
          aoCancelar={() => setEdicao(null)}
        />
      )}

      {ready && podeVer && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Campanha</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 font-medium">O que faz</th>
                  <th className="px-4 py-3 font-medium">Período e lojas</th>
                  <th className="px-4 py-3 font-medium">Cupons</th>
                  <th className="px-4 py-3 font-medium" aria-label="Ações" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campanhas?.map((c) => {
                  const situacao = situacaoDaCampanha(c);
                  const mexe = podeMexerNaCampanha(c.lojaIds, lojas, cuidaDaRede);
                  const faz = textoDaAcao(c);
                  return (
                    <tr key={c.id} className="align-top hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <span className="flex aspect-video w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-[10px] text-muted">
                            {c.imagemUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- a imagem vem da API, fora do otimizador do Next
                              <img src={enderecoDaImagem(c.imagemUrl)} alt="" className="h-full w-full object-cover" />
                            ) : (
                              'sem imagem'
                            )}
                          </span>
                          <div>
                            <p className="font-medium">{c.nome}</p>
                            <p className="text-xs text-muted">{c.chamada}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Chip tone={situacao.tom}>{situacao.rotulo}</Chip>
                      </td>
                      <td className="px-4 py-3">
                        {faz.principal}
                        {faz.detalhe && <div className="text-xs text-muted">{faz.detalhe}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {textoDoPeriodo(c)}
                        <div className="text-xs text-muted">{textoDasLojas(c.lojaIds, lojas)}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.cupons.emitidos.toLocaleString('pt-BR')} emitido(s)
                        <div className="text-xs text-muted">{c.cupons.usados.toLocaleString('pt-BR')} usado(s)</div>
                      </td>
                      <td className="px-4 py-3">
                        {mexe && (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Botao onClick={() => setEdicao({ modo: 'editar', campanha: c })} disabled={ocupado}>
                              Editar
                            </Botao>
                            <Botao onClick={() => alternar(c)} disabled={ocupado}>
                              {c.ativa ? 'Desativar' : 'Ativar'}
                            </Botao>
                            {c.cupons.emitidos === 0 && (
                              <Botao tone="bad" onClick={() => apagar(c)} disabled={ocupado}>
                                Apagar
                              </Botao>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {campanhas && campanhas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted">
                      Nenhuma campanha criada. Sem campanha de cadastro no ar, o cadastro é gravado, mas o cliente não
                      recebe cupom.
                    </td>
                  </tr>
                )}
                {!campanhas && !erro && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted">
                      Carregando…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function FormularioDeCampanha({
  inicial,
  editando,
  beneficioTravado,
  lojas,
  cuidaDaRede,
  token,
  ocupado,
  aoSalvar,
  aoCancelar,
}: {
  inicial: FormularioDaCampanha;
  editando: boolean;
  beneficioTravado: boolean;
  lojas: TotemLojaDoEscopo[];
  cuidaDaRede: boolean;
  token: string | null;
  ocupado: boolean;
  aoSalvar: (corpo: unknown) => Promise<boolean>;
  aoCancelar: () => void;
}) {
  const [f, setF] = useState<FormularioDaCampanha>(inicial);
  const [problema, setProblema] = useState<string | null>(null);

  function mudar<K extends keyof FormularioDaCampanha>(campo: K, valor: FormularioDaCampanha[K]) {
    setF((atual) => ({ ...atual, [campo]: valor }));
    setProblema(null);
  }

  function marcarLoja(id: string, marcada: boolean) {
    mudar('lojaIds', marcada ? [...f.lojaIds, id] : f.lojaIds.filter((x) => x !== id));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const r = corpoDaCampanha(f, cuidaDaRede);
    if ('problema' in r) {
      setProblema(r.problema);
      return;
    }
    await aoSalvar(r.corpo);
  }

  const brinde = f.tipoBeneficio === 'brinde';
  const padraoDoBotao = TOTEM_BOTAO_PADRAO[f.acao];

  return (
    <Card titulo={editando ? 'Editar campanha' : 'Nova campanha'}>
      <form onSubmit={enviar} className="space-y-6">
        <fieldset className="space-y-2" disabled={beneficioTravado}>
          <legend className="mb-1 text-xs text-muted">O que o botão do banner faz</legend>
          {beneficioTravado && (
            <p className="text-xs text-muted">
              Esta campanha já emitiu cupons, então continua sendo de cadastro e o cupom não muda mais. Para outro
              benefício ou outro tipo de banner, crie outra campanha.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            {TOTEM_ACOES_CAMPANHA.map((a) => (
              <label
                key={a}
                className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm ${
                  f.acao === a ? 'border-brand bg-brand/10' : 'border-border hover:border-brand-dim'
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name="acao" checked={f.acao === a} onChange={() => mudar('acao', a)} />
                  {TOTEM_ROTULO_DA_ACAO[a]}
                </span>
                <span className="text-xs text-muted">{EXPLICACAO_DA_ACAO[a]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,26rem)]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Campo label="Nome" hint="Aparece só no painel.">
                <input
                  className={inputCls}
                  value={f.nome}
                  maxLength={80}
                  onChange={(e) => mudar('nome', e.target.value)}
                />
              </Campo>
              <Campo label="Ordem no totem" hint="O menor número passa primeiro. Em branco, entra no fim.">
                <input
                  className={inputCls}
                  value={f.ordem}
                  inputMode="numeric"
                  placeholder="0"
                  onChange={(e) => mudar('ordem', e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
              </Campo>
            </div>
            <Campo label="Chamada" hint="O título do banner, com até 140 letras.">
              <input
                className={inputCls}
                value={f.chamada}
                maxLength={140}
                onChange={(e) => mudar('chamada', e.target.value)}
              />
            </Campo>
            <Campo label="Texto de apoio (opcional)" hint="Uma ou duas linhas abaixo da chamada, com até 240 letras.">
              <textarea
                className={`${inputCls} min-h-[4.5rem]`}
                value={f.textoApoio}
                maxLength={240}
                onChange={(e) => mudar('textoApoio', e.target.value)}
              />
            </Campo>
            <Campo
              label="Texto do botão"
              hint={
                padraoDoBotao
                  ? `Em branco, o botão diz "${padraoDoBotao}".`
                  : 'Esta campanha não tem botão; o texto, se houver, aparece como selo.'
              }
            >
              <input
                className={inputCls}
                value={f.textoBotao}
                maxLength={30}
                placeholder={padraoDoBotao ?? 'Sem botão'}
                onChange={(e) => mudar('textoBotao', e.target.value)}
              />
            </Campo>
            <EnvioDeImagem
              rotulo="Imagem do banner"
              dica="Formato largo, como 1600 × 900. Fotos maiores são reduzidas antes do envio."
              valor={f.imagemUrl}
              aoMudar={(url) => mudar('imagemUrl', url)}
              destino="campanha"
              token={token}
              formato="largo"
            />
          </div>

          <div className="space-y-2">
            <span className="block text-xs text-muted">Como fica no totem</span>
            <PreviaDoBanner f={f} />
          </div>
        </div>

        {f.acao === 'produtos' && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs text-muted">Produtos que o botão mostra</legend>
            <SeletorDeProdutos escolhidos={f.produtos} aoMudar={(p) => mudar('produtos', p)} token={token} />
          </fieldset>
        )}

        {f.acao === 'cadastro' && (
          <fieldset className="space-y-3" disabled={beneficioTravado}>
            <legend className="mb-1 text-xs text-muted">O cupom do cadastro</legend>
            <div className="grid gap-4 md:grid-cols-3">
              <Campo label="Tipo de benefício">
                <select
                  className={inputCls}
                  value={f.tipoBeneficio}
                  onChange={(e) => mudar('tipoBeneficio', e.target.value as TotemTipoBeneficio)}
                >
                  {TOTEM_TIPOS_BENEFICIO.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_DO_TIPO[t]}
                    </option>
                  ))}
                </select>
              </Campo>
              {!brinde && (
                <Campo label={f.tipoBeneficio === 'percentual' ? 'Desconto (%)' : 'Desconto (R$)'}>
                  <input
                    className={inputCls}
                    value={f.valor}
                    inputMode="decimal"
                    placeholder={f.tipoBeneficio === 'percentual' ? '10' : '15,00'}
                    onChange={(e) => mudar('valor', e.target.value)}
                  />
                </Campo>
              )}
              <Campo
                label={brinde ? 'Qual é o brinde' : 'Detalhe do benefício (opcional)'}
                hint={brinde ? undefined : 'Por exemplo: vale para compras acima de R$ 50,00.'}
              >
                <input
                  className={inputCls}
                  value={f.descricao}
                  maxLength={200}
                  onChange={(e) => mudar('descricao', e.target.value)}
                />
              </Campo>
              <Campo label="O cupom vale por (dias)" hint="Conta do dia do cadastro até o fim do último dia.">
                <input
                  className={inputCls}
                  value={f.validadeDias}
                  inputMode="numeric"
                  onChange={(e) => mudar('validadeDias', e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
              </Campo>
            </div>
          </fieldset>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Campo label="Começa em" hint={editando ? undefined : 'Em branco, a campanha começa agora.'}>
            <input className={inputCls} type="date" value={f.inicio} onChange={(e) => mudar('inicio', e.target.value)} />
          </Campo>
          <Campo label="Termina em" hint="Em branco, a campanha fica no ar até ser desativada.">
            <input className={inputCls} type="date" value={f.fim} onChange={(e) => mudar('fim', e.target.value)} />
          </Campo>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs text-muted">Lojas onde a campanha vale</legend>
          {lojas.length === 0 && <p className="text-sm text-muted">Nenhuma loja liberada para o seu acesso.</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {lojas.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.lojaIds.includes(l.id)}
                  onChange={(e) => marcarLoja(l.id, e.target.checked)}
                />
                {l.nome}
                {!l.ativa && <span className="text-xs text-muted">(inativa)</span>}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted">
            {cuidaDaRede
              ? 'Sem nenhuma loja marcada, a campanha vale em todas, inclusive nas que forem abertas depois.'
              : 'Marque pelo menos uma loja.'}
          </p>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativa} onChange={(e) => mudar('ativa', e.target.checked)} />
          Campanha ativa
        </label>

        {problema && (
          <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {problema}
          </div>
        )}

        <div className="flex gap-2">
          <Botao type="submit" tone="brand" disabled={ocupado}>
            {editando ? 'Salvar campanha' : 'Criar campanha'}
          </Botao>
          <Botao tone="ghost" onClick={aoCancelar} disabled={ocupado}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Card>
  );
}

/**
 * Uma aproximação do banner no totem, para quem monta a campanha ver o texto
 * sobre a imagem antes de salvar. O desenho final é o do quiosque.
 */
function PreviaDoBanner({ f }: { f: FormularioDaCampanha }) {
  const botao = textoDoBotao(f);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#3d2a1e] text-white shadow-sm">
      {f.imagemUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a imagem vem da API, fora do otimizador do Next
        <img src={enderecoDaImagem(f.imagemUrl)} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 p-4">
        <p className="text-base font-semibold leading-tight">{f.chamada.trim() || 'A chamada aparece aqui'}</p>
        {f.textoApoio.trim() && <p className="line-clamp-2 text-xs text-white/85">{f.textoApoio.trim()}</p>}
        {botao && f.acao !== 'nenhuma' && (
          <span className="mt-1 inline-block rounded-full bg-[#f2b705] px-3.5 py-1.5 text-xs font-semibold text-[#3d2a1e]">
            {botao}
          </span>
        )}
        {botao && f.acao === 'nenhuma' && (
          <span className="mt-1 inline-block rounded-full border border-white/60 px-3 py-1 text-[11px]">{botao}</span>
        )}
      </div>
    </div>
  );
}
