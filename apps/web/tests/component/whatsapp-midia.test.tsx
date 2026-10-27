/*
 * Layout 27/10 (Lucas: "não consigo nem abrir, nem enviar documentos pelo wpp do OS").
 * O ARQUIVO NA CAIXA DE WHATSAPP: a foto aparece no balão (pedida à API com o
 * token), o documento mostra nome e "Abrir", o áudio toca, e o clipe escolhe o
 * arquivo, mostra a prévia, tira com o "x" e manda em multipart com a legenda.
 * Dados todos fictícios.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversaAberta, ConversaDaCaixa, ListaDaCaixa, MensagemDaCaixa } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const blobs: string[] = [];
const formularios: { caminho: string; form: FormData }[] = [];
const posts: { caminho: string; corpo: unknown }[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/components/whatsapp/VinculoDaConversa', () => ({ VinculoDaConversa: () => <span data-testid="whats-vinculo" /> }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  const achar = (chave: string) => {
    const r = RESPOSTAS[chave];
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => achar(caminho.split('?')[0])),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return achar(`POST ${caminho}`) ?? {};
    }),
    apiBlob: vi.fn(async (caminho: string) => {
      blobs.push(caminho);
      return achar(`BLOB ${caminho}`) ?? new Blob(['x'], { type: 'application/octet-stream' });
    }),
    apiFormulario: vi.fn(async (caminho: string, form: FormData) => {
      formularios.push({ caminho, form });
      return achar(`FORM ${caminho}`);
    }),
  };
});

import { ErroDaApi } from '@/lib/api';
import CaixaPage from '@/app/whatsapp/page';

const AGORA = new Date().toISOString();

const C1: ConversaDaCaixa = {
  id: 'c1',
  grupo: false,
  nome: 'Lead Ficticio',
  numero: '5500000000001',
  fotoUrl: null,
  participantes: null,
  equipe: false,
  comunidade: false,
  ultimaMensagemEm: AGORA,
  previa: null,
  naoLidas: 0,
  vinculo: null,
  sugestao: null,
  arquivada: false,
};

function msg(id: string, extra: Partial<MensagemDaCaixa> = {}): MensagemDaCaixa {
  return {
    id,
    mensagemExternaId: `ext-${id}`,
    deMim: false,
    tipo: 'conversation',
    texto: null,
    midia: null,
    remetenteNome: null,
    remetenteNumero: null,
    timestamp: AGORA,
    cita: null,
    enviadaPor: null,
    lida: true,
    ...extra,
  };
}

const LISTA: ListaDaCaixa = {
  conversas: [C1],
  contagens: { todas: 1, leads: 0, clientes: 0, grupos: 0, sem_vinculo: 1, equipe: 0, comunidade: 0, arquivadas: 0 },
  podeResponder: true,
  podeVincular: true,
  mais: false,
};

function abrirCom(mensagens: MensagemDaCaixa[]) {
  const a: ConversaAberta = { conversa: C1, mensagens, maisAntigas: false, participantes: [], podeResponder: true, podeVincular: true };
  RESPOSTAS['/whatsapp/conversas'] = LISTA;
  RESPOSTAS['/whatsapp/conversas/c1'] = a;
  RESPOSTAS['POST /whatsapp/conversas/c1/lida'] = { lidas: 0 };
  window.history.replaceState(null, '', '/whatsapp?conversa=c1');
}

const criadas: string[] = [];
beforeEach(() => {
  RESPOSTAS = {};
  blobs.length = 0;
  formularios.length = 0;
  posts.length = 0;
  criadas.length = 0;
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    n += 1;
    const u = `blob:teste/${n}`;
    criadas.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('arquivo na caixa: abrir o que chegou', () => {
  it('foto: pede o arquivo da mensagem à API e mostra a miniatura; clicar abre grande com Baixar', async () => {
    abrirCom([msg('f1', { tipo: 'image', texto: 'olha a foto', midia: { mime: 'image/jpeg', nome: null, tamanho: 2048, segundos: null } })]);
    RESPOSTAS['BLOB /whatsapp/mensagens/f1/midia'] = new Blob(['jpeg'], { type: 'image/jpeg' });
    const u = userEvent.setup();
    render(<CaixaPage />);
    const cartao = await screen.findByTestId('caixa-midia-f1');
    const img = await within(cartao).findByRole('img');
    expect(blobs).toEqual(['/whatsapp/mensagens/f1/midia']);
    expect(img).toHaveAttribute('src', 'blob:teste/1');
    expect(img).toHaveAttribute('alt', 'olha a foto');
    await u.click(within(cartao).getByRole('button', { name: 'Abrir foto grande' }));
    const grande = await screen.findByTestId('caixa-foto-grande');
    expect(within(grande).getByRole('button', { name: 'Baixar' })).toBeInTheDocument();
    await u.click(within(grande).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByTestId('caixa-foto-grande')).toBeNull();
    // Pediu uma vez só (o clique usa o que já veio).
    expect(blobs).toHaveLength(1);
  });

  it('documento: mostra nome, tamanho e Abrir sem baixar nada; Abrir pede o arquivo e o põe na aba nova', async () => {
    abrirCom([msg('d1', { tipo: 'document', midia: { mime: 'application/pdf', nome: 'proposta-ficticia.pdf', tamanho: 1536, segundos: null } })]);
    RESPOSTAS['BLOB /whatsapp/mensagens/d1/midia'] = new Blob(['%PDF'], { type: 'application/pdf' });
    const aba = { location: { href: '' }, close: vi.fn() };
    const abrir = vi.spyOn(window, 'open').mockReturnValue(aba as unknown as Window);
    const u = userEvent.setup();
    render(<CaixaPage />);
    expect(await screen.findByTestId('caixa-midia-nome-d1')).toHaveTextContent('proposta-ficticia.pdf');
    expect(screen.getByTestId('caixa-midia-d1')).toHaveTextContent('2 KB · PDF');
    expect(blobs).toEqual([]);
    await u.click(screen.getByTestId('caixa-midia-abrir-d1'));
    await waitFor(() => expect(aba.location.href).toBe('blob:teste/1'));
    expect(abrir).toHaveBeenCalledWith('', '_blank');
    expect(blobs).toEqual(['/whatsapp/mensagens/d1/midia']);
  });

  it('a frase da API aparece quando o WhatsApp não guarda mais o arquivo, e a aba aberta fecha', async () => {
    abrirCom([msg('d2', { tipo: 'document', midia: { mime: 'application/pdf', nome: 'velho.pdf', tamanho: 10, segundos: null } })]);
    RESPOSTAS['BLOB /whatsapp/mensagens/d2/midia'] = new ErroDaApi('O WhatsApp não guarda mais esse arquivo. Peça para mandarem de novo.', 410);
    const aba = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(aba as unknown as Window);
    const u = userEvent.setup();
    render(<CaixaPage />);
    await u.click(await screen.findByTestId('caixa-midia-abrir-d2'));
    expect(await screen.findByText(/O WhatsApp não guarda mais esse arquivo/)).toBeInTheDocument();
    expect(aba.close).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('áudio: o tocador com o arquivo; vídeo só carrega no Assistir', async () => {
    abrirCom([
      msg('a1', { tipo: 'audio', midia: { mime: 'audio/ogg', nome: null, tamanho: 4000, segundos: 42 } }),
      msg('v1', { tipo: 'video', midia: { mime: 'video/mp4', nome: null, tamanho: 900000, segundos: 12 } }),
    ]);
    const u = userEvent.setup();
    render(<CaixaPage />);
    const audio = await screen.findByTestId('caixa-midia-a1');
    await waitFor(() => expect(audio.querySelector('audio')).toHaveAttribute('src', 'blob:teste/1'));
    expect(blobs).toEqual(['/whatsapp/mensagens/a1/midia']);
    await u.click(screen.getByTestId('caixa-midia-assistir-v1'));
    await waitFor(() => expect(screen.getByTestId('caixa-midia-v1').querySelector('video')).not.toBeNull());
    expect(blobs).toEqual(['/whatsapp/mensagens/a1/midia', '/whatsapp/mensagens/v1/midia']);
  });
});

describe('arquivo na caixa: mandar pelo clipe', () => {
  it('escolher → prévia com nome e miniatura → Enviar manda multipart com a legenda; o balão entra', async () => {
    abrirCom([]);
    const enviada = msg('n1', { deMim: true, tipo: 'image', texto: 'segue', midia: { mime: 'image/png', nome: 'print.png', tamanho: 5, segundos: null }, enviadaPor: { id: 'eu', nome: 'Eu' } });
    RESPOSTAS['FORM /whatsapp/conversas/c1/midia'] = { mensagem: enviada };
    const u = userEvent.setup();
    render(<CaixaPage />);
    const caixa = await screen.findByTestId('caixa-resposta');
    expect(screen.getByTestId('caixa-enviar')).toBeDisabled();
    const arquivo = new File(['12345'], 'print.png', { type: 'image/png' });
    await u.upload(screen.getByTestId('caixa-anexo-input'), arquivo);
    expect(screen.getByTestId('caixa-anexo-nome')).toHaveTextContent('print.png');
    expect(screen.getByTestId('caixa-anexo')).toHaveTextContent('imagem · 5 B');
    expect(screen.getByTestId('caixa-anexo-previa')).toHaveAttribute('src', 'blob:teste/1');
    expect(screen.getByTestId('caixa-aviso-envio')).toHaveTextContent('com o seu nome em negrito na legenda');
    // Com arquivo, a legenda vazia vale.
    expect(screen.getByTestId('caixa-enviar')).not.toBeDisabled();
    await u.type(caixa, 'segue');
    await u.click(screen.getByTestId('caixa-enviar'));
    await waitFor(() => expect(formularios).toHaveLength(1));
    expect(formularios[0].caminho).toBe('/whatsapp/conversas/c1/midia');
    expect((formularios[0].form.get('arquivo') as File).name).toBe('print.png');
    expect(formularios[0].form.get('legenda')).toBe('segue');
    expect(posts.some((p) => p.caminho.endsWith('/responder'))).toBe(false);
    expect(await screen.findByTestId('caixa-balao-n1')).toBeInTheDocument();
    expect(screen.queryByTestId('caixa-anexo')).toBeNull();
    expect(caixa).toHaveValue('');
  });

  it('o "x" tira o arquivo e a caixa volta a mandar texto', async () => {
    abrirCom([]);
    RESPOSTAS['POST /whatsapp/conversas/c1/responder'] = { mensagem: msg('t1', { deMim: true, texto: 'só texto' }) };
    const u = userEvent.setup();
    render(<CaixaPage />);
    const caixa = await screen.findByTestId('caixa-resposta');
    await u.upload(screen.getByTestId('caixa-anexo-input'), new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' }));
    expect(screen.getByTestId('caixa-anexo')).toHaveTextContent('contrato.pdf');
    await u.click(screen.getByTestId('caixa-anexo-tirar'));
    expect(screen.queryByTestId('caixa-anexo')).toBeNull();
    expect(screen.getByTestId('caixa-enviar')).toBeDisabled();
    await u.type(caixa, 'só texto{Enter}');
    await waitFor(() => expect(posts.find((p) => p.caminho === '/whatsapp/conversas/c1/responder')?.corpo).toEqual({ texto: 'só texto' }));
    expect(formularios).toHaveLength(0);
  });

  it('foto acima de 16 MB é recusada na tela com a frase do WhatsApp', async () => {
    abrirCom([]);
    const u = userEvent.setup();
    render(<CaixaPage />);
    await screen.findByTestId('caixa-resposta');
    const grande = new File(['x'], 'grande.jpg', { type: 'image/jpeg' });
    Object.defineProperty(grande, 'size', { value: 17 * 1024 * 1024 });
    await u.upload(screen.getByTestId('caixa-anexo-input'), grande);
    expect(screen.getByTestId('caixa-anexo-erro')).toHaveTextContent('Foto acima de 16 MB: o WhatsApp não aceita.');
    expect(screen.queryByTestId('caixa-anexo')).toBeNull();
  });

  it('colar uma imagem na caixa de texto a deixa pronta para mandar', async () => {
    abrirCom([]);
    render(<CaixaPage />);
    const caixa = await screen.findByTestId('caixa-resposta');
    const print = new File(['png'], 'image.png', { type: 'image/png' });
    fireEvent.paste(caixa, { clipboardData: { files: [print], types: ['Files'] } });
    expect(await screen.findByTestId('caixa-anexo-nome')).toHaveTextContent('image.png');
  });

  it('áudio: o aviso diz que sai sem legenda, e o texto escrito fica na caixa depois de mandar', async () => {
    abrirCom([]);
    RESPOSTAS['FORM /whatsapp/conversas/c1/midia'] = { mensagem: msg('au', { deMim: true, tipo: 'audio', midia: { mime: 'audio/ogg', nome: 'nota.ogg', tamanho: 3, segundos: null } }) };
    const u = userEvent.setup();
    render(<CaixaPage />);
    const caixa = await screen.findByTestId('caixa-resposta');
    await u.type(caixa, 'depois');
    await u.upload(screen.getByTestId('caixa-anexo-input'), new File(['ogg'], 'nota.ogg', { type: 'audio/ogg' }));
    expect(screen.getByTestId('caixa-aviso-envio')).toHaveTextContent('mensagem de voz, sem o seu nome');
    await u.click(screen.getByTestId('caixa-enviar'));
    await waitFor(() => expect(formularios).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('caixa-anexo')).toBeNull());
    expect(caixa).toHaveValue('depois');
  });
});
