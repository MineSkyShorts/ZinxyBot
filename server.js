// ===================== KORRIGIERTER SERVER.JS - VOLLSTÃ„NDIG UND OHNE MOD/VIP BONUS =====================
import express from 'express';
import session from 'express-session';
import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import tmi from 'tmi.js';

// ===================== PATH SETUP =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// ===================== MIDDLEWARE =====================
// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: http:; connect-src 'self' wss: ws: https: http:; font-src 'self' data: https://fonts.gstatic.com;");
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Validate session secret in production
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === 'your-secret-key') {
  if (process.env.NODE_ENV === 'production') {
    console.error('SECURITY WARNING: SESSION_SECRET environment variable must be set in production!');
    process.exit(1);
  } else {
    console.warn('WARNING: Using default session secret in development. Set SESSION_SECRET environment variable.');
  }
}

app.use(session({
  secret: sessionSecret || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true, // Ermöglicht Session-Erstellung vor Login
  cookie: { 
    secure: false, // Temporär auf false für Debugging
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax' // Weniger restriktiv für OAuth-Redirects
  }
}));

// ===================== ADMIN USER IDs =====================
const ADMIN_USER_IDS = ['659450187', '487354230']; // Twitch User IDs for automatic admin privileges

// ===================== BENUTZERSPEZIFISCHE DATENSTRUKTUREN =====================
const userSessions = new Map();
const userBadges = new Map();
const userEmotes = new Map();

let globalBadges = {};
let globalEmotes = new Map();
let bttvEmotes = new Map();
let ffzEmotes = new Map();
let seventvEmotes = new Map();

// Flag to ensure emotes are initialized only once
let emotesInitialized = false;

// Emote cache to prevent repeated API calls
const emoteCache = {
  lastUpdated: {
    global: 0,
    bttv: 0,
    ffz: 0,
    seventv: 0
  },
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  
  shouldRefresh(provider) {
    const now = Date.now();
    return (now - this.lastUpdated[provider]) > this.CACHE_DURATION;
  },
  
  markUpdated(provider) {
    this.lastUpdated[provider] = Date.now();
  }
};

// Per-user emote cache
const userEmoteCache = new Map();
const USER_EMOTE_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Rate limiting for user emote requests
const rateLimitQueue = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 requests per minute per user

class UserEmoteManager {
  static checkRateLimit(requesterUserId) {
    const now = Date.now();
    
    if (!rateLimitQueue.has(requesterUserId)) {
      rateLimitQueue.set(requesterUserId, []);
    }
    
    const requests = rateLimitQueue.get(requesterUserId);
    
    // Remove old requests outside the window
    const validRequests = requests.filter(time => (now - time) < RATE_LIMIT_WINDOW);
    rateLimitQueue.set(requesterUserId, validRequests);
    
    // Check if we're at the limit
    if (validRequests.length >= MAX_REQUESTS_PER_WINDOW) {
      console.log(`Rate-Limit erreicht für Benutzer ${requesterUserId}`);
      return false;
    }
    
    // Add current request
    validRequests.push(now);
    rateLimitQueue.set(requesterUserId, validRequests);
    return true;
  }
  
  static async getUserEmotes(userId, accessToken, requesterUserId) {
    const cacheKey = `${userId}_${requesterUserId}`;
    const cached = userEmoteCache.get(cacheKey);
    
    // Return cached data if still valid
    if (cached && (Date.now() - cached.timestamp) < USER_EMOTE_CACHE_DURATION) {
      return cached.emotes;
    }
    
    // Check rate limiting
    if (!UserEmoteManager.checkRateLimit(requesterUserId)) {
      return cached ? cached.emotes : new Map();
    }
    
    try {
      
      const response = await axios.get(`${TWITCH_API}/chat/emotes/user`, {
        headers: {
          'Client-Id': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        },
        params: { user_id: userId },
        timeout: 5000
      });
      
      const emoteMap = new Map();
      response.data.data.forEach(emote => {
        
        emoteMap.set(emote.name, {
          id: emote.id,
          name: emote.name,
          url: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/1.0`,
          url_2x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/2.0`,
          url_4x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/3.0`,
          provider: 'twitch-user',
          emoteType: emote.emote_type || 'unknown',
          tier: emote.tier || null,
          setId: emote.emote_set_id || null
        });
      });
      
      // Cache the result
      userEmoteCache.set(cacheKey, {
        emotes: emoteMap,
        timestamp: Date.now()
      });
      
      return emoteMap;
      
    } catch (error) {
      console.error(`Fehler beim Laden der Benutzer-Emotes für ${userId}:`, error.message);
      
      // Return cached emotes if available, even if expired
      return cached ? cached.emotes : new Map();
    }
  }
  
  static cleanupCache() {
    const now = Date.now();
    
    // Clean up user emote cache
    for (const [key, data] of userEmoteCache.entries()) {
      if ((now - data.timestamp) > USER_EMOTE_CACHE_DURATION) {
        userEmoteCache.delete(key);
      }
    }
    
    // Clean up rate limit queue
    for (const [userId, requests] of rateLimitQueue.entries()) {
      const validRequests = requests.filter(time => (now - time) < RATE_LIMIT_WINDOW);
      if (validRequests.length === 0) {
        rateLimitQueue.delete(userId);
      } else {
        rateLimitQueue.set(userId, validRequests);
      }
    }
  }
}

// Clean up user emote cache every 30 minutes
setInterval(() => {
  UserEmoteManager.cleanupCache();
}, 30 * 60 * 1000);

// ===================== TEXT EMOTES MAPPING ===================== 
const textEmotes = {
  ':)': 'ðŸ˜Š', ':(': 'ðŸ˜ž', ':D': 'ðŸ˜ƒ', ':P': 'ðŸ˜›', ':p': 'ðŸ˜›',
  ':|': 'ðŸ˜', ':/': 'ðŸ˜•', ':\\': 'ðŸ˜•', ':o': 'ðŸ˜®', ':O': 'ðŸ˜®',
  ';)': 'ðŸ˜‰', ';P': 'ðŸ˜œ', ':3': 'ðŸ˜Š', '<3': 'â¤ï¸', '</3': 'ðŸ’”',
  'xD': 'ðŸ¤£', 'XD': 'ðŸ¤£', ':*': 'ðŸ˜˜', '8)': 'ðŸ˜Ž', 'B)': 'ðŸ˜Ž',
  ':>': 'ðŸ˜Š', '<3': 'â¤ï¸', 'o_O': 'ðŸ˜³', 'O_o': 'ðŸ˜³', '-_-': 'ðŸ˜‘'
};

// ===================== TWITCH API URLs =====================
const TWITCH_AUTH = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API = 'https://api.twitch.tv/helix';

// ===================== BASE SCOPES =====================
const BASE_SCOPES = ['chat:read','chat:edit','channel:read:subscriptions','bits:read','moderator:read:followers','user:read:emotes'];

// ===================== BENUTZERSPEZIFISCHE SESSION MANAGEMENT =====================
function getUserSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      giveaway: new GiveawayManager(),
      luckSettings: {
        enabled: true,
        bits: [
          { min: 1000, mult: 1.2 },
          { min: 5000, mult: 1.5 },
          { min: 10000, mult: 2.0 },
          { min: 25000, mult: 3.0 },
          { min: 50000, mult: 4.0 },
          { min: 100000, mult: 5.0 },
          { min: 1000000, mult: 10.0 }
        ],
        subs: [
          { min: 1, mult: 1.2 },
          { min: 3, mult: 1.5 },
          { min: 6, mult: 2.0 },
          { min: 9, mult: 2.5 },
          { min: 12, mult: 3.0 },
          { min: 18, mult: 3.5 },
          { min: 24, mult: 4.0 }
        ]
      },
      generalSettings: {
        autoJoinHost: false, // âœ… GEÃ„NDERT: Auto-join standardmÃ¤ÃŸig AUS
        antispam: true
      },
      spamTracker: new Map(),
      tmiClient: null,
      channelBadges: {},
      channelEmotes: new Map(),
      socketIds: new Set(),
      isAdmin: ADMIN_USER_IDS.includes(userId)
    });
  }
  return userSessions.get(userId);
}

function cleanupUserSession(userId) {
  const session = userSessions.get(userId);
  if (session) {
    if (session.tmiClient) {
      session.tmiClient.disconnect();
    }
    userSessions.delete(userId);
  }
}

// ===================== SOCKET MANAGEMENT =====================
const socketUserMap = new Map();

// Socket.IO authentication middleware
io.use((socket, next) => {
  const sessionId = socket.handshake.headers.cookie?.match(/connect\.sid=([^;]+)/)?.[1];
  if (!sessionId) {
    return next(new Error('No session cookie'));
  }
  next();
});

io.on('connection', (socket) => {
  
  socket.on('auth', (userId) => {
    // Validate that the userId matches the session
    if (userId && typeof userId === 'string' && /^[0-9]+$/.test(userId)) {
      socketUserMap.set(socket.id, userId);
      const userSession = getUserSession(userId);
      userSession.socketIds.add(socket.id);
      
      sendUserSpecificData(socket, userId);
    } else {
      console.warn(`Invalid auth attempt: ${userId}`);
      socket.emit('auth_error', 'Invalid user ID');
    }
  });
  
  // Handle test participant addition (Admin only)
  socket.on('test-participant-add', (participantData) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;
    
    const userSession = getUserSession(userId);
    
    console.log(`Test-Teilnehmer anfrage von User ${userId}, Admin: ${userSession.isAdmin}, NODE_ENV: ${process.env.NODE_ENV}`);
    // Allow test participants in development or for admin users
    const isDevelopment = process.env.NODE_ENV !== 'production';
    console.log(`Berechtigung prüfen: isAdmin=${userSession.isAdmin}, isDevelopment=${isDevelopment}`);
    if (!userSession.isAdmin && !isDevelopment) {
      console.warn(`Unauthorized test participant attempt by ${userId}`);
      return;
    }
    
    // Validate and sanitize input
    if (!participantData || typeof participantData !== 'object') return;
    
    const login = String(participantData.login || '').replace(/[<>'"&]/g, '').substring(0, 25);
    const displayName = String(participantData.displayName || login).replace(/[<>'"&]/g, '').substring(0, 50);
    const luck = Math.max(0.1, Math.min(10, parseFloat(participantData.luck) || 1.0));
    
    if (!login) return;
    
    // Add participant to giveaway participants (GiveawayManager already has participants Map)
    const participant = {
      login: login,
      userId: `test_${login}`,
      displayName: displayName,
      joinedAt: new Date().toISOString(),
      luck: luck,
      badges: [],
      multiplierText: getMultiplierText(luck),
      profileImageUrl: participantData.profileImageUrl,
      isTestParticipant: true
    };
    
    console.log(`📝 Test-Teilnehmer erstellt:`, {
      login: participant.login,
      displayName: participant.displayName,
      profileImageUrl: participant.profileImageUrl,
      luck: participant.luck
    });
    
    // Add to both participants maps to ensure proper winner selection
    userSession.giveaway.participants.set(login, participant);
    userSession.giveaway.entries = userSession.giveaway.participants.size;
    
    // Broadcast via normal participant system so they behave like real participants
    userSession.socketIds.forEach(socketId => {
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        console.log(`📡 Sende participant:add Event für ${participant.login} an Socket ${socketId}`);
        targetSocket.emit('participant:add', participant);
      }
    });
    
    console.log(`✅ Test-Teilnehmer hinzugefügt: ${participant.login} (Glück: ${participant.luck}x)`);
    console.log(`📊 Aktuelle Teilnehmer-Anzahl: ${userSession.giveaway.participants.size}`);
  });
  
  socket.on('disconnect', () => {
    const userId = socketUserMap.get(socket.id);
    if (userId) {
      const userSession = getUserSession(userId);
      userSession.socketIds.delete(socket.id);
      
      if (userSession.socketIds.size === 0) {
        setTimeout(() => {
          const session = getUserSession(userId);
          if (session.socketIds.size === 0) {
            cleanupUserSession(userId);
          }
        }, 5 * 60 * 1000);
      }
      
      socketUserMap.delete(socket.id);
    }
  });
});

function emitToUser(userId, event, data) {
  const userSession = getUserSession(userId);
  userSession.socketIds.forEach(socketId => {
    io.to(socketId).emit(event, data);
  });
}

function sendUserSpecificData(socket, userId) {
  const userSession = getUserSession(userId);
  
  socket.emit('giveaway:status', { 
    state: userSession.giveaway.state, 
    keyword: userSession.giveaway.keyword, 
    channel: userSession.giveaway.channel,
    duration: userSession.giveaway.duration,
    subsOnly: userSession.giveaway.subsOnly,
    autoJoinHost: userSession.generalSettings.autoJoinHost
  });
  
  const participants = Array.from(userSession.giveaway.participants.values());
  participants.forEach(participant => {
    socket.emit('participant:add', participant);
  });
  
  socket.emit('stats:update', userSession.giveaway.getStats());
}

// ===================== EMOTE LOADER FUNKTIONEN =====================
async function loadGlobalEmotes(accessToken) {
  try {
    const response = await axios.get(`${TWITCH_API}/chat/emotes/global`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    globalEmotes.clear();
    response.data.data.forEach(emote => {
      globalEmotes.set(emote.name, {
        id: emote.id,
        name: emote.name,
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/1.0`,
        url_2x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/2.0`,
        url_4x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/3.0`,
        provider: 'twitch'
      });
    });
    
    // Add classic Twitch text emotes manually (these have fixed IDs)
    const classicEmotes = [
      { name: ':)', id: '1' },
      { name: ':(', id: '2' },
      { name: ':o', id: '8' },
      { name: ':z', id: '5' },
      { name: 'B)', id: '7' },
      { name: ':\\\\', id: '10' },
      { name: ';)', id: '11' },
      { name: ':w', id: '12' },
      { name: ':p', id: '12' },
      { name: ':P', id: '12' },
      { name: 'R)', id: '14' },
      { name: 'o_O', id: '6' },
      { name: ':D', id: '3' },
      { name: '>(', id: '4' },
      { name: '<3', id: '9' }
    ];
    
    classicEmotes.forEach(emote => {
      if (!globalEmotes.has(emote.name)) {
        globalEmotes.set(emote.name, {
          id: emote.id,
          name: emote.name,
          url: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/1.0`,
          url_2x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/2.0`,
          url_4x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/3.0`,
          provider: 'twitch-classic'
        });
      }
    });
    
    console.log(`${globalEmotes.size} globale Twitch Emotes geladen`);
  } catch (error) {
    console.error('âŒ Failed to load global emotes:', error.message);
  }
}

async function loadChannelEmotes(channelId, accessToken, userId) {
  try {
    const response = await axios.get(`${TWITCH_API}/chat/emotes`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { broadcaster_id: channelId }
    });
    
    const userSession = getUserSession(userId);
    userSession.channelEmotes.clear();
    
    let emoteTypes = {};
    response.data.data.forEach(emote => {
      
      // Count emote types for logging
      const type = emote.emote_type || 'unknown';
      emoteTypes[type] = (emoteTypes[type] || 0) + 1;
      
      userSession.channelEmotes.set(emote.name, {
        id: emote.id,
        name: emote.name,
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/1.0`,
        url_2x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/2.0`,
        url_4x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/3.0`,
        provider: 'twitch-channel',
        emoteType: emote.emote_type || 'unknown',
        tier: emote.tier || null
      });
    });
    
  } catch (error) {
    console.error('âŒ Failed to load channel emotes:', error.message);
  }
}

async function loadUserEmotes(accessToken, userId) {
  try {
    
    // Load user's emote sets (includes subscriber emotes)
    const response = await axios.get(`${TWITCH_API}/chat/emotes/user`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { user_id: userId }
    });
    
    const userSession = getUserSession(userId);
    let userEmoteCount = 0;
    
    response.data.data.forEach(emote => {
      // Add to user's channel emotes if not already there
      if (!userSession.channelEmotes.has(emote.name)) {
        userSession.channelEmotes.set(emote.name, {
          id: emote.id,
          name: emote.name,
          url: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/1.0`,
          url_2x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/2.0`,
          url_4x: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/3.0`,
          provider: 'twitch-user'
        });
        userEmoteCount++;
      }
    });
    
  } catch (error) {
    console.error('âŒ Failed to load user emotes:', error.message);
  }
}

async function loadBTTVEmotes(channelId = null) {
  try {
    
    // Only load global emotes if cache is expired
    if (emoteCache.shouldRefresh('bttv')) {
      const globalResponse = await axios.get('https://api.betterttv.net/3/cached/emotes/global', {
        timeout: 10000
      });
      bttvEmotes.clear();
      globalResponse.data.forEach(emote => {
        // BTTV emotes: check if animated property exists
        const isAnimated = emote.animated || false;
        
        bttvEmotes.set(emote.code, {
          id: emote.id,
          name: emote.code,
          url: `https://cdn.betterttv.net/emote/${emote.id}/1x`,
          url_2x: `https://cdn.betterttv.net/emote/${emote.id}/2x`,
          url_4x: `https://cdn.betterttv.net/emote/${emote.id}/3x`,
          provider: 'bttv',
          animated: isAnimated
        });
      });
      emoteCache.markUpdated('bttv');
    }
    
    if (channelId) {
      try {
        const channelResponse = await axios.get(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`, {
          timeout: 10000
        });
        channelResponse.data.channelEmotes?.forEach(emote => {
          // BTTV emotes: check if animated property exists
          const isAnimated = emote.animated || false;
          
          bttvEmotes.set(emote.code, {
            id: emote.id,
            name: emote.code,
            url: `https://cdn.betterttv.net/emote/${emote.id}/1x`,
            url_2x: `https://cdn.betterttv.net/emote/${emote.id}/2x`,
            url_4x: `https://cdn.betterttv.net/emote/${emote.id}/3x`,
            provider: 'bttv',
            animated: isAnimated
          });
        });
        
        channelResponse.data.sharedEmotes?.forEach(emote => {
          // BTTV emotes: check if animated property exists
          const isAnimated = emote.animated || false;
          
          bttvEmotes.set(emote.code, {
            id: emote.id,
            name: emote.code,
            url: `https://cdn.betterttv.net/emote/${emote.id}/1x`,
            url_2x: `https://cdn.betterttv.net/emote/${emote.id}/2x`,
            url_4x: `https://cdn.betterttv.net/emote/${emote.id}/3x`,
            provider: 'bttv',
            animated: isAnimated
          });
        });
      } catch (e) {
      }
    }
    
  } catch (error) {
    console.error('âŒ Failed to load BTTV emotes:', error.message);
  }
}

