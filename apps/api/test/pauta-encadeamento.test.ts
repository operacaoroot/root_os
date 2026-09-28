import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PAUTA_EPISODIO_STATUS,
  PAUTA_ETAPAS_DO_ENCADEAMENTO,
  PAUTA_TIPO_DA_ROTINA_DE_ENCADEAMENTO,
  instanteNoFuso,
  type PautaEpisodioStatus,
  type PautaEtapaDoEncadeamento,
  type PautaItemCurado,
} from '@mktos/shared';

import {
  ConfigDoEncadeamentoInvalidaError,
  ERROS_QUE_TRAVAM,
  STATUS_QUE_ENCADEIAM,
  TETO_DE_EPISODIOS_POR_PASSAGEM,
  etapasDaConfig,
  leituraDoHistorico,
  lerPassoDoRastro,
  proximoPasso,
  type EpisodioParaEncadear,
  type PassoNoRastro,
} from '../src/pauta/encadeamento-do-episodio';
import { midiaProntaDaPeca } from '../src/pauta/midia-do-episodio';
import { ACAO_DO_PASSO, EncadeamentoService, LOTE_DE_CANDIDATOS, resultadoDoErro, type Passagem } from '../src/pauta/encadeamento.service';
import { ACAO_DA_MONTAGEM_DA_PAGINA } from '../src/pauta/pagina-de-links.service';
import { EncadeamentoController } from '../src/pauta/encadeamento.controller';
import { AgendaService } from '../src/pauta/agenda.service';
import { EpisodioService } from '../src/pauta/episodio.service';
import { RotinaService } from '../src/pauta/rotina.service';
import { PacoteService } from '../src/pauta/pacote.service';
import { NewsletterService } from '../src/pauta/newsletter.service';
import { DerivacaoService } from '../src/pauta/derivacao.service';
import { umaPorVez } from '../src/pauta/uma-por-vez';
import { MemoriaService } from '../src/memory/memoria.service';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { lerNovaRotina } from '../src/routines/nova-rotina';
import {
  AGENTE_DO_TIPO,
  MODULO_DO_TIPO,
  TIPOS_DA_PAUTA,
  TIPO_PAUTA_ENCADEAR,
  silencioDoTiqueDaPauta,
} from '../src/routines/rotina.tipos';
import { desfechoDaPassagem } from '../src/routines/executores/pauta-encadear.executor';
import { exigirBancoDescartavel } from './banco-de-teste';
import { semMarca } from './marca-de-teste';

