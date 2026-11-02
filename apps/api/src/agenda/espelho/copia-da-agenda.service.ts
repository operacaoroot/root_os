import { Injectable, Optional } from '@nestjs/common';

import { exigirTenant } from '../../common/contexto-execucao';
import { PrismaService } from '../../prisma/prisma.service';
import type { ResultadoDaRotina } from '../../routines/rotina.tipos';
import { StorageService } from '../../storage/storage.service';
import { ehEmpresaDaCasa } from '../../tenants/empresa-da-casa';
import { EspelhoService } from './espelho.service';
import { PREFIXO_DA_COPIA, chavesDaCopia, chavesParaApagar, diaEmSaoPaulo, icsDaCopia, jsonDaCopia } from './copia-da-agenda';

/*
 * A CÓPIA DIÁRIA DA AGENDA (agenda v2, 29/10/2026, lane G7) — a rotina `agenda.copia`.
 *
 * Às 03:00 de São Paulo, só na empresa da casa: o espelho de -30 a +180 dias
 * (cancelados inclusive, com o status) em JSON e em ICS no armazém de arquivos
 * (`StorageService`, o MinIO/S3 que a pauta já usa), nas chaves
 * `agenda/copia/AAAA-MM-DD.json` e `.ics`. Guarda 30 dias: as cópias mais velhas
 * DO PRÓPRIO PREFIXO saem (são do OS; nada fora de `agenda/copia/` é tocado).
 *
 * Sem armazém configurado: `pulada`, com o motivo. A cópia não lê o Google: é o
 * retrato do espelho, para o dia em que o Google ou a conta faltarem.
 */
@Injectable()
export class CopiaDaAgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly espelho: EspelhoService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  protected ehDaCasa(orgId: string): Promise<boolean> {
    return ehEmpresaDaCasa(this.prisma, orgId);
  }

  async copiar(orgIdBruto: string, agora: Date = new Date()): Promise<ResultadoDaRotina> {
    const orgId = exigirTenant(orgIdBruto, 'CopiaDaAgendaService.copiar');
    if (!(await this.ehDaCasa(orgId))) return { status: 'pulada', resumo: 'A cópia da agenda só roda na empresa da casa: nada foi gravado.' };
    if (!this.storage?.configured) {
      return { status: 'pulada', resumo: 'Sem armazém de arquivos configurado (S3_ACCESS_KEY e S3_SECRET_KEY): nada foi copiado.' };
    }
    const { de, ate } = this.espelho.janela(agora);
    const eventos = await this.espelho.doEspelho(orgId, de, ate, { incluirCancelados: true });
    const dia = diaEmSaoPaulo(agora);
    const chaves = chavesDaCopia(dia);
    await this.storage.put(chaves.json, Buffer.from(jsonDaCopia(eventos, agora, de, ate), 'utf8'), 'application/json; charset=utf-8');
    await this.storage.put(chaves.ics, Buffer.from(icsDaCopia(eventos, agora), 'utf8'), 'text/calendar; charset=utf-8');

    const antigas = chavesParaApagar((await this.storage.listar(PREFIXO_DA_COPIA)).map((o) => o.chave), dia);
    for (const k of antigas) await this.storage.remover(k);
    return {
      status: 'ok',
      resumo: `Cópia de ${dia}: ${eventos.length} compromisso(s) em JSON e ICS; ${antigas.length} arquivo(s) de mais de 30 dias apagado(s).`,
    };
  }
}
