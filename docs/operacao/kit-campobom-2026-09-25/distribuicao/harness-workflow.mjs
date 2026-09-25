import { readFileSync } from 'node:fs'
const WF = process.argv[2]
const src = readFileSync(WF, 'utf8').replace(/^export const meta =/m, 'const meta =')
if (/Date\.now|Math\.random|new Date/.test(src)) { console.log('não determinístico'); process.exit(2) }
if (/fullbpo/i.test(src.replace(/pedro\.magnago@fullbpo\.com/gi, ''))) { console.log('marca: FullBPO no workflow'); process.exit(3) }
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('args', 'agent', 'phase', 'log', src)
const COMMIT = 'af2923decb9c81148538d24e3a0725c6345ee57d'

const base = {
  inv: { pastaKit: '/k', sha256Ok: true, contatoPreenchido: true, kitGravavel: true, kitNoDrive: true, macosMaior: 14, ramGiB: 16, discoLivreGiB: 100, admin: true, energiaAC: true, dockerDesktopAberto: false, portasOcupadas: [], instanciaExiste: false, estadoInstalacao: 'nenhuma', tentativasGuardadas: 0, redeFalhas: [], redeTestados: 17, proxyAtivo: 0 },
  pre: { contratoRootOS: true, composeOk: true, buildxOk: true, contextoDocker: 'colima', colimaNoAr: true, googleEnvOk: true },
  prep: { energiaAC: true, recomecoFeito: false, bundleHashOk: true, commitClone: COMMIT, exitChecar: 0, disparado: true },
  esperas: [{ terminou: false, processoVivo: true, minutos: 9, passo: '5/10' }, { terminou: true, processoVivo: false, minutos: 18, passo: '10/10' }],
  fim: { exitInstalar: 0, commitInstancia: COMMIT, linhaBackupNoLog: true, permissoes600: true, segredosNaConta: 8, vazamentos: 0, senhaGeradaNoLog: 0 },
  ver: { httpSaude: 200, degradado: false, versaoNoAr: 'v0.4.2', commitNoAr: COMMIT, httpLogin: 200, orgSlug: 'campo-bom', modulos: 11, adminCriado: 1, containersUp: 5, portasEm127: 6, portasFora127: 0, backupOk: true, dumpIntegro: true, restauracaoOk: true, segredosIniciais600: true, crontabGravado: false, pmsetAgendado: false },
}
const fase = (dados, estado = 'verde', pedido = '') => ({ estado, resumo: 'r', evidencias: [], pedidoAoOperador: pedido, pendencias: [], naoProvado: [], dados })

async function cenario(nome, args, mud, espera) {
  const c = JSON.parse(JSON.stringify(base)); mud(c)
  const chamadas = []; let iEspera = 0; const prompts = {}
  const agent = async (prompt, o) => {
    chamadas.push(o.label); prompts[o.label] = prompt
    if (o.label === 'Inventário') return c.invAgente === null ? null : fase(c.inv, c.invEstado || 'verde', c.invPedido || '')
    if (o.label === 'Pré-requisitos') return fase(c.pre)
    if (o.label === 'Instalação · preparo') return c.prepAgente === null ? null : fase(c.prep, c.prepEstado || 'verde', c.prepPedido || '')
    if (o.label.startsWith('Instalação · espera')) { const e = c.esperas[Math.min(iEspera++, c.esperas.length - 1)]; return fase(e) }
    if (o.label === 'Instalação · fim') return fase(c.fim)
    if (o.label === 'Verificação') return fase(c.ver)
    if (o.label === 'Relatório') return { caminho: '/k/retorno/R.md', linhas: 10, segredoNoRelatorio: 0, resumo: 'ok' }
    throw new Error('label ' + o.label)
  }
  const r = await run(args, agent, () => {}, () => {})
  const falhas = []
  for (const [k, v] of Object.entries(espera)) {
    const got = k === 'chamadas' ? chamadas.length : k === 'temAgente' ? v.every(l => chamadas.some(x => x.startsWith(l))) : k === 'semAgente' ? v.every(l => !chamadas.some(x => x.startsWith(l))) : k === 'prompt' ? v.every(([l, t]) => (prompts[l] || '').includes(t)) : k === 'pedidoContem' ? v.every(t => (r.pedidoAoOperador || '').includes(t)) : r[k]
    const ok = (k === 'temAgente' || k === 'semAgente' || k === 'prompt' || k === 'pedidoContem') ? got === true : JSON.stringify(got) === JSON.stringify(v)
    if (!ok) falhas.push(`${k}: esperado ${JSON.stringify(v)}, veio ${JSON.stringify(got)}`)
  }
  if (!chamadas.includes('Relatório')) falhas.push('Relatório não rodou')
  console.log(`${falhas.length ? 'FALHA' : 'ok   '} ${nome}${falhas.length ? ' — ' + falhas.join(' | ') : ''}`)
  return falhas.length === 0
}