async function loadFFZEmotes(channelId = null) {
  try {
    
    const globalResponse = await axios.get('https://api.frankerfacez.com/v1/set/global', {
      timeout: 10000
    });
    ffzEmotes.clear();
    Object.values(globalResponse.data.sets).forEach(set => {
      set.emoticons?.forEach(emote => {
        const urls = emote.urls;
        // FFZ emotes: check if animated property exists
        const isAnimated = emote.animated || false;
        
        ffzEmotes.set(emote.name, {
          id: emote.id,
          name: emote.name,
          url: `https:${urls['1'] || urls['2'] || urls['4']}`,
          url_2x: `https:${urls['2'] || urls['1'] || urls['4']}`,
          url_4x: `https:${urls['4'] || urls['2'] || urls['1']}`,
          provider: 'ffz',
          animated: isAnimated
        });
      });
    });
    
    if (channelId) {
      try {
        const channelResponse = await axios.get(`https://api.frankerfacez.com/v1/room/id/${channelId}`, {
          timeout: 10000
        });
        Object.values(channelResponse.data.sets).forEach(set => {
          set.emoticons?.forEach(emote => {
            const urls = emote.urls;
            // FFZ emotes: check if animated property exists
            const isAnimated = emote.animated || false;
            
            ffzEmotes.set(emote.name, {
              id: emote.id,
              name: emote.name,
              url: `https:${urls['1'] || urls['2'] || urls['4']}`,
              url_2x: `https:${urls['2'] || urls['1'] || urls['4']}`,
              url_4x: `https:${urls['4'] || urls['2'] || urls['1']}`,
              provider: 'ffz',
              animated: isAnimated
            });
          });
        });
      } catch (e) {
      }
    }
    
  } catch (error) {
    console.error('âŒ Failed to load FFZ emotes:', error.message);
  }
}

