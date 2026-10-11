/*
 * Criar (ou conferir) uma empresa pela linha de comando — RF-T-07.
 *
 * Rodar duas vezes com o mesmo slug é seguro e é o ponto: a segunda rodada não
 * escreve nada e imprime "nada mudou".
 *
 *   node dist/scripts/provisionar-tenant.js <slug>
 *   node dist/scripts/provisionar-tenant.js acme --nome "Acme" --modulos leads,financeiro
 *   node dist/scripts/provisionar-tenant.js acme-homolog --modulos todos
 *   node dist/scripts/provisionar-tenant.js acme --admin maria@acme.com --admin-nome "Maria"
 *   node dist/scripts/provisionar-tenant.js acme --modulos leads --reconfigurar
 *   node dist/scripts/provisionar-tenant.js acme --json
 *
 * ESTE COMANDO PODE RECONFIGURAR EMPRESA QUE JÁ EXISTE — A ROTA NÃO PODE.
 * Sem `--reconfigurar`, ele roda no mesmo modo da rota (`criar`): empresa que já
 * existe volta como retrato e nada do que foi informado é aplicado. Com
 * `--reconfigurar`, a configuração informada vale também em empresa que já
 * existe. A diferença de licença não é capricho: aqui exige-se um operador
 * logado no servidor, com acesso ao banco, que é uma autorização que a rota HTTP
 * não tem como pedir hoje (não existe permissão de PLATAFORMA no catálogo — ver
 * `tenants/provisionar.controller.ts`). Mesmo assim vale a regra do
 * 05-SEGURANCA-OWASP: mexer em empresa cliente é acesso de suporte, e acesso de
 * suporte se combina com o cliente antes. O RASTRO e a auditoria guardam quem
 * fez o quê.
 *
 * Roda COMPILADO: `tsx` não emite metadata de decorator e o Nest não injeta
 * nada. O caminho é o mesmo da rota administrativa — a operação é uma só.
 *
 * O que ele NÃO faz: senha. O administrador criado entra pelo login com a conta
 * Google (senha inutilizável, como em `auth/google-login.service.ts`), então
 * nenhum segredo é gerado, impresso ou guardado aqui.
 */
import { NestFactory } from '@nestjs/core';
import { MODULOS } from '@mktos/shared';
import { AppModule } from '../app.module';
import { ProvisionamentoService } from '../tenants/provisionar.service';

/** Bandeiras que consomem o argumento seguinte — o resto é posicional. */
const COM_VALOR = ['--nome', '--modulos', '--admin', '--admin-nome'];

/**
 * O slug. Percorrer pulando bandeira E o valor dela é o que impede
 * `--nome acme` de ser lido como se `acme` fosse o slug.
 */
function slugDe(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (COM_VALOR.includes(a)) {
      i++;
      continue;
    }
    if (a.startsWith('--')) continue;
    return a;
  }
  return undefined;
}

function valorDe(args: string[], bandeira: string): string | undefined {
  const i = args.indexOf(bandeira);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`${bandeira} precisa de um valor`);
  }
  return v;
}

/**
 * `--modulos` ausente é diferente de `--modulos ""`.
 *
 * Ausente = não decide nada (empresa nova nasce só com a espinha; empresa que
 * existe fica como está). Vazio = intenção declarada de não ter módulo nenhum, e
 * numa empresa que já existe isso DESLIGA o que estava ligado — só com
 * `--reconfigurar`. `todos` é atalho para o catálogo inteiro: o caso do tenant
 * de homologação, que espelha a ROOT.
 */
function modulosDe(args: string[]): string[] | undefined {
  const bruto = valorDe(args, '--modulos');
  if (bruto === undefined) return undefined;
  if (bruto.trim() === 'todos') return [...MODULOS];
  return bruto
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m !== '');
}

