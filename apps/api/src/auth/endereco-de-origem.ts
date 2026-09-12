/*
 * DE ONDE VEIO A TENTATIVA — e por que `req.ip` estava mentindo.
 *
 * Em produção a API atende atrás do Traefik. `req.ip` do Express devolve o par
 * do SOCKET, que nesse desenho é sempre o proxy: toda linha do RASTRO gravava o
 * mesmo endereço, o da infraestrutura, e a auditoria de tentativa repetida de
 * senha ficava sem a única coluna que diz de onde ela veio.
 *
 * O CONSERTO ESTÁ LIGADO desde 11/09/2026 e cabe em uma linha:
 * `app.set('trust proxy', 1)` em `src/main.ts` — UM salto, o Traefik. Com isso o
 * Express popula `req.ips` a partir de `X-Forwarded-For` descartando os saltos
 * em que não confia, e `req.ip` volta a ser quem chamou.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ: ler `X-Forwarded-For` por conta própria. O
 * cabeçalho é escrito por quem chama e, sem um proxy declarado como confiável,
 * aceitar o que ele diz seria deixar o atacante escolher o endereço que vai
 * ficar registrado como dele — trocar um endereço inútil por um endereço FALSO,
 * que é pior. Quem decide em quem confiar é o `trust proxy` do Express, num
 * lugar só; aqui só se lê o resultado.
 *
 * E a função continua funcionando com o `trust proxy` DESLIGADO (o caso do
 * `pnpm dev` e o dos testes, que montam um `req` de mentira): `req.ips` vem
 * vazio, e o valor cai para o do socket, que fora do proxy é o certo.
 */

/** O mínimo do `Request` do Express que interessa aqui. */
export interface RequisicaoComEndereco {
  ip?: string;
  /** Só é populado quando o Express foi instruído a confiar no proxy. */
  ips?: string[];
}

/**
 * O endereço de quem chamou, quando dá para saber. `undefined` quando não há
 * requisição (script, fila, teste) — e `undefined` é melhor que um endereço
 * inventado.
 *
 * `req.ips` SÓ TEM CONTEÚDO SOB `trust proxy`, e o Express 5 já o entrega
 * PODADO pelo número de saltos confiados — o primeiro elemento é o mais próximo
 * do cliente **entre os que o Express aceita**. Medido em 11/09/2026, express
 * 5.2.1, com `X-Forwarded-For: 203.0.113.77, 198.51.100.9, 10.1.1.1`:
 *
 *   trust=false  ip=::1            ips=[]
 *   trust=1      ip=10.1.1.1       ips=[10.1.1.1]
 *   trust=2      ip=198.51.100.9   ips=[198.51.100.9, 10.1.1.1]
 *   trust=true   ip=203.0.113.77   ips=[203.0.113.77, 198.51.100.9, 10.1.1.1]
 *
 * É por isso que `main.ts` declara **1** e não `true`: com `true`, `ips[0]`
 * passaria a ser o primeiro valor do cabeçalho, que quem chama escreve à mão.
 * A poda é do Express, não daqui — e é ela que separa "endereço de quem falou
 * com o proxy" de "endereço que o atacante digitou".
 *
 * O `??` cai para `req.ip` quando `ips` vem vazio, que é o caso sem proxy
 * (`pnpm dev`, teste): ali o par do socket é o endereço certo.
 */
export function enderecoDeOrigem(req: RequisicaoComEndereco | undefined | null): string | undefined {
  if (!req) return undefined;
  const doProxyConfiavel = Array.isArray(req.ips) ? req.ips.find((i) => i && i.trim() !== '') : undefined;
  return doProxyConfiavel ?? (req.ip || undefined);
}
