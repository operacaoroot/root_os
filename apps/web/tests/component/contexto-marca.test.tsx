import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrandbookDocumentoSchema, type BrandbookPainel, type PautaMarcaHumanoPainel } from '@mktos/shared';
import referencia from '../../../api/src/pauta/assets/brandbook-root.json';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
let token = 'sessao-a';
const pessoaId = '10000000-0000-4000-8000-000000000001';
let permissoes = ['pauta.ver', 'pauta.editar', 'obsidian.ver'];
vi.mock('@/lib/api', async (original) => ({ ...await original<object>(), apiGet: api.get, apiPut: api.put, apiPost: api.post }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token, ready: true, can: (p: string) => permissoes.includes(p), user: { id: pessoaId, permissions: permissoes } }) }));
import { ErroDaApi } from '@/lib/api';
import MarcaPage from '@/app/contexto/marca/page';

const documento = BrandbookDocumentoSchema.parse(referencia.documento);
documento.pilares = documento.pilares.map(p => ({ ...p, cor: p.cor || '#123456' }));
const referenciaDeExercicio = { ...referencia, documento };
const ausencia = (chave: string) => ({ estado: 'ausente' as const, tipo: 'nota_memoria' as const, chave, itemId: null, kind: null, arquivada: null, origem: null, versao: null, conteudo: null });
const humano: PautaMarcaHumanoPainel = {
  contrato: 1, escopo: { orgId: '20000000-0000-4000-8000-000000000001', actorId: pessoaId },
  autoridade: { ler: true, editar: true, verificadaEm: '2026-10-11T00:00:00.000Z' }, observadoEm: '2026-10-11T00:00:00.000Z',
  painel: { perfil: null, perfilVersao: null, perfilAtualizadoEm: null, pilaresTexto: '', pilaresVersao: null, pilares: [], avisos: [], bloco: '', projecoes: { perfil: null, pilares: null } },
  destinos: { perfil: ausencia('pauta.marca'), pilares: ausencia('pauta.marca.pilares') }, origemEfetiva: { tipo: 'legado', brandbook: null },
};
let livro: BrandbookPainel;
function get(url: string) {
  if (url === '/pauta/marca/brandbook') return Promise.resolve(structuredClone(livro));
  if (url === '/pauta/marca/brandbook/referencia-root') return Promise.resolve(referenciaDeExercicio);
  if (url === '/pauta/marca') return Promise.resolve(humano);
  throw new Error(`Rota inesperada: ${url}`);
}
beforeEach(() => {
  token = 'sessao-a'; permissoes = ['pauta.ver', 'pauta.editar', 'obsidian.ver'];
  livro = { id: null, versao: null, hash: null, estado: 'ausente', rascunho: null, ativo: null };
  api.get.mockReset().mockImplementation(get); api.put.mockReset().mockImplementation(async (_url, body) => {
    livro = { ...livro, id: '30000000-0000-4000-8000-000000000001', versao: (livro.versao ?? 0) + 1, hash: 'a'.repeat(64), estado: livro.ativo ? 'ativo' : 'rascunho', rascunho: structuredClone(body.documento) };
    return structuredClone(livro);
  });
  api.post.mockReset().mockImplementation(async (url) => {
    if (url.endsWith('/previa')) return { versao: livro.versao, draftHash: 'b'.repeat(64), documento: structuredClone(livro.rascunho), pendencias: [] };
    if (url.endsWith('/ativar')) { livro = { ...livro, versao: livro.versao! + 1, estado: 'ativo', ativo: { documento: structuredClone(livro.rascunho!), aprovadoPor: pessoaId, aprovadoEm: '2026-10-11T00:00:00.000Z', draftHash: 'b'.repeat(64) } }; return structuredClone(livro); }
    throw new Error(`Rota inesperada: ${url}`);
  });
});
async function usarBase() { const u = userEvent.setup(); await u.click(await screen.findByRole('button', { name: 'Usar como base' })); return u; }