const A = { adminEmail: 'admin@campobom.example', okProgramas: true }
const T = []
T.push(await cenario('verde completo: 2 rodadas de espera', A, () => {}, { estadoGeral: 'verde', parouEm: null, chamadas: 8 }))
T.push(await cenario('inventário: rede com 1 falha → vermelho', A, c => { c.inv.redeFalhas = ['binaries.prisma.sh exit 60'] }, { estadoGeral: 'vermelho', parouEm: 'Inventário', chamadas: 2 }))
T.push(await cenario('inventário: agente diz verde com 12 endereços → vermelho', A, c => { c.inv.redeTestados = 12 }, { estadoGeral: 'vermelho', parouEm: 'Inventário' }))
T.push(await cenario('inventário: proxy ligado → vermelho', A, c => { c.inv.proxyAtivo = 1 }, { estadoGeral: 'vermelho', parouEm: 'Inventário' }))
T.push(await cenario('inventário: contato da Root ausente (item 1b) → vermelho, relatório cita o contato da Root', A, c => { c.inv.contatoPreenchido = false }, { estadoGeral: 'vermelho', parouEm: 'Inventário', prompt: [['Inventário', 'Contato na Root'], ['Relatório', 'contato da Root']] }))
T.push(await cenario('pré-req: prompt do google.env diz gerenciador de senhas e nunca no chat', A, () => {}, { estadoGeral: 'verde', prompt: [['Pré-requisitos', 'gerenciador de senhas'], ['Pré-requisitos', 'nunca peça, aceite ou repita os valores no chat']] }))
T.push(await cenario('inventário: retorno/ sem escrita → vermelho', A, c => { c.inv.kitGravavel = false }, { estadoGeral: 'vermelho', parouEm: 'Inventário' }))
T.push(await cenario('inventário: porta de outro programa → vermelho', A, c => { c.inv.portasOcupadas = ['4000 node'] }, { estadoGeral: 'vermelho', parouEm: 'Inventário' }))
T.push(await cenario('inventário: agente morto → vermelho', A, c => { c.invAgente = null }, { estadoGeral: 'vermelho', parouEm: 'Inventário', chamadas: 2 }))
T.push(await cenario('retomar: em_andamento → sem disparar, espera e fecha verde', A, c => { c.inv.estadoInstalacao = 'em_andamento'; c.inv.instanciaExiste = true; c.pre.googleEnvOk = false }, { estadoGeral: 'verde', estadoInstalacao: 'em_andamento', prompt: [['Instalação · preparo', 'SEM rodar o --so-checar']] }))
T.push(await cenario('retomar: concluida_ok → sem espera, confere fim e verifica', A, c => { c.inv.estadoInstalacao = 'concluida_ok'; c.inv.instanciaExiste = true; c.pre.googleEnvOk = false; c.inv.energiaAC = false }, { estadoGeral: 'verde', chamadas: 6, semAgente: ['Instalação · espera'], temAgente: ['Instalação · fim', 'Verificação'] }))
T.push(await cenario('retomar: concluida_falha sem OK → aguardando recomeçar', A, c => { c.inv.estadoInstalacao = 'concluida_falha'; c.inv.instanciaExiste = true }, { estadoGeral: 'aguardando_operador', parouEm: 'Instalação', chamadas: 2 }))
T.push(await cenario('retomar: interrompida com okRecomecar → item 0 e instala', { ...A, okRecomecar: true }, c => { c.inv.estadoInstalacao = 'interrompida'; c.inv.instanciaExiste = true; c.prep.recomecoFeito = true }, { estadoGeral: 'verde', prompt: [['Instalação · preparo', 'item 0 (recomeçar']] }))
T.push(await cenario('retomar: okRecomecar mas containers antigos → vermelho', { ...A, okRecomecar: true }, c => { c.inv.estadoInstalacao = 'interrompida'; c.inv.instanciaExiste = true; c.prep.recomecoFeito = false; c.prep.containersAntigos = 3 }, { estadoGeral: 'vermelho', parouEm: 'Instalação', semAgente: ['Instalação · espera'] }))
T.push(await cenario('segunda falha (1 tentativa guardada) → vermelho mesmo com OK', { ...A, okRecomecar: true }, c => { c.inv.estadoInstalacao = 'concluida_falha'; c.inv.instanciaExiste = true; c.inv.tentativasGuardadas = 1 }, { estadoGeral: 'vermelho', parouEm: 'Instalação', chamadas: 2 }))
T.push(await cenario('bateria → aguardando tomada antes de disparar', A, c => { c.inv.energiaAC = false }, { estadoGeral: 'aguardando_operador', parouEm: 'Instalação', semAgente: ['Instalação · preparo'] }))
T.push(await cenario('processo morreu sem .exit → vermelho interrompida', A, c => { c.esperas = [{ terminou: false, processoVivo: false, minutos: 30, passo: '5/10' }] }, { estadoGeral: 'vermelho', parouEm: 'Instalação', semAgente: ['Instalação · fim'] }))
T.push(await cenario('passou de 180 min → aguardando, retomável', A, c => { c.esperas = [{ terminou: false, processoVivo: true, minutos: 181, passo: '5/10' }] }, { estadoGeral: 'aguardando_operador', parouEm: 'Instalação', semAgente: ['Instalação · fim'] }))
T.push(await cenario('60 rodadas curtas sem terminar → aguardando', A, c => { c.esperas = [{ terminou: false, processoVivo: true, minutos: 1, passo: '5/10' }] }, { estadoGeral: 'aguardando_operador', chamadas: 64 }))
T.push(await cenario('fim: segredo no log → vermelho', A, c => { c.fim.vazamentos = 1 }, { estadoGeral: 'vermelho', parouEm: 'Instalação', semAgente: ['Verificação'] }))
T.push(await cenario('fim: commit da instância errado → vermelho', A, c => { c.fim.commitInstancia = '7f8a762cda94cb4fa1e299bfab506a6b217469e9' }, { estadoGeral: 'vermelho', parouEm: 'Instalação' }))
T.push(await cenario('preparo: so-checar exit 1 → vermelho', A, c => { c.prep.exitChecar = 1; c.prep.disparado = false }, { estadoGeral: 'vermelho', semAgente: ['Instalação · espera'] }))
T.push(await cenario('preparo: aguardando sem pedido → vermelho', A, c => { c.prepEstado = 'aguardando_operador' }, { estadoGeral: 'vermelho' }))
T.push(await cenario('sem adminEmail → aguardando sem agente de instalação', { okProgramas: true }, () => {}, { estadoGeral: 'aguardando_operador', semAgente: ['Instalação · preparo'] }))
T.push(await cenario('e-mail inválido → aguardando', { adminEmail: 'x@y', okProgramas: true }, () => {}, { estadoGeral: 'aguardando_operador', semAgente: ['Instalação · preparo'] }))
T.push(await cenario('args ausente → aguardando e-mail', undefined, () => {}, { estadoGeral: 'aguardando_operador' }))
T.push(await cenario('pré-req: google.env faltando com disparo → vermelho', A, c => { c.pre.googleEnvOk = false }, { estadoGeral: 'vermelho', parouEm: 'Pré-requisitos' }))
T.push(await cenario('pré-req: contrato ~/RootOS diferente → vermelho', A, c => { c.pre.contratoRootOS = false }, { estadoGeral: 'vermelho', parouEm: 'Pré-requisitos' }))
T.push(await cenario('verificar: concluida_ok → preparo só leitura, verde', { ...A, modo: 'verificar' }, c => { c.inv.estadoInstalacao = 'concluida_ok'; c.inv.instanciaExiste = true; c.pre.googleEnvOk = false }, { estadoGeral: 'verde', semAgente: ['Instalação · espera'], temAgente: ['Instalação · fim'], prompt: [['Instalação · preparo', 'SEM rodar o --so-checar']] }))
T.push(await cenario('verificar: em_andamento → aguardando', { ...A, modo: 'verificar' }, c => { c.inv.estadoInstalacao = 'em_andamento'; c.inv.instanciaExiste = true }, { estadoGeral: 'aguardando_operador' }))
T.push(await cenario('verificar: sem instância → vermelho', { ...A, modo: 'verificar' }, () => {}, { estadoGeral: 'vermelho', parouEm: 'Inventário' }))
T.push(await cenario('verificação: porta fora de 127 → vermelho', A, c => { c.ver.portasFora127 = 1 }, { estadoGeral: 'vermelho', parouEm: 'Verificação' }))
T.push(await cenario('verificação: commit no ar antigo → vermelho', A, c => { c.ver.commitNoAr = '7f8a762cda94cb4fa1e299bfab506a6b217469e9' }, { estadoGeral: 'vermelho', parouEm: 'Verificação' }))
T.push(await cenario('verificação: distribuição anterior fff7fb9 no ar → vermelho', A, c => { c.ver.commitNoAr = 'fff7fb9e1da12c382d0b847fce46d12972a37d87' }, { estadoGeral: 'vermelho', parouEm: 'Verificação' }))
T.push(await cenario('verificação: distribuição anterior 3397140 no ar → vermelho', A, c => { c.ver.commitNoAr = '3397140941264725e906334348fe6abe2f6d90ad' }, { estadoGeral: 'vermelho', parouEm: 'Verificação' }))
T.push(await cenario('pré-req: docker buildx ausente → vermelho antes de instalar', A, c => { c.pre.buildxOk = false }, { estadoGeral: 'vermelho', parouEm: 'Pré-requisitos', semAgente: ['Instalação · preparo'] }))
T.push(await cenario('pré-req: prompt cita docker-buildx', A, () => {}, { estadoGeral: 'verde', prompt: [['Pré-requisitos', 'docker-buildx']] }))
T.push(await cenario('fim: "senha gerada" no log → vermelho, prompts do fim e do relatório tiram a linha', A, c => { c.fim.senhaGeradaNoLog = 1 }, { estadoGeral: 'vermelho', parouEm: 'Instalação', semAgente: ['Verificação'], prompt: [['Instalação · fim', "senhaGeradaNoLog"], ['Relatório', "grep -v 'senha gerada'"]] }))
T.push(await cenario('espera: passou de 180 min → pedido de retomada leva o e-mail do admin', A, c => { c.esperas = [{ terminou: false, processoVivo: true, minutos: 181, passo: '5/10' }] }, { estadoGeral: 'aguardando_operador', pedidoContem: ['com o e-mail do admin admin@campobom.example'] }))
T.push(await cenario('retomar: em_andamento sem adminEmail, 180 min → pedido pede o e-mail', { okProgramas: true }, c => { c.inv.estadoInstalacao = 'em_andamento'; c.inv.instanciaExiste = true; c.pre.googleEnvOk = false; c.esperas = [{ terminou: false, processoVivo: true, minutos: 181, passo: '5/10' }] }, { estadoGeral: 'aguardando_operador', pedidoContem: ['com o e-mail do admin <e-mail do administrador>'] }))
T.push(await cenario('retomar: concluida_ok sem adminEmail → aguardando o e-mail, sem agente da Verificação', { okProgramas: true }, c => { c.inv.estadoInstalacao = 'concluida_ok'; c.inv.instanciaExiste = true; c.pre.googleEnvOk = false }, { estadoGeral: 'aguardando_operador', parouEm: 'Verificação', semAgente: ['Verificação'], temAgente: ['Instalação · fim'], pedidoContem: ['com o e-mail do admin'] }))
T.push(await cenario('verificar: sem adminEmail → aguardando o e-mail', { modo: 'verificar' }, c => { c.inv.estadoInstalacao = 'concluida_ok'; c.inv.instanciaExiste = true; c.pre.googleEnvOk = false }, { estadoGeral: 'aguardando_operador', parouEm: 'Verificação', semAgente: ['Verificação'] }))
T.push(await cenario('espera: prompt diz que o caffeinate pede OK e que nada vem depois do -w', A, () => {}, { estadoGeral: 'verde', prompt: [['Instalação · espera 1', 'pede OK da pessoa'], ['Instalação · espera 1', 'nada é escrito depois do -w <pid>']] }))
const ok = T.filter(Boolean).length
console.log(`${ok}/${T.length} cenários`)
process.exit(ok === T.length ? 0 : 1)
