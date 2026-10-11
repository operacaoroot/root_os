#!/usr/bin/env node
/*
 * Sobe o artefato COMPILADO e confere que a aplicação inicia.
 *
 * Existe porque em 29/08/2026 a produção caiu por dois minutos com
 * `tsc --noEmit` limpo e 130 testes verdes: o AgentsModule injetava serviços
 * que os módulos donos não exportavam. TypeScript não enxerga o grafo de
 * injeção do Nest.
 *
 * E não dá para cobrir isso com vitest: o esbuild não emite
 * `emitDecoratorMetadata`, então o Nest não resolve NADA por tipo lá dentro —
 * o teste passaria verde por outro motivo, que é pior que não existir.
 *
 * Então o teste é o boot de verdade, do dist de verdade. Se o Nest não subir,
 * isto falha aqui em vez de falhar no deploy.
 *
 *   DATABASE_URL=<banco de teste> pnpm --filter @mktos/api smoke
 *
 * ----------------------------------------------------------------------------
 * DUAS PERGUNTAS, E A SEGUNDA NASCEU NA ONDA 9
 * ----------------------------------------------------------------------------
 *  1. A APLICAÇÃO SOBE? — o sinal do Nest no stdout.
 *  2. AS ROTAS QUE DEVIAM EXISTIR EXISTEM? — um pedido HTTP por família. Módulo
 *     que cai do grafo não derruba nada: compila, sobe, e a tela recebe 404. Foi
 *     o risco medido da memória, que entrou pendurada no conector da vault antes
 *     de virar módulo do `AppModule`. `SMOKE_ROTAS` lista o que tem de responder.
 *
 * O que se espera de cada rota é "qualquer coisa MENOS 404". 401 é o resultado
 * normal e é prova suficiente: para o guarda de autenticação recusar, o roteador
 * já teve de casar a rota. Pedir com token seria testar o login, não o grafo.
 *
 * ----------------------------------------------------------------------------
 * `SMOKE_ESPERA_QUEBRA`: a trava também tem de FECHAR
 * ----------------------------------------------------------------------------
 * Sete montagens derrubam o arranque de propósito (a porta sem provedor de teto,
 * três registros sem inscrição ou com inscrição dobrada, e — desde a fatia 5.1 —
 * o módulo de rotinas ausente). Trava que ninguém exercita é trava que um dia
 * some num rebase sem ninguém notar. Com esta variável o sucesso é o contrário:
 * a aplicação PRECISA morrer, e a mensagem precisa casar com o texto pedido.
 *
 *   SMOKE_ESPERA_QUEBRA='AGENDADOR DE ROTINAS NÃO ESTÁ DE PÉ' node scripts/smoke-boot.mjs
 *
 * Como se monta o dist quebrado sem sujar o worktree: copie `src/` para uma
 * pasta fora dele, tire a linha do módulo, compile lá e rode este script com
 * `SMOKE_ENTRY` apontando para aquele `dist/main.js`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const ENTRY = process.env.SMOKE_ENTRY ?? 'dist/main.js';
const LIMITE_MS = 45_000;
const SINAL = 'Nest application successfully started';
const PORTA = process.env.SMOKE_PORT ?? '4099';
const ESPERA_QUEBRA = process.env.SMOKE_ESPERA_QUEBRA ?? '';

/*
 * As rotas conferidas por padrão, uma por família que já caiu ou quase caiu do
 * grafo. Todas são GET sem parâmetro e todas exigem autenticação — nenhuma
 * executa nada. `SMOKE_ROTAS` substitui a lista (separada por vírgula).
 */
const ROTAS = (
  process.env.SMOKE_ROTAS ??
  // `linha-do-tempo` entrou na fatia A9 e `caixa` na A7. As duas são o caso
  // puro do que este trecho existe para pegar: módulo de leitura, sem sentinela
  // de arranque, que se cai dos `imports` do `AppModule` compila, sobe e devolve
  // 404 na tela — sem nada acusar, porque nenhum outro componente o espera. Na
  // caixa o silêncio é ainda mais fácil de não notar: o selo da barra lateral
  // simplesmente não aparece, e barra sem selo é indistinguível de caixa vazia.
  //
  // As seis do módulo Totem (11/10/2026) são uma por prefixo. As três últimas
  // são públicas e não exigem sessão: sem credencial respondem 401 ou 400, o
  // que basta para provar que o controller está no grafo.
  '/api/memoria,/api/rotinas,/api/organograma,/api/linha-do-tempo,/api/caixa,' +
    '/api/totem-gestao/resumo,/api/totem-lotes/pendencias,/api/totem-campanhas,' +
    '/api/totem-publico/catalogo,/api/totem-etiqueta/x,/api/totem-cadastro/politica'
)
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

