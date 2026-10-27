import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', can: () => true }) }));
vi.mock('next/link', () => ({ default: ({ children, href, ...p }: any) => <a href={href} {...p}>{children}</a> }));
// Leva 5 (L7): o popup monta a caixa do WhatsApp de verdade (sem iframe), então o mock
// precisa do resto do módulo (`ErroDaApi`) e de uma lista vazia com o formato da API.
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (rota: string) => (rota === '/whatsapp/resumo'
      ? { naoLidas: { total: 3, leads: 1, clientes: 2, semVinculo: 0, equipe: 0 }, conversasSemVinculo: 0 }
      : { conversas: [], contagens: {}, podeResponder: false, podeVincular: false, mais: false })),
    apiPost: vi.fn(async () => ({})),
    apiStream: vi.fn(),
  };
});
import { ChatFlutuante } from '@/components/ChatFlutuante';

describe('Perguntar: a aba Chat com as não lidas do WhatsApp', () => {
  it('o botão fechado e a aba "chat" mostram o selo vermelho com a quantidade', async () => {
    render(<ChatFlutuante />);
    expect((await screen.findByTestId('chat-nao-lidas')).textContent).toBe('3');
    await userEvent.setup().click(screen.getByTitle('Chat: a central e as conversas do WhatsApp'));
    const aba = screen.getByRole('tab', { name: /chat/i });
    expect(aba.textContent).toContain('chat');
    expect(aba.querySelector('[data-testid="chat-nao-lidas"]')?.textContent).toBe('3');
  });
});
