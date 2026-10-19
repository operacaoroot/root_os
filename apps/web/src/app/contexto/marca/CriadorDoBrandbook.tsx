'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, FileText, Globe, ImagePlus, Plus, Save, Trash2, X } from 'lucide-react';
import { type BrandbookDocumento, type BrandbookPrevia, type BrandbookColeta } from '@mktos/shared';
import { lerDocumentoLocal, linhas, normalizarLogo, perfilDasRespostas } from './brandbook-formulario';
import { LivroDaMarca } from './LivroDaMarca';

const PASSOS = ['Origem', '7 perguntas', 'Pacote', 'Assinatura', 'Prévia e aprovação'];
const campoCls = 'w-full min-w-0 border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-brand-dim disabled:opacity-50';
const botaoCls = 'inline-flex min-h-11 items-center justify-center gap-2 border border-border px-3 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';
type Props = {
  documento: BrandbookDocumento;
  ocupado: boolean;
  operacao: string | null;
  alterado: boolean;
  versao: number | null;
  previa: BrandbookPrevia | null;
  aprovado: boolean;
  conflito: boolean;
  erro: string | null;
  avisosDaColeta: string[];
  coletaPendente: BrandbookColeta | null;
  onAplicarColeta: () => void;
  onDescartarColeta: () => void;
  onAlterar: (d: BrandbookDocumento) => void;
  onColetar: (url: string) => Promise<void>;
  onSalvar: () => Promise<void>;
  onPrevia: () => Promise<void>;
  onAtivar: () => Promise<void>;
  onAprovar: (v: boolean) => void;
  onAtualizarVersao: () => Promise<void>;
  onFechar: () => void;
};

