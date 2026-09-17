import { describe, it, expect } from 'vitest';
import {
  DESTRAVE,
  bancoDescartavelEstrito,
  bancoEhDescartavel,
  exigirBancoDescartavel,
  nomeDoBanco,
} from '../src/common/banco-descartavel';

/*
 * A TRAVA QUE PROTEGE O BANCO ERRADO — agora com dois chamadores.
 *
 * As suítes que escrevem (`test/banco-de-teste.ts`) e a semente de demonstração
 * (`prisma/seed-demo.ts`) fazem a mesma pergunta. Esta suíte mede a pergunta
 * uma vez, e o caso do destrave existe para que ninguém "conserte" a trava
 * apagando a saída consciente.
 */
describe('trava de banco descartável', () => {
  it('lê o nome do banco da URL, e URL ilegível cai no lado seguro', () => {
    expect(nomeDoBanco('postgresql://mkt:x@localhost:5442/marketing_os_test')).toBe('marketing_os_test');
    expect(nomeDoBanco('isto não é uma url')).toBe('');
  });

  it.each(['marketing_os_test', 'mktos_dev', 'root_local', 'os_staging', 'marketing_os_shadow'])(
    '"%s" se anuncia como descartável',
    (nome) => {
      expect(bancoEhDescartavel(`postgresql://u:p@h/${nome}`, {})).toBe(true);
    },
  );

  it.each(['marketing_os', 'root_os', 'promedical', 'producao'])('"%s" NÃO se anuncia como descartável', (nome) => {
    expect(bancoEhDescartavel(`postgresql://u:p@h/${nome}`, {})).toBe(false);
    expect(() => exigirBancoDescartavel(`postgresql://u:p@h/${nome}`, 'apaga os leads', 'DATABASE_URL')).toThrow(
      /não parece descartável.*apaga os leads.*DATABASE_URL/,
    );
  });

  it('o destrave é consciente e por escrito — e só vale para as suítes', () => {
    expect(bancoEhDescartavel('postgresql://u:p@h/producao', { [DESTRAVE]: '1' })).toBe(true);
    expect(bancoEhDescartavel('postgresql://u:p@h/producao', { [DESTRAVE]: 'sim' })).toBe(false);
    // A checagem ESTRITA (a da semente de demonstração) não conhece destrave:
    // variável esquecida no shell não é licença para apagar.
    expect(bancoDescartavelEstrito('postgresql://u:p@h/producao')).toBe(false);
    expect(bancoDescartavelEstrito('postgresql://u:p@h/producao_test')).toBe(true);
  });

  it('URL vazia não é assunto da trava', () => {
    expect(() => exigirBancoDescartavel('', 'qualquer coisa')).not.toThrow();
  });
});
