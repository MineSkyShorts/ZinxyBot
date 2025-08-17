// ===================== KORRIGIERTER SERVER.JS - VOLLSTÄNDIG UND OHNE MOD/VIP BONUS =====================
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ===================== BENUTZERSPEZIFISCHE DATENSTRUKTUREN =====================
const userSessions = new Map();
const userBadges = new Map();
const userEmotes = new Map();

let globalBadges = {};
let globalEmotes = new Map();
let bttvEmotes = new Map();
let ffzEmotes = new Map();

// ===================== TEXT EMOTES MAPPING ===================== 
const textEmotes = {
  ':)': '😊', ':(': '😞', ':D': '😃', ':P': '😛', ':p': '😛',
  ':|': '😐', ':/': '😕', ':\\': '😕', ':o': '😮', ':O': '😮',
  ';)': '😉', ';P': '😜', ':3': '😊', '<3': '❤️', '</3': '💔',
  'xD': '🤣', 'XD': '🤣', ':*': '😘', '8)': '😎', 'B)': '😎',
  ':>': '😊', '<3': '❤️', 'o_O': '😳', 'O_o': '😳', '-_-': '😑'
};

// ===================== TWITCH API URLs =====================
const TWITCH_AUTH = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API = 'https://api.twitch.tv/helix';

// ===================== BASE SCOPES =====================
const BASE_SCOPES = ['chat:read','chat:edit','channel:read:subscriptions','bits:read','moderator:read:followers'];

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
        autoJoinHost: false, // ✅ GEÄNDERT: Auto-join standardmäßig AUS
        antispam: true
      },
      spamTracker: new Map(),
      tmiClient: null,
      channelBadges: {},
      channelEmotes: new Map(),
      socketIds: new Set()
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
    console.log(`🧹 Cleaned up session for user ${userId}`);
  }
}

// ===================== SOCKET MANAGEMENT =====================
const socketUserMap = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  socket.on('auth', (userId) => {
    if (userId) {
      socketUserMap.set(socket.id, userId);
      const userSession = getUserSession(userId);
      userSession.socketIds.add(socket.id);
      
      sendUserSpecificData(socket, userId);
      console.log(`✅ Socket ${socket.id} authenticated for user ${userId}`);
    }
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
      console.log(`🔌 Socket ${socket.id} disconnected for user ${userId}`);
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
    console.log('🔍 Loading global Twitch emotes...');
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
        url: emote.images.url_1x,
        url_2x: emote.images.url_2x,
        url_4x: emote.images.url_4x
      });
    });
    
    console.log(`✅ Loaded ${globalEmotes.size} global Twitch emotes`);
  } catch (error) {
    console.error('❌ Failed to load global emotes:', error.message);
  }
}

async function loadChannelEmotes(channelId, accessToken, userId) {
  try {
    console.log(`📺 Loading channel emotes for ${channelId}...`);
    const response = await axios.get(`${TWITCH_API}/chat/emotes`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { broadcaster_id: channelId }
    });
    
    const userSession = getUserSession(userId);
    userSession.channelEmotes.clear();
    response.data.data.forEach(emote => {
      userSession.channelEmotes.set(emote.name, {
        id: emote.id,
        name: emote.name,
        url: emote.images.url_1x,
        url_2x: emote.images.url_2x,
        url_4x: emote.images.url_4x
      });
    });
    
    console.log(`✅ Loaded ${userSession.channelEmotes.size} channel emotes for ${channelId}`);
  } catch (error) {
    console.error('❌ Failed to load channel emotes:', error.message);
  }
}

