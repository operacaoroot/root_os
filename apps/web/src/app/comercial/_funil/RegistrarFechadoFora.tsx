'use client';

import { useId, useState } from 'react';
import {
  ClienteFechadoForaSchema,
  PRODUTOS_COM_PRECO,
  condicoesDaTabela,
  type ClienteFechadoForaResposta,
  type ComercialFormaDePagamento,
  type ComercialProduto,
} from '@mktos/shared';

import { API_BASE, erroDaResposta } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DO_PRODUTO } from '@/lib/cockpit';

import { Aviso, BOTAO, BOTAO_PRIMARIO, ErroDaAcao, INPUT, ROTULO } from '../_ui';
import { LinkDoLead } from '../_painel/provedor';

/*
 * "REGISTRAR CLIENTE JÁ FECHADO" (rodada do trabalho T1b, 19/10/2026).
 *
 * A única porta para quem fechou fora do sistema. A pessoa digita os dados do
 * aceite que estão no contrato e anexa o PDF assinado; o servidor cria o lead,
 * grava o que ela declarou (com a procedência escrita) e PROPÕE o fechamento à
 * porta, que espera outra pessoa com alçada titular em /atendimento. Ninguém
 * assina o próprio registro. Cobrança nova no Asaas só marcando; sem marcar, o
 * motivo é obrigatório. Nada sai para a ZapSign: o contrato já veio assinado.
 */

const FORMAS: { valor: ComercialFormaDePagamento; rotulo: string }[] = [
  { valor: 'boleto', rotulo: 'boleto' },
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'cartao', rotulo: 'cartão' },
];

/** "11.997,00" ou "11997" em centavos; o que não é número vira nulo. */
export function centavosDoTexto(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/i, '');
  if (!t) return null;
  // "2.970" é milhar no Brasil; "2970.5" é decimal.
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Math.round(Number(normal) * 100);
}

