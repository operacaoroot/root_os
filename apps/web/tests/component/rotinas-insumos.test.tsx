import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PautaFonteItem, PautaFonteList } from '@mktos/shared';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args), apiPost: vi.fn(), apiPatch: vi.fn() }));
let permissoes: string[];
let modulos: string[] | null;
let token: string;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token, ready: true, can: (p: string) => permissoes.includes(p) }) }));
vi.mock('@/components/modulos', () => ({ useModulos: () => ({ modulos, ligado: () => true }) }));
import { InsumosDaColeta } from '@/app/rotinas/InsumosDaColeta';
import RotinasPage from '@/app/rotinas/page';

function fonte(extra: Partial<PautaFonteItem> = {}): PautaFonteItem {
  return { id: 'rss', tipo: 'rss', nome: 'Feed da empresa', url: 'https://example.com/feed', handle: null,
    plataforma: null, ativo: true, intervaloMin: 720, tetoRunsMes: 0, runsNoMes: 0,
    ultimaLeitura: null, ultimoErro: null, capturas: 0, ...extra };
}
function painel(items: PautaFonteItem[] = [], apifyConfigurado = false): PautaFonteList {
  return { items, apifyConfigurado, espelho: { destino: 'off', alvo: null, disponivel: false, motivo: null },
    source: { tool: 'banco', generatedAt: '2026-09-29T12:00:00Z' } };
}
beforeEach(() => { apiGet.mockReset(); permissoes = ['pauta.ver']; modulos = ['pauta']; token = 'empresa-a'; });

async function abrirFontes() { await userEvent.click(await screen.findByText('Ver fontes e últimas leituras')); }

describe('entradas da coleta', () => {
  it.each([null, []])('não consulta fontes quando o módulo é %s', async (lista) => {
    modulos = lista;
    render(<InsumosDaColeta />);
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /Configurar fontes/ })).toBeNull();
  });
  it('não consulta nem mostra entradas sem pauta.ver', () => {
    permissoes = ['automacoes.ver'];
    render(<InsumosDaColeta />);
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByText('Entradas da coleta de conteúdo')).toBeNull();
  });
  it('consulta com o token atual somente depois de confirmar o módulo', async () => {
    modulos = null; apiGet.mockResolvedValue(painel());
    const { rerender } = render(<InsumosDaColeta />);
    expect(apiGet).not.toHaveBeenCalled();
    modulos = ['pauta']; rerender(<InsumosDaColeta />);
    expect(await screen.findByText(/Nenhuma fonte cadastrada/)).toBeVisible();
    expect(apiGet).toHaveBeenCalledExactlyOnceWith('/pauta/fontes', 'empresa-a');
    expect(screen.getByText(/Apify não configurado/)).toBeVisible();
    expect(screen.getByText(/não inclui o material automaticamente/)).toBeVisible();
    expect(screen.getByRole('link', { name: /Consultar fontes no Radar/ })).toHaveAttribute('href', '/referencias#radar');
    expect(screen.getByRole('link', { name: /Consultar capturas/ })).toHaveAttribute('href', '/referencias#captura');
    expect(screen.queryByRole('link', { name: /Enviar material/ })).toBeNull();
  });
  it('distingue pausa, primeira leitura, erro e leitura sem erro registrado', async () => {
    apiGet.mockResolvedValue(painel([
      fonte({ id: 'pausa', nome: 'Fonte pausada', ativo: false }),
      fonte({ id: 'nova', nome: 'Fonte nova' }),
      fonte({ id: 'erro', nome: 'Fonte com erro', ultimoErro: 'Feed indisponível' }),
      fonte({ id: 'lida', nome: 'Fonte lida', ultimaLeitura: '2026-09-29T12:00:00Z', capturas: 7 }),
    ]));
    render(<InsumosDaColeta />); await abrirFontes();
    expect(screen.getByText('3 de 4 fontes ativas')).toBeVisible();
    expect(screen.getByText('Pausada')).toBeVisible();
    expect(screen.getAllByText('sem leitura registrada')).toHaveLength(3);
    expect(screen.getByText('Último erro ou aviso: Feed indisponível')).toBeVisible();
    expect(screen.getByText('Nenhum erro ou aviso registrado.')).toBeVisible();
    expect(screen.getByText('7')).toBeVisible();
  });
  it('configuração Apify e etiqueta Gmail não viram conexão confirmada', async () => {
    apiGet.mockResolvedValue(painel([fonte({ tipo: 'gmail', handle: 'Pauta', nome: 'Newsletter' })], true));
    render(<InsumosDaColeta />); await abrirFontes();
    expect(screen.getByText(/validade da conexão não foi testada/)).toBeVisible();
    expect(screen.getByText(/etiqueta cadastrada “Pauta”/)).toHaveTextContent(/Conta e acesso à etiqueta não conferidos/);
  });
  it('não promete recebimento automático do WhatsApp', async () => {
    apiGet.mockResolvedValue(painel([fonte({ tipo: 'manual', plataforma: 'whatsapp' })]));
    render(<InsumosDaColeta />); await abrirFontes();
    expect(screen.getByText(/conexão do grupo não é conferida/)).toBeVisible();
  });
  it('falha nas fontes mantém as rotinas e permite tentar novamente', async () => {
    apiGet.mockImplementation((url) => url === '/pauta/fontes' ? Promise.reject(new Error('Leitura indisponível')) : Promise.resolve({
      items: [], avisos: [], execucoes: [], agendadorAtivo: true, tiposDisponiveis: [],
    }));
    render(<RotinasPage />);
    expect(await screen.findByText(/Não foi possível conferir as fontes/)).toBeVisible();
    expect(await screen.findByText(/Nenhuma rotina nesta empresa/)).toBeVisible();
    apiGet.mockResolvedValue(painel());
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText(/Nenhuma fonte cadastrada/)).toBeVisible();
  });
  it('não mostra resposta atrasada de outra sessão após trocar o token', async () => {
    let concluir!: (p: PautaFonteList) => void;
    apiGet.mockReturnValueOnce(new Promise<PautaFonteList>((r) => { concluir = r; })).mockResolvedValue(painel());
    const { rerender } = render(<InsumosDaColeta />);
    token = 'empresa-b'; rerender(<InsumosDaColeta />);
    await screen.findByText(/Nenhuma fonte cadastrada/);
    await act(async () => concluir(painel([fonte({ nome: 'Fonte privada A' })])));
    expect(screen.queryByText('Fonte privada A')).toBeNull();
    expect(apiGet).toHaveBeenLastCalledWith('/pauta/fontes', 'empresa-b');
  });
  it('links do trabalho e conhecimento respeitam os acessos', async () => {
    apiGet.mockResolvedValue(painel());
    const { rerender } = render(<InsumosDaColeta />);
    await screen.findByText(/Nenhuma fonte cadastrada/);
    expect(screen.queryByRole('link', { name: 'Continuar a produção editorial' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Consultar conhecimento da empresa' })).toBeNull();
    permissoes.push('tarefas.ver', 'obsidian.ver', 'pauta.editar'); modulos = ['pauta', 'trabalho'];
    rerender(<InsumosDaColeta />);
    expect(screen.getByRole('link', { name: 'Continuar a produção editorial' })).toHaveAttribute('href', '/trabalho?lista=901328341450');
    expect(screen.getByRole('link', { name: 'Consultar conhecimento da empresa' })).toHaveAttribute('href', '/contexto');
    expect(screen.getByRole('link', { name: /Configurar fontes no Radar/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /Enviar material em Captura/ })).toBeVisible();
  });
});
