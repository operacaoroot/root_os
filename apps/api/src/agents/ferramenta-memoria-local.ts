import { BadRequestException } from '@nestjs/common';

/** Busca literal na única versão já autorizada. Não normaliza o conteúdo. */
export function buscarLiteralNaVersao(body: string, q: string, limit: number) {
  if (Buffer.byteLength(body, 'utf8') > 262144) throw new BadRequestException('A fonte ultrapassa 256 KiB.');
  for (const texto of [body, q]) {
    for (let i = 0; i < texto.length; i++) {
      const c = texto.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = texto.charCodeAt(++i);
        if (!(d >= 0xdc00 && d <= 0xdfff)) throw new BadRequestException('O texto contém Unicode inválido.');
      } else if (c >= 0xdc00 && c <= 0xdfff) throw new BadRequestException('O texto contém Unicode inválido.');
    }
  }
  const tamanhoConsulta = Array.from(q).length;
  if (tamanhoConsulta < 2 || tamanhoConsulta > 200 || /[\u0000\r\n]/u.test(q) || !Number.isInteger(limit) || limit < 1 || limit > 10)
    throw new BadRequestException('Consulta literal inválida.');
  const correspondencias: Array<{ linha: number; trecho: string; corteInicio: boolean; corteFim: boolean }> = [];
  let totalLinhasComCorrespondencia = 0;
  const linhas = body.split('\n');
  for (let i = 0; i < linhas.length; i++) {
    const posicao = linhas[i].indexOf(q);
    if (posicao === -1) continue;
    totalLinhasComCorrespondencia++;
    if (correspondencias.length === limit) continue;
    const pontos = Array.from(linhas[i]);
    const inicioConsulta = Array.from(linhas[i].slice(0, posicao)).length;
    const inicio = Math.max(0, inicioConsulta - 50);
    const fim = Math.min(pontos.length, inicioConsulta + tamanhoConsulta + 50);
    correspondencias.push({ linha: i + 1, trecho: pontos.slice(inicio, fim).join(''), corteInicio: inicio > 0, corteFim: fim < pontos.length });
  }
  return { totalLinhasComCorrespondencia, parcial: totalLinhasComCorrespondencia > correspondencias.length, correspondencias };
}
