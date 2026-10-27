import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { comTenantPublico, resolverOrgDoSlugInterno } from '../common/tenant-publico';
import { SLUG_DA_PLATAFORMA } from '../tenants/provisionar';
import type { JwtUser } from '../auth/current-user.decorator';
import { RelatoSchema, type CriarCasaDto, type EditarCasaDto, type Relato } from './frota.schemas';
import { POLITICAS, avaliarPoliticas, estadoDaCasa, pendenciasDaCasa } from './politicas';

/*
 * ============================================================================
 * FROTA — os servidores de cliente que a ROOT opera
 * ============================================================================
 *
 * Duas portas, uma tabela de registro.
 *
 *  · O PAINEL (sessão da plataforma): lê o estado de cada casa, a matriz de
 *    acessos, as políticas e o registro; pede revogação de chave e outras
 *    ordens. Toda ação do painel vira linha em `FrotaEvento` e em `AuditLog`.
 *
 *  · O RELATOR (anônimo, token da casa): o `kit-relatar` do kit-instalacao-vps
 *    manda o estado da máquina a cada 5 min. O token identifica a casa (só o
 *    hash fica no banco); a empresa é sempre a da plataforma, resolvida pelo
 *    slug ANTES de abrir o contexto, como as outras rotas públicas. O relato
 *    é comparado com o anterior e só a DIFERENÇA vira evento (chave nova,
 *    chave que sumiu, login, imagem trocada, sonda que mudou, kit atualizado),
 *    deduplicada pela coluna `chave`. A resposta traz as ordens pendentes, que
 *    a casa aplica e devolve em `resultados`.
 *
 * O painel nunca executa nada no servidor: ele enfileira, a casa puxa. Nenhuma
 * porta nova no cliente, nenhuma credencial da ROOT guardada lá.
 */

const JANELA_DE_RELATO_MIN = 15;
const TTL_ORG_MS = 60_000;

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const novoToken = () => `frota_${randomBytes(32).toString('hex')}`;
const hash8 = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 8);
const dataOu = (s: string | null | undefined, senao: Date): Date => {
  if (!s) return senao;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? senao : d;
};
/** `2026-10-26 23:40` (o formato do kit-diario) ou ISO. */
const dataDoDiario = (s: string, senao: Date): Date => dataOu(s.replace(' ', 'T').length === 16 ? `${s.replace(' ', 'T')}:00-03:00` : s, senao);
const tipoDoDiario = (t: string): 'acesso' | 'deploy' | 'kit' => {
  if (/chave|acesso|ssh|revog|authorized_keys|vpn/i.test(t)) return 'acesso';
  if (/no ar|deploy|publica|imagem|kit-subir|subiu|versão|release/i.test(t)) return 'deploy';
  return 'kit';
};

type CasaComRelacoes = Prisma.FrotaCasaGetPayload<{ include: { acessos: true; ordens: true } }>;

