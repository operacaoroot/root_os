import { describe, expect, it } from 'vitest';

import { JornadaSchema, RelatoSchema } from '../src/frota/frota.schemas';
import { mudancasDaJornada, quadroDaFrota, quemTrava, resumoDaJornada } from '../src/frota/jornada';
import { pendenciasDaCasa } from '../src/frota/politicas';

// Recorte do que o `kit-jornada json` do kit (2e8ba1d) manda: mesmo formato, menos itens.
const jornadaDoKit = () => ({
  versao: 1,
  arquivo: true,
  kit: '170b4ff',
  geradoEm: '2026-10-29T22:30:00-03:00',
  pct: 25,
  feitos: 2,
  validos: 8,
  faseAtual: 0,
  fases: [
    { n: 0, nome: 'Decisões antes de contratar', total: 4, feito: 1, na: 0, andamento: 0, esperando: 2, regrediu: 0, afazer: 1 },
    { n: 2, nome: 'Preparar (as etapas do kit)', total: 4, feito: 1, na: 1, andamento: 0, esperando: 0, regrediu: 1, afazer: 0 },
  ],
  itens: [
    { id: '0.1', fase: 0, item: 'De quem é o servidor', quem: 'humano', projeto: false, situacao: 'feito', marcada: 'feito', quando: '2026-10-15' },
    { id: '0.6', fase: 0, item: 'Cofre do cliente: qual', quem: 'humano', projeto: false, situacao: 'afazer', marcada: 'afazer' },
    { id: '0.7', fase: 0, item: 'Destino do backup fora do servidor', quem: 'humano', projeto: false, situacao: 'esperando', marcada: 'esperando', espera: 'cliente', quando: '2026-10-16', nota: 'orçamento do B2 enviado' },
    { id: '0.8', fase: 0, item: 'Canal de alerta', quem: 'humano', projeto: false, situacao: 'esperando', marcada: 'esperando', espera: 'root', quando: '2026-10-20' },
    { id: '2.7', fase: 2, item: 'Etapa 06 backup', quem: 'kit', projeto: false, situacao: 'regrediu', marcada: 'feito', auto: 'falha', autoTexto: 'último backup bom há 4 dias' },
    { id: '2.9', fase: 2, item: 'Etapa 08 VPN', quem: 'kit', projeto: false, situacao: 'na', marcada: 'afazer', auto: 'na' },
    { id: '2.13', fase: 2, item: 'Etapa 09 relator', quem: 'kit', projeto: false, situacao: 'feito', marcada: 'afazer', auto: 'ok', autoTexto: 'relato aceito' },
    { id: 'P5.1', fase: 2, item: 'Migrar dados do PC', quem: 'humano', projeto: true, situacao: 'andamento', quando: '2026-10-28' },
  ],
});

describe('jornada da Frota', () => {
  it('aceita o formato do kit e sobrevive a situação desconhecida', () => {
    const j = jornadaDoKit();
    (j.itens[1] as { situacao: string }).situacao = 'situacao-nova-do-kit';
    const p = JornadaSchema.parse(j);
    expect(p.itens[1].situacao).toBe('afazer');
  });

  it('jornada torta não derruba o relato', () => {
    const r = RelatoSchema.parse({ versao: 1, casa: 'teste', quando: '2026-10-29T22:30:00-03:00', jornada: { versao: 2, lixo: true } });
    expect(r.jornada).toBeUndefined();
    const ok = RelatoSchema.parse({ versao: 1, casa: 'teste', quando: '2026-10-29T22:30:00-03:00', jornada: jornadaDoKit() });
    expect(ok.jornada?.itens).toHaveLength(8);
  });

  it('resume fase atual, próximo passo, quem trava e o que regrediu', () => {
    const r = resumoDaJornada(JornadaSchema.parse(jornadaDoKit()))!;
    expect(r.faseAtual).toBe(0);
    expect(r.faseNome).toBe('Decisões antes de contratar');
    expect(r.proximo.map((i) => i.id)).toEqual(['0.6']);
    expect(r.porQuem).toEqual({ cliente: 1, root: 1, terceiro: 0 });
    expect(r.regrediu.map((i) => i.id)).toEqual(['2.7']);
    expect(r.fases[1].conta).toBe(3);
    expect(resumoDaJornada(undefined)).toBeNull();
  });

  it('quem trava: o texto livre da casa em três grupos', () => {
    expect(quemTrava('cliente')).toBe('cliente');
    expect(quemTrava('')).toBe('cliente');
    expect(quemTrava('ROOT')).toBe('root');
    expect(quemTrava('Hostinger')).toBe('terceiro');
  });

  it('o quadro da frota junta as casas, o mais antigo primeiro', () => {
    const j = JornadaSchema.parse(jornadaDoKit());
    const q = quadroDaFrota([{ id: 'a', casa: 'casa-a', jornada: j }, { id: 'b', casa: 'casa-b', jornada: null }]);
    expect(q.cliente.map((l) => [l.casa, l.id])).toEqual([['casa-a', '0.7']]);
    expect(q.root.map((l) => l.id)).toEqual(['0.8']);
    expect(q.regrediu.map((l) => l.id)).toEqual(['2.7']);
    expect(q.andamento.map((l) => l.id)).toEqual(['P5.1']);
  });

  it('só a mudança de situação vira evento, e sem jornada antes nada', () => {
    const antes = JornadaSchema.parse(jornadaDoKit());
    const depois = JornadaSchema.parse(jornadaDoKit());
    depois.itens[1].situacao = 'feito';
    depois.itens[1].nota = 'Vaultwarden da casa';
    const m = mudancasDaJornada(antes, depois);
    expect(m).toHaveLength(1);
    expect(m[0].texto).toContain('0.6');
    expect(m[0].texto).toContain('a fazer → feito');
    expect(mudancasDaJornada(undefined, depois)).toEqual([]);
  });

  it('item que regrediu vira pendência de atenção', () => {
    const relato = RelatoSchema.parse({ versao: 1, casa: 'teste', quando: '2026-10-29T22:30:00-03:00', backup: { ultimoOk: '2026-10-29T03:30:00-03:00', remoto: true }, jornada: jornadaDoKit() });
    const p = pendenciasDaCasa(relato, 'manter', []);
    expect(p.some((x) => x.n === 'at' && x.t.includes('2.7 regrediu'))).toBe(true);
  });
});
