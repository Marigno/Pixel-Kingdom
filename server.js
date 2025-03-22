// server.js - WebSocket server for Pixel Kingdom
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Initialize express application
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server instance
const wss = new WebSocket.Server({ server, path: '/ws' });

// Enable debug logging
const DEBUG = true;

// Debug logger
function debugLog(message, data) {
  if (DEBUG) {
    console.log(`[SERVER DEBUG] ${message}`, data || '');
  }
}

// Game state
const gameState = {
  players: {},
  nextNpcId: 1000,
  npcs: [],
  items: []
};

// Initialize some basic NPCs
function initializeNPCs() {
  // Add a shopkeeper
  gameState.npcs.push({
    id: gameState.nextNpcId++,
    name: "Shopkeeper",
    type: "npc",
    position: { x: 10, y: 0, z: 12 }
  });

  // Add a quest giver
  gameState.npcs.push({
    id: gameState.nextNpcId++,
    name: "Quest Master",
    type: "npc",
    position: { x: -8, y: 0, z: -8 }
  });
}

// Initialize the world
initializeNPCs();

// Broadcast to all connected clients
function broadcast(message, excludeClient = null) {
  let messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  let count = 0;
  
  wss.clients.forEach(client => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
      count++;
    }
  });
  
  debugLog(`Broadcasted message to ${count} clients`, message);
}

// Send message to specific client
function sendToClient(client, message) {
  if (client.readyState === WebSocket.OPEN) {
    let messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    client.send(messageStr);
    debugLog('Sent message to client', message);
  } else {
    debugLog('Cannot send message - client not ready', client.readyState);
  }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  debugLog('New client connected');
  let playerId = null;

  // Send current world state to the new player
  function sendWorldState() {
    // Send all existing players
    Object.values(gameState.players).forEach(player => {
      sendToClient(ws, {
        type: 'player_join',
        player: player
      });
    });

    // Send all NPCs
    gameState.npcs.forEach(npc => {
      sendToClient(ws, {
        type: 'npc_info',
        npc: npc
      });
    });

    // Send all items
    gameState.items.forEach(item => {
      sendToClient(ws, {
        type: 'item_info',
        item: item
      });
    });
    
    debugLog('World state sent to new player');
  }

  // Handle messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      debugLog('Received message', data);

      // Handle different message types
      switch (data.type) {
        case 'player_join':
          // Store player in game state
          playerId = data.player.id;
          
          // Save all player data including level and health
          gameState.players[playerId] = {
            id: data.player.id,
            name: data.player.name,
            class: data.player.class,
            position: data.player.position,
            level: data.player.level || 1,
            health: data.player.health || 100,
            maxHealth: data.player.maxHealth || 100,
            lastSeen: new Date()
          };
          
          debugLog(`Player joined: ${data.player.name} (${playerId})`);
          
          // Send current world state to the new player (including other players)
          setTimeout(() => {
            sendWorldState();
          }, 500);
          
          // Broadcast player join to all clients (including the player who just joined)
          broadcast({
            type: 'player_join',
            player: gameState.players[playerId]
          });
          break;

        case 'player_position':
          // Update player position
          if (playerId && gameState.players[playerId]) {
            gameState.players[playerId].position = data.player.position;
            gameState.players[playerId].lastSeen = new Date();
            
            // Broadcast position update to all clients
            broadcast({
              type: 'player_position',
              player: {
                id: playerId,
                name: gameState.players[playerId].name,
                position: data.player.position
              }
            });
          }
          break;

        case 'chat_message':
          if (playerId && gameState.players[playerId]) {
            debugLog(`Chat from ${gameState.players[playerId].name}: ${data.message}`);
            
            // Broadcast chat message to all clients
            broadcast({
              type: 'chat_message',
              player: {
                id: playerId,
                name: gameState.players[playerId].name
              },
              message: data.message
            });
          }
          break;
          
        case 'player_update':
          // Update player stats like health, level, etc.
          if (playerId && gameState.players[playerId]) {
            if (data.player.health) gameState.players[playerId].health = data.player.health;
            if (data.player.maxHealth) gameState.players[playerId].maxHealth = data.player.maxHealth;
            if (data.player.level) gameState.players[playerId].level = data.player.level;
            gameState.players[playerId].lastSeen = new Date();
            
            // Broadcast update to all clients
            broadcast({
              type: 'player_update',
              player: gameState.players[playerId]
            });
          }
          break;

        case 'player_action':
          // Handle player actions (combat, interaction, etc.)
          handlePlayerAction(data, ws);
          break;

        default:
          debugLog(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  // Handle client disconnect
  ws.on('close', () => {
    if (playerId && gameState.players[playerId]) {
      debugLog(`Player disconnected: ${gameState.players[playerId].name} (${playerId})`);
      
      // Broadcast player disconnect to other clients
      broadcast({
        type: 'player_leave',
        playerId: playerId,
        playerName: gameState.players[playerId].name
      });
      
      // Remove player from game state
      delete gameState.players[playerId];
    }
  });
});

// Handle player actions
function handlePlayerAction(data, ws) {
  const { action, targetId, playerId } = data;
  
  switch (action) {
    case 'interact_npc':
      // Find the NPC the player wants to interact with
      const npc = gameState.npcs.find(n => n.id === targetId);
      if (npc) {
        // Send NPC dialog to the player
        sendToClient(ws, {
          type: 'npc_dialog',
          npcId: targetId,
          npcName: npc.name,
          dialog: `Hello adventurer! I am ${npc.name}.`
        });
      }
      break;
      
    case 'attack':
      // Handle combat logic here
      break;
      
    case 'pickup_item':
      // Handle item pickup logic
      break;
  }
}

// Cleanup inactive players (uncommented to help with stuck connections)
setInterval(() => {
  const now = new Date();
  const timeoutThreshold = 5 * 60 * 1000; // 5 minutes in milliseconds
  
  Object.keys(gameState.players).forEach(playerId => {
    const player = gameState.players[playerId];
    if (now - player.lastSeen > timeoutThreshold) {
      debugLog(`Removing inactive player: ${player.name} (${playerId})`);
      
      // Broadcast player disconnect
      broadcast({
        type: 'player_leave',
        playerId: playerId,
        playerName: player.name
      });
      
      // Remove player from game state
      delete gameState.players[playerId];
    }
  });
}, 60000); // Check every minute

// Route to serve the game client
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Log the number of connected players every 30 seconds
setInterval(() => {
  const playerCount = Object.keys(gameState.players).length;
  debugLog(`Current players online: ${playerCount}`);
}, 30000);

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is running at ws://localhost:${PORT}/ws`);
});