/*
 * O ENCADEAMENTO — MD1: da transcrição à semana em rascunho, parando antes de
 * qualquer saída.
 *
 * Quatro camadas:
 *   1. a parte pura: `proximoPasso` em cada estado (e a garantia de que nunca
 *      publica), a trava de três erros, as etapas da config e a rotina nova;
 *   2. o `EncadeamentoService` montado à mão com dublês dos serviços — um passo
 *      por passagem, teto de dois episódios, o 409 do `umaPorVez` (com os
 *      serviços DE VERDADE e a mesma chave do clique) como `pulada`, erro,
 *      trava e dispensa;
 *   3. o `AgendaService.proporSlots` com dublês: só rascunho, sem colidir com a
 *      agenda nem com o proposto de outro episódio, `agendadaPara` intocado; o
 *      PATCH de status não converte proposto em agenda; distribuir prefere o
 *      slot proposto;
 *   4. com banco: os slots propostos e a semana pela sessão da empresa.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-0000000000d1';
const PESSOA = 'b1d2c3e4-0000-4000-8000-0000000000d1';

const ITENS: PautaItemCurado[] = [
  { id: 'c1', titulo: 'Preço do modelo caiu pela metade', url: 'https://noticia.exemplo/preco', origem: 'N' },
  { id: 'c2', titulo: 'Agente de planilha no Sheets', url: 'https://noticia.exemplo/sheets', origem: 'W' },
];

const SP = (dia: string, hora: string) => instanteNoFuso(dia, hora);

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

function sit(over: Partial<EpisodioParaEncadear> = {}): EpisodioParaEncadear {
  const base = {
    apelido: 'ep-01',
    status: 'pacote' as const,
    temTranscricao: true,
    temPacote: false,
    temTitulos: false,
    temPagina: false,
    paginaApagada: false,
    paginaNoAr: false,
    moduloBio: true,
    temNewsletter: false,
    newsletterDescartada: false,
    mioloAprovado: false,
    materias: 2,
    materiasIncompletas: [],
    pecasDescartadas: 0,
    pecas: [],
    ...over,
  };
  // Sem peça nenhuma, todas as matérias estão sem peça; com peças, nenhuma (salvo dito).
  const semPeca = base.pecas.length || base.pecasDescartadas ? [] : Array.from({ length: base.materias }, (_, i) => i + 1);
  return { materiasSemPeca: semPeca, ...base };
}

const pecaSit = (over: Partial<EpisodioParaEncadear['pecas'][number]> = {}) => ({
  formato: 'carrossel' as const,
  status: 'rascunho' as const,
  agendada: false,
  temSlotProposto: false,
  midiaPronta: false,
  ...over,
});

describe('encadeamento: o próximo passo', () => {
  it('antes da transcrição e depois de Agendado a rotina não mexe', () => {
    for (const status of ['roteiro', 'gravacao', 'edicao'] as const) {
      const r = proximoPasso(sit({ status }));
      expect(r).toMatchObject({ passo: 'parar' });
      expect(r.motivo).toMatch(/transcrição chega/);
    }
    for (const status of ['agendado', 'concluido'] as const) {
      expect(proximoPasso(sit({ status })).motivo).toMatch(/do operador/);
    }
  });

  it('a ordem: pacote → página → newsletter → semana → slots, um de cada vez', () => {
    expect(proximoPasso(sit()).passo).toBe('pacote');
    const comPacote = sit({ temPacote: true, temTitulos: true });
    expect(proximoPasso(comPacote).passo).toBe('pagina');
    expect(proximoPasso({ ...comPacote, temPagina: true }).passo).toBe('newsletter');
    expect(proximoPasso({ ...comPacote, temPagina: true, temNewsletter: true }).passo).toBe('semana');
    const comSemana = { ...comPacote, status: 'derivacao' as const, temPagina: true, temNewsletter: true, materiasSemPeca: [], pecas: [pecaSit(), pecaSit({ formato: 'corte' })] };
    expect(proximoPasso(comSemana).passo).toBe('slots');
  });

  it('sem o módulo bio não há página; sem títulos também não (a página segue o pacote)', () => {
    expect(proximoPasso(sit({ temPacote: true, temTitulos: true, moduloBio: false })).passo).toBe('newsletter');
    // Pacote com descrição mas sem título (gerado à mão pela metade): não gera por cima nem monta a página.
    expect(proximoPasso(sit({ temPacote: true, temTitulos: false })).passo).toBe('newsletter');
  });

  it('newsletter (e qualquer passo) sem transcrição para, com o motivo', () => {
    for (const status of STATUS_QUE_ENCADEIAM) {
      const r = proximoPasso(sit({ status, temTranscricao: false, temPacote: true, temTitulos: true, temPagina: true }));
      expect(r.passo).toBe('parar');
      expect(r.motivo).toMatch(/sem transcrição/);
    }
  });

  it('slots só na Derivação: a peça em rascunho no Pacote não ganha slot proposto', () => {
    const noPacote = sit({ temPacote: true, temTitulos: true, temPagina: true, temNewsletter: true, pecas: [pecaSit()] });
    expect(proximoPasso(noPacote).passo).toBe('parar');
    expect(proximoPasso({ ...noPacote, status: 'derivacao' }).passo).toBe('slots');
  });

  it('no fim, para com os motivos: renders pendentes no Mac, página fora do ar, aguardando aprovação', () => {
    const r = proximoPasso(
      sit({
        status: 'derivacao',
        temPacote: true,
        temTitulos: true,
        temPagina: true,
        temNewsletter: true,
        pecas: [pecaSit({ temSlotProposto: true }), pecaSit({ formato: 'story', temSlotProposto: true, midiaPronta: true }), pecaSit({ status: 'aprovada', midiaPronta: true })],
      }),
    );
    expect(r.passo).toBe('parar');
    expect(r.motivo).toContain('1 peça(s) sem render');
    expect(r.motivo).toContain('/root-midia');
    expect(r.motivo).toContain('página de links está montada e fora do ar');
    expect(r.motivo).toContain('2 peça(s) em rascunho aguardando aprovação');
    expect(r.motivo).toContain('1 peça(s) aprovada(s) sem data');
    const semMateria = proximoPasso(sit({ temPacote: true, temNewsletter: true, moduloBio: false, materias: 0 }));
    expect(semMateria.motivo).toMatch(/nenhuma matéria/);
  });

  it('MD4: a mídia pronta é a mesma régua do vigia — o corte com o mp4 no storage não pede render, o só registrado no Mac pede', () => {
    const img = (n: number, tipo?: 'jpeg') => ({ n, chave: `k${n}${tipo ? '.jpg' : ''}`, sha: 's', largura: 1080, altura: 1920, bytes: 1, enviadaEm: 'x', ...(tipo ? { tipo } : {}) });
    const noStorage = { video: { arquivo: '/x.mp4', chave: 'pauta/pecas/p/corte-a.mp4', sha256: 'a'.repeat(64), bytes: 1, duracaoSeg: 1 } };
    expect(midiaProntaDaPeca('corte', noStorage, 'ep-03')).toBe(true);
    expect(midiaProntaDaPeca('corte', { video: { arquivo: '/x.mp4' } }, 'ep-03')).toBe(false);
    expect(midiaProntaDaPeca('corte', {}, 'ep-03')).toBe(false);
    expect(midiaProntaDaPeca('story', { imagens: [img(1), img(1, 'jpeg')] }, 'ep-03')).toBe(true);
    expect(midiaProntaDaPeca('story', { imagens: [img(1)] }, 'ep-03')).toBe(false);
    const fim = (midiaPronta: boolean) =>
      proximoPasso(
        sit({
          status: 'derivacao',
          temPacote: true,
          temTitulos: true,
          temPagina: true,
          paginaNoAr: true,
          temNewsletter: true,
          pecas: [pecaSit({ formato: 'corte', status: 'aprovada', agendada: true, temSlotProposto: true, midiaPronta })],
        }),
      ).motivo;
    expect(fim(midiaProntaDaPeca('corte', noStorage, 'ep-03'))).not.toContain('sem render');
    expect(fim(midiaProntaDaPeca('corte', { video: { arquivo: '/x.mp4' } }, 'ep-03'))).toContain('1 peça(s) sem render');
  });

  it('as etapas da config limitam o caminho; a que ficou de fora não trava as seguintes', () => {
    expect(proximoPasso(sit(), { etapas: ['semana', 'slots'] }).passo).toBe('semana');
    expect(proximoPasso(sit(), { etapas: ['newsletter'] }).passo).toBe('newsletter');
    expect(proximoPasso(sit({ temNewsletter: true }), { etapas: ['newsletter'] }).passo).toBe('parar');
  });

  it('a etapa dispensada (sem insumo) é pulada e aparece no motivo', () => {
    const s = sit({ temPacote: true, temTitulos: true });
    expect(proximoPasso(s, { dispensadas: ['pagina'] }).passo).toBe('newsletter');
    const fim = proximoPasso({ ...s, temNewsletter: true, materias: 0, materiasSemPeca: [] }, { dispensadas: ['pagina'] });
    expect(fim.motivo).toMatch(/montar a página de links.*recusado por falta de insumo/);
  });

  it('o que o operador descartou ou apagou não volta sozinho: semana, newsletter e página param com o motivo', () => {
    const fim = { status: 'derivacao' as const, temPacote: true, temTitulos: true, temPagina: true, temNewsletter: true };
    const semana = proximoPasso(sit({ ...fim, pecasDescartadas: 6 }));
    expect(semana.passo).toBe('parar');
    expect(semana.motivo).toMatch(/peças da semana foram descartadas pelo operador/);

    const news = proximoPasso(sit({ ...fim, temNewsletter: false, newsletterDescartada: true, pecas: [pecaSit({ temSlotProposto: true })] }));
    expect(news.passo).toBe('parar');
    expect(news.motivo).toMatch(/newsletter foi descartada pelo operador/);

    const pagina = proximoPasso(sit({ ...fim, temPagina: false, paginaApagada: true, pecas: [pecaSit({ temSlotProposto: true })] }));
    expect(pagina.passo).toBe('parar');
    expect(pagina.motivo).toMatch(/montada e depois apagada/);
  });

  it('a newsletter do miolo APROVADA segura a da transcrição: trocá-la é decisão humana', () => {
    const r = proximoPasso(sit({ temPacote: true, temTitulos: true, temPagina: true, mioloAprovado: true }));
    expect(r.passo).toBe('semana');
    const fim = proximoPasso(sit({ status: 'derivacao', temPacote: true, temTitulos: true, temPagina: true, mioloAprovado: true, pecas: [pecaSit({ temSlotProposto: true })] }));
    expect(fim.motivo).toMatch(/newsletter do miolo aprovada/);
  });

  it('a semana pela metade volta só às matérias sem peça; a matéria com formato faltando fica para a mão', () => {
    const comPecas = { status: 'derivacao' as const, temPacote: true, temTitulos: true, temPagina: true, temNewsletter: true, materias: 4, pecas: [pecaSit({ temSlotProposto: true })] };
    expect(proximoPasso(sit({ ...comPecas, materiasSemPeca: [3, 4] }))).toEqual({ passo: 'semana', motivo: null, itens: [3, 4] });
    const r = proximoPasso(sit({ ...comPecas, materiasSemPeca: [], materiasIncompletas: [2] }));
    expect(r.passo).toBe('parar');
    expect(r.motivo).toMatch(/matéria\(s\) 2 sem os três formatos/);
  });

  it('NUNCA publica: em qualquer combinação o passo é uma das cinco etapas ou parar', () => {
    const vistos = new Set<string>();
    const bool = [true, false];
    for (const status of PAUTA_EPISODIO_STATUS as readonly PautaEpisodioStatus[])
      for (const temTranscricao of bool)
        for (const temPacote of bool)
          for (const temTitulos of bool)
            for (const temPagina of bool)
              for (const paginaNoAr of bool)
                for (const moduloBio of bool)
                  for (const temNewsletter of bool)
                    for (const pecas of [[], [pecaSit()], [pecaSit({ status: 'aprovada', agendada: true })], [pecaSit({ status: 'publicada', midiaPronta: true })]]) {
                      const r = proximoPasso({
                        apelido: 'ep-09', status, temTranscricao, temPacote, temTitulos, temPagina, paginaApagada: false, paginaNoAr, moduloBio, temNewsletter,
                        newsletterDescartada: false, mioloAprovado: false, materias: 1, materiasSemPeca: pecas.length ? [] : [1], materiasIncompletas: [],
                        pecasDescartadas: 0, pecas,
                      });
                      vistos.add(r.passo);
                      if (!(STATUS_QUE_ENCADEIAM as readonly string[]).includes(status)) expect(r.passo).toBe('parar');
                      if (r.passo === 'pagina') expect(temPagina).toBe(false);
                    }
    expect([...vistos].sort()).toEqual([...PAUTA_ETAPAS_DO_ENCADEAMENTO, 'parar'].sort());
    expect([...vistos].some((p) => /publica|postar|enviar/i.test(p))).toBe(false);
  });
});

describe('encadeamento: as etapas da config', () => {
  it('sem config, todas; com config, na ordem do caminho; ilegível LANÇA (não anda as cinco sem avisar)', () => {
    expect(etapasDaConfig({})).toEqual([...PAUTA_ETAPAS_DO_ENCADEAMENTO]);
    expect(etapasDaConfig(undefined)).toEqual([...PAUTA_ETAPAS_DO_ENCADEAMENTO]);
    expect(etapasDaConfig(null)).toEqual([...PAUTA_ETAPAS_DO_ENCADEAMENTO]);
    expect(etapasDaConfig({ etapas: ['slots', 'pacote'] })).toEqual(['pacote', 'slots']);
    expect(() => etapasDaConfig({ etapas: ['publicar'] })).toThrow(ConfigDoEncadeamentoInvalidaError);
    expect(() => etapasDaConfig({ etapas: ['semana'], horas: 3 })).toThrow(/configuração da rotina/);
    expect(() => etapasDaConfig('semana')).toThrow(ConfigDoEncadeamentoInvalidaError);
  });

  it('o POST /rotinas aceita pauta.encadear com etapas conhecidas, sem repetição, e recusa o resto', () => {
    const tipos = [TIPO_PAUTA_ENCADEAR];
    const ok = lerNovaRotina({ nome: 'Encadeamento da pauta', tipo: 'pauta.encadear', cron: '*/5 * * * *', config: { etapas: ['pacote', 'pacote', 'slots'] } }, tipos);
    expect(ok).toEqual({
      dados: { nome: 'Encadeamento da pauta', slug: 'encadeamento-da-pauta', tipo: 'pauta.encadear', cron: '*/5 * * * *', tz: 'America/Sao_Paulo', estado: 'planejado', config: { etapas: ['pacote', 'slots'] } },
    });
    expect(lerNovaRotina({ nome: 'Encadear', tipo: 'pauta.encadear', cron: '*/5 * * * *', config: {} }, tipos)).toMatchObject({ dados: { config: {} } });
    expect(lerNovaRotina({ nome: 'Encadear', tipo: 'pauta.encadear', cron: '*/5 * * * *', config: { etapas: ['publicar'] } }, tipos)).toMatchObject({ erro: expect.stringMatching(/só aceita etapas/) });
    expect(lerNovaRotina({ nome: 'Encadear', tipo: 'pauta.encadear', cron: '*/5 * * * *', config: { horas: 3 } }, tipos)).toMatchObject({ erro: expect.stringMatching(/só aceita etapas/) });
    expect(lerNovaRotina({ nome: 'Encadear', tipo: 'pauta.encadear', cron: '*/5 * * * *', config: { etapas: [] } }, tipos)).toMatchObject({ erro: expect.any(String) });
  });

  it('o tipo é da pauta: agente editor-de-pauta, módulo pauta, calado por PAUTA_CRON=off; o shared tem o mesmo nome', () => {
    expect(silencioDoTiqueDaPauta({})).toBeNull();
    expect(silencioDoTiqueDaPauta({ PAUTA_CRON: 'off' })).toBe('PAUTA_CRON=off');
    expect(silencioDoTiqueDaPauta({ ROTINAS_CRON: 'off', PAUTA_CRON: 'off' })).toBe('ROTINAS_CRON=off');
    expect(TIPO_PAUTA_ENCADEAR).toBe(PAUTA_TIPO_DA_ROTINA_DE_ENCADEAMENTO);
    expect(TIPOS_DA_PAUTA).toContain(TIPO_PAUTA_ENCADEAR);
    expect(AGENTE_DO_TIPO[TIPO_PAUTA_ENCADEAR]).toBe('editor-de-pauta');
    expect(MODULO_DO_TIPO[TIPO_PAUTA_ENCADEAR]).toBe('pauta');
  });
});

