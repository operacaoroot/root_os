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
  'gmail.ver',
  'gmail.responder',
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
      'tarefas.ver', 'gmail.ver', 'drive.ver', 'obsidian.ver',
      'relatorios.ver', 'relatorios.gerar', 'relatorios.enviar',
      'automacoes.ver', 'mcp.ver', 'auditoria.ver',
    ] as Permission[],
  },
  gestor_marketing: {
    name: 'Gestor de Marketing',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver',
      'campanhas.editar', 'instagram.ver', 'tarefas.ver', 'tarefas.editar',
      'gmail.ver', 'drive.ver', 'obsidian.ver', 'relatorios.ver',
      'relatorios.gerar', 'automacoes.ver', 'mcp.ver', 'mcp.executar',
    ] as Permission[],
  },
  analista: {
    name: 'Analista de Marketing',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver',
      'instagram.ver', 'tarefas.ver', 'tarefas.editar', 'relatorios.ver',
      'relatorios.gerar', 'automacoes.ver', 'mcp.ver',
    ] as Permission[],
  },
  social_media: {
    name: 'Social Media',
    permissions: [
      'dashboard.ver', 'instagram.ver', 'campanhas.ver', 'tarefas.ver',
      'tarefas.editar', 'drive.ver', 'obsidian.ver', 'relatorios.ver',
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
      'relatorios.ver', 'obsidian.ver', 'mcp.ver', 'mcp.executar',
    ] as Permission[],
  },
  // Conta de AÇÃO da IA: escreve SÓ o que o humano aprovou (usada pelo bot após
  // confirmação). Least-privilege de escrita — sem admin, sem relatórios.
  ia_acao: {
    name: 'IA / Ação (aprovada)',
    permissions: [
      'dashboard.ver', 'leads.ver', 'leads.editar', 'campanhas.ver', 'campanhas.editar',
      'tarefas.ver', 'tarefas.editar', 'mcp.ver', 'mcp.executar',
    ] as Permission[],
  },
} as const;

export type RoleKey = keyof typeof ROLES;
