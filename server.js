import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { 
  wallsData,
  rotateCompassData,
  doubleRotateCompassData,
  entryTeleportData,
  exits
} from './config.js';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const initialDeck = [
  { type: 'N' }, { type: 'N' }, { type: 'N' }, { type: 'N' }, { type: 'N' }, { type: 'N' },
  { type: 'E' }, { type: 'E' }, { type: 'E' }, { type: 'E' }, { type: 'E' }, { type: 'E' },
  { type: 'S' }, { type: 'S' }, { type: 'S' }, { type: 'S' }, { type: 'S' }, { type: 'S' },
  { type: 'W' }, { type: 'W' }, { type: 'W' }, { type: 'W' }, { type: 'W' }, { type: 'W' },
  { type: 'special', text: 'Volez une carte à un adversaire', action: 'steal' },
  { type: 'special', text: 'Volez une carte à un adversaire', action: 'steal' },
  { type: 'special', text: 'Volez une carte à un adversaire', action: 'steal' },
  { type: 'special', text: 'Volez une carte à un adversaire', action: 'steal' },
  { type: 'special', text: 'Volez une carte à un adversaire', action: 'steal' },
  { type: 'special', text: 'Tournez la boussole d\'un quart de tour', action: 'rotateQuarter' },
  { type: 'special', text: 'Tournez la boussole d\'un quart de tour', action: 'rotateQuarter' },
  { type: 'special', text: 'Tournez la boussole d\'un quart de tour', action: 'rotateQuarter' },
  { type: 'special', text: 'Tournez la boussole d\'un quart de tour', action: 'rotateQuarter' },
  { type: 'special', text: 'Tournez la boussole d\'un quart de tour', action: 'rotateQuarter' },
  { type: 'special', text: 'Tournez la boussole d\'un tour complet', action: 'rotateFull' },
  { type: 'special', text: 'Tournez la boussole d\'un tour complet', action: 'rotateFull' },
  { type: 'special', text: 'Tournez la boussole d\'un tour complet', action: 'rotateFull' },
  { type: 'special', text: 'Tournez la boussole d\'un tour complet', action: 'rotateFull' },
];

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const games = {};
const gridSize = 20;

const isWall = (row, col) => {
  if (!wallsData) {
    console.error("wallsData est undefined");
    return false;
  }
  return wallsData.some(w => w.row === row && w.col === col);
}
const initializeGameState = ({ playersCount, namesArr, colorsArr }) => {
  return {
    deck: shuffle([...initialDeck]),
    discardPile: [],
    players: {},
    playerOrder: [],
    playerTurn: 0,
    winner: null,
    playersPositions: computePositions(playersCount),
    playersGoals: computeGoals(playersCount),
    cardDirections: ['N', 'E', 'S', 'W'],
    expectedPlayers: playersCount,
    lockedWalls: [],
    showDirection: false,
    showDice: false,
    pendingRotation: 0,
    rotationCount: 0,
    showDice: false,
    diceValue: 1,
    showStealModal: false,
    stealer: null
  };
}

const computePositions = (playersCount) => {
  if (playersCount === 2) {
    return [ { row: 0, col: 0 }, { row: gridSize - 1, col: gridSize - 1 } ];
  } else if (playersCount === 3) {
    return [ { row: 0, col: 0 }, { row: gridSize - 1, col: gridSize - 1 }, { row: 0, col: gridSize - 1 } ];
  } else if (playersCount === 4) {
    return [ { row: 0, col: 0 }, { row: gridSize - 1, col: gridSize - 1 }, { row: 0, col: gridSize - 1 }, { row: gridSize - 1, col: 0 } ];
  } else {
    return Array.from({ length: playersCount }, (_, i) => ({
      row: Math.floor((gridSize - 1) * i / (playersCount - 1 || 1)),
      col: 0
    }));
  }
}

const computeGoals = (playersCount) => {
  if (playersCount === 2) {
    return [ { row: gridSize - 1, col: gridSize - 1 }, { row: 0, col: 0 } ];
  } else if (playersCount === 3) {
    return [ { row: gridSize - 1, col: gridSize - 1 }, { row: 0, col: 0 }, { row: gridSize - 1, col: 0 } ];
  } else if (playersCount === 4) {
    return [ { row: gridSize - 1, col: gridSize - 1 }, { row: 0, col: 0 }, { row: gridSize - 1, col: 0 }, { row: 0, col: gridSize - 1 } ];
  } else {
    return Array.from({ length: playersCount }, (_, i) => ({
      row: Math.floor((gridSize - 1) * i / (playersCount - 1 || 1)),
      col: gridSize - 1
    }));
  }
}