describe('encadeamento: o histórico trava e dispensa', () => {
  const T = new Date('2026-09-25T12:00:00.000Z');
  const passo = (etapa: PautaEtapaDoEncadeamento, resultado: PassoNoRastro['resultado'], atualizadoEm: Date = T): PassoNoRastro => ({
    etapa,
    resultado,
    detalhe: resultado === 'erro' ? 'IA fora do ar' : null,
    episodioAtualizadoEm: atualizadoEm.toISOString(),
    em: '2026-09-25T12:10:00.000Z',
  });

  it(`${ERROS_QUE_TRAVAM} erros seguidos na mesma etapa, com o episódio igual, travam; dois não`, () => {
    expect(leituraDoHistorico([passo('pacote', 'erro'), passo('pacote', 'erro')], T).travada).toBeNull();
    expect(leituraDoHistorico([passo('pacote', 'erro'), passo('pacote', 'erro'), passo('pacote', 'erro')], T)).toMatchObject({ travada: 'pacote', jaAvisada: false });
  });

  it('alguém mexeu (o episódio mudou), outro desfecho no meio ou outra etapa: destrava', () => {
    const outro = new Date('2026-09-25T13:00:00.000Z');
    expect(leituraDoHistorico([passo('pacote', 'erro'), passo('pacote', 'erro'), passo('pacote', 'erro')], outro).travada).toBeNull();
    expect(leituraDoHistorico([passo('pacote', 'erro'), passo('pacote', 'pulada'), passo('pacote', 'erro'), passo('pacote', 'erro')], T).travada).toBeNull();
    expect(leituraDoHistorico([passo('newsletter', 'erro'), passo('pacote', 'erro'), passo('pacote', 'erro')], T).travada).toBeNull();
  });

  it('o aviso de trava não zera a contagem e diz que já foi avisado', () => {
    const h = [passo('semana', 'travada'), passo('semana', 'erro'), passo('semana', 'erro'), passo('semana', 'erro')];
    expect(leituraDoHistorico(h, T)).toMatchObject({ travada: 'semana', jaAvisada: true });
  });

  it('dispensada vale enquanto o episódio não muda; o último passo da etapa é o que conta', () => {
    expect(leituraDoHistorico([passo('pagina', 'dispensada')], T).dispensadas).toEqual(['pagina']);
    expect(leituraDoHistorico([passo('pagina', 'dispensada')], new Date('2026-09-26T00:00:00.000Z')).dispensadas).toEqual([]);
    expect(leituraDoHistorico([passo('pagina', 'ok'), passo('pagina', 'dispensada')], T).dispensadas).toEqual([]);
  });

  it('o registro ilegível do RASTRO é ignorado', () => {
    const quando = new Date('2026-09-25T12:00:00.000Z');
    expect(lerPassoDoRastro(null, quando)).toBeNull();
    expect(lerPassoDoRastro({ etapa: 'publicar', resultado: 'ok' }, quando)).toBeNull();
    expect(lerPassoDoRastro({ etapa: 'pacote', resultado: 'talvez' }, quando)).toBeNull();
    expect(lerPassoDoRastro({ etapa: 'pacote', resultado: 'ok', detalhe: 'x', episodioAtualizadoEm: 'y' }, quando)).toEqual({
      etapa: 'pacote', resultado: 'ok', detalhe: 'x', episodioAtualizadoEm: 'y', em: quando.toISOString(),
    });
  });
});

describe('encadeamento: o desfecho do passo e da passagem', () => {
  it('409 é pulada; 400/403/404 é dispensada; o resto é erro', () => {
    expect(resultadoDoErro(new ConflictException('já está em andamento'))).toBe('pulada');
    expect(resultadoDoErro(new BadRequestException('sem links'))).toBe('dispensada');
    expect(resultadoDoErro(new ForbiddenException('sem bio'))).toBe('dispensada');
    expect(resultadoDoErro(new NotFoundException('sumiu'))).toBe('dispensada');
    expect(resultadoDoErro(new ServiceUnavailableException('IA fora'))).toBe('erro');
    expect(resultadoDoErro(new Error('teto de custo'))).toBe('erro');
  });

  it('nada a fazer = pulada; só pulada/travada = pulada; algum erro LANÇA com a etapa; o resto é ok', () => {
    expect(desfechoDaPassagem([])).toEqual({ status: 'pulada', resumo: 'nenhum episódio com passo a dar' });
    const p = (resultado: 'ok' | 'erro' | 'pulada' | 'dispensada' | 'travada') => ({ episodioId: 'e1', apelido: 'ep-01', etapa: 'semana' as const, resultado, detalhe: 'x' });
    expect(desfechoDaPassagem([p('pulada')]).status).toBe('pulada');
    expect(desfechoDaPassagem([p('pulada'), p('travada')]).status).toBe('pulada');
    expect(desfechoDaPassagem([p('ok'), p('pulada')])).toMatchObject({ status: 'ok', resumo: expect.stringContaining('ep-01 · gerar a semana de posts: ok') });
    expect(desfechoDaPassagem([p('dispensada')]).status).toBe('ok');
    expect(() => desfechoDaPassagem([p('ok'), p('erro')])).toThrow(/gerar a semana de posts: erro/);
  });
});

// ---------------------------------------------------------------------------
// 2. O serviço montado à mão
// ---------------------------------------------------------------------------

type EpFalso = {
  id: string; orgId: string; numero: number; status: PautaEpisodioStatus; rodadaId: string; transcricao: unknown; titulos: unknown;
  descricao: string; thumbs: unknown; bioPageId: string | null; atualizadoEm: Date; bioPage: { publicada: boolean } | null;
  rodada: { itens: unknown };
};
type PecaFalsa = {
  id: string; orgId: string; rodadaId: string; canal: string; formato: string; status: string; meta: Record<string, unknown>;
  agendadaPara: Date | null; slotProposto: Date | null;
};

const TRANSCRICAO = [{ inicio: 0, fim: 30, texto: 'Bom dia, esta é a semana.' }];

function epFalso(n: number, over: Partial<EpFalso> = {}): EpFalso {
  return {
    id: `e${n}`, orgId: ORG, numero: n, status: 'pacote', rodadaId: `r${n}`, transcricao: TRANSCRICAO, titulos: [], descricao: '',
    thumbs: [], bioPageId: null, atualizadoEm: new Date('2026-09-25T12:00:00.000Z'), bioPage: null, rodada: { itens: ITENS }, ...over,
  };
}

