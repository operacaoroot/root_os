'use client';

import { FormEvent, useState } from 'react';
import {
  TOTEM_ROTULO_DO_SELO,
  TOTEM_SELOS,
  TOTEM_UNIDADES_PRECO,
  type TotemGestaoProduto,
  type TotemGestaoProdutoCriar,
  type TotemNutriente,
  type TotemSelo,
  type TotemUnidadePreco,
} from '@mktos/shared';
import { Botao, Campo, Card, inputCls } from '../../referencias/ui';
import { ROTULO_UNIDADE, centavosDoTexto, textoDosCentavos } from '../lojas/apoio';

/*
 * A FICHA DO PRODUTO — o formulário de criar e de editar.
 *
 * Os números entram como texto (vírgula ou ponto) e só viram número ao salvar,
 * para a pessoa poder apagar e redigitar sem o campo pular. Linha da tabela
 * nutricional sem quantidade não é salva: a tabela padrão vem com as linhas da
 * rotulagem e quem preenche só completa o que o rótulo traz.
 */

type UnidadeNutriente = TotemNutriente['unidade'];
const UNIDADES_NUTRIENTE: UnidadeNutriente[] = ['kcal', 'kJ', 'g', 'mg', 'mcg'];

const TABELA_PADRAO: Array<[string, UnidadeNutriente]> = [
  ['Valor energético', 'kcal'],
  ['Carboidratos', 'g'],
  ['Açúcares totais', 'g'],
  ['Açúcares adicionados', 'g'],
  ['Proteínas', 'g'],
  ['Gorduras totais', 'g'],
  ['Gorduras saturadas', 'g'],
  ['Gorduras trans', 'g'],
  ['Fibra alimentar', 'g'],
  ['Sódio', 'mg'],
];

interface LinhaNutricional {
  nutriente: string;
  quantidade: string;
  unidade: UnidadeNutriente;
  vd: string;
}

interface Rascunho {
  codigo: string;
  codigoDirector: string;
  nome: string;
  categoria: string;
  composicao: string;
  beneficios: string;
  alergenicos: string;
  porcaoG: string;
  porcaoDescricao: string;
  nutricional: LinhaNutricional[];
  selos: TotemSelo[];
  validadeDiasPadrao: string;
  preco: string;
  unidadePreco: TotemUnidadePreco | '';
  imagemUrl: string;
  fonteNutricional: string;
  ativo: boolean;
}

const numeroEmTexto = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

function paraRascunho(p: TotemGestaoProduto | null): Rascunho {
  return {
    codigo: p?.codigo ?? '',
    codigoDirector: p?.codigoDirector ?? '',
    nome: p?.nome ?? '',
    categoria: p?.categoria ?? '',
    composicao: p?.composicao ?? '',
    beneficios: p?.beneficios ?? '',
    alergenicos: p?.alergenicos ?? '',
    porcaoG: numeroEmTexto(p?.porcaoG),
    porcaoDescricao: p?.porcaoDescricao ?? '',
    nutricional: (p?.nutricional ?? []).map((n) => ({
      nutriente: n.nutriente,
      quantidade: numeroEmTexto(n.quantidade),
      unidade: n.unidade,
      vd: numeroEmTexto(n.vd),
    })),
    selos: p?.selos ?? [],
    validadeDiasPadrao: p?.validadeDiasPadrao == null ? '' : String(p.validadeDiasPadrao),
    preco: textoDosCentavos(p?.precoCentavos ?? null),
    unidadePreco: p?.unidadePreco ?? '',
    imagemUrl: p?.imagemUrl ?? '',
    fonteNutricional: p?.fonteNutricional ?? '',
    ativo: p?.ativo ?? true,
  };
}