const dealInitialCards = (gameState) => {
  gameState.playerOrder.forEach((socketId, index) => {
    const startPos = gameState.playersPositions[index];
    gameState.players[socketId].position = { ...startPos };
    gameState.players[socketId].goal = gameState.playersGoals[index];
    gameState.players[socketId].hand = drawCards(gameState);
  });
}

const isLockedWall = (row, col, lockedWalls) => {
  if (!lockedWalls) return false;
  return lockedWalls.some(wall => wall.row === row && wall.col === col);
}

const drawOneCard = (gameState) => {
  if (gameState.deck.length === 0) {
    if (gameState.discardPile.length === 0) return null;
    gameState.deck = shuffle(gameState.discardPile);
    gameState.discardPile = [];
  }
  return gameState.deck.pop();
}

const drawCards = (gameState) => {
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const card = drawOneCard(gameState);
    if (card) cards.push(card);
  }
  return cards;
}

const movePlayer = (gameState, player, playedCardType) => {
  const baseDirections = ['N', 'E', 'S', 'W'];
  const index = baseDirections.indexOf(playedCardType);
  const effectiveDirection = gameState.cardDirections[index];

  let rowChange = 0, colChange = 0;
  if (effectiveDirection === 'N') rowChange = -1;
  else if (effectiveDirection === 'S') rowChange = 1;
  else if (effectiveDirection === 'E') colChange = 1;
  else if (effectiveDirection === 'W') colChange = -1;

  const newRow = player.position.row + rowChange;
  const newCol = player.position.col + colChange;
  const clampedRow = Math.max(0, Math.min(gridSize - 1, newRow));
  const clampedCol = Math.max(0, Math.min(gridSize - 1, newCol));

  if (isWall(clampedRow, clampedCol)) {
    const alreadyLocked = gameState.lockedWalls.some(w => w.row === clampedRow && w.col === clampedCol);
    if (!alreadyLocked) {
      gameState.lockedWalls.push({ row: clampedRow, col: clampedCol });
      player.position = { row: clampedRow, col: clampedCol };
    } else {
      console.log(`Mouvement bloqué : mur déjà activé à (${clampedRow}, ${clampedCol})`);
      return player.position;
    }
  } else {
    player.position = { row: clampedRow, col: clampedCol };
  }

  const rotateIndex = rotateCompassData.findIndex(r => r.row === clampedRow && r.col === clampedCol);
  const doubleIndex = doubleRotateCompassData.findIndex(r => r.row === clampedRow && r.col === clampedCol);
  const entryIndex = entryTeleportData.findIndex(r => r.row === clampedRow && r.col === clampedCol);

  if (doubleIndex !== -1) {
    gameState.pendingRotation = 2;
    gameState.showDirection = true;
  } else if (rotateIndex !== -1) {
    gameState.pendingRotation = 1;
    gameState.showDirection = true;
  }

  if(entryIndex !== -1) {
    console.log('PORTE')
    gameState.showDice = true;
  }

  if (player.position.row === player.goal.row && player.position.col === player.goal.col) {
    gameState.winner = player.name;
  }

  return player.position;
}

function initiateCompassTurn(gameId, socketId) {
  console.log('games',games)
  console.log('socketId', socketId)
  const game = games[gameId];
  console.log(gameId);
  console.log(game)
  console.log(games[gameId])
  if (!game) return;
  game.pendingRotation = 1;
  game.showDirection = true;
}

function initiateCompassFullTurn(gameId, socketId) {
  console.log('games',games)
  console.log('socketId', socketId)

  const game = games[gameId];
  console.log(gameId);
  console.log(game)
  console.log(games[gameId])
  if (!game) return;
  game.pendingRotation = 2; 
  game.showDirection = true;
}

const useCardAction = (gameState, socketId, payload, gameId) => {
  if (gameState.playerOrder[gameState.playerTurn] !== socketId) return;
  const player = gameState.players[socketId];
  const index = payload.index;
  if (index < 0 || index >= player.hand.length) return;
  
  const playedCard = player.hand[index];

  if (playedCard.type !== 'special') {
    if (!canMove(gameState, player, playedCard.type)) {
      io.to(socketId).emit('moveImpossible', { message: "Déplacement impossible", index: index });
      return;
    }
    player.hand.splice(index, 1);
    gameState.discardPile.push(playedCard);
    movePlayer(gameState, player, playedCard.type);
  } else {
    if (playedCard.action === 'steal') {
      gameState.showStealModal = true;
      gameState.stealer = socketId;
    } else if (playedCard.action === 'rotateQuarter') {
      initiateCompassTurn(gameId, socketId);
    } else if (playedCard.action === 'rotateFull') {
      initiateCompassFullTurn(gameId, socketId);
    }
    player.hand.splice(index, 1);
    gameState.discardPile.push(playedCard);
  }
  
  io.to(gameId).emit('updateGameState', { 
    ...gameState, 
    wallsData, 
    rotateCompassData, 
    doubleRotateCompassData, 
    entryTeleportData 
  });
};