async function load7TVEmotes(channelId = null) {
  try {
    
    // Load global 7TV emotes
    const globalResponse = await axios.get('https://7tv.io/v3/emote-sets/global', {
      timeout: 10000
    });
    seventvEmotes.clear();
    globalResponse.data.emotes?.forEach(emote => {
      // Check if emote is animated by looking for animated flag
      const isAnimated = emote.flags && (emote.flags & 1) !== 0; // Flag 1 = animated
      const format = isAnimated ? 'gif' : 'webp';
      
      seventvEmotes.set(emote.name, {
        id: emote.id,
        name: emote.name,
        url: `https://cdn.7tv.app/emote/${emote.id}/1x.${format}`,
        url_2x: `https://cdn.7tv.app/emote/${emote.id}/2x.${format}`,
        url_4x: `https://cdn.7tv.app/emote/${emote.id}/4x.${format}`,
        provider: '7tv',
        animated: isAnimated
      });
    });
    
    if (channelId) {
      try {
        // Get 7TV user ID for the Twitch channel
        const userResponse = await axios.get(`https://7tv.io/v3/users/twitch/${channelId}`, {
          timeout: 10000
        });
        const seventvUserId = userResponse.data.id;
        
        // Get channel emote set
        const channelResponse = await axios.get(`https://7tv.io/v3/users/${seventvUserId}`, {
          timeout: 10000
        });
        const emoteSet = channelResponse.data.emote_set;
        
        if (emoteSet && emoteSet.emotes) {
          emoteSet.emotes.forEach(emote => {
            // Check if emote is animated by looking for animated flag
            const isAnimated = emote.flags && (emote.flags & 1) !== 0; // Flag 1 = animated
            const format = isAnimated ? 'gif' : 'webp';
            
            seventvEmotes.set(emote.name, {
              id: emote.id,
              name: emote.name,
              url: `https://cdn.7tv.app/emote/${emote.id}/1x.${format}`,
              url_2x: `https://cdn.7tv.app/emote/${emote.id}/2x.${format}`,
              url_4x: `https://cdn.7tv.app/emote/${emote.id}/4x.${format}`,
              provider: '7tv',
              animated: isAnimated
            });
          });
        }
      } catch (e) {
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to load 7TV emotes:', error.message);
  }
}

// ===================== EMOTE REFRESH FUNCTION =====================
async function refreshAllEmotes(channelId, accessToken, userId) {
  
  try {
    // Load emotes in parallel for better performance
    await Promise.allSettled([
      loadGlobalEmotes(accessToken),
      loadChannelEmotes(channelId, accessToken, userId),
      loadUserEmotes(accessToken, userId), // Load user's subscriber emotes
      loadBTTVEmotes(channelId),
      loadFFZEmotes(channelId),
      load7TVEmotes(channelId)
    ]);
    
    
    // Emit emote refresh event to client
    emitToUser(userId, 'emotes:refreshed', {
      global: globalEmotes.size,
      channel: getUserSession(userId).channelEmotes.size,
      bttv: bttvEmotes.size,
      ffz: ffzEmotes.size,
      seventv: seventvEmotes.size
    });
    
  } catch (error) {
    console.error('❌ Failed to refresh emotes:', error.message);
  }
}

// ===================== BADGE LOADER FUNKTIONEN =====================
async function loadGlobalBadges(accessToken) {
  try {
    const response = await axios.get(`${TWITCH_API}/chat/badges/global`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    const badgeData = {};
    response.data.data.forEach(badgeSet => {
      badgeData[badgeSet.set_id] = {};
      badgeSet.versions.forEach(version => {
        badgeData[badgeSet.set_id][version.id] = {
          url: version.image_url_1x,
          url_2x: version.image_url_2x,
          url_4x: version.image_url_4x,
          title: version.title,
          description: version.description,
          clickAction: version.click_action || null,
          clickUrl: version.click_url || null
        };
      });
    });
    
    globalBadges = badgeData;
    console.log(`${Object.keys(globalBadges).length} globale Badges geladen`);
    return badgeData;
  } catch (error) {
    console.error('âŒ Fehler beim Laden der globalen Badges:', error.message);
    return {};
  }
}

async function loadChannelBadges(channelId, accessToken, userId) {
  try {
    const response = await axios.get(`${TWITCH_API}/chat/badges`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { broadcaster_id: channelId }
    });
    
    const badgeData = {};
    response.data.data.forEach(badgeSet => {
      badgeData[badgeSet.set_id] = {};
      badgeSet.versions.forEach(version => {
        badgeData[badgeSet.set_id][version.id] = {
          url: version.image_url_1x,
          url_2x: version.image_url_2x,
          url_4x: version.image_url_4x,
          title: version.title,
          description: version.description,
          clickAction: version.click_action || null,
          clickUrl: version.click_url || null
        };
      });
    });
    
    const userSession = getUserSession(userId);
    userSession.channelBadges = badgeData;
    
    return badgeData;
  } catch (error) {
    console.error('âŒ Fehler beim Laden der Channel Badges:', error.message);
    return {};
  }
}

async function loadUserProfileImage(userId, accessToken) {
  try {
    const response = await axios.get(`${TWITCH_API}/users`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { id: userId }
    });
    if (response.data.data && response.data.data.length > 0) {
      const profileUrl = response.data.data[0].profile_image_url;
      return profileUrl;
    }
    return null;
  } catch (error) {
    console.error(`âŒ Failed to load profile image for user ${userId}:`, error.message);
    return null;
  }
}

// ===================== KORRIGIERTE BADGE PARSER =====================
function parseBadges(tags, userId = null) {
  const badges = [];
  
  let badgeString = tags.badges || tags['badges-raw'] || '';
  let badgeInfoString = tags['badge-info'] || tags['badge-info-raw'] || '';
  
  // Debug logging
  const username = tags.username || tags['display-name'] || 'unknown';
  console.log(`🏷️ parseBadges for ${username}:`);
  console.log(`  - input tags.badges: "${tags.badges}"`);
  console.log(`  - input tags['badges-raw']: "${tags['badges-raw']}"`);
  console.log(`  - input tags['badge-info']: "${tags['badge-info']}"`);
  console.log(`  - input tags['badge-info-raw']: "${tags['badge-info-raw']}"`);
  
  if (typeof tags.badges === 'object' && tags.badges !== null && !Array.isArray(tags.badges)) {
    console.log(`  - converting object badges to string`);
    badgeString = Object.entries(tags.badges)
      .map(([key, value]) => `${key}/${value}`)
      .join(',');
  }
  
  if (typeof badgeString !== 'string') {
    badgeString = String(badgeString || '');
  }
  
  if (typeof badgeInfoString !== 'string') {
    badgeInfoString = String(badgeInfoString || '');
  }
  
  console.log(`  - final badgeString: "${badgeString}"`);
  console.log(`  - final badgeInfoString: "${badgeInfoString}"`);
  
  if (!badgeString || badgeString.length === 0) {
    console.log(`  - no badges to parse, returning empty array`);
    return badges;
  }
  
  try {
    const badgePairs = badgeString.split(',');
    for (const pair of badgePairs) {
      if (!pair || typeof pair !== 'string') continue;
      
      const [name, version] = pair.split('/');
      if (name && version !== undefined) {
        const cleanName = name.trim();
        const cleanVersion = String(version).trim();
        
        const badgeData = getBadgeData(cleanName, cleanVersion, userId);
        const badge = {
          name: cleanName,
          version: cleanVersion,
          url: badgeData?.url || null,
          url_2x: badgeData?.url_2x || null,
          url_4x: badgeData?.url_4x || null,
          title: badgeData?.title || getBadgeTitle(cleanName, cleanVersion, badgeInfoString),
          description: badgeData?.description || '',
          clickAction: badgeData?.clickAction || null,
          clickUrl: badgeData?.clickUrl || null
        };
        
        if (badge.url) {
          badges.push(badge);
        } else {
          const fallbackUrl = getFallbackBadgeUrl(cleanName, cleanVersion);
          if (fallbackUrl) {
            badge.url = fallbackUrl;
            badge.url_2x = fallbackUrl;
            badge.url_4x = fallbackUrl;
            badges.push(badge);
          }
        }
      }
    }
  } catch (error) {
    console.error('âŒ Error parsing badges:', error.message);
  }
  
  console.log(`  - parsed ${badges.length} badges:`, badges.map(b => `${b.name}/${b.version}`));
  
  return badges;
}

function getBadgeData(badgeSet, version, userId = null) {
  if (userId) {
    const userSession = getUserSession(userId);
    if (userSession.channelBadges && userSession.channelBadges[badgeSet]) {
      return userSession.channelBadges[badgeSet][version] || null;
    }
  }
  if (globalBadges[badgeSet]) {
    return globalBadges[badgeSet][version] || null;
  }
  return null;
}

function getFallbackBadgeUrl(badgeName, badgeVersion) {
  const baseUrl = 'https://static-cdn.jtvnw.net/badges/v1';
  
  const knownBadges = {
    'moderator': `${baseUrl}/3267646d-33f0-4b17-b3df-f923a41db1d0/1`,
    'vip': `${baseUrl}/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/1`,
    'broadcaster': `${baseUrl}/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1`,
    'subscriber': `${baseUrl}/5d9f2208-5dd8-11e7-8513-2ff4adfae661/${badgeVersion}`,
    'premium': `${baseUrl}/bbbe0db0-a598-423e-86d0-f9fb98ca1933/1`,
    'turbo': `${baseUrl}/bd444ec6-8f34-4bf9-91f4-af1e3428d80f/1`,
    'partner': `${baseUrl}/d12a2e27-16f6-41d0-ab77-b780518f00a3/1`,
    'staff': `${baseUrl}/d97c37bd-a6f5-4c38-8f57-4e4bef88af34/1`
  };
  
  return knownBadges[badgeName] || null;
}

function getBadgeTitle(badgeName, badgeVersion, badgeInfoString = '') {
  const badgeData = getBadgeData(badgeName, badgeVersion);
  if (badgeData?.title) {
    return badgeData.title;
  }
  
  let additionalInfo = '';
  if (badgeInfoString && badgeInfoString.includes(badgeName)) {
    const infoMatch = badgeInfoString.match(new RegExp(`${badgeName}\\/(\\d+)`));
    if (infoMatch) {
      additionalInfo = infoMatch[1];
    }
  }
  
  const fallbackTitles = {
    'subscriber': additionalInfo ? `${additionalInfo} Month Subscriber` : `Subscriber`,
    'broadcaster': 'Broadcaster',
    'moderator': 'Moderator', 
    'vip': 'VIP',
    'founder': 'Founder',
    'premium': 'Prime Gaming',
    'staff': 'Twitch Staff',
    'admin': 'Twitch Admin',
    'global_mod': 'Global Moderator',
    'bits': `${badgeVersion} Bits`,
    'bits-leader': `Bits Leader ${badgeVersion}`,
    'sub-gifter': additionalInfo ? `${additionalInfo} Gift Subs` : `Sub Gifter`,
    'sub-gift-leader': 'Sub Gift Leader',
    'turbo': 'Turbo',
    'partner': 'Verified',
    'verified': 'Verified'
  };
  
  return fallbackTitles[badgeName] || `${badgeName} ${badgeVersion}`;
}

// ===================== EMOTE PARSER =====================
async function ensureEmotesLoaded(accessToken = null) {
  if (!emotesInitialized) {
    try {
      console.log('🎭 Loading emotes for first time...');
      
      const loadPromises = [
        loadBTTVEmotes(null),
        loadFFZEmotes(null), 
        load7TVEmotes(null)
      ];
      
      // Load global Twitch emotes if we have an access token
      if (accessToken) {
        loadPromises.push(loadGlobalEmotes(accessToken));
      }
      
      await Promise.allSettled(loadPromises);
      emotesInitialized = true;
      
      console.log(`✅ Emotes initialized - Global: ${globalEmotes.size}, BTTV: ${bttvEmotes.size}, FFZ: ${ffzEmotes.size}, 7TV: ${seventvEmotes.size}`);
    } catch (error) {
      console.error('❌ Failed to load emotes:', error.message);
    }
  } else if (accessToken && globalEmotes.size === 0) {
    // If emotes are initialized but we don't have global Twitch emotes yet, load them
    try {
      console.log('🔄 Loading global Twitch emotes...');
      await loadGlobalEmotes(accessToken);
      console.log(`✅ Global Twitch emotes loaded: ${globalEmotes.size}`);
    } catch (error) {
      console.error('❌ Failed to load global Twitch emotes:', error.message);
    }
  }
}

function parseEmotesExtended(text, twitchEmotes = null, userId = null, messageSenderId = null, accessToken = null) {
  // DEPRECATED: This function now just returns plain text
  // Emotes are handled by collectEmoteData() and rendered on frontend
  return text || '';
}

// New function to collect emote data for frontend rendering
async function collectEmoteData(text, twitchEmotes = null, userId = null, messageSenderId = null, accessToken = null) {
  if (!text) return { text, emotes: [] };
  
  await ensureEmotesLoaded(accessToken);
  
  const emoteData = [];
  
  // Helper function to find emotes in text and add to emoteData array
  function findEmotesInText(text, emoteMap, provider) {
    for (const [emoteName, emote] of emoteMap.entries()) {
      // Use Unicode-aware word boundaries that work with foreign characters
      const patterns = [
        new RegExp(`(?<=^|\\s)${escapeRegExp(emoteName)}(?=\\s|$)`, 'gu'), // Space boundaries (Unicode aware)
        new RegExp(`\\b${escapeRegExp(emoteName)}\\b`, 'g'), // Traditional word boundaries
        new RegExp(escapeRegExp(emoteName), 'g') // Fallback: exact match
      ];
      
      let foundMatch = false;
      for (const regex of patterns) {
        let match;
        regex.lastIndex = 0; // Reset regex
        while ((match = regex.exec(text)) !== null) {
          emoteData.push({
            name: emoteName,
            url: emote.url,
            url_2x: emote.url_2x || emote.url,
            provider: provider,
            animated: emote.animated || false,
            start: match.index,
            end: match.index + emoteName.length
          });
          foundMatch = true;
        }
        if (foundMatch) break; // Don't try other patterns if we found matches
      }
    }
  }
  
  // Find all emotes
  findEmotesInText(text, globalEmotes, 'twitch');
  
  if (userId) {
    const userSession = getUserSession(userId);
    findEmotesInText(text, userSession.channelEmotes, 'twitch');
  }
  
  findEmotesInText(text, bttvEmotes, 'bttv');
  findEmotesInText(text, ffzEmotes, 'ffz');
  findEmotesInText(text, seventvEmotes, '7tv');
  
  // Load individual user emotes
  if (messageSenderId && accessToken && messageSenderId !== userId) {
    try {
      const userEmotes = await UserEmoteManager.getUserEmotes(messageSenderId, accessToken, userId);
      findEmotesInText(text, userEmotes, 'twitch-sender');
    } catch (error) {
      console.error(`Failed to load sender emotes for ${messageSenderId}:`, error.message);
    }
  }
  
  return { text, emotes: emoteData };
}

async function parseEmotesExtendedAsync(text, twitchEmotes = null, userId = null, messageSenderId = null, accessToken = null) {
  // DEPRECATED: This function now just returns plain text
  // Emotes are handled by collectEmoteData() and rendered on frontend
  return text || '';
}

function parseNativeTwitchEmotes(text, emotes) {
  if (!emotes || !text) return text;
  
  if (typeof emotes !== 'string') {
    if (emotes === null || emotes === undefined) {
      return text;
    }
    emotes = String(emotes);
  }
  
  if (emotes.length === 0) {
    return text;
  }
  
  try {
    const emoteReplacements = [];
    const emoteGroups = emotes.split('/');
    
    for (const group of emoteGroups) {
      if (!group || typeof group !== 'string') continue;
      
      const [emoteId, positions] = group.split(':');
      if (!positions) continue;
      
      const ranges = positions.split(',');
      for (const range of ranges) {
        if (!range) continue;
        
        const [start, end] = range.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          emoteReplacements.push({
            start,
            end: end + 1,
            emoteId,
            text: text.substring(start, end + 1)
          });
        }
      }
    }
    
    emoteReplacements.sort((a, b) => b.start - a.start);
    
    let result = text;
    for (const emote of emoteReplacements) {
      const before = result.substring(0, emote.start);
      const after = result.substring(emote.end);
      const emoteImg = `<img src="https://static-cdn.jtvnw.net/emoticons/v2/${emote.emoteId}/default/dark/1.0" alt="${emote.text}" class="chat-emote" title="${emote.text}">`;
      result = before + emoteImg + after;
    }
    
    return result;
  } catch (error) {
    console.error('âŒ Error parsing native Twitch emotes:', error.message);
    return text;
  }
}