function montar(opts: { eps?: EpFalso[]; modulos?: string[]; rotina?: { nome: string; ativo: boolean; estado: string; config: unknown } | null } = {}) {
  const eps = opts.eps ?? [epFalso(1)];
  const pecas: PecaFalsa[] = [];
  const auditoria: Array<Record<string, unknown> & { createdAt: Date }> = [];
  const chamadas: string[] = [];
  let relogio = Date.parse('2026-09-25T12:00:00.000Z');
  const tique = () => new Date((relogio += 1000));
  const falhas: Partial<Record<PautaEtapaDoEncadeamento, () => Error>> = {};

  const achar = (id: string) => eps.find((e) => e.id === id)!;
  const prisma = {
    org: { findUnique: async () => ({ modulos: opts.modulos ?? ['pauta', 'bio'] }) },
    pautaEpisodio: {
      findMany: async ({ where, take }: { where: { orgId: string; status: { in: string[] }; numero?: { gt: number } }; take: number }) =>
        structuredClone(
          eps
            .filter((e) => e.orgId === where.orgId && where.status.in.includes(e.status) && (!where.numero || e.numero > where.numero.gt))
            .sort((a, b) => a.numero - b.numero)
            .slice(0, take),
        ),
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        const e = eps.find((x) => x.id === where.id && x.orgId === where.orgId);
        return e ? structuredClone(e) : null;
      },
    },
    pautaPeca: {
      findMany: async ({ where }: { where: { orgId: string; rodadaId: string; canal: string; formato?: { in: string[] }; status?: { not: string } } }) =>
        structuredClone(
          pecas.filter(
            (p) =>
              p.orgId === where.orgId && p.rodadaId === where.rodadaId && p.canal === where.canal && (!where.status || p.status !== where.status.not) &&
              (!where.formato || where.formato.in.includes(p.formato)),
          ),
        ),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push({ ...data, createdAt: tique() });
        return data;
      },
      findMany: async ({ where, take }: { where: { action: string; entityId: string }; take: number }) =>
        auditoria
          .filter((a) => a.action === where.action && a.entityId === where.entityId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take)
          .map((a) => ({ after: a.after, createdAt: a.createdAt })),
      findFirst: async ({ where }: { where: { action: string; entityType: string; entityId: string } }) =>
        auditoria.find((a) => a.action === where.action && a.entityType === where.entityType && a.entityId === where.entityId) ?? null,
    },
    rotina: { findFirst: async () => opts.rotina ?? null },
  } as unknown as PrismaService;

  const passo = (etapa: PautaEtapaDoEncadeamento, id: string) => {
    chamadas.push(`${etapa}:${id}`);
    const f = falhas[etapa];
    if (f) throw f();
  };
  const pacotes = {
    gerar: async (_o: string, id: string) => {
      passo('pacote', id);
      const e = achar(id);
      e.titulos = [{ texto: 'A IA ficou mais barata', angulo: 'resultado' }];
      e.descricao = 'Descrição';
      e.atualizadoEm = tique();
      return { episodio: { titulos: e.titulos, thumbs: [] }, avisos: [], correcoes: [] };
    },
  } as unknown as PacoteService;
  const publicou: string[] = [];
  const paginas = {
    montar: async (_o: string, id: string, quem: { sub: string; permissions: string[] }) => {
      passo('pagina', id);
      expect(quem.permissions).not.toContain('bio.editar');
      const e = achar(id);
      e.bioPageId = `bp-${id}`;
      e.bioPage = { publicada: false };
      e.atualizadoEm = tique();
      auditoria.push({ orgId: ORG, action: ACAO_DA_MONTAGEM_DA_PAGINA, entityType: 'pauta_episodio', entityId: id, createdAt: tique() });
      return { criados: 2, atualizados: 0, desativados: 0, avisos: [] };
    },
    publicar: async (_o: string, id: string) => void publicou.push(id),
  };
  const newsletters = {
    gerar: async (_o: string, id: string) => {
      passo('newsletter', id);
      const e = achar(id);
      pecas.push({ id: `nl-${id}`, orgId: ORG, rodadaId: e.rodadaId, canal: 'newsletter', formato: 'email', status: 'rascunho', meta: { origem: 'transcricao', episodioId: id }, agendadaPara: null, slotProposto: null });
      return { newsletter: { checagem: { aprovada: true, apontamentos: [] } } };
    },
  } as unknown as NewsletterService;
  /** As matérias (1…) em que o dublê da semana "falha": a IA ou o teto cortou ali. */
  const falhaNaSemana = new Set<number>();
  const pedidosDaSemana: Array<number[] | undefined> = [];
  const semana = {
    gerar: async (_o: string, id: string, _a: string, o: { substituir: boolean; itens?: number[] }) => {
      passo('semana', id);
      pedidosDaSemana.push(o.itens);
      const e = achar(id);
      let criadas = 0;
      let falharam = 0;
      for (const [n, item] of ITENS.entries()) {
        if (o.itens && !o.itens.includes(n + 1)) continue;
        if (falhaNaSemana.has(n + 1)) {
          falharam += 3;
          continue;
        }
        criadas += 3;
        for (const formato of ['carrossel', 'story', 'corte']) {
          pecas.push({
            id: `${id}-m${n + 1}-${formato}`, orgId: ORG, rodadaId: e.rodadaId, canal: 'instagram', formato, status: 'rascunho',
            meta: { episodioId: id, itemId: item.id, itemN: n + 1, formato, imagens: [], video: null }, agendadaPara: null, slotProposto: null,
          });
        }
      }
      if (!criadas) throw new ServiceUnavailableException('Nenhuma peça foi gravada.');
      e.status = 'derivacao';
      e.atualizadoEm = tique();
      return { conta: { criadas, substituidas: 0, mantidas: 0, falharam }, avisos: falharam ? ['Matéria 2: JSON inválido do modelo'] : [] };
    },
  } as unknown as DerivacaoService;
  const distribuiu: string[] = [];
  const agenda = {
    proporSlots: async (_o: string, id: string) => {
      passo('slots', id);
      const e = achar(id);
      let n = 0;
      for (const p of pecas.filter((x) => x.rodadaId === e.rodadaId && x.canal === 'instagram' && x.status === 'rascunho' && !x.slotProposto)) {
        p.slotProposto = SP('2026-09-28', '12:00');
        n++;
      }
      return { propostas: n, semVaga: 0, avisos: [] };
    },
    distribuir: async (_o: string, id: string) => void distribuiu.push(id),
  } as unknown as AgendaService;

  const svc = new EncadeamentoService(prisma, new AuditService(prisma), pacotes, paginas as unknown as never, newsletters, semana, agenda);
  const passagem = (over: Partial<Passagem> = {}): Passagem => ({
    orgId: ORG, rotinaId: 'rot-1', correlationId: 'rotina-abc', origem: 'cron', etapas: PAUTA_ETAPAS_DO_ENCADEAMENTO, ...over,
  });
  return { svc, eps, pecas, auditoria, chamadas, falhas, falhaNaSemana, pedidosDaSemana, publicou, distribuiu, passagem, tique };
}

