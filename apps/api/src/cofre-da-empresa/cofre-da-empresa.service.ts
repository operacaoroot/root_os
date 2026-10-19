import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { cifrar, decifrar } from '../common/crypto';

/*
 * COFRE DA EMPRESA
 *
 * Senhas, dados e documentos dos sócios, atrás de uma senha do cofre que é de
 * cada pessoa e não é a do login. O que a tela protege é a sessão aberta e
 * esquecida: sem a senha do cofre, quem senta no computador logado não vê nada.
 *
 * O que ela NÃO protege, e a decisão foi tomada sabendo disso: os campos são
 * cifrados com a chave do servidor (common/crypto), então quem tem o servidor
 * e a chave consegue ler. Cópia do banco e backup sozinhos não mostram nada.
 *
 * Regras:
 *  - destrancar abre uma sessão do cofre de 15 min que renova a cada uso;
 *  - 5 senhas erradas seguidas bloqueiam o cofre daquela pessoa por 15 min;
 *  - a lista mostra só tipo, título e "onde"; usuário, segredo, notas e o
 *    arquivo abrem um item por vez e cada abertura fica no registro de ações;
 *  - fora do alcance da IA: nenhuma ferramenta do MCP, agente ou "Perguntar"
 *    lê estas tabelas. Não exponha este serviço a eles.
 */

export const MINUTOS_DA_SESSAO = 15;
/** Criar a senha do cofre pela 1ª vez vale até este tempo depois do login (quem entra pelo Google não tem senha de login). */
export const MINUTOS_DO_LOGIN_RECENTE = 10;
export const TENTATIVAS_ATE_BLOQUEAR = 5;
export const MINUTOS_DE_BLOQUEIO = 15;
export const TETO_DO_ARQUIVO = 10 * 1024 * 1024;
const TIPOS = ['senha', 'dado', 'documento'] as const;

export const DefinirSenhaSchema = z.object({
  senhaNova: z.string().min(8, 'A senha do cofre precisa de pelo menos 8 caracteres.').max(200),
  senhaAtual: z.string().max(200).optional(),
  senhaDoLogin: z.string().max(200).optional(),
});
export const DestrancarSchema = z.object({ senha: z.string().min(1).max(200) });
export const ItemSchema = z.object({
  tipo: z.enum(TIPOS),
  titulo: z.string().trim().min(1).max(120),
  onde: z.string().trim().max(300).nullable().optional(),
  usuario: z.string().max(300).nullable().optional(),
  segredo: z.string().max(5000).nullable().optional(),
  notas: z.string().max(5000).nullable().optional(),
});
export const ItemUpdateSchema = ItemSchema.partial();

const hashDoToken = (t: string) => createHash('sha256').update(t).digest('hex');
const aad = (orgId: string, id: string, campo: string) => `cofre-da-empresa:${orgId}:${id}:${campo}`;
const fechar = (orgId: string, id: string, campo: string, v: string | null | undefined) =>
  v ? cifrar(v, { aad: aad(orgId, id, campo) }) : null;
const abrir = (orgId: string, id: string, campo: string, v: string | null) =>
  v ? decifrar(v, { aad: aad(orgId, id, campo) }) : null;

export class CofreTrancadoException extends HttpException {
  constructor(msg = 'O cofre está trancado. Digite a senha do cofre.') {
    super({ statusCode: 423, message: msg, cofre: 'trancado' }, 423);
  }
}

