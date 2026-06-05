/**
 * Integrações com APIs públicas.
 *
 * BrasilAPI:  https://brasilapi.com.br/api/cnpj/v1/{cnpj}
 *             — gratuito, sem autenticação, retorna dados completos da Receita.
 *
 * Cache: localStorage com TTL de 24h para evitar refazer chamadas idênticas.
 *
 * Nota: a integração com Datajud/CNJ foi removida porque a API pública
 * não expõe dados de partes — não é possível buscar processos por CNPJ.
 * Para essa funcionalidade no futuro, considere APIs pagas (Jusbrasil,
 * Escavador, Codilo) ou o Datajud restrito a advogados.
 */

const CACHE_PREFIX = "prosp_cache_";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.v;
  } catch {
    return null;
  }
}

function cacheSet(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {}
}

// ---------- Cadastro (Receita) com fallback entre fontes gratuitas ----------
//
// Se a BrasilAPI cair ou bater rate limit, a análise inteira não pode parar.
// Encadeamos várias fontes públicas gratuitas — todas normalizadas para o MESMO
// formato (o da BrasilAPI), que é o que o `engine.montarContexto` consome. A
// primeira que responder com dados válidos vence. Cada fonte tem schema próprio,
// então cada uma tem seu normalizador.

const SIM_RE = /sim|optante|true/i;

// fetch com timeout, para uma fonte lenta não travar o encadeamento.
async function fetchComTimeout(url, ms = 9000, opts = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// BrasilAPI e Minha Receita já vêm no formato canônico (mesmos nomes de campo).
async function viaBrasilAPI(cnpj) {
  const r = await fetchComTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!r.ok) return null;
  const d = await r.json();
  d._fonte = "BrasilAPI";
  return d;
}
async function viaMinhaReceita(cnpj) {
  const r = await fetchComTimeout(`https://minhareceita.org/${cnpj}`);
  if (!r.ok) return null;
  const d = await r.json();
  d._fonte = "Minha Receita";
  return d;
}

// CNPJ.ws: estrutura aninhada em `estabelecimento`.
async function viaCnpjWs(cnpj) {
  const r = await fetchComTimeout(`https://publica.cnpj.ws/cnpj/${cnpj}`);
  if (!r.ok) return null;
  const d = await r.json();
  const e = d.estabelecimento || {};
  const ap = e.atividade_principal || {};
  return {
    _fonte: "CNPJ.ws",
    cnpj: e.cnpj || d.cnpj,
    razao_social: d.razao_social,
    nome_fantasia: e.nome_fantasia || "",
    cnae_fiscal: ap.id || ap.codigo || ap.subclasse,
    cnae_fiscal_descricao: ap.descricao || "",
    cnaes_secundarios: (e.atividades_secundarias || []).map((a) => ({ codigo: a.id || a.codigo, descricao: a.descricao })),
    capital_social: d.capital_social,
    porte: (d.porte && (d.porte.descricao || d.porte)) || "",
    opcao_pelo_simples: !!(d.simples && SIM_RE.test(String(d.simples.simples))),
    descricao_situacao_cadastral: e.situacao_cadastral,
    data_inicio_atividade: e.data_inicio_atividade,
    descricao_tipo_de_logradouro: e.tipo_logradouro,
    logradouro: e.logradouro, numero: e.numero, complemento: e.complemento, bairro: e.bairro,
    cep: e.cep, municipio: e.cidade && e.cidade.nome, uf: e.estado && e.estado.sigla,
    ddd_telefone_1: e.ddd1 && e.telefone1 ? e.ddd1 + e.telefone1 : "",
    ddd_telefone_2: e.ddd2 && e.telefone2 ? e.ddd2 + e.telefone2 : "",
    email: e.email || "",
    qsa: (d.socios || []).map((s) => ({
      nome_socio: s.nome,
      cnpj_cpf_do_socio: s.cpf_cnpj_socio || s.cnpj_cpf_socio,
      qualificacao_socio: s.qualificacao_socio && (s.qualificacao_socio.descricao || s.qualificacao_socio),
      data_entrada_sociedade: s.data_entrada_sociedade,
      faixa_etaria: s.faixa_etaria,
    })),
  };
}