async function main() {
  const args = process.argv.slice(2);
  const slug = slugDe(args);
  const json = args.includes('--json');
  const reconfigurar = args.includes('--reconfigurar');
  const reativar = args.includes('--reativar');

  if (!slug) {
    console.error(
      '\nuso: node dist/scripts/provisionar-tenant.js <slug> [--nome "Nome"] ' +
        '[--modulos a,b,c|todos] [--admin email] [--admin-nome "Nome"] ' +
        '[--reconfigurar] [--reativar] [--json]\n\n' +
        `módulos: ${MODULOS.join(', ')}\n\n` +
        '--reconfigurar  aplica a configuração informada também em empresa que JÁ EXISTE\n' +
        '                (sem ele, empresa que existe só é conferida — o mesmo que a rota faz)\n' +
        '--reativar      religa empresa desativada. Exige --reconfigurar.\n',
    );
    process.exit(2);
  }

  if (reativar && !reconfigurar) {
    console.error('\n--reativar exige --reconfigurar: religar empresa é reconfigurar.\n');
    process.exit(2);
  }

  const email = valorDe(args, '--admin');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const provisionamento = app.get(ProvisionamentoService);
    const r = await provisionamento.provisionar(
      {
        slug,
        nome: valorDe(args, '--nome'),
        modulos: modulosDe(args),
        modo: reconfigurar ? 'reconfigurar' : 'criar',
        reativar,
        ...(email ? { admin: { email, nome: valorDe(args, '--admin-nome') } } : {}),
      },
      { tipo: 'system', id: process.env.USER ?? 'terminal', origem: 'script' },
    );

    if (json) {
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    console.log(`\nempresa "${r.slug}" — ${r.criada ? 'CRIADA agora' : 'já existia'}`);
    console.log(`  id ............. ${r.orgId}`);
    console.log(`  nome ........... ${r.nome}`);
    // A situação vem antes dos módulos de propósito: empresa desligada não pode
    // passar despercebida entre duas linhas de configuração.
    console.log(`  situação ....... ${r.ativa ? 'ativa' : '*** DESATIVADA ***'}`);
    console.log(`  modo ........... ${r.modo}`);
    console.log(
      `  módulos ........ ${r.modulos.join(', ') || '(nenhum — só a espinha do OS)'}` +
        // Em empresa nova toda a lista é "nova": o aviso só informa quando ele
        // significa MUDANÇA no que já estava valendo.
        (r.modulosAlterados && !r.criada ? '  [alterados nesta rodada]' : ''),
    );
    console.log(
      `  papel inicial .. ${r.papelInicial.key}${r.papelInicial.criado ? ' (criado)' : ' (já existia)'}` +
        ` — ${r.papelInicial.permissoes}/${r.papelInicial.esperadas} permissões,` +
        ` ${r.papelInicial.usuarios} pessoa(s)`,
    );
    console.log(
      `  papéis ......... ${r.papeis.criados.length} criado(s), ${r.papeis.jaExistiam.length} já existia(m),` +
        ` ${r.papeis.total} no total` +
        (r.papeis.foraDoCatalogo.length
          ? ` — fora do catálogo: ${r.papeis.foraDoCatalogo.join(', ')}`
          : ''),
    );
    console.log(
      `  permissões ..... ${r.permissoes.criadas} nova(s) de ${r.permissoes.catalogo} no catálogo`,
    );
    if (r.admin) {
      console.log(
        `  admin .......... ${r.admin.email}${r.admin.criado ? ' (criado, entra pelo login com Google)' : ' (já existia)'}` +
          (r.admin.papelVinculado ? ' [papel inicial vinculado]' : ''),
      );
    }
    console.log(
      `  política ....... herda a base da ROOT` +
        (r.politica.heranca === 'base-root'
          ? ` (v${r.politica.versaoBase})`
          : ' — ATENÇÃO: não há versão base no banco, vale a empacotada no build; rode db:seed:politica'),
    );
    if (r.politica.sobrescritaPropria !== null) {
      console.log(`                   sobrescrita própria em vigor: v${r.politica.sobrescritaPropria}`);
    }
    console.log(
      '  contexto ....... não conferido: leitura do tenant não identificada',
    );
    console.log(
      `  rastro ......... intenção ${r.rastro.intencao ? `#${r.rastro.intencao}` : '—'} · ` +
        `nascimento ${r.rastro.conclusao ? `#${r.rastro.conclusao}` : '—'}`,
    );
    if (r.ignorado.length) {
      console.log(`  IGNORADO ....... ${r.ignorado.join(', ')}  (use --reconfigurar para aplicar)`);
    }

    if (r.avisos.length) {
      console.log(`\n${r.avisos.length} AVISO(S):`);
      for (const a of r.avisos) console.log(`  · [${a.codigo}] ${a.texto}`);
    }

    /*
     * A última linha é a que a pessoa lê. Ela não pode dizer "nada mudou" e ponto
     * sobre uma empresa desligada ou com o papel inicial vazio: foi exatamente
     * assim que um relatório verde escondeu uma empresa sem dono.
     */
    const conclusao = r.mudou ? 'ALGO MUDOU nesta rodada.' : 'Nada mudou — o estado já era este.';
    console.log(`\n${conclusao}${r.avisos.length ? ` MAS VEJA OS ${r.avisos.length} AVISO(S) ACIMA.` : ''}\n`);
  } finally {
    await app.close();
  }
}

/**
 * Sai de verdade quando termina.
 *
 * `app.close()` NÃO devolve o processo ao terminal: meia dúzia de serviços do
 * `AppModule` registram `setInterval` no boot (sincronismo do bio, do ClickUp,
 * do financeiro, do Obsidian, o tique da pauta) e nenhum deles é `unref`ado ou
 * limpo no destroy. Num servidor isso é irrelevante; num comando de linha
 * significa um prompt que nunca volta — medido: sem esta saída explícita o
 * comando ficava vivo indefinidamente depois de imprimir o relatório.
 *
 * O `write('')` antes do `exit` não é enfeite: com a saída num cano
 * (`| tail`, `> arquivo`), o stdout do Node é assíncrono e `process.exit()`
 * corta o que ainda não foi escrito. O callback só volta depois da descarga.
 */
function sairCom(codigo: number): void {
  process.stdout.write('', () => process.exit(codigo));
}

main().then(
  () => sairCom(0),
  (e) => {
    console.error('\nfalhou:', (e as Error).message);
    sairCom(1);
  },
);
