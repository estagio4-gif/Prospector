/**
 * Mapeamento CNAE → Setor + Perfil de risco tributário
 *
 * Estratégia de economia: usamos APENAS o primeiro dígito da Seção CNAE
 * (extraída do código de 7 dígitos via regra determinística).
 * Isso evita uma tabela gigante com milhares de CNAEs e mantém precisão
 * suficiente para classificação por setor.
 *
 * Tabela auxiliar para CNAEs específicos com perfil tributário particular
 * (ex: serviços profissionais sob Lucro Real, indústrias com substituição tributária).
 */

const CNAE_SECOES = {
  // Faixas de divisão CNAE → letra da seção (IBGE)
  A: { faixa: [[1, 3]], nome: "Agropecuária, pesca e silvicultura" },
  B: { faixa: [[5, 9]], nome: "Indústria extrativa" },
  C: { faixa: [[10, 33]], nome: "Indústria de transformação" },
  D: { faixa: [[35, 35]], nome: "Eletricidade e gás" },
  E: { faixa: [[36, 39]], nome: "Água, esgoto e resíduos" },
  F: { faixa: [[41, 43]], nome: "Construção" },
  G: { faixa: [[45, 47]], nome: "Comércio e reparação de veículos" },
  H: { faixa: [[49, 53]], nome: "Transporte, armazenagem e correio" },
  I: { faixa: [[55, 56]], nome: "Alojamento e alimentação" },
  J: { faixa: [[58, 63]], nome: "Informação e comunicação" },
  K: { faixa: [[64, 66]], nome: "Atividades financeiras e seguros" },
  L: { faixa: [[68, 68]], nome: "Atividades imobiliárias" },
  M: { faixa: [[69, 75]], nome: "Atividades profissionais, científicas e técnicas" },
  N: { faixa: [[77, 82]], nome: "Atividades administrativas e serviços complementares" },
  O: { faixa: [[84, 84]], nome: "Administração pública" },
  P: { faixa: [[85, 85]], nome: "Educação" },
  Q: { faixa: [[86, 88]], nome: "Saúde humana e serviços sociais" },
  R: { faixa: [[90, 93]], nome: "Artes, cultura, esporte e recreação" },
  S: { faixa: [[94, 96]], nome: "Outras atividades de serviços" },
  T: { faixa: [[97, 97]], nome: "Serviços domésticos" },
};

/**
 * Perfil tributário por seção. Drives:
 *  - foliaIntensiva: alta folha de pagamento → INSS sobre rubricas é forte
 *  - regimeProvavelLucroReal: faturamento típico do setor sugere Lucro Real
 *  - usaInsumos: aproveita créditos de PIS/COFINS sobre insumos
 *  - sujeitoST: substituição tributária do ICMS é comum no setor
 *  - exportador: empresas do setor frequentemente exportam
 */
const SETOR_PERFIL = {
  A: { foliaIntensiva: false, regimeProvavelLucroReal: false, usaInsumos: true,  sujeitoST: false, exportador: true  },
  B: { foliaIntensiva: true,  regimeProvavelLucroReal: true,  usaInsumos: true,  sujeitoST: false, exportador: true  },
  C: { foliaIntensiva: true,  regimeProvavelLucroReal: true,  usaInsumos: true,  sujeitoST: true,  exportador: true  },
  D: { foliaIntensiva: false, regimeProvavelLucroReal: true,  usaInsumos: false, sujeitoST: false, exportador: false },
  E: { foliaIntensiva: true,  regimeProvavelLucroReal: true,  usaInsumos: true,  sujeitoST: false, exportador: false },
  F: { foliaIntensiva: true,  regimeProvavelLucroReal: false, usaInsumos: true,  sujeitoST: false, exportador: false },
  G: { foliaIntensiva: true,  regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: true,  exportador: false },
  H: { foliaIntensiva: true,  regimeProvavelLucroReal: true,  usaInsumos: true,  sujeitoST: false, exportador: false },
  I: { foliaIntensiva: true,  regimeProvavelLucroReal: false, usaInsumos: true,  sujeitoST: true,  exportador: false },
  J: { foliaIntensiva: true,  regimeProvavelLucroReal: true,  usaInsumos: false, sujeitoST: false, exportador: false },
  K: { foliaIntensiva: true,  regimeProvavelLucroReal: true,  usaInsumos: false, sujeitoST: false, exportador: false },
  L: { foliaIntensiva: false, regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false },
  M: { foliaIntensiva: true,  regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false },
  N: { foliaIntensiva: true,  regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false },
  O: { foliaIntensiva: true,  regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false },
  P: { foliaIntensiva: true,  regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false },
  Q: { foliaIntensiva: true,  regimeProvavelLucroReal: false, usaInsumos: true,  sujeitoST: false, exportador: false },
  R: { foliaIntensiva: false, regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false },
  S: { foliaIntensiva: false, regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false },
  T: { foliaIntensiva: false, regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false },
};

/**
 * Recebe um código CNAE no formato "XX.XX-X" ou "XXXXXXX" e devolve a seção (letra).
 * Algoritmo O(1): só lê os 2 primeiros dígitos (divisão CNAE) e compara faixas.
 */
function cnaeToSecao(cnaeCodigo) {
  if (!cnaeCodigo) return null;
  const digits = String(cnaeCodigo).replace(/\D/g, "");
  if (digits.length < 2) return null;
  const divisao = parseInt(digits.slice(0, 2), 10);
  for (const [letra, info] of Object.entries(CNAE_SECOES)) {
    for (const [min, max] of info.faixa) {
      if (divisao >= min && divisao <= max) return letra;
    }
  }
  return null;
}

function setorNome(secao) {
  return CNAE_SECOES[secao]?.nome || "Setor não identificado";
}

function perfilSetor(secao) {
  return SETOR_PERFIL[secao] || {
    foliaIntensiva: false,
    regimeProvavelLucroReal: false,
    usaInsumos: false,
    sujeitoST: false,
    exportador: false,
  };
}

/**
 * Combina (OR) os perfis de várias seções — usado quando a empresa tem CNAEs
 * secundários. Uma flag fica `true` se QUALQUER atividade (principal ou
 * secundária) a tiver. Ex.: prestadora de serviço (M) com atividade secundária
 * de comércio (G) passa a contar como `sujeitoST`/comércio para as teses.
 */
function perfilCombinado(secoes) {
  const chaves = ["foliaIntensiva", "regimeProvavelLucroReal", "usaInsumos", "sujeitoST", "exportador"];
  const out = { foliaIntensiva: false, regimeProvavelLucroReal: false, usaInsumos: false, sujeitoST: false, exportador: false };
  (secoes || []).filter(Boolean).forEach((s) => {
    const p = perfilSetor(s);
    chaves.forEach((k) => { if (p[k]) out[k] = true; });
  });
  return out;
}

// Exporta no escopo global (sem módulos para simplicidade do MVP)
window.CNAE = { cnaeToSecao, setorNome, perfilSetor, perfilCombinado, CNAE_SECOES };
