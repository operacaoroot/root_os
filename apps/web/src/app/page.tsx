import type { Metadata } from 'next';

/*
 * ============================================================================
 * A ENTRADA PÚBLICA — o mapa da ROOT ao vivo — fatia 6.5 (degrau 0 da esteira)
 * ============================================================================
 *
 * Até aqui a raiz de `os.operacaoroot.com` servia `public/root-os.html`: um
 * protótipo estático, com números inventados. Esta página põe no lugar o mapa
 * REAL do tenant da ROOT — e só o pedaço dele que alguém marcou, registro por
 * registro, como público (ver `apps/api/src/public-map/`).
 *
 * O PROTÓTIPO CONTINUA DE PÉ, em `/root-os.html`, e há link para ele no rodapé.
 * Nada foi removido: ele mora em `public/` e é servido direto pelo Next. O que
 * mudou é quem responde por `/` — e isso acontece sozinho, porque reescrita de
 * `next.config.mjs` devolvida como ARRAY é `afterFiles`, isto é, só vale quando
 * não há rota de arquivo para o caminho. Com este `page.tsx` no lugar, a linha
 * `{ source: '/', destination: '/root-os.html' }` fica inerte. Ela pode ser
 * apagada, mas apagar não é necessário e `next.config.mjs` não é desta fatia.
 *
 * ----------------------------------------------------------------------------
 * NENHUMA BIBLIOTECA DE GRAFO, E NENHUM JAVASCRIPT
 * ----------------------------------------------------------------------------
 * O desenho é SVG calculado aqui, no servidor, por função pura. É a mesma
 * decisão do mapa interno (`src/app/contexto/`), pelo mesmo motivo: dependência
 * nova é decisão humana, e o que uma biblioteca de grafo traria de "útil" —
 * simulação de força, nó arrastável — é justamente o que uma tela de venda não
 * pode ter, porque o ponto mudaria de lugar a cada carregamento.
 *
 * E vai um passo além do mapa interno: aqui não há JavaScript NENHUM. Isso
 * resolve de antemão o defeito que a onda 10 mediu num navegador de verdade —
 * captura de ponteiro no elemento raiz manda o `pointerup` para a raiz, o
 * ancestral comum vira a raiz, e nenhum `onClick` de nó dispara, com a suíte
 * verde porque o ambiente de teste não implementa captura. Aqui não há arrasto,
 * não há captura e não há `onClick`: cada ponto é um `<a>` de SVG apontando para
 * a lista logo abaixo — âncora de verdade, que funciona no teclado, sem JS e sem
 * hidratação. Um botão morto não tem como existir nesta tela porque não há
 * botão.
 *
 * ----------------------------------------------------------------------------
 * A LISTA EMBAIXO DO MAPA NÃO É REDUNDÂNCIA
 * ----------------------------------------------------------------------------
 * É o mesmo conteúdo em texto: o que leitor de tela lê, o que o celular mostra
 * sem apertar os olhos e o destino das âncoras do desenho. Um mapa que só existe
 * como imagem é um mapa que metade das pessoas não recebe.
 *
 * NO CELULAR ELA É O MAPA INTEIRO: abaixo de 768px o desenho não aparece, porque
 * naquela largura ele encolhe a ponto de ficar ilegível e inclicável (a conta
 * está em `Desenho`). Por isso a lista não pode ser tratada como acessório —
 * tudo que o desenho mostra tem de estar nela.
 */

/** Server-to-server, por dentro da rede — igual ao RSC da bio (`lib/bio-api.ts`). */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4001';

