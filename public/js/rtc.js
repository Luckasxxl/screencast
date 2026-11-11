// Único lugar com a configuração de ICE. Adicione servidores TURN aqui, ex.:
// { urls: 'turn:turn.exemplo.com:3478', username: 'user', credential: 'senha' }
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

/**
 * Cria uma RTCPeerConnection já ligada ao socket para um peer remoto.
 * `side` identifica a ponta ('out' = eu transmito, 'in' = eu assisto) para que
 * o outro lado saiba a qual conexão cada candidato ICE pertence.
 * Candidatos que chegam antes da remoteDescription ficam em fila.
 */
export function createPeer(socket, remoteId, side) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const pending = [];

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', { to: remoteId, candidate, side });
  };

  return {
    pc,
    async setRemote(sdp) {
      await pc.setRemoteDescription(sdp);
      while (pending.length) await pc.addIceCandidate(pending.shift()).catch(console.warn);
    },
    async addCandidate(candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(candidate).catch(console.warn);
      else pending.push(candidate);
    },
    close() {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    },
  };
}

export const ROOM_RE = /^[A-Z0-9]{4}$/;
