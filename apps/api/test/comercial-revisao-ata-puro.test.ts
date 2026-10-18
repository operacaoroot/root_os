import { describe, expect, it } from 'vitest';

import { ROTAS_DE_MIDIA_DO_EPISODIO, ROTAS_EXATAS_DE_CORPO_GRANDE, instalarCorpoDaMidia } from '../src/common/corpo-da-midia';

/*
 * REVISÃO C-9 (13/10/2026): a ata de uma sessão longa passa de 100 kb em JSON.
 * O corpo grande vale na rota da ata, só com sessão válida, como nas rotas de
 * mídia do episódio; as rotas de mídia seguem as mesmas.
 */

describe('revisão C-9: a ata longa não morre em 413', () => {
  it('o parser grande entra na rota da ata do comercial, além das duas da mídia', () => {
    const caminhos: string[] = [];
    instalarCorpoDaMidia({ use: (caminho: string) => void caminhos.push(caminho) }, 'api', () => true);
    expect(caminhos).toContain('/api/comercial/lead/:id/ata');
    for (const r of ROTAS_DE_MIDIA_DO_EPISODIO) expect(caminhos).toContain(`/api${r}`);
    // Mais a ata do banco de atas do Trabalho (revisão PA-6, 18/10/2026), que tem teste próprio.
    expect(caminhos).toHaveLength(ROTAS_DE_MIDIA_DO_EPISODIO.length + 1 + ROTAS_EXATAS_DE_CORPO_GRANDE.length);
  });

  it('sem sessão a ata segue para o parser padrão (o guarda responde o resto)', () => {
    type Manipulador = Parameters<Parameters<typeof instalarCorpoDaMidia>[0]['use']>[1];
    const handlers = new Map<string, Manipulador>();
    instalarCorpoDaMidia({ use: (c: string, h: Manipulador) => void handlers.set(c, h) }, 'api', () => false);
    let seguiu = false;
    const req = { method: 'POST', headers: { authorization: 'Bearer x' } } as unknown as Parameters<Manipulador>[0];
    handlers.get('/api/comercial/lead/:id/ata')!(req, {} as Parameters<Manipulador>[1], () => (seguiu = true));
    expect(seguiu).toBe(true);
  });
});
