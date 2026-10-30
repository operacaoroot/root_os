import type { Relato } from './frota.schemas';

/*
 * AS POLÍTICAS DA FROTA — tiradas do manual do kit-instalacao-vps (notas 02,
 * 05, 06, 07 e 24), conferidas casa a casa a partir do último relato.
 *
 * Parte pura: recebe o relato e o que o painel sabe (acessos, ordens) e devolve
 * o estado de cada política. O que não dá para medir pela máquina fica
 * `manual`, e a tela diz isso em vez de fingir um verde.
 */

export type EstadoDaPolitica = 'ok' | 'at' | 'er' | 'ne' | 'manual';

export interface Politica {
  cod: string;
  nome: string;
  texto: string;
  base: string;
}

export const POLITICAS: readonly Politica[] = [
  { cod: '01', nome: 'Blindagem mínima do servidor', texto: 'SSH só por chave, root só por chave, fail2ban, firewall com cadeia DOCKER-USER. Nenhuma porta na internet além de 22, 80 e 443, ou só 22 no modo VPN.', base: 'etapas 02 e 03 do kit' },
  { cod: '02', nome: 'Acesso nominal', texto: 'Uma chave por pessoa, com o nome dela no comentário. Chave sem dono é falha.', base: 'manual · nota 8' },
  { cod: '03', nome: 'Saída no mesmo dia', texto: 'Quem sai do projeto perde a chave no mesmo dia. Revogação pedida e não aplicada em 24 h é atenção.', base: 'manual · nota 8' },
  { cod: '04', nome: 'Backup cifrado com cópia fora', texto: 'restic diário, retenção 14 / 8 / 6, cópia fora do servidor em conta do cliente.', base: 'manual · notas 16 a 18' },
  { cod: '05', nome: 'Logs sem conteúdo', texto: 'Log registra o quê, quando e quem. Nunca CPF, nome de cliente do cliente ou texto de documento. Conferido antes de publicar cada app.', base: 'manual · nota 24' },
  { cod: '06', nome: 'Dado só na casa', texto: 'Dado do cliente fica no servidor dele e no backup dele. Não vai para estação, planilha, chat nem para o servidor de outro cliente.', base: 'manual · nota 24' },
  { cod: '07', nome: 'IA sem treino', texto: 'Agente de IA sobre dado do cliente só com o cliente ciente e em conta que não treina com o conteúdo.', base: 'manual · nota 24 · regra 7' },
  { cod: '08', nome: 'Incidente avisado em 48 h', texto: 'Contato de incidente do cliente registrado na ficha. Fora do ar, acesso indevido ou dado perdido: conter, registrar e avisar em até 48 h.', base: 'manual · nota 23 · contrato' },
  { cod: '09', nome: 'Nada dispara sozinho sem aprovação', texto: 'Toda automação no catálogo da casa, com dono. Timer fora do catálogo é falha.', base: 'manual · notas 19 e 20' },
  { cod: '10', nome: 'Papéis LGPD e encerramento', texto: 'Cliente é controlador, ROOT é operadora, com encarregado nomeado e registro de tratamento preenchido.', base: 'manual · notas 24 e 26' },
];

export interface EntradaDaAvaliacao {
  relato: Relato | null;
  ultimoRelatoEm: Date | null;
  etapa: string;
  acessos: { estado: string; pessoa: string; fingerprint: string | null; updatedAt: Date }[];
  ficha: Record<string, unknown> | null;
  lgpd: Record<string, unknown> | null;
  agora?: Date;
}

export interface PoliticaAvaliada extends Politica {
  estado: EstadoDaPolitica;
  detalhe: string;
}

const temTexto = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