async function loadBTTVEmotes(channelId = null) {
  try {
    console.log('🎭 Loading BTTV emotes...');
    
    const globalResponse = await axios.get('https://api.betterttv.net/3/cached/emotes/global');
    bttvEmotes.clear();
    globalResponse.data.forEach(emote => {
      bttvEmotes.set(emote.code, {
        id: emote.id,
        name: emote.code,
        url: `https://cdn.betterttv.net/emote/${emote.id}/1x`,
        url_2x: `https://cdn.betterttv.net/emote/${emote.id}/2x`,
        url_4x: `https://cdn.betterttv.net/emote/${emote.id}/3x`,
        provider: 'bttv'
      });
    });
    
    if (channelId) {
      try {
        const channelResponse = await axios.get(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`);
        channelResponse.data.channelEmotes?.forEach(emote => {
          bttvEmotes.set(emote.code, {
            id: emote.id,
            name: emote.code,
            url: `https://cdn.betterttv.net/emote/${emote.id}/1x`,
            url_2x: `https://cdn.betterttv.net/emote/${emote.id}/2x`,
            url_4x: `https://cdn.betterttv.net/emote/${emote.id}/3x`,
            provider: 'bttv'
          });
        });
        
        channelResponse.data.sharedEmotes?.forEach(emote => {
          bttvEmotes.set(emote.code, {
            id: emote.id,
            name: emote.code,
            url: `https://cdn.betterttv.net/emote/${emote.id}/1x`,
            url_2x: `https://cdn.betterttv.net/emote/${emote.id}/2x`,
            url_4x: `https://cdn.betterttv.net/emote/${emote.id}/3x`,
            provider: 'bttv'
          });
        });
      } catch (e) {
        console.log('No BTTV channel emotes found for', channelId);
      }
    }
    
    console.log(`✅ Loaded ${bttvEmotes.size} BTTV emotes`);
  } catch (error) {
    console.error('❌ Failed to load BTTV emotes:', error.message);
  }
}

async function loadFFZEmotes(channelId = null) {
  try {
    console.log('🐸 Loading FrankerFaceZ emotes...');
    
    const globalResponse = await axios.get('https://api.frankerfacez.com/v1/set/global');
    ffzEmotes.clear();
    Object.values(globalResponse.data.sets).forEach(set => {
      set.emoticons?.forEach(emote => {
        const urls = emote.urls;
        ffzEmotes.set(emote.name, {
          id: emote.id,
          name: emote.name,
          url: `https:${urls['1'] || urls['2'] || urls['4']}`,
          url_2x: `https:${urls['2'] || urls['1'] || urls['4']}`,
          url_4x: `https:${urls['4'] || urls['2'] || urls['1']}`,
          provider: 'ffz'
        });
      });
    });
    
    if (channelId) {
      try {
        const channelResponse = await axios.get(`https://api.frankerfacez.com/v1/room/id/${channelId}`);
        Object.values(channelResponse.data.sets).forEach(set => {
          set.emoticons?.forEach(emote => {
            const urls = emote.urls;
            ffzEmotes.set(emote.name, {
              id: emote.id,
              name: emote.name,
              url: `https:${urls['1'] || urls['2'] || urls['4']}`,
              url_2x: `https:${urls['2'] || urls['1'] || urls['4']}`,
              url_4x: `https:${urls['4'] || urls['2'] || urls['1']}`,
              provider: 'ffz'
            });
          });
        });
      } catch (e) {
        console.log('No FFZ channel emotes found for', channelId);
      }
    }
    
    console.log(`✅ Loaded ${ffzEmotes.size} FFZ emotes`);
  } catch (error) {
    console.error('❌ Failed to load FFZ emotes:', error.message);
  }
}

// ===================== BADGE LOADER FUNKTIONEN =====================
async function loadGlobalBadges(accessToken) {
  try {
    console.log('🏆 Loading global badges...');
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
    console.log('✅ Global badges loaded:', Object.keys(globalBadges).length, 'sets');
    return badgeData;
  } catch (error) {
    console.error('❌ Failed to load global badges:', error.message);
    return {};
  }
}

async function loadChannelBadges(channelId, accessToken, userId) {
  try {
    console.log(`📺 Loading channel badges for ${channelId}...`);
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
    
    console.log(`✅ Channel badges loaded for ${channelId}:`, Object.keys(badgeData).length, 'sets');
    return badgeData;
  } catch (error) {
    console.error('❌ Failed to load channel badges:', error.message);
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
      console.log(`✅ Profile image loaded for ${userId}`);
      return profileUrl;
    }
    console.log(`⚠️ No profile image found for user ${userId}`);
    return null;
  } catch (error) {
    console.error(`❌ Failed to load profile image for user ${userId}:`, error.message);
    return null;
  }
}

