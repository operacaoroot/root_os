// Rotas que existiam antes da reorganização do painel na lógica do ROOT OS.
// Toda uma delas responde — nenhum link antigo, favorito ou e-mail quebra.
//
// Mora num .mjs solto (e não em @mktos/shared) de propósito: next.config.mjs é
// lido antes de qualquer build de pacote do workspace. Importar do shared aqui
// significaria que um dist desatualizado derruba o servidor inteiro.
//
// A trava de que esta lista está completa é apps/web/tests/unit/nav.test.ts,
// que cruza estas entradas com o NAV.
export const ROTAS_ANTIGAS = [
  // renomeadas: a tela é a mesma, o nome mudou para o do conceito
  { de: '/obsidian', para: '/contexto' },
  { de: '/usuarios', para: '/regua?aba=pessoas' },
  { de: '/auditoria', para: '/rastro' },
  { de: '/integracoes', para: '/conexoes' },
  // eram placeholder e agora têm tela própria
  { de: '/ia', para: '/sessoes' },
  { de: '/mcp', para: '/ferramentas' },
  { de: '/automacoes', para: '/rotinas' },
  { de: '/whatsapp', para: '/atendimento' },
  // absorvidas: viraram conteúdo dentro de outra tela
  { de: '/documentos', para: '/contexto?aba=arquivos' },
];

export default ROTAS_ANTIGAS;