export function avaliarPoliticas(e: EntradaDaAvaliacao): PoliticaAvaliada[] {
  const agora = e.agora ?? new Date();
  const r = e.relato;
  const semRelato = !r || e.etapa === 'pre';
  const falhas = r?.verificar.filter((v) => v.n === 'fa') ?? [];
  const avisos = r?.verificar.filter((v) => v.n === 'av') ?? [];
  const casa = (t: string) => t.toLowerCase();

  const p01 = (): [EstadoDaPolitica, string] => {
    if (semRelato) return ['ne', 'sem relato da máquina'];
    const graves = falhas.filter((f) => /ssh|ufw|firewall|docker-user|porta|fail2ban|senha/i.test(f.t));
    if (graves.length) return ['er', graves.map((g) => g.t).join(' · ')];
    return ['ok', 'kit-verificar sem falha de blindagem'];
  };
  const p02 = (): [EstadoDaPolitica, string] => {
    if (semRelato) return ['ne', 'sem relato da máquina'];
    const ativas = e.acessos.filter((a) => a.estado === 'ativa' || a.estado === 'revogando');
    const semDono = ativas.filter((a) => !a.pessoa || /^sem dono/i.test(a.pessoa));
    if (semDono.length) return ['at', `${semDono.length} chave(s) sem comentário no authorized_keys`];
    return ['ok', `${ativas.length} chave(s), todas com dono`];
  };
  const p03 = (): [EstadoDaPolitica, string] => {
    if (semRelato) return ['ne', 'sem relato da máquina'];
    const presas = e.acessos.filter((a) => a.estado === 'revogando' && agora.getTime() - a.updatedAt.getTime() > 24 * 3600e3);
    if (presas.length) return ['at', `${presas.length} revogação(ões) pedida(s) há mais de 24 h sem o relator aplicar`];
    return ['ok', 'nenhuma revogação presa'];
  };
  const p04 = (): [EstadoDaPolitica, string] => {
    if (semRelato) return ['ne', 'sem relato da máquina'];
    const b = r?.backup;
    if (!b || !b.ultimoOk) return ['er', 'backup nunca rodou com sucesso'];
    const idadeH = (agora.getTime() - new Date(b.ultimoOk).getTime()) / 3600e3;
    if (idadeH > 36) return ['er', `último backup bom há ${Math.round(idadeH)} h`];
    if (!b.remoto) return ['at', 'backup só local: sem cópia fora do servidor'];
    return ['ok', 'backup diário com cópia fora'];
  };
  const p05 = (): [EstadoDaPolitica, string] => ['manual', 'conferido por gente antes de publicar cada app'];
  const p06 = (): [EstadoDaPolitica, string] => ['manual', 'regra de conduta: não há como a máquina medir'];
  const p07 = (): [EstadoDaPolitica, string] => {
    if (e.etapa === 'pre') return ['ne', 'casa ainda sem servidor'];
    return temTexto(e.lgpd?.ia) ? ['ok', String(e.lgpd?.ia)] : ['at', 'registre na aba LGPD como a IA toca o dado desta casa'];
  };
  const p08 = (): [EstadoDaPolitica, string] => {
    if (e.etapa === 'pre') return ['ne', 'casa ainda sem servidor'];
    return temTexto(e.ficha?.contatoIncidente) ? ['ok', `contato: ${String(e.ficha?.contatoIncidente)}`] : ['at', 'ficha sem contato de incidente do cliente'];
  };
  const p09 = (): [EstadoDaPolitica, string] => {
    if (semRelato) return ['ne', 'sem relato da máquina'];
    const fora = falhas.filter((f) => /fora do catálogo/i.test(f.t));
    if (fora.length) return ['er', fora.map((f) => f.t).join(' · ')];
    return ['ok', `${r?.timers.length ?? 0} timer(s), todos no catálogo`];
  };
  const p10 = (): [EstadoDaPolitica, string] => {
    if (e.etapa === 'pre') return ['ne', 'casa ainda sem servidor'];
    const l = e.lgpd ?? {};
    const campos = ['controlador', 'dados', 'finalidade', 'baseLegal', 'retencao', 'encarregado'];
    const faltam = campos.filter((c) => !temTexto(l[c]));
    if (faltam.length === campos.length) return ['ne', 'registro de tratamento vazio'];
    if (faltam.length) return ['at', `faltam: ${faltam.join(', ')}`];
    return ['ok', 'registro de tratamento completo'];
  };

  const avaliadores = [p01, p02, p03, p04, p05, p06, p07, p08, p09, p10];
  void avisos;
  void casa;
  return POLITICAS.map((p, i) => {
    const [estado, detalhe] = avaliadores[i]();
    return { ...p, estado, detalhe };
  });
}