/**
 * Sempre renderizada no pedido.
 *
 * O contrário (geração estática com revalidação) colocaria no ar, no build, uma
 * versão SEM mapa — a API não responde durante o build — e ela seria servida até
 * o primeiro pedido disparar a regeneração.
 *
 * A conta de banco disso é contida DENTRO da API: `MapaPublicoService` guarda o
 * mapa por 30s, e uma rajada de pedidos frios divide uma consulta só. Não é o
 * `Cache-Control` que contém — a rota pública responde `no-store` de propósito,
 * porque a resposta dela carrega o cabeçalho de correlação da requisição (ver
 * `mapa-publico.controller.ts`).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ROOT OS — o mapa da nossa operação, ao vivo',
  description:
    'Quantas pessoas usam a sua conta de IA hoje, e você consegue dizer o que cada uma fez nela? ' +
    'Este é o mapa da operação da ROOT, servido do banco do próprio sistema.',
};

/* ------------------------------------------------------------------ contrato */

/*
 * O CONTRATO DA ROTA PÚBLICA, escrito aqui.
 *
 * Cópia do que `apps/api/src/public-map/mapa-publico.ts` declara. Não é
 * importável: `@mktos/shared` não expõe nada da API, e criar essa dependência só
 * por três interfaces custaria mais que a cópia. O que amarra os dois lados é a
 * validação abaixo — resposta fora do formato vira "sem mapa", nunca uma tela
 * quebrada.
 */
type Tom = 'brand' | 'good' | 'warn' | 'bad' | 'info' | 'muted';

interface NoPublico {
  chave: string;
  rotulo: string;
  detalhe: string | null;
  tom: Tom;
  numero: number | null;
}

interface EixoPublico {
  chave: string;
  rotulo: string;
  itens: NoPublico[];
}

interface MapaPublico {
  geradoEm: string;
  nucleo: NoPublico | null;
  eixos: EixoPublico[];
}

const TONS: readonly Tom[] = ['brand', 'good', 'warn', 'bad', 'info', 'muted'];

function comoTexto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function comoTom(v: unknown): Tom {
  return typeof v === 'string' && (TONS as readonly string[]).includes(v) ? (v as Tom) : 'muted';
}

function comoNumero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function comoNo(bruto: unknown): NoPublico | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const b = bruto as Record<string, unknown>;
  const chave = comoTexto(b.chave);
  const rotulo = comoTexto(b.rotulo);
  if (!chave || !rotulo) return null;
  const detalhe = comoTexto(b.detalhe);
  return {
    chave,
    rotulo,
    detalhe: detalhe === '' ? null : detalhe,
    tom: comoTom(b.tom),
    numero: comoNumero(b.numero),
  };
}

/**
 * Aceita a resposta ou devolve `null`.
 *
 * A API é nossa, então isto não é desconfiança do outro lado: é o que impede que
 * uma mudança de contrato, uma resposta de proxy ou um HTML de erro derrubem a
 * PORTA DE ENTRADA do domínio. Sem mapa a página continua inteira — o texto de
 * venda não depende dele.
 */
function comoMapa(bruto: unknown): MapaPublico | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const b = bruto as Record<string, unknown>;
  if (!Array.isArray(b.eixos)) return null;

  const eixos: EixoPublico[] = [];
  for (const e of b.eixos) {
    if (!e || typeof e !== 'object') continue;
    const bloco = e as Record<string, unknown>;
    const chave = comoTexto(bloco.chave);
    if (!chave) continue;
    const itens = Array.isArray(bloco.itens)
      ? bloco.itens.map(comoNo).filter((n): n is NoPublico => n !== null)
      : [];
    eixos.push({ chave, rotulo: comoTexto(bloco.rotulo) || chave, itens });
  }

  return { geradoEm: comoTexto(b.geradoEm), nucleo: comoNo(b.nucleo), eixos };
}