// OpenCNPJ: campos achatados; telefones em array `telefones`.
async function viaOpenCnpj(cnpj) {
  const r = await fetchComTimeout(`https://api.opencnpj.org/${cnpj}`);
  if (!r.ok) return null;
  const d = await r.json();
  const tel = Array.isArray(d.telefones) ? d.telefones.filter((t) => !t.is_fax) : [];
  return {
    _fonte: "OpenCNPJ",
    cnpj: d.cnpj,
    razao_social: d.razao_social,
    nome_fantasia: d.nome_fantasia || "",
    cnae_fiscal: d.cnae_principal,
    cnae_fiscal_descricao: "", // OpenCNPJ não traz descrição do CNAE principal
    cnaes_secundarios: (d.cnaes_secundarios || []).map((c) => ({ codigo: c, descricao: "" })),
    capital_social: d.capital_social,
    porte: d.porte_empresa || "",
    opcao_pelo_simples: SIM_RE.test(String(d.opcao_simples || "")),
    descricao_situacao_cadastral: d.situacao_cadastral,
    data_inicio_atividade: d.data_inicio_atividade,
    descricao_tipo_de_logradouro: d.tipo_logradouro,
    logradouro: d.logradouro, numero: d.numero, complemento: d.complemento, bairro: d.bairro,
    cep: d.cep, municipio: d.municipio, uf: d.uf,
    ddd_telefone_1: tel[0] ? (tel[0].ddd || "") + (tel[0].numero || "") : "",
    ddd_telefone_2: tel[1] ? (tel[1].ddd || "") + (tel[1].numero || "") : "",
    email: d.email || "",
    qsa: (d.QSA || []).map((s) => ({
      nome_socio: s.nome_socio,
      cnpj_cpf_do_socio: s.cnpj_cpf_socio,
      qualificacao_socio: s.qualificacao_socio,
      data_entrada_sociedade: s.data_entrada_sociedade,
    })),
  };
}

// CNPJá (open): nomes em inglês.
async function viaCnpja(cnpj) {
  const r = await fetchComTimeout(`https://open.cnpja.com/office/${cnpj}`);
  if (!r.ok) return null;
  const d = await r.json();
  const co = d.company || {}, ad = d.address || {};
  return {
    _fonte: "CNPJá",
    cnpj: d.taxId,
    razao_social: co.name,
    nome_fantasia: d.alias || "",
    cnae_fiscal: d.mainActivity && d.mainActivity.id,
    cnae_fiscal_descricao: d.mainActivity && d.mainActivity.text,
    cnaes_secundarios: (d.sideActivities || []).map((a) => ({ codigo: a.id, descricao: a.text })),
    capital_social: co.equity,
    porte: co.size && (co.size.text || ""),
    opcao_pelo_simples: !!(co.simples && co.simples.optant),
    descricao_situacao_cadastral: d.status && d.status.text,
    data_inicio_atividade: d.founded,
    logradouro: ad.street, numero: ad.number, complemento: ad.details, bairro: ad.district,
    cep: ad.zip, municipio: ad.city, uf: ad.state,
    ddd_telefone_1: d.phones && d.phones[0] ? (d.phones[0].area || "") + (d.phones[0].number || "") : "",
    ddd_telefone_2: d.phones && d.phones[1] ? (d.phones[1].area || "") + (d.phones[1].number || "") : "",
    email: d.emails && d.emails[0] ? d.emails[0].address : "",
    qsa: (co.members || []).map((m) => ({
      nome_socio: m.person && m.person.name,
      cnpj_cpf_do_socio: m.person && m.person.taxId,
      qualificacao_socio: m.role && m.role.text,
      data_entrada_sociedade: m.since,
      faixa_etaria: m.person && m.person.age,
    })),
  };
}

