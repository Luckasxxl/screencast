#!/data/data/com.termux/files/usr/bin/bash
# Sobe o servidor + túnel público do Cloudflare e avisa o link no Discord (Termux).

cd "$(dirname "$0")" || exit 1

PORT="${PORT:-3000}"
export PORT

# Impede o Android de dormir e matar os processos
termux-wake-lock 2>/dev/null || true

# Mata instâncias antigas
pkill -f "node server.js" 2>/dev/null || true
pkill cloudflared 2>/dev/null || true

NODE_PID=""
CF_PID=""

cleanup() {
  echo
  echo "Encerrando..."
  [ -n "$CF_PID" ] && kill "$CF_PID" 2>/dev/null
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo "Iniciando servidor na porta $PORT..."
node server.js > server.log 2>&1 &
NODE_PID=$!

sleep 2
if ! kill -0 "$NODE_PID" 2>/dev/null; then
  echo "O servidor não subiu. Final do server.log:"
  tail -n 20 server.log
  exit 1
fi

echo "Abrindo túnel público do Cloudflare..."
cloudflared tunnel --url "http://localhost:$PORT" > tunnel.log 2>&1 &
CF_PID=$!

# Espera até 30s pelo link
URL=""
for _ in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log 2>/dev/null | head -n 1)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Não encontrei o link do túnel. Final do tunnel.log:"
  tail -n 20 tunnel.log
  kill "$CF_PID" "$NODE_PID" 2>/dev/null
  exit 1
fi

echo
echo "=================================================="
echo "  SALA NO AR:"
echo "  $URL"
echo "=================================================="
echo

# Avisa no Discord se houver webhook configurado (arquivo .webhook, fora do git)
if [ -f .webhook ]; then
  WEBHOOK=$(head -n 1 .webhook | tr -d '\r[:space:]')
  if [ -n "$WEBHOOK" ] && [ "$WEBHOOK" != "COLE_AQUI_A_URL_DO_WEBHOOK_DO_DISCORD" ]; then
    if curl -fsS -H "Content-Type: application/json" \
         -d "{\"content\": \"🔗 Sala no ar: $URL\"}" "$WEBHOOK" > /dev/null; then
      echo "Link enviado ao Discord."
    else
      echo "Falha ao enviar ao Discord (confira a URL em .webhook)."
    fi
  else
    echo "Arquivo .webhook vazio ou com o texto de exemplo; nada enviado ao Discord."
  fi
else
  echo "Webhook do Discord não configurado (crie o arquivo .webhook). Link só exibido acima."
fi

echo "Ctrl+C para desligar."
wait