const endTurnAction = (gameState) => {
  const currentSocketId = gameState.playerOrder[gameState.playerTurn];
  let currentPlayer = gameState.players[currentSocketId];
  if (!currentPlayer) {
    console.warn("Aucun joueur trouvé pour l'ID:", currentSocketId);
    if (gameState.playerOrder.length > 0) {
      gameState.playerTurn = (gameState.playerTurn + 1) % gameState.playerOrder.length;
    }
    return gameState;
  }
  
  if (!Array.isArray(currentPlayer.hand)) {
    currentPlayer.hand = [];
  }
  
  while (currentPlayer.hand.length < 3) {
    const card = drawOneCard(gameState);
    if (!card) break;
    currentPlayer.hand.push(card);
  }
  
  if (gameState.playerOrder.length > 0) {
    gameState.playerTurn = (gameState.playerTurn + 1) % gameState.playerOrder.length;
  }
  return gameState;
}

const processPlayerAction = (gameState, socketId, action, payload, gameId) => {
  if (action === 'useCard') {
    useCardAction(gameState, socketId, payload, gameId);
  } else if (action === 'endTurn') {
    endTurnAction(gameState);
  }
  return gameState;
}
const canMove = (gameState, player, playedCardType) => {
  const baseDirections = ['N', 'E', 'S', 'W'];
  const index = baseDirections.indexOf(playedCardType);
  const effectiveDirection = gameState.cardDirections[index];

  let rowChange = 0, colChange = 0;
  if (effectiveDirection === 'N') rowChange = -1;
  else if (effectiveDirection === 'S') rowChange = 1;
  else if (effectiveDirection === 'E') colChange = 1;
  else if (effectiveDirection === 'W') colChange = -1;

  const newRow = player.position.row + rowChange;
  const newCol = player.position.col + colChange;

  if (newRow < 0 || newRow >= gridSize || newCol < 0 || newCol >= gridSize) return false;

  if (isWall(newRow, newCol)) {
    if (!isLockedWall(newRow, newCol, gameState.lockedWalls)) {
      return true;
    }
    return false;
  }

  return true;
}