@Injectable()
export class CofreDaEmpresaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ---------------- senha e sessão ----------------
  async estado(orgId: string, userId: string, token?: string) {
    const senha = await this.prisma.cofreSenha.findUnique({ where: { orgId_userId: { orgId, userId } } });
    const aberto = token ? !!(await this.sessaoValida(orgId, userId, token, false)) : false;
    return {
      temSenha: !!senha,
      aberto,
      bloqueadoAte: senha?.bloqueadoAte && senha.bloqueadoAte > new Date() ? senha.bloqueadoAte.toISOString() : null,
      minutosDaSessao: MINUTOS_DA_SESSAO,
    };
  }

  /** `loginEm`: segundos (iat) do token de sessão; prova que a pessoa acabou de entrar no OS. */
  async definirSenha(orgId: string, userId: string, input: z.infer<typeof DefinirSenhaSchema>, loginEm?: number) {
    const atual = await this.prisma.cofreSenha.findUnique({ where: { orgId_userId: { orgId, userId } } });
    if (atual) {
      // trocar: exige a senha do cofre de agora
      if (!input.senhaAtual || !(await bcrypt.compare(input.senhaAtual, atual.hash))) {
        throw new ForbiddenException('A senha atual do cofre não confere.');
      }
    } else {
      // Primeira vez: prova de que é a própria pessoa, para quem achar a sessão aberta não criar o cofre
      // no lugar dela. Vale a senha do login OU um login feito há pouco (quem entra pelo Google não tem
      // senha de login; entrar de novo pelo Google é a prova).
      const recente = typeof loginEm === 'number' && Date.now() - loginEm * 1000 <= MINUTOS_DO_LOGIN_RECENTE * 60_000;
      let pelaSenha = false;
      if (input.senhaDoLogin) {
        const user = await this.prisma.user.findFirst({ where: { id: userId, orgId }, select: { passwordHash: true } });
        pelaSenha = !!user && (await bcrypt.compare(input.senhaDoLogin, user.passwordHash));
        if (!pelaSenha && !recente) throw new ForbiddenException('A senha do login não confere.');
      }
      if (!pelaSenha && !recente) {
        throw new ForbiddenException(
          `Para criar a senha do cofre, saia e entre de novo no OS (pelo Google ou pela senha) e crie em até ${MINUTOS_DO_LOGIN_RECENTE} minutos.`,
        );
      }
    }
    const hash = await bcrypt.hash(input.senhaNova, 12);
    await this.prisma.cofreSenha.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: { orgId, userId, hash },
      update: { hash, tentativas: 0, bloqueadoAte: null },
    });
    await this.prisma.cofreSessao.deleteMany({ where: { orgId, userId } });
    await this.audit.log({ orgId, actorId: userId, action: atual ? 'cofre.senha.trocar' : 'cofre.senha.criar', entityType: 'cofre', entityId: userId });
    return { ok: true };
  }

  async destrancar(orgId: string, userId: string, senha: string) {
    const reg = await this.prisma.cofreSenha.findUnique({ where: { orgId_userId: { orgId, userId } } });
    if (!reg) throw new BadRequestException('Crie a senha do cofre primeiro.');
    if (reg.bloqueadoAte && reg.bloqueadoAte > new Date()) {
      throw new HttpException(
        { statusCode: 429, message: `Muitas tentativas. Tente de novo depois de ${reg.bloqueadoAte.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await bcrypt.compare(senha, reg.hash))) {
      const tentativas = reg.tentativas + 1;
      const bloquear = tentativas >= TENTATIVAS_ATE_BLOQUEAR;
      await this.prisma.cofreSenha.update({
        where: { id: reg.id },
        data: bloquear ? { tentativas: 0, bloqueadoAte: new Date(Date.now() + MINUTOS_DE_BLOQUEIO * 60_000) } : { tentativas },
      });
      await this.audit.log({ orgId, actorId: userId, action: bloquear ? 'cofre.bloqueado' : 'cofre.destrancar.falhou', entityType: 'cofre', entityId: userId });
      throw new UnauthorizedException(
        bloquear ? `Senha errada. O cofre ficou bloqueado por ${MINUTOS_DE_BLOQUEIO} minutos.` : `Senha errada. Restam ${TENTATIVAS_ATE_BLOQUEAR - tentativas} tentativas.`,
      );
    }
    await this.prisma.cofreSenha.update({ where: { id: reg.id }, data: { tentativas: 0, bloqueadoAte: null } });
    await this.prisma.cofreSessao.deleteMany({ where: { orgId, userId, expiraEm: { lt: new Date() } } });
    const token = randomBytes(32).toString('hex');
    const expiraEm = new Date(Date.now() + MINUTOS_DA_SESSAO * 60_000);
    await this.prisma.cofreSessao.create({ data: { orgId, userId, tokenHash: hashDoToken(token), expiraEm } });
    await this.audit.log({ orgId, actorId: userId, action: 'cofre.destrancar', entityType: 'cofre', entityId: userId });
    return { token, expiraEm: expiraEm.toISOString() };
  }

  async trancar(orgId: string, userId: string, token?: string) {
    if (token) await this.prisma.cofreSessao.deleteMany({ where: { orgId, userId, tokenHash: hashDoToken(token) } });
    return { ok: true };
  }

  /** Confere a sessão do cofre e renova o prazo. Sem sessão válida, 423. */
  private async sessaoValida(orgId: string, userId: string, token: string | undefined, renovar = true) {
    if (!token) return null;
    const s = await this.prisma.cofreSessao.findUnique({ where: { tokenHash: hashDoToken(token) } });
    if (!s || s.orgId !== orgId || s.userId !== userId || s.expiraEm < new Date()) return null;
    if (renovar) {
      await this.prisma.cofreSessao.update({ where: { id: s.id }, data: { expiraEm: new Date(Date.now() + MINUTOS_DA_SESSAO * 60_000) } });
    }
    return s;
  }

  private async exigirAberto(orgId: string, userId: string, token: string | undefined) {
    if (!(await this.sessaoValida(orgId, userId, token))) throw new CofreTrancadoException();
  }

  /**
   * Esqueceu a senha do cofre: outro sócio, com o próprio cofre aberto, zera a
   * senha dele. Os itens continuam (são da empresa); a pessoa cria uma senha nova
   * confirmando a do login. Ninguém zera a própria por aqui.
   */
  async zerarSenhaDeOutro(orgId: string, userId: string, token: string | undefined, alvoId: string) {
    await this.exigirAberto(orgId, userId, token);
    if (alvoId === userId) throw new BadRequestException('Para trocar a sua, use "Trocar senha do cofre".');
    const alvo = await this.prisma.user.findFirst({ where: { id: alvoId, orgId }, select: { id: true, name: true } });
    if (!alvo) throw new NotFoundException('Pessoa não encontrada');
    await this.prisma.cofreSenha.deleteMany({ where: { orgId, userId: alvoId } });
    await this.prisma.cofreSessao.deleteMany({ where: { orgId, userId: alvoId } });
    await this.audit.log({ orgId, actorId: userId, action: 'cofre.senha.zerar', entityType: 'cofre', entityId: alvoId, after: { de: alvo.name } });
    return { ok: true };
  }

  /** Quem da empresa já tem senha do cofre (para o sócio poder zerar a de outro). */
  async pessoas(orgId: string, userId: string, token: string | undefined) {
    await this.exigirAberto(orgId, userId, token);
    const [users, senhas] = await Promise.all([
      this.prisma.user.findMany({ where: { orgId, roles: { some: { permissions: { some: { key: 'cofre.ver' } } } } }, select: { id: true, name: true, email: true } }),
      this.prisma.cofreSenha.findMany({ where: { orgId }, select: { userId: true } }),
    ]);
    const com = new Set(senhas.map((x) => x.userId));
    return users.map((u) => ({ id: u.id, nome: u.name, email: u.email, temSenha: com.has(u.id), eu: u.id === userId }));
  }

  // ---------------- itens ----------------
  async listar(orgId: string, userId: string, token?: string) {
    await this.exigirAberto(orgId, userId, token);
    const itens = await this.prisma.cofreItem.findMany({ where: { orgId }, orderBy: [{ tipo: 'asc' }, { titulo: 'asc' }] });
    return itens.map((i) => ({
      id: i.id, tipo: i.tipo, titulo: i.titulo, onde: i.onde,
      temUsuario: !!i.usuarioCifrado, temSegredo: !!i.segredoCifrado, temNotas: !!i.notasCifradas,
      arquivo: i.arquivoChave ? { nome: i.arquivoNome, tipo: i.arquivoTipo, tamanho: i.arquivoTamanho } : null,
      atualizadoEm: i.updatedAt.toISOString(),
    }));
  }

  async revelar(orgId: string, userId: string, token: string | undefined, id: string) {
    await this.exigirAberto(orgId, userId, token);
    const i = await this.prisma.cofreItem.findFirst({ where: { id, orgId } });
    if (!i) throw new NotFoundException('Item não encontrado');
    await this.audit.log({ orgId, actorId: userId, action: 'cofre.item.revelar', entityType: 'cofre_item', entityId: id, after: { titulo: i.titulo } });
    return {
      id: i.id,
      usuario: abrir(orgId, id, 'usuario', i.usuarioCifrado),
      segredo: abrir(orgId, id, 'segredo', i.segredoCifrado),
      notas: abrir(orgId, id, 'notas', i.notasCifradas),
    };
  }

  async criar(orgId: string, userId: string, token: string | undefined, input: z.infer<typeof ItemSchema>) {
    await this.exigirAberto(orgId, userId, token);
    const id = randomUUID();
    await this.prisma.cofreItem.create({
      data: {
        id, orgId, tipo: input.tipo, titulo: input.titulo, onde: input.onde ?? null, criadoPor: userId,
        usuarioCifrado: fechar(orgId, id, 'usuario', input.usuario),
        segredoCifrado: fechar(orgId, id, 'segredo', input.segredo),
        notasCifradas: fechar(orgId, id, 'notas', input.notas),
      },
    });
    await this.audit.log({ orgId, actorId: userId, action: 'cofre.item.criar', entityType: 'cofre_item', entityId: id, after: { tipo: input.tipo, titulo: input.titulo } });
    return { ok: true, id };
  }

  async alterar(orgId: string, userId: string, token: string | undefined, id: string, input: z.infer<typeof ItemUpdateSchema>) {
    await this.exigirAberto(orgId, userId, token);
    const antes = await this.prisma.cofreItem.findFirst({ where: { id, orgId } });
    if (!antes) throw new NotFoundException('Item não encontrado');
    await this.prisma.cofreItem.update({
      where: { id },
      data: {
        ...(input.tipo !== undefined ? { tipo: input.tipo } : {}),
        ...(input.titulo !== undefined ? { titulo: input.titulo } : {}),
        ...(input.onde !== undefined ? { onde: input.onde } : {}),
        ...(input.usuario !== undefined ? { usuarioCifrado: fechar(orgId, id, 'usuario', input.usuario) } : {}),
        ...(input.segredo !== undefined ? { segredoCifrado: fechar(orgId, id, 'segredo', input.segredo) } : {}),
        ...(input.notas !== undefined ? { notasCifradas: fechar(orgId, id, 'notas', input.notas) } : {}),
      },
    });
    // o registro diz O QUE mudou, nunca o valor
    const campos = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
    await this.audit.log({ orgId, actorId: userId, action: 'cofre.item.alterar', entityType: 'cofre_item', entityId: id, after: { titulo: input.titulo ?? antes.titulo, campos } });
    return { ok: true, id };
  }

  async apagar(orgId: string, userId: string, token: string | undefined, id: string) {
    await this.exigirAberto(orgId, userId, token);
    const antes = await this.prisma.cofreItem.findFirst({ where: { id, orgId } });
    if (!antes) throw new NotFoundException('Item não encontrado');
    if (antes.arquivoChave) await this.storage.remover(antes.arquivoChave).catch(() => undefined);
    await this.prisma.cofreItem.delete({ where: { id } });
    await this.audit.log({ orgId, actorId: userId, action: 'cofre.item.apagar', entityType: 'cofre_item', entityId: id, before: { tipo: antes.tipo, titulo: antes.titulo } });
    return { ok: true };
  }

  // ---------------- arquivo ----------------
  async guardarArquivo(
    orgId: string, userId: string, token: string | undefined, id: string,
    arquivo: { nome: string; tipo: string; corpo: Readable; tamanhoDeclarado: number },
  ) {
    await this.exigirAberto(orgId, userId, token);
    const item = await this.prisma.cofreItem.findFirst({ where: { id, orgId } });
    if (!item) throw new NotFoundException('Item não encontrado');
    if (!(arquivo.tamanhoDeclarado > 0) || arquivo.tamanhoDeclarado > TETO_DO_ARQUIVO) {
      throw new HttpException(`O arquivo precisa ter até ${TETO_DO_ARQUIVO / 1024 / 1024} MB.`, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const partes: Buffer[] = [];
    let lido = 0;
    for await (const pedaco of arquivo.corpo) {
      lido += (pedaco as Buffer).length;
      if (lido > TETO_DO_ARQUIVO) throw new HttpException('Arquivo maior que o permitido.', HttpStatus.PAYLOAD_TOO_LARGE);
      partes.push(pedaco as Buffer);
    }
    const bytes = Buffer.concat(partes);
    const pacote = cifrar(bytes.toString('base64'), { aad: aad(orgId, id, 'arquivo') });
    const chave = `cofre-da-empresa/${orgId}/${id}/${randomUUID()}`;
    await this.storage.put(chave, Buffer.from(pacote, 'utf8'), 'application/octet-stream');
    if (item.arquivoChave && item.arquivoChave !== chave) await this.storage.remover(item.arquivoChave).catch(() => undefined);
    await this.prisma.cofreItem.update({
      where: { id },
      data: { arquivoChave: chave, arquivoNome: arquivo.nome.slice(0, 200), arquivoTipo: arquivo.tipo.slice(0, 100), arquivoTamanho: bytes.length },
    });
    await this.audit.log({ orgId, actorId: userId, action: 'cofre.arquivo.guardar', entityType: 'cofre_item', entityId: id, after: { titulo: item.titulo, tamanho: bytes.length } });
    return { ok: true };
  }

  async abrirArquivo(orgId: string, userId: string, token: string | undefined, id: string) {
    await this.exigirAberto(orgId, userId, token);
    const item = await this.prisma.cofreItem.findFirst({ where: { id, orgId } });
    if (!item?.arquivoChave) throw new NotFoundException('Este item não tem arquivo.');
    const { stream } = await this.storage.get(item.arquivoChave);
    const partes: Buffer[] = [];
    for await (const p of stream) partes.push(p as Buffer);
    const bytes = Buffer.from(decifrar(Buffer.concat(partes).toString('utf8'), { aad: aad(orgId, id, 'arquivo') }), 'base64');
    await this.audit.log({ orgId, actorId: userId, action: 'cofre.arquivo.abrir', entityType: 'cofre_item', entityId: id, after: { titulo: item.titulo } });
    return { bytes, nome: item.arquivoNome ?? 'arquivo', tipo: item.arquivoTipo ?? 'application/octet-stream' };
  }
}