function reaisDoCentavo(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** O envio: multipart com o PDF em `file` e os dados em `dados`. */
export async function enviarRegistro(dados: unknown, arquivo: File, token: string | null | undefined): Promise<ClienteFechadoForaResposta> {
  const form = new FormData();
  form.append('file', arquivo);
  form.append('dados', JSON.stringify(dados));
  const res = await fetch(`${API_BASE}/comercial/clientes-fechados-fora`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw erroDaResposta((await res.json().catch(() => ({}))) as Record<string, unknown>, res.status);
  return res.json() as Promise<ClienteFechadoForaResposta>;
}

export function RegistrarFechadoFora({ aoFechar, aoRegistrar }: { aoFechar: () => void; aoRegistrar: (r: ClienteFechadoForaResposta) => void }) {
  const { token } = useAuth();
  const id = useId();
  const tabela = condicoesDaTabela('operacao');
  const [campos, setCampos] = useState({
    razaoSocial: '',
    cnpj: '',
    quemAssina: '',
    email: '',
    telefone: '',
    endereco: '',
    produto: 'operacao' as ComercialProduto,
    valor: tabela ? reaisDoCentavo(tabela.valorCentavos) : '',
    parcelas: String(tabela?.parcelas ?? 1),
    forma: 'boleto' as ComercialFormaDePagamento,
    assinadoEm: '',
    primeiroVencimento: '',
    criarCobranca: false,
    motivoSemCobranca: '',
  });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erros, setErros] = useState<string[]>([]);
  const [erroDoEnvio, setErroDoEnvio] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<ClienteFechadoForaResposta | null>(null);

  const mudar = <K extends keyof typeof campos>(k: K, v: (typeof campos)[K]) => setCampos((c) => ({ ...c, [k]: v }));

  function trocarProduto(p: ComercialProduto) {
    const t = condicoesDaTabela(p);
    setCampos((c) => ({ ...c, produto: p, ...(t ? { valor: reaisDoCentavo(t.valorCentavos), parcelas: String(t.parcelas) } : {}) }));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErroDoEnvio(null);
    const dados = {
      razaoSocial: campos.razaoSocial,
      cnpj: campos.cnpj,
      quemAssina: campos.quemAssina,
      email: campos.email,
      telefone: campos.telefone,
      ...(campos.endereco.trim() ? { endereco: campos.endereco } : {}),
      produto: campos.produto,
      valorCentavos: centavosDoTexto(campos.valor) ?? -1,
      parcelas: Number(campos.parcelas),
      forma: campos.forma,
      assinadoEm: campos.assinadoEm,
      primeiroVencimento: campos.primeiroVencimento,
      criarCobranca: campos.criarCobranca,
      ...(!campos.criarCobranca && campos.motivoSemCobranca.trim() ? { motivoSemCobranca: campos.motivoSemCobranca } : {}),
    };
    const r = ClienteFechadoForaSchema.safeParse(dados);
    const lista = r.success ? [] : r.error.issues.map((i) => `${ROTULO_DO_CAMPO[String(i.path[0])] ?? String(i.path[0])}: ${i.message}`);
    if (!arquivo) lista.push('contrato assinado: anexe o PDF');
    else if (arquivo.type && arquivo.type !== 'application/pdf') lista.push('contrato assinado: o arquivo precisa ser PDF');
    setErros(lista);
    if (lista.length || !r.success || !arquivo) return;
    setEnviando(true);
    try {
      const resposta = await enviarRegistro(r.data, arquivo, token);
      setFeito(resposta);
      aoRegistrar(resposta);
    } catch (erro) {
      setErroDoEnvio(erro);
    } finally {
      setEnviando(false);
    }
  }

  const rotulo = (campo: string, texto: string, opcional = false) => (
    <label htmlFor={`${id}-${campo}`} className="block text-[12px] text-muted">
      {texto}
      {opcional && <span className="text-dim"> (opcional)</span>}
    </label>
  );

  return (
    <section aria-labelledby={`${id}-titulo`} data-testid="registrar-fechado-fora" className="max-h-[70dvh] overflow-y-auto rounded border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id={`${id}-titulo`} className="text-[15px] font-semibold text-text">Registrar cliente já fechado</h2>
          <p className="max-w-3xl text-[12.5px] text-muted">
            Para quem assinou fora do sistema. Digite o que está no contrato e anexe o PDF assinado. O registro fica no fio como declarado por você, e o fechamento vai à assinatura de outra pessoa com alçada titular em /atendimento. Você não assina o próprio registro.
          </p>
        </div>
        <button type="button" className={BOTAO} onClick={aoFechar}>
          fechar
        </button>
      </div>

      {feito ? (
        <div className="mt-3 space-y-2" data-testid="registrar-fechado-fora-feito">
          <Aviso tom="bom">
            {feito.registroNovo ? 'Registrado.' : 'Este registro já existia: nada foi gravado de novo.'}{' '}
            {feito.fechamento.estado === 'na_fila' && 'O fechamento espera a assinatura de outra pessoa com alçada titular em /atendimento.'}
            {feito.fechamento.estado === 'concluido' && 'O fechamento já está concluído.'}
            {feito.fechamento.pulado && `O fechamento não foi pedido: ${feito.fechamento.pulado}.`}
          </Aviso>
          <p className="text-[12.5px] text-muted">
            Contrato anexado: {feito.anexo.nome}. Chave do fechamento: <span className="font-os-mono">{feito.chave}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <LinkDoLead leadId={feito.leadId} aba="dinheiro" className={BOTAO_PRIMARIO}>
              abrir o lead
            </LinkDoLead>
            <a href="/atendimento" className={BOTAO}>ver em /atendimento</a>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={(e) => void enviar(e)} className="mt-3 grid gap-3 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className={ROTULO}>quem contratou</legend>
            {rotulo('razaoSocial', 'Razão social')}
            <input id={`${id}-razaoSocial`} className={INPUT} value={campos.razaoSocial} onChange={(e) => mudar('razaoSocial', e.target.value)} autoComplete="organization" />
            {rotulo('cnpj', 'CNPJ ou CPF')}
            <input id={`${id}-cnpj`} className={INPUT} value={campos.cnpj} onChange={(e) => mudar('cnpj', e.target.value)} inputMode="numeric" />
            {rotulo('quemAssina', 'Quem assina')}
            <input id={`${id}-quemAssina`} className={INPUT} value={campos.quemAssina} onChange={(e) => mudar('quemAssina', e.target.value)} />
            {rotulo('email', 'E-mail de quem assina')}
            <input id={`${id}-email`} type="email" className={INPUT} value={campos.email} onChange={(e) => mudar('email', e.target.value)} />
            {rotulo('telefone', 'WhatsApp do contato')}
            <input id={`${id}-telefone`} type="tel" className={INPUT} value={campos.telefone} onChange={(e) => mudar('telefone', e.target.value)} />
            {rotulo('endereco', 'Endereço', true)}
            <input id={`${id}-endereco`} className={INPUT} value={campos.endereco} onChange={(e) => mudar('endereco', e.target.value)} placeholder="vazio fica [a decidir]" />
          </fieldset>

          <fieldset className="space-y-2">
            <legend className={ROTULO}>o que foi contratado</legend>
            {rotulo('produto', 'Produto (tabela de 04/10)')}
            <select id={`${id}-produto`} className={INPUT} value={campos.produto} onChange={(e) => trocarProduto(e.target.value as ComercialProduto)}>
              {PRODUTOS_COM_PRECO.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_DO_PRODUTO[p]}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                {rotulo('valor', 'Valor total (R$)')}
                <input id={`${id}-valor`} className={INPUT} value={campos.valor} onChange={(e) => mudar('valor', e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1">
                {rotulo('parcelas', 'Parcelas')}
                <input id={`${id}-parcelas`} type="number" min={1} max={60} className={INPUT} value={campos.parcelas} onChange={(e) => mudar('parcelas', e.target.value)} />
              </div>
            </div>
            {rotulo('forma', 'Forma de pagamento')}
            <select id={`${id}-forma`} className={INPUT} value={campos.forma} onChange={(e) => mudar('forma', e.target.value as ComercialFormaDePagamento)}>
              {FORMAS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.rotulo}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                {rotulo('assinadoEm', 'Assinado em')}
                <input id={`${id}-assinadoEm`} type="date" className={INPUT} value={campos.assinadoEm} onChange={(e) => mudar('assinadoEm', e.target.value)} />
              </div>
              <div className="space-y-1">
                {rotulo('primeiroVencimento', '1º vencimento')}
                <input id={`${id}-primeiroVencimento`} type="date" className={INPUT} value={campos.primeiroVencimento} onChange={(e) => mudar('primeiroVencimento', e.target.value)} />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-2 md:col-span-2">
            <legend className={ROTULO}>contrato e cobrança</legend>
            {rotulo('arquivo', 'Contrato assinado (PDF, até 10 MB)')}
            <input
              id={`${id}-arquivo`}
              type="file"
              accept="application/pdf"
              className="block text-[12.5px] text-muted"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
            <label className="flex items-start gap-2 text-[12.5px] text-text">
              <input type="checkbox" className="mt-0.5" checked={campos.criarCobranca} onChange={(e) => mudar('criarCobranca', e.target.checked)} />
              <span>
                Criar cobrança nova no Asaas
                <span className="block text-muted">Desmarcado é o padrão: nenhuma cobrança nova é criada. Marque só se o Asaas deve cobrar as parcelas, com a 1ª vencendo hoje, como no funil.</span>
              </span>
            </label>
            {!campos.criarCobranca && (
              <>
                {rotulo('motivoSemCobranca', 'Por que não criar cobrança')}
                <input
                  id={`${id}-motivoSemCobranca`}
                  className={INPUT}
                  value={campos.motivoSemCobranca}
                  onChange={(e) => mudar('motivoSemCobranca', e.target.value)}
                  placeholder="ex.: o cliente já paga por boleto do banco"
                />
              </>
            )}
          </fieldset>

          {erros.length > 0 && (
            <div role="alert" className="rounded border border-warn/50 bg-warn/10 px-3 py-2 text-[12.5px] text-warn md:col-span-2">
              <p>Falta conferir:</p>
              <ul className="list-disc pl-5">
                {erros.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {erroDoEnvio != null && (
            <div className="md:col-span-2">
              <ErroDaAcao erro={erroDoEnvio} />
            </div>
          )}
          <div className="flex gap-2 md:col-span-2">
            <button type="submit" className={BOTAO_PRIMARIO} disabled={enviando}>
              {enviando ? 'registrando…' : 'registrar e pedir o fechamento'}
            </button>
            <button type="button" className={BOTAO} onClick={aoFechar}>
              cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const ROTULO_DO_CAMPO: Record<string, string> = {
  razaoSocial: 'razão social',
  cnpj: 'CNPJ ou CPF',
  quemAssina: 'quem assina',
  email: 'e-mail',
  telefone: 'WhatsApp',
  endereco: 'endereço',
  produto: 'produto',
  valorCentavos: 'valor',
  parcelas: 'parcelas',
  forma: 'forma',
  assinadoEm: 'assinado em',
  primeiroVencimento: '1º vencimento',
  motivoSemCobranca: 'motivo sem cobrança',
};
