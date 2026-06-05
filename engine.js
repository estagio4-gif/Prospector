/**
 * Motor de análise tributária (100% determinístico, sem IA).
 *
 * Recebe dados crus da Receita (BrasilAPI) e produz um `contexto` enriquecido,
 * depois pontua e rankeia teses.
 *
 * Por que isso economiza tokens:
 *  - A IA só recebe o `contexto` resumido (poucas chaves) e as top-3 teses já filtradas.
 *  - Não enviamos o JSON gigante da Receita (200+ linhas) para o modelo.
 *  - Toda a lógica de aplicabilidade já foi resolvida em JS antes.
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
    contato: normalizarContato(receita),
  };
}

// ---------- Sócios + contato cadastral ----------

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

function formatarTelefoneBr(numero) {
  const d = String(numero || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return numero || "";
}

// DDDs válidos no Brasil (todos os códigos de área em uso).
const DDDS_VALIDOS = new Set([
  11,12,13,14,15,16,17,18,19, 21,22,24,27,28, 31,32,33,34,35,37,38,
  41,42,43,44,45,46,47,48,49, 51,53,54,55, 61,62,63,64,65,66,67,68,69,
  71,73,74,75,77,79, 81,82,83,84,85,86,87,88,89,
  91,92,93,94,95,96,97,98,99,
]);

/**
 * Reduz qualquer telefone ao padrão nacional em dígitos (10 = fixo, 11 = celular
 * com DDD). Remove +55, zero de operadora (0xx) e qualquer pontuação. Devolve
 * `null` quando o número não é um telefone brasileiro plausível — isso filtra
 * lixo que às vezes vem das bases públicas (CEP, CNAE, etc. em campo errado).
 */
function digitosTelefone(numero) {
  let d = String(numero || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2); // remove +55
  if (d.length === 12 && d.startsWith("0")) d = d.slice(1); // 0 + 11
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1); // 0 + 10
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDDS_VALIDOS.has(parseInt(d.slice(0, 2), 10))) return null;
  // Celular tem 11 dígitos com o 3º dígito = 9. Fixo tem 10.
  if (d.length === 11 && d[2] !== "9") return null;
  return d;
}

function classificarTipoTel(d) {
  if (!d) return "desconhecido";
  if (d.length === 11 && d[2] === "9") return "celular";
  if (d.length === 10) return "fixo";
  return "desconhecido";
}

/** Constrói um telefone normalizado `{raw, formatado, tipo, whatsapp, fonte}` ou null. */
function montarTelefone(numero, fonte) {
  const d = digitosTelefone(numero);
  if (!d) return null;
  const tipo = classificarTipoTel(d);
  return {
    raw: d,
    formatado: formatarTelefoneBr(d),
    tipo,
    whatsapp: tipo === "celular",
    fonte: fonte || "—",
  };
}

/**
 * Junta telefones de várias fontes, deduplicando pelo número (raw). Quando o
 * mesmo número aparece em fontes diferentes, agrega os nomes das fontes — mais
 * fontes concordando = maior confiança. Ordena celulares primeiro (mais úteis
 * para abordagem comercial).
 */
function mesclarTelefones(listas) {
  const mapa = new Map();
  (listas || []).flat().forEach((tel) => {
    if (!tel || !tel.raw) return;
    const existente = mapa.get(tel.raw);
    if (existente) {
      const fontes = new Set(existente.fonte.split(" + "));
      fontes.add(tel.fonte);
      existente.fonte = Array.from(fontes).join(" + ");
    } else {
      mapa.set(tel.raw, { ...tel });
    }
  });
  return Array.from(mapa.values()).sort((a, b) => {
    if (a.tipo === b.tipo) return 0;
    return a.tipo === "celular" ? -1 : 1;
  });
}

/**
 * Mescla telefones/e-mails extras (de fontes externas) ao contato cadastral já
 * montado, mantendo `telefones` como array de strings formatadas para retro-
 * compatibilidade e adicionando `telefonesDetalhe` (com tipo e fonte).
 */
