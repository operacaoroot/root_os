import type { Permission } from './permissions.js';

// Módulos do menu (ver docs/ARCHITECTURE.md). Usado pela sidebar do web.
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string; // nome do ícone (lucide)
  permission: Permission;
  phase: number; // fase do roadmap em que fica funcional
}

export const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/', icon: 'LayoutDashboard', permission: 'dashboard.ver', phase: 1 },
  { key: 'leads', label: 'Leads', href: '/leads', icon: 'Users', permission: 'leads.ver', phase: 2 },
  { key: 'funil', label: 'Funil', href: '/funil', icon: 'Filter', permission: 'dashboard.ver', phase: 2 },
  { key: 'campanhas', label: 'Campanhas', href: '/campanhas', icon: 'Megaphone', permission: 'campanhas.ver', phase: 2 },
  { key: 'conteudo', label: 'Conteúdo', href: '/conteudo', icon: 'FileText', permission: 'dashboard.ver', phase: 2 },
  { key: 'metas', label: 'Metas', href: '/metas', icon: 'Target', permission: 'dashboard.ver', phase: 4 },
  { key: 'instagram', label: 'Instagram', href: '/instagram', icon: 'Instagram', permission: 'instagram.ver', phase: 4 },
  { key: 'vendas', label: 'Página de vendas', href: '/vendas', icon: 'ShoppingCart', permission: 'dashboard.ver', phase: 2 },
  { key: 'pixels', label: 'Pixels e eventos', href: '/pixels', icon: 'Activity', permission: 'dashboard.ver', phase: 2 },
  { key: 'tarefas', label: 'Tarefas', href: '/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', phase: 3 },
  { key: 'financeiro', label: 'Financeiro', href: '/financeiro', icon: 'Wallet', permission: 'financeiro.ver', phase: 2 },
  { key: 'automacoes', label: 'Automações', href: '/automacoes', icon: 'Zap', permission: 'automacoes.ver', phase: 3 },
  { key: 'google', label: 'Google', href: '/google', icon: 'Mail', permission: 'dashboard.ver', phase: 2 },
  { key: 'whatsapp', label: 'WhatsApp', href: '/whatsapp', icon: 'MessageCircle', permission: 'whatsapp.enviar', phase: 6 },
  { key: 'documentos', label: 'Documentos', href: '/documentos', icon: 'FolderOpen', permission: 'drive.ver', phase: 5 },
  { key: 'obsidian', label: 'Obsidian', href: '/obsidian', icon: 'BookOpen', permission: 'obsidian.ver', phase: 2 },
  { key: 'relatorios', label: 'Relatórios', href: '/relatorios', icon: 'BarChart3', permission: 'relatorios.ver', phase: 2 },
  { key: 'ia', label: 'IA / Assistente', href: '/ia', icon: 'Bot', permission: 'mcp.ver', phase: 7 },
  { key: 'mcp', label: 'MCP / Ferramentas', href: '/mcp', icon: 'Plug', permission: 'mcp.ver', phase: 7 },
  { key: 'integracoes', label: 'Integrações', href: '/integracoes', icon: 'Blocks', permission: 'dashboard.ver', phase: 2 },
  { key: 'config', label: 'Configurações', href: '/config', icon: 'Settings', permission: 'dashboard.ver', phase: 1 },
  { key: 'usuarios', label: 'Usuários e permissões', href: '/usuarios', icon: 'Shield', permission: 'admin.usuarios', phase: 1 },
  { key: 'auditoria', label: 'Auditoria', href: '/auditoria', icon: 'ScrollText', permission: 'auditoria.ver', phase: 1 },
];
