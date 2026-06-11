/**
 * Motor de análise tributária (100% determinístico, sem IA) — NÚCLEO.
 *
 * Recebe dados crus da Receita (BrasilAPI) e produz um `contexto` enriquecido,
 * depois pontua e rankeia teses. Funções de telefone/contato ficam em
 * `contato.js`; análise de risco (red flags, Transparência, processos) em
 * `analise.js`. Todos contribuem para o mesmo `window.ENGINE`.
 */

// ---------- Utilitários ----------

function limparCnpj(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

function formatarCnpj(cnpj) {
  const d = limparCnpj(cnpj);
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function validarCnpj(cnpj) {
  const d = limparCnpj(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false; // todos iguais
  // Cálculo dos dígitos verificadores
  const calc = (base) => {
    let sum = 0;
    let pos = base.length - 7;
    for (let i = base.length; i >= 1; i--) {
      sum += parseInt(base[base.length - i], 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(d.slice(0, 12));
  const d2 = calc(d.slice(0, 12) + d1);
  return d1 === parseInt(d[12], 10) && d2 === parseInt(d[13], 10);
}

function tempoEmAnos(dataAbertura) {
  if (!dataAbertura) return 0;
  const inicio = new Date(dataAbertura);
  if (isNaN(inicio.getTime())) return 0;
  const diff = Date.now() - inicio.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

function formatBRL(n) {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
}

// ---------- Qualificação de sócio (códigos Receita) ----------

/**
 * Mapeamento dos códigos de qualificação de sócio/representante mais comuns,
 * conforme tabela da Receita Federal. Cobre os ~95% dos casos práticos.
 */
const QUALIFICACAO_SOCIO = {
  5: "Administrador",
  8: "Conselheiro de Administração",
  10: "Diretor",
  16: "Presidente",
  17: "Procurador",
  20: "Sociedade Consorciada",
  21: "Sociedade Filiada",
  22: "Sócio",
  23: "Sócio Capitalista",
  24: "Sócio Comanditado",
  25: "Sócio Comanditário",
  26: "Sócio de Indústria",
  28: "Sócio-Gerente",
  29: "Sócio Incapaz ou Relat. Incapaz",
  30: "Sócio Maior",
  31: "Sócio Menor (16-18)",
  32: "Sócio Ostensivo",
  37: "Sócio PJ Domiciliado no Exterior",
  38: "Sócio PF Residente no Exterior",
  47: "Sócio PF Residente no Brasil",
  48: "Sócio PJ Domiciliado no Brasil",
  49: "Sócio-Administrador",
  50: "Empresário",
  54: "Fundador",
  55: "Sócio Comanditado Residente no Exterior",
  56: "Sócio Comanditário PF Residente no Exterior",
  65: "Titular PF Residente ou Domiciliado no Brasil",
  66: "Titular PF Residente ou Domiciliado no Exterior",
  78: "Titular PF Incapaz ou Relat. Incapaz",
};

function rotuloQualificacao(socio) {
  // BrasilAPI ora retorna a string `qualificacao_socio`, ora só o código.
  const str = socio.qualificacao_socio || socio.qual || "";
  if (str && typeof str === "string" && str.trim()) return str.trim();
  const code = Number(socio.codigo_qualificacao_socio || socio.qualificacao || 0);
  return QUALIFICACAO_SOCIO[code] || "Sócio/Administrador";
}

/**
 * Heurística: identifica se o sócio é potencial "head" (decisor) com base
 * na qualificação. Útil para destacar visualmente quem assina pelo CNPJ.
 */
function ehDecisor(qualLabel) {
  if (!qualLabel) return false;
  const q = qualLabel.toLowerCase();
  return /(administrador|diretor|presidente|gerente|titular|fundador|sócio-administ|empres[áa]rio)/i.test(q);
}

// ---------- Inferência de regime tributário ----------

/**
 * Sem acesso a SEFIP/eSocial, inferimos o regime por sinais públicos:
 *  - Optante do Simples (BrasilAPI traz `opcao_pelo_simples`)
 *  - Porte (MEI/ME/EPP indicam Simples ou Presumido pequeno)
 *  - Capital social + tempo + setor → Lucro Real provável
 *
 * Retornamos uma string + confiança (0..1).
 */
function inferirRegime(receita) {
  const optanteSimples = receita.opcao_pelo_simples === true || receita.simples === true;
  if (optanteSimples) return { regime: "Simples", confianca: 0.95 };

  const porte = (receita.porte || "").toUpperCase();
  const capital = Number(receita.capital_social || 0);

  if (porte === "MEI") return { regime: "Simples", confianca: 0.9 };

  // Critério de receita bruta para Lucro Real obrigatório: > R$ 78 milhões/ano.
  // Sem receita real, usamos capital social como proxy fraco + setor.
  if (capital >= 5_000_000) return { regime: "Lucro Real", confianca: 0.6 };
  if (porte === "DEMAIS" && capital >= 1_000_000) return { regime: "Lucro Real", confianca: 0.55 };
  if (porte === "DEMAIS") return { regime: "Lucro Presumido", confianca: 0.55 };
  if (porte === "EPP") return { regime: "Lucro Presumido", confianca: 0.55 };
  if (porte === "ME") return { regime: "Simples", confianca: 0.65 };

  return { regime: "Lucro Presumido", confianca: 0.4 };
}

// ---------- Normalização de porte ----------

function normalizarPorte(receita) {
  const raw = (receita.porte || "").toUpperCase();
  if (raw.includes("MEI")) return "MEI";
  if (raw.includes("EPP") || raw.includes("PEQUENO")) return "EPP";
  if (raw.includes("ME ") || raw === "ME" || raw.includes("MICRO")) return "ME";
  if (raw.includes("DEMAIS") || raw.includes("MÉDIO") || raw.includes("MEDIO")) return "DEMAIS";
  if (raw.includes("GRANDE")) return "GRANDE";
  return "DEMAIS";
}

// ---------- Construção do contexto ----------

function montarContexto(receita) {
  const cnaePrincipal = receita.cnae_fiscal || receita.cnae_principal || (receita.atividade_principal && receita.atividade_principal[0]?.code);
  const secao = window.CNAE.cnaeToSecao(cnaePrincipal);

  // CNAEs secundários (já vêm no cadastro, de graça) — ampliam a aderência das
  // teses sem custo. Aceita lista de objetos {codigo|code|id} ou de códigos crus.
  const codigosSecundarios = (receita.cnaes_secundarios || [])
    .map((c) => (c && typeof c === "object" ? (c.codigo || c.code || c.id) : c))
    .filter(Boolean);
  const secoesSecundarias = Array.from(new Set(
    codigosSecundarios.map((c) => window.CNAE.cnaeToSecao(c)).filter(Boolean)
  )).filter((s) => s !== secao);
  // Conjunto de seções (principal + secundárias) usado no scoring.
  const secoes = Array.from(new Set([secao, ...secoesSecundarias].filter(Boolean)));

  // Perfil combinado: OR das flags de todas as seções (principal + secundárias).
  const perfil = window.CNAE.perfilCombinado(secoes);
  const setor = window.CNAE.setorNome(secao);
  const setoresSecundarios = secoesSecundarias.map((s) => window.CNAE.setorNome(s));
  const porte = normalizarPorte(receita);
  const { regime, confianca } = inferirRegime(receita);
  const tempoExistenciaAnos = tempoEmAnos(receita.data_inicio_atividade || receita.abertura);

  return {
    cnpj: formatarCnpj(receita.cnpj || ""),
    razaoSocial: receita.razao_social || receita.nome || "—",
    nomeFantasia: receita.nome_fantasia || receita.fantasia || "",
    cnae: cnaePrincipal,
    cnaeDescricao: receita.cnae_fiscal_descricao || (receita.atividade_principal && receita.atividade_principal[0]?.text) || "",
    secao,
    secoes,
    secoesSecundarias,
    setor,
    setoresSecundarios,
    perfil,
    porte,
    regime,
    regimeConfianca: confianca,
    situacao: receita.descricao_situacao_cadastral || receita.situacao || "—",
    capital: Number(receita.capital_social || 0),
    municipio: receita.municipio || "—",
    uf: receita.uf || "—",
    dataAbertura: receita.data_inicio_atividade || receita.abertura || null,
    tempoExistenciaAnos,
    socios: normalizarSocios(receita),
    contato: normalizarContato(receita), // definida em contato.js
  };
}

function normalizarSocios(receita) {
  const qsa = Array.isArray(receita.qsa) ? receita.qsa
    : Array.isArray(receita.socios) ? receita.socios
    : [];
  return qsa.map((s) => {
    const qual = rotuloQualificacao(s);
    return {
      nome: s.nome_socio || s.nome || s.razao_social || "—",
      documento: s.cnpj_cpf_do_socio || s.cnpj_cpf || s.cpf_cnpj || "",
      qualificacao: qual,
      decisor: ehDecisor(qual),
      participacao: s.percentual_capital_social != null ? Number(s.percentual_capital_social) : null,
      desde: s.data_entrada_sociedade || s.data_entrada || null,
      faixaEtaria: s.faixa_etaria || null,
      paisOrigem: s.pais || null,
      representante: s.nome_representante_legal || null,
      qualRepresentante: s.qualificacao_representante_legal || null,
    };
  });
}

// ---------- Scoring de teses ----------

function rankearTeses(contexto) {
  const lista = window.TESES.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    descricao: t.descricao,
    score: t.criterios(contexto),
  }));
  // Ordena por score desc e mantém só as com score > 0
  return lista
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);
}

function classificarScore(score) {
  if (score >= 70) return { classe: "score-high", label: "Alta aderência" };
  if (score >= 40) return { classe: "score-mid", label: "Aderência moderada" };
  return { classe: "score-low", label: "Baixa aderência" };
}

// ---------- Estimativa GROSSEIRA de crédito (entrada manual de faturamento) ----------
//
// Sem SPED não há cálculo real. Estes fatores são percentuais médios e
// CONSERVADORES do faturamento anual recuperável por ano, por tese. Servem só
// para dar ORDEM DE GRANDEZA e priorizar leads — nunca como cálculo de crédito.
const FATOR_CREDITO_ANUAL = {
  icms_pis_cofins: 0.008,
  iss_pis_cofins: 0.004,
  inss_rubricas: 0.006,
  limite_20sm_terceiros: 0.003,
  creditos_pis_cofins_insumos: 0.010,
  selic_repeticao_indebito: 0.002,
  difal_icms: 0.002,
  icms_st_restituicao: 0.005,
  subvencoes_lc160: 0.006,
  pis_cofins_proprias_base: 0.003,
};
const ANOS_PRESCRICAO = 5;

/**
 * Estima a ordem de grandeza do crédito de uma tese sobre 5 anos, dado o
 * faturamento anual informado manualmente. Devolve { min, central, max } em
 * reais, com banda de ±40% para sinalizar a incerteza, ou null se não houver
 * faturamento/fator.
 */
function estimarCreditoTese(id, faturamentoAnual) {
  const fat = Number(faturamentoAnual);
  if (!fat || isNaN(fat) || fat <= 0) return null;
  const fator = FATOR_CREDITO_ANUAL[id];
  if (!fator) return null;
  const central = fat * fator * ANOS_PRESCRICAO;
  return { min: central * 0.6, central, max: central * 1.4 };
}

// Interpreta um faturamento digitado livremente (ex.: "5.000.000", "5000000").
function parseFaturamento(texto) {
  const limpo = String(texto || "").replace(/[^\d]/g, "");
  const n = Number(limpo);
  return n > 0 ? n : 0;
}

// ---------- Resumo compacto para IA ----------

/**
 * Gera o resumo MÍNIMO que será enviado ao Claude.
 * Em vez de ~3000 tokens do JSON da Receita, mandamos ~150 tokens.
 */
function resumoParaIA(contexto, top3) {
  // Compactamos sócios decisores em uma única string curta (~30 tokens).
  const decisores = (contexto.socios || [])
    .filter((s) => s.decisor)
    .slice(0, 3)
    .map((s) => `${s.nome} (${s.qualificacao})`);

  return {
    empresa: contexto.razaoSocial,
    nomeFantasia: contexto.nomeFantasia || undefined,
    setor: contexto.setor,
    cnae: contexto.cnaeDescricao,
    porte: contexto.porte,
    regimeInferido: contexto.regime,
    anosAtividade: contexto.tempoExistenciaAnos,
    uf: contexto.uf,
    capitalSocial: contexto.capital,
    decisoresChave: decisores.length ? decisores : undefined,
    tesesPrincipais: top3.map((t) => ({ id: t.id, titulo: t.titulo, score: t.score })),
  };
}

// contato.js e analise.js também contribuem para este objeto.
window.ENGINE = Object.assign(window.ENGINE || {}, {
  limparCnpj,
  formatarCnpj,
  validarCnpj,
  montarContexto,
  rankearTeses,
  classificarScore,
  estimarCreditoTese,
  parseFaturamento,
  resumoParaIA,
  formatBRL,
});
