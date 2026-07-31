import type { Metadata } from 'next';
import { TextoLegal } from '@/components/TextoLegal';

export const metadata: Metadata = {
  title: 'Política de Privacidade · Root Bio',
  robots: { index: true, follow: true },
};

export default function Privacidade() {
  return (
    <TextoLegal titulo="Política de Privacidade" atualizadoEm="31 de julho de 2026">
      <h2>Quem somos</h2>
      <p>
        O Root Bio é operado pela Operação Root. Contato para assuntos de dados pessoais:{' '}
        <a href="mailto:contato@operacaoroot.com">contato@operacaoroot.com</a>.
      </p>

      <h2>De quem são os dados</h2>
      <p>
        Duas relações diferentes. Sobre <strong>quem cria uma página</strong> aqui, a Operação Root é
        controladora. Sobre <strong>quem visita a página de um usuário</strong>, o dono daquela
        página é o controlador e a Operação Root atua como operadora, tratando os dados conforme a
        finalidade definida por ele.
      </p>

      <h2>O que coletamos de quem tem conta</h2>
      <ul>
        <li>E-mail e nome, usados para identificar a conta na plataforma</li>
        <li>Conteúdo que você publica: nome da página, textos, links, imagens referenciadas</li>
        <li>Data do último acesso e registros técnicos de sessão</li>
        <li>
          Se você conectar Instagram ou TikTok: identificador da conta, nome de usuário e a lista de
          publicações dentro da janela do desafio (identificador, data e link). Não lemos mensagens
          diretas nem conteúdo privado.
        </li>
      </ul>

      <h2>O que coletamos de quem visita</h2>
      <ul>
        <li>
          Um identificador aleatório gravado em cookie próprio, para distinguir visitas repetidas
        </li>
        <li>Página acessada, data e hora, e qual botão foi clicado</li>
        <li>Origem do acesso: site de referência e parâmetros de campanha na URL</li>
        <li>Tipo de dispositivo, sistema e navegador, derivados do cabeçalho da requisição</li>
      </ul>
      <p>
        Não coletamos nome, telefone ou e-mail de visitantes, e não compramos nem cruzamos dados de
        terceiros para enriquecer esse perfil.
      </p>

      <h2>Por que tratamos</h2>
      <p>
        Dados de conta: para executar o contrato de uso do serviço. Dados de visita: legítimo
        interesse em medir o desempenho da própria página, limitado ao mínimo necessário e sem
        rastreamento entre sites de terceiros. Ferramentas de publicidade de terceiros, quando o dono
        da página as ativar, dependem de consentimento do visitante.
      </p>

      <h2>Com quem compartilhamos</h2>
      <p>
        Com a infraestrutura necessária para operar: servidor onde a aplicação roda e provedor de
        envio de e-mail. Se o dono de uma página ativar ferramentas de publicidade, os eventos
        daquela página são enviados às plataformas escolhidas por ele. Não vendemos dados.
      </p>

      <h2>Por quanto tempo</h2>
      <p>
        Dados de conta enquanto a conta existir. Registros de visita por até 24 meses, depois
        agregados sem identificador individual. Apagar o perfil remove página, links, desafio,
        conexões e histórico de visitas.
      </p>

      <h2>Seus direitos</h2>
      <p>
        A LGPD garante confirmação de tratamento, acesso, correção, anonimização, portabilidade,
        eliminação e revogação de consentimento. Escreva para{' '}
        <a href="mailto:contato@operacaoroot.com">contato@operacaoroot.com</a> e respondemos no prazo
        legal.
      </p>

      <h2>Segurança</h2>
      <p>
        Tráfego em HTTPS. Tokens de plataformas conectadas são guardados cifrados e nunca exibidos
        novamente. O acesso ao painel exige autenticação na plataforma da Operação Root.
      </p>
    </TextoLegal>
  );
}