describe('encadeamento: o serviço anda um passo por passagem', () => {
  it('da transcrição à semana em rascunho em 5 passagens, um evento por etapa, sem publicar nada', async () => {
    const m = montar();
    const desfechos: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await m.svc.passar(m.passagem());
      expect(r).toHaveLength(1);
      desfechos.push(`${r[0].etapa}:${r[0].resultado}`);
    }
    expect(desfechos).toEqual(['pacote:ok', 'pagina:ok', 'newsletter:ok', 'semana:ok', 'slots:ok']);
    expect(m.chamadas).toEqual(['pacote:e1', 'pagina:e1', 'newsletter:e1', 'semana:e1', 'slots:e1']);

    // A sexta passagem não tem o que fazer: a semana está com o operador.
    expect(await m.svc.passar(m.passagem())).toEqual([]);
    expect(m.eps[0].status).toBe('derivacao');
    expect(m.pecas.filter((p) => p.canal === 'instagram')).toHaveLength(6);
    expect(m.pecas.filter((p) => p.canal === 'instagram').every((p) => p.status === 'rascunho' && p.slotProposto && p.agendadaPara === null)).toBe(true);
    expect(m.eps[0].bioPage).toEqual({ publicada: false });
    expect(m.publicou).toEqual([]);
    expect(m.distribuiu).toEqual([]);

    const eventos = m.auditoria.filter((a) => a.action === ACAO_DO_PASSO);
    expect(eventos.map((a) => (a.after as { etapa: string }).etapa)).toEqual([...PAUTA_ETAPAS_DO_ENCADEAMENTO]);
    for (const ev of eventos) {
      expect(ev).toMatchObject({
        actorType: 'system',
        entityType: 'pauta_episodio',
        entityId: 'e1',
        after: { episodio: 'ep-01', resultado: 'ok' },
        metadata: { correlationId: 'rotina-abc', rotinaId: 'rot-1', origem: 'cron' },
      });
    }
  });

  it(`no máximo ${TETO_DE_EPISODIOS_POR_PASSAGEM} episódios por passagem, do mais velho`, async () => {
    const m = montar({ eps: [epFalso(3), epFalso(1), epFalso(2)] });
    const r = await m.svc.passar(m.passagem());
    expect(r.map((p) => p.apelido)).toEqual(['ep-01', 'ep-02']);
    expect(m.chamadas).toEqual(['pacote:e1', 'pacote:e2']);
  });

  it('as etapas da config: só semana e slots, sem pacote, página nem newsletter', async () => {
    const m = montar();
    const etapas = ['semana', 'slots'] as const;
    await m.svc.passar(m.passagem({ etapas }));
    await m.svc.passar(m.passagem({ etapas }));
    expect(await m.svc.passar(m.passagem({ etapas }))).toEqual([]);
    expect(m.chamadas).toEqual(['semana:e1', 'slots:e1']);
  });

  it('erro de IA não avança; três seguidos travam a etapa (aviso uma vez só) até alguém mexer ou rodar à mão', async () => {
    const m = montar();
    m.falhas.pacote = () => new ServiceUnavailableException('IA não configurada');
    for (let i = 0; i < ERROS_QUE_TRAVAM; i++) {
      const r = await m.svc.passar(m.passagem());
      expect(r[0]).toMatchObject({ etapa: 'pacote', resultado: 'erro', detalhe: 'IA não configurada' });
      expect(() => desfechoDaPassagem(r)).toThrow(/pacote do YouTube: erro/);
    }
    const travada = await m.svc.passar(m.passagem());
    expect(travada[0]).toMatchObject({ etapa: 'pacote', resultado: 'travada' });
    expect(desfechoDaPassagem(travada).status).toBe('pulada');
    await m.svc.passar(m.passagem());
    expect(m.chamadas).toHaveLength(ERROS_QUE_TRAVAM);
    expect(m.auditoria.filter((a) => (a.after as { resultado?: string }).resultado === 'travada')).toHaveLength(1);

    // O "Rodar agora" tenta de novo.
    delete m.falhas.pacote;
    const manual = await m.svc.passar(m.passagem({ origem: 'manual' }));
    expect(manual[0]).toMatchObject({ etapa: 'pacote', resultado: 'ok' });
  });

  it('alguém mexeu no episódio: a trava cai sozinha', async () => {
    const m = montar();
    m.falhas.newsletter = () => new Error('teto de custo de IA atingido');
    m.eps[0].titulos = [{ texto: 'x' }];
    m.eps[0].bioPageId = 'bp';
    for (let i = 0; i < ERROS_QUE_TRAVAM; i++) await m.svc.passar(m.passagem());
    expect((await m.svc.passar(m.passagem()))[0].resultado).toBe('travada');
    m.eps[0].atualizadoEm = m.tique();
    delete m.falhas.newsletter;
    expect((await m.svc.passar(m.passagem()))[0]).toMatchObject({ etapa: 'newsletter', resultado: 'ok' });
  });

  it('a página sem insumo (400) é dispensada e a rotina segue para a newsletter', async () => {
    const m = montar();
    m.eps[0].titulos = [{ texto: 'x' }];
    m.falhas.pagina = () => new BadRequestException('Nenhuma matéria mantida tem link público');
    expect((await m.svc.passar(m.passagem()))[0]).toMatchObject({ etapa: 'pagina', resultado: 'dispensada' });
    expect((await m.svc.passar(m.passagem()))[0]).toMatchObject({ etapa: 'newsletter', resultado: 'ok' });
  });

  it('o "Rodar agora" passa por cima da dispensa: o insumo que faltava pode morar fora do episódio', async () => {
    const m = montar();
    m.eps[0].titulos = [{ texto: 'x' }];
    m.falhas.pagina = () => new BadRequestException('Nenhuma matéria mantida tem link público');
    expect((await m.svc.passar(m.passagem()))[0]).toMatchObject({ etapa: 'pagina', resultado: 'dispensada' });
    // O link foi posto na rodada (fora do episódio): o relógio seguiria pulando a página.
    delete m.falhas.pagina;
    expect((await m.svc.passar(m.passagem({ origem: 'manual' })))[0]).toMatchObject({ etapa: 'pagina', resultado: 'ok' });
  });

  it('o descarte e a página apagada pela pessoa ficam: a passagem seguinte para, sem chamar a IA', async () => {
    const m = montar();
    for (let i = 0; i < 5; i++) await m.svc.passar(m.passagem());
    const antes = [...m.chamadas];
    // Descartar tudo pela tela (o PATCH devolve o slot) e apagar a página no /bio (onDelete SetNull).
    for (const p of m.pecas) {
      p.status = 'descartada';
      p.slotProposto = null;
    }
    m.eps[0].bioPageId = null;
    m.eps[0].bioPage = null;

    expect(await m.svc.passar(m.passagem())).toEqual([]);
    expect(await m.svc.passar(m.passagem({ origem: 'manual' }))).toEqual([]);
    expect(m.chamadas).toEqual(antes);
    const r = await m.svc.doEpisodio(ORG, 'e1');
    expect(r.passo).toBe('parar');
    expect(r.motivo).toMatch(/newsletter foi descartada pelo operador/);
    expect(r.motivo).toMatch(/peças da semana foram descartadas pelo operador/);
    expect(r.motivo).toMatch(/montada e depois apagada/);
  });

  it('a newsletter do miolo aprovada não é descartada pela rotina', async () => {
    const m = montar({ eps: [epFalso(1, { titulos: [{ texto: 'x' }], descricao: 'd', bioPageId: 'bp' })] });
    m.pecas.push({ id: 'miolo', orgId: ORG, rodadaId: 'r1', canal: 'newsletter', formato: 'email', status: 'aprovada', meta: {}, agendadaPara: null, slotProposto: null });
    expect((await m.svc.passar(m.passagem()))[0]).toMatchObject({ etapa: 'semana', resultado: 'ok' });
    expect(m.chamadas).not.toContain('newsletter:e1');
    expect(m.pecas.find((p) => p.id === 'miolo')?.status).toBe('aprovada');
  });

  it('a semana pela metade é erro e não avança para os slots: a passagem seguinte refaz só a matéria que ficou sem peça', async () => {
    const m = montar();
    const etapas = ['semana', 'slots'] as const;
    m.falhaNaSemana.add(2);
    const r1 = await m.svc.passar(m.passagem({ etapas }));
    expect(r1[0]).toMatchObject({ etapa: 'semana', resultado: 'erro', detalhe: expect.stringMatching(/3 peça\(s\) em rascunho, 3 falharam: Matéria 2/) });
    expect(() => desfechoDaPassagem(r1)).toThrow(/gerar a semana de posts: erro/);
    // Segue sem a matéria 2: continua na semana, só com ela, e não passa aos slots.
    expect((await m.svc.passar(m.passagem({ etapas })))[0]).toMatchObject({ etapa: 'semana', resultado: 'erro' });
    m.falhaNaSemana.clear();
    expect((await m.svc.passar(m.passagem({ etapas })))[0]).toMatchObject({ etapa: 'semana', resultado: 'ok' });
    expect((await m.svc.passar(m.passagem({ etapas })))[0]).toMatchObject({ etapa: 'slots', resultado: 'ok' });
    expect(m.pedidosDaSemana).toEqual([[1, 2], [2], [2]]);
    expect(m.pecas.filter((p) => p.canal === 'instagram')).toHaveLength(6);
  });

  it(`os parados não escondem o novo: com ${LOTE_DE_CANDIDATOS + 1} episódios parados na Derivação, o mais novo ganha o passo`, async () => {
    const parados = Array.from({ length: LOTE_DE_CANDIDATOS + 1 }, (_, i) =>
      epFalso(i + 1, { status: 'derivacao', titulos: [{ texto: 'x' }], descricao: 'd', bioPageId: `bp${i}`, bioPage: { publicada: false }, rodada: { itens: [] } }),
    );
    const novo = epFalso(LOTE_DE_CANDIDATOS + 2);
    const m = montar({ eps: [...parados, novo] });
    for (const e of parados) {
      m.pecas.push({ id: `nl-${e.id}`, orgId: ORG, rodadaId: e.rodadaId, canal: 'newsletter', formato: 'email', status: 'rascunho', meta: { origem: 'transcricao', episodioId: e.id }, agendadaPara: null, slotProposto: null });
    }
    const r = await m.svc.passar(m.passagem());
    expect(r).toEqual([expect.objectContaining({ episodioId: novo.id, etapa: 'pacote', resultado: 'ok' })]);
    expect(m.chamadas).toEqual([`pacote:${novo.id}`]);
  });
});

