// Permissões por ação (ver docs/SECURITY.md). Fonte única compartilhada por api e web.

export const PERMISSIONS = [
  'dashboard.ver',
  'leads.ver',
  'leads.editar',
  'campanhas.ver',
  'campanhas.editar',
  'instagram.ver',
  'tarefas.ver',
  'tarefas.editar',
  'financeiro.ver',
  'financeiro.editar',
  'financeiro.conciliar',
  'gmail.ver',
  'gmail.responder',
  'agenda.editar',
  'whatsapp.enviar',
  'whatsapp.configurar',
  'drive.ver',
  'drive.editar',
  'obsidian.ver',
  'obsidian.editar',
  'relatorios.ver',
  'relatorios.gerar',
  'relatorios.enviar',
  'automacoes.ver',
  'automacoes.executar',
  'mcp.ver',
  'mcp.executar',
  'admin.usuarios',
  'admin.permissoes',
  'auditoria.ver',
  'bio.ver',
  'bio.editar',
  'pauta.ver',
  'pauta.editar',
  'pauta.publicar',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Perfis sugeridos → conjunto de permissões. (subset inicial; expandir por fase)
export const ROLES = {
  admin_master: {
    name: 'Admin Master',
    permissions: [...PERMISSIONS] as Permission[],
  },
  diretor: {
    name: 'Diretor',
    permissions: [
      'dashboard.ver', 'leads.ver', 'campanhas.ver', 'instagram.ver',
      'tarefas.ver', 'financeiro.ver', 'gmail.ver', 'drive.ver', 'obsidian.ver',
      'relatorios.ver', 'relatorios.gerar', 'relatorios.enviar',
      'automacoes.ver', 'mcp.ver', 'auditoria.ver', 'bio.ver', 'pauta.ver',
    ] as Permission[],
  },
  // Perfil dedicado ao Financeiro (FinOps): opera contas, lançamentos e bancos.
  financeiro: {
    name: 'Financeiro',
    permissions: [
      'dashboard.ver', 'financeiro.ver', 'financeiro.editar', 'financeiro.conciliar',
      'relatorios.ver', 'relatorios.gerar', 'mcp.ver',
    ] as Permission[],
  },
  gestor_marketing: {
    name: 'Gestor de Marketing',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver',
      'campanhas.editar', 'instagram.ver', 'tarefas.ver', 'tarefas.editar',
      'gmail.ver', 'gmail.responder', 'agenda.editar', 'drive.ver', 'drive.editar',
      'obsidian.ver', 'relatorios.ver',
      'relatorios.gerar', 'automacoes.ver', 'mcp.ver', 'mcp.executar',
      'bio.ver', 'bio.editar',
      'pauta.ver', 'pauta.editar', 'pauta.publicar',
    ] as Permission[],
  },
  analista: {
    name: 'Analista de Marketing',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver',
      'instagram.ver', 'tarefas.ver', 'tarefas.editar', 'relatorios.ver',
      'relatorios.gerar', 'automacoes.ver', 'mcp.ver', 'bio.ver',
      'pauta.ver', 'pauta.editar',
    ] as Permission[],
  },
  social_media: {
    name: 'Social Media',
    permissions: [
      'dashboard.ver', 'instagram.ver', 'campanhas.ver', 'tarefas.ver',
      'tarefas.editar', 'drive.ver', 'obsidian.ver', 'relatorios.ver',
      'bio.ver', 'bio.editar',
      'pauta.ver', 'pauta.editar', 'pauta.publicar',
    ] as Permission[],
  },
  consulta_limitada: {
    name: 'Consulta Limitada',
    permissions: ['dashboard.ver', 'leads.ver', 'campanhas.ver', 'relatorios.ver'] as Permission[],
  },
  // Conta de serviço usada pelo MCP/IA. Só leitura (menor privilégio).
  ia_servico: {
    name: 'IA / Serviço (read-only)',
    permissions: [
      'dashboard.ver', 'leads.ver', 'campanhas.ver', 'tarefas.ver',
      'financeiro.ver', 'instagram.ver', 'relatorios.ver', 'obsidian.ver', 'gmail.ver', 'drive.ver',
      'mcp.ver', 'mcp.executar', 'bio.ver', 'pauta.ver',
    ] as Permission[],
  },
  // Conta de AÇÃO da IA: escreve SÓ o que o humano aprovou (usada pelo bot após
  // confirmação). Least-privilege de escrita — sem admin, sem relatórios.
  ia_acao: {
    name: 'IA / Ação (aprovada)',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver', 'campanhas.editar',
      'tarefas.ver', 'tarefas.editar', 'gmail.responder', 'agenda.editar', 'drive.editar',
      'mcp.ver', 'mcp.executar',
    ] as Permission[],
  },
} as const;

export type RoleKey = keyof typeof ROLES;