function parseTextEmotes(text) {
  // This function is now disabled as Twitch classic emotes are handled by global emotes
  // Only handle text emotes that are NOT covered by Twitch
  let result = text;
  
  const nonTwitchEmotes = [
    { pattern: ':-\\)', name: ':-)', title: 'Happy', color: '#FFA500' },
    { pattern: ':\\|', name: ':|', title: 'Neutral', color: '#808080' },
    { pattern: ':/', name: ':/', title: 'Confused', color: '#FFB347' },
    { pattern: ':O', name: ':O', title: 'Surprised', color: '#87CEEB' },
    { pattern: ';P', name: ';P', title: 'Wink Tongue', color: '#FF69B4' },
    { pattern: ':3', name: ':3', title: 'Cat Happy', color: '#9370DB' },
    { pattern: '</3', name: '</3', title: 'Broken Heart', color: '#DC143C' },
    { pattern: 'xD', name: 'xD', title: 'Laughing', color: '#32CD32' },
    { pattern: 'XD', name: 'XD', title: 'Laughing', color: '#32CD32' },
    { pattern: ':\\*', name: ':*', title: 'Kiss', color: '#FF1493' },
    { pattern: '8\\)', name: '8)', title: 'Cool', color: '#4169E1' },
    { pattern: 'O_o', name: 'O_o', title: 'Confused', color: '#DAA520' },
    { pattern: '-_-', name: '-_-', title: 'Annoyed', color: '#696969' }
  ];
  
  console.log(`🔍 Parsing supplementary text emotes in: "${text}"`);
  
  let foundEmotes = [];
  for (const emote of nonTwitchEmotes) {
    const regex = new RegExp(`(^|\\s|\\b)(${emote.pattern})(\\s|\\b|$)`, 'gi');
    if (regex.test(text)) {
      foundEmotes.push(emote.name);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="${emote.color}" stroke="#fff" stroke-width="2"/><text x="50%" y="50%" font-size="8" text-anchor="middle" dominant-baseline="middle" fill="white">${emote.name}</text></svg>`;
      const replacement = `$1<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" alt="${emote.name}" class="chat-emote text-emote" title="${emote.title} (${emote.name})" loading="lazy">$3`;
      result = result.replace(new RegExp(`(^|\\s|\\b)(${emote.pattern})(\\s|\\b|$)`, 'gi'), replacement);
    }
  }
  
  if (foundEmotes.length > 0) {
    console.log(`😊 Found supplementary text emotes:`, foundEmotes);
  }
  
  return result;
}

function parseWordEmotes(text, emoteMap, provider) {
  if (!text || emoteMap.size === 0) {
    console.log(`⚠️ Skipping ${provider}: text="${text}", emotes=${emoteMap.size}`);
    return text;
  }
  
  let result = text;
  let foundEmotes = [];
  
  console.log(`🔍 Parsing ${provider} emotes in: "${text}"`);
  console.log(`📝 Available ${provider} emotes:`, Array.from(emoteMap.keys()).slice(0, 10)); // Show first 10
  
  // Special debug for TwitchConHYPE
  if (text.includes('TwitchConHYPE')) {
    console.log(`🐛 DEBUG: Looking for TwitchConHYPE in ${provider}`);
    console.log(`🐛 Has TwitchConHYPE:`, emoteMap.has('TwitchConHYPE'));
    if (emoteMap.has('TwitchConHYPE')) {
      console.log(`🐛 TwitchConHYPE data:`, emoteMap.get('TwitchConHYPE'));
    }
  }
  
  for (const [emoteName, emoteData] of emoteMap.entries()) {
    // Try both word boundary and simple matching
    const patterns = [
      new RegExp(`\\b${escapeRegExp(emoteName)}\\b`, 'g'), // Word boundary
      new RegExp(`(?:^|\\s)${escapeRegExp(emoteName)}(?=\\s|$)`, 'g'), // Space boundary
      new RegExp(escapeRegExp(emoteName), 'g') // Exact match (fallback)
    ];
    
    for (const regex of patterns) {
      if (regex.test(text)) {
        foundEmotes.push(`${emoteName} (${provider})`);
        const replacement = `<img src="${escapeHtml(emoteData.url)}" alt="${escapeHtml(emoteName)}" class="chat-emote emote-${escapeHtml(provider)}" title="${escapeHtml(emoteName)} (${escapeHtml(provider.toUpperCase())})" loading="lazy" onerror="console.log('Failed to load emote: ${escapeHtml(emoteName)}')">`;
        result = result.replace(new RegExp(`\\b${escapeRegExp(emoteName)}\\b`, 'g'), replacement);
        console.log(`✅ Replaced ${emoteName} with image in ${provider}`);
        break; // Don't try other patterns for this emote
      }
    }
  }
  
  if (foundEmotes.length > 0) {
    console.log(`🎭 Found ${provider} emotes:`, foundEmotes);
  } else {
  }
  
  return result;
}

// ===================== KORRIGIERTE LUCK BERECHNUNG - NUR BITS UND SUBS =====================
function computeLuckFromTags(tags, userId) {
  const userSession = getUserSession(userId);
  if (!userSession.luckSettings.enabled) return 1.0;

  let totalLuck = 1.0;
  let badges = tags.badges || tags['badges-raw'] || '';
  let badgeInfo = tags['badge-info'] || '';

  if (typeof badges !== 'string') {
    badges = String(badges || '');
  }
  
  if (typeof badgeInfo !== 'string') {
    badgeInfo = String(badgeInfo || '');
  }

  console.log(`ðŸŽ¯ Computing luck for user with badges: ${badges}, badge-info: ${badgeInfo}`);

  // âœ… KORRIGIERTE BIT BADGES LOGIK
  const bitsMatch = badges.match(/bits\/(\d+)/);
  if (bitsMatch) {
    const bitAmount = parseInt(bitsMatch[1]);
    console.log(`ðŸ’Ž Found bits badge with amount: ${bitAmount}`);
    
    // Finde die hÃ¶chste passende Tier (von groÃŸ zu klein)
    for (const tier of userSession.luckSettings.bits.slice().reverse()) {
      if (bitAmount >= tier.min) {
        totalLuck *= tier.mult;
        console.log(`ðŸ’Ž Applied bits multiplier: ${tier.mult}x for ${tier.min}+ bits`);
        break;
      }
    }
  }

  // âœ… KORRIGIERTE SUBSCRIBER BADGES LOGIK
  if (badges.includes('subscriber/') || badges.includes('founder/')) {
    // Suche nach subscriber Monaten in badge-info
    const subMatch = badgeInfo.match(/subscriber\/(\d+)/);
    if (subMatch) {
      const subMonths = parseInt(subMatch[1]);
      console.log(`ðŸ‘‘ Found subscriber with ${subMonths} months`);
      
      // Finde die hÃ¶chste passende Tier (von groÃŸ zu klein)
      for (const tier of userSession.luckSettings.subs.slice().reverse()) {
        if (subMonths >= tier.min) {
          totalLuck *= tier.mult;
          console.log(`ðŸ‘‘ Applied sub multiplier: ${tier.mult}x for ${tier.min}+ months`);
          break;
        }
      }
    } else {
      // Fallback fÃ¼r neue Subscriber ohne badge-info
      const defaultSubTier = userSession.luckSettings.subs.find(tier => tier.min === 1);
      if (defaultSubTier) {
        totalLuck *= defaultSubTier.mult;
        console.log(`ðŸ‘‘ Applied default sub multiplier: ${defaultSubTier.mult}x`);
      }
    }
  }

  // âœ… ENTFERNT: Keine Bonusse mehr fÃ¼r Moderator/VIP/Broadcaster
  // Nur Bits und Subscriber Badges bekommen Multiplier

  const finalLuck = Math.round(totalLuck * 100) / 100;
  console.log(`ðŸŽ² Final luck calculated: ${finalLuck}x`);

  return finalLuck;
}

// âœ… KORRIGIERTE MULTIPLIER TEXT FUNKTION
function getMultiplierText(luck) {
  // Immer mit 2 Dezimalstellen anzeigen, mindestens 1.00x
  const formattedLuck = Math.max(1.0, luck).toFixed(2);
  return `${formattedLuck}x`;
}