async function buscarMapa(): Promise<MapaPublico | null> {
  try {
    const res = await fetch(`${API}/api/mapa-publico`, { cache: 'no-store' });
    if (!res.ok) return null;
    return comoMapa(await res.json());
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- desenho */

/*
 * A GEOMETRIA, inteira e determinística.
 *
 * Entra a lista de eixos, sai a posição de cada ponto. Nada de aleatório, nada
 * de relógio, nada de medida do navegador: a mesma resposta desenha o mesmo mapa
 * em qualquer máquina, hoje e no ano que vem. É o que permite apresentar esta
 * tela a alguém sem que ela mude no meio da frase.
 */
const LADO = 1000;
const CENTRO = LADO / 2;
const RAIO_DO_NUCLEO = 64;
const RAIO_DO_EIXO = 250;
/*
 * 20, e não 18, por causa da conta de escala do bloco `O DESENHO NÃO DESCE ATÉ O
 * CELULAR` (ver `Desenho`): na largura mais estreita em que o desenho aparece, o
 * ponto tem de fechar os 24px de alvo de toque da norma de acessibilidade.
 */
const RAIO_DO_NO = 20;
/** Distância do ponto até a cabeça do eixo dele. */
const BRACO = 132;
/** Abertura total do leque de pontos de um eixo, em graus. */
const ABERTURA = 74;

interface Ponto {
  x: number;
  y: number;
}

function emVolta(graus: number, raio: number, centro: Ponto = { x: CENTRO, y: CENTRO }): Ponto {
  const rad = (graus * Math.PI) / 180;
  return { x: centro.x + Math.cos(rad) * raio, y: centro.y + Math.sin(rad) * raio };
}

interface EixoDesenhado {
  eixo: EixoPublico;
  hub: Ponto;
  /** Graus do eixo, medidos do centro. `-90` é para cima. */
  angulo: number;
  pontos: Array<{ no: NoPublico; em: Ponto }>;
}

function desenhar(eixos: readonly EixoPublico[]): EixoDesenhado[] {
  const n = Math.max(eixos.length, 1);
  return eixos.map((eixo, i) => {
    // Começa em cima e gira no sentido do relógio. Com um eixo só, ele fica em
    // cima; com cinco, é um pentágono. Sem caso especial e sem sorteio.
    const angulo = -90 + (360 / n) * i;
    const hub = emVolta(angulo, RAIO_DO_EIXO);
    const total = eixo.itens.length;
    const pontos = eixo.itens.map((no, j) => {
      // Um ponto fica na direção do eixo; vários abrem em leque simétrico.
      const desvio = total <= 1 ? 0 : -ABERTURA / 2 + (ABERTURA / (total - 1)) * j;
      return { no, em: emVolta(angulo + desvio, BRACO, hub) };
    });
    return { eixo, hub, angulo, pontos };
  });
}

/**
 * Rótulo curto o bastante para caber sob o ponto. O inteiro fica no nome
 * acessível da âncora (e, por extenso, na lista abaixo do mapa).
 *
 * 16 e não 20 porque a fonte do desenho subiu de 11 para 14: o rótulo ocupa
 * aproximadamente `caracteres × 0,6 × fonte` unidades do `viewBox`, e manter o
 * mesmo tamanho em unidades é o que impede que subir a fonte aproxime dois
 * rótulos vizinhos que hoje não se tocam.
 */
function curto(texto: string, max = 16): string {
  const limpo = texto.trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}

/**
 * A classe de cor do tom.
 *
 * Escrita como tabela e não montada por interpolação (`text-${tom}`): o Tailwind
 * varre o código-fonte atrás de classes LITERAIS, e classe montada em tempo de
 * execução não entra no CSS gerado — sairia tudo sem cor, em produção, sem erro.
 */
const COR_DO_TOM: Record<Tom, string> = {
  brand: 'text-brand',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  muted: 'text-dim',
};

function ancora(chave: string): string {
  return `no-${chave}`;
}

function Ligacao({ de, para }: { de: Ponto; para: Ponto }) {
  return (
    <line
      x1={de.x}
      y1={de.y}
      x2={para.x}
      y2={para.y}
      className="text-border-strong"
      stroke="currentColor"
      strokeOpacity={0.6}
      strokeWidth={1.2}
    />
  );
}

function PontoDoMapa({ no, em }: { no: NoPublico; em: Ponto }) {
  const legenda = [no.rotulo, no.numero !== null ? `: ${no.numero}` : '', no.detalhe ? ` — ${no.detalhe}` : '']
    .join('')
    .trim();

  /*
   * `aria-label` ALÉM do `<title>`, e não no lugar dele.
   *
   * Medido na árvore de acessibilidade: com `<title>` sozinho a âncora aparece
   * como "link" SEM NOME, porque calcular o nome a partir do `<title>` filho
   * depende de suporte que o navegador não dá. O `<title>` continua porque é ele
   * que produz a dica ao passar o mouse; quem carrega o nome é o `aria-label`.
   */
  return (
    <a href={`#${ancora(no.chave)}`} aria-label={legenda} className={COR_DO_TOM[no.tom]}>
      <title>{legenda}</title>
      <circle
        cx={em.x}
        cy={em.y}
        r={RAIO_DO_NO}
        fill="currentColor"
        fillOpacity={0.14}
        stroke="currentColor"
        strokeOpacity={0.8}
        strokeWidth={1.4}
      />
      {no.numero !== null && (
        <text
          x={em.x}
          y={em.y + 4}
          textAnchor="middle"
          className="fill-current font-os-mono text-[14px] font-bold"
        >
          {no.numero}
        </text>
      )}
      <text
        x={em.x}
        y={em.y + RAIO_DO_NO + 18}
        textAnchor="middle"
        className="fill-current font-os-mono text-[14px]"
      >
        {curto(no.rotulo)}
      </text>
    </a>
  );
}

/*
 * ----------------------------------------------------------------------------
 * O DESENHO NÃO DESCE ATÉ O CELULAR — `hidden md:block`
 * ----------------------------------------------------------------------------
 * O `viewBox` tem 1000 unidades de lado e o SVG ocupa a largura disponível: tudo
 * dentro dele encolhe junto com a tela. A conta, medida no navegador sobre a
 * página como ela renderiza:
 *
 *   largura disponível = viewport − 40 (o `px-5` da `main`) − 64 (o `p-8` da
 *   seção; 40 abaixo de `sm`) · escala = largura ÷ 1000
 *
 *   · 375px (o celular de onde vem a maior parte de quem chega): escala 0,295 —
 *     o rótulo de 11px saía com 3,2px e o ponto tinha 11px de diâmetro, contra
 *     os 24 mínimos de alvo de toque da norma de acessibilidade. Ilegível e
 *     inclicável: a peça visual da porta de entrada do produto não funcionava
 *     justamente no aparelho da maioria.
 *   · 768px (onde o desenho passa a aparecer): escala 0,664 — o ponto fica com
 *     26,6px de diâmetro (≥ 24 ✓) e o rótulo, já a 14px, com 9,3px.
 *   · 864px ou mais (o SVG para de crescer em 760): escala 0,76 — ponto de
 *     30,4px, rótulo de 10,6px.
 *
 * ESCONDER É A ESCOLHA CERTA AQUI porque a lista abaixo carrega o MESMO
 * conteúdo, em texto do tamanho do corpo: no celular não se perde informação
 * nenhuma, perde-se a ilustração. A alternativa — escalar raio e fonte pela
 * largura — exigiria medir a viewport, e medir viewport nesta página significa
 * JavaScript, que é exatamente o que ela não tem (ver o cabeçalho).
 *
 * `display: none` também tira o SVG da árvore de acessibilidade, então quem usa
 * leitor de tela no celular não ouve um mapa que não pode ver — ouve a lista.
 */
function Desenho({ mapa }: { mapa: MapaPublico }) {
  const eixos = desenhar(mapa.eixos);

  return (
    <svg
      viewBox={`0 0 ${LADO} ${LADO}`}
      role="img"
      aria-label="Mapa público da operação da ROOT. O mesmo conteúdo está na lista abaixo."
      className="mx-auto hidden h-auto w-full max-w-[760px] md:block"
    >
      {eixos.map(({ eixo, hub, pontos }) => (
        <g key={eixo.chave}>
          <Ligacao de={{ x: CENTRO, y: CENTRO }} para={hub} />
          {pontos.map(({ em }, i) => (
            <Ligacao key={i} de={hub} para={em} />
          ))}
        </g>
      ))}

      <g className="text-brand">
        <circle
          cx={CENTRO}
          cy={CENTRO}
          r={RAIO_DO_NUCLEO}
          fill="currentColor"
          fillOpacity={0.12}
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeWidth={1.5}
        />
        <text
          x={CENTRO}
          y={CENTRO + 5}
          textAnchor="middle"
          className="fill-current font-os-mono text-[18px] font-bold"
        >
          {curto(mapa.nucleo?.rotulo ?? 'ROOT', 11)}
        </text>
      </g>

      {eixos.map(({ eixo, hub }) => (
        <text
          key={eixo.chave}
          x={hub.x}
          y={hub.y + 4}
          textAnchor="middle"
          className="fill-current font-os-mono text-[14px] font-semibold uppercase tracking-[0.12em] text-muted"
        >
          {curto(eixo.rotulo, 13)}
        </text>
      ))}

      {eixos.flatMap(({ pontos }) =>
        pontos.map(({ no, em }) => <PontoDoMapa key={no.chave} no={no} em={em} />),
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------------- lista */

/*
 * O CENTRO DO MAPA TAMBÉM ENTRA NA LISTA.
 *
 * Era o único nó que o desenho mostrava e a lista não. No celular, onde o
 * desenho não aparece, ele sumiria inteiro — junto com o `detalhe`, que é a
 * frase que diz o que a ROOT é. A lista tem de conter TUDO que o desenho contém,
 * senão esconder o desenho passa a esconder conteúdo.
 */
function Nucleo({ no }: { no: NoPublico }) {
  return (
    <section id={ancora(no.chave)} className="mt-10 scroll-mt-8 border border-brand/25 bg-surface p-4">
      <h3 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-dim">No centro</h3>
      <p className="mt-3 flex items-baseline gap-2">
        {no.numero !== null && (
          <span className={`font-os-mono text-[15px] font-bold ${COR_DO_TOM[no.tom]}`}>
            {no.numero}
          </span>
        )}
        <span className="text-[14px] font-semibold text-text">{no.rotulo}</span>
      </p>
      {no.detalhe && <p className="mt-0.5 text-[12px] leading-[1.55] text-muted">{no.detalhe}</p>}
    </section>
  );
}

function Lista({ mapa }: { mapa: MapaPublico }) {
  return (
    <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {mapa.eixos.map((eixo) => (
        <section key={eixo.chave} className="border border-border bg-surface p-4">
          <h3 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-dim">
            {eixo.rotulo}
          </h3>
          <ul className="mt-3 space-y-3">
            {eixo.itens.map((no) => (
              <li key={no.chave} id={ancora(no.chave)} className="scroll-mt-8">
                <p className="flex items-baseline gap-2">
                  {no.numero !== null && (
                    <span className={`font-os-mono text-[15px] font-bold ${COR_DO_TOM[no.tom]}`}>
                      {no.numero}
                    </span>
                  )}
                  <span className="text-[13px] font-semibold text-text">{no.rotulo}</span>
                </p>
                {no.detalhe && (
                  <p className="mt-0.5 text-[12px] leading-[1.55] text-muted">{no.detalhe}</p>
                )}
              </li>
            ))}
            {eixo.itens.length === 0 && (
              <li className="text-[12px] text-dim">nada publicado neste eixo</li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- a página */

export default async function EntradaPublica() {
  const mapa = await buscarMapa();
  const temMapa = mapa !== null && (mapa.nucleo !== null || mapa.eixos.length > 0);

  return (
    <div data-os-app className="min-h-screen bg-bg text-text">
      <main className="mx-auto max-w-[1040px] px-5 py-14 sm:py-20">
        <p className="font-os-mono text-[10px] uppercase tracking-[0.2em] text-dim">ROOT OS</p>

        <h1 className="mt-4 max-w-[22ch] text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-text sm:text-[44px]">
          Quantas pessoas usam a sua conta de IA hoje?
        </h1>

        <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.5] text-muted sm:text-[19px]">
          E você consegue dizer o que cada uma fez nela — quem pediu, com que
          autonomia, e o que saiu para fora da empresa?
        </p>

        <p className="mt-6 max-w-[60ch] text-[14px] leading-[1.65] text-muted">
          O desenho abaixo é a nossa própria operação, servida do banco do ROOT OS
          agora. Nada aqui é ilustração: cada ponto é um registro, e os números
          saem de uma contagem feita neste pedido.
        </p>

        <section className="mt-12 border border-border bg-bg2 p-5 sm:p-8">
          {temMapa ? (
            <>
              <Desenho mapa={mapa} />
              {mapa.nucleo && <Nucleo no={mapa.nucleo} />}
              <Lista mapa={mapa} />
            </>
          ) : (
            /*
             * Sem mapa a página continua de pé, e DIZ que está sem — em vez de
             * mostrar um quadro vazio com cara de tela quebrada. O texto de
             * venda não depende do desenho.
             */
            <p className="py-10 text-center text-[13px] text-muted">
              O mapa ao vivo está fora do ar neste momento. O resto da página não
              depende dele.
            </p>
          )}
        </section>

        <section className="mt-10 border border-brand/25 bg-surface p-5 sm:p-6">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">
            Por que este mapa mostra pouco
          </h2>
          <p className="mt-3 max-w-[68ch] text-[13.5px] leading-[1.65] text-muted">
            Porque nada aparece aqui sem marca. Cada ponto existe porque alguém
            marcou <em className="not-italic text-text">aquele registro</em> como
            público, um por um, no banco. Não há regra do tipo “toda nota deste
            tipo é pública” — é essa regra que vaza no dia em que alguém criar uma
            nota sem pensar nesta página. O resto do nosso contexto não tem
            caminho até aqui.
          </p>
          <p className="mt-3 max-w-[68ch] text-[13.5px] leading-[1.65] text-muted">
            É o mesmo desenho que protege o seu contexto quando a conta é sua: o
            sistema pergunta de quem é cada linha antes de devolver qualquer
            coisa, e o que sai para fora passa por uma régua de risco antes de
            sair.
          </p>
        </section>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            href="/login"
            className="border border-brand bg-brand px-5 py-2.5 font-os-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-brand-2"
          >
            Entrar
          </a>
          <a
            href="/central"
            className="border border-border px-5 py-2.5 font-os-mono text-[11px] uppercase tracking-[0.14em] text-muted hover:border-border-strong hover:text-text"
          >
            Central da comunidade
          </a>
        </div>

        <footer className="mt-16 border-t border-border pt-6 text-[11.5px] leading-[1.7] text-dim">
          <p>
            {mapa?.geradoEm ? (
              <>
                Mapa lido em{' '}
                <span className="font-os-mono text-muted">{mapa.geradoEm}</span> (UTC).
              </>
            ) : (
              'Mapa indisponível neste pedido.'
            )}
          </p>
          <p className="mt-2">
            {/*
              O protótipo antigo continua servido de `public/root-os.html`. O link
              existe para que ele não desapareça com a troca da raiz — é a versão
              que circulou em apresentação e em link colado por aí.
            */}
            <a className="underline hover:text-muted" href="/root-os.html">
              Ver o protótipo anterior
            </a>
            {' · '}
            <a className="underline hover:text-muted" href="/termos">
              Termos
            </a>
            {' · '}
            <a className="underline hover:text-muted" href="/privacidade">
              Privacidade
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
