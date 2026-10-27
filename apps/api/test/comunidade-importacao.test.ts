import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import {
  ImportacaoDaComunidadeService,
  SLUG_DA_IMPORTACAO_DA_COMUNIDADE,
  TIPO_DA_IMPORTACAO_DA_COMUNIDADE,
} from '../src/marketing-estudio/importacao-da-comunidade.service';

/*
 * Rotina de hora em hora da Comunidade Wpp (27/10/2026): o mesmo "Importar do Drive" da
 * tela, que só cria o que falta. Aparece em /rotinas; a que existe nunca é regravada.
 */
function montar(importar: () => Promise<unknown>, existente = false) {
  const criadas: Record<string, unknown>[] = [];
  const prisma = {
    rotina: {
      findUnique: async () => (existente ? { id: 'r1' } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        criadas.push(data);
        return data;
      },
    },
  };
  const registro = new ExecutoresDeRotinaRegistry();
  const svc = new ImportacaoDaComunidadeService(prisma as never, { importarComunidade: importar } as never, registro);
  svc.onModuleInit();
  return { svc, registro, criadas };
}

describe('rotina de importação da comunidade', () => {
  it('inscreve o executor e cria a rotina de hora em hora só quando falta', async () => {
    const a = montar(async () => ({}));
    expect(a.registro.tem(TIPO_DA_IMPORTACAO_DA_COMUNIDADE)).toBe(true);
    expect(await a.svc.garantirRotina('o1')).toBe('criada');
    expect(a.criadas[0]).toMatchObject({ slug: SLUG_DA_IMPORTACAO_DA_COMUNIDADE, cron: '0 * * * *', tz: 'America/Sao_Paulo', ativo: true });

    const b = montar(async () => ({}), true);
    expect(await b.svc.garantirRotina('o1')).toBe('ja-existia');
    expect(b.criadas).toHaveLength(0);
  });

  it('a passagem conta o que entrou no Banco', async () => {
    const { svc } = montar(async () => ({ lidos: 3, criados: 1, jaExistiam: 2, ignorados: 0 }));
    expect(await svc.passagem({ orgId: 'o1' })).toEqual({ status: 'ok', resumo: '1 peça(s) nova(s) no Banco (3 arquivo(s) na pasta).' });
  });

  it('Drive desligado ou pasta ausente vira pulada; outro erro vira erro', async () => {
    const sem = montar(async () => { throw new ServiceUnavailableException('O Google Drive não está ligado nesta instalação.'); });
    expect((await sem.svc.passagem({ orgId: 'o1' })).status).toBe('pulada');
    const pasta = montar(async () => { throw new NotFoundException('Não achei a pasta.'); });
    expect((await pasta.svc.passagem({ orgId: 'o1' })).status).toBe('pulada');
    const quebrou = montar(async () => { throw new Error('rede caiu'); });
    expect(await quebrou.svc.passagem({ orgId: 'o1' })).toEqual({ status: 'erro', resumo: 'A importação falhou: rede caiu' });
  });
});
