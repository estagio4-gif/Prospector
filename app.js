/**
 * Orquestrador principal.
 * Conecta o DOM, dispara consultas e renderiza o relatório.
 */

(function () {
  "use strict";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);

  const form = $("formCnpj");
  const cnpjInput = $("cnpjInput");
  const faturamentoInput = $("faturamentoInput");
  const btnAnalisar = $("btnAnalisar");
  const statusBox = $("statusBox");
  const statusMsg = $("statusMsg");
  const reportContainer = $("reportContainer");
  const exemploChips = $("exemploChips");
  const btnTheme = $("btnTheme");

  const configModal = $("configModal");
  const btnConfig = $("btnConfig");
  const closeConfig = $("closeConfig");
  const closeConfig2 = $("closeConfig2");
  const saveConfig = $("saveConfig");
  const apiKeyInput = $("apiKeyInput");
  const usarIA = $("usarIA");
  const transpProxyInput = $("transpProxyInput");
  const procProxyInput = $("procProxyInput");
  const econoProxyInput = $("econoProxyInput");
  const limparCacheBtn = $("limparCache");

  const btnMetricas = $("btnMetricas");
  const metricasModal = $("metricasModal");
  const closeMetricas = $("closeMetricas");
  const copiarMetricas = $("copiarMetricas");
  const zerarMetricas = $("zerarMetricas");
  const metricasBody = $("metricasBody");

  // ---------- Config (localStorage) ----------
  const CFG = {
    get apiKey() { return localStorage.getItem("prosp_anthropic_key") || ""; },
    set apiKey(v) { v ? localStorage.setItem("prosp_anthropic_key", v) : localStorage.removeItem("prosp_anthropic_key"); },
    get usarIA() { return localStorage.getItem("prosp_usar_ia") !== "0"; },
    set usarIA(v) { localStorage.setItem("prosp_usar_ia", v ? "1" : "0"); },
    get theme() { return localStorage.getItem("prosp_theme") || "light"; },
    set theme(v) { localStorage.setItem("prosp_theme", v); },
    // URL do proxy do Portal da Transparência (token fica no backend, não aqui).
    get transpProxy() { return window.TRANSPARENCIA ? window.TRANSPARENCIA.getProxyUrl() : ""; },
    set transpProxy(v) { if (window.TRANSPARENCIA) window.TRANSPARENCIA.setProxyUrl(v); },
    get procProxy() { return window.PROCESSOS ? window.PROCESSOS.getProxyUrl() : ""; },
    set procProxy(v) { if (window.PROCESSOS) window.PROCESSOS.setProxyUrl(v); },
    get econoProxy() { return window.ECONODATA ? window.ECONODATA.getProxyUrl() : ""; },
    set econoProxy(v) { if (window.ECONODATA) window.ECONODATA.setProxyUrl(v); },
  };

  // ---------- Tema (light/dark) ----------
  function aplicarTema(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (btnTheme) {
      btnTheme.textContent = theme === "dark" ? "☀" : "🌙";
      btnTheme.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      btnTheme.title = theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro";
    }
  }
  aplicarTema(CFG.theme);
  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      const next = CFG.theme === "dark" ? "light" : "dark";
      CFG.theme = next;
      aplicarTema(next);
    });
  }

  // ---------- Máscara CNPJ ----------
  cnpjInput.addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 14);
    let f = d;
    if (d.length > 12) f = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
    else if (d.length > 8) f = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
    else if (d.length > 5) f = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
    else if (d.length > 2) f = `${d.slice(0,2)}.${d.slice(2)}`;
    e.target.value = f;
  });

  // ---------- Chips de exemplo ----------
  if (exemploChips) {
    exemploChips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const cnpj = btn.dataset.cnpj;
      if (!cnpj) return;
      cnpjInput.value = cnpj;
      cnpjInput.focus();
      analisar(cnpj);
    });
  }

  // ---------- Modal de configurações ----------
  function abrirModal() {
    apiKeyInput.value = CFG.apiKey;
    usarIA.checked = CFG.usarIA;
    if (transpProxyInput) transpProxyInput.value = CFG.transpProxy;
    if (procProxyInput) procProxyInput.value = CFG.procProxy;
    if (econoProxyInput) econoProxyInput.value = CFG.econoProxy;
    configModal.classList.remove("hidden");
  }
  function fecharModal() { configModal.classList.add("hidden"); }

  btnConfig.addEventListener("click", abrirModal);
  closeConfig.addEventListener("click", fecharModal);
  if (closeConfig2) closeConfig2.addEventListener("click", fecharModal);
  configModal.addEventListener("click", (e) => {
    if (e.target === configModal) fecharModal();
  });
  // ESC fecha o modal
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!configModal.classList.contains("hidden")) fecharModal();
    if (metricasModal && !metricasModal.classList.contains("hidden")) fecharMetricas();
  });
  saveConfig.addEventListener("click", () => {
    CFG.apiKey = apiKeyInput.value.trim();
    CFG.usarIA = usarIA.checked;
    if (transpProxyInput) CFG.transpProxy = transpProxyInput.value.trim();
    if (procProxyInput) CFG.procProxy = procProxyInput.value.trim();
    if (econoProxyInput) CFG.econoProxy = econoProxyInput.value.trim();
    fecharModal();
    setStatus("Configurações salvas.", false);
    setTimeout(() => statusBox.classList.add("hidden"), 1500);
  });

  // ---------- Limpar cache de consultas ----------
  // Apaga só os dados em cache; preserva config (chaves, proxies, tema) e métricas.
  function limparCacheConsultas() {
    const preservar = new Set([
      "prosp_anthropic_key", "prosp_usar_ia", "prosp_theme",
      "prosp_transp_proxy", "prosp_proc_proxy", "prosp_econo_proxy",
      "prosp_metrics",
    ]);
    let n = 0;
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith("prosp_") && !preservar.has(k)) { localStorage.removeItem(k); n++; }
    });
    return n;
  }
  if (limparCacheBtn) limparCacheBtn.addEventListener("click", () => {
    const n = limparCacheConsultas();
    const o = limparCacheBtn.innerHTML;
    limparCacheBtn.innerHTML = `✓ ${n} item(ns) de cache limpo(s)`;
    setTimeout(() => { limparCacheBtn.innerHTML = o; }, 1800);
  });

  // ---------- Modal de métricas (piloto) ----------
  function abrirMetricas() {
    if (metricasBody && window.METRICAS) metricasBody.textContent = window.METRICAS.texto();
    if (metricasModal) metricasModal.classList.remove("hidden");
  }
  function fecharMetricas() { if (metricasModal) metricasModal.classList.add("hidden"); }
  if (btnMetricas) btnMetricas.addEventListener("click", abrirMetricas);
  if (closeMetricas) closeMetricas.addEventListener("click", fecharMetricas);
  if (metricasModal) metricasModal.addEventListener("click", (e) => { if (e.target === metricasModal) fecharMetricas(); });
  if (copiarMetricas) copiarMetricas.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.METRICAS.texto());
      const o = copiarMetricas.innerHTML; copiarMetricas.innerHTML = "✓ Copiado";
      setTimeout(() => { copiarMetricas.innerHTML = o; }, 1500);
    } catch (e) { console.warn("Falha ao copiar métricas:", e); }
  });
  if (zerarMetricas) zerarMetricas.addEventListener("click", () => {
    if (window.METRICAS) { window.METRICAS.limpar(); abrirMetricas(); }
  });

  // ---------- Helpers de UI ----------
  function setStatus(msg, loading = true) {
    statusMsg.textContent = msg;
    statusBox.classList.remove("hidden");
    statusBox.querySelector(".loader").style.display = loading ? "" : "none";
  }
  function hideStatus() { statusBox.classList.add("hidden"); }
  function clearReport() { reportContainer.innerHTML = ""; reportContainer.classList.add("hidden"); }
  function showReport() { reportContainer.classList.remove("hidden"); }

  function showError(msg) {
    clearReport();
    reportContainer.innerHTML = `<div class="error-box">${escapeHtml(msg)}</div>`;
    showReport();
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function fmtBRL(n) {
    if (n == null || isNaN(n)) return "—";
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
  }

  function fmtData(s) {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString("pt-BR");
  }

  function classeTeseItem(score) {
    if (score >= 70) return "high";
    if (score >= 40) return "mid";
    return "low";
  }

  function iniciais(nome) {
    if (!nome) return "?";
    const partes = String(nome).trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return "?";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  function fmtParticipacao(p) {
    if (p == null || isNaN(p)) return "";
    // BrasilAPI traz como número (ex: 50.00) ou string ("50.00")
    return `${Number(p).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  }

  function renderSocios(socios) {
    if (!socios || !socios.length) {
      return `<p class="hint">Quadro societário não informado para este CNPJ.</p>`;
    }
    // Decisores primeiro
    const ordenados = [...socios].sort((a, b) => {
      if (a.decisor !== b.decisor) return a.decisor ? -1 : 1;
      const pa = a.participacao ?? -1;
      const pb = b.participacao ?? -1;
      return pb - pa;
    });
    return ordenados.map((s) => {
      const tag = s.decisor
        ? `<span class="socio-tag">Decisor</span>`
        : "";
      const participacao = s.participacao != null
        ? `<span class="socio-participacao">${fmtParticipacao(s.participacao)}</span>`
        : "";
      const desde = s.desde ? `desde ${fmtData(s.desde)}` : "";
      const metaParts = [s.qualificacao, desde, participacao].filter(Boolean);
      return `
        <div class="socio-card ${s.decisor ? "decisor" : ""}">
          <div class="socio-avatar">${escapeHtml(iniciais(s.nome))}</div>
          <div class="socio-body">
            <div class="socio-nome" title="${escapeHtml(s.nome)}">${escapeHtml(s.nome)}</div>
            <div class="socio-meta">
              ${tag}
              ${metaParts.map((p) => typeof p === "string" ? `<span>${escapeHtml(p)}</span>` : p).join("")}
            </div>
          </div>
        </div>`;
    }).join("");
  }

  function renderContato(contato) {
    if (!contato) return "";
    const cards = [];

    // Usa o detalhe com tipo/fonte quando disponível; cai para strings simples.
    const telsDet = (contato.telefonesDetalhe && contato.telefonesDetalhe.length)
      ? contato.telefonesDetalhe
      : (contato.telefones || []).map((f) => ({
          formatado: f, raw: f.replace(/\D/g, ""), tipo: "desconhecido", whatsapp: false, fonte: "",
        }));

    if (telsDet.length) {
      const tels = telsDet.map((t) => {
        const raw = t.raw || (t.formatado || "").replace(/\D/g, "");
        const tagLabel = t.tipo === "celular" ? "Celular" : t.tipo === "fixo" ? "Fixo" : "";
        const tag = tagLabel
          ? `<span class="contato-tag contato-tag-${t.tipo}">${tagLabel}</span>` : "";
        const wa = t.whatsapp
          ? ` <a class="contato-wa" href="https://wa.me/55${raw}" target="_blank" rel="noopener">WhatsApp</a>` : "";
        // #8 — confiança: nº de fontes que confirmaram o mesmo número.
        const nFontes = t.fonte ? t.fonte.split(" + ").filter(Boolean).length : 0;
        const conf = nFontes > 1
          ? `<span class="contato-conf" title="Número confirmado por ${nFontes} fontes independentes">✓ ${nFontes} fontes</span>` : "";
        const fonte = t.fonte
          ? `<span class="contato-fonte" title="Fonte do número">${escapeHtml(t.fonte)}</span>` : "";
        return `<div class="contato-valor"><a href="tel:+55${raw}">${escapeHtml(t.formatado)}</a>${tag}${conf}${wa}${fonte}</div>`;
      }).join("");
      cards.push(`
        <div class="contato-card">
          <div class="contato-icon">📞</div>
          <div class="contato-body">
            <div class="contato-label">Telefones (${telsDet.length})</div>
            ${tels}
          </div>
        </div>`);
    }

    const emails = (contato.emails && contato.emails.length)
      ? contato.emails
      : (contato.email ? [contato.email] : []);
    if (emails.length) {
      const mails = emails.map((e) =>
        `<div class="contato-valor"><a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a></div>`
      ).join("");
      cards.push(`
        <div class="contato-card">
          <div class="contato-icon">✉</div>
          <div class="contato-body">
            <div class="contato-label">E-mail${emails.length > 1 ? "s" : ""}</div>
            ${mails}
          </div>
        </div>`);
    }
    if (contato.endereco || contato.municipio) {
      const linha = contato.endereco
        || `${contato.municipio || ""}${contato.uf ? "/" + contato.uf : ""}`;
      cards.push(`
        <div class="contato-card">
          <div class="contato-icon">📍</div>
          <div class="contato-body">
            <div class="contato-label">Endereço</div>
            <div class="contato-valor">${escapeHtml(linha)}</div>
          </div>
        </div>`);
    }
    if (!cards.length) {
      return `<p class="hint">Contato cadastral não informado para este CNPJ.</p>`;
    }
    return `<div class="contato-grid">${cards.join("")}</div>`;
  }

  function renderLocked(titulo, descricao, ctaTexto) {
    return `
      <div class="locked-section">
        <div class="locked-icon">🔒</div>
        <div class="locked-title">${escapeHtml(titulo)}</div>
        <div class="locked-desc">${escapeHtml(descricao)}</div>
        <button class="locked-cta" type="button" data-locked-cta>${escapeHtml(ctaTexto)}</button>
      </div>`;
  }

  function renderDominio(whois) {
    if (!whois) {
      return `<p class="hint">Sem domínio registrado no Registro.br para esta empresa, ou não foi possível consultar.</p>`;
    }

    const dominio = whois.fqdn || whois.domain || whois.name || "—";
    const statusRaw = String(whois.status || whois["publication-status"] || "outro").toLowerCase();
    const statusClass = /publica|active|ativ/i.test(statusRaw)
      ? "publicado"
      : /expir|suspens/i.test(statusRaw) ? "expirado" : "outro";
    const statusLabel = statusClass === "publicado" ? "Ativo"
      : statusClass === "expirado" ? "Expirado/Suspenso" : (whois.status || "—");

    const expira = whois.expires_at || whois.expiration_date || whois["expiration-date"] || "";
    const criado = whois.created_at || whois.creation_date || whois["creation-date"] || "";
    const owner = whois.owner || whois.contact || "";

    const meta = [];
    if (criado) meta.push(`Criado em ${fmtData(criado)}`);
    if (expira) meta.push(`Expira em ${fmtData(expira)}`);
    if (owner && typeof owner === "string") meta.push(`Titular: ${owner}`);

    return `
      <div class="dominio-card">
        <div class="dominio-icon">🌐</div>
        <div class="dominio-body">
          <div class="dominio-nome">
            <a href="https://${escapeHtml(dominio)}" target="_blank" rel="noopener">${escapeHtml(dominio)}</a>
            <span class="dominio-status ${statusClass}">${escapeHtml(statusLabel)}</span>
          </div>
          ${meta.length ? `<div class="dominio-meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('<span class="subtitle-sep">·</span>')}</div>` : ""}
        </div>
      </div>`;
  }

  function renderRisco(risco) {
    if (!risco) return "";
    const iconePorTipo = { risco: "!", alerta: "?", positivo: "✓" };
    const labelPorNivel = {
      baixo: "Lead saudável",
      moderado: "Lead viável com ressalvas",
      alto: "Lead com sinais de risco",
    };

    const flagsHtml = risco.flags.map((f) => `
      <div class="flag-item tipo-${f.tipo}">
        <div class="flag-icon">${iconePorTipo[f.tipo] || "i"}</div>
        <div class="flag-body">
          <div class="flag-titulo">${escapeHtml(f.titulo)}</div>
          <div class="flag-descricao">${escapeHtml(f.descricao)}</div>
        </div>
      </div>`).join("");

    return `
      <div class="risco-header nivel-${risco.nivel}">
        <div class="risco-medidor nivel-${risco.nivel}">${risco.score}</div>
        <div class="risco-body">
          <div class="risco-nivel">Perfil de risco · ${escapeHtml(risco.nivel)}</div>
          <div class="risco-titulo">${escapeHtml(labelPorNivel[risco.nivel] || "Análise")}</div>
          <div class="risco-recomendacao">${escapeHtml(risco.recomendacao)}</div>
        </div>
      </div>
      ${risco.flags.length ? `<div class="flags-list">${flagsHtml}</div>` : `<p class="hint">Nenhum sinal de atenção identificado.</p>`}
    `;
  }

  function renderTransparencia(transp) {
    if (!transp) return "";
    const fmt = window.ENGINE.formatBRL;
    const blocos = [];

    const sancoes = transp.sancoes || [];
    if (sancoes.length) {
      const itens = sancoes.map((s) => {
        const periodo = [s.inicio, s.fim].filter(Boolean).join(" – ");
        const meta = [s.orgao, periodo].filter(Boolean).join(" · ");
        return `
          <div class="transp-sancao">
            <span class="transp-badge transp-badge-${escapeHtml(s.fonte.toLowerCase())}">${escapeHtml(s.fonte)}</span>
            <div class="transp-sancao-body">
              <div class="transp-sancao-tipo">${escapeHtml(s.tipo || "Sanção")}</div>
              ${meta ? `<div class="transp-sancao-meta">${escapeHtml(meta)}</div>` : ""}
            </div>
          </div>`;
      }).join("");
      blocos.push(`
        <div class="transp-bloco transp-risco">
          <div class="transp-bloco-titulo">⚠ Sanções (${sancoes.length})</div>
          ${itens}
        </div>`);
    }

    const c = transp.contratos || {};
    if (c.quantidade > 0) {
      const linhas = (c.recentes || []).map((ct) => {
        const detalhe = [ct.orgao, ct.objeto].filter(Boolean).join(" — ");
        return `
          <div class="transp-contrato">
            <div class="transp-contrato-valor">${ct.valor ? fmt(ct.valor) : "—"}</div>
            <div class="transp-contrato-det">${escapeHtml(detalhe || "Contrato federal")}</div>
          </div>`;
      }).join("");
      blocos.push(`
        <div class="transp-bloco transp-positivo">
          <div class="transp-bloco-titulo">🏛 Contratos federais — ${c.quantidade} · total ~${fmt(c.valorTotal)}</div>
          <p class="hint" style="margin:2px 0 8px;">Proxy de faturamento e formalidade. Maiores contratos:</p>
          ${linhas}
        </div>`);
    }

    if (!blocos.length) {
      return `<p class="hint">Nada encontrado no Portal da Transparência para este CNPJ (sem sanções nem contratos federais).</p>`;
    }
    return `<div class="transp-grid">${blocos.join("")}</div>`;
  }

  function renderProcessos(proc) {
    if (!proc) return "";
    if (!proc.total) {
      return `<p class="hint">Nenhum processo localizado para este CNPJ na base consultada.</p>`;
    }
    const linhas = (proc.processos || []).slice(0, 8).map((p) => {
      const ass = (p.assuntos || []).join(", ");
      const polo = p.polo === "ATIVO" ? "Autora" : p.polo === "PASSIVO" ? "Ré" : "";
      const meta = [p.tribunal, p.classe, polo, p.status].filter(Boolean).join(" · ");
      return `
        <div class="proc-item">
          <div class="proc-num">${escapeHtml(p.numero || "—")}</div>
          <div class="proc-det">${escapeHtml([ass, meta].filter(Boolean).join(" — ") || "Processo")}</div>
        </div>`;
    }).join("");
    return `
      <div class="proc-resumo">${proc.total} processo(s) · ${proc.comoAutor} como autora · ${proc.comoReu} como ré</div>
      <div class="proc-list">${linhas}</div>`;
  }

  // Link para a Junta Comercial do estado — fonte oficial (fé pública) do capital.
  function linkJunta(uf) {
    const j = window.JUNTAS ? window.JUNTAS.porUF(uf) : null;
    if (!j) return "";
    return `<div class="fact-fonte">Confirmar na fonte oficial: <a href="${j.url}" target="_blank" rel="noopener" title="${escapeHtml(j.nome)} — emitir certidão simplificada">${escapeHtml(j.sigla)} · certidão simplificada ↗</a></div>`;
  }

  function renderEconodata(e) {
    if (!e || e.erro) return "";
    const cards = [];

    if (e.decisores && e.decisores.length) {
      const lis = e.decisores.slice(0, 6).map((d) => {
        const cargo = [d.cargo, d.nivel].filter(Boolean).join(" · ");
        const li = d.linkedin ? ` · <a href="${escapeHtml(d.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : "";
        return `<div class="econo-decisor"><span class="econo-nome">${escapeHtml(d.nome || "—")}</span>${cargo ? ` <span class="econo-cargo">${escapeHtml(cargo)}</span>` : ""}${li}</div>`;
      }).join("");
      cards.push(`<div class="econo-bloco"><div class="econo-titulo">👤 Decisores</div>${lis}</div>`);
    }

    if (e.telefones && e.telefones.length) {
      const tl = e.telefones.slice(0, 5).map((t) => {
        const raw = (t.numero || "").replace(/\D/g, "");
        const tag = t.assertividade ? `<span class="contato-tag contato-tag-${t.assertividade === "alta" ? "celular" : "fixo"}">${escapeHtml(t.assertividade)}</span>` : "";
        return `<div class="contato-valor"><a href="tel:+55${raw}">${escapeHtml(t.numero)}</a> ${tag}</div>`;
      }).join("");
      cards.push(`<div class="econo-bloco"><div class="econo-titulo">📞 Telefones (por assertividade)</div>${tl}</div>`);
    }

    if (e.emails && e.emails.length) {
      const el = e.emails.slice(0, 5).map((m) =>
        `<div class="contato-valor"><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a>${m.assertividade ? ` <span class="econo-cargo">${escapeHtml(m.assertividade)}</span>` : ""}</div>`
      ).join("");
      cards.push(`<div class="econo-bloco"><div class="econo-titulo">✉ E-mails enriquecidos</div>${el}</div>`);
    }

    const facts = [];
    if (e.faturamentoTexto) facts.push(`<div class="fact"><div class="fact-label">Faturamento presumido</div><div class="fact-value">${escapeHtml(e.faturamentoTexto)}</div></div>`);
    if (e.funcionariosTexto) facts.push(`<div class="fact"><div class="fact-label">Funcionários (estim.)</div><div class="fact-value">${escapeHtml(e.funcionariosTexto)}</div></div>`);
    if (e.porteEstimado) facts.push(`<div class="fact"><div class="fact-label">Porte estimado</div><div class="fact-value">${escapeHtml(e.porteEstimado)}</div></div>`);
    if (e.regimeTributario) facts.push(`<div class="fact"><div class="fact-label">Regime tributário</div><div class="fact-value">${escapeHtml(e.regimeTributario)}</div></div>`);
    if (e.setorAmigavel) facts.push(`<div class="fact"><div class="fact-label">Setor</div><div class="fact-value">${escapeHtml(e.setorAmigavel)}</div></div>`);
    if (e.pat && e.pat.funcionarios) facts.push(`<div class="fact"><div class="fact-label">PAT — funcionários</div><div class="fact-value">${escapeHtml(String(e.pat.funcionarios))}</div></div>`);
    const factsHtml = facts.length ? `<div class="fact-grid">${facts.join("")}</div>` : "";

    if (!cards.length && !factsHtml) return `<p class="hint">Sem dados de enriquecimento para este CNPJ.</p>`;
    return `${factsHtml}${cards.length ? `<div class="econo-grid">${cards.join("")}</div>` : ""}`;
  }

  // Site + redes sociais — não depende do whois (que costuma vir vazio e mostra
  // o titular do registro, às vezes uma agência). Usa site da Econodata + domínio
  // do e-mail + deep-links de busca.
  function renderSiteRedes(contexto, econodata) {
    const nome = contexto.nomeFantasia || contexto.razaoSocial || "";
    const sites = new Set();
    if (econodata && Array.isArray(econodata.sites)) econodata.sites.forEach((s) => s && sites.add(s));

    // Domínio do e-mail (cadastral + Econodata), excluindo provedores genéricos.
    const provGen = /(gmail|hotmail|outlook|yahoo|bol|uol|terra|icloud|live|msn)\./i;
    const emails = [];
    if (contexto.contato) {
      (contexto.contato.emails || []).forEach((e) => emails.push(e));
      if (contexto.contato.email) emails.push(contexto.contato.email);
    }
    if (econodata && econodata.emails) econodata.emails.forEach((e) => emails.push(e.email));
    emails.forEach((em) => {
      const dom = String(em || "").split("@")[1];
      if (dom && !provGen.test(dom)) sites.add(dom.toLowerCase().trim());
    });

    const siteList = Array.from(sites)
      .map((s) => s.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").trim())
      .filter(Boolean);
    const siteUnique = Array.from(new Set(siteList)).slice(0, 5);

    const sitesHtml = siteUnique.length
      ? siteUnique.map((s) => `<div class="contato-valor"><a href="https://${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)} ↗</a></div>`).join("")
      : `<p class="hint">Site não identificado em fontes diretas — use os botões de busca.</p>`;

    const r = (econodata && econodata.redes) || {};
    const q = encodeURIComponent(nome);
    const btns = [];
    btns.push(`<a class="rede-btn" href="${escapeHtml(r.linkedin || `https://www.linkedin.com/search/results/companies/?keywords=${q}`)}" target="_blank" rel="noopener">in LinkedIn</a>`);
    btns.push(`<a class="rede-btn" href="${escapeHtml(r.instagram || `https://www.google.com/search?q=${q}+site:instagram.com`)}" target="_blank" rel="noopener">◎ Instagram</a>`);
    if (r.facebook) btns.push(`<a class="rede-btn" href="${escapeHtml(r.facebook)}" target="_blank" rel="noopener">f Facebook</a>`);
    btns.push(`<a class="rede-btn" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">G Buscar</a>`);

    return `
      <div class="contato-card">
        <div class="contato-icon">🌐</div>
        <div class="contato-body">
          <div class="contato-label">Site${siteUnique.length > 1 ? "s" : ""}</div>
          ${sitesHtml}
        </div>
      </div>
      <div class="rede-row">${btns.join("")}</div>`;
  }

  // ---------- Renderização do relatório ----------
  function renderRelatorio(contexto, teses, narrativa, risco, whois, transparencia, processos, econodata) {
    const top = teses.slice(0, 8);
    const faturamento = contexto.faturamentoInformado || 0;
    let totalCentral = 0;
    const tesesHtml = top.map((t) => {
      const sc = window.ENGINE.classificarScore(t.score);
      const est = window.ENGINE.estimarCreditoTese(t.id, faturamento);
      let estHtml = "";
      if (est && !t.jaAjuizada) {
        if (t.score >= 40) totalCentral += est.central;
        estHtml = `<div class="tese-credito">≈ Crédito potencial (5 anos): <strong>${fmtBRL(est.min)} – ${fmtBRL(est.max)}</strong></div>`;
      }
      const ajuizadaBadge = t.jaAjuizada
        ? `<span class="tese-ajuizada" title="${t.processoRef ? "Processo " + escapeHtml(t.processoRef) : "Processo localizado"}">⚖ Já ajuizada${t.ajuizadaComoAutor ? " (autora)" : ""}</span>`
        : "";
      return `
        <div class="tese-item ${classeTeseItem(t.score)} ${t.jaAjuizada ? "tese-ja-ajuizada" : ""}">
          <div class="tese-head">
            <div class="tese-title">${escapeHtml(t.titulo)} ${ajuizadaBadge}</div>
            <span class="tese-score ${sc.classe}">${t.score} · ${sc.label}</span>
          </div>
          <div class="tese-desc">${escapeHtml(t.descricao)}</div>
          <div class="tese-meta">Prescrição típica: 5 anos · ID: ${t.id}</div>
          ${estHtml}
        </div>`;
    }).join("");

    // Cabeçalho de crédito potencial (só quando o faturamento foi informado).
    const creditoResumoHtml = faturamento
      ? `<div class="credito-resumo">
           <div class="credito-resumo-valor">Potencial agregado (teses ≥ 40): <strong>${fmtBRL(totalCentral * 0.6)} – ${fmtBRL(totalCentral * 1.4)}</strong></div>
           <p class="hint" style="margin:4px 0 0;">Estimativa grosseira de ordem de grandeza sobre faturamento informado de ${fmtBRL(faturamento)}/ano × 5 anos. <strong>Não é cálculo de crédito</strong> — confirmar com SPED/escrituração.</p>
         </div>`
      : "";

    const situacaoBadge = /ATIV/i.test(contexto.situacao)
      ? `<span class="badge badge-ok">${escapeHtml(contexto.situacao)}</span>`
      : `<span class="badge badge-danger">${escapeHtml(contexto.situacao)}</span>`;

    const regimeBadge = contexto.regimeConfianca > 0.7
      ? `<span class="badge badge-ok">${contexto.regime}</span>`
      : `<span class="badge badge-warn">${contexto.regime} (estimado)</span>`;

    // Monta a narrativa de forma robusta (sem linhas vazias se algum campo faltar)
    const narrativaPartes = [
      narrativa.abertura,
      narrativa.racional,
      narrativa.abordagem ? "Sugestão de abordagem: " + narrativa.abordagem : "",
    ].filter(Boolean);
    const narrativaTexto = narrativaPartes.join("\n\n");

    reportContainer.innerHTML = `
      <article class="report">
        <header class="report-header">
          <h3>${escapeHtml(contexto.razaoSocial)}</h3>
          <div class="subtitle">
            <span>${escapeHtml(contexto.cnpj)}</span>
            <span class="subtitle-sep">·</span>
            <span>${escapeHtml(contexto.municipio)}/${escapeHtml(contexto.uf)}</span>
            <span class="subtitle-sep">·</span>
            ${situacaoBadge} ${regimeBadge}
          </div>
        </header>

        <div class="report-actions">
          <button class="btn-ghost" id="btnCopy" type="button">📋 Copiar resumo</button>
          <button class="btn-ghost" id="btnPrint" type="button">🖨 Imprimir / PDF</button>
          <button class="btn-ghost" id="btnNew" type="button">↻ Nova análise</button>
        </div>

        <section class="report-section">
          <h4>Resumo da análise</h4>
          <div class="narrative">${escapeHtml(narrativaTexto)}</div>
        </section>

        <section class="report-section">
          <h4>Perfil de risco do lead <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(análise local)</span></h4>
          ${renderRisco(risco)}
        </section>

        <section class="report-section">
          <h4>Dados cadastrais</h4>
          <div class="fact-grid">
            <div class="fact"><div class="fact-label">Nome Fantasia</div><div class="fact-value">${escapeHtml(contexto.nomeFantasia || "—")}</div></div>
            <div class="fact"><div class="fact-label">Setor</div><div class="fact-value">${escapeHtml(contexto.setor)}</div></div>
            <div class="fact"><div class="fact-label">CNAE Principal</div><div class="fact-value">${escapeHtml(contexto.cnae || "—")}${contexto.cnaeDescricao ? " — " + escapeHtml(contexto.cnaeDescricao) : ""}</div></div>
            <div class="fact"><div class="fact-label">Porte</div><div class="fact-value">${escapeHtml(contexto.porte)}</div></div>
            <div class="fact"><div class="fact-label">Capital Social</div><div class="fact-value">${fmtBRL(contexto.capital)}${linkJunta(contexto.uf)}</div></div>
            <div class="fact"><div class="fact-label">Abertura</div><div class="fact-value">${fmtData(contexto.dataAbertura)} (${contexto.tempoExistenciaAnos} anos)</div></div>
          </div>
        </section>

        <section class="report-section">
          <h4>Perfil tributário inferido</h4>
          <div class="fact-grid">
            <div class="fact"><div class="fact-label">Folha intensiva?</div><div class="fact-value">${contexto.perfil.foliaIntensiva ? "Sim (típico do setor)" : "Não tipicamente"}</div></div>
            <div class="fact"><div class="fact-label">Usa insumos (PIS/COFINS)?</div><div class="fact-value">${contexto.perfil.usaInsumos ? "Sim" : "Não tipicamente"}</div></div>
            <div class="fact"><div class="fact-label">Sujeito a ICMS-ST?</div><div class="fact-value">${contexto.perfil.sujeitoST ? "Possivelmente" : "Não tipicamente"}</div></div>
            <div class="fact"><div class="fact-label">Setor exportador?</div><div class="fact-value">${contexto.perfil.exportador ? "Possivelmente" : "Não tipicamente"}</div></div>
          </div>
        </section>

        <section class="report-section">
          <h4>Quadro societário <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Receita Federal)</span></h4>
          <div class="socios-list">${renderSocios(contexto.socios)}</div>
        </section>

        <section class="report-section">
          <h4>Contato <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Receita + fontes públicas)</span></h4>
          ${renderContato(contexto.contato)}
        </section>

        <section class="report-section">
          <h4>Site &amp; presença online <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Econodata + e-mail + busca)</span></h4>
          ${renderSiteRedes(contexto, econodata)}
        </section>
${transparencia ? `
        <section class="report-section">
          <h4>Relacionamento com o setor público <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Portal da Transparência · CGU)</span></h4>
          ${renderTransparencia(transparencia)}
        </section>` : ""}
${processos ? `
        <section class="report-section">
          <h4>Processos / litígio já ajuizado <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Jusbrasil)</span></h4>
          ${renderProcessos(processos)}
        </section>` : ""}

${(econodata && !econodata.erro) ? `
        <section class="report-section">
          <h4>Decisores e contato premium <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(Econodata)</span></h4>
          ${renderEconodata(econodata)}
        </section>` : `
        <section class="report-section">
          <h4>Heads &amp; decisores <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(fonte externa)</span></h4>
          ${renderLocked(
            "C-Level e principais decisores",
            "Diretor financeiro, contábil, jurídico e tributário — incluindo LinkedIn, e-mail e função. Conecte o proxy da Econodata em Configurações para preencher.",
            "Conectar Econodata"
          )}
        </section>

        <section class="report-section">
          <h4>Contato do financeiro <span style="color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; font-size: 11.5px;">(fonte externa)</span></h4>
          ${renderLocked(
            "Departamento financeiro / fiscal",
            "Telefone e e-mail direto do financeiro/fiscal/contabilidade. Conecte o proxy da Econodata em Configurações para preencher.",
            "Conectar Econodata"
          )}
        </section>`}

        <section class="report-section">
          <h4>Teses tributárias aderentes (ranqueadas)</h4>
          ${creditoResumoHtml}
          <div class="tese-list">${tesesHtml || '<p class="hint">Nenhuma tese com aderência relevante para este perfil.</p>'}</div>
        </section>

        <section class="report-section">
          <h4>Ações sugeridas</h4>
          <ul class="action-list">
            <li>Solicitar acesso a SPED Contribuições e folha de pagamento dos últimos 5 anos para apuração precisa.</li>
            <li>Confirmar regime tributário efetivo via consulta de optante do Simples no Portal do Simples Nacional.</li>
            <li>Consultar passivo tributário via CARF, PGFN e Procuradorias estaduais para mapear contencioso ativo.</li>
            <li>Calcular potencial de crédito estimado e formalizar proposta de honorários de êxito.</li>
          </ul>
        </section>
      </article>
    `;

    // Botões de ação do relatório
    const btnCopy = $("btnCopy");
    const btnPrint = $("btnPrint");
    const btnNew = $("btnNew");
    if (btnCopy) btnCopy.addEventListener("click", () => copiarResumo(contexto, top, narrativaTexto, btnCopy, transparencia));
    if (btnPrint) btnPrint.addEventListener("click", () => { if (window.METRICAS) window.METRICAS.registrarEvento("impressao"); window.print(); });
    if (btnNew) btnNew.addEventListener("click", () => {
      clearReport();
      cnpjInput.value = "";
      cnpjInput.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // CTA das seções bloqueadas (heads / financeiro) — abre configurações.
    // Quando a integração com base comercial for plugada, esse CTA pode
    // disparar a busca diretamente em vez de só abrir o modal.
    reportContainer.querySelectorAll("[data-locked-cta]").forEach((btn) => {
      btn.addEventListener("click", () => abrirModal());
    });

    showReport();
    // Rola até o relatório
    setTimeout(() => reportContainer.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  // ---------- Copiar resumo em texto ----------
  async function copiarResumo(contexto, top, narrativaTexto, btn, transparencia) {
    const linhas = [
      `PROSPECTOR TRIBUTÁRIO — ${contexto.razaoSocial}`,
      `${contexto.cnpj} · ${contexto.municipio}/${contexto.uf} · ${contexto.situacao} · ${contexto.regime}`,
      ``,
      narrativaTexto,
      ``,
      `TESES ADERENTES:`,
      ...top.map((t, i) => `  ${i + 1}. [${t.score}] ${t.titulo}`),
    ];

    const decisores = (contexto.socios || []).filter((s) => s.decisor);
    if (decisores.length) {
      linhas.push(``, `DECISORES (Receita):`);
      decisores.slice(0, 5).forEach((s) => {
        const part = s.participacao != null ? ` · ${fmtParticipacao(s.participacao)}` : "";
        linhas.push(`  • ${s.nome} — ${s.qualificacao}${part}`);
      });
    }

    const c = contexto.contato || {};
    const contatoBits = [];
    if (c.telefonesDetalhe && c.telefonesDetalhe.length) {
      c.telefonesDetalhe.forEach((t) => {
        const tipo = t.tipo === "celular" ? " (celular)" : t.tipo === "fixo" ? " (fixo)" : "";
        const fonte = t.fonte ? ` [${t.fonte}]` : "";
        contatoBits.push(`Tel: ${t.formatado}${tipo}${fonte}`);
      });
    } else if (c.telefones && c.telefones.length) {
      contatoBits.push(`Tel: ${c.telefones.join(" / ")}`);
    }
    const emailsResumo = (c.emails && c.emails.length) ? c.emails : (c.email ? [c.email] : []);
    emailsResumo.forEach((e) => contatoBits.push(`E-mail: ${e}`));
    if (c.endereco) contatoBits.push(`End: ${c.endereco}`);
    if (contatoBits.length) {
      linhas.push(``, `CONTATO:`);
      contatoBits.forEach((b) => linhas.push(`  ${b}`));
    }

    if (transparencia) {
      const sancoes = transparencia.sancoes || [];
      const ct = transparencia.contratos || {};
      if (sancoes.length || ct.quantidade) {
        linhas.push(``, `SETOR PÚBLICO (Portal da Transparência):`);
        sancoes.forEach((s) => {
          const periodo = [s.inicio, s.fim].filter(Boolean).join("–");
          linhas.push(`  ⚠ ${s.fonte}: ${s.tipo}${s.orgao ? " · " + s.orgao : ""}${periodo ? " · " + periodo : ""}`);
        });
        if (ct.quantidade) {
          linhas.push(`  🏛 ${ct.quantidade} contrato(s) federal(is) · total ~${window.ENGINE.formatBRL(ct.valorTotal)}`);
        }
      }
    }

    linhas.push(``, `Gerado em ${new Date().toLocaleString("pt-BR")}`);
    const texto = linhas.join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      if (window.METRICAS) window.METRICAS.registrarEvento("copia");
      const original = btn.innerHTML;
      btn.innerHTML = "✓ Copiado";
      setTimeout(() => { btn.innerHTML = original; }, 1800);
    } catch (e) {
      console.warn("Falha ao copiar:", e);
      btn.innerHTML = "✗ Falhou";
      setTimeout(() => { btn.innerHTML = "📋 Copiar resumo"; }, 1800);
    }
  }

  // ---------- Fluxo principal ----------
  async function analisar(cnpjRaw) {
    clearReport();
    const cnpj = window.ENGINE.limparCnpj(cnpjRaw);

    if (!window.ENGINE.validarCnpj(cnpj)) {
      showError("CNPJ inválido. Verifique os dígitos verificadores.");
      hideStatus();
      return;
    }

    btnAnalisar.disabled = true;
    try {
      setStatus("Consultando dados cadastrais (fontes públicas)…");
      const receita = await window.API.buscarReceita(cnpj);

      const contexto = window.ENGINE.montarContexto(receita);
      // Faturamento anual (opcional) — habilita estimativa de crédito em R$.
      contexto.faturamentoInformado = faturamentoInput
        ? window.ENGINE.parseFaturamento(faturamentoInput.value)
        : 0;

      // Enriquecimento de telefones com fontes públicas gratuitas adicionais.
      // Best-effort: se falhar, seguimos só com o telefone cadastral da Receita.
      setStatus("Buscando telefones em fontes públicas adicionais…");
      try {
        const extras = await window.API.coletarTelefones(cnpj);
        contexto.contato = window.ENGINE.aplicarTelefonesExtras(contexto.contato, extras);
      } catch (e) {
        console.warn("Enriquecimento de telefones falhou:", e);
      }

      setStatus("Classificando setor e ranqueando teses…");
      let teses = window.ENGINE.rankearTeses(contexto);
      const top3 = teses.slice(0, 3);
      let risco = window.ENGINE.calcularRedFlags(contexto);

      // Whois é opcional — não bloqueia o relatório. Roda em paralelo com a IA.
      const whoisPromise = window.API.buscarWhois(receita).catch(() => null);

      // Portal da Transparência (sanções + contratos federais). Só roda se o
      // proxy estiver configurado. Best-effort, em paralelo, não bloqueia.
      const transpPromise = (window.TRANSPARENCIA && window.TRANSPARENCIA.disponivel())
        ? window.TRANSPARENCIA.consultar(cnpj).catch((e) => {
            console.warn("Transparência falhou:", e);
            return null;
          })
        : Promise.resolve(null);

      // Processos / litígio já ajuizado (Jusbrasil via proxy). Best-effort.
      const procPromise = (window.PROCESSOS && window.PROCESSOS.disponivel())
        ? window.PROCESSOS.consultar(cnpj).catch((e) => {
            console.warn("Processos falhou:", e);
            return null;
          })
        : Promise.resolve(null);

      // Enriquecimento premium (Econodata via proxy). Best-effort.
      const econoPromise = (window.ECONODATA && window.ECONODATA.disponivel())
        ? window.ECONODATA.consultar(cnpj).catch((e) => {
            console.warn("Econodata falhou:", e);
            return null;
          })
        : Promise.resolve(null);

      let narrativa;
      if (CFG.usarIA && CFG.apiKey) {
        setStatus("Gerando narrativa com IA (Claude Haiku)…");
        try {
          const resumo = window.ENGINE.resumoParaIA(contexto, top3);
          narrativa = await window.AI.gerarNarrativa(resumo, CFG.apiKey);
        } catch (e) {
          console.warn("IA falhou, usando template:", e);
          narrativa = window.AI.narrativaTemplate(contexto, top3);
          narrativa.abertura = "[Falha na IA — usando template] " + narrativa.abertura;
        }
      } else {
        narrativa = window.AI.narrativaTemplate(contexto, top3);
      }

      const whois = await whoisPromise;
      const transparencia = await transpPromise;
      if (transparencia) {
        risco = window.ENGINE.mesclarRiscoTransparencia(risco, transparencia);
      }

      const processos = await procPromise;
      if (processos) {
        teses = window.ENGINE.marcarTesesAjuizadas(teses, processos);
        window.ENGINE.analisarProcessos(processos).flags.forEach((f) => risco.flags.push(f));
      }

      const econodata = await econoPromise;
      // Se a Econodata trouxe faturamento (faixa) e o usuário não informou, usa o
      // limite inferior (faturamentoNum) para a estimativa de crédito.
      if (econodata && econodata.faturamentoNum && !contexto.faturamentoInformado) {
        contexto.faturamentoInformado = Number(econodata.faturamentoNum) || 0;
      }

      hideStatus();
      renderRelatorio(contexto, teses, narrativa, risco, whois, transparencia, processos, econodata);

      // Métricas (piloto) — agregados anônimos, sem CNPJ.
      if (window.METRICAS) {
        const fat = contexto.faturamentoInformado || 0;
        let totalCentral = 0;
        if (fat) {
          teses.forEach((t) => {
            if (t.score >= 40 && !t.jaAjuizada) {
              const e = window.ENGINE.estimarCreditoTese(t.id, fat);
              if (e) totalCentral += e.central;
            }
          });
        }
        window.METRICAS.registrarAnalise(contexto, teses, totalCentral, processos);
      }
    } catch (err) {
      console.error(err);
      hideStatus();
      showError(err.message || "Erro inesperado durante a análise.");
    } finally {
      btnAnalisar.disabled = false;
    }
  }

  // ---------- Eventos ----------
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    analisar(cnpjInput.value);
  });

  cnpjInput.focus();
})();
