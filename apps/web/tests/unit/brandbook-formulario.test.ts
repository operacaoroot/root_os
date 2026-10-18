import { describe, expect, it } from 'vitest';
import { BrandbookDocumentoSchema, type BrandbookColeta } from '@mktos/shared';
import { aplicarColeta, htmlDoBrandbook, lerDocumentoLocal, novoBrandbook } from '@/app/contexto/marca/brandbook-formulario';
const coleta: BrandbookColeta = { url: 'https://example.com/', titulo: 'Título coletado', descricao: 'Descrição coletada', texto: 'Referência coletada', cores: [{ papel: 'proposta', hex: '#123456' }], fontes: [{ papel: 'proposta', familia: 'Arial' }], avisos: [] };
describe('documentos do brandbook', () => {
  it('preserva identidade e escolhas visuais ao adicionar propostas de uma coleta', () => {
    const d = novoBrandbook(); d.identidade.nome = 'Nome escolhido'; d.identidade.descricao = 'Descrição editada'; d.visual.cores[0].hex = '#abcdef'; d.visual.fontes[0].familia = 'Inter';
    const antes = structuredClone(d); const r = aplicarColeta(d, coleta);
    expect(r.identidade).toEqual(d.identidade); expect(r.visual.cores.slice(0, 3)).toEqual(d.visual.cores); expect(r.visual.fontes.slice(0, 2)).toEqual(d.visual.fontes); expect(r.visual.cores.at(-1)).toEqual(coleta.cores[0]); expect(d).toEqual(antes);
  });
  it('não duplica candidatos existentes nem excede os limites do formulário', () => {
    const d = novoBrandbook(); d.visual.cores = Array.from({ length: 16 }, (_, i) => ({ papel: 'Escolhida', hex: `#${i.toString(16).padStart(6, '0')}` })); d.visual.fontes = [{ papel: 'Título', familia: 'Arial' }];
    const r = aplicarColeta(d, coleta); expect(r.visual.cores).toEqual(d.visual.cores); expect(r.visual.fontes).toEqual(d.visual.fontes); expect(BrandbookDocumentoSchema.safeParse(r).success).toBe(true);
  });
  it('importa JSON exportado sem perder campos e recusa conteúdo incompatível', async () => {
    const d = novoBrandbook(); d.identidade.nome = 'Exercício'; d.respostas.dor = 'Informação dispersa';
    const file = { name: 'livro.json', size: JSON.stringify(d).length, text: async () => JSON.stringify(d) } as File;
    expect((await lerDocumentoLocal(file)).documento).toEqual(d); await expect(lerDocumentoLocal({ ...file, text: async () => '{"estranho":true}' } as File)).rejects.toThrow('não é um brandbook válido');
  });
  it('exporta HTML com conteúdo escapado e sem executar a origem', () => {
    const d = novoBrandbook(); d.identidade.nome = '<script>alert(1)</script>'; d.origem.texto = '<img src=x onerror=alert(1)>';
    const html = htmlDoBrandbook(d, 'Rascunho'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x');
  });
});
