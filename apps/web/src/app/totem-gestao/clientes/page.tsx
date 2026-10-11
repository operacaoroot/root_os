'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TOTEM_MENSAGEM_CPF_INVALIDO,
  TOTEM_MESES_ATE_ANONIMIZAR,
  TOTEM_ROTULO_DO_STATUS_CUPOM,
  totemCpfValido,
  type TotemAnonimizacaoEmLote,
  type TotemClienteDetalhe,
  type TotemClientePagina,
  type TotemLojaDoEscopo,
  type TotemRevogar,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, inputCls } from '@/app/referencias/ui';
import { formatarCpfDigitando } from '@/components/totem/CadastroCupom';
import { TOM_DO_STATUS, codigoNaTela, dataBR, dataHoraBR } from '../cupons/cupom-na-tela';
import { rotuloDoCanal, textoDasFinalidades, totalDePaginas, trocarLinha } from './cliente-na-tela';

/*
 * Os clientes do totem (frente D): a lista paginada, a busca por CPF e a ficha
 * com consentimentos e cupons. É aqui que o encarregado atende o pedido de quem
 * quer sair das campanhas ou ter os dados apagados, como a política promete.
 */

const POR_PAGINA = 25;

export default function PaginaDosClientes() {
  const { token, ready, can } = useAuth();
  const [lojas, setLojas] = useState<TotemLojaDoEscopo[]>([]);
  const [lojaId, setLojaId] = useState('');
  const [pagina, setPagina] = useState(1);
  const [lista, setLista] = useState<TotemClientePagina | null>(null);
  const [cpf, setCpf] = useState('');
  const [ficha, setFicha] = useState<TotemClienteDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const podeVer = can('totem.clientes');
  const podeAnonimizarEmLote = can('totem.rede');

  const carregarLista = useCallback(() => {
    if (!token) return;
    const qs = new URLSearchParams({ pagina: String(pagina), porPagina: String(POR_PAGINA) });
    if (lojaId) qs.set('lojaId', lojaId);
    apiGet<TotemClientePagina>(`/totem-campanhas/clientes?${qs.toString()}`, token)
      .then(setLista)
      .catch((e: Error) => setErro(e.message));
  }, [token, pagina, lojaId]);

  useEffect(() => {
    if (!ready || !token || !podeVer) return;
    apiGet<TotemLojaDoEscopo[]>('/totem-campanhas/lojas', token)
      .then(setLojas)
      .catch(() => setLojas([]));
  }, [ready, token, podeVer]);

  useEffect(() => {
    if (!ready || !podeVer) return;
    carregarLista();
  }, [ready, podeVer, carregarLista]);

  function trocarLoja(id: string) {
    setLojaId(id);
    setPagina(1);
  }

  async function pedir(pedido: () => Promise<TotemClienteDetalhe>, sucesso: string | null) {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const nova = await pedido();
      setFicha(nova);
      setLista((l) => (l ? { ...l, itens: trocarLinha(l.itens, nova) } : l));
      setAviso(sucesso);
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function localizar(e: React.FormEvent) {
    e.preventDefault();
    if (!totemCpfValido(cpf)) {
      setErro(TOTEM_MENSAGEM_CPF_INVALIDO);
      return;
    }
    const achou = await pedir(
      () => apiPost<TotemClienteDetalhe>('/totem-campanhas/clientes/localizar', { cpf }, token),
      null,
    );
    if (achou) setCpf('');
  }

  function abrir(id: string) {
    void pedir(() => apiGet<TotemClienteDetalhe>(`/totem-campanhas/clientes/${id}`, token), null);
  }

  function revogar(alcance: TotemRevogar['alcance']) {
    if (!ficha) return;
    const pergunta =
      alcance === 'campanhas'
        ? 'Tirar este cliente das campanhas? Ele deixa de receber ofertas, e os cupons que já tem continuam valendo.'
        : 'Apagar os dados pessoais deste cliente? O CPF, o celular e o nome somem do cadastro e o consentimento fica revogado. Os cupons continuam no histórico, sem identificar a pessoa. Não dá para desfazer.';
    if (!window.confirm(pergunta)) return;
    const corpo: TotemRevogar = { alcance };
    void pedir(
      () => apiPost<TotemClienteDetalhe>(`/totem-campanhas/clientes/${ficha.id}/revogar`, corpo, token),
      alcance === 'campanhas'
        ? 'O cliente saiu das campanhas.'
        : 'Os dados pessoais do cliente foram apagados e o consentimento foi revogado.',
    );
  }

  async function anonimizarInativos() {
    const ok = window.confirm(
      `Apagar os dados pessoais de todos os cadastros sem uso há ${TOTEM_MESES_ATE_ANONIMIZAR} meses? Não dá para desfazer.`,
    );
    if (!ok) return;
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await apiPost<TotemAnonimizacaoEmLote>('/totem-campanhas/clientes/anonimizar-inativos', {}, token);
      setAviso(
        r.anonimizados === 0
          ? `Nenhum cadastro estava sem uso desde ${dataBR(r.limite)}.`
          : `${r.anonimizados.toLocaleString('pt-BR')} cadastro(s) sem uso desde ${dataBR(r.limite)} tiveram os dados pessoais apagados.`,
      );
      setFicha(null);
      carregarLista();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const paginas = lista ? totalDePaginas(lista.total, lista.porPagina) : 1;

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Clientes</h1>
        <p className="text-sm text-muted">
          Quem se cadastrou no totem ou pelo QR das etiquetas. O CPF aparece só em parte; para achar uma pessoa,
          digite o CPF completo na busca.
        </p>
      </div>

      {!ready && <p className="text-sm text-muted">Carregando…</p>}
      {ready && !podeVer && <p className="text-sm text-muted">O seu acesso não inclui a lista de clientes.</p>}

      {ready && podeVer && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card titulo="Buscar por CPF">
              <form onSubmit={localizar} className="flex gap-2">
                <input
                  aria-label="CPF do cliente"
                  value={cpf}
                  onChange={(e) => setCpf(formatarCpfDigitando(e.target.value))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  className={inputCls}
                />
                <Botao type="submit" tone="brand" disabled={ocupado}>
                  Buscar
                </Botao>
              </form>
            </Card>
            <Card titulo="Loja do cadastro">
              <select
                aria-label="Filtrar por loja"
                className={inputCls}
                value={lojaId}
                onChange={(e) => trocarLoja(e.target.value)}
              >
                <option value="">Todas as lojas</option>
                {lojas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                    {l.ativa ? '' : ' (inativa)'}
                  </option>
                ))}
              </select>
            </Card>
          </div>

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

          {ficha && (
            <FichaDoCliente
              ficha={ficha}
              ocupado={ocupado}
              aoFechar={() => setFicha(null)}
              aoTirarDasCampanhas={() => revogar('campanhas')}
              aoApagarDados={() => revogar('tudo')}
            />
          )}

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">CPF</th>
                    <th className="px-4 py-3 font-medium">Celular</th>
                    <th className="px-4 py-3 font-medium">Loja e canal</th>
                    <th className="px-4 py-3 font-medium">Campanhas</th>
                    <th className="px-4 py-3 font-medium">Cupons</th>
                    <th className="px-4 py-3 font-medium">Cadastro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lista?.itens.map((c) => (
                    <tr key={c.id} className={ficha?.id === c.id ? 'bg-surface-2' : 'hover:bg-surface-2'}>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => abrir(c.id)}
                          className="font-os-mono font-medium hover:text-brand"
                        >
                          {c.cpfMascarado}
                        </button>
                        {c.anonimizado && (
                          <div className="mt-1">
                            <Chip>Dados apagados</Chip>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">{c.telefoneMascarado ?? '—'}</td>
                      <td className="px-4 py-3">
                        {c.lojaOrigem?.nome ?? '—'}
                        <div className="text-xs text-muted">{rotuloDoCanal(c.canalOrigem)}</div>
                      </td>
                      <td className="px-4 py-3">
                        {c.aceitaCampanhas ? <Chip tone="good">Aceita</Chip> : <Chip>Não aceita</Chip>}
                      </td>
                      <td className="px-4 py-3">{c.totalDeCupons}</td>
                      <td className="px-4 py-3 text-muted">{dataBR(c.criadoEm)}</td>
                    </tr>
                  ))}
                  {lista && lista.itens.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted">
                        {lojaId ? 'Nenhum cliente se cadastrou nesta loja ainda.' : 'Nenhum cliente se cadastrou ainda.'}
                      </td>
                    </tr>
                  )}
                  {!lista && !erro && (
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

          {lista && lista.total > 0 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">
                Página {lista.pagina} de {paginas} · {lista.total.toLocaleString('pt-BR')} cliente(s)
              </span>
              <div className="flex gap-2">
                <Botao onClick={() => setPagina((p) => p - 1)} disabled={pagina <= 1}>
                  Anterior
                </Botao>
                <Botao onClick={() => setPagina((p) => p + 1)} disabled={pagina >= paginas}>
                  Próxima
                </Botao>
              </div>
            </div>
          )}

          {podeAnonimizarEmLote && (
            <Card titulo="Prazo de guarda">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-sm text-muted">
                  A política de privacidade promete apagar os dados de quem passa {TOTEM_MESES_ATE_ANONIMIZAR} meses sem
                  usar o cadastro. Este botão faz isso agora, de uma vez, em todas as lojas.
                </p>
                <Botao tone="bad" onClick={anonimizarInativos} disabled={ocupado}>
                  Apagar cadastros sem uso
                </Botao>
              </div>
            </Card>
          )}
        </>
      )}
    </section>
  );
}

