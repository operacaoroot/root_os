'use client';

import { useEffect, useState } from 'react';
import {
  TOTEM_MENSAGEM_ACEITE,
  TOTEM_MENSAGEM_CELULAR_INVALIDO,
  TOTEM_MENSAGEM_CPF_INVALIDO,
  TOTEM_POLITICA_VERSAO,
  totemCpfValido,
  totemNormalizarCelular,
  totemSoDigitos,
  type TotemCadastroResposta,
  type TotemCupomEmitido,
  type TotemMotivoSemCupom,
} from '@mktos/shared';
import { TextoDaPolitica } from '@/app/totem/privacidade/TextoDaPolitica';
import { buscarPolitica, type PoliticaNaTela } from '@/app/totem/privacidade/buscar-politica';
import { ErroDaApi } from '@/lib/api';
import { ehSemRede, totemApi, type TotemCredencial } from '@/lib/totem/api-publica';

/*
 * O CADASTRO QUE GERA O CUPOM (CONTRATO.md, seções 4 e 8).
 *
 * Um componente só para os dois caminhos: o quiosque (`origem="totem"`, com o
 * token do aparelho) e o celular que leu o QR da etiqueta (`origem="qr"`, com o
 * código dela). Quem abre o cadastro só decide o que fazer quando ele termina
 * ou é cancelado.
 *
 * No quiosque não há campo de texto: CPF e celular entram pelo teclado numérico
 * da própria tela, e a política abre por cima do formulário, porque sair da
 * página perderia o que foi digitado e o quiosque não tem para onde voltar.
 * As cores vêm de `--totem-cor-primaria` e `--totem-cor-fundo` quando quem
 * mostra o cadastro as define; sem elas, valem as cores da semente.
 */

export interface CadastroCupomProps {
  origem: 'totem' | 'qr';
  credencial: TotemCredencial;
  aoConcluir: () => void;
  aoCancelar: () => void;
}

// --- Regras puras (tests/unit/totem-cadastro-cupom.test.ts) ---

/** `123.456.789-09` conforme a pessoa digita. */
export function formatarCpfDigitando(texto: string): string {
  const d = totemSoDigitos(texto).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Os 11 dígitos do celular (DDD e número), mesmo quando a pessoa cola com +55 ou com o zero na frente. */
export function digitosDoCelular(texto: string): string {
  let d = totemSoDigitos(texto);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length > 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 11);
}

