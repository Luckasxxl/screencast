#!/data/data/com.termux/files/usr/bin/bash
# Sobe o servidor + túnel público e avisa o link no Discord (Termux).
# Túnel: localtunnel com subdomínio fixo se existir o arquivo .subdominio;
#        senão, cloudflared (link aleatório) como antes.

cd "$(dirname "$0")" || exit 1

PORT="${PORT:-3000}"
export PORT
LT_BIN="node_modules/localtunnel/bin/lt.js"

# Impede o Android de dormir e matar os processos
termux-wake-lock 2>/dev/null || true

# Mata instâncias antigas
pkill -f "node server.js" 2>/dev/null || true
pkill cloudflared 2>/dev/null || true
pkill -f "localtunnel/bin/lt.js" 2>/dev/null || true

NODE_PID=""
TUNNEL_PID=""

cleanup() {
  trap - INT TERM
  echo
  echo "Encerrando..."
  if [ -n "$TUNNEL_PID" ]; then
    pkill -P "$TUNNEL_PID" 2>/dev/null   # filhos do laço do localtunnel
    kill "$TUNNEL_PID" 2>/dev/null
  fi
  pkill -f "localtunnel/bin/lt.js" 2>/dev/null
  pkill cloudflared 2>/dev/null
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# ---------- Discord (opcional) ----------

WEBHOOK=""
if [ -f .webhook ]; then
  WEBHOOK=$(head -n 1 .webhook | tr -d '\r[:space:]')
  [ "$WEBHOOK" = "COLE_AQUI_A_URL_DO_WEBHOOK_DO_DISCORD" ] && WEBHOOK=""
fi

# .mencoes: menções do Discord (ex.: <@123456789> ou <@&987654321>), uma ou mais linhas
MENCOES=""
if [ -f .mencoes ]; then
  MENCOES=$(grep -v '^[[:space:]]*#' .mencoes | tr -d '\r' | tr '\n' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')
fi

discord() {
  [ -z "$WEBHOOK" ] && return 0
  local msg="$1"
  [ -n "$MENCOES" ] && msg="$MENCOES"$'\n'"$msg"
  # node monta o JSON com escape correto (aspas, quebras de linha, emojis)
  local json
  json=$(node -e 'process.stdout.write(JSON.stringify({ content: process.argv[1] }))' "$msg")
  if curl -fsS -H "Content-Type: application/json" -d "$json" "$WEBHOOK" > /dev/null; then
    echo "Aviso enviado ao Discord."
  else
    echo "Falha ao enviar ao Discord (confira a URL em .webhook)."
  fi
}

# ---------- servidor ----------

echo "Iniciando servidor na porta $PORT..."
node server.js > server.log 2>&1 &
NODE_PID=$!

sleep 2
if ! kill -0 "$NODE_PID" 2>/dev/null; then
  echo "O servidor não subiu. Final do server.log:"
  tail -n 20 server.log
  exit 1
fi

# ---------- túnel ----------

SUB=""
if [ -f .subdominio ]; then
  SUB=$(head -n 1 .subdominio | tr -d '\r[:space:]' | tr '[:upper:]' '[:lower:]')
  if ! [[ "$SUB" =~ ^[a-z0-9][a-z0-9-]{2,61}[a-z0-9]$ ]]; then
    echo "Subdomínio inválido em .subdominio: \"$SUB\" (use 4 a 63 letras minúsculas, números e hífen)."
    cleanup
  fi
fi

: > tunnel.log
if [ -n "$SUB" ]; then
  if [ ! -f "$LT_BIN" ]; then
    echo "localtunnel não está instalado. Rode: npm install"
    cleanup
  fi
  echo "Abrindo localtunnel com subdomínio fixo: $SUB..."
  # Laço que reinicia o túnel sozinho se ele cair
  (
    while true; do
      echo "[$(date '+%F %T')] iniciando localtunnel ($SUB)" >> tunnel.log
      node "$LT_BIN" --port "$PORT" --subdomain "$SUB" >> tunnel.log 2>&1
      echo "[$(date '+%F %T')] localtunnel caiu; reiniciando em 3s" >> tunnel.log
      sleep 3
    done
  ) &
  TUNNEL_PID=$!
  URL_RE='https://[a-z0-9-]*\.loca\.lt'
else
  echo "Abrindo túnel público do Cloudflare (crie .subdominio para usar endereço fixo)..."
  cloudflared tunnel --url "http://localhost:$PORT" > tunnel.log 2>&1 &
  TUNNEL_PID=$!
  URL_RE='https://[a-z0-9-]*\.trycloudflare\.com'
fi

# Espera até 30s pelo link
URL=""
for _ in $(seq 1 30); do
  URL=$(grep -o "$URL_RE" tunnel.log 2>/dev/null | tail -n 1)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Não encontrei o link do túnel. Final do tunnel.log:"
  tail -n 20 tunnel.log
  cleanup
fi

# ---------- anúncio ----------

if [ -z "$WEBHOOK" ]; then
  if [ -f .webhook ]; then
    echo "Arquivo .webhook vazio ou com o texto de exemplo; nada será enviado ao Discord."
  else
    echo "Webhook do Discord não configurado (crie o arquivo .webhook). Link só exibido na tela."
  fi
fi

if [ -n "$SUB" ]; then
  EXPECTED="https://$SUB.loca.lt"
  # A "tunnel password" do loca.lt é o IP público deste aparelho
  PASS=$(curl -fsS --max-time 10 https://loca.lt/mytunnelpassword 2>/dev/null | tr -d '[:space:]')
  [ -z "$PASS" ] && PASS="(não consegui obter — abra https://loca.lt/mytunnelpassword)"

  if [ "$URL" != "$EXPECTED" ]; then
    echo
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "  ATENÇÃO: o nome fixo $SUB.loca.lt está ocupado."
    echo "  Endereço real (temporário): $URL"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  fi

  echo
  echo "=================================================="
  echo "  SALA NO AR:"
  echo "  $URL"
  echo
  echo "  Senha do túnel (tunnel password): $PASS"
  echo "  -> os amigos digitam isso na primeira vez que abrem o link"
  echo "=================================================="
  echo

  MSG="🔗 Sala no ar: $URL"$'\n'"🔑 Senha do túnel: \`$PASS\` (digite na primeira vez que abrir o link)"
  if [ "$URL" != "$EXPECTED" ]; then
    MSG="⚠️ O endereço fixo $EXPECTED estava ocupado; por enquanto use o de baixo."$'\n'"$MSG"
  fi
  discord "$MSG"
else
  echo
  echo "=================================================="
  echo "  SALA NO AR:"
  echo "  $URL"
  echo "=================================================="
  echo
  discord "🔗 Sala no ar: $URL"
fi

echo "Ctrl+C para desligar."

if [ -n "$SUB" ]; then
  # Se o localtunnel reiniciar com outro endereço, avisa de novo
  while kill -0 "$NODE_PID" 2>/dev/null; do
    sleep 10
    NEW=$(grep -o "$URL_RE" tunnel.log 2>/dev/null | tail -n 1)
    if [ -n "$NEW" ] && [ "$NEW" != "$URL" ]; then
      URL="$NEW"
      if [ "$URL" = "$EXPECTED" ]; then
        echo ">> Túnel voltou no endereço fixo: $URL"
        discord "✅ Túnel de volta no endereço fixo: $URL"
      else
        echo "!! Túnel reiniciou em outro endereço (nome fixo ocupado): $URL"
        discord "⚠️ O túnel reiniciou e o nome fixo estava ocupado. Endereço novo: $URL"$'\n'"🔑 Senha do túnel: \`$PASS\`"
      fi
    fi
  done
  echo "O servidor parou. Final do server.log:"
  tail -n 20 server.log
  cleanup
else
  wait
fi
