/*
 * O texto da política de privacidade do totem, com o Sr. aGranel como
 * controlador e a Root como operadora. Arquivo da frente D
 * (docs/totem/CONTRATO.md, seção 9).
 *
 * O texto é um só, aqui, e serve às duas pontas: a API o preenche com a
 * `TotemConfig` da empresa (`GET /api/totem-cadastro/politica`) e a página
 * `/totem/privacidade` o monta sem dados quando está sem rede, com os campos
 * da empresa marcados "a confirmar".
 */

/**
 * A versão vigente da política. Vai para `TotemConfig.politicaVersao` e para
 * cada `TotemConsentimento`: trocar o texto exige trocar a versão, senão o
 * consentimento gravado deixa de dizer a que texto a pessoa disse sim.
 */
export const TOTEM_POLITICA_VERSAO = '2026-10-11';

/** O que aparece no lugar de um dado da empresa que ainda não foi preenchido. */
export const TOTEM_POLITICA_A_CONFIRMAR = '(a confirmar)';

export const TOTEM_POLITICA_OPERADOR = 'Root';

/** Usado só quando a página está sem rede e não sabe o nome gravado na configuração. */
export const TOTEM_POLITICA_CONTROLADOR_PADRAO = 'Sr. aGranel';

export interface TotemPoliticaDados {
  controladorNome?: string | null;
  controladorDocumento?: string | null;
  controladorEndereco?: string | null;
  encarregadoNome?: string | null;
  encarregadoContato?: string | null;
}

export interface TotemPoliticaSecao {
  titulo: string;
  paragrafos: string[];
}

export interface TotemPolitica {
  versao: string;
  /** DD/MM/AAAA. */
  publicadaEm: string;
  titulo: string;
  abertura: string;
  controlador: string;
  operador: string;
  secoes: TotemPoliticaSecao[];
  /** Os dados da empresa que faltam no texto, para o painel cobrar. */
  camposAConfirmar: string[];
}

function dataDaVersao(versao: string): string {
  const [ano, mes, dia] = versao.split('-');
  return `${dia}/${mes}/${ano}`;
}