/** `(11) 98765-4321` conforme a pessoa digita. */
export function formatarCelularDigitando(texto: string): string {
  const d = digitosDoCelular(texto);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** `ABCD-EFGH`: o hífen só ajuda a ler em voz alta; o caixa aceita o código com ou sem ele. */
export function formatarCodigoDoCupom(codigo: string): string {
  return codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
}

/** DD/MM/AAAA no horário de Brasília, onde ficam as lojas. */
export function dataDoCupom(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export type CampoDoCadastro = 'cpf' | 'telefone' | 'aceite';

export interface ProblemaDoCadastro {
  campo: CampoDoCadastro | null;
  mensagem: string;
}

/** A mesma conferência da API, feita antes de gastar uma chamada. */
export function conferirCadastro(d: { cpf: string; telefone: string; aceitePolitica: boolean }): ProblemaDoCadastro | null {
  if (!totemSoDigitos(d.cpf)) return { campo: 'cpf', mensagem: 'Digite o seu CPF.' };
  if (!totemCpfValido(d.cpf)) return { campo: 'cpf', mensagem: TOTEM_MENSAGEM_CPF_INVALIDO };
  if (!totemSoDigitos(d.telefone)) return { campo: 'telefone', mensagem: 'Digite o número do seu celular, com o DDD.' };
  if (!totemNormalizarCelular(d.telefone)) return { campo: 'telefone', mensagem: TOTEM_MENSAGEM_CELULAR_INVALIDO };
  if (!d.aceitePolitica) return { campo: 'aceite', mensagem: TOTEM_MENSAGEM_ACEITE };
  return null;
}

const FALHA_GENERICA = 'Não foi possível concluir o cadastro. Tente de novo em instantes.';

/** A frase que a pessoa lê quando o envio falha. As frases da API já vêm prontas para a tela. */
export function mensagemDoErroDoCadastro(e: unknown, origem: CadastroCupomProps['origem']): string {
  if (ehSemRede(e)) {
    return origem === 'totem'
      ? 'O totem está sem internet agora. Tente de novo em instantes ou faça o cadastro pelo celular, lendo o QR da etiqueta de um produto.'
      : 'O celular está sem internet. Confira a conexão e tente de novo.';
  }
  if (!(e instanceof ErroDaApi)) return FALHA_GENERICA;
  if (e.status === 404) {
    return origem === 'qr'
      ? 'Esta etiqueta não serve mais para o cadastro. Leia o QR de outra etiqueta ou fale com um atendente.'
      : 'O cadastro não está disponível neste totem. Fale com um atendente.';
  }
  if (e.status === 429) return 'Muitos cadastros saíram desta rede na última hora. Espere alguns minutos e tente de novo.';
  if (e.status === 400) {
    // O filtro de validação manda "campo: frase", e o nome do campo não diz nada a quem está na loja.
    return e.message
      .split(' · ')
      .map((p) => p.replace(/^[\w.]+: /, ''))
      .join(' ');
  }
  if (e.status >= 500 && e.status !== 503) return FALHA_GENERICA;
  return e.message || FALHA_GENERICA;
}

export const MENSAGEM_SEM_CUPOM: Record<TotemMotivoSemCupom, string> = {
  sem_campanha:
    'Não há campanha valendo nesta loja agora. Quando houver, faça o cadastro de novo com o mesmo CPF para receber o cupom.',
  cupom_usado: 'O cupom desta campanha já foi usado. Cada CPF recebe um cupom por campanha.',
  cupom_vencido: 'O cupom desta campanha venceu antes de ser usado. Cada CPF recebe um cupom por campanha.',
  cupom_cancelado: 'O cupom desta campanha foi cancelado. Se achar que é engano, fale com um atendente.',
  consulte_atendente:
    'Não conseguimos emitir o cupom com estes dados. Se você já tem cadastro com outro celular, fale com um atendente da loja.',
};

// --- Tela ---

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'apagar', '0', 'limpar'] as const;
type Tecla = (typeof TECLAS)[number];

// O modificador de opacidade do Tailwind 3 não age sobre `var()`; os tons claros saem do color-mix.
const CORES = {
  '--cor-p': 'var(--totem-cor-primaria, #28371D)',
  '--cor-f': 'var(--totem-cor-fundo, #F5F3EC)',
  '--cor-p-25': 'color-mix(in srgb, var(--totem-cor-primaria, #28371D) 25%, transparent)',
  '--cor-p-10': 'color-mix(in srgb, var(--totem-cor-primaria, #28371D) 10%, transparent)',
} as React.CSSProperties;

const BOTAO_PRINCIPAL =
  'rounded-2xl bg-[color:var(--cor-p)] font-semibold text-[color:var(--cor-f)] disabled:cursor-not-allowed disabled:opacity-50';
const BOTAO_SECUNDARIO =
  'rounded-2xl border-2 border-[color:var(--cor-p)] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const ENTRADA_DO_CELULAR =
  'h-12 w-full rounded-xl border-2 border-[color:var(--cor-p-25)] bg-white px-3 text-lg outline-none focus:border-[color:var(--cor-p)]';

function linkDaPolitica(credencial: TotemCredencial): string {
  return 'etiqueta' in credencial ? `/totem/privacidade?e=${encodeURIComponent(credencial.etiqueta)}` : '/totem/privacidade';
}

export function CadastroCupom({ origem, credencial, aoConcluir, aoCancelar }: CadastroCupomProps) {
  const quiosque = origem === 'totem';
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [nome, setNome] = useState('');
  const [aceitePolitica, setAceitePolitica] = useState(false);
  const [aceitaCampanhas, setAceitaCampanhas] = useState(false);
  const [campoAtivo, setCampoAtivo] = useState<'cpf' | 'telefone'>('cpf');
  const [problema, setProblema] = useState<ProblemaDoCadastro | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resposta, setResposta] = useState<TotemCadastroResposta | null>(null);
  const [politicaAberta, setPoliticaAberta] = useState(false);

  function teclar(tecla: Tecla) {
    setProblema(null);
    const atual = campoAtivo === 'cpf' ? cpf : telefone;
    const novo = tecla === 'apagar' ? atual.slice(0, -1) : tecla === 'limpar' ? '' : (atual + tecla).slice(0, 11);
    if (campoAtivo === 'cpf') {
      setCpf(novo);
      if (novo.length === 11 && totemCpfValido(novo) && !telefone) setCampoAtivo('telefone');
    } else {
      setTelefone(novo);
    }
  }

  async function enviar(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (enviando) return;
    const p = conferirCadastro({ cpf, telefone, aceitePolitica });
    if (p) {
      setProblema(p);
      if (p.campo === 'cpf' || p.campo === 'telefone') setCampoAtivo(p.campo);
      return;
    }
    setProblema(null);
    setEnviando(true);
    try {
      const r = await totemApi<TotemCadastroResposta>('/totem-cadastro', {
        credencial,
        corpo: {
          cpf,
          telefone,
          nome: quiosque ? null : nome.trim() || null,
          aceitePolitica: true,
          aceitaCampanhas,
          politicaVersao: TOTEM_POLITICA_VERSAO,
        },
      });
      // A política promete que o cadastro sai da tela quando o cupom aparece.
      setCpf('');
      setTelefone('');
      setNome('');
      setResposta(r);
    } catch (e) {
      setProblema({ campo: null, mensagem: mensagemDoErroDoCadastro(e, origem) });
    } finally {
      setEnviando(false);
    }
  }

  if (resposta) {
    return (
      <div role="dialog" aria-label="Cadastro" style={CORES} className="w-full bg-[color:var(--cor-f)] text-[color:var(--cor-p)]">
        <Resultado resposta={resposta} quiosque={quiosque} aoConcluir={aoConcluir} />
      </div>
    );
  }

  const altura = quiosque ? 'h-16 text-xl' : 'h-12 text-base';

  return (
    <div
      role="dialog"
      aria-label="Cadastro"
      style={CORES}
      className={`relative mx-auto w-full max-w-xl space-y-5 bg-[color:var(--cor-f)] p-5 text-[color:var(--cor-p)] ${
        quiosque ? 'text-xl' : 'text-base'
      }`}
    >
      <header className="space-y-1">
        <h2 className={quiosque ? 'text-3xl font-semibold' : 'text-2xl font-semibold'}>Cadastre-se e ganhe um cupom</h2>
        <p className="opacity-80">Informe o CPF e o celular. O cupom aparece na tela assim que o cadastro termina.</p>
      </header>

      <form onSubmit={enviar} noValidate className="space-y-5">
        {quiosque ? (
          <div className="space-y-3">
            <CampoDoQuiosque
              rotulo="CPF"
              valor={formatarCpfDigitando(cpf)}
              exemplo="000.000.000-00"
              ativo={campoAtivo === 'cpf'}
              comProblema={problema?.campo === 'cpf'}
              aoTocar={() => setCampoAtivo('cpf')}
            />
            <CampoDoQuiosque
              rotulo="Celular com DDD"
              valor={formatarCelularDigitando(telefone)}
              exemplo="(00) 00000-0000"
              ativo={campoAtivo === 'telefone'}
              comProblema={problema?.campo === 'telefone'}
              aoTocar={() => setCampoAtivo('telefone')}
            />
            <div className="grid grid-cols-3 gap-3" role="group" aria-label="Teclado numérico">
              {TECLAS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => teclar(t)}
                  aria-label={t === 'apagar' ? 'Apagar o último número' : t === 'limpar' ? 'Limpar o campo' : t}
                  className={`h-20 rounded-2xl border-2 border-[color:var(--cor-p-25)] bg-white font-semibold active:bg-[color:var(--cor-p-10)] ${
                    t === 'apagar' || t === 'limpar' ? 'text-lg' : 'text-3xl'
                  }`}
                >
                  {t === 'apagar' ? 'Apagar' : t === 'limpar' ? 'Limpar' : t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <CampoDoCelular rotulo="CPF" comProblema={problema?.campo === 'cpf'}>
              <input
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                value={formatarCpfDigitando(cpf)}
                onChange={(e) => {
                  setProblema(null);
                  setCpf(totemSoDigitos(e.target.value).slice(0, 11));
                }}
                aria-invalid={problema?.campo === 'cpf'}
                className={ENTRADA_DO_CELULAR}
              />
            </CampoDoCelular>
            <CampoDoCelular rotulo="Celular com DDD" comProblema={problema?.campo === 'telefone'}>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="(00) 00000-0000"
                value={formatarCelularDigitando(telefone)}
                onChange={(e) => {
                  setProblema(null);
                  setTelefone(digitosDoCelular(e.target.value));
                }}
                aria-invalid={problema?.campo === 'telefone'}
                className={ENTRADA_DO_CELULAR}
              />
            </CampoDoCelular>
            <CampoDoCelular rotulo="Nome (opcional)" comProblema={false}>
              <input
                autoComplete="name"
                maxLength={80}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={ENTRADA_DO_CELULAR}
              />
            </CampoDoCelular>
          </div>
        )}

        <div className="space-y-3">
          <div className={`flex items-start gap-3 ${problema?.campo === 'aceite' ? 'font-semibold' : ''}`}>
            <input
              id="cadastro-aceite"
              type="checkbox"
              checked={aceitePolitica}
              onChange={(e) => {
                setProblema(null);
                setAceitePolitica(e.target.checked);
              }}
              aria-invalid={problema?.campo === 'aceite'}
              className={`mt-1 shrink-0 accent-[color:var(--cor-p)] ${quiosque ? 'h-8 w-8' : 'h-5 w-5'}`}
            />
            <p>
              <label htmlFor="cadastro-aceite">Li e aceito a </label>
              {quiosque ? (
                <button type="button" onClick={() => setPoliticaAberta(true)} className="font-semibold underline">
                  política de privacidade
                </button>
              ) : (
                <a href={linkDaPolitica(credencial)} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                  política de privacidade
                </a>
              )}
              <label htmlFor="cadastro-aceite">.</label>
            </p>
          </div>
          <div className="flex items-start gap-3">
            <input
              id="cadastro-campanhas"
              type="checkbox"
              checked={aceitaCampanhas}
              onChange={(e) => setAceitaCampanhas(e.target.checked)}
              className={`mt-1 shrink-0 accent-[color:var(--cor-p)] ${quiosque ? 'h-8 w-8' : 'h-5 w-5'}`}
            />
            <label htmlFor="cadastro-campanhas">
              Quero receber campanhas e ofertas <span className="opacity-70">(opcional)</span>
            </label>
          </div>
        </div>

        {problema && (
          <p role="alert" className="rounded-xl border-2 border-red-700/40 bg-red-50 px-4 py-3 font-medium text-red-800">
            {problema.mensagem}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button type="button" onClick={aoCancelar} disabled={enviando} className={`${BOTAO_SECUNDARIO} ${altura} sm:flex-1`}>
            Cancelar
          </button>
          <button type="submit" disabled={enviando} className={`${BOTAO_PRINCIPAL} ${altura} sm:flex-[2]`}>
            {enviando ? 'Enviando o cadastro…' : 'Receber meu cupom'}
          </button>
        </div>
      </form>

      {politicaAberta && <PoliticaPorCima credencial={credencial} aoFechar={() => setPoliticaAberta(false)} />}
    </div>
  );
}

function CampoDoQuiosque({
  rotulo,
  valor,
  exemplo,
  ativo,
  comProblema,
  aoTocar,
}: {
  rotulo: string;
  valor: string;
  exemplo: string;
  ativo: boolean;
  comProblema: boolean;
  aoTocar: () => void;
}) {
  const borda = comProblema ? 'border-red-700' : ativo ? 'border-[color:var(--cor-p)]' : 'border-[color:var(--cor-p-25)]';
  return (
    <button
      type="button"
      onClick={aoTocar}
      aria-pressed={ativo}
      aria-label={`${rotulo}: ${valor || 'vazio'}`}
      className={`block w-full rounded-2xl border-4 bg-white px-4 py-3 text-left ${borda}`}
    >
      <span className="block text-base opacity-70">{rotulo}</span>
      <span className={`block font-mono text-3xl tracking-wide ${valor ? '' : 'opacity-30'}`}>{valor || exemplo}</span>
    </button>
  );
}

function CampoDoCelular({ rotulo, comProblema, children }: { rotulo: string; comProblema: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={`block text-sm font-medium ${comProblema ? 'text-red-800' : 'opacity-80'}`}>{rotulo}</span>
      {children}
    </label>
  );
}

function Resultado({
  resposta,
  quiosque,
  aoConcluir,
}: {
  resposta: TotemCadastroResposta;
  quiosque: boolean;
  aoConcluir: () => void;
}) {
  const botao = `${BOTAO_PRINCIPAL} w-full ${quiosque ? 'h-16 text-xl' : 'h-12 text-base'}`;
  if (!resposta.cupom) {
    return (
      <div className="mx-auto max-w-xl space-y-5 p-5 text-center">
        <h2 className="text-3xl font-semibold">
          {resposta.motivoSemCupom === 'consulte_atendente' ? 'Fale com um atendente.' : 'Seu cadastro está feito.'}
        </h2>
        <p className={quiosque ? 'text-xl' : 'text-lg'}>{MENSAGEM_SEM_CUPOM[resposta.motivoSemCupom ?? 'sem_campanha']}</p>
        <button type="button" onClick={aoConcluir} className={botao}>
          Pronto
        </button>
      </div>
    );
  }
  return <CupomNaTela cupom={resposta.cupom} quiosque={quiosque} aoConcluir={aoConcluir} botao={botao} />;
}

function CupomNaTela({
  cupom,
  quiosque,
  aoConcluir,
  botao,
}: {
  cupom: TotemCupomEmitido;
  quiosque: boolean;
  aoConcluir: () => void;
  botao: string;
}) {
  return (
    <div className="mx-auto max-w-xl space-y-5 p-5 text-center">
      <p className="text-lg opacity-80">{cupom.chamada}</p>
      <div className="space-y-2 rounded-3xl border-4 border-dashed border-[color:var(--cor-p)] bg-white px-4 py-6">
        <p className="text-base font-medium uppercase tracking-widest opacity-70">Seu cupom</p>
        <p
          className={`font-mono font-bold tracking-[0.15em] ${quiosque ? 'text-6xl' : 'select-all text-5xl'}`}
          aria-label={`Código do cupom: ${cupom.codigo.split('').join(' ')}`}
        >
          {formatarCodigoDoCupom(cupom.codigo)}
        </p>
        <p className="text-2xl font-semibold">{cupom.beneficio}</p>
        {cupom.detalhe && <p className="text-lg">{cupom.detalhe}</p>}
        <p className="text-lg">Vale até {dataDoCupom(cupom.validoAte)}.</p>
      </div>
      <p className="text-2xl font-semibold">Mostre este código no caixa.</p>
      <p className="text-base opacity-80">
        {quiosque
          ? 'Tire uma foto desta tela com o celular ou anote o código antes de sair.'
          : 'Tire um print desta tela para não perder o código.'}
      </p>
      <button type="button" onClick={aoConcluir} className={botao}>
        Pronto
      </button>
    </div>
  );
}

/** A política em tela cheia, por cima do formulário, sem sair do quiosque. */
function PoliticaPorCima({ credencial, aoFechar }: { credencial: TotemCredencial; aoFechar: () => void }) {
  // Busca uma vez por abertura: o quiosque pode redesenhar com outra credencial
  // de mesmo valor, e cada busca conta no limite por hora da rota de cadastro.
  const [credencialDaAbertura] = useState(credencial);
  const [tela, setTela] = useState<PoliticaNaTela | null>(null);

  useEffect(() => {
    let vivo = true;
    void buscarPolitica(credencialDaAbertura).then((r) => {
      if (vivo) setTela(r);
    });
    return () => {
      vivo = false;
    };
  }, [credencialDaAbertura]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Política de privacidade"
      className="fixed inset-0 z-50 flex flex-col bg-[color:var(--cor-f)] text-[color:var(--cor-p)]"
    >
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          {tela ? (
            <TextoDaPolitica politica={tela.politica} grande />
          ) : (
            <p className="text-xl" role="status">
              Carregando a política de privacidade.
            </p>
          )}
        </div>
      </div>
      <div className="border-t-2 border-[color:var(--cor-p-25)] p-4">
        <button type="button" onClick={aoFechar} className={`${BOTAO_PRINCIPAL} mx-auto block h-16 w-full max-w-2xl text-xl`}>
          Voltar ao cadastro
        </button>
      </div>
    </div>
  );
}