/** `null` para vazio, `NaN` para o que não é número. */
function numeroDoTexto(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

/** Monta o corpo da requisição, ou devolve a frase que explica o que corrigir. */
function paraEnvio(r: Rascunho): { corpo: TotemGestaoProdutoCriar } | { erro: string } {
  const precoCentavos = centavosDoTexto(r.preco);
  if (Number.isNaN(precoCentavos)) return { erro: 'O preço precisa ser um valor como 12,90.' };
  if (precoCentavos != null && !r.unidadePreco) return { erro: 'Escolha a unidade do preço: por kg, por 100 g ou por unidade.' };

  const porcaoG = numeroDoTexto(r.porcaoG);
  if (Number.isNaN(porcaoG) || porcaoG === 0) return { erro: 'A porção em gramas precisa ser um número maior que zero.' };

  const validade = numeroDoTexto(r.validadeDiasPadrao);
  if (validade != null && (!Number.isInteger(validade) || validade < 1)) {
    return { erro: 'A validade padrão é um número inteiro de dias, a partir de 1.' };
  }

  const nutricional: TotemNutriente[] = [];
  for (const l of r.nutricional) {
    const nome = l.nutriente.trim();
    const quantidade = numeroDoTexto(l.quantidade);
    if (!nome && quantidade == null) continue;
    if (!nome) return { erro: 'Há uma linha da tabela nutricional com quantidade e sem o nome do nutriente.' };
    if (quantidade == null) continue;
    if (Number.isNaN(quantidade)) return { erro: `A quantidade de ${nome} precisa ser um número.` };
    const vd = numeroDoTexto(l.vd);
    if (Number.isNaN(vd)) return { erro: `O %VD de ${nome} precisa ser um número ou ficar vazio.` };
    nutricional.push({ nutriente: nome, quantidade, unidade: l.unidade, vd });
  }

  return {
    corpo: {
      codigo: r.codigo,
      codigoDirector: r.codigoDirector,
      nome: r.nome,
      categoria: r.categoria,
      composicao: r.composicao,
      beneficios: r.beneficios,
      alergenicos: r.alergenicos,
      porcaoG,
      porcaoDescricao: r.porcaoDescricao,
      nutricional,
      selos: r.selos,
      validadeDiasPadrao: validade,
      precoCentavos,
      unidadePreco: r.unidadePreco || null,
      imagemUrl: r.imagemUrl,
      fonteNutricional: r.fonteNutricional,
      ativo: r.ativo,
    },
  };
}

export function FichaDoProduto({
  produto,
  editavel,
  avisoPreco,
  aoSalvar,
  aoFechar,
}: {
  produto: TotemGestaoProduto | null;
  editavel: boolean;
  avisoPreco: string | null;
  aoSalvar: (corpo: TotemGestaoProdutoCriar) => Promise<void>;
  aoFechar: () => void;
}) {
  const [r, setR] = useState<Rascunho>(() => paraRascunho(produto));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const campo = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((x) => ({ ...x, [k]: v }));
  const linha = (i: number, parte: Partial<LinhaNutricional>) =>
    setR((x) => ({ ...x, nutricional: x.nutricional.map((l, j) => (j === i ? { ...l, ...parte } : l)) }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const montado = paraEnvio(r);
    if ('erro' in montado) {
      setErro(montado.erro);
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await aoSalvar(montado.corpo);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const titulo = produto ? (editavel ? `Editar ${produto.nome}` : produto.nome) : 'Novo produto';

  return (
    <Card titulo={titulo} acao={<Botao tone="ghost" onClick={aoFechar}>Fechar</Botao>}>
      <form onSubmit={salvar} className="space-y-5">
        <fieldset disabled={!editavel || enviando} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Código do produto">
              <input className={inputCls} required maxLength={40} value={r.codigo} onChange={(e) => campo('codigo', e.target.value)} />
            </Campo>
            <Campo label="Código no Director" hint="O código do sistema da loja, se for diferente.">
              <input className={inputCls} maxLength={40} value={r.codigoDirector} onChange={(e) => campo('codigoDirector', e.target.value)} />
            </Campo>
            <Campo label="Nome">
              <input className={inputCls} required minLength={2} maxLength={160} value={r.nome} onChange={(e) => campo('nome', e.target.value)} />
            </Campo>
            <Campo label="Categoria">
              <input className={inputCls} maxLength={80} value={r.categoria} onChange={(e) => campo('categoria', e.target.value)} />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Composição (ingredientes)">
              <textarea className={inputCls} rows={3} maxLength={2000} value={r.composicao} onChange={(e) => campo('composicao', e.target.value)} />
            </Campo>
            <Campo label="Benefícios">
              <textarea className={inputCls} rows={3} maxLength={2000} value={r.beneficios} onChange={(e) => campo('beneficios', e.target.value)} />
            </Campo>
            <Campo label="Alergênicos" hint="Como está no rótulo, por exemplo: Contém castanha-do-pará. Pode conter amendoim.">
              <textarea className={inputCls} rows={2} maxLength={1000} value={r.alergenicos} onChange={(e) => campo('alergenicos', e.target.value)} />
            </Campo>
            <Campo label="Endereço da foto" hint="Precisa começar com https://.">
              <input className={inputCls} type="url" maxLength={500} value={r.imagemUrl} onChange={(e) => campo('imagemUrl', e.target.value)} />
            </Campo>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Selos</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {TOTEM_SELOS.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={r.selos.includes(s)}
                    onChange={(e) => campo('selos', e.target.checked ? [...r.selos, s] : r.selos.filter((x) => x !== s))}
                  />
                  {TOTEM_ROTULO_DO_SELO[s]}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="text-sm font-medium">Tabela nutricional</p>
              {editavel && r.nutricional.length === 0 && (
                <Botao
                  onClick={() =>
                    campo(
                      'nutricional',
                      TABELA_PADRAO.map(([nutriente, unidade]) => ({ nutriente, unidade, quantidade: '', vd: '' })),
                    )
                  }
                >
                  Usar as linhas da rotulagem
                </Botao>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Porção (g)">
                <input className={inputCls} inputMode="decimal" value={r.porcaoG} onChange={(e) => campo('porcaoG', e.target.value)} />
              </Campo>
              <Campo label="Medida caseira da porção" hint="Por exemplo: 2 colheres de sopa.">
                <input className={inputCls} maxLength={120} value={r.porcaoDescricao} onChange={(e) => campo('porcaoDescricao', e.target.value)} />
              </Campo>
            </div>
            {!editavel && r.nutricional.length === 0 && <p className="text-[12px] text-muted">Sem tabela nutricional cadastrada.</p>}
            {r.nutricional.length > 0 && (
              <ul className="space-y-2">
                {r.nutricional.map((l, i) => (
                  <li key={i} className="grid grid-cols-[1fr_5rem_5rem] gap-2 rounded-lg border border-border bg-surface-2 p-2 sm:grid-cols-[1fr_6rem_6rem_5rem_auto]">
                    <input
                      className={`${inputCls} col-span-3 sm:col-span-1`}
                      placeholder="Nutriente"
                      maxLength={60}
                      value={l.nutriente}
                      onChange={(e) => linha(i, { nutriente: e.target.value })}
                      aria-label={`Nutriente da linha ${i + 1}`}
                    />
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      placeholder="Quant."
                      value={l.quantidade}
                      onChange={(e) => linha(i, { quantidade: e.target.value })}
                      aria-label={`Quantidade de ${l.nutriente || `linha ${i + 1}`}`}
                    />
                    <select
                      className={inputCls}
                      value={l.unidade}
                      onChange={(e) => linha(i, { unidade: e.target.value as UnidadeNutriente })}
                      aria-label={`Unidade de ${l.nutriente || `linha ${i + 1}`}`}
                    >
                      {UNIDADES_NUTRIENTE.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      placeholder="%VD"
                      value={l.vd}
                      onChange={(e) => linha(i, { vd: e.target.value })}
                      aria-label={`Percentual do valor diário de ${l.nutriente || `linha ${i + 1}`}`}
                    />
                    {editavel && (
                      <Botao
                        tone="ghost"
                        title="Tirar esta linha"
                        onClick={() => campo('nutricional', r.nutricional.filter((_, j) => j !== i))}
                      >
                        Tirar
                      </Botao>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editavel && (
              <div className="flex flex-wrap items-center gap-3">
                <Botao
                  onClick={() => campo('nutricional', [...r.nutricional, { nutriente: '', quantidade: '', unidade: 'g', vd: '' }])}
                  disabled={r.nutricional.length >= 40}
                >
                  Acrescentar linha
                </Botao>
                <span className="text-[11px] text-muted">As linhas sem quantidade não são salvas. O %VD pode ficar vazio.</span>
              </div>
            )}
            <Campo label="Fonte da tabela nutricional" hint="De onde vieram os números: rótulo do fornecedor, laudo ou tabela TACO.">
              <input className={inputCls} maxLength={500} value={r.fonteNutricional} onChange={(e) => campo('fonteNutricional', e.target.value)} />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Preço (R$)" hint="Vazio quando o produto não tem preço fixo.">
              <input className={inputCls} inputMode="decimal" placeholder="12,90" value={r.preco} onChange={(e) => campo('preco', e.target.value)} />
            </Campo>
            <Campo label="Unidade do preço">
              <select
                className={inputCls}
                value={r.unidadePreco}
                onChange={(e) => campo('unidadePreco', e.target.value as TotemUnidadePreco | '')}
              >
                <option value="">Sem unidade</option>
                {TOTEM_UNIDADES_PRECO.map((u) => (
                  <option key={u} value={u}>
                    {ROTULO_UNIDADE[u]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Validade padrão (dias)" hint="Sugestão para o lote novo deste produto.">
              <input
                className={inputCls}
                inputMode="numeric"
                value={r.validadeDiasPadrao}
                onChange={(e) => campo('validadeDiasPadrao', e.target.value)}
              />
            </Campo>
          </div>
          {avisoPreco && <p className="text-[12px] text-warn">{avisoPreco}</p>}

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={r.ativo} onChange={(e) => campo('ativo', e.target.checked)} />
            Produto ativo (aparece na busca do totem)
          </label>
        </fieldset>

        {erro && <p className="text-sm text-bad">{erro}</p>}
        {editavel && (
          <div className="flex flex-wrap gap-2">
            <Botao type="submit" tone="brand" disabled={enviando}>
              {enviando ? 'Salvando…' : produto ? 'Salvar alterações' : 'Cadastrar produto'}
            </Botao>
            <Botao tone="ghost" onClick={aoFechar} disabled={enviando}>
              Cancelar
            </Botao>
          </div>
        )}
      </form>
    </Card>
  );
}
