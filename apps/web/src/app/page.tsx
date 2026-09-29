import { redirect } from 'next/navigation';

/** A apresentação pública tem uma única origem; o acesso ao produto continua em /login. */
export default function Home() {
  redirect('https://operacaoroot.com');
}
