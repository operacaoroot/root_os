import { Injectable, Logger } from '@nestjs/common';
import type { ModuloKey } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { exigirTenant } from '../common/contexto-execucao';
import { modulosConhecidos } from './modulos';

/**
 * Quanto tempo o conjunto de módulos de uma empresa vale sem reler o banco.
 *
 * POR QUE EXISTE CACHE. O gate roda em TODA requisição da API. Sem cache, cada
 * chamada de tela vira duas idas ao banco — a da consulta e a da pergunta
 * "pode?" —, e a pergunta é a mesma o dia inteiro: módulo contratado muda em
 * escala de semanas.
 *
 * POR QUE 30 SEGUNDOS E NÃO UMA VARIÁVEL DE AMBIENTE. Variável nova precisa
 * entrar em DOIS lugares (o bloco `environment:` do `docker-compose.yml` e o
 * `.env`) — e o `docker-compose.yml` é arquivo de OUTRA fatia desta mesma onda.
 * Preencher só o `.env` não faria nada: o container não lê arquivo `.env`, só
 * recebe o que está listado no compose. Essa exata pegadinha segurou a
 * `ANTHROPIC_API_KEY` por semanas. Constante até alguém precisar de outro
 * valor.
 *
 * O QUE 30s CUSTA. Desligar um módulo continua valendo por até 30s para quem já
 * estava usando o sistema. Não é janela de segurança relevante aqui: módulo
 * desligado não é revogação de acesso de emergência (isso é permissão e papel,
 * que já são resolvidos no token), é escopo de produto contratado.
 */
const VALIDADE_MS = 30_000;

/**
 * Os módulos contratados por uma empresa — RF-T-06.
 *
 * Uma pergunta, dois consumidores: o `ModulosInterceptor`, que recusa rota de
 * módulo desligado, e o `ModulosController`, que responde ao web o que ele deve
 * mostrar no menu. Os dois lendo do MESMO lugar é o que impede o menu e a API
 * de discordarem — menu que esconde sem a API recusar é fachada, e API que
 * recusa sem o menu esconder é tela que erra ao clicar.
 */
@Injectable()
export class ModulosService {
  private readonly log = new Logger('Modulos');
  private readonly cache = new Map<string, { modulos: Set<ModuloKey>; expiraEm: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Os módulos ligados da empresa. LANÇA sem tenant — ausência de empresa é
   * erro, nunca "todos" (RF-T-04): devolver o conjunto vazio aqui seria mentir
   * "esta empresa não contratou nada", e devolver tudo seria abrir a porta.
   *
   * Empresa inexistente devolve conjunto VAZIO, não erro: quem responde por
   * token de empresa apagada é a autenticação, e um 404 de módulo mascararia
   * esse problema com a mensagem errada.
   *
   * DEVOLVE CÓPIA, e o tipo é somente-leitura. O conjunto guardado no cache
   * serve a todas as requisições daquela empresa pelos próximos `VALIDADE_MS`;
   * entregá-lo por referência daria a qualquer chamador o poder de acrescentar
   * ou tirar módulo do cache de um tenant inteiro com um `.add()` distraído —
   * e o efeito duraria até 30s, em processo, sem deixar rastro no banco. Cópia
   * de um conjunto de no máximo uma dúzia de strings é barato perto disso.
   */
  async modulosDaOrg(orgId: string): Promise<ReadonlySet<ModuloKey>> {
    const id = exigirTenant(orgId, 'ModulosService.modulosDaOrg');

    const agora = Date.now();
    const emCache = this.cache.get(id);
    if (emCache && emCache.expiraEm > agora) return new Set(emCache.modulos);

    const org = await this.prisma.org.findUnique({
      where: { id },
      select: { modulos: true },
    });

    const brutos = org?.modulos ?? [];
    const validos = modulosConhecidos(brutos);
    if (validos.length !== new Set(brutos).size) {
      // Não derruba a requisição: chave desconhecida não libera nada. Mas
      // também não some em silêncio — é lixo no banco e alguém tem de limpar.
      this.log.warn(
        `Org ${id} tem módulo desconhecido gravado: ${brutos
          .filter((m) => !validos.includes(m as ModuloKey))
          .join(', ')}`,
      );
    }

    const conjunto = new Set(validos);
    this.cache.set(id, { modulos: conjunto, expiraEm: agora + VALIDADE_MS });
    // Cópia também aqui: o `conjunto` acabou de entrar no cache e devolvê-lo
    // seria entregar exatamente a mesma referência que os próximos 30s vão usar.
    return new Set(conjunto);
  }

  /** Ativações de ferramentas ficam no mesmo campo legado, mas fora do catálogo core. */
  async ferramentaAtivaDaOrg(orgId: string, activationKey: string): Promise<boolean> {
    const id = exigirTenant(orgId, 'ModulosService.ferramentaAtivaDaOrg');
    const org = await this.prisma.org.findUnique({
      where: { id },
      select: { isActive: true, modulos: true },
    });
    return Boolean(org?.isActive && org.modulos.includes(activationKey));
  }

  /** Lista explícita, sem misturar chaves dinâmicas ao MODULOS core. */
  async ferramentasDaOrg(orgId: string, activationKeys: readonly string[]): Promise<string[]> {
    const id = exigirTenant(orgId, 'ModulosService.ferramentasDaOrg');
    const org = await this.prisma.org.findUnique({ where: { id }, select: { isActive: true, modulos: true } });
    if (!org?.isActive) return [];
    const presentes = new Set(org.modulos);
    return activationKeys.filter((key) => presentes.has(key));
  }

  /**
   * Descarta o que está em cache. Existe para o dia em que houver tela de
   * ligar/desligar módulo: sem isto, a mudança levaria até `VALIDADE_MS` para
   * aparecer e quem clicou acharia que o botão não funcionou.
   */
  esquecer(orgId?: string): void {
    if (orgId) this.cache.delete(orgId);
    else this.cache.clear();
  }
}