describe('encadeamento: o clique manual no meio vira pulada, sem segunda cobrança', () => {
  const soltar: Array<() => void> = [];
  afterEach(() => {
    for (const s of soltar.splice(0)) s();
  });
  /** Segura a chave do `umaPorVez` como o clique manual em curso seguraria. */
  const segurar = (chave: string) => {
    let fim: () => void = () => {};
    const p = umaPorVez(chave, 'O clique manual', () => new Promise<void>((r) => (fim = r)));
    soltar.push(() => {
      fim();
      void p;
    });
  };
  const llmEspiao = () => {
    const chamadas: unknown[] = [];
    const llm = { name: 'duble', model: 'duble', configured: true, complete: async (x: unknown) => void chamadas.push(x) } as unknown as LlmProvider;
    return { llm, chamadas };
  };

  it('"Gerar semana" em andamento: o DerivacaoService DE VERDADE recusa com a mesma chave e a IA não é chamada', async () => {
    const m = montar();
    m.eps[0].titulos = [{ texto: 'x' }];
    m.eps[0].bioPageId = 'bp';
    m.pecas.push({ id: 'nl', orgId: ORG, rodadaId: 'r1', canal: 'newsletter', formato: 'email', status: 'rascunho', meta: { origem: 'transcricao', episodioId: 'e1' }, agendadaPara: null, slotProposto: null });
    const { llm, chamadas } = llmEspiao();
    const real = new DerivacaoService({} as never, {} as never, llm, {} as never, {} as never, {} as never, semMarca);
    (m.svc as unknown as { semana: DerivacaoService }).semana = real;
    segurar(`pauta-semana:${ORG}:e1`);

    const r = await m.svc.passar(m.passagem());
    expect(r[0]).toMatchObject({ etapa: 'semana', resultado: 'pulada', detalhe: expect.stringMatching(/já está em andamento/) });
    expect(desfechoDaPassagem(r).status).toBe('pulada');
    expect(chamadas).toEqual([]);
    expect(m.auditoria.at(-1)).toMatchObject({ action: ACAO_DO_PASSO, after: { etapa: 'semana', resultado: 'pulada' } });
  });

  it('o pacote e a newsletter também: a chave do clique é a do serviço', async () => {
    const { llm, chamadas } = llmEspiao();
    const m = montar();
    (m.svc as unknown as { pacotes: PacoteService }).pacotes = new PacoteService({} as never, {} as never, llm, {} as never, {} as never, {} as never, semMarca);
    segurar(`pauta-pacote:${ORG}:e1`);
    expect((await m.svc.passar(m.passagem()))[0].resultado).toBe('pulada');

    const n = montar({ eps: [epFalso(1, { titulos: [{ texto: 'x' }], descricao: 'd', bioPageId: 'bp' })] });
    (n.svc as unknown as { newsletters: NewsletterService }).newsletters = new NewsletterService({} as never, {} as never, llm, {} as never, {} as never, semMarca);
    segurar(`pauta-newsletter:${ORG}:e1`);
    expect((await n.svc.passar(n.passagem()))[0]).toMatchObject({ etapa: 'newsletter', resultado: 'pulada' });
    expect(chamadas).toEqual([]);
  });
});

describe('encadeamento: GET /pauta/episodios/:id/encadeamento', () => {
  it('diz o próximo passo, a rotina (ou a falta dela) e os últimos passos', async () => {
    const sem = montar();
    expect(await sem.svc.doEpisodio(ORG, 'e1')).toMatchObject({
      episodioId: 'e1', passo: 'pacote', motivo: null, etapas: [...PAUTA_ETAPAS_DO_ENCADEAMENTO], rotina: { existe: false, dispara: false, nome: null }, ultimos: [],
    });
    await expect(sem.svc.doEpisodio(ORG, 'nao-existe')).rejects.toThrow(NotFoundException);

    const com = montar({ rotina: { nome: 'Encadeamento da pauta', ativo: true, estado: 'rodando', config: { etapas: ['newsletter'] } } });
    await com.svc.passar(com.passagem({ etapas: ['newsletter'] }));
    expect(await com.svc.doEpisodio(ORG, 'e1')).toMatchObject({
      passo: 'parar', etapas: ['newsletter'], rotina: { existe: true, dispara: true, nome: 'Encadeamento da pauta' },
      ultimos: [{ etapa: 'newsletter', resultado: 'ok' }],
    });
    const pausada = montar({ rotina: { nome: 'x', ativo: true, estado: 'planejado', config: {} } });
    expect((await pausada.svc.doEpisodio(ORG, 'e1')).rotina.dispara).toBe(false);
  });

  it('com o tique calado por variável, a rotina não "dispara"; a config ilegível aparece como parada', async () => {
    const antes = process.env.PAUTA_CRON;
    process.env.PAUTA_CRON = 'off';
    try {
      const m = montar({ rotina: { nome: 'Encadeamento da pauta', ativo: true, estado: 'rodando', config: {} } });
      expect((await m.svc.doEpisodio(ORG, 'e1')).rotina).toEqual({ existe: true, dispara: false, nome: 'Encadeamento da pauta', calada: 'PAUTA_CRON=off' });
    } finally {
      if (antes === undefined) delete process.env.PAUTA_CRON;
      else process.env.PAUTA_CRON = antes;
    }
    const ruim = montar({ rotina: { nome: 'x', ativo: true, estado: 'rodando', config: { etapas: ['publicar'] } } });
    const r = await ruim.svc.doEpisodio(ORG, 'e1');
    expect(r).toMatchObject({ passo: 'parar', etapas: [], motivo: expect.stringMatching(/A rotina falha a cada passagem: configuração da rotina/) });
  });

  it('a etapa travada aparece como parada, com o último erro', async () => {
    const m = montar();
    m.falhas.pacote = () => new ServiceUnavailableException('JSON inválido do modelo');
    for (let i = 0; i < ERROS_QUE_TRAVAM; i++) await m.svc.passar(m.passagem());
    const r = await m.svc.doEpisodio(ORG, 'e1');
    expect(r.passo).toBe('parar');
    expect(r.motivo).toMatch(/Três erros seguidos.*JSON inválido do modelo/);
  });

  it('a rota é só leitura, com pauta.ver', () => {
    const permissoes = Reflect.getMetadata(PERMISSIONS_KEY, EncadeamentoController.prototype.doEpisodio);
    expect(permissoes).toEqual(['pauta.ver']);
  });
});

// ---------------------------------------------------------------------------
// 3. Os slots propostos
// ---------------------------------------------------------------------------

type EpAgenda = {
  id: string; orgId: string; numero: number; titulo: string; status: PautaEpisodioStatus; rodadaId: string; roteiro: string; midia: unknown;
  transcricao: unknown; transcricaoTexto: string; titulos: unknown; thumbs: unknown; descricao: string; bioPageId: string | null;
  criadoPor: string | null; criadoEm: Date; atualizadoEm: Date;
  rodada: { titulo: string; itens: unknown; janelaIni: Date; janelaFim: Date };
};

function epAgenda(id: string, over: Partial<EpAgenda> = {}): EpAgenda {
  return {
    id, orgId: ORG, numero: Number(id.slice(1)), titulo: `Semana ${id}`, status: 'derivacao', rodadaId: `r-${id}`, roteiro: '', midia: null,
    transcricao: [], transcricaoTexto: '', titulos: [], thumbs: [], descricao: '', bioPageId: null, criadoPor: PESSOA,
    criadoEm: new Date('2026-09-20T12:00:00.000Z'), atualizadoEm: new Date('2026-09-24T12:00:00.000Z'),
    rodada: { titulo: 'Semana', itens: ITENS, janelaIni: new Date('2026-09-17T00:00:00.000Z'), janelaFim: new Date('2026-09-24T00:00:00.000Z') },
    ...over,
  };
}