describe('livro da marca no Contexto', () => {
  it('mostra referência separada e permite criar mesmo se a API legada falhar', async () => {
    api.get.mockImplementation((url) => url === '/pauta/marca' ? Promise.reject(new Error('legado indisponível')) : get(url));
    render(<MarcaPage />);
    expect(await screen.findByText('Referência ROOT')).toBeInTheDocument();
    const u = userEvent.setup(); await u.click(screen.getByRole('button', { name: 'Criar brandbook' }));
    expect(screen.getByRole('heading', { name: 'Criador do brandbook' })).toBeInTheDocument();
  });
  it('salva rascunho e reabre os mesmos campos após recarga', async () => {
    const view = render(<MarcaPage />); const u = await usarBase();
    await u.click(screen.getByRole('button', { name: /3.*Pacote/ }));
    const nome = screen.getByRole('textbox', { name: 'Nome da marca' }); await u.clear(nome); await u.type(nome, 'Empresa de exercício');
    await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    view.unmount(); render(<MarcaPage />);
    await u.click(await screen.findByRole('button', { name: 'Editar rascunho' })); await u.click(screen.getByRole('button', { name: /3.*Pacote/ }));
    expect(screen.getByRole('textbox', { name: 'Nome da marca' })).toHaveValue('Empresa de exercício');
    expect(api.put.mock.calls[0][1].versaoEsperada).toBeNull();
  });
  it('exige prévia e aprovação para ativar a versão salva', async () => {
    render(<MarcaPage />); const u = await usarBase(); await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(livro.versao).toBe(1)); await u.click(screen.getByRole('button', { name: /5.*Prévia e aprovação/ }));
    const ativar = screen.getByRole('button', { name: 'Aprovar e ativar esta versão' }); expect(ativar).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Conferir prévia salva' }));
    await screen.findByText('A prévia salva está sem pendências.');
    await u.click(screen.getByRole('checkbox', { name: /Conferi o livro/ })); await u.click(ativar);
    expect(await screen.findByText('Livro aprovado em uso na Pauta')).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/pauta/marca/brandbook/ativar', { versaoEsperada: 1, draftHash: 'b'.repeat(64), aprovacao: true }, token);
  });
  it('preserva texto e permite recuperar a versão após conflito de gravação', async () => {
    render(<MarcaPage />); const u = await usarBase();
    api.put.mockRejectedValueOnce(new ErroDaApi('Outra versão', 409));
    await u.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByText('O livro mudou enquanto você editava. Seu texto local foi preservado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Atualizar versão sem descartar meu texto' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeEnabled());
    await u.click(screen.getByRole('button', { name: /3.*Pacote/ })); expect(screen.getByRole('textbox', { name: 'Nome da marca' })).toHaveValue(documento.identidade.nome);
  });
  it('recupera erro inicial de leitura e libera o criador', async () => {
    api.get.mockRejectedValueOnce(new Error('indisponível')); // o legado também pode falhar independentemente
    let falhou = false; api.get.mockImplementation((url) => { if (url === '/pauta/marca/brandbook' && !falhou) { falhou = true; return Promise.reject(new Error('Livro temporariamente indisponível')); } return get(url); });
    render(<MarcaPage />); const u = userEvent.setup(); await u.click(await screen.findByRole('button', { name: 'Tentar carregar o livro novamente' }));
    expect(await screen.findByRole('button', { name: 'Criar brandbook' })).toBeEnabled();
  });
  it('não oferece escrita a leitor e limpa conteúdo ao perder acesso', async () => {
    permissoes = ['pauta.ver']; const view = render(<MarcaPage />); await screen.findByText('Referência ROOT');
    expect(screen.queryByRole('button', { name: 'Criar brandbook' })).not.toBeInTheDocument();
    token = 'sessao-b'; permissoes = []; view.rerender(<MarcaPage />);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Livro da marca' })).not.toBeInTheDocument());
  });
  it('coleta só entra no rascunho após confirmação explícita', async () => {
    render(<MarcaPage />); const u = await usarBase(); await u.click(screen.getByRole('button', { name: 'Site' }));
    await u.type(screen.getByRole('textbox', { name: 'URL do site' }), 'https://example.com');
    api.post.mockResolvedValueOnce({ url: 'https://example.com', titulo: 'Outra identidade', descricao: 'Outra descrição', texto: 'Texto coletado', cores: [{ papel: 'proposta', hex: '#123456' }], fontes: [], avisos: [] });
    await u.click(screen.getByRole('button', { name: 'Coletar site' }));
    const proposta = await screen.findByRole('region', { name: 'Proposta do site' }); expect(within(proposta).getByText('Texto coletado')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Texto de referência' })).not.toHaveValue('Texto coletado');
    await u.click(screen.getByRole('button', { name: 'Usar coleta no rascunho' }));
    expect(screen.getByRole('textbox', { name: 'Texto de referência' })).toHaveValue('Texto coletado');
  });
  it('mantém o rascunho até confirmar uma importação JSON', async () => {
    render(<MarcaPage />); const u = await usarBase(); await u.click(screen.getByRole('button', { name: 'Documento' }));
    const novo = { ...documento, identidade: { ...documento.identidade, nome: 'Importação de exercício' } };
    const arquivo = new File([JSON.stringify(novo)], 'marca.json', { type: 'application/json' });
    Object.defineProperty(arquivo, 'text', { value: async () => JSON.stringify(novo) });
    await u.upload(screen.getByLabelText('Documento TXT, MD ou brandbook JSON'), arquivo);
    await screen.findByRole('region', { name: 'Importação de documento' });
    await u.click(screen.getByRole('button', { name: /3.*Pacote/ }));
    expect(screen.getByRole('textbox', { name: 'Nome da marca' })).toHaveValue(documento.identidade.nome);
    await u.click(screen.getByRole('button', { name: 'Importar para o rascunho' }));
    expect(screen.getByRole('textbox', { name: 'Nome da marca' })).toHaveValue('Importação de exercício');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('repete a leitura da referência ROOT quando apenas ela falhou', async () => {
    let falhou = false;
    api.get.mockImplementation((url) => {
      if (url === '/pauta/marca/brandbook/referencia-root' && !falhou) { falhou = true; return Promise.reject(new Error('Referência indisponível')); }
      return get(url);
    });
    render(<MarcaPage />); const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Tentar carregar o livro novamente' }));
    expect(await screen.findByText('Referência ROOT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar como base' })).toBeEnabled();
  });

});
