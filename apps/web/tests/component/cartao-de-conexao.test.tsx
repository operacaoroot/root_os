import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CartaoDeConexao as Linha } from '@mktos/shared';
import { textoDoEstadoDoCartao } from '@mktos/shared';
import { CartaoDeConexao, quandoFoi } from '@/app/conexoes/CartaoDeConexao';

/*
 * O CARTÃO DE CONEXÃO, sozinho (rodada dos agentes, A6). O componente é um só
 * para todo conector: mesma ordem, mesmo vocabulário, mesmas ações. Aqui se
 * cobra o que a página não exercita: os cinco estados, a ausência de ação sem
 * permissão, o cancelamento que não chama nada e o conteúdo próprio como filho.
 */

const AGORA = new Date().toISOString();

function linha(over: Partial<Linha> = {}): Linha {
  return {
    key: 'k',
    nome: 'Conector K',
    paraQueServe: 'Serve para o teste.',
    categoria: 'teste',
    fase: 1,
    estado: 'conectado',
    motivo: null,
    medidoEm: AGORA,
    latenciaMs: 12,
    conta: 'conta@exemplo',
    ultimaSincronizacao: null,
    credencialNoCofre: true,
    desligado: false,
    desligadoEm: null,
    motivoDesligado: null,
    textoDoDesligamento: 'Desligar recusa a chamada na hora.',
    grupo: null,
    contrato: { chave: 'k', rotulo: 'K', escopoDaCredencial: 'empresa', linhasIrmas: [] },
    usadoPor: [
      { id: 'CO-01', nome: 'Qualificador', tipo: 'automacao', estado: 'ativo' },
      { id: 'RO-01', nome: 'Sincronizador', tipo: 'rotina', estado: 'desligado' },
    ],
    ...over,
  };
}

describe('o vocabulário do estado', () => {
  it('os cinco estados têm o texto certo, e Erro leva o motivo (ou diz que não veio)', () => {
    expect(textoDoEstadoDoCartao('conectado', 'x')).toBe('Conectado');
    expect(textoDoEstadoDoCartao('nao_configurado', 'x')).toBe('Não configurado');
    expect(textoDoEstadoDoCartao('desligado', 'x')).toBe('Desligado');
    expect(textoDoEstadoDoCartao('nao_verificado', 'x')).toBe('Não verificado');
    expect(textoDoEstadoDoCartao('erro', 'HTTP 500')).toBe('Erro: HTTP 500');
    expect(textoDoEstadoDoCartao('erro', '  ')).toBe('Erro: motivo não informado pelo conector');
  });

  it.each([
    ['conectado', 'Conectado'],
    ['nao_configurado', 'Não configurado'],
    ['desligado', 'Desligado'],
    ['nao_verificado', 'Não verificado'],
  ] as const)('%s aparece como "%s" no selo', (estado, texto) => {
    render(<CartaoDeConexao linha={linha({ estado, desligado: estado === 'desligado' })} />);
    expect(screen.getByTestId('estado-k')).toHaveTextContent(new RegExp(`^${texto}$`));
  });

  it('Erro mostra a frase inteira do conector', () => {
    render(<CartaoDeConexao linha={linha({ estado: 'erro', motivo: 'A Evolution respondeu HTTP 401.', conta: null })} />);
    expect(screen.getByTestId('estado-k')).toHaveTextContent('Erro: A Evolution respondeu HTTP 401.');
  });
});

describe('a mesma ordem e o mesmo conteúdo em todo cartão', () => {
  it('nome, para que serve, quem usa, medição, conta, sincronização e credencial', () => {
    render(<CartaoDeConexao linha={linha()} />);
    const c = screen.getByRole('region', { name: 'Conector K' });
    expect(within(c).getByRole('heading', { name: 'Conector K' })).toBeInTheDocument();
    expect(within(c).getByText('Serve para o teste.')).toBeInTheDocument();
    const quem = within(c).getByRole('list', { name: 'Quem usa Conector K' });
    expect(within(quem).getByText('Qualificador')).toBeInTheDocument();
    expect(within(quem).getByText(/automação/)).toBeInTheDocument();
    expect(within(quem).getByText(/rotina · desligado/)).toBeInTheDocument();
    expect(within(c).getByTestId('medido-k')).toHaveTextContent(/há \d+ s\) · 12 ms/);
    expect(within(c).getByText('conta@exemplo')).toBeInTheDocument();
    expect(within(c).getByText('guardada no cofre desta empresa')).toBeInTheDocument();
  });

  it('o conteúdo próprio do conector entra como filho, dentro do cartão', () => {
    render(<CartaoDeConexao linha={linha()}><p>o QR fica aqui</p></CartaoDeConexao>);
    expect(within(screen.getByRole('region', { name: 'Conector K' })).getByText('o QR fica aqui')).toBeInTheDocument();
  });

  it('a hora da medição: relativa no primeiro minuto, absoluta depois, e traço sem medição', () => {
    const agora = Date.now();
    expect(quandoFoi(new Date(agora - 5_000).toISOString(), agora)).toMatch(/há 5 s/);
    expect(quandoFoi(new Date(agora - 5 * 60_000).toISOString(), agora)).toMatch(/há 5 min/);
    expect(quandoFoi(null)).toBe('—');
  });
});

describe('as ações', () => {
  it('sem ações (quem não administra e não há contrato), nenhum botão', () => {
    render(<CartaoDeConexao linha={linha({ contrato: null })} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('as quatro ações aparecem com os nomes do padrão', () => {
    const acoes = { conectar: vi.fn(), testar: vi.fn(), desconectar: vi.fn(), desligar: vi.fn() };
    render(<CartaoDeConexao linha={linha()} acoes={acoes} />);
    for (const nome of ['Conectar', 'Testar', 'Desconectar', 'Desligar']) expect(screen.getByRole('button', { name: nome })).toBeInTheDocument();
  });

  it('credencial do processo não oferece Desconectar', () => {
    render(<CartaoDeConexao linha={linha({ credencialNoCofre: false, contrato: { chave: 'k', rotulo: 'K', escopoDaCredencial: 'processo', linhasIrmas: [] } })}
      acoes={{ desconectar: vi.fn(), desligar: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull();
    expect(screen.getByText('do processo (ambiente da API)')).toBeInTheDocument();
  });

  it('desligado troca Desligar por Religar e esconde Conectar', async () => {
    const religar = vi.fn();
    render(<CartaoDeConexao linha={linha({ estado: 'desligado', desligado: true, desligadoEm: AGORA })}
      acoes={{ conectar: vi.fn(), desligar: vi.fn(), religar }} />);
    expect(screen.queryByRole('button', { name: 'Conectar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desligar' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Religar' }));
    expect(religar).toHaveBeenCalledTimes(1);
  });

  it('Desconectar e Desligar pedem confirmação; cancelar não chama nada', async () => {
    const user = userEvent.setup();
    const desconectar = vi.fn();
    const desligar = vi.fn();
    render(<CartaoDeConexao linha={linha()} acoes={{ desconectar, desligar }} />);
    await user.click(screen.getByRole('button', { name: 'Desconectar' }));
    expect(screen.getByText(/Não tem volta/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Desligar' }));
    await user.type(screen.getByLabelText('Motivo'), 'teste');
    await user.click(screen.getByRole('button', { name: 'Desligar agora' }));
    expect(desconectar).not.toHaveBeenCalled();
    expect(desligar).toHaveBeenCalledWith('teste');
  });
});