type PecaAgenda = PecaFalsa & { titulo: string; corpo: string; criadaEm: Date; publicadaEm: Date | null; publicadaPor: string | null; externalId: string | null; urlPublicada: string | null; erro: string | null };
let seq = 0;
function pecaAgenda(episodioId: string, formato: 'carrossel' | 'story' | 'corte', itemN: number, over: Partial<PecaAgenda> = {}): PecaAgenda {
  return {
    id: `pa${++seq}`, orgId: ORG, rodadaId: `r-${episodioId}`, canal: 'instagram', formato, titulo: `${formato} ${itemN}`, corpo: 'Legenda',
    meta: { episodioId, itemId: `c${itemN}`, itemN, formato, imagens: [], avisos: [], transcricaoSha: 'x' }, status: 'rascunho',
    agendadaPara: null, slotProposto: null, criadaEm: new Date(Date.parse('2026-09-24T12:00:00.000Z') + seq * 1000), publicadaEm: null,
    publicadaPor: null, externalId: null, urlPublicada: null, erro: null, ...over,
  };
}

function casa(obj: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Array<Record<string, unknown>>).some((w) => casa(obj, w));
    const atual = obj[k];
    if (v === null) return atual === null || atual === undefined;
    if (v instanceof Date) return atual instanceof Date && atual.getTime() === v.getTime();
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('in' in o) return (o.in as unknown[]).includes(atual);
      if ('not' in o) return o.not === null ? atual !== null && atual !== undefined : atual !== o.not;
      if (!(atual instanceof Date)) return false;
      if (o.gte instanceof Date && atual.getTime() < o.gte.getTime()) return false;
      if (o.lt instanceof Date && atual.getTime() >= o.lt.getTime()) return false;
      return true;
    }
    return atual === v;
  });
}

function agendaFalsa(opts: { pecas: PecaAgenda[]; episodios: EpAgenda[]; agora: string }) {
  const { pecas } = opts;
  const auditoria: Array<Record<string, unknown>> = [];
  const travas: string[] = [];
  const prisma = {
    pautaEpisodio: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        const e = opts.episodios.find((x) => x.id === where.id && x.orgId === where.orgId);
        return e ? structuredClone(e) : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        structuredClone(opts.episodios.filter((e) => casa(e as unknown as Record<string, unknown>, where))),
    },
    pautaPeca: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => structuredClone(pecas.filter((p) => casa(p, where))),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const p = pecas.find((x) => casa(x, where));
        return p ? structuredClone(p) : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => structuredClone(pecas.find((x) => x.id === where.id) ?? null),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = pecas.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return structuredClone(p);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const alvo = pecas.filter((p) => casa(p, where));
        for (const p of alvo) Object.assign(p, data);
        return { count: alvo.length };
      },
    },
    $executeRaw: async (_partes: TemplateStringsArray, ...valores: unknown[]) => {
      travas.push(String(valores[0]));
      return 1;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
    // MD6: a agenda lê a publicação de cada peça; aqui nenhuma foi pedida.
    pautaPublicacao: { findMany: async () => [] },
  } as unknown as PrismaService;
  const memoria = { porChave: async () => null } as unknown as MemoriaService;
  const audit = new AuditService(prisma);
  const agenda = new AgendaService(prisma, audit, memoria, new EpisodioService(prisma, audit));
  agenda.agora = () => new Date(opts.agora);
  return { agenda, prisma, auditoria, travas };
}