function FichaDoCliente({
  ficha,
  ocupado,
  aoFechar,
  aoTirarDasCampanhas,
  aoApagarDados,
}: {
  ficha: TotemClienteDetalhe;
  ocupado: boolean;
  aoFechar: () => void;
  aoTirarDasCampanhas: () => void;
  aoApagarDados: () => void;
}) {
  return (
    <Card
      titulo="Ficha do cliente"
      acao={
        <Botao tone="ghost" onClick={aoFechar}>
          Fechar
        </Botao>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-muted">CPF</dt>
            <dd className="font-os-mono">{ficha.cpfMascarado}</dd>
          </div>
          <div>
            <dt className="text-muted">Nome</dt>
            <dd>{ficha.nome ?? 'Não informado'}</dd>
          </div>
          <div>
            <dt className="text-muted">Celular</dt>
            <dd>{ficha.telefoneMascarado ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Cadastro</dt>
            <dd>
              {dataBR(ficha.criadoEm)}, {rotuloDoCanal(ficha.canalOrigem)}
              {ficha.lojaOrigem && `, ${ficha.lojaOrigem.nome}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Campanhas e ofertas</dt>
            <dd>{ficha.aceitaCampanhas ? 'Aceita receber' : 'Não recebe'}</dd>
          </div>
          {ficha.anonimizadoEm && (
            <div>
              <dt className="text-muted">Dados pessoais apagados em</dt>
              <dd>{dataHoraBR(ficha.anonimizadoEm)}</dd>
            </div>
          )}
        </dl>

        {!ficha.anonimizado && (
          <div className="flex flex-wrap gap-2">
            {ficha.aceitaCampanhas && (
              <Botao onClick={aoTirarDasCampanhas} disabled={ocupado}>
                Tirar das campanhas
              </Botao>
            )}
            <Botao tone="bad" onClick={aoApagarDados} disabled={ocupado}>
              Apagar os dados pessoais
            </Botao>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Consentimentos</h3>
          {ficha.consentimentos.length === 0 ? (
            <p className="text-sm text-muted">Nenhum consentimento registrado.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {ficha.consentimentos.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                  <div>
                    <p>
                      {textoDasFinalidades(c.finalidades)}, política versão {c.politicaVersao}
                    </p>
                    <p className="text-xs text-muted">
                      Aceito em {dataHoraBR(c.aceitoEm)}, {rotuloDoCanal(c.canal)}
                      {c.loja && `, ${c.loja.nome}`}
                      {c.revogadoEm && `. Revogado em ${dataHoraBR(c.revogadoEm)}`}
                    </p>
                  </div>
                  {c.revogadoEm ? <Chip>Revogado</Chip> : <Chip tone="good">Em vigor</Chip>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Cupons</h3>
          {ficha.cupons.length === 0 ? (
            <p className="text-sm text-muted">Nenhum cupom emitido para este cliente.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {ficha.cupons.map((x) => (
                <li key={x.codigo} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                  <div>
                    <p>
                      <span className="font-os-mono">{codigoNaTela(x.codigo)}</span> · {x.beneficio}
                    </p>
                    <p className="text-xs text-muted">
                      {x.campanha}. Emitido em {dataBR(x.emitidoEm)}, vale até {dataBR(x.validoAte)}
                      {x.usadoEm && `. Usado em ${dataHoraBR(x.usadoEm)}`}
                      {x.usadoLoja && `, na loja ${x.usadoLoja.nome}`}
                    </p>
                  </div>
                  <Chip tone={TOM_DO_STATUS[x.status]}>{TOTEM_ROTULO_DO_STATUS_CUPOM[x.status]}</Chip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
