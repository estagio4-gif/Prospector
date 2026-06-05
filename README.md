# Prospector Tributário

Webapp para **prospecção e qualificação de leads em advocacia tributária**.
A partir de um CNPJ, gera um relatório com o perfil tributário da empresa, o
**ranking das teses de recuperação de crédito aplicáveis**, contato (telefone
multi-fonte), sinais de risco e — opcionalmente — enriquecimento com dados
públicos (Portal da Transparência) e litígio já ajuizado.

> 100% client-side, sem backend, sem armazenar CNPJ. Custo de IA ~R$ 0,003/consulta.

## Filosofia

A inteligência cara (IA) é o **último** passo. Todo o filtro de teses,
classificação de setor e inferência de regime acontece em **JavaScript
determinístico** — instantâneo e quase gratuito. A IA (Claude Haiku) só *escreve*
a narrativa das 3 melhores teses. Sem chave de IA, o app usa um template offline.

## Como rodar

Servidor estático simples (sem build):

```bash
# Python
python -m http.server 8000
# ou Node
npx serve .
```

Abra `http://localhost:8000`.

## Funcionalidades

### Núcleo (grátis, sem chave, sem proxy)
- **Ranking de 10 teses** por aderência ao perfil (Tema 69, INSS rubricas,
  PIS/COFINS insumos, ICMS-ST, DIFAL, Selic, subvenções…).
- **CNAEs secundários no scoring** — empresa de serviço com atividade
  secundária de comércio já pontua nas teses de ICMS.
- **Telefone multi-fonte** de 5 bases públicas (BrasilAPI, Minha Receita,
  CNPJ.ws, OpenCNPJ, CNPJá), deduplicado, com tipo (fixo/celular), link de
  WhatsApp e **selo "✓ N fontes"** de confiança.
- **Fallback de cadastro** entre as 5 fontes — se uma cair, a análise não para.
- **Perfil de risco / red flags**, **domínio web** (whois) e **estimativa de
  crédito em R$** (entrada manual de faturamento — ordem de grandeza).
- **Link para a Junta Comercial** do estado (fonte oficial do capital social,
  com fé pública via certidão simplificada).
- **Métricas de uso** (agregados anônimos, sem CNPJ) — botão "📊 Métricas".

### Upgrades opcionais
| Upgrade | O que destrava | Como ativar | Custo |
|---|---|---|---|
| **Chave Anthropic** | Narrativa de abordagem por IA | ⚙ Configurações → chave `sk-ant-…` | ~R$ 0,003/consulta |
| **Portal da Transparência** | Sanções (CEIS/CNEP/CEPIM) + contratos federais | proxy + token grátis da CGU | **R$ 0** |
| **Processos / Jusbrasil** | "Tese já ajuizada" + litígio | proxy + contrato Jusbrasil | pago |

## Configuração (BYOK)

- **Chave Anthropic:** ⚙ Configurações → cole `sk-ant-…`. Fica só no
  `localStorage`; só é enviada para `api.anthropic.com`.
- **Proxies:** a API da CGU e a do Jusbrasil exigem token e não têm CORS, então
  rodam atrás de um proxy. Veja `proxy/`:
  - `local-proxy.py` — proxy local (Python, sem dependências) para testar sem
    Cloudflare. Lê o token de `proxy/portal_token.txt` (gitignored) ou da env.
  - `transparencia-worker.js` / `processos-worker.js` — Cloudflare Workers para
    produção. Cole a URL do proxy nos campos de Configurações.

```bash
# Proxy local (Transparência): pegue o token grátis em
# https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email
# salve em proxy/portal_token.txt e rode:
python proxy/local-proxy.py
# cole http://localhost:8787 no campo de proxy em Configurações
```

## Estrutura

```
index.html        Interface + modais (config, métricas)
styles.css        Estilos
cnaes.js          CNAE → seção → perfil tributário (+ perfilCombinado)
juntas.js         Mapa das 27 Juntas Comerciais por UF
teses.js          Catálogo de teses + funções de scoring
engine.js         Validação, regime, ranking, telefones, crédito, processos
api.js            Cadastro (5 fontes c/ fallback) + telefones + whois
transparencia.js  Portal da Transparência (via proxy)
processos.js      Litígio/Jusbrasil (via proxy, provider-agnóstico)
metricas.js       Métricas de uso (agregados anônimos)
ai.js             Claude Haiku + fallback template
app.js            Orquestrador: DOM, fluxo, renderização
proxy/            Proxies (local Python + Cloudflare Workers)
CLAUDE.md         Contexto e decisões de design (ler antes de evoluir)
```

## Privacidade

- **Nenhum CNPJ é armazenado** em servidor (não há servidor) nem persistido.
- O cache em `localStorage` guarda só dados públicos da Receita (TTL 24h).
- As métricas guardam **apenas agregados anônimos** (contagens, %), sem CNPJ.
- Tokens dos proxies ficam no proxy (backend), nunca no navegador.

## Limitações conscientes

- **Regime** é inferido por sinais públicos (porte, capital, opção pelo
  Simples) — Simples/MEI é confirmado; Lucro Real/Presumido é estimado.
- **Perfil setorial** é média da seção CNAE, não da empresa específica.
- **Estimativa de crédito** é heurística (ordem de grandeza), **não** cálculo —
  exige SPED/escrituração para apuração real.
- **Dados que exigem base paga** (não incluídos): funcionários presumidos,
  faturamento presumido, telefone/e-mail validado, PAT.

## Desenvolvimento

Leia **`CLAUDE.md`** — contém a arquitetura, as decisões de design (numeradas)
e os pontos de extensão. É lido automaticamente pelo Claude Code.

## Licença

Definir.
