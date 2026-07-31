import type { Metadata } from 'next';
import { TextoLegal } from '@/components/TextoLegal';

export const metadata: Metadata = {
  title: 'Termos de Uso · Root Bio',
  robots: { index: true, follow: true },
};

export default function Termos() {
  return (
    <TextoLegal titulo="Termos de Uso" atualizadoEm="31 de julho de 2026">
      <h2>O que é o serviço</h2>
      <p>
        O Root Bio hospeda uma página pública de links no endereço que você escolher, mede o
        desempenho dessa página e, opcionalmente, exibe um contador de publicações de perfis que
        você conectar.
      </p>

      <h2>Sua conta</h2>
      <p>
        O acesso ao painel é feito com a sua conta da plataforma da Operação Root, protegida por
        senha. Você é responsável por manter essa credencial em segurança e pelo conteúdo que
        publica.
      </p>

      <h2>O que não é permitido</h2>
      <ul>
        <li>Se passar por outra pessoa, marca ou organização</li>
        <li>Distribuir malware, phishing ou golpe</li>
        <li>Conteúdo ilegal, que incite violência ou viole direito de terceiro</li>
        <li>Inflar artificialmente métricas ou contadores</li>
        <li>Automatizar acesso de forma a degradar o serviço</li>
      </ul>
      <p>
        Podemos suspender ou remover páginas que violem estes termos, sem aviso prévio quando houver
        risco a terceiros.
      </p>

      <h2>Contas conectadas</h2>
      <p>
        Ao conectar Instagram ou TikTok você autoriza a leitura das informações necessárias para
        contar publicações, conforme as permissões exibidas na tela da própria plataforma. Você pode
        desconectar a qualquer momento pelo painel, e também revogar o acesso nas configurações da
        plataforma. O uso dessas integrações também está sujeito aos termos da Meta e do TikTok.
      </p>

      <h2>Dados dos seus visitantes</h2>
      <p>
        Sobre quem visita a sua página, você é o controlador dos dados e nós operamos por sua conta.
        Se você ativar ferramentas de publicidade de terceiros, cabe a você ter base legal para isso
        e informar seus visitantes.
      </p>

      <h2>Disponibilidade e limites</h2>
      <p>
        O serviço é oferecido no estado em que se encontra, sem garantia de disponibilidade
        ininterrupta. Integrações dependem de APIs de terceiros que podem mudar ou sair do ar sem
        aviso. Não respondemos por lucros cessantes decorrentes de indisponibilidade.
      </p>

      <h2>Encerramento</h2>
      <p>
        Você pode encerrar quando quiser. Apagar o perfil remove página, links, desafio, conexões e
        histórico. A operação é irreversível.
      </p>

      <h2>Foro e contato</h2>
      <p>
        Aplica-se a lei brasileira. Dúvidas:{' '}
        <a href="mailto:contato@operacaoroot.com">contato@operacaoroot.com</a>.
      </p>
    </TextoLegal>
  );
}
