import { describe, expect, it } from 'vitest';
import { comContexto } from '../src/common/contexto-execucao';
import { hashDoCorpo } from '../src/memory/procedencia';
import { blobDoGit } from '../src/obsidian/indice-do-git';
import { classificarAVault, type ArquivoNoDisco } from '../src/obsidian/pertenca-da-vault';
import { CatalogoDeColecaoService, prepararCapturaDoCatalogo, type MarcaDoCatalogo } from '../src/obsidian/catalogo-de-colecao.service';

const marca: MarcaDoCatalogo = { repositorioId: 'a'.repeat(64), head: 'b'.repeat(40), indiceHash: 'c'.repeat(64), indiceModificadoEm: 1 };
function capturar(arquivos: ArquivoNoDisco[], options: { tracked?: number[]; changedMark?: boolean; ilegivel?: boolean } = {}) {
  const indice = arquivos.filter((_, i) => !options.tracked || options.tracked.includes(i)).map((a) => ({
    caminho: a.caminho, blob: blobDoGit(a.bytes), modo: 0o100644, estagio: 0, skipWorktree: false, intentToAdd: false,
  }));
  const pertenca = classificarAVault({ arquivos, indice, naoVerificavel: null });
  return prepararCapturaDoCatalogo({ arquivos, indice, pertenca, marcaAntes: marca,
    marcaDepois: options.changedMark ? { ...marca, indiceHash: 'd'.repeat(64) } : marca, ilegiveis: options.ilegivel ? 1 : 0 });
}
const arquivo = (path: string, body = '# Regra\n\nConservar documento.'): ArquivoNoDisco => ({ caminho: Buffer.from(path), bytes: Buffer.from(body), modificadoEm: new Date(0) });

describe('catálogo de coleção: preparação de fixtures, sem banco nem fornecedor', () => {
  it('registra todos os membros e preserva bytes NFD enquanto usa chave NFC', () => {
    const path = 'Condição.md'.normalize('NFD');
    const captura = capturar([arquivo(path), arquivo('Outra.md')]);
    expect(captura?.membros).toHaveLength(2);
    const membro = captura?.membros.find((m) => m.chave === 'vault:Condição.md');
    expect(membro?.caminhoBytes.equals(Buffer.from(path))).toBe(true);
    expect(membro?.hashArquivo).toMatch(/^[a-f0-9]{64}$/);
  });
  it('digest é estável na ordem e muda mesmo com a mesma contagem', () => {
    const a = arquivo('A.md'), b = arquivo('B.md');
    expect(capturar([a, b])?.membershipDigest).toBe(capturar([b, a])?.membershipDigest);
    expect(capturar([a, b])?.membershipDigest).not.toBe(capturar([a, arquivo('C.md')])?.membershipDigest);
  });
  it('omite arquivo não rastreado e pastas reservadas', () => {
    const captura = capturar([arquivo('A.md'), arquivo('Solto.md'), arquivo('onboarding/Cliente.md')], { tracked: [0, 2] });
    expect(captura?.membros.map((m) => m.chave)).toEqual(['vault:A.md']);
  });
  it('recusa NFC ambíguo, captura com marca alterada ou leitura ilegível', () => {
    expect(capturar([arquivo('Condição.md'), arquivo('Condição.md'.normalize('NFD'))])).toBeNull();
    expect(capturar([arquivo('A.md')], { changedMark: true })).toBeNull();
    expect(capturar([arquivo('A.md')], { ilegivel: true })).toBeNull();
  });
});

// Fixtures de acesso ficam preparadas para a execução escolhida por Pedro.
describe('catálogo: resposta limitada ao snapshot autorizado', () => {
  const service = (rows: unknown[]) => {
    const body='Corpo sintético';
    const item={id:'item',orgId:'org',chave:'vault:a.md',versao:1,title:'A',kind:'nota',body,contentHash:hashDoCorpo(body),sourceType:'vault',sourceRef:'a.md',arquivadoEm:null};
    const versao={...item,id:'versao',itemId:'item'};
    const tx:any={
      $executeRawUnsafe:async()=>0,
      $queryRaw:async (partes:TemplateStringsArray)=>{
        const q=partes.join('?');
        if(q.includes('FROM "Org"'))return [{id:'org'}];
        if(q.includes('FROM "User"'))return [{id:'pessoa'}];
        if(q.includes('FROM "_UserRoles"'))return [{roleId:'papel'}];
        if(q.includes('FROM "Role"'))return [{id:'papel'}];
        if(q.includes('FROM "_RolePermissions"'))return [{permissionId:'permissao'}];
        if(q.includes('FROM "Permission"'))return [{id:'permissao',key:'obsidian.ver'}];
        if(q.includes('FROM "ContextItem"'))return [{id:'item'}];
        throw new Error('Consulta inesperada da fixture');
      },
      $queryRawUnsafe:async (sql:string)=>sql.includes('ContextMovementIntent')?[{pendente:false}]:rows,
      user:{findFirst:async()=>({roles:[{permissions:[{key:'obsidian.ver'}]}]})},
      contextItem:{findFirst:async()=>item},contextItemVersion:{findFirst:async()=>versao},
      contextMovementIntent:{findFirst:async()=>null},
    };
    const svc=new CatalogoDeColecaoService({$transaction:async(fn:any)=>fn(tx)} as never);
    return {porItem:(orgId:string,actorId:string,itemId:string)=>comContexto({orgId,actorType:'user',actorId,correlationId:'teste',origem:'http'},()=>svc.porItem(orgId,actorId,itemId))};
  };
  it('pessoa inativa ou sem permissão atual recebe 403', async () => {
    await expect(service([{ autorizado: false, itemId: null }]).porItem('org', 'pessoa', 'item')).rejects.toMatchObject({ status: 403 });
  });
  it('item oculto pela ACL ou de outra empresa recebe 404', async () => {
    await expect(service([{ autorizado: true, itemId: null }]).porItem('org', 'pessoa', 'item')).rejects.toMatchObject({ status: 404 });
  });
  it('falha mais recente aparece sem inventar pertencimento ou corpo', async () => {
    const ultima = { id: 'tentativa-falhou', geracao: '2', registradaEm: '2026-10-08T00:00:00Z', estado: 'falhou' };
    expect(await service([{ autorizado: true, itemId: 'item', selecao: null, ultima, interno: null }]).porItem('org', 'pessoa', 'item'))
      .toMatchObject({ escopo:{orgId:'org',actorId:'pessoa'}, itemId: 'item', capturaExternaAgora: false, movimentoDisponivel: false, selecaoVerificada: null, ultimaCaptura: ultima });
  });
});
