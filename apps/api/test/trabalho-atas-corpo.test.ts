import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ATA_MAX_CARACTERES, ATA_MIN_CARACTERES, PAUTA_TETO_DO_CORPO_DA_MIDIA, TrabAtaColarSchema } from '@mktos/shared';

import {
  ROTAS_DE_CORPO_GRANDE_DO_COMERCIAL,
  ROTAS_DE_MIDIA_DO_EPISODIO,
  ROTAS_EXATAS_DE_CORPO_GRANDE,
  instalarCorpoDaMidia,
} from '../src/common/corpo-da-midia';

/*
 * REVISÃO PA-6 (18/10/2026): colar uma ata longa no banco de atas do Trabalho
 * morria em 413 nos 100 kb do body-parser, embora o schema prometa 200 mil
 * caracteres. O conserto segue o C-9 do comercial: o parser grande vale SÓ no
 * POST de `/trabalho/atas` e SÓ com sessão válida. As rotas de baixo
 * (`/trabalho/atas/:ref/sugestoes`, `/trabalho/atas/sugestoes/:id/aceitar`) e o
 * resto da API continuam nos 100 kb.
 */

describe('PA-6: a ata colada longa chega ao schema', () => {
  const SESSAO = 'sessao-valida';
  let servidor: Server;
  let base = '';

  beforeAll(async () => {
    // Na ordem do Nest: instala antes do `listen`; o padrão entra no `init`.
    const adapter = new ExpressAdapter();
    instalarCorpoDaMidia(adapter, 'api', (token) => token === SESSAO);
    adapter.registerParserMiddleware();
    const app = adapter.getInstance();
    const eco = (req: { body: unknown }, res: { json: (v: unknown) => void }) =>
      res.json({ bytes: Buffer.byteLength(JSON.stringify(req.body ?? null)) });
    app.post('/api/trabalho/atas', eco);
    app.post('/api/trabalho/atas/:ref/sugestoes', eco);
    app.post('/api/trabalho/atas/sugestoes/:id/aceitar', eco);
    app.post('/api/trabalho/tarefas', eco);
    servidor = app.listen(0, '127.0.0.1');
    await new Promise((r) => servidor.once('listening', r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => servidor.close(r));
  });

  // 200 mil caracteres acentuados: ~400 kB em UTF-8, quatro vezes o padrão.
  const ataDe = (caracteres: number) =>
    JSON.stringify({ titulo: 'Reunião longa', texto: 'ç'.repeat(caracteres) });
  const postar = (rota: string, corpo: string, token: string | null = SESSAO) =>
    fetch(`${base}${rota}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: corpo,
    });

  it('a rota de colar aceita os 200 mil caracteres que o schema promete', async () => {
    const corpo = ataDe(ATA_MAX_CARACTERES);
    expect(Buffer.byteLength(corpo)).toBeGreaterThan(300 * 1024);
    expect(TrabAtaColarSchema.safeParse(JSON.parse(corpo)).success).toBe(true);
    const r = await postar('/api/trabalho/atas', corpo);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { bytes: number }).bytes).toBeGreaterThan(300 * 1024);
    // Com query string também é a mesma rota.
    expect((await postar('/api/trabalho/atas?x=1', corpo)).status).toBe(200);
  });

  it('sem sessão válida o corpo grande não é lido: 413 nos 100 kb, antes de o guarda dizer 401', async () => {
    expect((await postar('/api/trabalho/atas', ataDe(ATA_MAX_CARACTERES), null)).status).toBe(413);
    expect((await postar('/api/trabalho/atas', ataDe(ATA_MAX_CARACTERES), 'forjado')).status).toBe(413);
    expect((await postar('/api/trabalho/atas', ataDe(ATA_MIN_CARACTERES), null)).status).toBe(200);
  });

  it('as rotas de baixo do banco de atas e o resto da API continuam nos 100 kb', async () => {
    const grande = ataDe(ATA_MAX_CARACTERES);
    expect((await postar('/api/trabalho/atas/memoria:x/sugestoes', grande)).status).toBe(413);
    expect((await postar('/api/trabalho/atas/sugestoes/s1/aceitar', grande)).status).toBe(413);
    expect((await postar('/api/trabalho/tarefas', grande)).status).toBe(413);
    const pequeno = await postar('/api/trabalho/atas/sugestoes/s1/aceitar', JSON.stringify({ a: 1 }));
    expect(pequeno.status).toBe(200);
    expect(((await pequeno.json()) as { bytes: number }).bytes).toBe(7);
  });

  it('o pior corpo que o schema aceita cabe no teto (controle escapado vira 6 bytes por caractere)', () => {
    const pior = JSON.stringify({ titulo: 'x'.repeat(200), texto: '\u0001'.repeat(ATA_MAX_CARACTERES) });
    expect(Buffer.byteLength(pior)).toBeLessThan(PAUTA_TETO_DO_CORPO_DA_MIDIA);
  });

  it('a lista de rotas grandes é a de antes mais a ata do Trabalho, e nada além', () => {
    const caminhos: string[] = [];
    instalarCorpoDaMidia({ use: (caminho: string) => void caminhos.push(caminho) }, 'api', () => true);
    expect([...ROTAS_EXATAS_DE_CORPO_GRANDE]).toEqual(['/trabalho/atas']);
    expect(caminhos.sort()).toEqual(
      [...ROTAS_DE_MIDIA_DO_EPISODIO, ...ROTAS_DE_CORPO_GRANDE_DO_COMERCIAL, ...ROTAS_EXATAS_DE_CORPO_GRANDE].map((r) => `/api${r}`).sort(),
    );
  });
});
