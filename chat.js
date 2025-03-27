export const configureChat = (io, socket, games) => {
  socket.on('chatMessage', (data) => {
    const { roomCode, message } = data;
    const playerInfo = games[roomCode] && games[roomCode].players[socket.id];
    const senderName = playerInfo ? playerInfo.name : socket.id;
    const payload = { 
      sender: senderName,
      color: playerInfo.color,
      message,
      timestamp: new Date().toISOString()
    };
    io.to(roomCode).emit('chatMessage', payload);
  });
};