function normalizeText(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// KORRIGIERT:
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// HTML escape function to prevent XSS
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    unsafe = String(unsafe || '');
  }
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Function to sanitize sensitive data from logs
function sanitizeForLogging(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  
  const sensitive = ['access_token', 'refresh_token', 'client_secret', 'password', 'secret'];
  const sanitized = { ...obj };
  
  for (const key in sanitized) {
    if (sensitive.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }
  
  return sanitized;
}

// Input validation and sanitization functions
function validateKeyword(keyword) {
  if (!keyword || typeof keyword !== 'string') return '';
  
  // Remove dangerous characters and limit length
  const sanitized = String(keyword)
    .replace(/[<>'"&]/g, '') // Remove dangerous HTML chars
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim()
    .substring(0, 50);       // Limit length
    
  return sanitized.toLowerCase();
}

function validateDuration(duration) {
  const parsed = parseInt(duration, 10);
  if (isNaN(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 300); // Max 5 minutes
}

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// Rate limiting for API endpoints
const apiRateLimit = new Map();
const API_RATE_LIMIT_WINDOW = 60000; // 1 minute
const API_RATE_LIMIT_MAX = 30; // Max 30 requests per minute per user

function rateLimit(req, res, next) {
  const userId = req.session?.user?.id;
  if (!userId) return next();
  
  const now = Date.now();
  const userRequests = apiRateLimit.get(userId) || [];
  
  // Remove old requests
  const recentRequests = userRequests.filter(time => (now - time) < API_RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= API_RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  recentRequests.push(now);
  apiRateLimit.set(userId, recentRequests);
  next();
}

// ===================== USER INFO API =====================
async function getUserInfo(userId, login, accessToken) {
  try {
    const userInfo = {
      userId,
      login,
      followedAt: null,
      createdAt: null,
      isFollowing: false
    };
    
    const userResponse = await axios.get(`${TWITCH_API}/users`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { id: userId }
    });
    
    if (userResponse.data.data && userResponse.data.data.length > 0) {
      userInfo.createdAt = userResponse.data.data[0].created_at;
    }
    
    return userInfo;
  } catch (error) {
    console.error('Failed to get user info:', error.message);
    return null;
  }
}

async function getUserFollowInfo(userId, broadcasterId, accessToken) {
  try {
    const followInfo = {
      isFollowing: false,
      followedAt: null
    };
    
    // Get follow relationship using Twitch API
    const followResponse = await axios.get(`${TWITCH_API}/channels/followers`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { 
        broadcaster_id: broadcasterId,
        user_id: userId
      }
    });
    
    if (followResponse.data.data && followResponse.data.data.length > 0) {
      followInfo.isFollowing = true;
      followInfo.followedAt = followResponse.data.data[0].followed_at;
    }
    
    return followInfo;
  } catch (error) {
    console.error('Failed to get follow info:', error.message);
    return {
      isFollowing: false,
      followedAt: null
    };
  }
}

// ===================== GIVEAWAY MANAGER - BENUTZERSPEZIFISCH =====================
class GiveawayManager {
  constructor() {
    this.state = 'idle';
    this.keyword = '!join';
    this.channel = null;
    this.channelId = null;
    this.hostLogin = null;
    this.participants = new Map();
    this.blockedUsers = new Set();
    this.spamBlockedUsers = new Set();
    this.duration = 0;
    this.subsOnly = false;
    this.autoJoinHost = false; // âœ… GEÃ„NDERT: StandardmÃ¤ÃŸig AUS
    this.startTime = null;
  }

  async start({ channel, channelId, hostLogin, duration = 0, subsOnly = false, autoJoinHost = true, accessToken = null }) {
    this.state = 'collect';
    this.channel = channel;
    this.channelId = channelId;
    this.hostLogin = hostLogin;
    this.duration = duration;
    this.subsOnly = subsOnly;
    this.autoJoinHost = autoJoinHost;
    this.startTime = new Date();
    this.participants.clear();
    this.blockedUsers.clear();
    this.spamBlockedUsers.clear();

    if (autoJoinHost && hostLogin) {
      await this.addHost(accessToken);
    }
  }

  async addHost(accessToken = null) {
    if (!this.hostLogin) return;
    
    let profileImageUrl = null;
    
    // Load profile image for host if access token is available
    if (this.channelId && accessToken) {
      try {
        profileImageUrl = await loadUserProfileImage(this.channelId, accessToken);
        console.log(`✅ Host profile image loaded: ${profileImageUrl ? 'success' : 'no image found'}`);
      } catch (e) {
        console.error('❌ Failed to load host profile image:', e);
      }
    }
    
    const hostParticipant = {
      login: this.hostLogin,
      userId: this.channelId,
      displayName: this.hostLogin,
      joinedAt: new Date().toISOString(),
      luck: 1.0,
      badges: [{ 
        name: 'broadcaster', 
        version: '1', 
        url: getFallbackBadgeUrl('broadcaster', '1'), 
        title: 'Broadcaster' 
      }],
      multiplierText: '1.00x',
      profileImageUrl: profileImageUrl,
      isHost: true
    };
    this.participants.set(this.hostLogin, hostParticipant);
    return hostParticipant;
  }

  lock() { this.state = 'locked'; }
  resume() { this.state = 'collect'; }

  stop() {
    this.state = 'idle';
    this.channel = null;
    this.channelId = null;
    this.hostLogin = null;
    this.participants.clear();
    this.blockedUsers.clear();
    this.spamBlockedUsers.clear();
    this.duration = 0;
    this.subsOnly = false;
    this.autoJoinHost = false; // âœ… GEÃ„NDERT: StandardmÃ¤ÃŸig AUS
    this.startTime = null;
  }

  checkSpam(login, message, userId) {
    const userSession = getUserSession(userId);
    if (!userSession.generalSettings.antispam) return false;
    
    const SPAM_THRESHOLD = 3;
    const SPAM_WINDOW = 10000;
    const now = Date.now();
    const userSpam = userSession.spamTracker.get(login) || { count: 0, lastMessage: 0, blocked: false };
    
    if (userSpam.blocked || this.spamBlockedUsers.has(login)) return true;
    
    if (now - userSpam.lastMessage > SPAM_WINDOW) {
      userSpam.count = 0;
    }
    
    const msgNorm = normalizeText(message).toLowerCase();
    const kwNorm = normalizeText(this.keyword).toLowerCase();
    
    if (kwNorm && msgNorm.includes(kwNorm)) {
      userSpam.count++;
      userSpam.lastMessage = now;
      if (userSpam.count > SPAM_THRESHOLD) {
        userSpam.blocked = true;
        this.spamBlockedUsers.add(login);
        this.participants.delete(login);
        userSession.spamTracker.set(login, userSpam);
        return true;
      }
    }
    
    userSession.spamTracker.set(login, userSpam);
    return false;
  }

  tryAdd(tags, message, userId) {
    if (this.state !== 'collect') return false;
    if (!message) return false;

    const login = tags['username'];
    const displayName = tags['display-name'] || login;
    
    if (this.spamBlockedUsers.has(login)) return false;
    if (this.participants.has(login)) return false;
    if (this.checkSpam(login, message, userId)) return { type: 'spam_blocked', login, displayName };

    if (this.subsOnly) {
      let badges = tags.badges || tags['badges-raw'] || '';
      
      if (typeof badges !== 'string') {
        badges = String(badges || '');
      }
      
      const isSub = badges.includes('subscriber/') || badges.includes('founder/') || tags.subscriber === true || tags.mod === true || badges.includes('broadcaster/') || badges.includes('vip/');
      if (!isSub) {
        this.blockedUsers.add(login);
        return false;
      }
    }

    const msgNorm = normalizeText(message).toLowerCase();
    const kwNorm = normalizeText(this.keyword).toLowerCase();
    if (!kwNorm) return false;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(kwNorm)}($|[^\\p{L}\\p{N}_])`, 'iu');
    if (!pattern.test(msgNorm)) return false;

    const participantUserId = tags['user-id'] || null;
    const luck = computeLuckFromTags(tags, userId);
    const badges = parseBadges(tags, userId);

    const participant = {
      login,
      userId: participantUserId,
      displayName,
      joinedAt: new Date().toISOString(),
      luck,
      badges,
      multiplierText: getMultiplierText(luck),
      profileImageUrl: null
    };

    this.participants.set(login, participant);
    return participant;
  }

  // âœ… KORRIGIERTE UPDATE PARTICIPANTS LUCK FUNKTION
  updateParticipantsLuck(userId) {
    console.log(`ðŸ”„ Updating luck for ${this.participants.size} participants`);
    
    for (const [login, participant] of this.participants.entries()) {
      // Rekonstruiere Tags aus participant data
      const mockTags = {
        'username': participant.login,
        'display-name': participant.displayName,
        'user-id': participant.userId,
        'badges': participant.badges ? participant.badges.map(b => `${b.name}/${b.version}`).join(',') : '',
        'badge-info': this.getBadgeInfoFromBadges(participant.badges)
      };
      
      const newLuck = computeLuckFromTags(mockTags, userId);
      
      if (Math.abs(newLuck - participant.luck) > 0.01) { // Nur update wenn signifikante Ã„nderung
        console.log(`ðŸŽ² Updating ${login} luck from ${participant.luck} to ${newLuck}`);
        participant.luck = newLuck;
        participant.multiplierText = getMultiplierText(newLuck);
        this.participants.set(login, participant);
        
        emitToUser(userId, 'participant:update', participant);
      }
    }
  }

  // Helper um badge-info aus badges zu rekonstruieren
  getBadgeInfoFromBadges(badges) {
    if (!badges || !Array.isArray(badges)) return '';
    
    const badgeInfo = [];
    badges.forEach(badge => {
      if (badge.name === 'subscriber' && badge.version) {
        badgeInfo.push(`subscriber/${badge.version}`);
      }
    });
    
    return badgeInfo.join(',');
  }

  getStatus() {
    return {
      state: this.state,
      keyword: this.keyword,
      channel: this.channel,
      duration: this.duration,
      subsOnly: this.subsOnly,
      autoJoinHost: this.autoJoinHost,
      participantCount: this.participants.size,
      blockedCount: this.blockedUsers.size,
      spamBlockedCount: this.spamBlockedUsers.size,
      startTime: this.startTime
    };
  }

  getStats() {
    return {
      participants: this.participants.size,
      blocked: this.blockedUsers.size,
      spamBlocked: this.spamBlockedUsers.size
    };
  }

  draw() {
    const arr = Array.from(this.participants.values());
    console.log(`Draw-Methode aufgerufen: ${arr.length} Teilnehmer gefunden`);
    if (arr.length === 0) {
      console.log('Keine Teilnehmer in this.participants Map!');
      return null;
    }
    const weighted = [];
    arr.forEach(p => {
      const weight = Math.floor((p.luck || 1) * 10);
      for (let i = 0; i < weight; i++) {
        weighted.push(p);
      }
    });
    const idx = Math.floor(Math.random() * weighted.length);
    return weighted[idx];
  }
}

// ===================== TMI CLIENT - BENUTZERSPEZIFISCH =====================
async function ensureTmiClient(sessionData, userId) {
  const userSession = getUserSession(userId);
  
  if (userSession.tmiClient) return userSession.tmiClient;
  
  if (!sessionData?.twitch?.access_token || !sessionData?.user?.login) {
    throw new Error('Missing token or login');
  }

  await loadGlobalBadges(sessionData.twitch.access_token);
  
  if (sessionData.user.id) {
    await loadChannelBadges(sessionData.user.id, sessionData.twitch.access_token, userId);
    await refreshAllEmotes(sessionData.user.id, sessionData.twitch.access_token, userId);
  } else {
    // Load global emotes only if no channel ID
    await refreshAllEmotes(null, sessionData.twitch.access_token, userId);
  }

  userSession.tmiClient = new tmi.Client({
    options: { 
      debug: false,
      skipUpdatingEmotesets: false,
      skipMembership: false
    },
    connection: { 
      reconnect: true, 
      secure: true,
      maxReconnectAttempts: 3
    },
    identity: { 
      username: sessionData.user.login, 
      password: 'oauth:' + sessionData.twitch.access_token 
    },
    channels: []
  });

  if (!global.recentWebsiteMessages) {
    global.recentWebsiteMessages = new Map();
  }

  userSession.tmiClient.on('message', async (channel, tags, message, self) => {
    if (self && tags.username === sessionData?.user?.login) {
      const messageKey = `${userId}_${tags.username}_${message}`;
      const recentMessage = global.recentWebsiteMessages?.get(messageKey);
      
      if (recentMessage && (Date.now() - recentMessage.timestamp) < 3000) {
        return;
      }
    }

    // Get user ID first for admin check
    const participantUserId = tags['user-id'];
    
    // ADMIN COMMAND HANDLING - Check early before other processing
    console.log(`💬 Message from ${tags['display-name']}: "${message}"`);
    console.log(`👤 User ID: ${participantUserId}, Admin IDs: ${JSON.stringify(ADMIN_USER_IDS)}`);
    
    if (message.startsWith('!popup ') && ADMIN_USER_IDS.includes(participantUserId)) {
      console.log(`✅ ADMIN POPUP COMMAND detected from ${tags['display-name']}`);
      const args = message.split(' ');
      if (args[1] && !isNaN(args[1])) {
        const duration = parseInt(args[1]) * 1000;
        console.log(`🚀 Starting popup flood for ${duration}ms`);
        emitToUser(userId, 'admin:popup', { duration });
        console.log(`📡 Emitted admin:popup event to user ${userId}`);
      }
      return; // Don't process as regular message
    }

    // Cache user badges for website messages
    if (participantUserId) {
      const userBadgeCache = global.userBadgeCache = global.userBadgeCache || new Map();
      
      // Get raw badge data - try multiple formats
      let rawBadges = '';
      let rawBadgeInfo = '';
      
      // Try different badge format possibilities
      if (tags.badges) {
        if (typeof tags.badges === 'object' && !Array.isArray(tags.badges)) {
          // Convert object to string format
          rawBadges = Object.entries(tags.badges)
            .map(([key, value]) => `${key}/${value}`)
            .join(',');
        } else {
          rawBadges = String(tags.badges);
        }
      } else if (tags['badges-raw']) {
        rawBadges = String(tags['badges-raw']);
      }
      
      if (tags['badge-info']) {
        if (typeof tags['badge-info'] === 'object' && !Array.isArray(tags['badge-info'])) {
          rawBadgeInfo = Object.entries(tags['badge-info'])
            .map(([key, value]) => `${key}/${value}`)
            .join(',');
        } else {
          rawBadgeInfo = String(tags['badge-info']);
        }
      } else if (tags['badge-info-raw']) {
        rawBadgeInfo = String(tags['badge-info-raw']);
      }
      
      // Debug logging
      console.log(`🔍 Badge debug for ${tags.username}:`);
      console.log(`  - typeof tags.badges:`, typeof tags.badges);
      console.log(`  - tags.badges:`, tags.badges);
      console.log(`  - tags['badges-raw']:`, tags['badges-raw']);
      console.log(`  - typeof tags['badge-info']:`, typeof tags['badge-info']);
      console.log(`  - tags['badge-info']:`, tags['badge-info']);
      console.log(`  - tags['badge-info-raw']:`, tags['badge-info-raw']);
      console.log(`  - processed badges: "${rawBadges}"`);
      console.log(`  - processed badge-info: "${rawBadgeInfo}"`);
      
      userBadgeCache.set(participantUserId, {
        badges: rawBadges,
        badgeInfo: rawBadgeInfo,
        username: tags.username,
        timestamp: Date.now()
      });
      console.log(`💾 Cached badges for ${tags.username} (${participantUserId}): "${rawBadges}"`);
    }

    let profileImageUrl = null;
    
    if (participantUserId && sessionData?.twitch?.access_token) {
      try {
        profileImageUrl = await loadUserProfileImage(participantUserId, sessionData.twitch.access_token);
      } catch (e) {
        console.error('Failed to load profile image:', e);
      }
    }

    console.log(`💬 Processing message from ${tags['display-name'] || tags['username']}: "${message}"`);
    console.log(`🎭 Available emotes - Global: ${globalEmotes.size}, Channel: ${userSession.channelEmotes.size}, BTTV: ${bttvEmotes.size}, FFZ: ${ffzEmotes.size}, 7TV: ${seventvEmotes.size}`);
    
    // Collect emote data for frontend rendering
    const messageData = await collectEmoteData(
      message, 
      tags.emotes, 
      userId, 
      participantUserId,
      sessionData.twitch.access_token
    );
    
    
    const result = userSession.giveaway.tryAdd(tags, message, userId);

    if (result && result.type === 'spam_blocked') {
      emitToUser(userId, 'participant:spam_blocked', result);
      emitToUser(userId, 'stats:update', userSession.giveaway.getStats());
      return;
    }

    const badges = parseBadges(tags, userId);
    const luck = computeLuckFromTags(tags, userId);

    const chatEvent = {
      channel,
      user: tags['display-name'] || tags['username'],
      userId: tags['user-id'],
      text: messageData.text,
      message: messageData.text, // Plain text for display
      emotes: messageData.emotes, // Emote data for frontend rendering
      color: tags.color || '#a78bfa',
      badges: badges,
      luck: luck,
      multiplierText: getMultiplierText(luck),
      timestamp: new Date().toISOString(),
      isParticipant: !!result,
      profileImageUrl: profileImageUrl,
      isTwitchUser: true,
      isOwnMessage: false
    };

    emitToUser(userId, 'chat', chatEvent);

    if (result && typeof result === 'object' && result.login) {
      if (profileImageUrl) {
        result.profileImageUrl = profileImageUrl;
        userSession.giveaway.participants.set(result.login, result);
      }
      emitToUser(userId, 'participant:add', result);
      emitToUser(userId, 'stats:update', userSession.giveaway.getStats());
    }
  });

  await userSession.tmiClient.connect();
  return userSession.tmiClient;
}

// ===================== AUTH ROUTES =====================
app.get('/auth/twitch', (req, res) => {
  // Dynamische Redirect URI basierend auf Request-Host
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host');
  const redirectUri = process.env.TWITCH_REDIRECT_URI || `${protocol}://${host}/auth/twitch/callback`;
  
  console.log(`🔗 Twitch OAuth Redirect: ${redirectUri}`);
  
  // Einfacher OAuth-Flow ohne komplexe State-Validierung
  const state = crypto.randomBytes(8).toString('hex'); // Kürzerer State
  const authUrl = `${TWITCH_AUTH}?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${BASE_SCOPES.join(' ')}&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/twitch/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    // Nur grundlegende Validierung
    if (!code) {
      return res.status(400).send('OAuth error: No authorization code received.');
    }
    
    // Gleiche dynamische Redirect URI wie beim Auth-Start
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const redirectUri = process.env.TWITCH_REDIRECT_URI || `${protocol}://${host}/auth/twitch/callback`;
    
    console.log(`🔄 Twitch OAuth Callback: ${redirectUri}`);
    
    // Exchange code for tokens - Einfacher Ansatz
    const body = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    
    const { data: tokens } = await axios.post(TWITCH_TOKEN, body.toString(), { 
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } 
    });
    
    req.session.twitch = { access_token: tokens.access_token, refresh_token: tokens.refresh_token };

    // Get user information
    const { data: u } = await axios.get(`${TWITCH_API}/users`, { 
      headers: { 
        'Client-Id': process.env.TWITCH_CLIENT_ID, 
        Authorization: `Bearer ${tokens.access_token}` 
      } 
    });
    
    const me = u.data[0];
    req.session.user = { 
      id: me.id, 
      login: me.login, 
      display_name: me.display_name, 
      profile_image_url: me.profile_image_url, 
      color: '#a970ff' 
    };

    console.log('✅ Session saved:', !!req.session.user);
    console.log('✅ User ID:', me.id);
    console.log('✅ Redirecting to dashboard...');
    
    // Session speichern vor Redirect
    req.session.save((err) => {
      if (err) {
        console.error('❌ Session save error:', err);
        return res.status(500).send('Session error');
      }
      console.log('✅ Session successfully saved, redirecting...');
      res.redirect('/dashboard');
    });
  } catch (e) {
    console.error('OAuth error:', e.response?.data || e.message);
    res.status(500).send('OAuth failed. Please try again.');
  }
});

