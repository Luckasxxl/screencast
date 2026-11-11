#!/data/data/com.termux/files/usr/bin/bash
# Desliga o servidor e o túnel e libera o wake lock (Termux).

pkill -f "node server.js" 2>/dev/null || true
pkill cloudflared 2>/dev/null || true
termux-wake-unlock 2>/dev/null || true

echo "screencast desligado."
