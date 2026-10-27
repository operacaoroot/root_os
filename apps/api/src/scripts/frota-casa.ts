import { createHash, randomBytes } from 'node:crypto';
import { ActorType, PrismaClient } from '@prisma/client';

import { comContexto } from '../common/contexto-execucao';
import { comTenantNaSessao } from '../prisma/sessao-de-banco';

/*
 * Cadastra uma CASA da Frota (ou troca o token do relator de uma que já existe)
 * de dentro do container da API, sem passar pela tela:
 *
 *   node dist/scripts/frota-casa.js --org root --casa affari --cliente "Affari Perícia Contábil" \
 *     [--dono "Antônio Fernandes"] [--responsavel Rodrigo] [--etapa manter] [--acesso vpn] \
 *     [--provedor "Hostinger KVM · conta do cliente"] [--ip 1.2.3.4] [--novo-token] --valer
 *
 * Padrão: simula. O token aparece UMA vez, na saída; só o hash fica no banco.
 * Casa que já existe: sem `--novo-token` nada muda; com ele, o token é trocado e
 * o antigo deixa de valer na hora.
 */

const CASA = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ETAPAS = ['pre', 'preparar', 'subir', 'manter', 'acompanhar', 'encerrada', 'fora-do-kit'];

function arg(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valer = args.includes('--valer');
  const novoToken = args.includes('--novo-token');
  const org = arg(args, 'org') ?? 'root';
  const casa = arg(args, 'casa');
  const cliente = arg(args, 'cliente');
  if (!casa || !CASA.test(casa)) throw new Error('--casa é obrigatório: nome curto do kit (a-z, 0-9, hífen)');
  const etapa = arg(args, 'etapa') ?? 'preparar';
  if (!ETAPAS.includes(etapa)) throw new Error(`--etapa precisa ser uma de: ${ETAPAS.join(', ')}`);
  const acesso = arg(args, 'acesso') ?? 'publico';
  if (!['publico', 'vpn'].includes(acesso)) throw new Error('--acesso é publico ou vpn');

  const base = new PrismaClient();
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });
  try {
    const empresa = await prisma.org.findFirst({ where: { OR: [{ id: org }, { slug: org }] }, select: { id: true, slug: true } });
    if (!empresa) throw new Error(`empresa "${org}" não encontrada`);
    await comContexto(
      { orgId: empresa.id, actorType: ActorType.system, actorId: null, correlationId: `terminal-frota-casa-${casa}`, origem: 'script' },
      async () => {
        const existe = await prisma.frotaCasa.findFirst({ where: { orgId: empresa.id, casa }, select: { id: true, cliente: true, etapa: true } });
        if (existe && !novoToken) {
          console.log(`a casa ${casa} já existe (${existe.cliente}, etapa ${existe.etapa}). Para trocar o token: --novo-token --valer.`);
          return;
        }
        if (!existe && !cliente) throw new Error('--cliente é obrigatório para criar a casa');
        const token = `frota_${randomBytes(32).toString('hex')}`;
        const tokenHash = createHash('sha256').update(token).digest('hex');
        if (!valer) {
          console.log(existe ? `SIMULAÇÃO: trocaria o token do relator da casa ${casa}.` : `SIMULAÇÃO: criaria a casa ${casa} (${cliente}) na empresa ${empresa.slug}, etapa ${etapa}, acesso ${acesso}.`);
          console.log('Rode com --valer para fazer.');
          return;
        }
        if (existe) {
          await prisma.frotaCasa.update({ where: { id: existe.id }, data: { tokenHash } });
          await prisma.frotaEvento.create({ data: { orgId: empresa.id, casaId: existe.id, quando: new Date(), quem: 'terminal', acao: `Token do relator da casa ${casa} trocado pela linha de comando. O antigo não entra mais.`, origem: 'painel', tipo: 'painel' } });
          console.log(`token novo da casa ${casa} (aparece só agora):`);
        } else {
          const criada = await prisma.frotaCasa.create({
            data: {
              orgId: empresa.id, casa, cliente: cliente as string, dono: arg(args, 'dono'), responsavel: arg(args, 'responsavel'),
              etapa, acesso, provedor: arg(args, 'provedor'), ip: arg(args, 'ip'), hostname: arg(args, 'hostname'), tokenHash, ficha: {}, lgpd: {},
            },
          });
          await prisma.frotaEvento.create({ data: { orgId: empresa.id, casaId: criada.id, quando: new Date(), quem: 'terminal', acao: `Casa ${casa} criada pela linha de comando (${cliente}). Token do relator emitido.`, origem: 'painel', tipo: 'painel', chave: `casa+:${criada.id}` } });
          console.log(`casa ${casa} criada (id ${criada.id}). Token do relator (aparece só agora):`);
        }
        console.log(`FROTA_TOKEN=${token}`);
        console.log('Grave em /etc/kit/maquina.env da casa, com FROTA_URL=https://os.operacaoroot.com/api, e rode: bash /opt/kit-instalacao-vps/instalar.sh 09');
      },
    );
  } finally {
    await base.$disconnect();
  }
}

if (/frota-casa\.js$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('\nfalhou:', (e as Error).message);
    process.exit(1);
  });
}
