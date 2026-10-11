'use client';

import { useEffect, useState } from 'react';
import {
  TOTEM_ROTULO_DO_SELO,
  totemLoteDataBR,
  totemTextoDaReposicao,
  type TotemFichaDaEtiqueta,
  type TotemSituacaoValidade,
} from '@mktos/shared';
import { CadastroCupom } from '@/components/totem/CadastroCupom';
import { ErroDaApi } from '@/lib/api';
import { ehNaoEncontrado, ehSemRede, totemApi } from '@/lib/totem/api-publica';
import { codigoLegivel, linhaNutricional, precoDaFicha, textoDaPorcao, textoDaValidade } from '../formato';

/*
 * A FICHA QUE O CLIENTE ABRE PELO QR DA ETIQUETA (CONTRATO.md, seção 7).
 *
 * Feita para o celular de 375 px. Cada abertura conta um `qr_aberto` na API,
 * por isso a busca roda uma vez só por código.
 */

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'pronta'; ficha: TotemFichaDaEtiqueta }
  | { tipo: 'nao_encontrada' }
  | { tipo: 'falhou'; semRede: boolean };

const COR = /^#[0-9a-fA-F]{3,8}$/;
const COR_PRIMARIA_PADRAO = '#28371D';
const COR_FUNDO_PADRAO = '#F5F3EC';

const TOM_DA_VALIDADE: Record<TotemSituacaoValidade, string> = {
  vencido: 'border-red-700 bg-red-50 text-red-800',
  atencao: 'border-amber-600 bg-amber-50 text-amber-900',
  ok: 'border-emerald-700 bg-emerald-50 text-emerald-900',
};

export function EtiquetaNaoEncontrada() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-white px-6 py-12 text-neutral-800">
      <h1 className="text-2xl font-semibold">Etiqueta não encontrada</h1>
      <p className="mt-4 text-base leading-relaxed">
        Não encontramos o produto desta etiqueta. Confira se o endereço foi digitado inteiro ou peça ajuda à equipe da
        loja.
      </p>
    </main>
  );
}

export function FichaDaEtiqueta({ codigo }: { codigo: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado({ tipo: 'carregando' });
    totemApi<TotemFichaDaEtiqueta>(`/totem-etiqueta/${encodeURIComponent(codigo)}`)
      .then((ficha) => vivo && setEstado({ tipo: 'pronta', ficha }))
      .catch((e: unknown) => {
        if (!vivo) return;
        if (ehNaoEncontrado(e) || (e instanceof ErroDaApi && e.status === 400)) setEstado({ tipo: 'nao_encontrada' });
        else setEstado({ tipo: 'falhou', semRede: ehSemRede(e) });
      });
    return () => {
      vivo = false;
    };
  }, [codigo, tentativa]);

  if (estado.tipo === 'nao_encontrada') return <EtiquetaNaoEncontrada />;

  if (estado.tipo === 'carregando') {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-white px-6 py-12 text-neutral-600">
        <p className="text-base">Carregando a ficha do produto…</p>
      </main>
    );
  }

  if (estado.tipo === 'falhou') {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-white px-6 py-12 text-neutral-800">
        <h1 className="text-2xl font-semibold">Não deu para abrir a ficha</h1>
        <p className="mt-4 text-base leading-relaxed">
          {estado.semRede
            ? 'O celular está sem conexão com a internet. Confira a rede e tente de novo.'
            : 'A consulta falhou agora. Tente de novo em alguns segundos.'}
        </p>
        <button
          type="button"
          onClick={() => setTentativa((t) => t + 1)}
          className="mt-6 w-full rounded-lg border border-neutral-300 px-4 py-3 text-base font-medium"
        >
          Tentar de novo
        </button>
      </main>
    );
  }

  return <Ficha ficha={estado.ficha} codigo={codigo} />;
}

