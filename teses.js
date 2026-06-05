/**
 * Base de conhecimento de teses tributárias.
 *
 * Cada tese tem:
 *  - id, titulo, descricao curta
 *  - criterios: função que recebe o `contexto` (dados do CNPJ + perfil) e
 *    devolve um score 0..100 com a probabilidade de a tese ser aplicável.
 *  - prescricaoAnos: limite temporal típico para revisão (geralmente 5).
 *
 * O score é determinístico (sem IA) e prioriza as teses antes de pedirmos
 * narrativa ao Claude. Assim só enviamos as 3-5 mais relevantes pro modelo.
 */

const TESES = [
  {
    id: "icms_pis_cofins",
    titulo: "Exclusão do ICMS da base de PIS/COFINS",
    descricao:
      "Tese pacificada pelo STF (RE 574.706, Tema 69). Aplicável a contribuintes do Lucro Real ou Presumido com saídas tributadas pelo ICMS. Crédito significativo, modulação dos efeitos a partir de 15/03/2017.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      // Só aplica a quem paga PIS/COFINS no regime cumulativo/não-cumulativo,
      // ou seja, NÃO se aplica a optantes do Simples Nacional.
      if (ctx.regime === "Simples") return 0;
      // Setores com saída de mercadorias tributadas pelo ICMS = G (comércio), C (indústria), H (transporte interestadual)
      const setoresAplicaveis = ["C", "G", "B", "F", "H"];
      const secs = ctx.secoes || [ctx.secao];
      let score = 0;
      if (secs.some((s) => setoresAplicaveis.includes(s))) score += 70;
      else score += 30; // outros setores podem ter receita com ICMS pontualmente
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 20;
      else if (ctx.porte === "EPP") score += 10;
      if (ctx.tempoExistenciaAnos >= 5) score += 10;
      return Math.min(100, score);
    },
  },
  {
    id: "iss_pis_cofins",
    titulo: "Exclusão do ISS da base de PIS/COFINS",
    descricao:
      "Tese análoga à do ICMS, ainda pendente de julgamento definitivo no STF (Tema 118), mas com forte fundamento. Aplicável a prestadores de serviço fora do Simples.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime === "Simples") return 0;
      // Prestadores de serviço: M, N, J, P, Q, R, S, H (parcial)
      const setoresAplicaveis = ["M", "N", "J", "P", "Q", "R", "S"];
      const secs = ctx.secoes || [ctx.secao];
      let score = 0;
      if (secs.some((s) => setoresAplicaveis.includes(s))) score += 60;
      else score += 15;
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 20;
      else if (ctx.porte === "EPP") score += 10;
      return Math.min(100, score);
    },
  },
  {
    id: "inss_rubricas",
    titulo: "INSS sobre rubricas indenizatórias",
    descricao:
      "Recuperação de contribuição previdenciária patronal (20% + RAT/SAT + Terceiros) recolhida indevidamente sobre rubricas como aviso prévio indenizado, terço de férias, primeiros 15 dias de afastamento, vale-transporte em pecúnia, entre outras. Tese consolidada para diversas verbas.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime === "Simples") return 0; // Simples não paga INSS patronal próprio
      let score = 0;
      if (ctx.perfil.foliaIntensiva) score += 50;
      else score += 20;
      // Folha alta correlaciona com porte
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 30;
      else if (ctx.porte === "EPP") score += 15;
      if (ctx.tempoExistenciaAnos >= 5) score += 10;
      return Math.min(100, score);
    },
  },
  {
    id: "limite_20sm_terceiros",
    titulo: "Limitação a 20 salários mínimos — Contribuições a Terceiros",
    descricao:
      "Tese que sustenta que a base de cálculo das contribuições a Terceiros (Sistema S, INCRA, SEBRAE, salário-educação) é limitada a 20 salários mínimos por empregado. Tese impactada pelo julgamento do STJ em 2024 e modulação. Aplicabilidade restrita a casos específicos pós-modulação.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime === "Simples") return 0;
      let score = 0;
      if (ctx.perfil.foliaIntensiva) score += 30;
      // Empresas com salários altos têm mais ganho
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 30;
      else if (ctx.porte === "EPP") score += 10;
      // Score moderado devido à modulação recente
      return Math.min(80, score);
    },
  },
  {
    id: "creditos_pis_cofins_insumos",
    titulo: "Créditos de PIS/COFINS sobre insumos (conceito ampliado)",
    descricao:
      "Após o REsp 1.221.170 (STJ) e Parecer SEI 5.746/2022, o conceito de insumo foi ampliado. Permite recuperação de créditos sobre despesas essenciais à atividade, frequentemente glosadas pela Receita. Exclusivo para Lucro Real (não-cumulativo).",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime !== "Lucro Real") return 0;
      let score = 30;
      if (ctx.perfil.usaInsumos) score += 40;
      if ((ctx.secoes || [ctx.secao]).some((s) => s === "C" || s === "G")) score += 20; // indústria e comércio
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 10;
      return Math.min(100, score);
    },
  },
  {
    id: "selic_repeticao_indebito",
    titulo: "Exclusão da Selic sobre repetição de indébito (IRPJ/CSLL)",
    descricao:
      "STF (Tema 962) decidiu que juros Selic recebidos em repetição de indébito tributário não compõem base de cálculo de IRPJ/CSLL. Aplicável a quem já obteve ou está discutindo restituição.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime === "Simples") return 0;
      let score = 25;
      // Empresas maiores tendem a ter histórico de demandas tributárias
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 35;
      else if (ctx.porte === "EPP") score += 15;
      if (ctx.tempoExistenciaAnos >= 10) score += 20;
      return Math.min(100, score);
    },
  },
  {
    id: "difal_icms",
    titulo: "DIFAL ICMS — recolhimentos indevidos em 2022",
    descricao:
      "O STF (Tema 1.093) reconheceu a necessidade de lei complementar para cobrança do DIFAL nas operações interestaduais a consumidor final não contribuinte. Recolhimentos feitos em 2022, antes da LC 190/2022 produzir efeitos, podem ser recuperados.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime === "Simples") return 0;
      // Comércio (G) e indústria (C) com vendas interestaduais
      const setoresAplicaveis = ["C", "G", "J"];
      const secs = ctx.secoes || [ctx.secao];
      let score = 0;
      if (secs.some((s) => setoresAplicaveis.includes(s))) score += 50;
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 30;
      else if (ctx.porte === "EPP") score += 15;
      return Math.min(95, score);
    },
  },
  {
    id: "icms_st_restituicao",
    titulo: "Restituição de ICMS-ST quando base presumida > efetiva",
    descricao:
      "STF (RE 593.849, Tema 201) firmou direito à restituição do ICMS-ST quando a base de cálculo presumida superar a efetiva venda. Aplicável a varejistas e atacadistas com produtos sujeitos a ST.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime === "Simples") return 0;
      let score = 0;
      if (ctx.perfil.sujeitoST) score += 60;
      if ((ctx.secoes || [ctx.secao]).includes("G")) score += 20; // comércio
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 15;
      return Math.min(95, score);
    },
  },
  {
    id: "subvencoes_lc160",
    titulo: "Subvenções para investimento — não tributação por IRPJ/CSLL",
    descricao:
      "Mesmo com a Lei 14.789/2023 que alterou o regime, benefícios fiscais de ICMS concedidos com base na LC 160/2017 podem ainda gerar discussão. Para o passado (até 2023), há crédito a ser revisado.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime !== "Lucro Real") return 0;
      let score = 20;
      if ((ctx.secoes || [ctx.secao]).some((s) => s === "C" || s === "G")) score += 40;
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 25;
      return Math.min(95, score);
    },
  },
  {
    id: "pis_cofins_proprias_base",
    titulo: "Exclusão do PIS/COFINS da sua própria base",
    descricao:
      "Tese 'filhote' da exclusão do ICMS. Sustenta que as próprias contribuições não devem compor sua base. Pendente de definição mas com tese forte.",
    prescricaoAnos: 5,
    criterios: (ctx) => {
      if (ctx.regime === "Simples") return 0;
      let score = 25;
      if (ctx.porte === "GRANDE" || ctx.porte === "DEMAIS") score += 30;
      if (ctx.tempoExistenciaAnos >= 5) score += 15;
      return Math.min(75, score);
    },
  },
];

window.TESES = TESES;
