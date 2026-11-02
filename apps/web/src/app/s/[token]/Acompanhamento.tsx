'use client';

import type { AreaDoClienteParaOCliente, EstadoDaSala } from '@mktos/shared';

import { dataCurta, rotuloDoHorario } from '@/lib/sala-do-cliente';

/*
 * O ACOMPANHAMENTO DO CLIENTE (leva 5, L6, 27/10/2026): "o cliente acompanha
 * tudo pela sala".
 *
 * Quatro blocos que a API DERIVA em tempo de leitura (`acompanhamentoDaSala`,
 * em `apps/api/src/comercial/sala-projecao.ts`), sem versão nova em
 * `SalaVersao`: a etapa atual em palavras de cliente, o que vem agora (de quem
 * e quando há data gravada), os documentos trocados e o contato da Root. A sala
 * antiga ganha os blocos sem republicar; o conteúdo das versões publicadas não
 * muda.
 *
 * O tipo é o espelho do da API (mantido aqui, e não no shared, para esta lane
 * não tocar arquivo de outra; mover para `@mktos/shared` fica como passo
 * seguinte). Nada aqui inventa dado: campo nulo aparece como "ainda não".
 */

export interface EtapaParaOCliente {
  chave: string;
  rotulo: string;
  descricao: string;
  ordem: number | null;
  total: number;
  saida: boolean;
}

export interface PassoParaOCliente {
  texto: string;
  quando: string | null;
  quandoTipo: 'em' | 'ate' | null;
  deQuem: 'voce' | 'root';
}

export interface DocumentoParaOCliente {
  tipo: 'proposta' | 'contrato' | 'diagnostico' | 'arquivo';
  titulo: string;
  estado: string;
  de: 'voce' | 'root';
  em: string;
  versao?: number;
  link?: string | null;
}

export interface AcompanhamentoDaSala {
  etapa: EtapaParaOCliente | null;
  proximosPassos: PassoParaOCliente[];
  documentos: DocumentoParaOCliente[];
  contato: { whatsapp: string | null; rotulo: string };
}

/**
 * O estado da sala como a API o devolve desde a leva 5: o de sempre mais o
 * acompanhamento. Desde a leva A da área do cliente (30/10/2026), também o
 * `modo` do link e a área montada (só no modo área).
 */
export type EstadoDaSalaComAcompanhamento = EstadoDaSala & {
  acompanhamento?: AcompanhamentoDaSala | null;
  modo?: 'sala' | 'area';
  area?: AreaDoClienteParaOCliente | null;
};

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const CARTAO = 'rounded-xl border border-border bg-surface p-4';
const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';

function quandoDoPasso(p: PassoParaOCliente): string | null {
  if (!p.quando || !p.quandoTipo) return null;
  return p.quandoTipo === 'ate' ? `até ${dataCurta(p.quando)}` : rotuloDoHorario(p.quando);
}

/** O link do WhatsApp da Root, ou nulo sem número (a tela não inventa). */
export function linkDoWhatsapp(numero: string | null | undefined): string | null {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  return /^\d{10,15}$/.test(digitos) ? `https://wa.me/${digitos}` : null;
}

export function Acompanhamento({ estado, token, semContato = false }: { estado: EstadoDaSalaComAcompanhamento; token: string; semContato?: boolean }) {
  const a = estado.acompanhamento;
  if (!a) return null;
  const wa = linkDoWhatsapp(a.contato.whatsapp);
  return (
    <section className={`${CARTAO} space-y-4`} aria-label="acompanhamento" data-testid="sala-acompanhamento">
      <div>
        <h2 className={ROTULO}>onde a conversa está</h2>
        {a.etapa ? (
          <div className="mt-1" data-testid="sala-etapa">
            <p className="text-[17px] font-bold leading-tight">{a.etapa.rotulo}</p>
            <p className="mt-0.5 text-[13px] text-muted">{a.etapa.descricao}</p>
            {a.etapa.ordem !== null && (
              <p className="mt-1 font-os-mono text-[10.5px] text-dim">etapa {a.etapa.ordem} de {a.etapa.total}</p>
            )}
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-muted">A conversa está começando. Os passos abaixo mostram o que vem agora.</p>
        )}
      </div>

      <div>
        <h3 className={ROTULO}>o que vem agora</h3>
        {a.proximosPassos.length ? (
          <ul className="mt-1.5 space-y-1.5" data-testid="sala-proximos-passos">
            {a.proximosPassos.map((p, i) => {
              const quando = quandoDoPasso(p);
              return (
                <li key={`${p.texto}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13.5px]">
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 font-os-mono text-[10px] uppercase tracking-[0.12em] ${p.deQuem === 'voce' ? 'border-brand/50 text-brand' : 'border-border text-muted'}`}>
                    {p.deQuem === 'voce' ? 'você' : 'Root'}
                  </span>
                  <span>{p.texto}</span>
                  {quando && <span className="font-os-mono text-[11px] text-muted">{quando}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-muted">Nenhum passo pendente agora. A Root avisa por aqui e pelo WhatsApp quando houver.</p>
        )}
      </div>

      <div>
        <h3 className={ROTULO}>documentos trocados</h3>
        {a.documentos.length ? (
          <ul className="mt-1.5 divide-y divide-border" data-testid="sala-documentos">
            {a.documentos.map((d, i) => {
              const link = d.tipo === 'proposta' && d.versao && estado.proposta?.versao === d.versao ? `/s/${encodeURIComponent(token)}/proposta` : d.link ?? null;
              const corpo = (
                <>
                  <span className="block text-[13.5px] font-semibold">{d.titulo}</span>
                  <span className="block text-[12px] text-muted">
                    {d.de === 'voce' ? 'enviado por você' : 'publicado pela Root'} · {dataCurta(d.em)} · {d.estado}
                  </span>
                </>
              );
              return (
                <li key={`${d.tipo}-${d.em}-${i}`} className="py-2">
                  {link ? (
                    <a href={link} target={link.startsWith('/') ? undefined : '_blank'} rel={link.startsWith('/') ? undefined : 'noreferrer'} className={`block rounded-lg hover:text-brand ${FOCO}`}>{corpo}</a>
                  ) : (
                    <div>{corpo}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-muted">Nenhum documento trocado ainda. O que a Root publicar e o que você enviar aparecem aqui.</p>
        )}
      </div>

      {!semContato && (
        <div data-testid="sala-contato">
          <h3 className={ROTULO}>falar com a Root</h3>
          {wa ? (
            <a href={wa} target="_blank" rel="noreferrer" className={`mt-1.5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand px-4 text-[14px] font-semibold text-ink ${FOCO}`}>
              {a.contato.rotulo}
            </a>
          ) : (
            <p className="mt-1 text-[13px] text-muted">{a.contato.rotulo}</p>
          )}
        </div>
      )}
    </section>
  );
}
