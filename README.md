# screencast

Transmissão de tela P2P com WebRTC. O servidor (Express + Socket.io) só faz a sinalização; o vídeo e o áudio vão direto entre os navegadores.

## Rodar local

```bash
npm install
npm start
```

Abra http://localhost:3000.

1. Aba A → **Criar sala e transmitir** → **Transmitir minha tela**. Aparece o código da sala (ex.: `K7QF`).
2. Aba B → digite o código (ou abra o link `/room.html?room=K7QF`). Ela também pode clicar em **Transmitir minha tela**: várias pessoas transmitem ao mesmo tempo e todos veem todas as telas em grade.
3. Use a **mesa de sons** (todo mundo na sala ouve) e clique no mascote ou nos gatinhos.

> `getDisplayMedia` só funciona em contexto seguro: `localhost` ou HTTPS. Para outro dispositivo da rede, use o túnel abaixo.

## Testar de outros dispositivos (Cloudflare Tunnel)

Com o servidor rodando:

```bash
cloudflared tunnel --url http://localhost:3000
```

O `cloudflared` imprime uma URL `https://xxxx.trycloudflare.com`. Abra nela o host e mande o link para os espectadores.

## Deploy no Render

1. Suba o projeto para um repositório no GitHub.
2. No Render: **New → Web Service** → selecione o repositório.
3. Configure:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Deploy. O Render define `PORT` automaticamente e fornece HTTPS (WebSocket funciona sem configuração extra).

## Rodar num celular Android (Termux)

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git gh cloudflared

# repositório privado: faça login antes de clonar
gh auth login
gh repo clone Luckasxxl/screencast
cd screencast
npm install

termux-wake-lock          # impede o Android de dormir e matar o servidor
npm start
```

Em outra sessão do Termux (deslize da borda esquerda → **New session**), abra o endereço público:

```bash
cloudflared tunnel --url http://localhost:3000
```

Compartilhe a URL `https://xxxx.trycloudflare.com` que aparecer. Ela muda toda vez que o túnel reinicia.
Para atualizar depois: `git pull && npm install` e reinicie o `npm start`.

> O celular só **hospeda** o site. Para **transmitir a tela** use um navegador de computador (Chrome/Edge/Firefox); pelo celular dá para assistir e usar a mesa de sons.

## TURN

Só com STUN, alguns pares atrás de NAT simétrico/rede corporativa não conectam (o viewer mostra "Conexão falhou"). Adicione um servidor TURN em `public/js/rtc.js`:

```js
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:turn.exemplo.com:3478', username: 'user', credential: 'senha' },
];
```

## Estrutura

```
server.js            signaling: salas, membros ao vivo, offer/answer/ice por socket id, sons
public/index.html    início: criar sala / entrar com código
public/room.html     sala: grade de telas, membros, mesa de sons
public/host.html     redireciona para room.html (links antigos)
public/viewer.html   redireciona para room.html (links antigos)
public/js/rtc.js     ICE servers + helper de RTCPeerConnection
public/js/room.js    lógica da sala (uma RTCPeerConnection por par transmissor→espectador)
public/js/sfx.js     sons sintetizados (Web Audio + voz do navegador), sem arquivos
public/js/mascot.js  mascote do Claude fazendo o 6 7
public/js/kittens.js gatinhos andando pela tela
public/js/fx.js      fundo animado
```

## Notas

- Cada transmissor abre uma conexão separada com cada pessoa da sala, então o upload de quem transmite limita quantos assistem bem (algo como 5–10 em 1080p). Com várias pessoas transmitindo, o download de quem assiste também pesa.
- Sons de voz (Nani, Sugoi, Nya…) usam a voz japonesa do sistema se existir; senão, a voz padrão.
- Áudio da captura depende do navegador/SO: no Chrome/Edge funciona ao compartilhar uma aba (e tela inteira no Windows).