function aplicarTelefonesExtras(contato, extras) {
  if (!contato) return contato;
  const detalhe = mesclarTelefones([
    contato.telefonesDetalhe || [],
    (extras && extras.telefones) || [],
  ]);
  const emails = Array.from(new Set([
    ...(contato.emails || (contato.email ? [contato.email] : [])),
    ...((extras && extras.emails) || []),
  ].filter(Boolean)));
  return {
    ...contato,
    telefonesDetalhe: detalhe,
    telefones: detalhe.map((t) => t.formatado),
    emails,
    email: contato.email || emails[0] || "",
  };
}

function normalizarContato(receita) {
  // BrasilAPI v1 entrega `ddd_telefone_1` no formato "11999999999".
  const telefonesDetalhe = mesclarTelefones([[
    montarTelefone(receita.ddd_telefone_1, "Receita (BrasilAPI)"),
    montarTelefone(receita.ddd_telefone_2, "Receita (BrasilAPI)"),
    // Alguns endpoints retornam um campo `telefone` simples.
    montarTelefone(receita.telefone, "Receita (BrasilAPI)"),
  ].filter(Boolean)]);

  const partesEnd = [
    receita.descricao_tipo_de_logradouro,
    receita.logradouro,
    receita.numero,
    receita.complemento,
    receita.bairro,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  const endereco = partesEnd
    ? `${partesEnd}${receita.cep ? " · CEP " + formatarCep(receita.cep) : ""}`
    : "";

  const emails = Array.from(new Set(
    [receita.email, receita.email_contato].filter(Boolean)
  ));

  return {
    telefones: telefonesDetalhe.map((t) => t.formatado),
    telefonesDetalhe,
    email: emails[0] || "",
    emails,
    endereco,
    municipio: receita.municipio || "",
    uf: receita.uf || "",
    cep: receita.cep ? formatarCep(receita.cep) : "",
  };
}

function formatarCep(cep) {
  const d = String(cep || "").replace(/\D/g, "");
  if (d.length !== 8) return cep || "";
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

// ---------- Red flags (análise de risco com dados que já temos) ----------

/**
 * Avalia sinais de risco e oportunidade usando APENAS dados públicos
 * que já chegaram da BrasilAPI. Não faz chamadas externas.
 *
 * Retorna:
 *   {
 *     score: 0..100  (quanto maior, mais sinais de risco/atenção)
 *     nivel: "baixo" | "moderado" | "alto"
 *     flags: [{ tipo: "risco"|"alerta"|"positivo", titulo, descricao }]
 *     recomendacao: string  (sugestão de abordagem)
 *   }
 *
 * Filosofia: ser conservador. Só marca flag quando o sinal é claro.
 * Não penaliza MEI/ME por padrão — eles têm capital baixo por natureza.
 */
function calcularRedFlags(contexto) {
  const flags = [];
  let score = 0;

  // --- Situação cadastral ---
  if (!/ATIV/i.test(contexto.situacao || "")) {
    flags.push({
      tipo: "risco",
      titulo: "Situação cadastral não ativa",
      descricao: `Receita Federal indica situação "${contexto.situacao}". Confirmar se há impedimento legal antes de avançar comercialmente.`,
    });
    score += 35;
  }

  // --- Idade da empresa ---
  if (contexto.tempoExistenciaAnos === 0) {
    flags.push({
      tipo: "alerta",
      titulo: "Empresa recém-aberta (< 1 ano)",
      descricao: "Janela de prescrição quinquenal limitada. Recuperação de créditos terá impacto pequeno.",
    });
    score += 15;
  } else if (contexto.tempoExistenciaAnos >= 10) {
    flags.push({
      tipo: "positivo",
      titulo: `${contexto.tempoExistenciaAnos} anos de atividade`,
      descricao: "Janela quinquenal cheia, com histórico fiscal consolidado. Excelente para revisão retroativa.",
    });
  }

  // --- Capital social vs. porte (inconsistência) ---
  if (contexto.porte === "GRANDE" && contexto.capital > 0 && contexto.capital < 1_000_000) {
    flags.push({
      tipo: "alerta",
      titulo: "Capital social baixo para porte declarado",
      descricao: `Capital de ${formatBRL(contexto.capital)} é inconsistente com porte GRANDE. Verificar se houve subscrição/integralização recente.`,
    });
    score += 10;
  }
  if (contexto.porte === "DEMAIS" && contexto.capital >= 10_000_000) {
    flags.push({
      tipo: "positivo",
      titulo: "Capital social elevado",
      descricao: `${formatBRL(contexto.capital)} de capital indica empresa de médio/grande porte com estrutura fiscal complexa. Alto potencial de crédito.`,
    });
  }

  // --- Quadro societário ---
  const socios = contexto.socios || [];
  if (socios.length === 0) {
    flags.push({
      tipo: "alerta",
      titulo: "Quadro societário não informado",
      descricao: "Sem QSA público, fica difícil identificar decisor. Tentar contato pelo financeiro/contabilidade.",
    });
    score += 5;
  }
  if (socios.length === 1 && contexto.porte !== "MEI") {
    flags.push({
      tipo: "alerta",
      titulo: "Sócio único",
      descricao: "Empresa com sócio único concentra decisão. Vantagem: ciclo curto de aprovação. Desvantagem: aversão a litígio pode ser alta.",
    });
  }

  // Sócio que entrou nos últimos 6 meses → possível mudança de controle.
  const seisMesesAtras = Date.now() - 180 * 24 * 3600 * 1000;
  const sociosRecentes = socios.filter((s) => {
    if (!s.desde) return false;
    const d = new Date(s.desde).getTime();
    return !isNaN(d) && d > seisMesesAtras;
  });
  if (sociosRecentes.length > 0 && contexto.tempoExistenciaAnos > 1) {
    flags.push({
      tipo: "alerta",
      titulo: `Mudança recente de sócio (${sociosRecentes.length})`,
      descricao: `Entrada de ${sociosRecentes.map((s) => s.nome).slice(0,2).join(", ")} nos últimos 6 meses. Pode indicar reorganização societária ou venda — verificar continuidade da operação.`,
    });
    score += 8;
  }

  // --- Contato cadastral ---
  const contato = contexto.contato || {};
  const semTel = !contato.telefones || contato.telefones.length === 0;
  const semEmail = !contato.email;
  if (semTel && semEmail) {
    flags.push({
      tipo: "risco",
      titulo: "Sem telefone nem e-mail cadastral",
      descricao: "Empresa não atualiza dados na Receita há tempo, ou foi cadastrada sem contato. Sinal de baixa formalização — abordar via sócio diretamente.",
    });
    score += 12;
  } else if (semTel) {
    flags.push({
      tipo: "alerta",
      titulo: "Sem telefone cadastral",
      descricao: "Receita Federal não tem telefone. Abordagem por e-mail ou via sócio.",
    });
    score += 4;
  }

  // --- Perfil fiscal favorável (positivo) ---
  if (contexto.regime === "Lucro Real" && contexto.tempoExistenciaAnos >= 5) {
    flags.push({
      tipo: "positivo",
      titulo: "Lucro Real consolidado",
      descricao: "Regime Lucro Real + histórico longo = SPED Contribuições rico em material para revisão das principais teses (Tema 69, créditos PIS/COFINS, INSS rubricas).",
    });
  }
  if (contexto.perfil && contexto.perfil.foliaIntensiva && contexto.tempoExistenciaAnos >= 3) {
    flags.push({
      tipo: "positivo",
      titulo: "Folha intensiva + histórico",
      descricao: "Setor tipicamente folha-intensivo com tempo de existência. Alta probabilidade de tese INSS sobre rubricas indenizatórias gerar crédito relevante.",
    });
  }

  // Normaliza nível
  let nivel = "baixo";
  if (score >= 35) nivel = "alto";
  else if (score >= 15) nivel = "moderado";

  // Recomendação de abordagem com base no nível
  let recomendacao;
  if (nivel === "alto") {
    recomendacao = "Lead com sinais de risco. Antes de propor honorários, confirmar situação fiscal e operacional. Considerar diagnóstico pago em vez de êxito puro.";
  } else if (nivel === "moderado") {
    recomendacao = "Lead viável com pontos a esclarecer. Sugerir reunião exploratória + solicitação de CND e SPED antes de proposta formal.";
  } else {
    recomendacao = "Lead saudável. Avançar para proposta de diagnóstico tributário gratuito + honorários de êxito sobre o crédito apurado.";
  }

  return { score: Math.min(100, score), nivel, flags, recomendacao };
}

/**
 * Converte os dados do Portal da Transparência em flags de risco/oportunidade.
 *
 * - Sanções (CEIS/CNEP/CEPIM) → flag de RISCO forte (empresa inidônea/punida).
 * - Contratos federais → flag POSITIVA: vende para o governo = porte real,
 *   formalidade e capacidade de pagamento. O valor somado serve de proxy de
 *   faturamento — exatamente o dado que falta para dimensionar crédito.
 *
 * Devolve { flags, deltaScore, temSancao }. O merge no objeto de risco fica em
 * `mesclarRiscoTransparencia` para não duplicar a lógica de nível/recomendação.
 */
function analisarTransparencia(transp) {
  const flags = [];
  let deltaScore = 0;
  if (!transp) return { flags, deltaScore, temSancao: false };

  const sancoes = transp.sancoes || [];
  const temSancao = sancoes.length > 0;
  if (temSancao) {
    const fontes = Array.from(new Set(sancoes.map((s) => s.fonte))).join(", ");
    flags.push({
      tipo: "risco",
      titulo: `${sancoes.length} sanção(ões) pública(s) — ${fontes}`,
      descricao: "Empresa consta em cadastro de inidôneas/punidas da CGU. Sinal grave: revisar antes de propor honorários e checar reflexo em parcelamentos e CNDs.",
    });
    deltaScore += 30;
  }

  const c = transp.contratos || {};
  if (c.quantidade > 0) {
    const valor = c.valorTotal ? ` somando ~${formatBRL(c.valorTotal)}` : "";
    flags.push({
      tipo: "positivo",
      titulo: `Fornecedor do governo federal — ${c.quantidade} contrato(s)`,
      descricao: `Contratos federais${valor} sinalizam porte real, formalidade e capacidade de pagamento. Use como proxy de faturamento para dimensionar o crédito potencial e priorizar o lead.`,
    });
  }

  return { flags, deltaScore, temSancao };
}

/**
 * Mescla as flags da Transparência no objeto de risco já calculado, reajustando
 * score, nível e recomendação. Sanção sobe o nível para "alto".
 */
function mesclarRiscoTransparencia(risco, transp) {
  if (!risco || !transp) return risco;
  const { flags, deltaScore, temSancao } = analisarTransparencia(transp);
  if (!flags.length) return risco;

  const novoScore = Math.min(100, (risco.score || 0) + deltaScore);
  let nivel = risco.nivel;
  let recomendacao = risco.recomendacao;
  if (temSancao) {
    nivel = "alto";
    recomendacao = "Empresa com sanção pública (CGU). Tratar como lead de alto risco: confirmar a situação da sanção e seus reflexos fiscais antes de qualquer proposta.";
  }

  return {
    ...risco,
    score: novoScore,
    nivel,
    recomendacao,
    // Risco primeiro, depois o resto, para destacar a sanção no topo.
    flags: [...flags.filter((f) => f.tipo === "risco"), ...risco.flags, ...flags.filter((f) => f.tipo !== "risco")],
  };
}

function formatBRL(n) {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
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

// ---------- Cruzamento com processos já ajuizados (litígio) ----------
//
// Para cada tese, palavras-chave da matéria. Se um processo do CNPJ casa com
// a matéria, a tese é marcada como "já ajuizada" — para o comercial NÃO
// oferecer algo que o cliente já protocolou.
// Regex específicas por tese para reduzir falso-positivo. Devem casar com o
// ASSUNTO/CLASSE do processo. Quanto mais específico, menos teses são marcadas
// indevidamente como "já ajuizadas".
const MATERIA_TESE = {
  icms_pis_cofins: /(icms.{0,30}(pis|cofins|base)|(pis|cofins).{0,30}icms|tema\s*69|574\.?706)/i,
  iss_pis_cofins: /(\biss\b).{0,40}(pis|cofins)|(pis|cofins).{0,40}\biss\b/i,
  inss_rubricas: /(contribui[çc][ãa]o previdenci|\binss\b.{0,30}(rubrica|verba|folha)|terço de férias|aviso prévio)/i,
  limite_20sm_terceiros: /(20 sal[áa]rios|contribui[çc][õo]es a terceiros|sistema\s+s\b|sebrae|incra|sal[áa]rio.?educa)/i,
  creditos_pis_cofins_insumos: /(insumo|cr[ée]dito.{0,30}(pis|cofins)|n[ãa]o.?cumulativ)/i,
  selic_repeticao_indebito: /(selic|repeti[çc][ãa]o de ind[ée]bito|ind[ée]bito tribut)/i,
  difal_icms: /(difal|diferencial de al[íi]quota)/i,
  icms_st_restituicao: /(substitui[çc][ãa]o tribut|icms.?st|\bst\b.{0,20}restitui)/i,
  subvencoes_lc160: /(subven[çc]|incentivo fiscal|lc\s*160)/i,
  pis_cofins_proprias_base: /(pr[óo]pria base|pis.{0,20}cofins.{0,20}base)/i,
};

function textoProcesso(p) {
  return [(p.assuntos || []).join(" "), p.classe || ""].join(" ");
}

/**
 * Marca em cada tese se já há processo do CNPJ na mesma matéria.
 * Adiciona `jaAjuizada`, `ajuizadaComoAutor` e `processoRef`.
 */
function marcarTesesAjuizadas(teses, dados) {
  const procs = (dados && dados.processos) || [];
  if (!procs.length) return teses;
  return teses.map((t) => {
    const re = MATERIA_TESE[t.id];
    if (!re) return t;
    const match = procs.find((p) => re.test(textoProcesso(p)));
    if (!match) return t;
    return {
      ...t,
      jaAjuizada: true,
      ajuizadaComoAutor: match.polo === "ATIVO",
      processoRef: match.numero || null,
    };
  });
}

/**
 * Flags de risco/oportunidade a partir dos processos: empresa que litiga em
 * matéria tributária é lead qualificado ("tax-aware").
 */
function analisarProcessos(dados) {
  const flags = [];
  if (!dados) return { flags };
  const procs = dados.processos || [];
  const tributarios = procs.filter((p) =>
    /(tribut|fiscal|\bpis\b|cofins|\bicms\b|\biss\b|previdenci|\binss\b|\birpj\b|\bcsll\b)/i.test(textoProcesso(p))
  );
  if (tributarios.length) {
    flags.push({
      tipo: "positivo",
      titulo: `Litiga em matéria tributária (${tributarios.length} processo(s))`,
      descricao: "Empresa já discute tributos no Judiciário — lead 'tax-aware', com fornecedor jurídico e orçamento. Conferir quais teses já foram ajuizadas para não sobrepor.",
    });
  }
  return { flags };
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

window.ENGINE = {
  limparCnpj,
  formatarCnpj,
  validarCnpj,
  montarContexto,
  rankearTeses,
  classificarScore,
  estimarCreditoTese,
  parseFaturamento,
  marcarTesesAjuizadas,
  analisarProcessos,
  resumoParaIA,
  calcularRedFlags,
  // Portal da Transparência
  analisarTransparencia,
  mesclarRiscoTransparencia,
  formatBRL,
  // Telefones / contato
  montarTelefone,
  mesclarTelefones,
  aplicarTelefonesExtras,
  classificarTipoTel,
  digitosTelefone,
  formatarTelefoneBr,
};