/** O estado da casa, derivado do relato: erro ganha de atenção, que ganha de ok. */
export function estadoDaCasa(r: Relato | null, etapa: string): { estado: 'ok' | 'at' | 'er' | 'ne'; texto: string } {
  if (etapa === 'pre') return { estado: 'ne', texto: 'pré-implantação · sem servidor' };
  if (!r) return { estado: 'ne', texto: 'sem relato' };
  const falhas = r.verificar.filter((v) => v.n === 'fa').length;
  if (falhas) return { estado: 'er', texto: `erro · ${falhas} falha${falhas > 1 ? 's' : ''} no kit-verificar` };
  const motivos: string[] = [];
  if (r.sonda && r.sonda.estado !== 'ok') motivos.push('sonda com alerta');
  if (!r.backup?.ultimoOk) motivos.push('backup nunca rodou');
  else if (!r.backup.remoto) motivos.push('backup só local');
  const parados = r.containers.filter((c) => c.estado !== 'running' || c.saude === 'unhealthy').length;
  if (parados) motivos.push(`${parados} container(s) parado(s)`);
  if ((r.maquina.discoUsoPct ?? 0) >= 85) motivos.push(`disco em ${r.maquina.discoUsoPct}%`);
  const avisos = r.verificar.filter((v) => v.n === 'av').length;
  if (motivos.length) return { estado: 'at', texto: `atenção · ${motivos[0]}` };
  if (avisos) return { estado: 'at', texto: `atenção · ${avisos} aviso${avisos > 1 ? 's' : ''} no kit-verificar` };
  return { estado: 'ok', texto: 'ok · tudo verde' };
}

/** As pendências que a tela "precisa de ação" lista, tiradas do relato. */
export function pendenciasDaCasa(r: Relato | null, etapa: string, acessos: { estado: string; pessoa: string }[]): { n: 'at' | 'er' | 'ne'; t: string; b: string }[] {
  const out: { n: 'at' | 'er' | 'ne'; t: string; b: string }[] = [];
  if (etapa === 'pre') return [{ n: 'ne', t: 'Sem servidor ainda. Próximo passo: VPS em nome do cliente e kit na etapa preparar.', b: 'roteiro de implantação' }];
  if (!r) return [{ n: 'at', t: 'Casa sem relato: o kit-relatar ainda não mandou nada. Instale o relator (etapa 09) com o token desta casa.', b: 'kit · etapa 09' }];
  for (const f of r.verificar.filter((v) => v.n === 'fa')) out.push({ n: 'er', t: f.t, b: 'kit-verificar' });
  if (!r.backup?.ultimoOk) out.push({ n: 'er', t: 'Backup nunca rodou com sucesso.', b: 'política 04' });
  else if (!r.backup.remoto) out.push({ n: 'at', t: 'Backup só local. Falta o destino em conta do cliente (RESTIC_REMOTO) e o custo aprovado por ele.', b: 'política 04 · manual nota 18' });
  if (r.sonda && r.sonda.estado !== 'ok') out.push({ n: 'at', t: `Sonda: ${r.sonda.estado}`, b: 'kit-sonda' });
  const semDono = acessos.filter((a) => (a.estado === 'ativa') && /^sem dono/i.test(a.pessoa)).length;
  if (semDono) out.push({ n: 'at', t: `${semDono} chave(s) SSH sem comentário no authorized_keys. Identificar o dono ou revogar.`, b: 'política 02' });
  if ((r.maquina.discoUsoPct ?? 0) >= 85) out.push({ n: 'at', t: `Disco em ${r.maquina.discoUsoPct}%.`, b: 'máquina' });
  if (r.maquina.reboot) out.push({ n: 'ne', t: 'O sistema pede reboot (kernel ou libc atualizados). Agendar com o cliente.', b: 'manual · nota 22' });
  for (const a of r.verificar.filter((v) => v.n === 'av' && !/RESTIC_REMOTO|cópia fora|ALERTA_URL|jornada:/i.test(v.t))) out.push({ n: 'ne', t: a.t, b: 'kit-verificar' });
  for (const i of r.jornada?.itens.filter((x) => x.situacao === 'regrediu') ?? []) {
    out.push({ n: 'at', t: `Jornada ${i.id} regrediu: ${i.item}${i.autoTexto ? ` (${i.autoTexto})` : ''}`, b: 'kit-jornada' });
  }
  return out;
}
