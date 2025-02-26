// server.js (version ES Modules)
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { 
  wallsData,
  rotateCompassData,
  doubleRotateCompassData,
  entryTeleportData 
} from './config.js';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// --- Définition des cartes ---
const initialDeck = [
  { type: 'N' }, { type: 'N' }, { type: 'N' }, { type: 'N' }, { type: 'N' }, { type: 'N' },
  { type: 'E' }, { type: 'E' }, { type: 'E' }, { type: 'E' }, { type: 'E' }, { type: 'E' },
  { type: 'S' }, { type: 'S' }, { type: 'S' }, { type: 'S' }, { type: 'S' }, { type: 'S' },
  { type: 'W' }, { type: 'W' }, { type: 'W' }, { type: 'W' }, { type: 'W' }, { type: 'W' },
  { type: 'special', text: 'Volez une carte à un adversaire', action: 'steal' },
  { type: 'special', text: 'Tournez la boussole d\'un quart de tour', action: 'rotateQuarter' },
  { type: 'special', text: 'Tournez la boussole d\'un tour complet', action: 'rotateFull' }
];

// Fonction de mélange
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const games = {};
const gridSize = 20;

// On définit ici isWall avant toute utilisation
function isWall(row, col) {
  if (!wallsData) {
    console.error("wallsData est undefined");
    return false;
  }
  return wallsData.some(w => w.row === row && w.col === col);
}

// Dans l'état initial, on ajoute également des flags pour la rotation
function initializeGameState({ playersCount, namesArr, colorsArr }) {
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
    expectedPlayersCount: playersCount,
    lockedWalls: [],
    showDirection: false,
    pendingRotation: 0,
    rotationCount: 0,
  };
}

function computePositions(playersCount) {
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

function computeGoals(playersCount) {
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

function dealInitialCards(gameState) {
  gameState.playerOrder.forEach((socketId, index) => {
    const startPos = gameState.playersPositions[index];
    gameState.players[socketId].position = { ...startPos };
    gameState.players[socketId].goal = gameState.playersGoals[index];
    gameState.players[socketId].hand = drawCards(gameState);
  });
}

function drawOneCard(gameState) {
  if (gameState.deck.length === 0) {
    if (gameState.discardPile.length === 0) return null;
    gameState.deck = shuffle(gameState.discardPile);
    gameState.discardPile = [];
  }
  return gameState.deck.pop();
}

function drawCards(gameState) {
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const card = drawOneCard(gameState);
    if (card) cards.push(card);
  }
  return cards;
}

// Fonction de déplacement qui gère les murs et la rotation
function movePlayer(gameState, player, playedCardType) {
  // Ordre de base fixe
  const baseDirections = ['N', 'E', 'S', 'W'];
  const index = baseDirections.indexOf(playedCardType);
  // Récupérer la direction effective à partir de gameState.cardDirections
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

  // Gestion des murs (identique)
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

  // Gestion des cases de rotation (inchangée)
  const rotateIndex = rotateCompassData.findIndex(r => r.row === clampedRow && r.col === clampedCol);
  const doubleIndex = doubleRotateCompassData.findIndex(r => r.row === clampedRow && r.col === clampedCol);

  if (doubleIndex !== -1) {
    gameState.pendingRotation = 2;
    gameState.showDirection = true;
  } else if (rotateIndex !== -1) {
    gameState.pendingRotation = 1;
    gameState.showDirection = true;
  }

  if (player.position.row === player.goal.row && player.position.col === player.goal.col) {
    gameState.winner = player.name;
  }

  return player.position;
}

function useCardAction(gameState, socketId, payload) {
  if (gameState.playerOrder[gameState.playerTurn] !== socketId) return;
  const player = gameState.players[socketId];
  const index = payload.index;
  if (index < 0 || index >= player.hand.length) return;
  const playedCard = player.hand.splice(index, 1)[0];
  gameState.discardPile.push(playedCard);
  
  if (playedCard.type !== 'special') {
    movePlayer(gameState, player, playedCard.type);
  }
  // Vous pouvez ajouter ici la gestion des cartes spéciales si nécessaire
}

function endTurnAction(gameState) {
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

function processPlayerAction(gameState, socketId, action, payload) {
  if (action === 'useCard') {
    useCardAction(gameState, socketId, payload);
  } else if (action === 'endTurn') {
    endTurnAction(gameState);
  }
  return gameState;
}

// Gestion de l'événement de rotation choisi par le joueur depuis la modale
io.on('connection', (socket) => {
  console.log(`Connexion : ${socket.id}`);
  
  socket.on('joinGame', (data) => {
    const { gameId, playersCount, names, colors } = data;
    if (!games[gameId]) {
      games[gameId] = initializeGameState({ playersCount, namesArr: names, colorsArr: colors });
    }
    const game = games[gameId];
    if (!game.players[socket.id]) {
      const index = game.playerOrder.length;
      game.players[socket.id] = { 
        name: names[index] || `Joueur ${index+1}`, 
        color: colors[index] || 'gray' 
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
      entryTeleportData 
    });
  });
  
  socket.on('playerAction', (data) => {
    const { gameId, action, payload } = data;
    const game = games[gameId];
    if (!game) return;
    processPlayerAction(game, socket.id, action, payload);
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
    
    // Ici, vous pouvez mettre à jour le tableau cardDirections si nécessaire
    const baseDirections = ['N','E','S','W'];
    // Recalcul de cardDirections à partir de rotationCount mod 4 pour le mapping des cartes
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