// Debug route for development (remove in production)
app.get('/debug/session', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found');
  }
  
  res.json({
    hasSession: !!req.session,
    sessionId: req.sessionID,
    oauthState: req.session?.oauthState ? 'present' : 'missing',
    user: req.session?.user ? 'present' : 'missing',
    twitch: req.session?.twitch ? 'present' : 'missing'
  });
});

app.get('/logout', (req, res) => {
  if (req.session?.user?.id) {
    cleanupUserSession(req.session.user.id);
  }
  req.session.destroy();
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  if (req.session?.user) {
    res.json({ 
      loggedIn: true, 
      ...req.session.user, 
      avatarUrl: req.session.user.profile_image_url,
      displayName: req.session.user.display_name 
    });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get('/api/user-info/:userId', async (req, res) => {
  try {
    if (!req.session?.user || !req.session?.twitch?.access_token) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    
    const userId = req.params.userId;
    const login = req.query.login;
    
    const userInfo = await getUserInfo(userId, login, req.session.twitch.access_token);
    
    if (!userInfo) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(userInfo);
  } catch (e) {
    console.error('âŒ User info API error:', e);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

app.get('/api/user-follow/:userId', async (req, res) => {
  try {
    if (!req.session?.user || !req.session?.twitch?.access_token) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    
    const userId = req.params.userId;
    const followInfo = await getUserFollowInfo(userId, req.session.user.id, req.session.twitch.access_token);
    
    res.json(followInfo);
  } catch (e) {
    console.error('❌ User follow API error:', e);
    res.status(500).json({ error: 'Failed to get follow info' });
  }
});

// ===================== GIVEAWAY API - BENUTZERSPEZIFISCH =====================
app.post('/api/giveaway/start', requireAuth, rateLimit, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userSession = getUserSession(userId);
    
    const ch = req.session.user.login.toLowerCase();
    const channelId = req.session.user.id;
    
    // Validate and sanitize inputs
    const keyword = validateKeyword(req.body?.keyword || userSession.giveaway.keyword);
    const duration = validateDuration(req.body?.duration);
    const subsOnly = Boolean(req.body?.subsOnly);
    const autoJoinHost = Boolean(req.body?.autoJoinHost);

    if (keyword) {
      userSession.giveaway.keyword = keyword;
    }

    await userSession.giveaway.start({ 
      channel: ch, 
      channelId, 
      hostLogin: ch, 
      duration, 
      subsOnly, 
      autoJoinHost, 
      accessToken: req.session?.twitch?.access_token 
    });

    const client = await ensureTmiClient(req.session, userId);
    if (!client.getChannels().includes('#' + ch)) await client.join(ch);

    emitToUser(userId, 'giveaway:status', { 
      state: userSession.giveaway.state, 
      keyword: userSession.giveaway.keyword, 
      channel: ch, 
      duration, 
      subsOnly, 
      autoJoinHost 
    });

    if (autoJoinHost) {
      const hostParticipant = userSession.giveaway.participants.get(ch);
      if (hostParticipant) {
        emitToUser(userId, 'host:auto_joined', hostParticipant);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('âŒ Giveaway start failed:', e);
    res.status(500).json({ error: 'start_failed' });
  }
});

app.post('/api/giveaway/pause', requireAuth, rateLimit, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  if (userSession.giveaway.state !== 'collect') return res.status(400).json({ error: 'not_running' });
  
  userSession.giveaway.lock();
  emitToUser(userId, 'giveaway:status', { state: userSession.giveaway.state });
  res.json({ ok: true });
});

app.post('/api/giveaway/resume', requireAuth, rateLimit, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  if (userSession.giveaway.state !== 'locked') return res.status(400).json({ error: 'not_paused' });
  
  userSession.giveaway.resume();
  emitToUser(userId, 'giveaway:status', { state: userSession.giveaway.state });
  res.json({ ok: true });
});

app.post('/api/giveaway/end', requireAuth, rateLimit, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  console.log(`Pick Winner: Giveaway state = ${userSession.giveaway.state}`);
  if (userSession.giveaway.state === 'idle') return res.status(400).json({ error: 'not_running' });
  
  userSession.giveaway.lock();
  console.log(`Vor draw(): Giveaway hat ${userSession.giveaway.participants.size} Teilnehmer`);
  console.log('Teilnehmer Liste:', Array.from(userSession.giveaway.participants.keys()));
  const winner = userSession.giveaway.draw();
  
  if (!winner) {
    userSession.giveaway.stop();
    emitToUser(userId, 'giveaway:status', { state: userSession.giveaway.state });
    return res.status(400).json({ error: 'no_participants' });
  }
  
  emitToUser(userId, 'giveaway:winner', winner);
  userSession.giveaway.stop();
  emitToUser(userId, 'participants:cleared');
  emitToUser(userId, 'giveaway:status', { state: userSession.giveaway.state });
  emitToUser(userId, 'stats:update', userSession.giveaway.getStats());
  res.json({ winner });
});

app.get('/api/giveaway/status', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  res.json({ 
    state: userSession.giveaway.state, 
    keyword: userSession.giveaway.keyword, 
    channel: userSession.giveaway.channel,
    duration: userSession.giveaway.duration,
    subsOnly: userSession.giveaway.subsOnly,
    autoJoinHost: userSession.generalSettings.autoJoinHost
  });
});

app.post('/api/giveaway/stop', requireAuth, rateLimit, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  userSession.giveaway.stop();
  emitToUser(userId, 'giveaway:status', { state: userSession.giveaway.state });
  emitToUser(userId, 'participants:cleared');
  emitToUser(userId, 'stats:update', userSession.giveaway.getStats());
  res.json({ ok: true });
});

// Clear participants only (without stopping giveaway)
app.post('/api/giveaway/participants/clear', requireAuth, rateLimit, (req, res) => {
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  // Only clear participants, keep giveaway running
  userSession.giveaway.participants.clear();
  emitToUser(userId, 'participants:cleared');
  emitToUser(userId, 'stats:update', userSession.giveaway.getStats());
  res.json({ ok: true });
});

app.delete('/api/giveaway/participants/:login', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  const login = String(req.params.login || '').toLowerCase();
  
  if (userSession.giveaway.participants.delete(login)) {
    emitToUser(userId, 'participant:remove', { login });
    emitToUser(userId, 'stats:update', userSession.giveaway.getStats());
    return res.json({ ok: true, message: `Participant ${login} removed` });
  }
  
  res.status(404).json({ error: 'not_found', message: `Participant ${login} not found` });
});

