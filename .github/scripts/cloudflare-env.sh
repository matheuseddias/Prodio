# shellcheck shell=bash
# Normaliza e confere CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID antes de qualquer chamada à Cloudflare.
# Uso: `source .github/scripts/cloudflare-env.sh` (define e exporta as duas variáveis já limpas).
#
# POR QUE EXISTE: na primeira execução (26/09/2026) o curl recusou o endereço da API com "URL rejected:
# Malformed input", porque o segredo colado no GitHub trouxe espaço ou quebra de linha no fim. Colar valor
# com quebra de linha é comum (copiar do painel, do gerenciador de senhas); o fluxo limpa em vez de exigir
# que a pessoa recadastre. O valor limpo nunca é impresso.

cloudflare_env_erro() { echo "::error title=Credenciais da Cloudflare::$*"; exit 1; }

# Tira espaço, tab, CR e LF de qualquer posição: nenhum dos dois valores tem espaço legítimo.
CLOUDFLARE_API_TOKEN="$(printf '%s' "${CLOUDFLARE_API_TOKEN:-}" | tr -d ' \t\r\n')"
CLOUDFLARE_ACCOUNT_ID="$(printf '%s' "${CLOUDFLARE_ACCOUNT_ID:-}" | tr -d ' \t\r\n')"

[[ -n "$CLOUDFLARE_API_TOKEN" ]] || cloudflare_env_erro "CLOUDFLARE_API_TOKEN está vazio."
[[ "$CLOUDFLARE_API_TOKEN" =~ ^[A-Za-z0-9_-]+$ ]] \
  || cloudflare_env_erro "CLOUDFLARE_API_TOKEN tem caracteres que um token da Cloudflare não tem (aspas, 'Bearer', pontuação?). Cole só o token, sem nada em volta."
# Account ID: 32 caracteres hexadecimais (o que vem depois de dash.cloudflare.com/ na barra de endereço).
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID,,}"
[[ "$CLOUDFLARE_ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] \
  || cloudflare_env_erro "CLOUDFLARE_ACCOUNT_ID não tem o formato de um Account ID (32 letras de a-f e números). Confira em Workers & Pages, coluna da direita, e cadastre só o código."

echo "::add-mask::$CLOUDFLARE_API_TOKEN"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
