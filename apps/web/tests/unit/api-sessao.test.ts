import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiTexto, apiBlob, apiPost, apiPut, apiPatch, apiDelete, apiUpload, apiStream, observarSessaoRecusada } from '@/lib/api';
afterEach(() => vi.unstubAllGlobals());
describe('recusa de sessão nos helpers HTTP', () => {
  it.each(['get', 'texto', 'blob', 'post', 'put', 'patch', 'delete', 'upload', 'stream'])('%s comunica a recusa de token, preservando o erro', async metodo => {
    const recebeu = vi.fn(), parar = observarSessaoRecusada(recebeu);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Token inválido' }), { status: 401 })));
    const t = 'token-sintetico';
    const chamar = { get: () => apiGet('/memoria', t), texto: () => apiTexto('/memoria', t), blob: () => apiBlob('/memoria', t), post: () => apiPost('/memoria', {}, t), put: () => apiPut('/memoria', {}, t), patch: () => apiPatch('/memoria', {}, t), delete: () => apiDelete('/memoria', t), upload: () => apiUpload('/memoria', new File(['x'], 'qa.txt'), t), stream: () => apiStream('/memoria', {}, t, () => {}).pronto };
    try { await expect(chamar[metodo as keyof typeof chamar]()).rejects.toThrow('Token inválido'); expect(recebeu).toHaveBeenCalledOnce(); expect(recebeu).toHaveBeenCalledWith(t); } finally { parar(); }
  });
  it('401 anônimo ou do login não informa expiração de sessão', async () => {
    const recebeu = vi.fn(), parar = observarSessaoRecusada(recebeu); vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ message: 'Token inválido' }), { status: 401 })));
    try { await apiGet('/memoria').catch(() => {}); await apiPost('/auth/login', {}, 'token-sintetico').catch(() => {}); expect(recebeu).not.toHaveBeenCalled(); } finally { parar(); }
  });
});