describe('encadeamento: os slots propostos', () => {
  // Sexta, 25/09/2026, meio-dia em São Paulo: a proposta começa no sábado 26.
  const AGORA = '2026-09-25T15:00:00.000Z';

  it('só as peças em rascunho, do dia seguinte em diante, sem colidir com a agenda nem com o proposto de outro episódio', async () => {
    const e1 = ['carrossel', 'story', 'corte'].flatMap((f) => [1, 2].map((n) => pecaAgenda('e1', f as 'carrossel', n)));
    const aprovadaDoE1 = pecaAgenda('e1', 'carrossel', 3, { status: 'aprovada' });
    const doE2 = pecaAgenda('e2', 'carrossel', 1, { slotProposto: SP('2026-09-28', '12:00') });
    const agendadaDoE3 = pecaAgenda('e3', 'story', 1, { status: 'aprovada', agendadaPara: SP('2026-09-28', '09:00') });
    const descartadaDoE3 = pecaAgenda('e3', 'corte', 1, { status: 'descartada', slotProposto: SP('2026-09-29', '18:00') });
    const pecas = [...e1, aprovadaDoE1, doE2, agendadaDoE3, descartadaDoE3];
    const s = agendaFalsa({ pecas, episodios: [epAgenda('e1'), epAgenda('e2'), epAgenda('e3')], agora: AGORA });

    const r = await s.agenda.proporSlots(ORG, 'e1', 'rotina');
    expect(r).toMatchObject({ propostas: 6, semVaga: 0 });
    const slot = (id: string) => pecas.find((p) => p.id === id)!.slotProposto?.toISOString();
    const de = (f: string, n: number) => e1.find((p) => p.formato === f && (p.meta.itemN as number) === n)!.id;
    // Seg 28 12h (carrossel) é do e2 e seg 9h (story) é agenda do e3: a matéria 1 vai para depois.
    expect(slot(de('carrossel', 1))).toBe(SP('2026-09-30', '12:00').toISOString());
    expect(slot(de('carrossel', 2))).toBe(SP('2026-10-02', '12:00').toISOString());
    expect(slot(de('story', 1))).toBe(SP('2026-09-29', '09:00').toISOString());
    expect(slot(de('story', 2))).toBe(SP('2026-09-30', '09:00').toISOString());
    // A descartada do e3 não segura a terça 18h.
    expect(slot(de('corte', 1))).toBe(SP('2026-09-29', '18:00').toISOString());
    expect(slot(de('corte', 2))).toBe(SP('2026-10-01', '18:00').toISOString());

    expect(pecas.every((p) => p.agendadaPara === null || p.id === agendadaDoE3.id)).toBe(true);
    expect(aprovadaDoE1.slotProposto).toBeNull();
    expect(doE2.slotProposto?.toISOString()).toBe(SP('2026-09-28', '12:00').toISOString());
    expect(s.travas).toEqual([`pauta-agenda:${ORG}`]);
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.semana_proposta', entityId: 'e1', after: { desde: SP('2026-09-26', '00:00').toISOString(), semVaga: 0 } });

    // Passar de novo não mexe no que já tem proposta.
    expect(await s.agenda.proporSlots(ORG, 'e1', 'rotina')).toMatchObject({ propostas: 0, semVaga: 0 });
  });

  it('uma peça nova do mesmo episódio não cai no slot já proposto para outra', async () => {
    const velha = pecaAgenda('e1', 'carrossel', 1, { slotProposto: SP('2026-09-28', '12:00') });
    const nova = pecaAgenda('e1', 'carrossel', 2);
    const s = agendaFalsa({ pecas: [velha, nova], episodios: [epAgenda('e1')], agora: AGORA });
    await s.agenda.proporSlots(ORG, 'e1', 'rotina');
    expect(nova.slotProposto?.toISOString()).toBe(SP('2026-09-30', '12:00').toISOString());
  });

  it('fora da Derivação/Agendado é 400 (a rotina lê como dispensada)', async () => {
    const s = agendaFalsa({ pecas: [pecaAgenda('e1', 'carrossel', 1)], episodios: [epAgenda('e1', { status: 'pacote' })], agora: AGORA });
    await expect(s.agenda.proporSlots(ORG, 'e1', 'rotina')).rejects.toThrow(BadRequestException);
  });

  it('aprovar pelo PATCH de status NÃO converte o slot proposto em agenda; descartar devolve o slot', async () => {
    const a = pecaAgenda('e1', 'carrossel', 1, { slotProposto: SP('2026-09-28', '12:00') });
    const b = pecaAgenda('e1', 'story', 1, { slotProposto: SP('2026-09-28', '09:00') });
    const s = agendaFalsa({ pecas: [a, b], episodios: [epAgenda('e1')], agora: AGORA });
    const rotinas = new RotinaService(s.prisma, new AuditService(s.prisma), {} as never);
    await rotinas.editarPeca(ORG, a.id, PESSOA, { status: 'aprovada' });
    expect(a).toMatchObject({ status: 'aprovada', agendadaPara: null });
    expect(a.slotProposto?.toISOString()).toBe(SP('2026-09-28', '12:00').toISOString());
    await rotinas.editarPeca(ORG, b.id, PESSOA, { status: 'descartada' });
    expect(b).toMatchObject({ status: 'descartada', slotProposto: null });
  });

  it('distribuir (à mão) põe a aprovada no slot proposto dela quando ainda está livre', async () => {
    const noProposto = pecaAgenda('e1', 'carrossel', 1, { status: 'aprovada', slotProposto: SP('2026-09-30', '12:00') });
    const semProposta = pecaAgenda('e1', 'corte', 1, { status: 'aprovada' });
    const tomado = pecaAgenda('e1', 'story', 1, { status: 'aprovada', slotProposto: SP('2026-09-28', '09:00') });
    const deOutro = pecaAgenda('e2', 'story', 1, { status: 'aprovada', agendadaPara: SP('2026-09-28', '09:00') });
    const s = agendaFalsa({ pecas: [noProposto, semProposta, tomado, deOutro], episodios: [epAgenda('e1'), epAgenda('e2')], agora: AGORA });
    const r = await s.agenda.distribuir(ORG, 'e1', PESSOA, {});
    expect(r.conta).toEqual({ alocadas: 3, jaAgendadas: 0, semVaga: 0 });
    expect(noProposto.agendadaPara?.toISOString()).toBe(SP('2026-09-30', '12:00').toISOString());
    expect(semProposta.agendadaPara?.toISOString()).toBe(SP('2026-09-29', '18:00').toISOString());
    // A segunda 9h já era do e2: o story vai ao próximo livre.
    expect(tomado.agendadaPara?.toISOString()).toBe(SP('2026-09-29', '09:00').toISOString());
  });

  it('distribuir (à mão) não põe a aprovada sem proposta no slot proposto a uma irmã em rascunho', async () => {
    // Sexta 13h em São Paulo: o carrossel de sexta 12h já passou; o primeiro livre é seg 28.
    const irma = pecaAgenda('e1', 'carrossel', 2, { slotProposto: SP('2026-09-28', '12:00') });
    const aprovada = pecaAgenda('e1', 'carrossel', 1, { status: 'aprovada' });
    const s = agendaFalsa({ pecas: [irma, aprovada], episodios: [epAgenda('e1')], agora: '2026-09-25T16:00:00.000Z' });
    const r = await s.agenda.distribuir(ORG, 'e1', PESSOA, {});
    expect(r.conta).toEqual({ alocadas: 1, jaAgendadas: 0, semVaga: 0 });
    expect(aprovada.agendadaPara?.toISOString()).toBe(SP('2026-09-30', '12:00').toISOString());
    expect(irma).toMatchObject({ status: 'rascunho', agendadaPara: null });
    expect(irma.slotProposto?.toISOString()).toBe(SP('2026-09-28', '12:00').toISOString());
  });

  it('distribuir (à mão) só aceita o proposto que ainda está na grade: grade editada ou feriado depois da proposta vão ao próximo livre', async () => {
    // 14h não é slot de carrossel na grade (a grade mudou); 12/10/2026 é feriado nacional.
    const foraDaGrade = pecaAgenda('e1', 'carrossel', 1, { status: 'aprovada', slotProposto: SP('2026-09-28', '14:00') });
    const noFeriado = pecaAgenda('e1', 'carrossel', 2, { status: 'aprovada', slotProposto: SP('2026-10-12', '12:00') });
    const s = agendaFalsa({ pecas: [foraDaGrade, noFeriado], episodios: [epAgenda('e1')], agora: '2026-09-25T16:00:00.000Z' });
    const r = await s.agenda.distribuir(ORG, 'e1', PESSOA, {});
    expect(r.conta.alocadas).toBe(2);
    expect(foraDaGrade.agendadaPara?.toISOString()).toBe(SP('2026-09-28', '12:00').toISOString());
    expect(noFeriado.agendadaPara?.toISOString()).toBe(SP('2026-09-30', '12:00').toISOString());
  });

  it('a semana mostra o proposto no slot, sem agenda, com o slot na peça', async () => {
    const proposta = pecaAgenda('e1', 'carrossel', 1, { slotProposto: SP('2026-09-28', '12:00') });
    const descartada = pecaAgenda('e1', 'corte', 1, { status: 'descartada', slotProposto: SP('2026-09-29', '18:00') });
    const s = agendaFalsa({ pecas: [proposta, descartada], episodios: [epAgenda('e1')], agora: AGORA });
    const a = await s.agenda.semana(ORG, '2026-09-28');
    const seg = a.dias[0].linhas.find((l) => l.formato === 'carrossel')!;
    expect(seg).toMatchObject({ daGrade: true, peca: { id: proposta.id, status: 'rascunho', agendadaPara: null, slotProposto: SP('2026-09-28', '12:00').toISOString() } });
    expect(JSON.stringify(a.dias)).not.toContain(descartada.id);
    expect(a.paraDistribuir).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Com banco
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, uma rodada, dois episódios e peças)');

const MARCA = `md1${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('encadeamento com banco: slots propostos e a semana pela sessão da empresa', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let agenda: AgendaService;
  let episodios: EpisodioService;
  let orgId = '';

  const na = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'system', actorId: null, correlationId: `teste-${MARCA}`, origem: 'cron' }, fn);

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    episodios = new EpisodioService(app, new AuditService(app));
    agenda = new AgendaService(app, new AuditService(app), new MemoriaService(app, {} as never), episodios);
    // Sábado, 05/01/2030: a proposta começa no domingo e a grade abre na segunda 07/01.
    agenda.agora = () => new Date('2030-01-05T12:00:00.000Z');
    const o = await admin.org.create({ data: { name: `Encadeamento ${MARCA}`, slug: `md1-${MARCA}`, modulos: ['pauta'] } });
    orgId = o.id;
  }, 60_000);

  afterAll(async () => {
    if (orgId) {
      await admin.pautaPeca.deleteMany({ where: { orgId } });
      await admin.pautaEpisodio.deleteMany({ where: { orgId } });
      await admin.pautaRodada.deleteMany({ where: { orgId } });
      await admin.auditLog.deleteMany({ where: { orgId } });
      await admin.org.deleteMany({ where: { id: orgId } });
    }
    await admin?.$disconnect();
    await cru?.$disconnect();
  });

  it('dois episódios propõem sem colidir; a coluna nova grava e a semana mostra em cinza', async () => {
    const criarEp = async (n: number) => {
      const rodada = await admin.pautaRodada.create({
        data: { orgId, status: 'curada', titulo: `Semana ${n} ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: ITENS as never },
      });
      const e = await na(() => episodios.criar(orgId, 'pessoa', { rodadaId: rodada.id }));
      await admin.pautaEpisodio.update({ where: { id: e.id }, data: { status: 'derivacao' } });
      for (const formato of ['carrossel', 'story', 'corte']) {
        await admin.pautaPeca.create({
          data: {
            orgId, rodadaId: rodada.id, canal: 'instagram', formato, titulo: `${formato} ${n}`, corpo: 'Legenda', status: 'rascunho',
            meta: { episodioId: e.id, itemId: 'c1', itemN: 1, formato, imagens: [], avisos: [], transcricaoSha: 'x' },
          },
        });
      }
      return e;
    };
    const a = await criarEp(1);
    const b = await criarEp(2);
    expect(await na(() => agenda.proporSlots(orgId, a.id, 'rotina'))).toMatchObject({ propostas: 3 });
    expect(await na(() => agenda.proporSlots(orgId, b.id, 'rotina'))).toMatchObject({ propostas: 3 });

    const lidas = await admin.pautaPeca.findMany({ where: { orgId } });
    expect(lidas.every((p) => p.agendadaPara === null && p.slotProposto !== null && p.status === 'rascunho')).toBe(true);
    const chaves = lidas.map((p) => `${p.formato}|${p.slotProposto!.toISOString()}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    const carrosseis = lidas.filter((p) => p.formato === 'carrossel').map((p) => p.slotProposto!.toISOString()).sort();
    expect(carrosseis).toEqual(['2030-01-07T15:00:00.000Z', '2030-01-09T15:00:00.000Z']);

    const semana = await na(() => agenda.semana(orgId, '2030-01-07'));
    const seg = semana.dias[0].linhas.find((l) => l.formato === 'carrossel')!;
    expect(seg.peca).toMatchObject({ status: 'rascunho', agendadaPara: null, slotProposto: '2030-01-07T15:00:00.000Z' });
    const acoes = (await admin.auditLog.findMany({ where: { orgId }, select: { action: true } })).map((x) => x.action);
    expect(acoes.filter((x) => x === 'pauta.semana_proposta')).toHaveLength(2);
  }, 60_000);
});