async function buscarReceita(cnpj) {
  const cnpjLimpo = window.ENGINE.limparCnpj(cnpj);
  const cacheKey = "receita_" + cnpjLimpo;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const provedores = [
    ["BrasilAPI", viaBrasilAPI],
    ["Minha Receita", viaMinhaReceita],
    ["CNPJ.ws", viaCnpjWs],
    ["OpenCNPJ", viaOpenCnpj],
    ["CNPJá", viaCnpja],
  ];

  for (const [nome, fn] of provedores) {
    try {
      const d = await fn(cnpjLimpo);
      if (d && d.razao_social) {
        cacheSet(cacheKey, d);
        return d;
      }
    } catch (e) {
      console.warn("Fonte de cadastro indisponível:", nome, e);
    }
  }
  throw new Error("CNPJ não encontrado ou todas as fontes públicas estão indisponíveis no momento. Tente novamente em instantes.");
}

// ---------- Registro.br whois ----------

function extrairDominio(receita) {
  // Tenta encontrar domínio em campo `site` ou `website` da BrasilAPI.
  const site = receita.site || receita.website || receita.url || "";
  if (!site) return null;

  // Normaliza: remove protocolo e www, pega base (abc.com.br ou abc.com)
  const clean = String(site)
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .split("/")[0];

  // Valida: deve ter ao menos um ponto e terminar em .br (ou .com.br, .org.br, etc)
  if (/\.\w{2,}$/.test(clean)) return clean;
  return null;
}

async function buscarWhois(receita) {
  const dominio = extrairDominio(receita);
  if (!dominio) return null;

  const cacheKey = "whois_" + dominio;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached; // pode ser null (não encontrado)

  try {
    // Registro.br API pública: GET /v2/domain/{dominio}
    const url = `https://registro.br/api/v2/domain/${dominio}`;
    const resp = await fetch(url, { mode: "cors" });

    if (!resp.ok) {
      // Domínio não encontrado ou erro temporário
      cacheSet(cacheKey, null);
      return null;
    }

    const data = await resp.json();
    cacheSet(cacheKey, data);
    return data;
  } catch (e) {
    // Erro de rede ou CORS — fallback silencioso
    console.warn("Falha ao consultar whois:", e);
    return null;
  }
}

// ---------- Enriquecimento de telefones (fontes públicas gratuitas) ----------
//
// A BrasilAPI espelha a Receita, mas o campo de telefone costuma vir vazio ou
// desatualizado. Estas APIs públicas e gratuitas frequentemente trazem números
// que faltam — agregamos todas e deduplicamos pelo número (engine.mesclarTelefones).
//
// Todas as chamadas são best-effort: qualquer falha (CORS, rate limit, 404) é
// silenciosa e NÃO interrompe o relatório. Cada fonte tem cache próprio (24h);
// `false` em cache significa "já consultei e não veio nada" (evita refazer).
//
// Gancho futuro (pago): Econodata/Casa dos Dados entram aqui como mais uma fonte
// em `coletarTelefones`, devolvendo objetos no mesmo formato de `montarTel`.

const VAZIO = { telefones: [], emails: [] };

function montarTel(numero, fonte) {
  return window.ENGINE.montarTelefone(numero, fonte);
}

async function fetchJsonSeguro(url, opts) {
  try {
    const resp = await fetch(url, opts);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.warn("Fonte de telefone indisponível:", url, e);
    return null;
  }
}

// Lê do cache; se ausente, busca via `fetcher`, guarda e devolve. Armazena
// `false` quando a fonte respondeu sem dados úteis, para não reconsultar.
async function fonteComCache(cacheKey, fetcher) {
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached || null;
  const data = await fetcher();
  cacheSet(cacheKey, data || false);
  return data || null;
}

// CNPJ.ws (base pública) — generosa, sem auth. Estabelecimento traz ddd1/telefone1…
async function telefonesCnpjWs(cnpj) {
  const data = await fonteComCache("cnpjws_" + cnpj, () =>
    fetchJsonSeguro(`https://publica.cnpj.ws/cnpj/${cnpj}`));
  if (!data) return VAZIO;
  const est = data.estabelecimento || {};
  const telefones = [
    est.ddd1 && est.telefone1 ? montarTel(est.ddd1 + est.telefone1, "CNPJ.ws") : null,
    est.ddd2 && est.telefone2 ? montarTel(est.ddd2 + est.telefone2, "CNPJ.ws") : null,
  ].filter(Boolean);
  const emails = (Array.isArray(est.email) ? est.email : [est.email]).filter(Boolean);
  return { telefones, emails };
}

