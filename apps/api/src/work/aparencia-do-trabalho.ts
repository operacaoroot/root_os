import { aparenciaDoTrabalho, type CorDoTrabalho } from '@mktos/shared';

/*
 * ÍCONE E COR DA LISTA E DA PASTA (produção 22B, I1, 22/10/2026). O que vale é do
 * `shared` (`aparencia-do-trabalho.ts`), e o schema do PATCH já confere; aqui só
 * mora o que o serviço faz com isso: devolver na estrutura e montar a escrita e a
 * trilha da auditoria (a mesma linha `work.list.update`/`work.folder.update` da
 * renomeação, com o antes e o depois só do que mudou).
 */

/** Como a estrutura devolve: o gravado que ainda vale, ou nulo. */
export function aparenciaDoNo(r: { icone: string | null; cor: string | null }): { icone: string | null; cor: CorDoTrabalho | null } {
  return aparenciaDoTrabalho(r);
}

type Aparencia = { icone?: string | null; cor?: string | null };

/**
 * O que o PATCH muda: `undefined` não mexe, `null` apaga, texto grava. `muda` só é
 * verdade quando o valor é outro (mandar o mesmo ícone não gera linha de auditoria).
 */
export function mudancaDeAparencia(antes: { icone: string | null; cor: string | null }, input: Aparencia): {
  data: Aparencia; before: Aparencia; after: Aparencia; muda: boolean;
} {
  const data: Aparencia = {};
  const before: Aparencia = {};
  const after: Aparencia = {};
  for (const chave of ['icone', 'cor'] as const) {
    const novo = input[chave];
    if (novo === undefined || (novo ?? null) === (antes[chave] ?? null)) continue;
    data[chave] = novo;
    before[chave] = antes[chave] ?? null;
    after[chave] = novo;
  }
  return { data, before, after, muda: Object.keys(data).length > 0 };
}