if (!existsSync(ENTRY)) {
  console.error(`${ENTRY} não existe — rode o build antes.`);
  process.exit(1);
}

const filho = spawn(process.execPath, [ENTRY], {
  env: { ...process.env, API_PORT: PORTA },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let decidido = false;
let saida = '';

const encerrar = (codigo, mensagem) => {
  if (decidido) return;
  decidido = true;
  clearTimeout(prazo);
  filho.kill('SIGTERM');
  setTimeout(() => filho.kill('SIGKILL'), 3000).unref();
  console.log(mensagem);
  process.exit(codigo);
};

/**
 * As rotas respondem? Só depois do sinal de "subiu" — antes disso o servidor
 * HTTP pode nem estar escutando.
 */
async function conferirRotas() {
  const faltando = [];
  for (const rota of ROTAS) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}${rota}`);
      if (r.status === 404) faltando.push(`${rota} → 404`);
      else console.log(`  ${rota} → ${r.status} (registrada)`);
    } catch (e) {
      faltando.push(`${rota} → não respondeu (${e.message})`);
    }
  }
  if (faltando.length) {
    encerrar(
      1,
      '\nSMOKE FALHOU — rota que devia existir não existe no injetor:\n  ' +
        faltando.join('\n  ') +
        '\n  404 aqui quer dizer módulo fora do `imports` do AppModule: compila, sobe, e a tela\n' +
        '  recebe 404 sem nada acusar.',
    );
    return;
  }
  encerrar(0, '\nSMOKE OK — a aplicação subiu e as rotas conferidas respondem.');
}

const olhar = (chunk) => {
  const texto = String(chunk);
  saida += texto;
  process.stdout.write(texto);

  if (ESPERA_QUEBRA) {
    // Aqui subir é o defeito: a trava tinha de ter fechado.
    if (texto.includes(SINAL)) {
      encerrar(1, `\nSMOKE FALHOU — a aplicação SUBIU, e a trava "${ESPERA_QUEBRA}" devia derrubá-la.`);
    }
    return;
  }

  if (texto.includes(SINAL)) {
    void conferirRotas();
  }
  // O Nest imprime o erro de injeção e SÓ DEPOIS morre. Pegar na hora dá
  // mensagem melhor do que esperar o exit.
  if (/Nest can't resolve dependencies|ExceptionHandler/.test(texto)) {
    encerrar(1, '\nSMOKE FALHOU — o grafo de injeção não resolve. É o que derruba o deploy.');
  }
};

filho.stdout.on('data', olhar);
filho.stderr.on('data', olhar);

filho.on('exit', (codigo) => {
  if (decidido) return;
  if (ESPERA_QUEBRA) {
    if (saida.includes(ESPERA_QUEBRA)) {
      encerrar(0, `\nSMOKE OK — a trava fechou, com o texto esperado ("${ESPERA_QUEBRA}").`);
      return;
    }
    encerrar(
      1,
      `\nSMOKE FALHOU — a aplicação morreu (código ${codigo}), mas sem a mensagem ` +
        `"${ESPERA_QUEBRA}". Pode ser outra coisa quebrando, e aí a trava não foi exercitada.`,
    );
    return;
  }
  encerrar(1, `\nSMOKE FALHOU — o processo morreu com código ${codigo} antes de subir.`);
});

const prazo = setTimeout(() => {
  if (ESPERA_QUEBRA) {
    encerrar(1, `\nSMOKE FALHOU — ${LIMITE_MS / 1000}s e a trava "${ESPERA_QUEBRA}" não fechou.`);
    return;
  }
  encerrar(1, `\nSMOKE FALHOU — ${LIMITE_MS / 1000}s sem "${SINAL}".`);
}, LIMITE_MS);