app.get('/api/giveaway/participants', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  res.json({ 
    participants: Array.from(userSession.giveaway.participants.values()),
    blocked: userSession.giveaway.blockedUsers.size,
    spamBlocked: userSession.giveaway.spamBlockedUsers.size
  });
});

// ===================== SETTINGS API - BENUTZERSPEZIFISCH =====================
app.get('/api/settings/luck', requireAuth, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  res.json(userSession.luckSettings);
});

app.put('/api/settings/luck', requireAuth, rateLimit, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  const { enabled, bits, subs } = req.body || {};
  
  console.log(`ðŸ’¾ Saving luck settings for user ${userId}:`, { enabled, bits: bits?.length, subs: subs?.length });
  
  if (typeof enabled === 'boolean') userSession.luckSettings.enabled = enabled;
  if (Array.isArray(bits)) {
    const validBits = bits.filter(b => typeof b.min === 'number' && typeof b.mult === 'number');
    userSession.luckSettings.bits = validBits.sort((a, b) => a.min - b.min);
    console.log(`ðŸ’Ž Updated bits settings:`, userSession.luckSettings.bits);
  }
  if (Array.isArray(subs)) {
    const validSubs = subs.filter(s => typeof s.min === 'number' && typeof s.mult === 'number');
    userSession.luckSettings.subs = validSubs.sort((a, b) => a.min - b.min);
    console.log(`ðŸ‘‘ Updated subs settings:`, userSession.luckSettings.subs);
  }
  
  // âœ… WICHTIG: Aktualisiere alle existing participants
  userSession.giveaway.updateParticipantsLuck(userId);
  
  emitToUser(userId, 'settings:luck_updated', userSession.luckSettings);
  res.json({ ok: true, luckSettings: userSession.luckSettings });
});

app.get('/api/settings/general', requireAuth, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  res.json(userSession.generalSettings);
});

app.put('/api/settings/general', requireAuth, rateLimit, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  const { autoJoinHost, antispam } = req.body || {};
  
  if (typeof autoJoinHost === 'boolean') userSession.generalSettings.autoJoinHost = autoJoinHost;
  if (typeof antispam === 'boolean') userSession.generalSettings.antispam = antispam;
  
  emitToUser(userId, 'settings:general_updated', userSession.generalSettings);
  res.json({ ok: true, generalSettings: userSession.generalSettings });
});

app.get('/api/settings/keyword', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  res.json({ 
    keyword: userSession.giveaway.keyword,
    duration: userSession.giveaway.duration 
  });
});

app.put('/api/settings/keyword', requireAuth, rateLimit, (req, res) => {
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  const kw = validateKeyword(req.body?.keyword || '');
  
  if (!kw || !kw.startsWith('!')) return res.status(400).json({ error: 'invalid_keyword' });
  
  userSession.giveaway.keyword = kw;
  emitToUser(userId, 'giveaway:status', { 
    state: userSession.giveaway.state, 
    keyword: userSession.giveaway.keyword, 
    channel: userSession.giveaway.channel 
  });
  res.json({ ok: true, keyword: userSession.giveaway.keyword });
});

// ===================== EMOTE API ENDPOINTS =====================
app.get('/api/emotes/all', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  try {
    const allEmotes = [];
    
    // Skip custom text emotes in autocomplete - focus on real Twitch emotes
    // Custom text emotes are handled by parseTextEmotes() during chat parsing
    
    // Global Twitch emotes
    globalEmotes.forEach((emote, name) => {
      allEmotes.push({
        name: emote.name,
        provider: 'Twitch',
        url: emote.url,
        url_2x: emote.url_2x || emote.url,
        animated: emote.animated || false,
        global: true
      });
    });
    
    // Channel-specific Twitch emotes
    if (userSession.channelEmotes) {
      userSession.channelEmotes.forEach((emote, name) => {
        allEmotes.push({
          name: emote.name,
          provider: 'Twitch',
          url: emote.url,
          url_2x: emote.url_2x || emote.url,
          animated: emote.animated || false,
          global: false
        });
      });
    }
    
    // BTTV emotes
    bttvEmotes.forEach((emote, name) => {
      allEmotes.push({
        name: emote.name,
        provider: 'BTTV',
        url: emote.url,
        url_2x: emote.url_2x || emote.url,
        animated: emote.animated || false,
        global: true
      });
    });
    
    // FFZ emotes
    ffzEmotes.forEach((emote, name) => {
      allEmotes.push({
        name: emote.name,
        provider: 'FFZ',
        url: emote.url,
        url_2x: emote.url_2x || emote.url,
        animated: emote.animated || false,
        global: true
      });
    });
    
    // 7TV emotes
    seventvEmotes.forEach((emote, name) => {
      allEmotes.push({
        name: emote.name,
        provider: '7TV',
        url: emote.url,
        url_2x: emote.url_2x || emote.url,
        animated: emote.animated || false,
        global: true
      });
    });
    
    // Remove duplicates and sort by name
    const uniqueEmotes = allEmotes.filter((emote, index, self) => 
      index === self.findIndex(e => e.name === emote.name)
    ).sort((a, b) => a.name.localeCompare(b.name));
    
    
    res.json({
      emotes: uniqueEmotes,
      count: uniqueEmotes.length,
      providers: {
        twitch: uniqueEmotes.filter(e => e.provider === 'Twitch').length,
        bttv: uniqueEmotes.filter(e => e.provider === 'BTTV').length,
        ffz: uniqueEmotes.filter(e => e.provider === 'FFZ').length,
        seventv: uniqueEmotes.filter(e => e.provider === '7TV').length
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to get emotes:', error);
    res.status(500).json({ error: 'Failed to load emotes' });
  }
});

app.get('/api/emotes/search', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const query = (req.query.q || '').toLowerCase().trim();
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  try {
    const results = [];
    
    // Search function with relevance scoring
    const searchEmotes = (emoteMap, provider) => {
      emoteMap.forEach((emote, name) => {
        const nameLower = name.toLowerCase();
        let score = 0;
        
        if (nameLower === query) score = 100;
        else if (nameLower.startsWith(query)) score = 90;
        else if (nameLower.includes(query)) score = 70;
        
        if (score > 0) {
          results.push({
            name: emote.name,
            provider: provider,
            url: emote.url,
            url_2x: emote.url_2x || emote.url,
            animated: emote.animated || false,
            score: score
          });
        }
      });
    };
    
    // Search all emote sources
    searchEmotes(globalEmotes, 'Twitch');
    searchEmotes(userSession.channelEmotes, 'Twitch');
    searchEmotes(bttvEmotes, 'BTTV');
    searchEmotes(ffzEmotes, 'FFZ');
    searchEmotes(seventvEmotes, '7TV');
    
    // Sort by relevance and limit results
    const sortedResults = results
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
    
    res.json({
      query: query,
      results: sortedResults,
      count: sortedResults.length
    });
    
  } catch (error) {
    console.error('❌ Failed to search emotes:', error);
    res.status(500).json({ error: 'Failed to search emotes' });
  }
});

// ===================== EMOTE REFRESH ENDPOINT =====================
app.post('/api/emotes/refresh', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
    
    const userId = req.session.user.id;
    const channelId = req.session.user.id;
    const accessToken = req.session.twitch.access_token;
    
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token' });
    }
    
    await refreshAllEmotes(channelId, accessToken, userId);
    
    res.json({ 
      ok: true, 
      message: 'Emotes refreshed successfully',
      counts: {
        global: globalEmotes.size,
        channel: getUserSession(userId).channelEmotes.size,
        bttv: bttvEmotes.size,
        ffz: ffzEmotes.size,
        seventv: seventvEmotes.size
      }
    });
    
  } catch (error) {
    console.error('❌ Emote refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh emotes' });
  }
});

// ===================== USER-SPECIFIC EMOTE DEBUG ENDPOINT =====================
app.get('/api/emotes/user/:userId', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
    
    const targetUserId = req.params.userId;
    const requesterUserId = req.session.user.id;
    const accessToken = req.session.twitch.access_token;
    
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token' });
    }
    
    const userEmotes = await UserEmoteManager.getUserEmotes(targetUserId, accessToken, requesterUserId);
    
    const emoteArray = Array.from(userEmotes.entries()).map(([name, data]) => ({
      name: data.name,
      url: data.url,
      url_2x: data.url_2x,
      provider: data.provider
    }));
    
    res.json({
      userId: targetUserId,
      emoteCount: emoteArray.length,
      emotes: emoteArray,
      cached: userEmoteCache.has(`${targetUserId}_${requesterUserId}`)
    });
    
  } catch (error) {
    console.error('❌ User emote debug error:', error);
    res.status(500).json({ error: 'Failed to get user emotes' });
  }
});

// ===================== CHANNEL EMOTE DEBUG ENDPOINT =====================
app.get('/api/emotes/channel/:channelId', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
    
    const channelId = req.params.channelId;
    const accessToken = req.session.twitch.access_token;
    
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token' });
    }
    
    console.log(`🔍 Fetching channel emotes for broadcaster ${channelId}...`);
    
    const response = await axios.get(`${TWITCH_API}/chat/emotes`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { broadcaster_id: channelId }
    });
    
    const emotes = response.data.data.map(emote => ({
      name: emote.name,
      id: emote.id,
      url: `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/1.0`,
      emoteType: emote.emote_type || 'unknown',
      tier: emote.tier || null,
      setId: emote.emote_set_id || null
    }));
    
    // Group by emote type for better overview
    const emotesByType = {};
    emotes.forEach(emote => {
      const type = emote.emoteType;
      if (!emotesByType[type]) emotesByType[type] = [];
      emotesByType[type].push(emote);
    });
    
    res.json({
      channelId: channelId,
      totalEmotes: emotes.length,
      emotesByType: emotesByType,
      emotes: emotes
    });
    
  } catch (error) {
    console.error('❌ Channel emote debug error:', error);
    res.status(500).json({ error: 'Failed to get channel emotes' });
  }
});

// ===================== EMOTE PARSING TEST ENDPOINT =====================
app.post('/api/emotes/test', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
    
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    
    const userId = req.session.user.id;
    const userSession = getUserSession(userId);
    
    console.log(`🧪 Testing emote parsing for: "${text}"`);
    
    const steps = [];
    let result = text;
    
    // Step 1: Text emotes
    steps.push({ step: 'Original', text: result });
    result = parseTextEmotes(result);
    steps.push({ 
      step: 'Text emotes', 
      text: result,
      info: 'Converts :) :D <3 etc. to emote images'
    });
    
    // Step 2: Global Twitch emotes
    result = parseWordEmotes(result, globalEmotes, 'twitch-global');
    steps.push({ step: 'Global Twitch', text: result });
    
    // Step 3: Channel emotes (includes broadcaster emotes)
    result = parseWordEmotes(result, userSession.channelEmotes, 'twitch-channel');
    steps.push({ 
      step: 'Channel emotes', 
      text: result, 
      count: userSession.channelEmotes.size,
      emotes: Array.from(userSession.channelEmotes.keys()).slice(0, 5) // Show first 5 for reference
    });
    
    // Step 4: User-specific emotes
    const userEmotes = await UserEmoteManager.getUserEmotes(userId, req.session.twitch.access_token, userId);
    result = parseWordEmotes(result, userEmotes, 'twitch-user');
    steps.push({ step: 'User emotes', text: result });
    
    // Step 5: BTTV
    result = parseWordEmotes(result, bttvEmotes, 'bttv');
    steps.push({ step: 'BTTV', text: result });
    
    // Step 6: FFZ
    result = parseWordEmotes(result, ffzEmotes, 'ffz');
    steps.push({ step: 'FFZ', text: result });
    
    // Step 7: 7TV
    result = parseWordEmotes(result, seventvEmotes, '7tv');
    steps.push({ step: '7TV', text: result });
    
    res.json({
      originalText: text,
      finalResult: result,
      steps: steps,
      emoteCounts: {
        global: globalEmotes.size,
        channel: userSession.channelEmotes.size,
        user: userEmotes.size,
        bttv: bttvEmotes.size,
        ffz: ffzEmotes.size,
        seventv: seventvEmotes.size
      }
    });
    
  } catch (error) {
    console.error('❌ Emote test error:', error);
    res.status(500).json({ error: 'Failed to test emote parsing' });
  }
});