export function totemMontarPolitica(dados: TotemPoliticaDados = {}): TotemPolitica {
  const faltando: string[] = [];
  const campo = (valor: string | null | undefined, rotulo: string) => {
    const v = valor?.trim();
    if (v) return v;
    faltando.push(rotulo);
    return TOTEM_POLITICA_A_CONFIRMAR;
  };

  const controlador = dados.controladorNome?.trim() || TOTEM_POLITICA_CONTROLADOR_PADRAO;
  const documento = campo(dados.controladorDocumento, 'CNPJ do controlador');
  const endereco = campo(dados.controladorEndereco, 'endereço do controlador');
  const encarregado = campo(dados.encarregadoNome, 'nome do encarregado de dados');
  const contato = campo(dados.encarregadoContato, 'contato do encarregado de dados');
  const operador = TOTEM_POLITICA_OPERADOR;

  const secoes: TotemPoliticaSecao[] = [
    {
      titulo: 'Quem cuida dos seus dados',
      paragrafos: [
        `O controlador dos dados é ${controlador}, CNPJ ${documento}, com sede em ${endereco}. É ele quem decide para que os dados servem e quem responde por eles.`,
        `A ${operador} é a operadora: mantém o totem, o cadastro e o servidor onde os dados ficam, e só trata esses dados por ordem de ${controlador}, sem usá-los para nenhum fim próprio.`,
      ],
    },
    {
      titulo: 'Que dados são coletados',
      paragrafos: [
        'O cadastro pede o CPF e o número do celular. No cadastro feito pelo celular, a partir do QR da etiqueta, você também pode informar o nome, mas ele é opcional.',
        'Junto com o cadastro ficam registrados a loja, o totem ou a etiqueta de onde ele partiu, a data e a hora, a versão desta política que você aceitou e a sua escolha sobre receber campanhas.',
        'Consultar produtos, preços, lotes e validades no totem não exige identificação. As buscas feitas ali são contadas sem nenhum dado de quem buscou.',
      ],
    },
    {
      titulo: 'Para que os dados servem',
      paragrafos: [
        'O cadastro serve para emitir o cupom da campanha em vigor na loja e para o caixa conferir se o cupom ainda vale.',
        'O CPF é pedido porque cada campanha dá um cupom por pessoa, e é ele que impede o mesmo CPF de receber dois cupons da mesma campanha.',
        'O celular recebe campanhas e ofertas só se você marcar a caixa "Quero receber campanhas e ofertas". Sem essa marcação, o número fica guardado apenas como parte do cadastro do cupom e não recebe propaganda.',
      ],
    },
    {
      titulo: 'Base legal',
      paragrafos: [
        'O tratamento se apoia no seu consentimento, conforme o art. 7º, inciso I, da Lei 13.709/2018, a Lei Geral de Proteção de Dados (LGPD). Você dá esse consentimento ao marcar a caixa "Li e aceito a política de privacidade" antes de enviar o cadastro. Sem essa marcação, nada é gravado.',
        'A caixa de campanhas é um consentimento separado e pode ficar desmarcada. Quem não aceita a política fica sem o cupom, e a consulta de produtos no totem continua livre do mesmo jeito.',
      ],
    },
    {
      titulo: 'Com quem os dados são compartilhados',
      paragrafos: [
        `Os dados não são vendidos, alugados nem cedidos a ninguém. Além de ${controlador}, só a ${operador} tem acesso a eles, como operadora, para manter o sistema funcionando. A exceção é ordem judicial ou pedido de autoridade previsto em lei.`,
      ],
    },
    {
      titulo: 'Por quanto tempo os dados ficam guardados',
      paragrafos: [
        'Os dados ficam guardados enquanto o seu consentimento valer. Quando o cadastro passa 24 meses sem uso, sem cupom emitido nem usado, ele é anonimizado: o celular e o nome são apagados, e o código do CPF é trocado por outro, sorteado, que não leva a ninguém.',
        'Se você revogar o consentimento do cadastro, ele é anonimizado da mesma forma, e o histórico dos cupons continua guardado, sem ligação com você, para fechar a conta das campanhas. Se revogar só o consentimento de campanhas, o cadastro e os cupons continuam valendo, e o celular deixa de receber ofertas.',
      ],
    },
    {
      titulo: 'Como os dados são protegidos',
      paragrafos: [
        'O CPF em si não é guardado. O sistema grava um código calculado a partir dele com uma chave secreta, que reconhece o mesmo CPF num novo cadastro mas não permite voltar aos números. Na tela da loja aparecem só os seis dígitos do meio, como em ***.456.789-**, e o celular aparece com a maior parte escondida.',
        'Nada do cadastro fica salvo no totem. Os dados seguem direto para o servidor, por conexão criptografada, e saem da tela quando o cupom aparece ou quando o totem volta ao início.',
        'O painel em que a loja consulta os cadastros exige login, e cada pessoa da equipe vê só o que a função dela permite.',
      ],
    },
    {
      titulo: 'Seus direitos',
      paragrafos: [
        'O art. 18 da LGPD garante a você: confirmar se os seus dados são tratados e ter acesso a eles; corrigir dados incompletos, errados ou desatualizados; pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários ou tratados fora da lei; pedir a portabilidade dos dados; pedir a eliminação dos dados tratados com o seu consentimento; saber com quem eles foram compartilhados; saber que pode negar o consentimento e o que acontece se negar; e revogar o consentimento quando quiser, inclusive só o de campanhas.',
        `Para fazer qualquer um desses pedidos, fale com o encarregado de dados de ${controlador}, ${encarregado}, pelo contato ${contato}. Informe o CPF do cadastro, porque o sistema só encontra o cadastro calculando de novo o código a partir dele.`,
        'Se o pedido não for atendido, você pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).',
      ],
    },
    {
      titulo: 'Versão desta política',
      paragrafos: [
        `Versão ${TOTEM_POLITICA_VERSAO}, publicada em ${dataDaVersao(TOTEM_POLITICA_VERSAO)}. Quando o texto mudar, a versão muda junto, e o cadastro seguinte pede um novo aceite.`,
      ],
    },
  ];

  return {
    versao: TOTEM_POLITICA_VERSAO,
    publicadaEm: dataDaVersao(TOTEM_POLITICA_VERSAO),
    titulo: 'Política de privacidade do cadastro no totem',
    abertura: `O cadastro no totem pede o CPF e o celular para emitir um cupom de desconto. Quem guarda esses dados é ${controlador}, com a ${operador} cuidando da tecnologia, e você pode pedir a qualquer momento que eles sejam apagados.`,
    controlador,
    operador,
    secoes,
    camposAConfirmar: faltando,
  };
}
