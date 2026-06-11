/**
 * Orquestrador principal.
 * Conecta o DOM, dispara consultas e renderiza o relatório (via window.RENDER).
 */

(function () {
  "use strict";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);

  // Helpers de formatação compartilhados (util.js).
  const { escapeHtml, fmtParticipacao } = window.UTIL;

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

  // ---------- Renderização do relatório ----------
  // O HTML é montado em render.js; aqui injetamos no DOM e ligamos os botões.
  function renderRelatorio(contexto, teses, narrativa, risco, whois, transparencia, processos, econodata) {
    const { html, top, narrativaTexto } = window.RENDER.relatorio(
      contexto, teses, narrativa, risco, whois, transparencia, processos, econodata
    );
    reportContainer.innerHTML = html;

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
    reportContainer.querySelectorAll("[data-locked-cta]").forEach((btn) => {
      btn.addEventListener("click", () => abrirModal());
    });

    showReport();
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
