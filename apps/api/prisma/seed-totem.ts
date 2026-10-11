import { chmodSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { normalizarBusca, TOTEM_POLITICA_VERSAO, type RoleKey, type TotemNutriente, type TotemSelo } from '@mktos/shared';

/*
 * A SEMENTE DO MÓDULO TOTEM (docs/totem/CONTRATO.md, seção 13).
 *
 *   TOTEM_ORG_SLUG=sragranel TOTEM_SEED_SAIDA=/fora/do/repositorio/logins.txt \
 *     pnpm --filter @mktos/api db:seed:totem
 *
 * A empresa já tem de existir (provisionamento) e ter os papéis `totem_*`
 * (`db:sync-permissions`). A semente liga o módulo, cria a configuração, três
 * lojas e uns 30 produtos de exemplo, lotes, remessas, uma campanha e quatro
 * usuários de teste.
 *
 * IDEMPOTENTE E DE PRESERVAÇÃO, como `prisma/seed.ts`: o que já existe (pelo
 * código da loja, do produto e do lote, pelo e-mail do usuário, pela observação
 * da remessa) fica como está, mesmo que o painel o tenha editado depois. Rodar
 * de novo só cria o que falta, e nada é apagado.
 *
 * AS SENHAS. Cada usuário de teste nasce com senha aleatória, gravada só no
 * arquivo de TOTEM_SEED_SAIDA (chmod 600, recusado se estiver dentro do
 * repositório). Nenhuma senha vai para o stdout. Usuário que já existe não tem
 * a senha trocada, e nesse caso o arquivo nem é aberto.
 */

const prisma = new PrismaClient();
const RAIZ_DO_REPOSITORIO = path.resolve(__dirname, '..', '..', '..');

const FONTE_TACO =
  'Valores por 100 g da Tabela Brasileira de Composição de Alimentos (TACO), 4ª edição (NEPA/Unicamp, 2011). ' +
  'É referência de exemplo: confira com o rótulo do fornecedor antes de mostrar ao cliente.';
const FONTE_ROTULO = 'A TACO não traz este item. Preencha a ficha pelo rótulo do fornecedor.';

/** Valores diários de referência para adultos (Anvisa, IN 75/2020, anexo II). */
const VD = { kcal: 2000, carboidratos: 300, proteinas: 50, gorduras: 65, fibra: 25, sodio: 2000 } as const;

/** Por 100 g: energia (kcal), carboidratos, proteínas, gorduras totais e fibra (g), sódio (mg). */
type Taco = [kcal: number, carboidratos: number, proteinas: number, gorduras: number, fibra: number, sodio: number];

function fichaDaTaco([kcal, carb, prot, gord, fibra, sodio]: Taco): TotemNutriente[] {
  const vd = (valor: number, referencia: number) => Math.round((valor / referencia) * 100);
  return [
    { nutriente: 'Valor energético', quantidade: kcal, unidade: 'kcal', vd: vd(kcal, VD.kcal) },
    { nutriente: 'Carboidratos', quantidade: carb, unidade: 'g', vd: vd(carb, VD.carboidratos) },
    { nutriente: 'Proteínas', quantidade: prot, unidade: 'g', vd: vd(prot, VD.proteinas) },
    { nutriente: 'Gorduras totais', quantidade: gord, unidade: 'g', vd: vd(gord, VD.gorduras) },
    { nutriente: 'Fibra alimentar', quantidade: fibra, unidade: 'g', vd: vd(fibra, VD.fibra) },
    { nutriente: 'Sódio', quantidade: sodio, unidade: 'mg', vd: vd(sodio, VD.sodio) },
  ];
}

interface ProdutoDeExemplo {
  nome: string;
  categoria: string;
  composicao: string;
  alergenicos?: string;
  /** Sem TACO, a ficha fica vazia e a fonte manda conferir o rótulo. */
  taco?: Taco;
  /*
   * Nenhum produto sai com o selo "sem glúten": a loja fraciona farinha de trigo
   * no mesmo ambiente, e quem pode afirmar a ausência de contaminação é ela.
   */
  selos: TotemSelo[];
  validadeDias: number;
}

const OLEAGINOSA = 'Castanhas e sementes';
const GRAO = 'Grãos e cereais';
const FARINHA = 'Farinhas e amidos';
const ACUCAR = 'Açúcares';
const FRUTA = 'Frutas secas';
const CHA = 'Chás';
const TEMPERO = 'Temperos';

const PRODUTOS: ProdutoDeExemplo[] = [
  { nome: 'Castanha-do-pará', categoria: OLEAGINOSA, composicao: 'Castanha-do-brasil crua.', alergenicos: 'Alérgicos: contém castanha-do-brasil.', taco: [643, 15.1, 14.5, 63.5, 7.9, 1], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Castanha de caju torrada e salgada', categoria: OLEAGINOSA, composicao: 'Castanha-de-caju torrada e sal.', alergenicos: 'Alérgicos: contém castanha-de-caju.', taco: [570, 29.1, 18.5, 46.3, 3.7, 125], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Amendoim cru', categoria: OLEAGINOSA, composicao: 'Amendoim em grão cru.', alergenicos: 'Alérgicos: contém amendoim.', taco: [544, 20.3, 27.2, 43.9, 8.0, 0], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Amendoim torrado e salgado', categoria: OLEAGINOSA, composicao: 'Amendoim torrado e sal.', alergenicos: 'Alérgicos: contém amendoim.', taco: [606, 18.7, 22.5, 54.0, 7.8, 376], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Amêndoa torrada e salgada', categoria: OLEAGINOSA, composicao: 'Amêndoa torrada e sal.', alergenicos: 'Alérgicos: contém amêndoa.', taco: [581, 29.5, 18.6, 47.3, 11.6, 279], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Nozes', categoria: OLEAGINOSA, composicao: 'Noz crua sem casca.', alergenicos: 'Alérgicos: contém nozes.', taco: [620, 18.4, 14.0, 59.4, 7.2, 5], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Linhaça', categoria: OLEAGINOSA, composicao: 'Semente de linhaça.', taco: [495, 43.3, 14.1, 32.3, 33.5, 9], selos: ['vegano'], validadeDias: 240 },
  { nome: 'Gergelim', categoria: OLEAGINOSA, composicao: 'Semente de gergelim.', taco: [584, 21.6, 21.2, 50.4, 11.9, 3], selos: ['vegano'], validadeDias: 240 },
  { nome: 'Arroz integral', categoria: GRAO, composicao: 'Arroz integral cru.', taco: [360, 77.5, 7.3, 1.9, 4.8, 2], selos: ['vegano', 'integral'], validadeDias: 365 },
  { nome: 'Arroz branco tipo 1', categoria: GRAO, composicao: 'Arroz branco polido tipo 1, cru.', taco: [358, 78.8, 7.2, 0.3, 1.6, 1], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Feijão preto', categoria: GRAO, composicao: 'Feijão preto cru.', taco: [324, 58.8, 21.3, 1.2, 21.8, 1], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Feijão carioca', categoria: GRAO, composicao: 'Feijão carioca cru.', taco: [329, 61.2, 20.0, 1.3, 18.4, 0], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Feijão fradinho', categoria: GRAO, composicao: 'Feijão fradinho cru.', taco: [339, 61.2, 20.2, 2.4, 23.6, 10], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Lentilha', categoria: GRAO, composicao: 'Lentilha crua.', taco: [339, 62.0, 23.2, 0.8, 16.9, 0], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Grão-de-bico', categoria: GRAO, composicao: 'Grão-de-bico cru.', taco: [355, 57.9, 21.2, 5.4, 12.4, 5], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Aveia em flocos', categoria: GRAO, composicao: 'Aveia em flocos.', alergenicos: 'Alérgicos: contém aveia. Contém glúten.', taco: [394, 66.6, 13.9, 8.5, 9.1, 5], selos: ['vegano', 'integral'], validadeDias: 240 },
  { nome: 'Farinha de trigo', categoria: FARINHA, composicao: 'Farinha de trigo.', alergenicos: 'Alérgicos: contém trigo. Contém glúten.', taco: [360, 75.1, 9.8, 1.4, 2.3, 1], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Farinha de mandioca', categoria: FARINHA, composicao: 'Farinha de mandioca crua.', taco: [361, 87.9, 1.6, 0.3, 6.4, 1], selos: ['vegano'], validadeDias: 240 },
  { nome: 'Fubá de milho', categoria: FARINHA, composicao: 'Fubá de milho.', taco: [353, 78.9, 7.2, 1.9, 4.7, 0], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Polvilho doce', categoria: FARINHA, composicao: 'Fécula de mandioca.', taco: [351, 86.8, 0.4, 0.0, 0.2, 2], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Amido de milho', categoria: FARINHA, composicao: 'Amido de milho.', taco: [361, 87.1, 0.6, 0.0, 0.7, 8], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Farinha de soja', categoria: FARINHA, composicao: 'Farinha de soja.', alergenicos: 'Alérgicos: contém soja.', taco: [404, 38.4, 36.0, 14.6, 20.2, 1], selos: ['vegano'], validadeDias: 180 },
  { nome: 'Açúcar mascavo', categoria: ACUCAR, composicao: 'Açúcar mascavo.', taco: [369, 94.5, 0.8, 0.1, 0.0, 25], selos: ['vegano'], validadeDias: 365 },
  { nome: 'Uva-passa', categoria: FRUTA, composicao: 'Uva desidratada.', selos: ['vegano'], validadeDias: 180 },
  { nome: 'Damasco seco', categoria: FRUTA, composicao: 'Damasco desidratado.', selos: ['vegano'], validadeDias: 180 },
  { nome: 'Tâmara', categoria: FRUTA, composicao: 'Tâmara desidratada.', selos: ['vegano'], validadeDias: 180 },
  { nome: 'Chá de camomila', categoria: CHA, composicao: 'Flores secas de camomila.', selos: ['vegano'], validadeDias: 365 },
  { nome: 'Chá de hibisco', categoria: CHA, composicao: 'Flores secas de hibisco.', selos: ['vegano'], validadeDias: 365 },
  { nome: 'Erva-doce', categoria: CHA, composicao: 'Sementes de erva-doce.', selos: ['vegano'], validadeDias: 365 },
  { nome: 'Cúrcuma em pó', categoria: TEMPERO, composicao: 'Raiz de cúrcuma moída.', selos: ['vegano'], validadeDias: 365 },
  { nome: 'Orégano', categoria: TEMPERO, composicao: 'Folhas secas de orégano.', selos: ['vegano'], validadeDias: 365 },
  { nome: 'Canela em pau', categoria: TEMPERO, composicao: 'Casca seca de canela.', selos: ['vegano'], validadeDias: 365 },
];

const LOJAS = [
  { codigo: 'EX01', nome: 'Loja de exemplo 1', cidade: 'Belo Horizonte' },
  { codigo: 'EX02', nome: 'Loja de exemplo 2', cidade: 'Belo Horizonte' },
  { codigo: 'EX03', nome: 'Loja de exemplo 3', cidade: 'Juiz de Fora' },
] as const;

interface UsuarioDeTeste {
  chave: 'rede' | 'cd' | 'gerente' | 'operador';
  nome: string;
  papel: RoleKey;
  /** Índice em LOJAS; sem ele o usuário não fica limitado a loja nenhuma. */
  loja?: number;
}

const USUARIOS: UsuarioDeTeste[] = [
  { chave: 'rede', nome: 'Rede (teste do totem)', papel: 'totem_rede' },
  { chave: 'cd', nome: 'Centro de distribuição (teste do totem)', papel: 'totem_cd' },
  { chave: 'gerente', nome: 'Gerente da loja 1 (teste do totem)', papel: 'totem_gerente', loja: 0 },
  { chave: 'operador', nome: 'Operador da loja 1 (teste do totem)', papel: 'totem_operador', loja: 0 },
];

/*
 * `.invalid` é domínio reservado (RFC 2606): nenhuma mensagem sai para esses
 * endereços, e o e-mail é único no banco inteiro, então o slug entra nele.
 */
const emailDe = (chave: UsuarioDeTeste['chave'], slug: string) => `totem.${chave}@${slug}.exemplo.invalid`;

const codigoDoProduto = (i: number) => `EX${String(i + 1).padStart(3, '0')}`;

/** Meia-noite UTC de hoje mais `dias`, como `totemSituacaoDaValidade` compara. */
function dia(dias: number): Date {
  const hoje = new Date();
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + dias));
}

/*
 * A validade do lote A espalhada de três em três produtos, para o painel e o
 * totem terem os três casos: vencido, a 15 dias ou menos de vencer, e folgado.
 */
function validadeDoLoteA(i: number): Date {
  const caso = i % 3;
  if (caso === 0) return dia(-5);
  if (caso === 1) return dia(10);
  return dia(120);
}

function dentroDoRepositorio(arquivo: string): boolean {
  const relativo = path.relative(RAIZ_DO_REPOSITORIO, path.resolve(arquivo));
  return relativo === '' || (!relativo.startsWith('..') && !path.isAbsolute(relativo));
}

const dataBr = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function parar(mensagem: string): never {
  console.error(`\n${mensagem}\n`);
  process.exit(1);
}

async function main() {
  const slug = process.env.TOTEM_ORG_SLUG?.trim();
  if (!slug) parar('Defina TOTEM_ORG_SLUG com o slug da empresa que recebe a semente do totem.');

  // --- Conferências, todas antes da primeira escrita ---

  const org = await prisma.org.findUnique({ where: { slug } });
  if (!org) {
    parar(
      `A empresa "${slug}" não existe. Provisione antes:\n` +
        `  pnpm --filter @mktos/api provisionar ${slug} --nome "<nome>" --modulos totem`,
    );
  }
  if (!org.isActive) parar(`A empresa "${slug}" está desativada. Religue pelo provisionamento antes de semear.`);
  const orgId = org.id;

  const papeis = await prisma.role.findMany({
    where: { orgId, key: { in: USUARIOS.map((u) => u.papel) } },
    select: { id: true, key: true },
  });
  const papelPorChave = new Map(papeis.map((p) => [p.key, p.id]));
  const papeisFaltando = USUARIOS.map((u) => u.papel).filter((k) => !papelPorChave.has(k));
  if (papeisFaltando.length) {
    parar(
      `A empresa "${slug}" não tem os papéis ${papeisFaltando.join(', ')}. Rode antes:\n` +
        '  pnpm --filter @mktos/shared build && pnpm --filter @mktos/api db:sync-permissions',
    );
  }

  const usuariosExistentes = await prisma.user.findMany({
    where: { email: { in: USUARIOS.map((u) => emailDe(u.chave, slug)) } },
    select: { id: true, email: true, orgId: true },
  });
  const emOutraEmpresa = usuariosExistentes.filter((u) => u.orgId !== orgId);
  if (emOutraEmpresa.length) {
    parar(`Estes e-mails já pertencem a outra empresa: ${emOutraEmpresa.map((u) => u.email).join(', ')}.`);
  }
  const existentePorEmail = new Map(usuariosExistentes.map((u) => [u.email, u.id]));
  const aCriar = USUARIOS.filter((u) => !existentePorEmail.has(emailDe(u.chave, slug)));

  const saida = process.env.TOTEM_SEED_SAIDA?.trim();
  if (aCriar.length && !saida) {
    parar(
      `Faltam ${aCriar.length} usuário(s) de teste e TOTEM_SEED_SAIDA não foi definida. Ela é o arquivo ` +
        'onde as senhas geradas ficam, já que nenhuma senha vai para a tela.',
    );
  }
  if (aCriar.length && saida && dentroDoRepositorio(saida)) {
    parar('TOTEM_SEED_SAIDA aponta para dentro do repositório. Use um caminho fora dele, para a senha não ir parar num commit.');
  }

  // --- Módulo e configuração ---

  const moduloLigado = !org.modulos.includes('totem');
  if (moduloLigado) {
    await prisma.org.update({ where: { id: orgId }, data: { modulos: { push: 'totem' } } });
  }

  const configExistia = await prisma.totemConfig.findUnique({ where: { orgId }, select: { id: true } });
  if (!configExistia) {
    await prisma.totemConfig.create({
      data: {
        orgId,
        nomeExibicao: 'Senhor aGranel',
        // Verde-mata e creme amostrados do selo e dos posts (design system provisório de 10/10/2026).
        corPrimaria: '#28371D',
        corFundo: '#F5F3EC',
        // O cadastro nasce fechado: o controlador ainda é "a confirmar" e o texto da política está em revisão.
        cadastroLigado: false,
        controladorNome: 'Sr. aGranel (razão social a confirmar)',
        politicaVersao: TOTEM_POLITICA_VERSAO,
        mensagemBoasVindas: 'Procure um produto pelo nome e veja a ficha, o lote e a validade.',
      },
    });
  }

  // --- Lojas ---

  const lojaIds: string[] = [];
  let lojasCriadas = 0;
  for (const l of LOJAS) {
    const existente = await prisma.totemLoja.findUnique({ where: { orgId_codigo: { orgId, codigo: l.codigo } } });
    if (existente) {
      lojaIds.push(existente.id);
      continue;
    }
    const criada = await prisma.totemLoja.create({ data: { orgId, ...l, exemplo: true } });
    lojaIds.push(criada.id);
    lojasCriadas++;
  }

  // --- Usuários de teste ---

  let arquivoGravado = false;
  if (aCriar.length && saida) {
    const novos = await Promise.all(
      aCriar.map(async (u) => {
        const senha = randomBytes(18).toString('base64url');
        return { ...u, email: emailDe(u.chave, slug), senha, hash: await bcrypt.hash(senha, 10) };
      }),
    );

    // O arquivo vem antes do banco: usuário criado sem a senha anotada ficaria inacessível.
    const agora = new Date();
    const linhas = [
      `# Logins de teste do totem, empresa ${slug}, gerados em ${dataBr(agora)} por db:seed:totem.`,
      '# Arquivo pessoal: não versione, não compartilhe. Formato: e-mail, senha, papel.',
      ...novos.map((u) => `${u.email}\t${u.senha}\t${u.papel}`),
      '',
    ];
    writeFileSync(saida, linhas.join('\n'), { flag: 'a', mode: 0o600 });
    chmodSync(saida, 0o600);
    arquivoGravado = true;

    await prisma.$transaction(
      novos.map((u) =>
        prisma.user.create({
          data: {
            orgId,
            name: u.nome,
            email: u.email,
            passwordHash: u.hash,
            roles: { connect: { id: papelPorChave.get(u.papel)! } },
          },
        }),
      ),
    );
  }

  const usuarios = await prisma.user.findMany({
    where: { orgId, email: { in: USUARIOS.map((u) => emailDe(u.chave, slug)) } },
    select: { id: true, email: true },
  });
  const usuarioPorChave = new Map(
    USUARIOS.map((u) => [u.chave, usuarios.find((x) => x.email === emailDe(u.chave, slug))!.id]),
  );

  let vinculosCriados = 0;
  for (const u of USUARIOS) {
    if (u.loja === undefined) continue;
    const chave = { orgId, userId: usuarioPorChave.get(u.chave)!, lojaId: lojaIds[u.loja] };
    const existente = await prisma.totemUsuarioLoja.findUnique({ where: { orgId_userId_lojaId: chave } });
    if (!existente) {
      await prisma.totemUsuarioLoja.create({ data: chave });
      vinculosCriados++;
    }
  }

  // --- Produtos e lotes ---

  const produtoIds: string[] = [];
  let produtosCriados = 0;
  for (const [i, p] of PRODUTOS.entries()) {
    const codigo = codigoDoProduto(i);
    const existente = await prisma.totemProduto.findUnique({ where: { orgId_codigo: { orgId, codigo } } });
    if (existente) {
      produtoIds.push(existente.id);
      continue;
    }
    const criado = await prisma.totemProduto.create({
      data: {
        orgId,
        codigo,
        nome: p.nome,
        nomeBusca: normalizarBusca(p.nome),
        categoria: p.categoria,
        composicao: p.composicao,
        alergenicos: p.alergenicos ?? null,
        porcaoG: p.taco ? 100 : null,
        porcaoDescricao: p.taco ? '100 g' : null,
        nutricional: p.taco ? fichaDaTaco(p.taco) : [],
        fonteNutricional: p.taco ? FONTE_TACO : FONTE_ROTULO,
        selos: p.selos,
        validadeDiasPadrao: p.validadeDias,
        exemplo: true,
      },
    });
    produtoIds.push(criado.id);
    produtosCriados++;
  }

  let lotesCriados = 0;
  async function lote(i: number, sufixo: string, dados: { fabricadoEm: Date | null; validadeEm: Date; origem?: string; lojaOrigemId?: string; observacao?: string }) {
    const chave = { orgId, produtoId: produtoIds[i], codigo: `${codigoDoProduto(i)}-${sufixo}` };
    const existente = await prisma.totemLote.findUnique({ where: { orgId_produtoId_codigo: chave } });
    if (existente) return existente.id;
    const criado = await prisma.totemLote.create({
      data: { ...chave, ...dados, criadoPor: usuarioPorChave.get('cd') },
    });
    lotesCriados++;
    return criado.id;
  }

  const loteA: string[] = [];
  const loteB: string[] = [];
  for (const [i, p] of PRODUTOS.entries()) {
    loteA.push(await lote(i, 'A', { fabricadoEm: dia(-60), validadeEm: validadeDoLoteA(i) }));
    loteB.push(await lote(i, 'B', { fabricadoEm: dia(-5), validadeEm: dia(p.validadeDias - 5) }));
  }

  // --- Remessas e reposições ---
  /*
   * Os casos da regra do lote vigente (CONTRATO.md, seção 4), na loja 1:
   * produtos 1 a 10 com reposição confirmada; 11 a 20 só com a remessa
   * recebida; 21 em diante só com a remessa enviada (lote presumido). A loja 2
   * recebe os produtos de número ímpar e tem um lote manual; a loja 3 fica sem
   * remessa nenhuma, e todo produto dela é pendência.
   */
  const indices = PRODUTOS.map((_, i) => i);
  let remessasCriadas = 0;
  async function remessa(args: {
    observacao: string;
    loja: number;
    itens: number[];
    lotes: string[];
    enviadaEm: Date;
    recebidaEm?: Date;
  }) {
    const lojaId = lojaIds[args.loja];
    const existente = await prisma.totemRemessa.findFirst({ where: { orgId, lojaId, observacao: args.observacao } });
    if (existente) return;
    await prisma.totemRemessa.create({
      data: {
        orgId,
        lojaId,
        status: args.recebidaEm ? 'recebida' : 'enviada',
        enviadaEm: args.enviadaEm,
        recebidaEm: args.recebidaEm ?? null,
        recebidaPor: args.recebidaEm ? usuarioPorChave.get('gerente') : null,
        observacao: args.observacao,
        criadoPor: usuarioPorChave.get('cd'),
        itens: {
          create: args.itens.map((i) => ({
            orgId,
            loteId: args.lotes[i],
            produtoId: produtoIds[i],
            quantidade: 5,
            unidade: 'kg',
          })),
        },
      },
    });
    remessasCriadas++;
  }

  await remessa({
    observacao: 'Remessa de exemplo 1 (semente do totem)',
    loja: 0,
    itens: indices.filter((i) => i < 20),
    lotes: loteA,
    enviadaEm: dia(-20),
    recebidaEm: dia(-19),
  });
  await remessa({
    observacao: 'Remessa de exemplo 2 (semente do totem)',
    loja: 0,
    itens: indices.filter((i) => i >= 20),
    lotes: loteB,
    enviadaEm: dia(-2),
  });
  await remessa({
    observacao: 'Remessa de exemplo 3 (semente do totem)',
    loja: 1,
    itens: indices.filter((i) => i % 2 === 0),
    lotes: loteA,
    enviadaEm: dia(-10),
    recebidaEm: dia(-9),
  });

  let reposicoesCriadas = 0;
  async function reposicao(loja: number, i: number, loteId: string, origem: 'remessa' | 'manual', repostoEm: Date, por: string) {
    const lojaId = lojaIds[loja];
    const produtoId = produtoIds[i];
    const existente = await prisma.totemReposicao.findFirst({ where: { orgId, lojaId, produtoId, loteId, origem } });
    if (existente) return;
    await prisma.totemReposicao.create({ data: { orgId, lojaId, produtoId, loteId, origem, repostoEm, registradoPor: por } });
    reposicoesCriadas++;
  }

  for (const i of indices.filter((i) => i < 10)) {
    await reposicao(0, i, loteA[i], 'remessa', dia(-18), usuarioPorChave.get('operador')!);
  }
  const loteManual = await lote(1, 'M', {
    fabricadoEm: null,
    validadeEm: dia(60),
    origem: 'manual_loja',
    lojaOrigemId: lojaIds[1],
    observacao: 'Lote registrado na loja, fora da remessa (exemplo).',
  });
  await reposicao(1, 1, loteManual, 'manual', dia(-1), usuarioPorChave.get('rede')!);

  // --- Campanha ---

  const NOME_CAMPANHA = 'Boas-vindas (exemplo)';
  let campanhaCriada = false;
  if (!(await prisma.totemCampanha.findFirst({ where: { orgId, nome: NOME_CAMPANHA }, select: { id: true } }))) {
    await prisma.totemCampanha.create({
      data: {
        orgId,
        nome: NOME_CAMPANHA,
        chamada: 'Cadastre-se e ganhe um brinde na próxima compra.',
        tipoBeneficio: 'brinde',
        descricaoBeneficio: 'Um brinde de boas-vindas na próxima compra. A loja define qual.',
        validadeDias: 30,
        inicioEm: dia(0),
        ativa: true,
      },
    });
    campanhaCriada = true;
  }

  // --- Relatório (sem senha) ---

  const n = (criados: number, total: number) => `${total} (${criados} criado(s) nesta rodada)`;
  console.log(`\nSemente do totem na empresa "${slug}"`);
  console.log(`  módulo totem ... ${moduloLigado ? 'ligado agora' : 'já estava ligado'}`);
  console.log(`  configuração ... ${configExistia ? 'já existia, mantida como está' : 'criada, com o cadastro fechado'}`);
  console.log(`  lojas .......... ${n(lojasCriadas, LOJAS.length)}`);
  console.log(`  produtos ....... ${n(produtosCriados, PRODUTOS.length)}`);
  console.log(`  lotes .......... ${lotesCriados} criado(s) nesta rodada`);
  console.log(`  remessas ....... ${n(remessasCriadas, 3)}`);
  console.log(`  reposições ..... ${reposicoesCriadas} criada(s) nesta rodada`);
  console.log(`  vínculos ....... ${vinculosCriados} criado(s) nesta rodada`);
  console.log(`  campanha ....... ${campanhaCriada ? 'criada' : 'já existia'}`);
  for (const u of USUARIOS) {
    const email = emailDe(u.chave, slug);
    const novo = aCriar.some((a) => a.chave === u.chave);
    console.log(`  usuário ........ ${email} (${u.papel}) ${novo ? 'criado' : 'já existia, senha mantida'}`);
  }
  if (arquivoGravado) console.log(`\nAs senhas dos usuários criados estão em ${saida} (chmod 600).`);
  console.log(lojasCriadas + produtosCriados + lotesCriados + remessasCriadas + reposicoesCriadas + vinculosCriados + aCriar.length > 0 || moduloLigado || !configExistia || campanhaCriada
    ? '\nALGO MUDOU nesta rodada.\n'
    : '\nNada mudou: o estado já era este.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
