/**
 * Mapa das Juntas Comerciais por UF — fonte PRIMÁRIA e oficial do capital social
 * (e de sócios/participações), com fé pública via certidão simplificada.
 *
 * Por que isto é só um link (e não uma API):
 *   Não há API pública gratuita das Juntas por CNPJ. A certidão simplificada é
 *   documento autenticado (gov.br), normalmente pago, com CAPTCHA e específico
 *   de cada estado. Então o caminho viável é levar o usuário, em 1 clique, à
 *   Junta correta do estado da empresa para emitir a certidão.
 *
 *   Obs.: o capital social que o app já exibe vem da Receita, que recebe o valor
 *   ARQUIVADO na Junta via REDESIM — a certidão simplificada é a prova vigente.
 *
 * URLs apontam para a página de certidão/serviços quando confirmada; senão, para
 * a home oficial da Junta (ponto de entrada). Podem mudar com o tempo.
 */

(function () {
  "use strict";

  const JUNTAS = {
    AC: { sigla: "JUCEAC", nome: "Junta Comercial do Acre", url: "https://www.juceac.ac.gov.br/" },
    AL: { sigla: "JUCEAL", nome: "Junta Comercial de Alagoas", url: "https://www.juceal.al.gov.br/" },
    AP: { sigla: "JUCAP", nome: "Junta Comercial do Amapá", url: "https://juceap.ap.gov.br/" },
    AM: { sigla: "JUCEA", nome: "Junta Comercial do Amazonas", url: "http://www.jucea.am.gov.br/" },
    BA: { sigla: "JUCEB", nome: "Junta Comercial da Bahia", url: "http://www.juceb.ba.gov.br/" },
    CE: { sigla: "JUCEC", nome: "Junta Comercial do Ceará", url: "https://www.jucec.ce.gov.br/" },
    DF: { sigla: "JCDF", nome: "Junta Comercial do Distrito Federal", url: "https://www.jc.df.gov.br/" },
    ES: { sigla: "JUCEES", nome: "Junta Comercial do Espírito Santo", url: "https://www.simplifica.es.gov.br/acoes/certidao" },
    GO: { sigla: "JUCEG", nome: "Junta Comercial de Goiás", url: "https://www.juceg.go.gov.br/" },
    MA: { sigla: "JUCEMA", nome: "Junta Comercial do Maranhão", url: "https://www.jucema.ma.gov.br/" },
    MT: { sigla: "JUCEMAT", nome: "Junta Comercial de Mato Grosso", url: "https://www.jucemat.mt.gov.br/" },
    MS: { sigla: "JUCEMS", nome: "Junta Comercial de Mato Grosso do Sul", url: "https://www.jucems.ms.gov.br/" },
    MG: { sigla: "JUCEMG", nome: "Junta Comercial de Minas Gerais", url: "https://jucemg.mg.gov.br/" },
    PA: { sigla: "JUCEPA", nome: "Junta Comercial do Pará", url: "https://www.jucepa.pa.gov.br/" },
    PB: { sigla: "JUCEP", nome: "Junta Comercial da Paraíba", url: "https://www.jucep.pb.gov.br/" },
    PR: { sigla: "JUCEPAR", nome: "Junta Comercial do Paraná", url: "https://www.juntacomercial.pr.gov.br/" },
    PE: { sigla: "JUCEPE", nome: "Junta Comercial de Pernambuco", url: "http://www.jucepe.pe.gov.br/" },
    PI: { sigla: "JUCEPI", nome: "Junta Comercial do Piauí", url: "https://www.jucepi.pi.gov.br/" },
    RJ: { sigla: "JUCERJA", nome: "Junta Comercial do Rio de Janeiro", url: "https://www.jucerja.rj.gov.br/" },
    RN: { sigla: "JUCERN", nome: "Junta Comercial do Rio Grande do Norte", url: "http://www.jucern.rn.gov.br/" },
    RS: { sigla: "JUCISRS", nome: "Junta Comercial do Rio Grande do Sul", url: "https://jucisrs.rs.gov.br/emissao-de-certidao-online" },
    RO: { sigla: "JUCER", nome: "Junta Comercial de Rondônia", url: "https://www.jucer.ro.gov.br/" },
    RR: { sigla: "JUCERR", nome: "Junta Comercial de Roraima", url: "http://www.juntacomercial.rr.gov.br/" },
    SC: { sigla: "JUCESC", nome: "Junta Comercial de Santa Catarina", url: "https://www.jucesc.sc.gov.br/" },
    SP: { sigla: "JUCESP", nome: "Junta Comercial de São Paulo", url: "https://www.jucesponline.sp.gov.br/" },
    SE: { sigla: "JUCESE", nome: "Junta Comercial de Sergipe", url: "https://www.jucese.se.gov.br/" },
    TO: { sigla: "JUCETINS", nome: "Junta Comercial do Tocantins", url: "https://juceto.to.gov.br/" },
  };

  function porUF(uf) {
    return JUNTAS[String(uf || "").trim().toUpperCase()] || null;
  }

  window.JUNTAS = { porUF, MAPA: JUNTAS };
})();