io.on('connection', (socket) => {
  console.log(`Connexion : ${socket.id}`);
  
  socket.on('joinGame', (data) => {
    const { gameId, playersCount, names, colors } = data;

    const namesArr = typeof names === 'string' ? names.split(',') : names;
    const colorsArr = typeof colors === 'string' ? colors.split(',') : colors;

    if (!games[gameId]) {
      games[gameId] = initializeGameState({ playersCount, namesArr: names, colorsArr: colors });
    }
    const game = games[gameId];
    if (!game.players[socket.id]) {
      const index = game.playerOrder.length;
      game.players[socket.id] = { 
        name: namesArr[index] || `Joueur ${index+1}`, 
        color: colorsArr[index] || 'gray' 
      };
      game.playerOrder.push(socket.id);
      socket.join(gameId);
      console.log(`${game.players[socket.id].name} (${socket.id}) a rejoint la partie ${gameId}`);
    }
    if (game.playerOrder.length === game.expectedPlayersCount) {
      dealInitialCards(game);
    }
    io.to(gameId).emit('updateGameState', { 
      ...game, 
      wallsData, 
      rotateCompassData, 
      doubleRotateCompassData, 
      entryTeleportData,
      exits
    });
  });
  
  socket.on('playerAction', (data) => {
    const { gameId, action, payload } = data;
    const game = games[gameId];
    if (!game) return;
    processPlayerAction(game, socket.id, action, payload, gameId);
    io.to(gameId).emit('updateGameState', { 
      ...game, 
      wallsData, 
      rotateCompassData, 
      doubleRotateCompassData, 
      entryTeleportData 
    });
  });

  socket.on('rotateCompass', (data) => {
    const { gameId, clockwise } = data;
    const game = games[gameId];
    if (!game || !game.showDirection || !game.pendingRotation) return;
    
    if (clockwise) {
      game.rotationCount += game.pendingRotation;
    } else {
      game.rotationCount -= game.pendingRotation;
    }
    
    const baseDirections = ['N','E','S','W'];
    const rotations = ((game.rotationCount % 4) + 4) % 4;
    
    game.cardDirections = baseDirections.slice(rotations).concat(baseDirections.slice(0,rotations));
    
    game.pendingRotation = 0;
    game.showDirection = false;
    io.to(gameId).emit('updateGameState', { 
      ...game, 
      wallsData, 
      rotateCompassData, 
      doubleRotateCompassData, 
      entryTeleportData 
    });
  });
  
  socket.on('disconnect', () => {
    console.log(`Déconnexion : ${socket.id}`);
    for (const gameId in games) {
      const game = games[gameId];
      if (game.players[socket.id]) {
        delete game.players[socket.id];
        game.playerOrder = game.playerOrder.filter(id => id !== socket.id);
        if (game.playerTurn >= game.playerOrder.length) {
          game.playerTurn = 0;
        }
        io.to(gameId).emit('updateGameState', { 
          ...game, 
          wallsData, 
          rotateCompassData, 
          doubleRotateCompassData, 
          entryTeleportData 
        });
      }
    }
  });

  socket.on('diceRolling', (data) => {
    const { gameId, diceValue } = data;
    const game = games[gameId];
    if (!game) return;
    game.diceValue = diceValue;

    io.to(gameId).emit('updateGameState', {
      ...game,
      wallsData,
      rotateCompassData,
      doubleRotateCompassData,
      entryTeleportData
    })
  })
  socket.on('closeDiceAndMove', (data) => {
    const { gameId, diceValue } = data;
    const game = games[gameId];
    if (!game) return;
    
    const currentSocketId = game.playerOrder[game.playerTurn];
    const player = game.players[currentSocketId];
    
    const exit = exits[diceValue];
    if (exit) {
      player.position = { row: exit.row, col: exit.col };
    }
    
    game.showDice = false;

    io.to(gameId).emit('updateGameState', { 
      ...game, 
      wallsData, 
      rotateCompassData, 
      doubleRotateCompassData, 
      entryTeleportData 
    });
  });

  socket.on('initiateSteal', (data) => {
    const { gameId } = data;
    const game = games[gameId];
    if (!game) return;
    game.showStealModal = true;
    game.stealer = socket.id;
    io.to(gameId).emit('updateGameState', { 
      ...game, 
      wallsData, 
      rotateCompassData, 
      doubleRotateCompassData, 
      entryTeleportData 
    });
  });
  
  socket.on('confirmSteal', (data) => {
    const { gameId, targetSocketId } = data;
    const game = games[gameId];
    if (!game || game.stealer !== socket.id) return;
    
    const targetPlayer = game.players[targetSocketId];
    const stealerPlayer = game.players[game.stealer];
    if (targetPlayer && targetPlayer.hand && targetPlayer.hand.length > 0) {
      const stolenCard = targetPlayer.hand.splice(0, 1)[0];
      stealerPlayer.hand.push(stolenCard);
    }
    game.showStealModal = false;
    game.stealer = null;
    
    io.to(gameId).emit('updateGameState', { 
      ...game, 
      wallsData, 
      rotateCompassData, 
      doubleRotateCompassData, 
      entryTeleportData 
    });
  });
  
  socket.on('cancelSteal', (data) => {
    const { gameId } = data;
    const game = games[gameId];
    if (!game) return;
    game.showStealModal = false;
    game.stealer = null;
    io.to(gameId).emit('updateGameState', { 
      ...game, 
      wallsData, 
      rotateCompassData, 
      doubleRotateCompassData, 
      entryTeleportData 
    });
  });

  socket.on('createRoom', (data) => {
    const { expectedPlayers, organizerName, organizerColor } = data;
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    games[roomCode] = initializeGameState({
      playersCount: expectedPlayers,
      namesArr: [organizerName],
      colorsArr: [organizerColor]
    });
  
    const game = games[roomCode];

    game.players[socket.id] = {
      name: organizerName || "Organisateur",
      color: organizerColor || "gray",
      hand: [] 
    };
    game.playerOrder.push(socket.id);
  
    socket.join(roomCode);
    console.log("Création de la salle, roomCode =", roomCode);
    socket.emit('roomCreated', { roomCode });
    io.to(roomCode).emit('updateGameState', game);
  });

  socket.on('joinRoom', (data) => {
    const { roomCode, playerName, playerColor } = data;
    const game = games[roomCode];
    if (!game) {
      socket.emit('errorMessage', { message: "Salle introuvable" });
      return;
    }
    if (game.playerOrder.length >= game.expectedPlayers) {
      socket.emit('errorMessage', { message: "Salle pleine" });
      return;
    }

    game.players[socket.id] = {
      name: playerName || `Joueur ${game.playerOrder.length + 1}`,
      color: playerColor || "gray",
      hand: [] 
    };
    game.playerOrder.push(socket.id);
    socket.join(roomCode);
    io.to(roomCode).emit('updateGameState', game);
  
    if (game.playerOrder.length === game.expectedPlayers) {
      dealInitialCards(game);
      io.to(roomCode).emit('startGame', game);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