// ===================== CHAT ENDPOINTS - BENUTZERSPEZIFISCH =====================
app.post('/api/chat/send', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
    
    const userId = req.session.user.id;
    const userSession = getUserSession(userId);
    const text = (req.body?.text || '').toString();
    
    if (!text.trim()) return res.status(400).json({ error: 'empty' });
    
    const currentUser = req.session.user;
    const ch = (userSession.giveaway.channel || currentUser.login).toLowerCase();
    const client = await ensureTmiClient(req.session, userId);
    
    if (!client.getChannels().includes('#' + ch)) await client.join(ch);

    // Load user badges for website messages
    // The problem is that Twitch API doesn't provide equipped badges
    // We need to store the last known badges from when the user chatted via TMI
    let userBadges = '';
    let userBadgeInfo = '';
    
    // Try to get badges from cache first, otherwise load basic ones
    const userBadgeCache = global.userBadgeCache = global.userBadgeCache || new Map();
    const cachedBadges = userBadgeCache.get(currentUser.id);
    
    console.log(`🔍 Website message badge lookup for ${currentUser.login} (ID: ${currentUser.id})`);
    
    if (cachedBadges) {
      console.log(`📋 Using cached badges for ${currentUser.login}:`);
      userBadges = cachedBadges.badges || '';
      userBadgeInfo = cachedBadges.badgeInfo || '';
      console.log(`  - badges: "${userBadges}"`);
      console.log(`  - badge-info: "${userBadgeInfo}"`);
    } else {
      console.log(`⚠️ No cached badges found for ${currentUser.login}`);
      
      // Load basic badges that we can determine
      const badges = [];
      const badgeInfo = [];
      
      // Always add broadcaster badge if this is their own channel
      if (ch === currentUser.login.toLowerCase()) {
        badges.push('broadcaster/1');
        console.log(`👑 Added broadcaster badge for ${currentUser.login}`);
      }
      
      // Try to load additional badges via API
      try {
        // Check if user is a moderator in the current channel
        if (ch !== currentUser.login.toLowerCase()) {
          try {
            const modResponse = await axios.get(`${TWITCH_API}/moderation/moderators`, {
              headers: {
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${req.session.twitch.access_token}`
              },
              params: { 
                broadcaster_id: userSession.giveaway.channelId || currentUser.id,
                user_id: currentUser.id
              }
            });
            
            if (modResponse.data.data && modResponse.data.data.length > 0) {
              badges.push('moderator/1');
              console.log(`🛡️ Added moderator badge for ${currentUser.login}`);
            }
          } catch (modError) {
            console.log(`ℹ️ Could not check moderator status: ${modError.response?.status || modError.message}`);
          }
          
          // Check if user is a VIP in the current channel
          try {
            const vipResponse = await axios.get(`${TWITCH_API}/channels/vips`, {
              headers: {
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${req.session.twitch.access_token}`
              },
              params: { 
                broadcaster_id: userSession.giveaway.channelId || currentUser.id,
                user_id: currentUser.id
              }
            });
            
            if (vipResponse.data.data && vipResponse.data.data.length > 0) {
              badges.push('vip/1');
              console.log(`⭐ Added VIP badge for ${currentUser.login}`);
            }
          } catch (vipError) {
            console.log(`ℹ️ Could not check VIP status: ${vipError.response?.status || vipError.message}`);
          }
        }
      } catch (apiError) {
        console.log(`⚠️ Could not load additional badges: ${apiError.message}`);
      }
      
      userBadges = badges.join(',');
      userBadgeInfo = badgeInfo.join(',');
      
      console.log(`✅ Set basic badges for ${currentUser.login}: "${userBadges}"`);
    }
    
    // Ensure broadcaster badge is included if needed
    if (ch === currentUser.login.toLowerCase() && !userBadges.includes('broadcaster')) {
      userBadges = userBadges ? `broadcaster/1,${userBadges}` : 'broadcaster/1';
      console.log(`👑 Added missing broadcaster badge: "${userBadges}"`);
    }
    
    console.log(`🎭 Final badges for website message: "${userBadges}" | badge-info: "${userBadgeInfo}"`);

    const simulatedTags = {
      'username': currentUser.login,
      'display-name': currentUser.display_name || currentUser.login,
      'user-id': currentUser.id,
      'color': currentUser.color || '#a970ff',
      'badges': userBadges,
      'badge-info': userBadgeInfo,
      'emotes': null
    };
    
    console.log(`🏷️ Created simulatedTags:`, simulatedTags);
    console.log(`🔧 About to parse badges with parseBadges(simulatedTags, userId)`);
    
    const messageKey = `${userId}_${currentUser.login}_${text}`;
    if (!global.recentWebsiteMessages) {
      global.recentWebsiteMessages = new Map();
    }
    global.recentWebsiteMessages.set(messageKey, {
      timestamp: Date.now(),
      text: text
    });
    
    setTimeout(() => {
      global.recentWebsiteMessages.delete(messageKey);
    }, 3000);

    const participant = userSession.giveaway.tryAdd(simulatedTags, text, userId);
    await client.say(ch, text);

    const badges = parseBadges(simulatedTags, userId);
    const luck = computeLuckFromTags(simulatedTags, userId);

    console.log(`💬 Processing website message from ${currentUser.display_name || currentUser.login}: "${text}"`);
    console.log(`🎭 Available emotes - Global: ${globalEmotes.size}, Channel: ${userSession.channelEmotes.size}, BTTV: ${bttvEmotes.size}, FFZ: ${ffzEmotes.size}, 7TV: ${seventvEmotes.size}`);
    
    // For website messages, collect emote data for frontend rendering
    const messageData = await collectEmoteData(
      text, 
      null, 
      userId,
      userId, // sender is the same as the user
      req.session.twitch.access_token
    );

    const chatEvent = {
      channel: ch,
      user: simulatedTags['display-name'],
      userId: simulatedTags['user-id'],
      text: messageData.text,
      message: messageData.text, // Plain text for display
      emotes: messageData.emotes, // Emote data for frontend rendering
      color: simulatedTags.color,
      badges: badges,
      luck: luck,
      multiplierText: getMultiplierText(luck),
      timestamp: new Date().toISOString(),
      isParticipant: !!participant,
      profileImageUrl: currentUser.profile_image_url,
      isSimulated: true,
      isTwitchUser: true,
      isWebsiteMessage: true,
      messageId: `web_${Date.now()}_${Math.random()}`
    };
    
    emitToUser(userId, 'chat', chatEvent);
    
    if (participant) {
      if (currentUser.profile_image_url) {
        participant.profileImageUrl = currentUser.profile_image_url;
        userSession.giveaway.participants.set(participant.login, participant);
      }
      emitToUser(userId, 'participant:add', participant);
      emitToUser(userId, 'stats:update', userSession.giveaway.getStats());
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('âŒ Chat send error:', e?.message);
    res.status(500).json({ error: 'send_failed' });
  }
});

app.post('/api/chat/connect', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
    
    const userId = req.session.user.id;
    const userSession = getUserSession(userId);
    const client = await ensureTmiClient(req.session, userId);
    const ch = (userSession.giveaway.channel || req.session?.user?.login || '').toLowerCase();
    
    if (ch && !client.getChannels().includes('#' + ch)) {
      await client.join(ch);
    }
    
    res.json({ ok: true, channel: ch, connected: true });
  } catch (e) {
    console.error('âŒ Chat connect failed:', e?.message);
    res.status(500).json({ error: 'connect_failed', message: e?.message });
  }
});

// ===================== STATIC ROUTES =====================
app.get('/', (req, res) => {
  if (req.session?.user) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  console.log('🔍 Dashboard access attempt');
  console.log('🔍 Session exists:', !!req.session);
  console.log('🔍 User in session:', !!req.session?.user);
  console.log('🔍 Session ID:', req.sessionID);
  
  if (!req.session?.user) {
    console.log('❌ No user in session, redirecting to login');
    return res.redirect('/');
  }
  
  console.log('✅ User authenticated:', req.session.user.display_name);
  
  // Check and update admin status automatically
  checkAdminStatus(req);
  
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ===================== ADMIN SYSTEM =====================
// Check if user is admin based on Twitch User ID
function checkAdminStatus(req) {
  const userTwitchId = req.session?.user?.id;
  const isAdmin = ADMIN_USER_IDS.includes(userTwitchId);
  
  // Set admin status in session
  if (isAdmin && !req.session.isAdmin) {
    req.session.isAdmin = true;
    console.log(`Admin Berechtigung erteilt: ${req.session.user?.display_name} (${userTwitchId})`);
  } else if (!isAdmin && req.session.isAdmin) {
    req.session.isAdmin = false;
  }
  
  return isAdmin;
}

// Admin status check route
app.get('/admin/status', (req, res) => {
  const isAdmin = checkAdminStatus(req);
  res.json({ 
    isAdmin: isAdmin,
    userId: req.session?.user?.id || null,
    username: req.session?.user?.display_name || null
  });
});

// ===================== ENHANCED SOCKET.IO EVENTS =====================
io.on('connection', (socket) => {
  
  socket.on('connect', () => {
    socket.emit('status', 'ok');
  });
  
  socket.on('reconnect', () => {
    socket.emit('status', 'ok');
  });
  
  socket.on('reconnect_attempt', () => {
    socket.emit('status', 'warn');
  });
  
  socket.on('disconnect', () => {
    const userId = socketUserMap.get(socket.id);
    if (userId) {
      const userSession = getUserSession(userId);
      userSession.socketIds.delete(socket.id);
      
      if (userSession.socketIds.size === 0) {
        setTimeout(() => {
          const session = getUserSession(userId);
          if (session.socketIds.size === 0) {
            cleanupUserSession(userId);
          }
        }, 5 * 60 * 1000);
      }
      
      socketUserMap.delete(socket.id);
    }
    socket.emit('status', 'err');
  });
  
  socket.on('connect_error', () => {
    socket.emit('status', 'err');
  });
  
  socket.on('auth', (userId) => {
    if (userId) {
      socketUserMap.set(socket.id, userId);
      const userSession = getUserSession(userId);
      userSession.socketIds.add(socket.id);
      
      sendUserSpecificData(socket, userId);
    }
  });
  
  socket.on('settings:updated', (settings) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;
    
    const userSession = getUserSession(userId);
    
    if (settings.luck) {
      userSession.luckSettings = { ...userSession.luckSettings, ...settings.luck };
      userSession.giveaway.updateParticipantsLuck(userId);
    }
    
    if (settings.general) {
      userSession.generalSettings = { ...userSession.generalSettings, ...settings.general };
    }
  });
});


// ===================== SERVER START =====================
const port = process.env.PORT || 3000;
server.listen(port, async () => {
  console.log(`ðŸ† ZinxyBot server running on http://localhost:${port}`);
  console.log('ðŸŽ¯ Ready for user-specific giveaways with FIXED luck multipliers!');
  console.log('âœ… Each user now has their own isolated session and data');
  console.log('ðŸŽ² Luck calculation: ONLY Bits and Subscriber badges get multipliers');
  console.log('âŒ NO bonuses for Moderator/VIP/Broadcaster badges');
});
