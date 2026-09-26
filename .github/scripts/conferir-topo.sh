#!/usr/bin/env bash
# Primeiro passo de cada job de produção (banco, worker, web-producao): este commit ainda é o topo de main?
# O job preparar já confere isso, mas "Re-run failed jobs" (ou "Re-run job") não roda o preparar de novo:
# reaproveita as saídas dele da primeira tentativa. Sem esta conferência, reexecutar o job que falhou num
# run antigo publicaria código velho por cima do que já está no ar.
# Na primeira tentativa não confere: o preparar acabou de conferir, e se um push mais novo chegou no meio
# o run dele está na fila (concurrency) e publica logo depois deste.
# Entradas (env): GITHUB_TOKEN (só leitura), GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_RUN_ATTEMPT.
set -euo pipefail
erro() { echo "::error title=Publicação::$*"; exit 1; }

if [[ "${GITHUB_RUN_ATTEMPT:-1}" == 1 ]]; then
  echo "Primeira tentativa deste run: o topo de main foi conferido pelo job preparar."
  exit 0
fi
[[ -n "${GITHUB_TOKEN:-}" ]] || erro "GITHUB_TOKEN vazio: não dá para conferir o topo de main. Nada foi publicado."
# O token vai pela configuração do curl (stdin), não pela linha de comando.
resposta="$(curl -sS --fail --retry 3 -K - "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/git/ref/heads/main" <<CONF
header = "Authorization: Bearer $GITHUB_TOKEN"
header = "Accept: application/vnd.github+json"
CONF
)" || erro "Não consegui ler o topo de main pela API do GitHub. Nada foi publicado; rode de novo."
topo="$(grep -oE '"sha": *"[0-9a-f]{40}"' <<<"$resposta" | head -n1 | grep -oE '[0-9a-f]{40}' || true)"
[[ -n "$topo" ]] || erro "A API do GitHub não devolveu o commit de main. Nada foi publicado."
if [[ "$topo" != "$GITHUB_SHA" ]]; then
  erro "Reexecução (tentativa $GITHUB_RUN_ATTEMPT) de um run cujo commit (${GITHUB_SHA:0:7}) não é mais o topo de main (${topo:0:7}): nada foi publicado, para não pôr código velho no ar. Para publicar de novo, use o run mais recente de main."
fi
echo "Tentativa $GITHUB_RUN_ATTEMPT: ${GITHUB_SHA:0:7} ainda é o topo de main."