export function CriadorDoBrandbook(p: Props) {
  const [passo, setPasso] = useState(0);
  const [lendoArquivo, setLendoArquivo] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [notaLocal, setNotaLocal] = useState<string | null>(null);
  const [arquivoPendente, setArquivoPendente] = useState<Awaited<ReturnType<typeof lerDocumentoLocal>> | null>(null);
  const leitura = useRef(0);
  const montado = useRef(true);
  const revisao = useRef(0);
  const documentoAtual = useRef(p.documento);
  if (documentoAtual.current !== p.documento) { documentoAtual.current = p.documento; revisao.current++; }
  useEffect(() => { montado.current = true; return () => { montado.current = false; leitura.current++; }; }, []);
  const d = p.documento;
  const ocupado = p.ocupado || lendoArquivo;
  const alterar = (novo: BrandbookDocumento) => { setErroLocal(null); setNotaLocal(null); p.onAlterar(novo); };
  async function ler(arquivo: File, logo = false) {
    const id = ++leitura.current;
    const versaoLocal = revisao.current;
    setErroLocal(null); setNotaLocal(null); setLendoArquivo(true);
    try {
      const resultado = logo ? await normalizarLogo(arquivo) : await lerDocumentoLocal(arquivo);
      if (!montado.current || leitura.current !== id || revisao.current !== versaoLocal) return;
      if (typeof resultado === 'string') {
        alterar({ ...d, origem: { ...d.origem, tipo: d.origem.tipo === 'do_zero' ? 'logo' : d.origem.tipo, arquivoNome: arquivo.name }, visual: { ...d.visual, logoDataUrl: resultado } });
        setNotaLocal('Logo reduzido localmente. Nenhum arquivo foi enviado; ele será guardado com o rascunho ao salvar.');
      } else {
        setArquivoPendente(resultado);
        setNotaLocal('Arquivo lido. Confira a substituição abaixo antes de aplicar ao rascunho.');
      }
    } catch (e) {
      if (montado.current && leitura.current === id) setErroLocal((e as Error).message);
    } finally {
      if (montado.current && leitura.current === id) setLendoArquivo(false);
    }
  }
  const perguntas: Array<{ chave: keyof BrandbookDocumento['respostas']; titulo: string; dica: string }> = [
    { chave: 'posicionamento', titulo: '1. Como a empresa quer ser reconhecida?', dica: 'Descreva o posicionamento.' },
    { chave: 'clienteIdeal', titulo: '2. Quem é o cliente ideal?', dica: 'Quem compra e em qual situação.' },
    { chave: 'dor', titulo: '3. Qual problema esse cliente enfrenta?', dica: 'A dor que a empresa atende.' },
    { chave: 'desejo', titulo: '4. Qual resultado ele procura?', dica: 'O que quer alcançar.' },
    { chave: 'diferencialPromessa', titulo: '5. Qual é o diferencial e a promessa?', dica: 'Inclua somente o que a empresa pode sustentar.' },
    { chave: 'tomDeVoz', titulo: '6. Como a marca fala?', dica: 'Tom e limites da comunicação.' },
    { chave: 'corPrimaria', titulo: '7. Qual é a cor principal?', dica: 'Código hexadecimal; ele também define a cor primária da paleta.' },
  ];
  const pronta = !!p.previa && !p.alterado && p.previa.versao === p.versao && p.previa.pendencias.length === 0 && !p.conflito;
  return <section className="border border-brand-dim bg-surface" aria-labelledby="criador-brandbook">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
      <div><p className="font-os-mono text-[10px] uppercase tracking-wider text-muted">Criar a identidade</p><h2 id="criador-brandbook" className="mt-1 text-lg font-semibold">Criador do brandbook</h2><p className="mt-1 text-sm text-muted">Preencha, confira a amostra e aprove a versão salva.</p></div>
      <button type="button" onClick={p.onFechar} disabled={ocupado} className={botaoCls}><X size={16} /> Fechar</button>
    </div>
    <nav className="flex flex-wrap gap-2 border-b border-border p-4" aria-label="Etapas do brandbook">
      {PASSOS.map((nome, i) => <button key={nome} type="button" disabled={ocupado} aria-current={passo === i ? 'step' : undefined} onClick={() => setPasso(i)} className={`${botaoCls} ${passo === i ? 'border-brand-dim text-brand' : 'text-muted'}`}><span className="font-os-mono text-xs">{i + 1}</span>{nome}</button>)}
    </nav>
    {(p.erro || erroLocal) && <p role="alert" className="m-4 border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erroLocal || p.erro}</p>}
    {notaLocal && <p role="status" className="m-4 text-sm text-muted">{notaLocal}</p>}
    {p.conflito && <div role="alert" className="m-4 space-y-2 border border-warn/40 bg-warn/10 p-3 text-sm"><p>Outra versão foi salva. Seu rascunho continua neste formulário. Atualize a versão de destino antes de salvar novamente e confira o livro atual abaixo.</p><button type="button" disabled={ocupado} onClick={() => void p.onAtualizarVersao()} className={botaoCls}>Atualizar versão sem descartar meu texto</button></div>}
    {arquivoPendente && <section className="m-4 space-y-3 border border-border p-4" aria-label="Importação de documento"><h3 className="font-medium">Conferir documento antes de importar</h3><p className="text-sm">{arquivoPendente.nome}</p><p className="text-sm text-muted">{arquivoPendente.documento ? 'O JSON substituirá todos os campos deste rascunho local. O livro salvo e a versão ativa só mudam quando você salvar e aprovar.' : 'O texto substituirá a referência de origem. Os demais campos do rascunho serão preservados.'}</p><div className="flex gap-2"><button type="button" disabled={ocupado} className={botaoCls} onClick={() => {
      const r = arquivoPendente;
      alterar(r.documento ? { ...r.documento, origem: { ...r.documento.origem, tipo: 'documento', arquivoNome: r.nome, url: null } } : { ...d, origem: { tipo: 'documento', arquivoNome: r.nome, url: null, texto: r.texto ?? '' } });
      setArquivoPendente(null); setNotaLocal('Documento aplicado ao rascunho local. Salve para conservar esta versão.');
    }}>Importar para o rascunho</button><button type="button" disabled={ocupado} className={botaoCls} onClick={() => setArquivoPendente(null)}>Cancelar importação</button></div></section>}
    {p.coletaPendente && <section className="m-4 space-y-3 border border-border p-4" aria-label="Proposta do site"><h3 className="font-medium">Conferir coleta antes de usar</h3><p className="text-sm">{p.coletaPendente.titulo || 'Página sem título'} · {p.coletaPendente.cores.length} cores · {p.coletaPendente.fontes.length} fontes</p><p className="text-sm text-muted">O nome, a descrição, as cores e as fontes já preenchidos serão preservados. Novas cores e fontes entram como propostas, até o limite do formulário. O texto de referência será substituído pelo texto desta página.</p><p className="max-h-40 overflow-auto whitespace-pre-wrap text-sm">{p.coletaPendente.texto.slice(0, 2000)}</p><div className="flex gap-2"><button type="button" disabled={ocupado} onClick={p.onAplicarColeta} className={botaoCls}>Usar coleta no rascunho</button><button type="button" disabled={ocupado} onClick={p.onDescartarColeta} className={botaoCls}>Descartar coleta</button></div></section>}
    <fieldset disabled={ocupado} className="min-w-0 space-y-5 p-5 disabled:opacity-70">
      <legend className="sr-only">{PASSOS[passo]}</legend>
      {passo === 0 && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
          ['do_zero', 'Do zero', <Plus key="zero" size={18} />], ['site', 'Site', <Globe key="site" size={18} />],
          ['documento', 'Documento', <FileText key="doc" size={18} />], ['logo', 'Logo', <ImagePlus key="logo" size={18} />],
        ] as const).map(([tipo, nome, icone]) => <button key={tipo} type="button" aria-pressed={d.origem.tipo === tipo} onClick={() => alterar({ ...d, origem: { ...d.origem, tipo, url: tipo === 'site' ? d.origem.url : null } })} className={`${botaoCls} min-h-20 ${d.origem.tipo === tipo ? 'border-brand-dim text-brand' : ''}`}>{icone}{nome}</button>)}</div>
        {d.origem.tipo === 'site' && <div className="space-y-3"><Campo titulo="URL do site" valor={d.origem.url || ''} max={2048} onChange={(url) => alterar({ ...d, origem: { ...d.origem, url: url || null } })} tipo="url" /><button type="button" disabled={!d.origem.url} onClick={() => void p.onColetar(d.origem.url!)} className={botaoCls}><Globe size={16} /> Coletar site</button><p className="text-xs text-muted">A coleta traz o que o site expõe. Confira os textos, cores e fontes; as sete respostas continuam sob sua revisão.</p>{p.avisosDaColeta.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-warn">{p.avisosDaColeta.map((a, i) => <li key={i}>{a}</li>)}</ul>}</div>}
        {d.origem.tipo === 'documento' && <div className="space-y-3"><label className="block text-sm">Documento TXT, MD ou brandbook JSON<input type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" className="mt-2 block w-full text-sm" onChange={(e) => { const arquivo = e.target.files?.[0]; e.target.value = ''; if (arquivo) void ler(arquivo); }} /></label><p className="text-xs text-muted">Leitura local, até 64 KB. TXT e MD entram como referência de até 16 mil caracteres. JSON importa os campos do livro. Para PDF, copie o texto; esta ferramenta não extrai PDF.</p>{d.origem.arquivoNome && <p className="text-xs text-muted">Arquivo: {d.origem.arquivoNome}</p>}</div>}
        {d.origem.tipo === 'logo' && <div className="space-y-3"><UploadLogo onArquivo={(arquivo) => void ler(arquivo, true)} /><p className="text-xs text-muted">O logo fica como referência visual. Cores, fontes e respostas são preenchidas no formulário.</p></div>}
        <Campo titulo="Texto de referência" valor={d.origem.texto} max={16000} linhas={7} onChange={(texto) => alterar({ ...d, origem: { ...d.origem, texto } })} />
      </>}
      {passo === 1 && <div className="space-y-5">{perguntas.map((pergunta) => <div key={pergunta.chave}><Campo titulo={pergunta.titulo} valor={d.respostas[pergunta.chave]} max={pergunta.chave === 'corPrimaria' ? 7 : 2000} linhas={pergunta.chave === 'corPrimaria' ? undefined : 3} onChange={(valor) => {
        const visual = pergunta.chave === 'corPrimaria' ? { ...d.visual, cores: d.visual.cores.some((c) => /^(prim[aá]ria|primary|principal)$/i.test(c.papel.trim())) ? d.visual.cores.map((c) => /^(prim[aá]ria|primary|principal)$/i.test(c.papel.trim()) ? { ...c, hex: valor } : c) : [...d.visual.cores, { papel: 'Primária', hex: valor }] } : d.visual;
        alterar({ ...d, respostas: { ...d.respostas, [pergunta.chave]: valor }, visual });
      }} /><p className="mt-1 text-xs text-muted">{pergunta.dica}</p></div>)}</div>}
      {passo === 2 && <>
        <Grupo titulo="Identidade"><div className="grid gap-4 sm:grid-cols-2"><Campo titulo="Nome da marca" valor={d.identidade.nome} max={200} onChange={(nome) => alterar({ ...d, identidade: { ...d.identidade, nome } })} /><Campo titulo="Nicho" valor={d.identidade.nicho} max={400} onChange={(nicho) => alterar({ ...d, identidade: { ...d.identidade, nicho } })} /><Campo titulo="Handle" valor={d.identidade.handle} max={120} onChange={(handle) => alterar({ ...d, identidade: { ...d.identidade, handle } })} /><Campo titulo="Assinatura" valor={d.identidade.assinatura} max={400} onChange={(assinatura) => alterar({ ...d, identidade: { ...d.identidade, assinatura } })} /></div><Campo titulo="Descrição da empresa" valor={d.identidade.descricao} max={2000} linhas={3} onChange={(descricao) => alterar({ ...d, identidade: { ...d.identidade, descricao } })} /></Grupo>
        <Grupo titulo="Voz"><Campo titulo="Descrição da voz" valor={d.voz.descricao} max={2000} linhas={3} onChange={(descricao) => alterar({ ...d, voz: { ...d.voz, descricao } })} /><div className="grid gap-4 sm:grid-cols-2"><ListaDePalavras titulo="Palavras que entram (uma por linha)" valores={d.voz.permitidas} onChange={(permitidas) => alterar({ ...d, voz: { ...d.voz, permitidas } })} /><ListaDePalavras titulo="Palavras a evitar (uma por linha)" valores={d.voz.evitar} onChange={(evitar) => alterar({ ...d, voz: { ...d.voz, evitar } })} /></div>{d.voz.eixos.map((e, i) => <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_100px_auto]"><Campo titulo="De" valor={e.de} max={100} onChange={(de) => alterar({ ...d, voz: { ...d.voz, eixos: d.voz.eixos.map((v, n) => n === i ? { ...v, de } : v) } })} /><Campo titulo="Para" valor={e.para} max={100} onChange={(para) => alterar({ ...d, voz: { ...d.voz, eixos: d.voz.eixos.map((v, n) => n === i ? { ...v, para } : v) } })} /><label className="block text-sm">Valor 0–100<input type="number" min={0} max={100} value={e.valor ?? ''} className={`${campoCls} mt-1`} onChange={(evento) => alterar({ ...d, voz: { ...d.voz, eixos: d.voz.eixos.map((v, n) => n === i ? { ...v, valor: evento.target.value === '' ? null : Number(evento.target.value) } : v) } })} /></label><Remover rotulo="Remover eixo" onClick={() => alterar({ ...d, voz: { ...d.voz, eixos: d.voz.eixos.filter((_, n) => n !== i) } })} /></div>)}<Adicionar disabled={d.voz.eixos.length >= 12} rotulo="Adicionar eixo" onClick={() => alterar({ ...d, voz: { ...d.voz, eixos: [...d.voz.eixos, { de: '', para: '', valor: null }] } })} /></Grupo>
        <Grupo titulo="Personas">{d.personas.map((v, i) => <div key={i} className="space-y-3 border border-border p-3"><Campo titulo="Nome da persona" valor={v.nome} max={100} onChange={(nome) => alterar({ ...d, personas: d.personas.map((p, n) => n === i ? { ...p, nome } : p) })} /><Campo titulo="Descrição da persona" valor={v.descricao} max={1200} linhas={3} onChange={(descricao) => alterar({ ...d, personas: d.personas.map((p, n) => n === i ? { ...p, descricao } : p) })} /><Remover rotulo="Remover persona" onClick={() => alterar({ ...d, personas: d.personas.filter((_, n) => n !== i) })} /></div>)}<Adicionar disabled={d.personas.length >= 8} rotulo="Adicionar persona" onClick={() => alterar({ ...d, personas: [...d.personas, { nome: '', descricao: '' }] })} /></Grupo>
        <Grupo titulo="Pilares de conteúdo">{d.pilares.map((v, i) => <div key={i} className="space-y-3 border border-border p-3"><div className="grid gap-3 sm:grid-cols-2"><Campo titulo="Nome do pilar" valor={v.nome} max={40} onChange={(nome) => alterar({ ...d, pilares: d.pilares.map((p, n) => n === i ? { ...p, nome } : p) })} /><Campo titulo="Cor do pilar" valor={v.cor} max={7} onChange={(cor) => alterar({ ...d, pilares: d.pilares.map((p, n) => n === i ? { ...p, cor } : p) })} /></div><Campo titulo="Descrição do pilar" valor={v.descricao} max={240} linhas={2} onChange={(descricao) => alterar({ ...d, pilares: d.pilares.map((p, n) => n === i ? { ...p, descricao } : p) })} /><Remover rotulo="Remover pilar" onClick={() => alterar({ ...d, pilares: d.pilares.filter((_, n) => n !== i) })} /></div>)}<Adicionar disabled={d.pilares.length >= 8} rotulo="Adicionar pilar" onClick={() => alterar({ ...d, pilares: [...d.pilares, { nome: '', cor: '', descricao: '' }] })} /></Grupo>
        <Grupo titulo="Modelos de peça">{d.modelos.map((v, i) => <div key={i} className="space-y-3 border border-border p-3"><Campo titulo="Nome do modelo" valor={v.nome} max={100} onChange={(nome) => alterar({ ...d, modelos: d.modelos.map((p, n) => n === i ? { ...p, nome } : p) })} /><Campo titulo="Estrutura e orientações" valor={v.estrutura} max={2000} linhas={4} onChange={(estrutura) => alterar({ ...d, modelos: d.modelos.map((p, n) => n === i ? { ...p, estrutura } : p) })} /><Remover rotulo="Remover modelo" onClick={() => alterar({ ...d, modelos: d.modelos.filter((_, n) => n !== i) })} /></div>)}<Adicionar disabled={d.modelos.length >= 12} rotulo="Adicionar modelo" onClick={() => alterar({ ...d, modelos: [...d.modelos, { nome: '', estrutura: '' }] })} /></Grupo>
        <Grupo titulo="Perfil para a Pauta"><Campo titulo="Texto que a Pauta receberá quando o livro estiver ativo" valor={d.perfilParaPauta} max={4000} linhas={10} onChange={(perfilParaPauta) => alterar({ ...d, perfilParaPauta })} /><button type="button" className={botaoCls} onClick={() => {
          const perfil = perfilDasRespostas(d);
          if (perfil.length > 4000) { setErroLocal('O perfil montado passa de 4 mil caracteres. Reduza os textos ou escreva um perfil curto no campo.'); return; }
          alterar({ ...d, perfilParaPauta: perfil }); setNotaLocal('Perfil montado com os campos preenchidos. Revise o texto antes de aprovar.');
        }}>Montar com minhas respostas</button><p className="text-xs text-muted">{d.perfilParaPauta.length} / 4.000 caracteres. Os pilares têm campos separados acima.</p></Grupo>
      </>}
      {passo === 3 && <>
        <Grupo titulo="Paleta"><p className="text-xs text-muted">Inclua Primária, Fundo e Texto. A ativação confere a cor principal e o contraste entre fundo e texto.</p>{d.visual.cores.map((v, i) => <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"><Campo titulo="Papel da cor" valor={v.papel} max={60} onChange={(papel) => alterar({ ...d, visual: { ...d.visual, cores: d.visual.cores.map((p, n) => n === i ? { ...p, papel } : p) } })} /><Campo titulo="Hexadecimal" valor={v.hex} max={7} onChange={(hex) => alterar({ ...d, visual: { ...d.visual, cores: d.visual.cores.map((p, n) => n === i ? { ...p, hex } : p) } })} /><Remover rotulo="Remover cor" onClick={() => alterar({ ...d, visual: { ...d.visual, cores: d.visual.cores.filter((_, n) => n !== i) } })} /></div>)}<Adicionar disabled={d.visual.cores.length >= 16} rotulo="Adicionar cor" onClick={() => alterar({ ...d, visual: { ...d.visual, cores: [...d.visual.cores, { papel: '', hex: '' }] } })} /></Grupo>
        <Grupo titulo="Tipografia"><p className="text-xs text-muted">Defina fontes de Título e Corpo. A ferramenta registra os nomes; não baixa fontes externas.</p>{d.visual.fontes.map((v, i) => <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"><Campo titulo="Uso da fonte" valor={v.papel} max={60} onChange={(papel) => alterar({ ...d, visual: { ...d.visual, fontes: d.visual.fontes.map((p, n) => n === i ? { ...p, papel } : p) } })} /><Campo titulo="Família" valor={v.familia} max={120} onChange={(familia) => alterar({ ...d, visual: { ...d.visual, fontes: d.visual.fontes.map((p, n) => n === i ? { ...p, familia } : p) } })} /><Remover rotulo="Remover fonte" onClick={() => alterar({ ...d, visual: { ...d.visual, fontes: d.visual.fontes.filter((_, n) => n !== i) } })} /></div>)}<Adicionar disabled={d.visual.fontes.length >= 8} rotulo="Adicionar fonte" onClick={() => alterar({ ...d, visual: { ...d.visual, fontes: [...d.visual.fontes, { papel: '', familia: '' }] } })} /></Grupo>
        <Grupo titulo="Logo"><UploadLogo onArquivo={(arquivo) => void ler(arquivo, true)} />{d.visual.logoDataUrl && <><img src={d.visual.logoDataUrl} alt="Logo no rascunho" className="max-h-28 max-w-full object-contain" /><button type="button" className={botaoCls} onClick={() => alterar({ ...d, visual: { ...d.visual, logoDataUrl: null } })}>Remover logo</button></>}</Grupo>
        <Campo titulo="Regras de uso, contraste e composição" valor={d.visual.regras} max={4000} linhas={4} onChange={(regras) => alterar({ ...d, visual: { ...d.visual, regras } })} />
        <Campo titulo="Texturas e fundos" valor={d.visual.texturas} max={2000} linhas={3} onChange={(texturas) => alterar({ ...d, visual: { ...d.visual, texturas } })} />
        <Campo titulo="Tratamento de capas" valor={d.visual.capas} max={2000} linhas={3} onChange={(capas) => alterar({ ...d, visual: { ...d.visual, capas } })} />
      </>}
      {passo === 4 && <>
        <div className="space-y-3 border border-border p-4"><p className="text-sm">{p.alterado ? 'Há alterações locais. Salve o rascunho para pedir a prévia desta versão.' : p.versao ? `Rascunho salvo na versão ${p.versao}.` : 'Salve o rascunho antes de conferir a prévia.'}</p><button type="button" disabled={p.alterado || !p.versao || p.conflito} onClick={() => void p.onPrevia()} className={botaoCls}>Conferir prévia salva</button></div>
        {p.previa && <div className="space-y-3"><p className="break-all font-os-mono text-xs text-muted">Versão {p.previa.versao} · sha256:{p.previa.draftHash}</p>{p.previa.pendencias.length ? <div role="status" className="border border-warn/40 bg-warn/10 p-4"><p className="text-sm font-medium">Falta ajustar antes de ativar</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{p.previa.pendencias.map((v, i) => <li key={i}>{v}</li>)}</ul></div> : <p role="status" className="text-sm text-good">A prévia salva está sem pendências.</p>}</div>}
        <LivroDaMarca documento={p.previa?.documento ?? d} origem={p.previa ? 'Prévia salva para aprovação' : 'Rascunho local — ainda não aprovado'} versao={p.previa?.versao} hash={p.previa?.draftHash} />
        <label className="flex items-start gap-3 border border-border p-4 text-sm"><input type="checkbox" checked={p.aprovado} disabled={!pronta} onChange={(e) => p.onAprovar(e.target.checked)} className="mt-1" /><span>Conferi o livro e a amostra. Aprovo esta versão para uso na Pauta.</span></label>
        <button type="button" disabled={!pronta || !p.aprovado} onClick={() => void p.onAtivar()} className={`${botaoCls} border-brand-dim bg-brand text-bg hover:bg-brand/90`}><Check size={16} /> Aprovar e ativar esta versão</button>
      </>}
    </fieldset>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
      <div className="flex flex-wrap gap-2"><button type="button" disabled={ocupado || passo === 0} onClick={() => setPasso((v) => v - 1)} className={botaoCls}><ArrowLeft size={15} /> Voltar</button><button type="button" disabled={ocupado || passo === 4} onClick={() => setPasso((v) => v + 1)} className={botaoCls}>Seguir <ArrowRight size={15} /></button></div>
      <div className="flex flex-wrap items-center gap-3"><span aria-live="polite" className="text-xs text-muted">{p.operacao || (p.alterado ? 'Alterações locais' : p.versao ? `Salvo · v${p.versao}` : 'Ainda não salvo')}</span><button type="button" disabled={ocupado || p.conflito} onClick={() => void p.onSalvar()} className={`${botaoCls} border-brand-dim text-brand`}><Save size={15} /> Salvar rascunho</button></div>
    </footer>
  </section>;
}

function Campo({ titulo, valor, max, linhas: quantidade, onChange, tipo = 'text' }: { titulo: string; valor: string; max: number; linhas?: number; onChange: (v: string) => void; tipo?: string }) {
  return <label className="block space-y-1 text-sm"><span>{titulo}</span>{quantidade ? <textarea value={valor} maxLength={max} rows={quantidade} onChange={(e) => onChange(e.target.value)} className={campoCls} /> : <input type={tipo} value={valor} maxLength={max} onChange={(e) => onChange(e.target.value)} className={campoCls} />}</label>;
}
function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <section className="space-y-4 border-b border-border pb-5"><h3 className="font-os-mono text-xs font-semibold uppercase tracking-wider text-muted">{titulo}</h3>{children}</section>;
}
function Adicionar({ rotulo, onClick, disabled }: { rotulo: string; onClick: () => void; disabled: boolean }) { return <button type="button" disabled={disabled} onClick={onClick} className={botaoCls}><Plus size={15} />{rotulo}</button>; }
function Remover({ rotulo, onClick }: { rotulo: string; onClick: () => void }) { return <button type="button" onClick={onClick} aria-label={rotulo} className={botaoCls}><Trash2 size={15} /><span className="sm:sr-only">{rotulo}</span></button>; }
function UploadLogo({ onArquivo }: { onArquivo: (arquivo: File) => void }) {
  return <label className="block space-y-2 text-sm"><span>Logo PNG, JPG ou WebP</span><input type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm" onChange={(e) => { const arquivo = e.target.files?.[0]; e.target.value = ''; if (arquivo) onArquivo(arquivo); }} /><span className="block text-xs text-muted">Entrada até 5 MB; imagem normalizada localmente para até 24 KB.</span></label>;
}
function ListaDePalavras({ titulo, valores, onChange }: { titulo: string; valores: string[]; onChange: (v: string[]) => void }) {
  const [texto, setTexto] = useState(valores.join('\n'));
  const atual = useRef(texto); atual.current = texto;
  const canonicamente = valores.join('\n');
  useEffect(() => { if (linhas(atual.current).join('\n') !== canonicamente) setTexto(canonicamente); }, [canonicamente]);
  return <label className="block space-y-1 text-sm"><span>{titulo}</span><textarea value={texto} maxLength={20000} rows={5} className={campoCls} onChange={(e) => { setTexto(e.target.value); onChange(linhas(e.target.value)); }} /><span className="text-xs text-muted">Até 40 entradas de 500 caracteres cada.</span></label>;
}
