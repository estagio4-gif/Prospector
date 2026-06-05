# -*- coding: utf-8 -*-
"""
Proxy LOCAL para testar o Prospector sem Cloudflare.

Serve, com CORS liberado, as duas rotas que o app usa:
  - Portal da Transparencia:  /api-de-dados/ceis|cnep|cepim|contratos/cpf-cnpj
  - Processos (Jusbrasil):     /processos?cnpj=XXXXXXXXXXXXXX

Os tokens ficam AQUI (no seu computador), nunca no navegador.

------------------------------------------------------------------------------
COMO USAR (Windows PowerShell):

  1) Token GRATUITO da Transparencia (CGU):
     cadastre um e-mail em
       https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email
     e copie a chave recebida.

  2) Rode o proxy passando o token:
       $env:PORTAL_TOKEN = "cole-sua-chave-aqui"
       python proxy/local-proxy.py

     (Opcional, so quando tiver contrato Jusbrasil:)
       $env:JUSBRASIL_TOKEN = "seu-token-jusbrasil"

  3) No app (http://localhost:8123) -> Configuracoes, cole nos DOIS campos:
       http://localhost:8787
     Salve e rode um CNPJ. A secao de sancoes/contratos vai aparecer.
------------------------------------------------------------------------------
"""

import json
import os
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

def _load_token(env_name, filename):
    """Le o token da variavel de ambiente OU de um arquivo local (gitignored)."""
    v = os.environ.get(env_name, "").strip()
    if v:
        return v
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


PORT = int(os.environ.get("PROXY_PORT", "8787"))
PORTAL_TOKEN = _load_token("PORTAL_TOKEN", "portal_token.txt")
JUSBRASIL_TOKEN = _load_token("JUSBRASIL_TOKEN", "jusbrasil_token.txt")

CGU_BASE = "https://api.portaldatransparencia.gov.br"
CGU_PATHS = {
    "/api-de-dados/ceis",
    "/api-de-dados/cnep",
    "/api-de-dados/cepim",
    "/api-de-dados/contratos/cpf-cnpj",
}
JUSBRASIL_ENDPOINT = "https://api.jusbrasil.com.br/v2/lawsuits/search"  # ajuste conforme a doc


def _fetch(url, headers):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.read().decode("utf-8", "replace")


class Handler(BaseHTTPRequestHandler):
    def _cors(self, status=200, ctype="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", ctype)
        self.end_headers()

    def _json(self, obj, status=200):
        self._cors(status)
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self._cors(204)

    def do_GET(self):
        parsed = urlparse(self.path)
        path, qs = parsed.path, parsed.query

        # ---- Portal da Transparencia ----
        if path in CGU_PATHS:
            if not PORTAL_TOKEN:
                return self._json({"error": "PORTAL_TOKEN nao configurado no proxy."}, 500)
            url = f"{CGU_BASE}{path}?{qs}"
            try:
                # Header padrao da CGU. Se der 401, troque para 'Authorization'.
                status, body = _fetch(url, {"chave-api-dados": PORTAL_TOKEN, "Accept": "application/json"})
                self._cors(status)
                self.wfile.write(body.encode("utf-8"))
            except urllib.error.HTTPError as e:
                self._json({"error": f"CGU HTTP {e.code}"}, e.code)
            except Exception as e:
                self._json({"error": "Falha ao consultar a CGU", "detalhe": str(e)}, 502)
            return

        # ---- Processos (Jusbrasil) ----
        if path == "/processos":
            params = dict(p.split("=", 1) for p in qs.split("&") if "=" in p)
            cnpj = "".join(ch for ch in params.get("cnpj", "") if ch.isdigit())
            if not JUSBRASIL_TOKEN:
                # Sem contrato/token ainda: devolve vazio (a secao some no app).
                return self._json({"total": 0, "comoAutor": 0, "comoReu": 0, "processos": []})
            try:
                status, body = _fetch(
                    f"{JUSBRASIL_ENDPOINT}?cpf_cnpj={cnpj}",
                    {"Authorization": f"Bearer {JUSBRASIL_TOKEN}", "Accept": "application/json"},
                )
                raw = json.loads(body)
                self._json(_mapear_jusbrasil(raw, cnpj))
            except Exception as e:
                self._json({"error": "Falha Jusbrasil", "detalhe": str(e)}, 502)
            return

        self._json({"error": "rota nao suportada"}, 404)

    def log_message(self, *a):  # silencia o log ruidoso
        pass


def _mapear_jusbrasil(d, cnpj):
    """Normaliza a resposta do Jusbrasil. Ajuste com um exemplo real."""
    lista = d.get("lawsuits") or d.get("processos") or d.get("results") or d.get("data") or []
    procs = []
    for p in lista if isinstance(lista, list) else []:
        partes = p.get("parties") or p.get("partes") or []
        polo = None
        for parte in partes:
            doc = "".join(ch for ch in str(parte.get("document") or parte.get("cnpj") or "") if ch.isdigit())
            if doc == cnpj:
                tipo = str(parte.get("role") or parte.get("polo") or "").upper()
                if any(x in tipo for x in ("ATIV", "AUTOR", "REQUERENTE", "EXEQUENTE")):
                    polo = "ATIVO"
                elif any(x in tipo for x in ("PASSIV", "REU", "RÉU", "REQUERID", "EXECUTAD")):
                    polo = "PASSIVO"
        assuntos = []
        for a in (p.get("subjects") or p.get("assuntos") or []):
            assuntos.append(a if isinstance(a, str) else (a.get("name") or a.get("descricao") or ""))
        procs.append({
            "numero": p.get("cnj") or p.get("number") or p.get("numero") or "",
            "tribunal": p.get("court") or p.get("tribunal") or "",
            "classe": p.get("class") or p.get("classe") or "",
            "assuntos": [x for x in assuntos if x],
            "polo": polo,
            "status": p.get("status") or "",
            "ano": p.get("year") or p.get("ano") or "",
        })
    return {
        "total": len(procs),
        "comoAutor": sum(1 for p in procs if p["polo"] == "ATIVO"),
        "comoReu": sum(1 for p in procs if p["polo"] == "PASSIVO"),
        "processos": procs,
    }


if __name__ == "__main__":
    print(f"Proxy local em http://localhost:{PORT}")
    print(f"  Transparencia: {'OK (token presente)' if PORTAL_TOKEN else 'SEM token (defina PORTAL_TOKEN)'}")
    print(f"  Jusbrasil:     {'OK (token presente)' if JUSBRASIL_TOKEN else 'sem token (rota devolve vazio)'}")
    print("  No app, cole http://localhost:%d nos dois campos de proxy." % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
