import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntradaDeGrupoRegistry } from '../gateway/canais/entrada-de-grupo.registry';
import { canalConfigurado } from '../gateway/canais/configuracao-do-canal';
import { lerLinksDoGrupo } from './links-do-grupo';
import { hashDaCaptura } from './url-da-captura';

/** O nome com que a fonte do grupo nasce na primeira mensagem. Achá-la não depende dele. */
export const NOME_DA_FONTE_DO_GRUPO = 'Grupo de links (WhatsApp)';

/** Quem aparece em `capturadoPor` e no RASTRO: não há usuário do OS por trás. */
const ATOR = 'whatsapp';

/*
 * ============================================================================
 * O GRUPO DE LINKS VIRA CAPTURA (MC1)
 * ============================================================================
 *
 * A entrada é o webhook único da instância (ver
 * `gateway/canais/entrada-de-grupo.registry.ts`): este serviço se inscreve lá
 * com o JID de `EVOLUTION_LINKS_JID` e recebe só as mensagens desse grupo, já
 * dentro do contexto da empresa do caminho (`comTenantPublico`, no controlador
 * do canal) — e só grava quando essa empresa é a de `EVOLUTION_LINKS_ORG_ID`.
 * Sem as duas variáveis, não se inscreve e nada muda.
 *
 * O QUE NÃO ACONTECE NA CHEGADA, de propósito: nem Apify nem IA. Os dois custam
 * por chamada, e quem cola dez links no grupo durante a semana não pediu dez
 * fichas. A captura entra como `rascunho` e espera quem a processe: a fila da
 * tela e, desde o MC4, a rodada, que a lê com o rótulo W.
 *
 * TRÊS FREIOS antes de gravar:
 *  · o módulo `pauta` precisa estar contratado pela empresa do caminho — a
 *    rota mora em `approvals/`, que é espinha, então o gate de módulos não
 *    passaria por aqui sozinho;
 *  · a fonte pausada no Radar cala o grupo, sem mexer em variável de ambiente;
 *  · a deduplicação por `urlHash` é a mesma da captura pela tela: o link colado
 *    lá e aqui é uma captura só.
 */
@Injectable()
export class EntradaDeLinksService implements OnModuleInit {
  private readonly log = new Logger('EntradaDeLinks');
  private readonly jid = (process.env.EVOLUTION_LINKS_JID ?? '').trim();
  /**
   * A empresa dona do grupo. O webhook do canal tem uma URL por empresa e um
   * segredo só para todas, e o JID é global: sem esta trava, a instância de
   * outra empresa que também estivesse no grupo gravaria cada link lá — com o
   * texto da mensagem e quem colou — e criaria a fonte ativa na primeira vez.
   */
  private readonly orgDoGrupo = (process.env.EVOLUTION_LINKS_ORG_ID ?? '').trim();

  /**
   * Uma mensagem por vez, neste processo. A Evolution reentrega e o grupo pode
   * receber dois links no mesmo segundo: em série, a fonte não nasce duas vezes
   * e a segunda cópia do link encontra a primeira já gravada.
   */
  private fila: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly grupos?: EntradaDeGrupoRegistry,
  ) {}

  get ligado(): boolean {
    return this.jid !== '' && this.orgDoGrupo !== '';
  }

  onModuleInit(): void {
    if (this.jid !== '' && this.orgDoGrupo === '') {
      this.log.warn('EVOLUTION_LINKS_JID definido sem EVOLUTION_LINKS_ORG_ID (a empresa dona do grupo): grupo de links desligado');
      return;
    }
    if (!this.ligado) return;
    if (!this.grupos) {
      this.log.warn('EVOLUTION_LINKS_JID definido, mas o registro de entrada por grupo não está no ar');
      return;
    }
    const inscrito = this.grupos.registrar(
      this.jid,
      (orgId, evento) => this.receber(orgId, evento),
      'EntradaDeLinksService',
    );
    if (!inscrito) {
      this.log.warn('EVOLUTION_LINKS_JID precisa ser o JID de um grupo (termina em @g.us)');
      return;
    }
    // A entrada é o webhook do canal de aprovação; sem os dois segredos dele, a
    // rota responde 404 e nenhuma mensagem do grupo chega.
    if (!canalConfigurado()) {
      this.log.warn(
        'EVOLUTION_LINKS_JID definido, mas o webhook do canal está desligado ' +
          '(CANAL_APROVACAO_SEGREDO/CANAL_APROVACAO_CODIGO_SEGREDO): nenhum link do grupo vai chegar',
      );
    }
  }

  /** Devolve um rótulo curto para o log do servidor. */
  receber(orgId: string, evento: unknown): Promise<string> {
    const vez = this.fila.then(() => this.processar(orgId, evento));
    this.fila = vez.catch(() => undefined);
    return vez;
  }

  private async processar(orgId: string, evento: unknown): Promise<string> {
    if (orgId !== this.orgDoGrupo) return 'ignorado:empresa-errada';
    const leitura = lerLinksDoGrupo(evento, this.jid);
    if (leitura.tipo === 'ignorar') return `ignorado:${leitura.porque}`;

    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { modulos: true } });
    if (!org?.modulos.includes('pauta')) return 'ignorado:pauta-desligada';

    const fonte = await this.fonteDoGrupo(orgId);
    if (!fonte.ativo) return 'ignorado:fonte-pausada';

    const novas: string[] = [];
    let repetidas = 0;
    for (const url of leitura.urls) {
      const urlHash = hashDaCaptura(url);
      const existe = await this.prisma.pautaCaptura.findUnique({
        where: { orgId_urlHash: { orgId, urlHash } },
        select: { id: true },
      });
      if (existe) {
        repetidas++;
        continue;
      }
      try {
        const c = await this.prisma.pautaCaptura.create({
          data: {
            orgId,
            fonteId: fonte.id,
            tipo: 'link',
            url,
            urlHash,
            nota: leitura.texto,
            bruto: {
              origem: 'whatsapp',
              remetente: leitura.remetente,
              mensagemId: leitura.mensagemId,
            },
            capturadoPor: ATOR,
          },
          select: { id: true },
        });
        novas.push(c.id);
      } catch (e) {
        // Outra réplica gravou o mesmo link entre a consulta e a escrita.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          repetidas++;
          continue;
        }
        throw e;
      }
    }

    await this.prisma.pautaFonte.update({
      where: { id: fonte.id },
      data: { ultimaLeitura: new Date(), ultimoErro: null },
    });

    if (novas.length > 0) {
      await this.audit.log({
        orgId,
        actorType: ActorType.system,
        actorId: ATOR,
        action: 'pauta.captura_whatsapp',
        entityType: 'pauta_fonte',
        entityId: fonte.id,
        after: { capturas: novas, repetidas },
      });
    }
    return `capturadas:${novas.length},repetidas:${repetidas}`;
  }

  /**
   * Achada por empresa + tipo + plataforma, sem o nome: renomear a fonte pela
   * API não pode fazer nascer outra ativa ao lado da pausada.
   */
  private async fonteDoGrupo(orgId: string): Promise<{ id: string; ativo: boolean }> {
    const onde = { orgId, tipo: 'manual' as const, plataforma: 'whatsapp' };
    const existente = await this.prisma.pautaFonte.findFirst({
      where: onde,
      orderBy: { criadaEm: 'asc' },
      select: { id: true, ativo: true },
    });
    if (existente) return existente;
    return this.prisma.pautaFonte.create({
      data: { ...onde, nome: NOME_DA_FONTE_DO_GRUPO },
      select: { id: true, ativo: true },
    });
  }
}
