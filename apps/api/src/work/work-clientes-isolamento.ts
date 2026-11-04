type No = { id: string; parentId: string | null; clienteId: string | null };

/** Só expõe uma tarefa se todos os ancestrais existem e pertencem ao mesmo cliente. */
export function idsDeTarefasCoerentes(rows: readonly No[], clientes: ReadonlySet<string>): string[] {
  const nos = new Map(rows.map(row => [row.id, row]));
  const resultado = new Map<string, boolean>();
  const valida = (inicio: No): boolean => {
    const caminho: No[] = [];
    const visitados = new Set<string>();
    let no: No | undefined = inicio;
    let valido = false;
    while (no) {
      if (!no.clienteId || !clientes.has(no.clienteId) || no.clienteId !== inicio.clienteId || visitados.has(no.id)) break;
      if (resultado.has(no.id)) { valido = resultado.get(no.id)!; break; }
      visitados.add(no.id);
      caminho.push(no);
      if (!no.parentId) { valido = true; break; }
      no = nos.get(no.parentId);
    }
    for (const item of caminho) resultado.set(item.id, valido);
    return valido;
  };
  return rows.filter(valida).map(row => row.id);
}

export function capacidadesDaCarteira(entrada: {
  podeEditar: boolean; tarefaViva: boolean; listaVisivel: boolean; temStatus: boolean;
  comercial: boolean; implantacao: boolean;
}): { podeCriar: boolean; podeCriarSubtarefa: boolean; podeEditar: boolean } {
  const podeEditar = entrada.podeEditar && entrada.tarefaViva;
  const criar = podeEditar && entrada.listaVisivel && entrada.temStatus && !entrada.comercial;
  return { podeCriar: criar && !entrada.implantacao, podeCriarSubtarefa: criar, podeEditar };
}
