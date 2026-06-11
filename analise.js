/**
 * Análise de risco e cruzamentos — parte do `window.ENGINE`.
 *
 * Red flags (com dados públicos), análise do Portal da Transparência e
 * cruzamento com processos já ajuizados. Usa `formatBRL` do engine.js (global).
 * Carregar depois de engine.js.
 */

// ---------- Red flags (análise de risco com dados que já temos) ----------

/**
 * Avalia sinais de risco e oportunidade usando APENAS dados públicos
 * que já chegaram da BrasilAPI. Não faz chamadas externas.
 *
 * Retorna { score, nivel, flags, recomendacao }.
 * Filosofia: ser conservador. Só marca flag quando o sinal é claro.
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

// ---------- Portal da Transparência ----------

/**
 * Converte os dados do Portal da Transparência em flags de risco/oportunidade.
 * Sanções (CEIS/CNEP/CEPIM) → RISCO; contratos federais → POSITIVO (proxy de
 * faturamento). Devolve { flags, deltaScore, temSancao }.
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

// ---------- Cruzamento com processos já ajuizados (litígio) ----------
//
// Regex específicas por tese para reduzir falso-positivo. Devem casar com o
// ASSUNTO/CLASSE do processo.
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

window.ENGINE = Object.assign(window.ENGINE || {}, {
  calcularRedFlags,
  analisarTransparencia,
  mesclarRiscoTransparencia,
  marcarTesesAjuizadas,
  analisarProcessos,
});