@Injectable()
export class FrotaService {
  private readonly log = new Logger('Frota');
  private orgPlataforma: { id: string; ate: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------- leitura */

  async resumo(orgId: string) {
    const casas = await this.prisma.frotaCasa.findMany({
      where: { orgId, arquivadaEm: null },
      orderBy: { casa: 'asc' },
      include: {
        acessos: { where: { estado: { in: ['ativa', 'revogando', 'pedido'] } } },
        ordens: { where: { estado: { in: ['pendente', 'entregue'] } } },
      },
    });
    const eventos = await this.prisma.frotaEvento.findMany({
      where: { orgId },
      orderBy: { quando: 'desc' },
      take: 40,
      include: { casa: { select: { casa: true } } },
    });
    const resumos = casas.map((c) => this.resumoDaCasa(c));
    const comServidor = resumos.filter((c) => c.etapa !== 'pre');
    const pessoas = new Set<string>();
    let chaves = 0;
    let semDono = 0;
    for (const c of comServidor) {
      for (const p of c.pessoas) {
        if (/^sem dono/i.test(p)) semDono += 1;
        else pessoas.add(p);
        chaves += 1;
      }
    }
    const acoes = resumos
      .flatMap((c) => c.pendencias.filter((p) => p.n !== 'ne').map((p) => ({ casaId: c.id, casa: c.casa, ...p })))
      .sort((a, b) => (a.n === 'er' ? 0 : 1) - (b.n === 'er' ? 0 : 1));
    return {
      atualizadoEm: new Date().toISOString(),
      tiles: {
        servidores: comServidor.length,
        casas: resumos.length,
        comKit: comServidor.filter((c) => c.kitVersao && c.etapa !== 'fora-do-kit').length,
        relatando: comServidor.filter((c) => c.relatando).length,
        sondaOk: comServidor.filter((c) => c.sonda?.estado === 'ok').length,
        chaves,
        pessoas: pessoas.size,
        semDono,
        backupFora: comServidor.filter((c) => c.backup?.remoto).length,
        pendenciasDePolitica: comServidor.reduce((n, c) => n + c.politicas.at + c.politicas.er, 0),
        precisaDeGente: acoes.length,
        ordensPendentes: resumos.reduce((n, c) => n + c.ordensPendentes, 0),
      },
      acoes: acoes.slice(0, 12),
      totalDeAcoes: acoes.length,
      casas: resumos,
      eventos: eventos.map(mapEvento),
    };
  }

  async listarCasas(orgId: string, arquivadas = false) {
    const casas = await this.prisma.frotaCasa.findMany({
      where: { orgId, ...(arquivadas ? {} : { arquivadaEm: null }) },
      orderBy: { casa: 'asc' },
      include: {
        acessos: { where: { estado: { in: ['ativa', 'revogando', 'pedido'] } } },
        ordens: { where: { estado: { in: ['pendente', 'entregue'] } } },
      },
    });
    return { casas: casas.map((c) => this.resumoDaCasa(c)) };
  }

  async casa(orgId: string, id: string) {
    const c = await this.prisma.frotaCasa.findFirst({
      where: { orgId, id },
      include: {
        acessos: { orderBy: [{ estado: 'asc' }, { pessoa: 'asc' }] },
        ordens: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!c) throw new NotFoundException('Casa não encontrada.');
    const eventos = await this.prisma.frotaEvento.findMany({
      where: { orgId, casaId: id },
      orderBy: { quando: 'desc' },
      take: 150,
    });
    const relato = relatoGuardado(c.relato);
    const resumo = this.resumoDaCasa({ ...c, acessos: c.acessos.filter((a) => ['ativa', 'revogando', 'pedido'].includes(a.estado)), ordens: c.ordens.filter((o) => ['pendente', 'entregue'].includes(o.estado)) });
    return {
      ...resumo,
      relato,
      ficha: (c.ficha as Record<string, unknown> | null) ?? {},
      lgpd: (c.lgpd as Record<string, unknown> | null) ?? {},
      observacoes: c.observacoes,
      arquivadaEm: c.arquivadaEm,
      acessos: c.acessos.map((a) => ({
        id: a.id,
        pessoa: a.pessoa,
        fingerprint: a.fingerprint,
        tipo: a.tipo,
        via: a.via,
        desde: a.desde,
        ultimoLogin: a.ultimoLogin,
        estado: a.estado,
        revogadoEm: a.revogadoEm,
        revogadoPor: a.revogadoPor,
        motivo: a.motivo,
      })),
      ordens: c.ordens.map(mapOrdem),
      eventos: eventos.map((e) => mapEvento({ ...e, casa: { casa: c.casa } })),
      politicasAvaliadas: avaliarPoliticas({
        relato,
        ultimoRelatoEm: c.ultimoRelatoEm,
        etapa: c.etapa,
        acessos: c.acessos,
        ficha: c.ficha as Record<string, unknown> | null,
        lgpd: c.lgpd as Record<string, unknown> | null,
      }),
    };
  }

  async eventos(orgId: string, filtro: { casaId?: string; tipo?: string; limite?: number }) {
    const eventos = await this.prisma.frotaEvento.findMany({
      where: { orgId, ...(filtro.casaId ? { casaId: filtro.casaId } : {}), ...(filtro.tipo ? { tipo: filtro.tipo } : {}) },
      orderBy: { quando: 'desc' },
      take: filtro.limite ?? 200,
      include: { casa: { select: { casa: true } } },
    });
    return { eventos: eventos.map(mapEvento) };
  }

  async politicas(orgId: string) {
    const casas = await this.prisma.frotaCasa.findMany({
      where: { orgId, arquivadaEm: null },
      orderBy: { casa: 'asc' },
      include: { acessos: true },
    });
    return {
      politicas: POLITICAS,
      casas: casas.map((c) => ({
        id: c.id,
        casa: c.casa,
        cliente: c.cliente,
        etapa: c.etapa,
        lgpd: (c.lgpd as Record<string, unknown> | null) ?? {},
        estados: avaliarPoliticas({
          relato: relatoGuardado(c.relato),
          ultimoRelatoEm: c.ultimoRelatoEm,
          etapa: c.etapa,
          acessos: c.acessos,
          ficha: c.ficha as Record<string, unknown> | null,
          lgpd: c.lgpd as Record<string, unknown> | null,
        }).map(({ cod, estado, detalhe }) => ({ cod, estado, detalhe })),
      })),
    };
  }

  /* ------------------------------------------------------------- escrita */

  async criarCasa(orgId: string, user: JwtUser, dto: CriarCasaDto) {
    const existe = await this.prisma.frotaCasa.findFirst({ where: { orgId, casa: dto.casa }, select: { id: true } });
    if (existe) throw new ConflictException(`Já existe a casa ${dto.casa}.`);
    const token = novoToken();
    const { ficha, lgpd, ...campos } = dto;
    const casa = await this.prisma.frotaCasa.create({
      data: {
        orgId,
        ...campos,
        etapa: dto.etapa ?? 'preparar',
        acesso: dto.acesso ?? 'publico',
        ficha: (ficha ?? {}) as Prisma.InputJsonValue,
        lgpd: (lgpd ?? {}) as Prisma.InputJsonValue,
        tokenHash: hashToken(token),
      },
      include: { acessos: true, ordens: true },
    });
    await this.registrar(orgId, casa.id, user, `Casa ${casa.casa} criada (${casa.cliente}). Token do relator emitido.`, 'painel', `casa+:${casa.id}`);
    await this.audit.log({ orgId, actorId: user.sub, action: 'frota.casa.criar', entityType: 'FrotaCasa', entityId: casa.id, after: { casa: casa.casa, cliente: casa.cliente } });
    return { casa: this.resumoDaCasa(casa), token };
  }

  async editarCasa(orgId: string, user: JwtUser, id: string, dto: EditarCasaDto) {
    const atual = await this.prisma.frotaCasa.findFirst({ where: { orgId, id } });
    if (!atual) throw new NotFoundException('Casa não encontrada.');
    const { ficha, lgpd, arquivada, ...campos } = dto;
    const data: Prisma.FrotaCasaUpdateInput = { ...campos };
    if (ficha) data.ficha = { ...((atual.ficha as Record<string, unknown> | null) ?? {}), ...ficha } as Prisma.InputJsonValue;
    if (lgpd) data.lgpd = { ...((atual.lgpd as Record<string, unknown> | null) ?? {}), ...lgpd } as Prisma.InputJsonValue;
    if (arquivada !== undefined) data.arquivadaEm = arquivada ? new Date() : null;
    const casa = await this.prisma.frotaCasa.update({ where: { id }, data, include: { acessos: true, ordens: true } });
    const mudou = Object.keys(dto).join(', ');
    await this.registrar(orgId, id, user, `Ficha da casa ${casa.casa} editada (${mudou}).`, 'painel');
    await this.audit.log({ orgId, actorId: user.sub, action: 'frota.casa.editar', entityType: 'FrotaCasa', entityId: id, after: dto as Prisma.InputJsonValue });
    return { casa: this.resumoDaCasa(casa) };
  }

  async girarToken(orgId: string, user: JwtUser, id: string) {
    const atual = await this.prisma.frotaCasa.findFirst({ where: { orgId, id }, select: { id: true, casa: true } });
    if (!atual) throw new NotFoundException('Casa não encontrada.');
    const token = novoToken();
    await this.prisma.frotaCasa.update({ where: { id }, data: { tokenHash: hashToken(token) } });
    await this.registrar(orgId, id, user, `Token do relator da casa ${atual.casa} trocado. O antigo não entra mais.`, 'painel');
    await this.audit.log({ orgId, actorId: user.sub, action: 'frota.casa.token', entityType: 'FrotaCasa', entityId: id });
    return { token };
  }

  async revogar(orgId: string, user: JwtUser, acessoId: string, motivo: string) {
    const acesso = await this.prisma.frotaAcesso.findFirst({ where: { orgId, id: acessoId }, include: { casa: { select: { id: true, casa: true } } } });
    if (!acesso) throw new NotFoundException('Acesso não encontrado.');
    if (acesso.estado !== 'ativa') throw new ConflictException(`Este acesso está "${acesso.estado}", não dá para revogar.`);
    if (!acesso.fingerprint) throw new BadRequestException('Acesso sem impressão digital de chave: nada a revogar no servidor.');
    const quem = user.email || user.name;
    const ordem = await this.prisma.$transaction(async (tx) => {
      const o = await tx.frotaOrdem.create({
        data: {
          orgId,
          casaId: acesso.casaId,
          tipo: 'revogar_chave',
          parametros: { fingerprint: acesso.fingerprint, pessoa: acesso.pessoa, acessoId: acesso.id },
          criadaPor: quem,
          motivo,
        },
      });
      await tx.frotaAcesso.update({ where: { id: acesso.id }, data: { estado: 'revogando', motivo, revogadoPor: quem } });
      await tx.frotaEvento.create({
        data: {
          orgId,
          casaId: acesso.casaId,
          quando: new Date(),
          quem,
          acao: `Revogação de ${acesso.pessoa} pedida pelo painel. Motivo: ${motivo}. A casa aplica no próximo relato.`,
          origem: 'painel',
          tipo: 'painel',
          dados: { ordemId: o.id, fingerprint: acesso.fingerprint },
        },
      });
      return o;
    });
    await this.audit.log({ orgId, actorId: user.sub, action: 'frota.acesso.revogar', entityType: 'FrotaAcesso', entityId: acesso.id, after: { pessoa: acesso.pessoa, casa: acesso.casa.casa, motivo, ordemId: ordem.id } });
    return { ordem: mapOrdem(ordem) };
  }

  async criarOrdem(orgId: string, user: JwtUser, casaId: string, dto: { tipo: string; parametros?: Record<string, string>; motivo?: string }) {
    const casa = await this.prisma.frotaCasa.findFirst({ where: { orgId, id: casaId }, select: { id: true, casa: true } });
    if (!casa) throw new NotFoundException('Casa não encontrada.');
    if (dto.tipo === 'desligar_automacao' && !dto.parametros?.unidade) throw new BadRequestException('Diga qual unidade (timer) desligar.');
    const quem = user.email || user.name;
    const ordem = await this.prisma.frotaOrdem.create({
      data: { orgId, casaId, tipo: dto.tipo, parametros: (dto.parametros ?? {}) as Prisma.InputJsonValue, criadaPor: quem, motivo: dto.motivo },
    });
    await this.registrar(orgId, casaId, user, `Ordem ${dto.tipo}${dto.parametros?.unidade ? ` (${dto.parametros.unidade})` : ''} enfileirada para ${casa.casa}.${dto.motivo ? ` Motivo: ${dto.motivo}.` : ''}`, 'painel');
    await this.audit.log({ orgId, actorId: user.sub, action: `frota.ordem.${dto.tipo}`, entityType: 'FrotaOrdem', entityId: ordem.id, after: dto as Prisma.InputJsonValue });
    return { ordem: mapOrdem(ordem) };
  }

  async cancelarOrdem(orgId: string, user: JwtUser, ordemId: string) {
    const ordem = await this.prisma.frotaOrdem.findFirst({ where: { orgId, id: ordemId } });
    if (!ordem) throw new NotFoundException('Ordem não encontrada.');
    if (ordem.estado !== 'pendente') throw new ConflictException(`Ordem já ${ordem.estado}; só ordem pendente se cancela.`);
    const quem = user.email || user.name;
    await this.prisma.$transaction(async (tx) => {
      await tx.frotaOrdem.update({ where: { id: ordemId }, data: { estado: 'cancelada', concluidaEm: new Date(), resultado: { canceladaPor: quem } } });
      if (ordem.tipo === 'revogar_chave') {
        const p = (ordem.parametros as { acessoId?: string } | null) ?? {};
        if (p.acessoId) await tx.frotaAcesso.updateMany({ where: { id: p.acessoId, estado: 'revogando' }, data: { estado: 'ativa', motivo: null, revogadoPor: null } });
      }
    });
    await this.registrar(orgId, ordem.casaId, user, `Ordem ${ordem.tipo} cancelada antes de a casa puxar.`, 'painel');
    return { ok: true };
  }

  /* ------------------------------------------------------------- relator */

  async receberRelato(token: string | undefined, corpo: unknown) {
    const orgId = await this.orgDaPlataforma();
    return comTenantPublico(orgId, async () => {
      const casa = await this.casaDoToken(orgId, token);
      const r = RelatoSchema.parse(corpo);
      if (r.casa !== casa.casa) throw new BadRequestException(`O token é da casa ${casa.casa}; o relato diz ${r.casa}.`);
      const agora = new Date();
      const anterior = relatoGuardado(casa.relato);
      const eventos: Prisma.FrotaEventoCreateManyInput[] = [];
      const ev = (e: Omit<Prisma.FrotaEventoCreateManyInput, 'orgId' | 'casaId'>) => eventos.push({ orgId, casaId: casa.id, ...e });

      // chaves: quem entrou, quem saiu, quem voltou
      const porFp = new Map(casa.acessos.filter((a) => a.fingerprint).map((a) => [a.fingerprint as string, a]));
      const vistas = new Set<string>();
      const novas: Prisma.FrotaAcessoCreateManyInput[] = [];
      const atualizacoes: { id: string; data: Prisma.FrotaAcessoUpdateInput }[] = [];
      const nomeDaChave = (fp: string | undefined) =>
        (fp && (porFp.get(fp)?.pessoa ?? r.chaves.find((c) => c.fingerprint === fp)?.comentario?.trim())) || null;
      for (const ch of r.chaves) {
        vistas.add(ch.fingerprint);
        const pessoa = ch.comentario?.trim() || `sem dono (${ch.fingerprint.slice(-12)})`;
        const via = ch.restricoes ? `ssh · ${ch.restricoes}` : 'ssh';
        const ex = porFp.get(ch.fingerprint);
        if (!ex) {
          novas.push({ orgId, casaId: casa.id, pessoa, fingerprint: ch.fingerprint, tipo: ch.tipo, via, desde: agora, estado: 'ativa' });
          ev({ chave: `chave+:${casa.id}:${ch.fingerprint}`, quando: agora, quem: 'relator', acao: `Chave ${pessoa}${ch.tipo ? ` (${ch.tipo})` : ''} presente no authorized_keys.`, origem: 'relator', tipo: 'acesso' });
        } else if (ex.estado === 'removida' || ex.estado === 'revogada') {
          atualizacoes.push({ id: ex.id, data: { estado: 'ativa', desde: agora, pessoa, via, revogadoEm: null, revogadoPor: null, motivo: null } });
          ev({ chave: `chave+:${casa.id}:${ch.fingerprint}:${agora.toISOString().slice(0, 10)}`, quando: agora, quem: 'relator', acao: `Chave ${pessoa} VOLTOU ao authorized_keys depois de ${ex.estado}.`, origem: 'relator', tipo: 'acesso' });
        } else if (ex.pessoa !== pessoa || ex.via !== via) {
          atualizacoes.push({ id: ex.id, data: { pessoa, via } });
        }
      }
      for (const a of casa.acessos) {
        if (!a.fingerprint || vistas.has(a.fingerprint)) continue;
        if (a.estado !== 'ativa' && a.estado !== 'revogando') continue;
        const estado = a.estado === 'revogando' ? 'revogada' : 'removida';
        atualizacoes.push({ id: a.id, data: { estado, revogadoEm: agora } });
        ev({ chave: `chave-:${casa.id}:${a.fingerprint}:${agora.toISOString().slice(0, 10)}`, quando: agora, quem: 'relator', acao: estado === 'revogada' ? `Chave ${a.pessoa} revogada: não está mais no authorized_keys.` : `Chave ${a.pessoa} saiu do authorized_keys (fora do painel).`, origem: 'relator', tipo: 'acesso' });
      }

      // logins
      const ultimoLoginPorFp = new Map<string, Date>();
      for (const l of r.logins) {
        const quando = dataOu(l.quando, agora);
        const pessoa = nomeDaChave(l.fingerprint) ?? (l.fingerprint ? `chave desconhecida (${l.fingerprint.slice(-12)})` : l.usuario ?? '?');
        ev({ chave: `login:${casa.id}:${quando.toISOString()}:${l.fingerprint ?? l.de ?? ''}`, quando, quem: pessoa, acao: `Login SSH aceito${l.de ? ` de ${l.de}` : ''}.`, origem: 'sshd', tipo: 'acesso' });
        if (l.fingerprint) {
          const atual = ultimoLoginPorFp.get(l.fingerprint);
          if (!atual || atual < quando) ultimoLoginPorFp.set(l.fingerprint, quando);
        }
      }

      // diário da casa
      for (const d of r.diario) {
        ev({ chave: `diario:${casa.id}:${d.quando}:${hash8(d.texto)}`, quando: dataDoDiario(d.quando, agora), quem: d.quem, acao: d.texto, origem: 'kit-diario', tipo: tipoDoDiario(d.texto) });
      }

      // o que mudou desde o relato anterior
      if (!anterior) {
        ev({ chave: `primeiro:${casa.id}`, quando: agora, quem: 'relator', acao: `Primeiro relato recebido de ${casa.casa}${r.maquina.kitVersao ? ` (kit ${r.maquina.kitVersao})` : ''}.`, origem: 'relator', tipo: 'kit' });
      } else {
        if (r.sonda && anterior.sonda?.estado !== r.sonda.estado) {
          ev({ chave: `sonda:${casa.id}:${r.quando}`, quando: agora, quem: 'kit-sonda', acao: r.sonda.estado === 'ok' ? 'Sonda: voltou ao normal.' : `Sonda: ${r.sonda.estado}`, origem: 'kit-sonda', tipo: 'sonda' });
        }
        if (r.maquina.kitVersao && anterior.maquina.kitVersao !== r.maquina.kitVersao) {
          ev({ chave: `kit:${casa.id}:${r.maquina.kitVersao}`, quando: agora, quem: 'relator', acao: `Kit atualizado: ${anterior.maquina.kitVersao ?? '?'} → ${r.maquina.kitVersao}.`, origem: 'relator', tipo: 'kit' });
        }
        const antes = new Map(anterior.containers.map((c) => [c.nome, c.imagem]));
        for (const c of r.containers) {
          if (antes.get(c.nome) === c.imagem) continue;
          ev({ chave: `deploy:${casa.id}:${c.nome}:${c.imagem}`, quando: agora, quem: 'docker', acao: `${c.nome}: imagem ${c.imagem}${antes.has(c.nome) ? ` (antes ${antes.get(c.nome)})` : ' (container novo)'}.`, origem: 'docker', tipo: 'deploy' });
        }
        const fAntes = anterior.verificar.filter((v) => v.n === 'fa').length;
        const fAgora = r.verificar.filter((v) => v.n === 'fa').length;
        if (fAntes !== fAgora) {
          ev({ chave: `verificar:${casa.id}:${r.quando}`, quando: agora, quem: 'kit-verificar', acao: `kit-verificar: ${fAgora} falha(s), antes ${fAntes}.`, origem: 'kit-verificar', tipo: 'kit' });
        }
        const bAntes = anterior.backup?.ultimoOk ?? null;
        if (r.backup?.ultimoOk && r.backup.ultimoOk !== bAntes) {
          ev({ chave: `backup:${casa.id}:${r.backup.ultimoOk}`, quando: dataOu(r.backup.ultimoOk, agora), quem: 'kit-backup', acao: `Backup ok${r.backup.remoto ? ' (local e cópia fora)' : ' (só local)'}.`, origem: 'kit-backup', tipo: 'sonda' });
        }
      }

      const { estado, texto } = estadoDaCasa(r, casa.etapa);
      const m = r.maquina;
      const maquina = [m.vcpu ? `${m.vcpu} vCPU` : null, m.memoriaGb ? `${m.memoriaGb} GB` : null, m.discoGb ? `${m.discoGb} GB` : null].filter(Boolean).join(' · ') || casa.maquina;

      const ordens = await this.prisma.$transaction(async (tx) => {
        await tx.frotaCasa.update({
          where: { id: casa.id },
          data: {
            relato: r as unknown as Prisma.InputJsonValue,
            ultimoRelatoEm: agora,
            estado,
            estadoTexto: texto,
            hostname: m.hostname ?? casa.hostname,
            sistema: m.sistema ?? casa.sistema,
            maquina,
            kitVersao: m.kitVersao ?? casa.kitVersao,
            acesso: m.acesso ?? casa.acesso,
            vpn: m.vpnIp ?? casa.vpn,
            dono: casa.dono ?? m.dono ?? null,
            etapa: casa.etapa === 'pre' ? 'preparar' : casa.etapa,
          },
        });
        if (novas.length) await tx.frotaAcesso.createMany({ data: novas });
        for (const u of atualizacoes) await tx.frotaAcesso.update({ where: { id: u.id }, data: u.data });
        for (const [fp, quando] of ultimoLoginPorFp) {
          await tx.frotaAcesso.updateMany({ where: { casaId: casa.id, fingerprint: fp, OR: [{ ultimoLogin: null }, { ultimoLogin: { lt: quando } }] }, data: { ultimoLogin: quando } });
        }
        if (eventos.length) await tx.frotaEvento.createMany({ data: eventos, skipDuplicates: true });
        const pendentes = await tx.frotaOrdem.findMany({ where: { casaId: casa.id, estado: 'pendente' }, orderBy: { createdAt: 'asc' }, take: 10 });
        if (pendentes.length) {
          await tx.frotaOrdem.updateMany({ where: { id: { in: pendentes.map((p) => p.id) } }, data: { estado: 'entregue', entregueEm: agora } });
        }
        return pendentes;
      });
      this.log.log(`relato de ${casa.casa}: ${estado} · ${eventos.length} evento(s) · ${ordens.length} ordem(ns) entregue(s)`);
      return {
        ok: true,
        casa: casa.casa,
        recebidoEm: agora.toISOString(),
        estado,
        ordens: ordens.map((o) => ({ id: o.id, tipo: o.tipo, parametros: (o.parametros as Record<string, unknown> | null) ?? {} })),
      };
    });
  }

  async receberResultados(token: string | undefined, corpo: { casa: string; resultados: { ordemId: string; ok: boolean; mensagem?: string }[] }) {
    const orgId = await this.orgDaPlataforma();
    return comTenantPublico(orgId, async () => {
      const casa = await this.casaDoToken(orgId, token);
      if (corpo.casa !== casa.casa) throw new BadRequestException(`O token é da casa ${casa.casa}; o corpo diz ${corpo.casa}.`);
      const agora = new Date();
      let aplicadas = 0;
      for (const res of corpo.resultados) {
        const ordem = await this.prisma.frotaOrdem.findFirst({ where: { id: res.ordemId, casaId: casa.id, estado: { in: ['entregue', 'pendente'] } } });
        if (!ordem) continue;
        aplicadas += 1;
        const estado = res.ok ? 'aplicada' : 'falhou';
        await this.prisma.$transaction(async (tx) => {
          await tx.frotaOrdem.update({ where: { id: ordem.id }, data: { estado, concluidaEm: agora, resultado: { ok: res.ok, mensagem: res.mensagem ?? null } } });
          const p = (ordem.parametros as { fingerprint?: string; pessoa?: string; acessoId?: string; unidade?: string } | null) ?? {};
          if (ordem.tipo === 'revogar_chave' && p.acessoId) {
            await tx.frotaAcesso.updateMany({ where: { id: p.acessoId }, data: res.ok ? { estado: 'revogada', revogadoEm: agora } : { estado: 'ativa' } });
          }
          const alvo = ordem.tipo === 'revogar_chave' ? `chave de ${p.pessoa ?? p.fingerprint ?? '?'}` : ordem.tipo === 'desligar_automacao' ? `automação ${p.unidade ?? '?'}` : ordem.tipo.replace('_', ' ');
          await tx.frotaEvento.create({
            data: {
              orgId,
              casaId: casa.id,
              quando: agora,
              quem: 'relator',
              acao: res.ok ? `Ordem aplicada na casa: ${alvo}.${res.mensagem ? ` ${res.mensagem}` : ''}` : `Ordem FALHOU na casa: ${alvo}. ${res.mensagem ?? 'sem detalhe'}`,
              origem: 'relator',
              tipo: ordem.tipo === 'revogar_chave' ? 'acesso' : 'kit',
              chave: `ordem:${ordem.id}:resultado`,
              dados: { ordemId: ordem.id, ok: res.ok, pedidaPor: ordem.criadaPor },
            },
          });
        });
      }
      return { ok: true, aplicadas };
    });
  }

  /* ------------------------------------------------------------- apoio */

  private async casaDoToken(orgId: string, token: string | undefined) {
    if (!token || token.length < 20) throw new UnauthorizedException('Token da casa ausente.');
    const casa = await this.prisma.frotaCasa.findUnique({ where: { tokenHash: hashToken(token) }, include: { acessos: true } });
    if (!casa || casa.orgId !== orgId || casa.arquivadaEm) throw new UnauthorizedException('Token não reconhecido.');
    return casa;
  }

  private async orgDaPlataforma(): Promise<string> {
    const agora = Date.now();
    if (this.orgPlataforma && this.orgPlataforma.ate > agora) return this.orgPlataforma.id;
    const org = await resolverOrgDoSlugInterno(this.prisma as never, SLUG_DA_PLATAFORMA);
    if (!org) throw new UnauthorizedException('Plataforma não provisionada.');
    this.orgPlataforma = { id: org.orgId, ate: agora + TTL_ORG_MS };
    return org.orgId;
  }

  private async registrar(orgId: string, casaId: string | null, user: JwtUser, acao: string, tipo: 'painel' | 'acesso' | 'kit', chave?: string) {
    await this.prisma.frotaEvento.create({
      data: { orgId, casaId, quando: new Date(), quem: user.email || user.name, acao, origem: 'painel', tipo, chave },
    });
  }

  private resumoDaCasa(c: CasaComRelacoes) {
    const agora = Date.now();
    const relato = relatoGuardado(c.relato);
    const relatando = !!c.ultimoRelatoEm && agora - c.ultimoRelatoEm.getTime() <= JANELA_DE_RELATO_MIN * 60_000;
    let estado = c.estado as 'ok' | 'at' | 'er' | 'ne';
    let estadoTexto = c.estadoTexto ?? (c.etapa === 'pre' ? 'pré-implantação · sem servidor' : 'sem relato');
    if (c.etapa !== 'pre' && c.ultimoRelatoEm && !relatando && estado !== 'er') {
      const min = Math.round((agora - c.ultimoRelatoEm.getTime()) / 60_000);
      estado = 'at';
      estadoTexto = `atenção · sem relato há ${min >= 120 ? `${Math.round(min / 60)} h` : `${min} min`}`;
    }
    const politicas = avaliarPoliticas({
      relato,
      ultimoRelatoEm: c.ultimoRelatoEm,
      etapa: c.etapa,
      acessos: c.acessos,
      ficha: c.ficha as Record<string, unknown> | null,
      lgpd: c.lgpd as Record<string, unknown> | null,
    });
    const ativas = c.acessos.filter((a) => a.estado === 'ativa' || a.estado === 'revogando');
    return {
      id: c.id,
      casa: c.casa,
      cliente: c.cliente,
      dono: c.dono,
      responsavel: c.responsavel,
      etapa: c.etapa,
      provedor: c.provedor,
      hostname: c.hostname,
      ip: c.ip,
      vpn: c.vpn,
      sistema: c.sistema,
      maquina: c.maquina,
      kitVersao: c.kitVersao,
      acesso: c.acesso,
      estado,
      estadoTexto,
      ultimoRelatoEm: c.ultimoRelatoEm,
      relatando,
      sonda: relato?.sonda ? { estado: relato.sonda.estado, ultima: relato.sonda.ultima ?? null } : null,
      backup: relato?.backup ? { ultimoOk: relato.backup.ultimoOk ?? null, remoto: relato.backup.remoto } : null,
      disco: relato?.maquina.discoUsoPct ?? null,
      cpuPct: relato?.maquina.cpuPct ?? null,
      memPct: relato?.maquina.memPct ?? null,
      carga: relato?.maquina.carga ?? null,
      apps: { total: relato?.containers.length ?? 0, rodando: relato?.containers.filter((x) => x.estado === 'running' && x.saude !== 'unhealthy').length ?? 0 },
      containers: relato?.containers ?? [],
      timers: relato?.timers ?? [],
      verificar: relato?.verificar ?? [],
      falhas: relato?.verificar.filter((v) => v.n === 'fa').length ?? 0,
      avisos: relato?.verificar.filter((v) => v.n === 'av').length ?? 0,
      chaves: ativas.length,
      pessoas: ativas.map((a) => a.pessoa),
      pedidos: c.acessos.filter((a) => a.estado === 'pedido').length,
      ordensPendentes: c.ordens.length,
      pendencias: pendenciasDaCasa(relato, c.etapa, c.acessos),
      politicas: {
        ok: politicas.filter((p) => p.estado === 'ok').length,
        at: politicas.filter((p) => p.estado === 'at').length,
        er: politicas.filter((p) => p.estado === 'er').length,
      },
      observacoes: c.observacoes,
    };
  }
}

export type ResumoDaCasa = ReturnType<FrotaService['resumoDaCasa']>;

function relatoGuardado(json: Prisma.JsonValue | null): Relato | null {
  if (!json) return null;
  const r = RelatoSchema.safeParse(json);
  return r.success ? r.data : null;
}

function mapEvento(e: { id: string; casaId: string | null; casa?: { casa: string } | null; quando: Date; quem: string; acao: string; origem: string; tipo: string; dados: Prisma.JsonValue | null }) {
  return { id: e.id, casaId: e.casaId, casa: e.casa?.casa ?? null, quando: e.quando, quem: e.quem, acao: e.acao, origem: e.origem, tipo: e.tipo, dados: e.dados };
}

function mapOrdem(o: { id: string; casaId: string; tipo: string; parametros: Prisma.JsonValue | null; estado: string; criadaPor: string; motivo: string | null; entregueEm: Date | null; concluidaEm: Date | null; resultado: Prisma.JsonValue | null; createdAt: Date }) {
  return { id: o.id, casaId: o.casaId, tipo: o.tipo, parametros: o.parametros, estado: o.estado, criadaPor: o.criadaPor, motivo: o.motivo, criadaEm: o.createdAt, entregueEm: o.entregueEm, concluidaEm: o.concluidaEm, resultado: o.resultado };
}
