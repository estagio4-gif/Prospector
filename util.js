/**
 * Helpers de formatação/escape compartilhados (sem DOM, sem estado).
 * Usados por render.js e app.js via `window.UTIL`.
 */
(function () {
  "use strict";

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

  window.UTIL = { escapeHtml, fmtBRL, fmtData, classeTeseItem, iniciais, fmtParticipacao };
})();