// Minha Receita — espelho da base do CNPJ, mesmo shape da BrasilAPI.
async function telefonesMinhaReceita(cnpj) {
  const data = await fonteComCache("minharec_" + cnpj, () =>
    fetchJsonSeguro(`https://minhareceita.org/${cnpj}`));
  if (!data) return VAZIO;
  const telefones = [
    montarTel(data.ddd_telefone_1, "Minha Receita"),
    montarTel(data.ddd_telefone_2, "Minha Receita"),
  ].filter(Boolean);
  const emails = data.email ? [data.email] : [];
  return { telefones, emails };
}

// OpenCNPJ — generosa (100 req/min). Telefones em array `telefones` (com flag is_fax).
async function telefonesOpenCnpj(cnpj) {
  const data = await fonteComCache("opencnpj_" + cnpj, () =>
    fetchJsonSeguro(`https://api.opencnpj.org/${cnpj}`));
  if (!data) return VAZIO;
  const telefones = (Array.isArray(data.telefones) ? data.telefones : [])
    .filter((t) => !t.is_fax)
    .map((t) => montarTel((t.ddd || "") + (t.numero || ""), "OpenCNPJ"))
    .filter(Boolean);
  const emails = data.email ? [data.email] : [];
  return { telefones, emails };
}

// CNPJá (open) — phones com tipo (LANDLINE/MOBILE) e emails estruturados.
async function telefonesCnpja(cnpj) {
  const data = await fonteComCache("cnpja_" + cnpj, () =>
    fetchJsonSeguro(`https://open.cnpja.com/office/${cnpj}`));
  if (!data) return VAZIO;
  const telefones = (Array.isArray(data.phones) ? data.phones : [])
    .map((p) => montarTel((p.area || "") + (p.number || ""), "CNPJá"))
    .filter(Boolean);
  const emails = (Array.isArray(data.emails) ? data.emails : [])
    .map((e) => e && e.address).filter(Boolean);
  return { telefones, emails };
}

// ReceitaWS — limite de 3 req/min; usada só como reforço. Campo `telefone`
// pode trazer vários números separados por "/".
async function telefonesReceitaWs(cnpj) {
  const data = await fonteComCache("receitaws_" + cnpj, () =>
    fetchJsonSeguro(`https://receitaws.com.br/v1/cnpj/${cnpj}`));
  if (!data || data.status === "ERROR") return VAZIO;
  const telefones = String(data.telefone || "")
    .split(/[/;]/)
    .map((p) => montarTel(p, "ReceitaWS"))
    .filter(Boolean);
  const emails = data.email ? [data.email] : [];
  return { telefones, emails };
}

/**
 * Agrega telefones/e-mails de todas as fontes gratuitas. Consulta CNPJ.ws,
 * Minha Receita, OpenCNPJ e CNPJá em paralelo (generosas); ReceitaWS (limite
 * 3/min) só entra como reforço quando ainda não encontramos um celular — o
 * número mais valioso para prospecção. Devolve `{ telefones: [detalhe…], emails }`.
 */
async function coletarTelefones(cnpj) {
  const cnpjLimpo = window.ENGINE.limparCnpj(cnpj);

  const fontes = await Promise.all([
    telefonesCnpjWs(cnpjLimpo).catch(() => VAZIO),
    telefonesMinhaReceita(cnpjLimpo).catch(() => VAZIO),
    telefonesOpenCnpj(cnpjLimpo).catch(() => VAZIO),
    telefonesCnpja(cnpjLimpo).catch(() => VAZIO),
  ]);

  let telefones = fontes.flatMap((f) => f.telefones);
  let emails = fontes.flatMap((f) => f.emails);

  if (!telefones.some((t) => t.tipo === "celular")) {
    const c = await telefonesReceitaWs(cnpjLimpo).catch(() => VAZIO);
    telefones = telefones.concat(c.telefones);
    emails = emails.concat(c.emails);
  }

  return { telefones, emails };
}

window.API = { buscarReceita, buscarWhois, coletarTelefones };
