#!/data/data/com.termux/files/usr/bin/bash
# Desliga o servidor e os túneis e libera o wake lock (Termux).

pkill -f "start.sh" 2>/dev/null || true          # encerra o laço de reinício do localtunnel
pkill -f "node server.js" 2>/dev/null || true
pkill -f "localtunnel/bin/lt.js" 2>/dev/null || true
pkill cloudflared 2>/dev/null || true
termux-wake-unlock 2>/dev/null || true

echo "screencast desligado."
