'use client';

import { iniciaisDoNome } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { useAvatares, useFoto } from '@/lib/avatares';

/*
 * O AVATAR DA PESSOA (produção 22B, I6).
 *
 * A foto, se houver; senão as iniciais no círculo. O nome vai no balão
 * (`title`) e no nome acessível (`aria-label`), então a pessoa continua
 * identificável por leitor de tela e por quem passa o mouse.
 *
 * Duas formas de usar:
 *   · `<AvatarDaPessoa nome="Alice" fotoUrl={p.fotoUrl} />` quando a tela já
 *     tem a rota da foto (a Equipe, o perfil);
 *   · `<AvatarDaPessoa pessoaId={t.responsavelId} nome={t.responsavelNome} />`
 *     em qualquer outra tela: o avatar acha a foto na lista da empresa
 *     (`GET /perfil/pessoas`, lida uma vez e partilhada). É o caminho para o
 *     "responsável só com a imagem" das telas de tarefa, funil e implantação.
 *
 * A imagem chega como URL de blob (rota autenticada) e é desenhada num `<img>`:
 * nada do arquivo roda; o servidor já mandou o tipo conferido com `nosniff`.
 */

const LADOS = { p: 20, m: 28, g: 40, gg: 96 } as const;
export type TamanhoDoAvatar = keyof typeof LADOS;

export function AvatarDaPessoa({
  nome,
  pessoaId,
  fotoUrl,
  tamanho = 'm',
  mostrarNome = false,
  rotulo,
  decorativo = false,
  className = '',
}: {
  nome: string;
  pessoaId?: string | null;
  /** A rota da foto (sem `/api`). `undefined` = procurar pela pessoa; `null` = sem foto. */
  fotoUrl?: string | null;
  tamanho?: TamanhoDoAvatar;
  /** Escreve o nome ao lado (onde o nome é a única informação da linha). */
  mostrarNome?: boolean;
  /** O texto do balão e do nome acessível, quando diz mais que o nome ("Ana (inativo)"). As iniciais saem sempre do `nome`. */
  rotulo?: string;
  /** Sem balão nem nome acessível: quem envolve o avatar já diz de quem é (a célula do Funil em lista tem balão próprio). */
  decorativo?: boolean;
  className?: string;
}) {
  const { token } = useAuth();
  const precisaDaLista = fotoUrl === undefined && !!pessoaId;
  const pessoas = useAvatares(precisaDaLista ? token : null);
  const rota = fotoUrl !== undefined ? fotoUrl : (pessoas?.find((p) => p.id === pessoaId)?.fotoUrl ?? null);
  const url = useFoto(rota, token);
  const lado = LADOS[tamanho];
  const iniciais = iniciaisDoNome(nome);
  const balao = rotulo ?? nome;
  const mudo = mostrarNome || decorativo;

  const circulo = (
    <span
      // Com o nome escrito ao lado, o círculo é decorativo (o leitor de tela não lê o nome duas vezes).
      role={mudo ? undefined : 'img'}
      aria-label={mudo ? undefined : balao}
      aria-hidden={mudo ? true : undefined}
      title={decorativo ? undefined : balao}
      data-testid="avatar-da-pessoa"
      data-com-foto={url ? 'sim' : 'nao'}
      style={{ width: lado, height: lado, fontSize: Math.max(9, Math.round(lado * 0.38)) }}
      className={`inline-grid flex-none select-none place-items-center overflow-hidden rounded-full border border-border bg-brand/10 font-os-mono font-medium leading-none text-brand ${mostrarNome ? '' : className}`}
    >
      {url ? (
        <img src={url} alt="" aria-hidden width={lado} height={lado} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span aria-hidden>{iniciais}</span>
      )}
    </span>
  );

  if (!mostrarNome) return circulo;
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      {circulo}
      <span className="min-w-0 truncate text-text">{nome}</span>
    </span>
  );
}
