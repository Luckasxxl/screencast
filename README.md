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

## Rodar no Termux

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git cloudflared

git clone https://github.com/Luckasxxl/screencast.git
cd screencast
npm install

# opcional: avisar o link no Discord (Canal → Editar → Integrações → Webhooks → Copiar URL)
cp .webhook.example .webhook
nano .webhook              # troque o texto pela URL do webhook

chmod +x start.sh stop.sh
./start.sh
```

O `start.sh` liga o wake lock, sobe o servidor e o túnel, mostra o link e, se houver `.webhook`, manda o link no Discord.
**Ctrl+C** desliga tudo; `./stop.sh` também (e libera o wake lock). Logs ficam em `server.log` e `tunnel.log`.
Para atualizar o código: `git pull && npm install` e rode `./start.sh` de novo.

### Endereço fixo (localtunnel)

Sem configuração, o túnel é o do Cloudflare e o link (`https://xxxx.trycloudflare.com`) muda a cada reinício.
Para ter sempre o mesmo endereço, crie o arquivo `.subdominio` com o nome desejado:

```bash
cp .subdominio.example .subdominio   # contém "screencast-nakamas"
nano .subdominio                     # 4 a 63 caracteres: letras minúsculas, números e hífen
```

Com `.subdominio`, o `start.sh` usa o **localtunnel** → `https://SEU-NOME.loca.lt`, reiniciando o túnel sozinho se ele cair.

- Se o nome estiver ocupado (às vezes por alguns minutos depois de reiniciar), o loca.lt dá outro endereço; o script avisa com destaque na tela e no Discord e mostra o endereço real.
- Na primeira visita, o loca.lt mostra uma página pedindo a **tunnel password**. O script mostra a senha e manda no Discord: os amigos digitam e pronto.
  Essa senha é o **IP público** da rede onde o celular está, então só mande no Discord para quem você confia.
- Apague o `.subdominio` para voltar ao Cloudflare.

### Menções no Discord

Crie `.mencoes` com quem deve ser marcado no aviso (uma ou mais linhas; linhas com `#` são ignoradas):

```
<@ID_DO_USUARIO> <@&ID_DO_CARGO>
```

(No Discord: Configurações → Avançado → Modo desenvolvedor; depois clique com o botão direito no usuário/cargo → Copiar ID.)

Os arquivos `.webhook`, `.mencoes` e `.subdominio` nunca vão para o git; não cole a URL do webhook em lugar nenhum público.

> O celular só **hospeda** o site. Para **transmitir a tela** use um navegador de computador (Chrome/Edge/Firefox); pelo celular dá para assistir e usar a mesa de sons.

## Arcade: roleta, mini games e reações

No painel **Arcade** da sala (funciona com ou sem conta):

- **🎡 Roleta:** escreva uma pergunta e de 2 a 10 opções (uma por linha) e gire; todo mundo vê a mesma roleta parar no mesmo lugar. **🎯 Sortear nakama** gira com os nomes de quem está na sala.
- **⚡ Reflexo:** a tela fica roxa e, depois de um tempo aleatório, verde. Quem clicar (ou apertar espaço) primeiro vence; quem clicar antes queima a largada.
- **✊ Jokenpô:** todos escolhem pedra, papel ou tesoura em 10 s. Com as três jogadas (ou só uma) na mesa, dá empate.
- **Reações:** os emojis no topo do painel sobem flutuando na tela de todo mundo.
- **🎁 Roleta diária** (só com conta): uma vez por dia, vale de 1 a 15 moedas.

Só um mini game por sala de cada vez. Vencer com 2 ou mais pessoas na sala dá **+2 moedas** (até 6 vitórias pagas por hora).

## Contas, moedas e conquistas

Conta é **opcional**. Sem conta você entra numa sala só com o código e um nome de piloto, como antes.
Com conta (email + senha, mínimo 6 caracteres) o app guarda moedas, pets e conquistas.

- O email é só um identificador: nenhum email é enviado e não há confirmação.
- Moedas (só logado, só dentro de uma sala): **+1 a cada 5 min**, **+2** por votação em que você vota, **+3** ao abrir uma votação (até 3 pagas por hora). Duas abas da mesma conta não ganham em dobro.
- Loja com 5 pets (o primeiro é grátis), que aparecem ao lado do seu nome na lista de nakamas.
- 9 conquistas: primeira sala, 10 votos, 1h em salas, 5 votações abertas, comprar um pet, entrar em 3 dias diferentes, vencer 1 e 10 mini games, girar a roleta diária.
- Na sala: **Perfil / Loja** no topo; **Sair** encerra a sessão.

> ⚠️ **As contas ficam no `data.json` da máquina onde o servidor roda.** PC e celular (Termux) têm bancos separados: uma conta criada no PC não existe no celular e vice-versa. Para levar as contas junto, copie o `data.json` e o `.secret` (com o servidor desligado).

### Trocar ou redefinir a senha

- **Trocar:** na sala, **Perfil / Loja → Trocar senha** (senha atual + nova, mínimo 6 caracteres). Os outros aparelhos da conta são deslogados.
- **Esqueceu a senha:** como não há e-mail, quem hospeda o servidor redefine pelo terminal:

  ```bash
  ./stop.sh                              # o servidor precisa estar parado
  node reset-senha.js email@da.conta
  ./start.sh
  ```

  O script gera uma senha temporária de 10 caracteres e a mostra **uma única vez**; passe para a pessoa em privado e peça para trocar no Perfil.
  Ele se recusa a rodar com o servidor no ar (o servidor regrava o `data.json` e desfaria a mudança), guarda o estado anterior em `data.json.bak` e desloga as sessões antigas da conta.
  Se o servidor usa outra porta, rode com `PORT=xxxx node reset-senha.js ...`.

Segurança: senhas com bcrypt (custo 10), sessão em cookie `httpOnly` + `SameSite=Lax` assinado com HMAC (`Secure` automático via HTTPS/túnel), limite de 10 tentativas de login/cadastro por IP a cada 10 min.
O segredo da sessão vem de `SESSION_SECRET` ou é gerado em `.secret` na primeira execução. `data.json` e `.secret` nunca vão para o git.

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
server.js            signaling: salas, membros ao vivo, offer/answer/ice por socket id, sons, votação
auth.js              contas: /api/register, /api/login, /api/logout, /api/me, sessão em cookie assinado
reset-senha.js       redefine a senha de uma conta pelo terminal (servidor parado)
store.js             persistência em data.json (escrita atômica com debounce)
economy.js           moedas, loja de pets e conquistas
games.js             arcade no servidor: roleta, roleta diária, reflexo, jokenpô e reações
public/index.html    início: criar sala / entrar com código / entrar na conta
public/room.html     sala: grade de telas, membros, votação, mesa de sons
public/js/account.js modal de login, barra do usuário, Perfil/Loja
public/js/poll.js    painel de votação
public/js/games.js   painel do arcade (roleta, mini games, reações)
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