// ===================== KORRIGIERTE BADGE PARSER =====================
function parseBadges(tags, userId = null) {
  const badges = [];
  
  let badgeString = tags.badges || tags['badges-raw'] || '';
  let badgeInfoString = tags['badge-info'] || tags['badge-info-raw'] || '';
  
  if (typeof tags.badges === 'object' && tags.badges !== null && !Array.isArray(tags.badges)) {
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
  
  if (!badgeString || badgeString.length === 0) {
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
    console.error('❌ Error parsing badges:', error.message);
  }
  
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
function parseEmotesExtended(text, twitchEmotes = null, userId = null) {
  if (!text) return text;
  
  let result = text;
  
  if (twitchEmotes) {
    result = parseNativeTwitchEmotes(result, twitchEmotes);
  }
  
  result = parseTextEmotes(result);
  result = parseWordEmotes(result, globalEmotes, 'twitch');
  
  if (userId) {
    const userSession = getUserSession(userId);
    result = parseWordEmotes(result, userSession.channelEmotes, 'twitch');
  }
  
  result = parseWordEmotes(result, bttvEmotes, 'bttv');
  result = parseWordEmotes(result, ffzEmotes, 'ffz');
  
  return result;
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
    console.error('❌ Error parsing native Twitch emotes:', error.message);
    return text;
  }
}

function parseTextEmotes(text) {
  let result = text;
  
  for (const [textEmote, emoji] of Object.entries(textEmotes)) {
    const regex = new RegExp(`\\b${escapeRegExp(textEmote)}\\b`, 'gi');
    result = result.replace(regex, `<span class="text-emote" title="${textEmote}">${emoji}</span>`);
  }
  
  return result;
}

function parseWordEmotes(text, emoteMap, provider) {
  if (!text || emoteMap.size === 0) return text;
  
  let result = text;
  
  for (const [emoteName, emoteData] of emoteMap.entries()) {
    const regex = new RegExp(`\\b${escapeRegExp(emoteName)}\\b`, 'g');
    const replacement = `<img src="${emoteData.url}" alt="${emoteName}" class="chat-emote emote-${provider}" title="${emoteName} (${provider.toUpperCase()})">`;
    result = result.replace(regex, replacement);
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

  console.log(`🎯 Computing luck for user with badges: ${badges}, badge-info: ${badgeInfo}`);

  // ✅ KORRIGIERTE BIT BADGES LOGIK
  const bitsMatch = badges.match(/bits\/(\d+)/);
  if (bitsMatch) {
    const bitAmount = parseInt(bitsMatch[1]);
    console.log(`💎 Found bits badge with amount: ${bitAmount}`);
    
    // Finde die höchste passende Tier (von groß zu klein)
    for (const tier of userSession.luckSettings.bits.slice().reverse()) {
      if (bitAmount >= tier.min) {
        totalLuck *= tier.mult;
        console.log(`💎 Applied bits multiplier: ${tier.mult}x for ${tier.min}+ bits`);
        break;
      }
    }
  }

  // ✅ KORRIGIERTE SUBSCRIBER BADGES LOGIK
  if (badges.includes('subscriber/') || badges.includes('founder/')) {
    // Suche nach subscriber Monaten in badge-info
    const subMatch = badgeInfo.match(/subscriber\/(\d+)/);
    if (subMatch) {
      const subMonths = parseInt(subMatch[1]);
      console.log(`👑 Found subscriber with ${subMonths} months`);
      
      // Finde die höchste passende Tier (von groß zu klein)
      for (const tier of userSession.luckSettings.subs.slice().reverse()) {
        if (subMonths >= tier.min) {
          totalLuck *= tier.mult;
          console.log(`👑 Applied sub multiplier: ${tier.mult}x for ${tier.min}+ months`);
          break;
        }
      }
    } else {
      // Fallback für neue Subscriber ohne badge-info
      const defaultSubTier = userSession.luckSettings.subs.find(tier => tier.min === 1);
      if (defaultSubTier) {
        totalLuck *= defaultSubTier.mult;
        console.log(`👑 Applied default sub multiplier: ${defaultSubTier.mult}x`);
      }
    }
  }

  // ✅ ENTFERNT: Keine Bonusse mehr für Moderator/VIP/Broadcaster
  // Nur Bits und Subscriber Badges bekommen Multiplier

  const finalLuck = Math.round(totalLuck * 100) / 100;
  console.log(`🎲 Final luck calculated: ${finalLuck}x`);

  return finalLuck;
}

// ✅ KORRIGIERTE MULTIPLIER TEXT FUNKTION
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
    this.autoJoinHost = false; // ✅ GEÄNDERT: Standardmäßig AUS
    this.startTime = null;
  }

  start({ channel, channelId, hostLogin, duration = 0, subsOnly = false, autoJoinHost = true }) {
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
      this.addHost();
    }
  }

  addHost() {
    if (!this.hostLogin) return;
    
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
      profileImageUrl: null,
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
    this.autoJoinHost = false; // ✅ GEÄNDERT: Standardmäßig AUS
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

  // ✅ KORRIGIERTE UPDATE PARTICIPANTS LUCK FUNKTION
  updateParticipantsLuck(userId) {
    console.log(`🔄 Updating luck for ${this.participants.size} participants`);
    
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
      
      if (Math.abs(newLuck - participant.luck) > 0.01) { // Nur update wenn signifikante Änderung
        console.log(`🎲 Updating ${login} luck from ${participant.luck} to ${newLuck}`);
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
    if (arr.length === 0) return null;
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
  await loadGlobalEmotes(sessionData.twitch.access_token);
  await loadBTTVEmotes();
  await loadFFZEmotes();
  
  if (sessionData.user.id) {
    await loadChannelBadges(sessionData.user.id, sessionData.twitch.access_token, userId);
    await loadChannelEmotes(sessionData.user.id, sessionData.twitch.access_token, userId);
    await loadBTTVEmotes(sessionData.user.id);
    await loadFFZEmotes(sessionData.user.id);
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

    const participantUserId = tags['user-id'];
    let profileImageUrl = null;
    
    if (participantUserId && sessionData?.twitch?.access_token) {
      try {
        profileImageUrl = await loadUserProfileImage(participantUserId, sessionData.twitch.access_token);
      } catch (e) {
        console.error('Failed to load profile image:', e);
      }
    }

    const parsedMessage = parseEmotesExtended(message, tags.emotes, userId);
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
      text: message,
      message: parsedMessage,
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
  console.log(`✅ TMI client connected for user ${userId}`);
  return userSession.tmiClient;
}

// ===================== AUTH ROUTES =====================
app.get('/auth/twitch', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(`${TWITCH_AUTH}?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${process.env.TWITCH_REDIRECT_URI}&response_type=code&scope=${BASE_SCOPES.join(' ')}&state=${state}`);
});

app.get('/auth/twitch/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || state !== req.session.oauthState) return res.status(400).send('OAuth error (state).');
  try {
    const body = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TWITCH_REDIRECT_URI
    });
    const { data: tokens } = await axios.post(TWITCH_TOKEN, body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    req.session.twitch = { access_token: tokens.access_token, refresh_token: tokens.refresh_token };

    const { data: u } = await axios.get(`${TWITCH_API}/users`, { headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${tokens.access_token}` } });
    const me = u.data[0];
    req.session.user = { id: me.id, login: me.login, display_name: me.display_name, profile_image_url: me.profile_image_url, color: '#a970ff' };

    res.redirect(process.env.DEFAULT_REDIRECT_AFTER_LOGIN || '/dashboard');
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).send('OAuth error.');
  }
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
    console.error('❌ User info API error:', e);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ===================== GIVEAWAY API - BENUTZERSPEZIFISCH =====================
app.post('/api/giveaway/start', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });

    const userId = req.session.user.id;
    const userSession = getUserSession(userId);
    
    const ch = req.session.user.login.toLowerCase();
    const channelId = req.session.user.id;
    const keyword = req.body?.keyword || userSession.giveaway.keyword;
    const duration = parseInt(req.body?.duration || 0);
    const subsOnly = Boolean(req.body?.subsOnly);
    const autoJoinHost = Boolean(req.body?.autoJoinHost);

    if (keyword) {
      userSession.giveaway.keyword = String(keyword).toLowerCase();
    }

    userSession.giveaway.start({ channel: ch, channelId, hostLogin: ch, duration, subsOnly, autoJoinHost });

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
    console.error('❌ Giveaway start failed:', e);
    res.status(500).json({ error: 'start_failed' });
  }
});

app.post('/api/giveaway/pause', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  if (userSession.giveaway.state !== 'collect') return res.status(400).json({ error: 'not_running' });
  
  userSession.giveaway.lock();
  emitToUser(userId, 'giveaway:status', { state: userSession.giveaway.state });
  res.json({ ok: true });
});

app.post('/api/giveaway/resume', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  if (userSession.giveaway.state !== 'locked') return res.status(400).json({ error: 'not_paused' });
  
  userSession.giveaway.resume();
  emitToUser(userId, 'giveaway:status', { state: userSession.giveaway.state });
  res.json({ ok: true });
});

app.post('/api/giveaway/end', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  if (userSession.giveaway.state === 'idle') return res.status(400).json({ error: 'not_running' });
  
  userSession.giveaway.lock();
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

app.post('/api/giveaway/stop', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  userSession.giveaway.stop();
  emitToUser(userId, 'giveaway:status', { state: userSession.giveaway.state });
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
app.get('/api/settings/luck', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  res.json(userSession.luckSettings);
});

app.put('/api/settings/luck', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  const { enabled, bits, subs } = req.body || {};
  
  console.log(`💾 Saving luck settings for user ${userId}:`, { enabled, bits: bits?.length, subs: subs?.length });
  
  if (typeof enabled === 'boolean') userSession.luckSettings.enabled = enabled;
  if (Array.isArray(bits)) {
    const validBits = bits.filter(b => typeof b.min === 'number' && typeof b.mult === 'number');
    userSession.luckSettings.bits = validBits.sort((a, b) => a.min - b.min);
    console.log(`💎 Updated bits settings:`, userSession.luckSettings.bits);
  }
  if (Array.isArray(subs)) {
    const validSubs = subs.filter(s => typeof s.min === 'number' && typeof s.mult === 'number');
    userSession.luckSettings.subs = validSubs.sort((a, b) => a.min - b.min);
    console.log(`👑 Updated subs settings:`, userSession.luckSettings.subs);
  }
  
  // ✅ WICHTIG: Aktualisiere alle existing participants
  userSession.giveaway.updateParticipantsLuck(userId);
  
  emitToUser(userId, 'settings:luck_updated', userSession.luckSettings);
  res.json({ ok: true, luckSettings: userSession.luckSettings });
});

app.get('/api/settings/general', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  
  res.json(userSession.generalSettings);
});

app.put('/api/settings/general', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
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

app.put('/api/settings/keyword', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
  
  const userId = req.session.user.id;
  const userSession = getUserSession(userId);
  const kw = (req.body?.keyword || '').toString().trim();
  
  if (!kw || !kw.startsWith('!')) return res.status(400).json({ error: 'invalid_keyword' });
  
  userSession.giveaway.keyword = kw.toLowerCase();
  emitToUser(userId, 'giveaway:status', { 
    state: userSession.giveaway.state, 
    keyword: userSession.giveaway.keyword, 
    channel: userSession.giveaway.channel 
  });
  res.json({ ok: true, keyword: userSession.giveaway.keyword });
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

    const simulatedTags = {
      'username': currentUser.login,
      'display-name': currentUser.display_name || currentUser.login,
      'user-id': currentUser.id,
      'color': currentUser.color || '#a970ff',
      'badges': ch === currentUser.login.toLowerCase() ? 'broadcaster/1' : '',
      'badge-info': '',
      'emotes': null
    };
    
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

    const parsedMessage = parseEmotesExtended(text, null, userId);

    const chatEvent = {
      channel: ch,
      user: simulatedTags['display-name'],
      userId: simulatedTags['user-id'],
      text: text,
      message: parsedMessage,
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
    console.error('❌ Chat send error:', e?.message);
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
    console.error('❌ Chat connect failed:', e?.message);
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
  if (!req.session?.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ===================== ENHANCED SOCKET.IO EVENTS =====================
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
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
      console.log(`🔌 Socket ${socket.id} disconnected for user ${userId}`);
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
      console.log(`✅ Socket ${socket.id} authenticated for user ${userId}`);
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
server.listen(port, () => {
  console.log(`🏆 ZinxyBot server running on http://localhost:${port}`);
  console.log('🎯 Ready for user-specific giveaways with FIXED luck multipliers!');
  console.log('✅ Each user now has their own isolated session and data');
  console.log('🎲 Luck calculation: ONLY Bits and Subscriber badges get multipliers');
  console.log('❌ NO bonuses for Moderator/VIP/Broadcaster badges');
});
