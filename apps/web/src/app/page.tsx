import { redirect } from 'next/navigation';

/**
 * A apresentação pública tem uma única origem; o acesso ao produto continua em /login.
 *
 * Na homologação (`NEXT_PUBLIC_RAIZ=login`, build arg do Dockerfile, passado
 * pelo compose da homologação) a raiz abre o login: quem testa pelo endereço
 * da máquina não deve cair no site. Em produção a variável fica vazia e nada
 * muda. É `NEXT_PUBLIC_` porque o valor é fixado no `next build`.
 */
export default function Home() {
  if (process.env.NEXT_PUBLIC_RAIZ === 'login') redirect('/login');
  redirect('https://operacaoroot.com');
}
