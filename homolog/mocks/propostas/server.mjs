// Dublê do serviço de propostas da ROOT (proposta.operacaoroot.com) para a homologação.
// Em produção as páginas antigas e o rastreio delas moram num serviço à parte na VPS,
// que o OS só LÊ (apps/api/src/platform/propostas.service.ts). Aqui duas propostas
// fictícias, sem dado de cliente, para a tela de Propostas mostrar as antigas ao lado
// das da sala. Node puro, sem dependência; só na rede interna da stack.
import http from 'node:http';

const TOKEN = process.env.PROPOSTAS_API_TOKEN ?? '';
const PORTA = Number(process.env.PORT ?? 4013);
const agora = Date.now();
const iso = (diasAtras) => new Date(agora - diasAtras * 86_400_000).toISOString();

const PROPOSTAS = [
  { cliente: 'exemplo-alfa', chave: 'diagnostico', titulo: 'Proposta de exemplo · Diagnóstico (dublê)', estado: 'aberta', etapa: 2, aberturas: 3, pessoas: 2, ultimaAtividade: iso(1), criadaEm: iso(9), link: 'https://proposta.exemplo.invalid/exemplo-alfa/diagnostico' },
  { cliente: 'exemplo-beta', chave: 'implantacao', titulo: 'Proposta de exemplo · Implantação (dublê)', estado: 'paga', etapa: 4, aberturas: 7, pessoas: 3, ultimaAtividade: iso(4), criadaEm: iso(20), link: 'https://proposta.exemplo.invalid/exemplo-beta/implantacao' },
];

function detalhe(p) {
  return {
    ...p,
    tempoTotalMs: 9 * 60_000,
    maisVista: 'investimento',
    tempoPorParte: [
      { id: 'abertura', nome: 'Abertura', ms: 60_000, aberturasQueViram: p.aberturas },
      { id: 'escopo', nome: 'Escopo', ms: 3 * 60_000, aberturasQueViram: p.aberturas - 1 },
      { id: 'investimento', nome: 'Investimento', ms: 5 * 60_000, aberturasQueViram: p.aberturas - 1 },
    ],
    audios: [],
    visitas: [{ quando: p.ultimaAtividade, pessoa: 1, aparelho: 'desktop', descricao: null, tempoMs: 4 * 60_000, leuAte: 'investimento', plays: 0, clicouEmPagar: p.estado === 'paga' }],
    visitasDaEquipeIgnoradas: 0,
  };
}

const json = (res, status, corpo) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
};

http
  .createServer((req, res) => {
    if (req.url === '/health') return json(res, 200, { ok: true });
    if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { erro: 'senha' });
    const m = /^\/proposta\/_api\/propostas(?:\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+))?\/?$/.exec(req.url ?? '');
    if (!m || req.method !== 'GET') return json(res, 404, { erro: 'não encontrado' });
    if (!m[1]) return json(res, 200, { propostas: PROPOSTAS, aparelhosDaEquipe: [] });
    const p = PROPOSTAS.find((x) => x.cliente === m[1] && x.chave === m[2]);
    return p ? json(res, 200, detalhe(p)) : json(res, 404, { erro: 'não encontrado' });
  })
  .listen(PORTA, () => console.log(`dublê de propostas na porta ${PORTA}`));