function Ficha({ ficha, codigo }: { ficha: TotemFichaDaEtiqueta; codigo: string }) {
  const [cadastro, setCadastro] = useState<'fechado' | 'aberto' | 'concluido'>('fechado');
  const { produto, lote, config, campanha, loja } = ficha;
  const primaria = COR.test(config.corPrimaria) ? config.corPrimaria : COR_PRIMARIA_PADRAO;
  const fundo = COR.test(config.corFundo) ? config.corFundo : COR_FUNDO_PADRAO;
  const preco = precoDaFicha(produto.precoCentavos, produto.unidadePreco);
  const porcao = textoDaPorcao(produto.porcaoG, produto.porcaoDescricao);

  return (
    <main className="min-h-screen" style={{ backgroundColor: fundo, color: primaria }}>
      <div className="mx-auto max-w-md space-y-5 px-4 pb-12 pt-6">
        <header className="flex items-center justify-between gap-3">
          {config.logoUrl ? (
            <img src={config.logoUrl} alt={config.nomeExibicao} className="h-10 w-auto max-w-[60%] object-contain" />
          ) : (
            <span className="text-base font-semibold">{config.nomeExibicao}</span>
          )}
          <span className="text-right text-xs opacity-80">
            {loja.nome}
            {loja.cidade ? `, ${loja.cidade}` : ''}
          </span>
        </header>

        <section className="space-y-3">
          {produto.categoria && <p className="text-xs uppercase tracking-[0.14em] opacity-80">{produto.categoria}</p>}
          <h1 className="font-serif text-3xl font-semibold leading-tight">{produto.nome}</h1>
          {produto.selos.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Selos do produto">
              {produto.selos.map((s) => (
                <li key={s} className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: primaria }}>
                  {TOTEM_ROTULO_DO_SELO[s]}
                </li>
              ))}
            </ul>
          )}
          {preco && <p className="text-2xl font-semibold">{preco}</p>}
          {produto.imagemUrl && (
            <img src={produto.imagemUrl} alt={produto.nome} className="max-h-64 w-full rounded-xl object-cover" />
          )}
        </section>

        <Bloco titulo="Lote e validade" cor={primaria}>
          {lote ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="opacity-80">Lote</dt>
                <dd className="font-medium">{lote.codigo}</dd>
                {lote.fabricadoEm && (
                  <>
                    <dt className="opacity-80">Fabricação</dt>
                    <dd className="font-medium">{totemLoteDataBR(lote.fabricadoEm)}</dd>
                  </>
                )}
                <dt className="opacity-80">Validade</dt>
                <dd className="font-medium">{totemLoteDataBR(lote.validadeEm)}</dd>
              </dl>
              <p className={`rounded-lg border-l-4 px-3 py-2 text-sm font-medium ${TOM_DA_VALIDADE[lote.situacao]}`}>
                {textoDaValidade(lote.situacao, lote.validadeEm)}
              </p>
              {lote.repostoEm && <p className="text-sm">{totemTextoDaReposicao(lote.repostoEm, lote.presumido)}.</p>}
            </div>
          ) : (
            <p className="text-sm leading-relaxed">
              A loja ainda não registrou o lote deste produto. A validade está na embalagem, e a equipe da loja pode
              confirmar.
            </p>
          )}
        </Bloco>

        {(produto.composicao || produto.beneficios || produto.alergenicos) && (
          <Bloco titulo="Sobre o produto" cor={primaria}>
            <div className="space-y-3 text-sm leading-relaxed">
              {produto.composicao && (
                <p>
                  <span className="font-semibold">Ingredientes: </span>
                  {produto.composicao}
                </p>
              )}
              {produto.beneficios && <p>{produto.beneficios}</p>}
              {produto.alergenicos && (
                <p>
                  <span className="font-semibold">Alergênicos: </span>
                  {produto.alergenicos}
                </p>
              )}
            </div>
          </Bloco>
        )}

        {produto.nutricional.length > 0 && (
          <Bloco titulo="Informação nutricional" cor={primaria}>
            {porcao && <p className="mb-2 text-sm">{porcao}</p>}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs opacity-80" style={{ borderColor: primaria }}>
                  <th className="py-1 font-medium">Nutriente</th>
                  <th className="py-1 text-right font-medium">Quantidade</th>
                  <th className="py-1 text-right font-medium">%VD</th>
                </tr>
              </thead>
              <tbody>
                {produto.nutricional.map((n) => {
                  const linha = linhaNutricional(n);
                  return (
                    <tr key={n.nutriente} className="border-b border-dashed last:border-0" style={{ borderColor: primaria }}>
                      <td className="py-1">{n.nutriente}</td>
                      <td className="py-1 text-right">{linha.quantidade}</td>
                      <td className="py-1 text-right">{linha.vd}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {produto.fonteNutricional && <p className="mt-2 text-xs opacity-80">Fonte: {produto.fonteNutricional}</p>}
          </Bloco>
        )}

        {campanha && cadastro !== 'concluido' && (
          <section className="space-y-3 rounded-xl p-4" style={{ backgroundColor: primaria, color: fundo }}>
            <p className="text-lg font-semibold leading-snug">{campanha.chamada}</p>
            {campanha.descricaoBeneficio && <p className="text-sm">{campanha.descricaoBeneficio}</p>}
            {cadastro === 'fechado' && (
              <button
                type="button"
                onClick={() => setCadastro('aberto')}
                className="w-full rounded-lg px-4 py-3 text-base font-semibold"
                style={{ backgroundColor: fundo, color: primaria }}
              >
                Cadastre-se e ganhe seu cupom
              </button>
            )}
          </section>
        )}

        {campanha && cadastro === 'aberto' && (
          <CadastroCupom
            origem="qr"
            credencial={{ etiqueta: codigo }}
            aoConcluir={() => setCadastro('concluido')}
            aoCancelar={() => setCadastro('fechado')}
          />
        )}

        {cadastro === 'concluido' && (
          <p className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: primaria }}>
            Cadastro feito. Mostre o cupom no caixa da loja.
          </p>
        )}

        <footer className="space-y-1 pt-2 text-xs opacity-80">
          <p>Etiqueta {codigoLegivel(codigo)}</p>
          <p>
            <a href={`/totem/privacidade?e=${encodeURIComponent(codigo)}`} className="underline">
              Política de privacidade
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}

function Bloco({ titulo, cor, children }: { titulo: string; cor: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-dashed pt-4" style={{ borderColor: cor }}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em]">{titulo}</h2>
      {children}
    </section>
  );
}
