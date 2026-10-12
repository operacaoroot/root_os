import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  TOTEM_POLITICA_VERSAO,
  TotemCadastroCorpoSchema,
  totemMascararCpf,
  totemMontarPolitica,
  type TotemCadastroResposta,
  type TotemPoliticaResposta,
} from '@mktos/shared';

import { comTenantPublico, resolverTenantDaEtiqueta, resolverTenantDoTotem } from '../../common/tenant-publico';
import { PrismaService } from '../../prisma/prisma.service';
import { exigirModuloTotem, totemNaoEncontrado } from '../comum/modulo';
import { hashToken } from '../comum/segredos';
import { cadastrarCliente, type EntradaDoCadastro } from './cadastrar';
import { hashDoCpf, lerPepper } from './cpf';

/*
 * A ROTA PÚBLICA DO CADASTRO: quem chama é o quiosque (token do aparelho) ou o
 * celular que leu o QR da etiqueta (código da etiqueta). O controller já
 * conferiu o teto por origem e o formato da credencial.
 *
 * CPF e celular não vão para log em nenhum caminho. Erro inesperado dentro da
 * transação é trocado por um 500 genérico antes de subir: a mensagem de erro do
 * Prisma pode citar os argumentos da consulta, e eles incluem o celular.
 */

export type CredencialDoCadastro = { tipo: 'token'; token: string } | { tipo: 'etiqueta'; codigo: string };

interface OrigemDoCadastro {
  orgId: string;
  lojaId: string;
  dispositivoId: string | null;
  canal: 'totem' | 'qr';
}

export const MENSAGEM_CADASTRO_FORA_DO_AR = 'O cadastro está fora do ar agora. Fale com um atendente.';
export const MENSAGEM_CADASTRO_FECHADO = 'O cadastro não está aberto nesta loja. Fale com um atendente.';
export const MENSAGEM_POLITICA_NOVA =
  'A política de privacidade foi atualizada. Abra o cadastro de novo para ler a versão nova.';
export const MENSAGEM_TOTEM_DESATIVADO = 'Este totem foi desativado. Fale com um atendente.';

function ehUnicidade(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

@Injectable()
export class TotemCadastroService {
  private readonly log = new Logger('TotemCadastro');

  constructor(private readonly prisma: PrismaService) {}

  private async resolver(cred: CredencialDoCadastro): Promise<OrigemDoCadastro> {
    if (cred.tipo === 'token') {
      const d = await resolverTenantDoTotem(this.prisma, hashToken(cred.token));
      if (!d || d.revogadoEm) throw new UnauthorizedException(MENSAGEM_TOTEM_DESATIVADO);
      return { orgId: d.orgId, lojaId: d.lojaId, dispositivoId: d.dispositivoId, canal: 'totem' };
    }
    const e = await resolverTenantDaEtiqueta(this.prisma, cred.codigo);
    if (!e || e.revogadaEm) throw totemNaoEncontrado();
    return { orgId: e.orgId, lojaId: e.lojaId, dispositivoId: null, canal: 'qr' };
  }

  /** Loja desativada fecha o cadastro dela pelo totem e pelo QR, como já fecha o catálogo. */
  private async exigirLojaAtiva(origem: OrigemDoCadastro): Promise<void> {
    const loja = await this.prisma.totemLoja.findFirst({
      where: { id: origem.lojaId, orgId: origem.orgId, ativa: true },
      select: { id: true },
    });
    if (!loja) throw totemNaoEncontrado();
  }

  async politica(cred: CredencialDoCadastro): Promise<TotemPoliticaResposta> {
    const origem = await this.resolver(cred);
    return comTenantPublico(origem.orgId, async () => {
      await exigirModuloTotem(this.prisma, origem.orgId);
      await this.exigirLojaAtiva(origem);
      const config = await this.prisma.totemConfig.findUnique({
        where: { orgId: origem.orgId },
        select: {
          cadastroLigado: true,
          controladorNome: true,
          controladorDocumento: true,
          controladorEndereco: true,
          encarregadoNome: true,
          encarregadoContato: true,
        },
      });
      return { ...totemMontarPolitica(config ?? {}), cadastroLigado: config?.cadastroLigado ?? false };
    });
  }

  async cadastrar(cred: CredencialDoCadastro, corpoBruto: unknown): Promise<TotemCadastroResposta> {
    const pepper = lerPepper();
    if (!pepper) {
      this.log.error('cadastro recusado: TOTEM_CPF_PEPPER ausente ou com menos de 32 caracteres');
      throw new ServiceUnavailableException(MENSAGEM_CADASTRO_FORA_DO_AR);
    }
    const corpo = TotemCadastroCorpoSchema.parse(corpoBruto);
    const origem = await this.resolver(cred);

    return comTenantPublico(origem.orgId, async () => {
      await exigirModuloTotem(this.prisma, origem.orgId);
      await this.exigirLojaAtiva(origem);
      const config = await this.prisma.totemConfig.findUnique({
        where: { orgId: origem.orgId },
        select: { cadastroLigado: true },
      });
      if (!config?.cadastroLigado) throw new ForbiddenException(MENSAGEM_CADASTRO_FECHADO);
      if (corpo.politicaVersao !== TOTEM_POLITICA_VERSAO) throw new ConflictException(MENSAGEM_POLITICA_NOVA);

      const entrada: EntradaDoCadastro = {
        ...origem,
        cpfHash: hashDoCpf(pepper, corpo.cpf),
        cpfMascarado: totemMascararCpf(corpo.cpf),
        telefone: corpo.telefone,
        nome: corpo.nome,
        aceitaCampanhas: corpo.aceitaCampanhas,
        politicaVersao: TOTEM_POLITICA_VERSAO,
      };
      const executar = () => this.prisma.$transaction((tx) => cadastrarCliente(tx, entrada));
      try {
        try {
          return await executar();
        } catch (e) {
          // Dois cadastros do mesmo CPF ao mesmo tempo: o segundo bate na
          // unicidade e, na segunda volta, encontra o cliente e o cupom do primeiro.
          if (!ehUnicidade(e)) throw e;
          return await executar();
        }
      } catch (e) {
        if (e instanceof HttpException) throw e;
        const codigo = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : (e as Error)?.name;
        this.log.error(`cadastro falhou na gravação (${codigo ?? 'erro desconhecido'})`);
        throw new InternalServerErrorException('Não foi possível concluir o cadastro. Tente de novo em instantes.');
      }
    });
  }
}
