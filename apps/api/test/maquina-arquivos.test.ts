import { describe, expect, it } from 'vitest';
import { MaquinaPostSalvarSchema } from '@mktos/shared';
import { MaquinaDeConteudoService } from '../src/maquina-de-conteudo/maquina-de-conteudo.service';

/*
 * Arquivos da peça (27/10/2026): o .md da isca da Comunidade Wpp mora em `recursos` como
 * { tipo: 'arquivo', nome, conteudo }. A tela recebe os textos em `recursos` e os arquivos em
 * `arquivos`; salvar sem mandar `arquivos` não pode apagar o que a peça já tem.
 */
function servicoCom(post: Record<string, unknown>) {
  const gravado: { data?: Record<string, unknown> } = {};
  const prisma = {
    marketingPost: {
      findFirst: async () => post,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        gravado.data = data;
        return { ...post, ...data, atualizadoEm: new Date(), criadoEm: new Date() };
      },
    },
  };
  return { svc: new MaquinaDeConteudoService(prisma as never, {} as never), gravado };
}

const base = {
  id: 'p1', orgId: 'o1', numero: '', ordem: 1, titulo: 'Suco de IA 1', pilar: '', formato: 'Comunidade Wpp', subtipo: 'News semanal',
  tipoCard: 'arte', prioridade: 'media', headline: '', subHeadline: '', roteiro: 'news', slides: [], design: '', legenda: '', cta: 'isca',
  porque: '', fontes: [], etapa: 'ideia', data: null, linkPublicado: '', metricas: {}, hist: [], comentarios: [], criadoEm: new Date(), atualizadoEm: new Date(),
  recursos: ['link solto', { tipo: 'arquivo', nome: 'agente-porteiro.md', conteudo: '# Agente porteiro' }],
};

describe('arquivos da peça em recursos', () => {
  it('a tela recebe os textos em recursos e os arquivos à parte', async () => {
    const { svc } = servicoCom(base);
    const p = await svc.salvar('o1', 'p1', MaquinaPostSalvarSchema.parse({ titulo: 'Suco de IA 1', formato: 'Comunidade Wpp', recursos: ['link solto'] }));
    expect(p.recursos).toEqual(['link solto']);
    expect(p.arquivos).toEqual([{ nome: 'agente-porteiro.md', conteudo: '# Agente porteiro' }]);
  });

  it('salvar sem arquivos mantém os que a peça tem; com arquivos, troca o texto', async () => {
    const a = servicoCom(base);
    await a.svc.salvar('o1', 'p1', MaquinaPostSalvarSchema.parse({ titulo: 'x', recursos: ['outro'] }));
    expect(a.gravado.data!.recursos).toEqual(['outro', { tipo: 'arquivo', nome: 'agente-porteiro.md', conteudo: '# Agente porteiro' }]);

    const b = servicoCom(base);
    await b.svc.salvar('o1', 'p1', MaquinaPostSalvarSchema.parse({ titulo: 'x', recursos: [], arquivos: [{ nome: 'agente-porteiro.md', conteudo: '# revisado' }] }));
    expect(b.gravado.data!.recursos).toEqual([{ tipo: 'arquivo', nome: 'agente-porteiro.md', conteudo: '# revisado' }]);
    expect(b.gravado.data).not.toHaveProperty('arquivos');
  });
});
