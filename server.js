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

// Create WebSocket server instance - NO PATH RESTRICTION to fix connection issues
const wss = new WebSocket.Server({ server });

// Enable debug logging
const DEBUG = true;

// Debug logger
function debugLog(message, data) {
  if (DEBUG) {
    if (data) {
      console.log(`[SERVER DEBUG] ${message}`, typeof data === 'string' ? data : JSON.stringify(data));
    } else {
      console.log(`[SERVER DEBUG] ${message}`);
    }
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

// Check if clients are alive using ping/pong
function heartbeat() {
  this.isAlive = true;
}

// Broadcast to all connected clients
function broadcast(message, excludeClient = null) {
  let messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  let count = 0;
  
  wss.clients.forEach(client => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
        count++;
      } catch (e) {
        debugLog('Failed to send message to client', e.message);
      }
    }
  });
  
  debugLog(`Broadcasted message to ${count} clients`, message);
  return count;
}

// Send message to specific client
function sendToClient(client, message) {
  if (client.readyState === WebSocket.OPEN) {
    try {
      let messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      client.send(messageStr);
      debugLog('Sent message to client', message);
      return true;
    } catch (e) {
      debugLog('Failed to send message to client', e.message);
      return false;
    }
  } else {
    debugLog('Cannot send message - client not ready', client.readyState);
    return false;
  }
}

// Count active clients
function getConnectedClientsCount() {
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      count++;
    }
  });
  return count;
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  
  debugLog('New client connected from ' + req.socket.remoteAddress);
  debugLog('Total clients: ' + getConnectedClientsCount());
  
  let playerId = null;

  // Send current world state to the new player
  function sendWorldState() {
    debugLog('Sending world state. Current players:', Object.keys(gameState.players).length);
    
    // Send all existing players
    Object.values(gameState.players).forEach(player => {
      debugLog('Sending player data', player);
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
      const data = JSON.parse(message.toString());
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
          
          // Send back confirmation to the client that joined
          sendToClient(ws, {
            type: 'join_confirm', 
            success: true,
            message: 'Successfully joined the game'
          });
          
          // Wait a bit to ensure client is ready before sending world state
          setTimeout(() => {
            sendWorldState();
            
            // Then broadcast player join to ALL clients
            debugLog('Broadcasting new player to all clients');
            const broadcastCount = broadcast({
              type: 'player_join',
              player: gameState.players[playerId]
            });
            debugLog(`Broadcast complete to ${broadcastCount} clients`);
          }, 1000);
          break;

        case 'player_position':
          // Update player position
          if (playerId && gameState.players[playerId]) {
            // Update the position in game state
            gameState.players[playerId].position = data.player.position;
            gameState.players[playerId].lastSeen = new Date();
            
            // Broadcast position update to ALL clients
            broadcast({
              type: 'player_position',
              player: {
                id: playerId,
                name: gameState.players[playerId].name,
                position: data.player.position
              }
            });
          } else {
            debugLog('Position update received but player not found', playerId);
          }
          break;

        case 'chat_message':
          if (playerId && gameState.players[playerId]) {
            const playerName = gameState.players[playerId].name;
            debugLog(`Chat from ${playerName}: ${data.message}`);
            
            // Broadcast chat message to ALL clients
            broadcast({
              type: 'chat_message',
              player: {
                id: playerId,
                name: playerName
              },
              message: data.message
            });
          } else {
            debugLog('Chat message received but player not found', playerId);
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
      const playerName = gameState.players[playerId].name;
      debugLog(`Player disconnected: ${playerName} (${playerId})`);
      
      // Broadcast player disconnect to ALL clients
      broadcast({
        type: 'player_leave',
        playerId: playerId,
        playerName: playerName
      });
      
      // Remove player from game state
      delete gameState.players[playerId];
      
      // Log remaining players
      debugLog('Remaining players:', Object.keys(gameState.players));
      debugLog('Total clients: ' + getConnectedClientsCount());
    } else {
      debugLog('Unknown client disconnected (no player ID)');
    }
  });
  
  // Handle errors
  ws.on('error', (error) => {
    debugLog('WebSocket error:', error.message);
    if (playerId && gameState.players[playerId]) {
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

// Ping all clients periodically to check if they're still alive
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      debugLog('Terminating inactive client');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

// Stop ping interval when server closes
wss.on('close', () => {
  clearInterval(pingInterval);
});

// Cleanup inactive players
setInterval(() => {
  const now = new Date();
  const timeoutThreshold = 2 * 60 * 1000; // 2 minutes in milliseconds
  
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

// Log the number of connected players periodically
setInterval(() => {
  const playerCount = Object.keys(gameState.players).length;
  const clientCount = getConnectedClientsCount();
  debugLog(`Current players online: ${playerCount} (connected clients: ${clientCount})`);
}, 30000);

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is running at ws://localhost:${PORT}`);
});
