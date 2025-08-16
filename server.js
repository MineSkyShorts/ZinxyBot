// ===================== IMPORTS =====================
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

// ===================== BADGE UND EMOTE CACHES =====================
let globalBadges = {};
let channelBadges = {};
let globalEmotes = new Map(); // Globale Twitch Emotes
let channelEmotes = new Map(); // Channel-spezifische Emotes
let bttvEmotes = new Map(); // BTTV Emotes
let ffzEmotes = new Map(); // FrankerFaceZ Emotes

// ===================== TEXT EMOTES MAPPING =====================
const textEmotes = {
  ':)': '😊', ':(': '😞', ':D': '😃', ':P': '😛', ':p': '😛',
  ':|': '😐', ':/': '😕', ':\\': '😕', ':o': '😮', ':O': '😮',
  ';)': '😉', ';P': '😜', ':3': '😊', '<3': '❤️', '</3': '💔',
  'xD': '🤣', 'XD': '🤣', ':*': '😘', '8)': '😎', 'B)': '😎',
  ':&gt;': '😊', '&lt;3': '❤️', 'o_O': '😳', 'O_o': '😳', '-_-': '😑'
};

// ===================== TWITCH API URLs =====================
const TWITCH_AUTH = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API = 'https://api.twitch.tv/helix';

// ===================== SETTINGS =====================
const BASE_SCOPES = ['chat:read','chat:edit','channel:read:subscriptions','bits:read','moderator:read:followers'];
let luckSettings = {
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
};
let generalSettings = {
  autoJoinHost: true,
  antispam: true
};
const spamTracker = new Map();
const SPAM_THRESHOLD = 3;
const SPAM_WINDOW = 10000;

// ===================== EMOTE LOADER FUNKTIONEN =====================
async function loadGlobalEmotes(accessToken) {
  try {
    console.log('🌍 Loading global Twitch emotes...');
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

async function loadChannelEmotes(channelId, accessToken) {
  try {
    console.log(`📺 Loading channel emotes for ${channelId}...`);
    const response = await axios.get(`${TWITCH_API}/chat/emotes`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      },
      params: { broadcaster_id: channelId }
    });
    
    channelEmotes.clear();
    response.data.data.forEach(emote => {
      channelEmotes.set(emote.name, {
        id: emote.id,
        name: emote.name,
        url: emote.images.url_1x,
        url_2x: emote.images.url_2x,
        url_4x: emote.images.url_4x
      });
    });
    
    console.log(`✅ Loaded ${channelEmotes.size} channel emotes for ${channelId}`);
  } catch (error) {
    console.error('❌ Failed to load channel emotes:', error.message);
  }
}

async function loadBTTVEmotes(channelId = null) {
  try {
    console.log('🐸 Loading BTTV emotes...');
    
    // Global BTTV emotes
    const globalResponse = await axios.get('https://api.betterttv.net/3/cached/emotes/global');
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
    
    // Channel-specific BTTV emotes
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
    console.log('🌟 Loading FrankerFaceZ emotes...');
    
    // Global FFZ emotes
    const globalResponse = await axios.get('https://api.frankerfacez.com/v1/set/global');
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
    
    // Channel-specific FFZ emotes
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

// ===================== BADGE LOADER FUNKTIONEN - ERWEITERT =====================
async function loadGlobalBadges(accessToken) {
  try {
    console.log('🏷️ Loading global badges...');
    const response = await axios.get(`${TWITCH_API}/chat/badges/global`, {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    // Lade zusätzliche Badge-Sets die möglicherweise fehlen
async function loadAdditionalBadgeSets(accessToken) {
  try {
    console.log('🏷️ Loading additional badge sets...');
    
    // Lade Bits Badges
    try {
      const bitsResponse = await axios.get(`${TWITCH_API}/bits/leaderboard`, {
        headers: {
          'Client-Id': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        },
        params: { count: 1, period: 'all' }
      });
      console.log('✅ Bits badge data loaded');
    } catch (e) {
      console.log('ℹ️ Could not load bits badges:', e.message);
    }
    
    // Stelle sicher dass alle Standard-Badges geladen sind
    const standardBadges = ['broadcaster', 'moderator', 'vip', 'subscriber', 'premium', 'turbo', 'partner', 'staff'];
    for (const badgeType of standardBadges) {
      if (!globalBadges[badgeType]) {
        console.log(`⚠️ Missing badge type: ${badgeType}, will use fallback`);
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to load additional badge sets:', error.message);
  }
}
    
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

async function loadChannelBadges(channelId, accessToken) {
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
    
    if (!channelBadges[channelId]) {
      channelBadges[channelId] = {};
    }
    channelBadges[channelId] = badgeData;
    
    console.log(`✅ Channel badges loaded for ${channelId}:`, Object.keys(badgeData).length, 'sets');
    return badgeData;
  } catch (error) {
    console.error('❌ Failed to load channel badges:', error.message);
    return {};
  }
}

// Lade zusätzliche Badge-Sets die möglicherweise fehlen
async function loadAdditionalBadgeSets(accessToken) {
  try {
    console.log('🏷️ Loading additional badge sets...');
    
    // Lade Bits Badges
    try {
      const bitsResponse = await axios.get(`${TWITCH_API}/bits/leaderboard`, {
        headers: {
          'Client-Id': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        },
        params: { count: 1, period: 'all' }
      });
      console.log('✅ Bits badge data loaded');
    } catch (e) {
      console.log('ℹ️ Could not load bits badges:', e.message);
    }
    
    // Stelle sicher dass alle Standard-Badges geladen sind
    const standardBadges = ['broadcaster', 'moderator', 'vip', 'subscriber', 'premium', 'turbo', 'partner', 'staff'];
    for (const badgeType of standardBadges) {
      if (!globalBadges[badgeType]) {
        console.log(`⚠️ Missing badge type: ${badgeType}, will use fallback`);
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to load additional badge sets:', error.message);
  }
}

// ===================== USER PROFILBILD LADEN =====================
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

// ===================== ERWEITERTE BADGE PARSER =====================
function parseBadges(tags, channelId = null) {
  const badges = [];
  
  // Versuche verschiedene Badge-Formate
  let badgeString = tags.badges || tags['badges-raw'] || '';
  let badgeInfoString = tags['badge-info'] || tags['badge-info-raw'] || '';
  
  // Fallback für TMI.js Format
  if (typeof tags.badges === 'object' && tags.badges !== null && !Array.isArray(tags.badges)) {
    // TMI.js gibt manchmal ein Object zurück statt String
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
  
  console.log('🏷️ Parsing badges - Input:', {
    badgeString,
    badgeInfoString,
    channelId,
    tagsType: typeof tags.badges,
    tagsValue: tags.badges
  });
  
  if (!badgeString || badgeString.length === 0) {
    console.log('⚠️ No badges found in tags');
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
        
        console.log(`🔍 Processing badge: ${cleanName}/${cleanVersion}`);
        
        const badgeData = getBadgeData(cleanName, cleanVersion, channelId);
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
          console.log('✅ Added badge:', badge.name, badge.version, badge.title);
        } else {
          // Versuche Fallback URL für unbekannte Badges
          const fallbackUrl = getFallbackBadgeUrl(cleanName, cleanVersion);
          if (fallbackUrl) {
            badge.url = fallbackUrl;
            badge.url_2x = fallbackUrl;
            badge.url_4x = fallbackUrl;
            badges.push(badge);
            console.log('✅ Added badge with fallback URL:', badge.name, badge.version);
          } else {
            console.log('⚠️ No URL found for badge:', cleanName, cleanVersion);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error parsing badges:', error.message);
  }
  
  console.log(`🏷️ Final badges array: ${badges.length} badges:`, badges.map(b => `${b.name}/${b.version}`));
  return badges;
}

// ===================== BADGE DATA HELPER =====================
function getBadgeData(badgeSet, version, channelId = null) {
  if (channelId && channelBadges[channelId] && channelBadges[channelId][badgeSet]) {
    return channelBadges[channelId][badgeSet][version] || null;
  }
  if (globalBadges[badgeSet]) {
    return globalBadges[badgeSet][version] || null;
  }
  return null;
}


function getBadgeUrl(badge, version, channelId) {
  const data = getBadgeData(badge, version, channelId);
  if (!data) return null;

  return {
    url: data.url_1x,
    url_2x: data.url_2x,
    url_4x: data.url_4x,
    title: data.title || badge
  };
}


// Neue Hilfsfunktion für Fallback Badge URLs
function getFallbackBadgeUrl(badgeName, badgeVersion) {
  // Standard Twitch Badge URL Format als Fallback
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

// Erweiterte getBadgeTitle Funktion
function getBadgeTitle(badgeName, badgeVersion, badgeInfoString = '') {
  const badgeData = getBadgeData(badgeName, badgeVersion);
  if (badgeData?.title) {
    return badgeData.title;
  }
  
  // Parse badge-info für zusätzliche Informationen
  let additionalInfo = '';
  if (badgeInfoString && badgeInfoString.includes(badgeName)) {
    const infoMatch = badgeInfoString.match(new RegExp(`${badgeName}\\/(\\d+)`));
    if (infoMatch) {
      additionalInfo = infoMatch[1];
    }
  }
  
  // Erweiterte Fallback titles
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
    'verified': 'Verified',
    'artist-badge': 'Artist',
    'moments': 'Moments',
    'clip-champ': 'Clip Champ',
    'glhf-pledge': 'GLHF Pledge',
    'glitchcon2020': 'GlitchCon 2020',
    'twitch-recap-2023': 'Twitch Recap 2023',
    'hype-train': `Hype Train Level ${badgeVersion}`,
    'predictions': 'Predictions',
    'no_audio': 'No Audio',
    'no_video': 'No Video',
    'ambassador': 'Twitch Ambassador',
    'animated': 'Animated Emotes',
    'anonymous-cheerer': 'Anonymous Cheerer'
  };
  
  return fallbackTitles[badgeName] || `${badgeName} ${badgeVersion}`;
}
// ===================== ERWEITERTE EMOTE PARSER =====================
function parseEmotesExtended(text, twitchEmotes = null) {
  if (!text) return text;
  
  let result = text;
  
  // 1. Erst Twitch-native Emotes (von TMI Client)
  if (twitchEmotes) {
    result = parseNativeTwitchEmotes(result, twitchEmotes);
  }
  
  // 2. Dann Text-Emotes (:), :( etc.)
  result = parseTextEmotes(result);
  
  // 3. Dann globale und channel Twitch emotes
  result = parseWordEmotes(result, globalEmotes, 'twitch');
  result = parseWordEmotes(result, channelEmotes, 'twitch');
  
  // 4. BTTV Emotes
  result = parseWordEmotes(result, bttvEmotes, 'bttv');
  
  // 5. FFZ Emotes
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
  
  console.log('😀 Parsing native Twitch emotes:', emotes);
  
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
    
    // Sort by start position (reverse order to avoid index shifting)
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
  
  // Parse text emotes like :), :( etc.
  for (const [textEmote, emoji] of Object.entries(textEmotes)) {
    const regex = new RegExp(`\\b${escapeRegExp(textEmote)}\\b`, 'gi');
    result = result.replace(regex, `<span class="text-emote" title="${textEmote}">${emoji}</span>`);
  }
  
  return result;
}

function parseWordEmotes(text, emoteMap, provider) {
  if (!text || emoteMap.size === 0) return text;
  
  let result = text;
  
  // Parse word-based emotes (BTTV, FFZ, Global Twitch)
  for (const [emoteName, emoteData] of emoteMap.entries()) {
    const regex = new RegExp(`\\b${escapeRegExp(emoteName)}\\b`, 'g');
    const replacement = `<img src="${emoteData.url}" alt="${emoteName}" class="chat-emote emote-${provider}" title="${emoteName} (${provider.toUpperCase()})">`;
    result = result.replace(regex, replacement);
  }
  
  return result;
}

// ===================== KORRIGIERTE LUCK BERECHNUNG =====================
function computeLuckFromTags(tags) {
  if (!luckSettings.enabled) return 1.0;

  let baseLuck = 1.0;
  let additionalLuck = 0.0;
  let badges = tags.badges || tags['badges-raw'] || '';
  let badgeInfo = tags['badge-info'] || '';

  if (typeof badges !== 'string') {
    badges = String(badges || '');
  }
  
  if (typeof badgeInfo !== 'string') {
    badgeInfo = String(badgeInfo || '');
  }

  console.log('🎯 Computing luck for badges:', badges, 'badgeInfo:', badgeInfo);

  // Bit Badges
  if (badges.includes('bits/')) {
    const bitsMatch = badges.match(/bits\/(\d+)/);
    if (bitsMatch) {
      const bitAmount = parseInt(bitsMatch[1]);
      console.log('💎 Found bit badge:', bitAmount);
      
      for (const tier of luckSettings.bits.slice().reverse()) {
        if (bitAmount >= tier.min) {
          const bitBonus = tier.mult - 1.0;
          additionalLuck += bitBonus;
          console.log('✅ Applied bit luck bonus:', bitBonus, 'for', bitAmount, 'bits');
          break;
        }
      }
    }
  }

  // Subscription Badges
  if (badges.includes('subscriber/') || badges.includes('founder/')) {
    const subMatch = badgeInfo.match(/subscriber\/(\d+)/);
    if (subMatch) {
      const subMonths = parseInt(subMatch[1]);
      console.log('👑 Found subscription:', subMonths, 'months');
      
      for (const tier of luckSettings.subs.slice().reverse()) {
        if (subMonths >= tier.min) {
          const subBonus = tier.mult - 1.0;
          additionalLuck += subBonus;
          console.log('✅ Applied sub luck bonus:', subBonus, 'for', subMonths, 'months');
          break;
        }
      }
    } else {
      const defaultSubBonus = 0.2;
      additionalLuck += defaultSubBonus;
      console.log('✅ Applied default subscriber luck bonus:', defaultSubBonus);
    }
  }

  // Special badges
  if (badges.includes('broadcaster/') || badges.includes('moderator/') || badges.includes('vip/')) {
    const specialBonus = 0.2;
    additionalLuck += specialBonus;
    console.log('✅ Applied special badge luck bonus:', specialBonus);
  }

  const totalLuck = baseLuck + additionalLuck;
  const finalLuck = Math.round(totalLuck * 100) / 100;

  console.log('🎯 Final luck calculated:', finalLuck);
  return finalLuck;
}

function getMultiplierText(luck) {
  return `${luck.toFixed(2)}x`;
}

function normalizeText(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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
    
    if (sessionRef?.user?.id) {
      try {
        const followResponse = await axios.get(`${TWITCH_API}/channels/followers`, {
          headers: {
            'Client-Id': process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${accessToken}`
          },
          params: { 
            broadcaster_id: sessionRef.user.id,
            user_id: userId
          }
        });
        
        if (followResponse.data.data && followResponse.data.data.length > 0) {
          userInfo.isFollowing = true;
          userInfo.followedAt = followResponse.data.data[0].followed_at;
        }
      } catch (e) {
        console.log('Could not fetch follow info:', e.message);
      }
    }
    
    return userInfo;
  } catch (error) {
    console.error('Failed to get user info:', error.message);
    return null;
  }
}

// ===================== GIVEAWAY MANAGER =====================
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
    this.autoJoinHost = true;
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
    spamTracker.clear();

    console.log('🚀 Giveaway started with autoJoinHost:', autoJoinHost);
    
    if (autoJoinHost && hostLogin) {
      this.addHost();
    }
  }

  addHost() {
    if (!this.hostLogin) return;
    
    console.log('👑 Adding host to giveaway:', this.hostLogin);
    
    let hostProfileUrl = null;
    if (sessionRef?.twitch?.access_token && this.channelId) {
      loadUserProfileImage(this.channelId, sessionRef.twitch.access_token)
        .then(url => {
          if (url) {
            const hostParticipant = this.participants.get(this.hostLogin);
            if (hostParticipant) {
              hostParticipant.profileImageUrl = url;
              this.participants.set(this.hostLogin, hostParticipant);
              io.emit('participant:update', hostParticipant);
            }
          }
        })
        .catch(e => console.error('Failed to load host profile image:', e));
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
  url: getBadgeUrl('broadcaster', '1', this.channelId), 
  title: 'Broadcaster' 
}],
      multiplierText: '1.00x',
      profileImageUrl: hostProfileUrl,
      isHost: true
    };
    this.participants.set(this.hostLogin, hostParticipant);
    return hostParticipant;
  }

  lock() { this.state = 'locked'; }
  
  resume() { 
    this.state = 'collect'; 
  }

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
    this.autoJoinHost = true;
    this.startTime = null;
    spamTracker.clear();
  }

  checkSpam(login, message) {
    if (!generalSettings.antispam) return false;
    const now = Date.now();
    const userSpam = spamTracker.get(login) || { count: 0, lastMessage: 0, blocked: false };
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
        spamTracker.set(login, userSpam);
        console.log(`🚫 User ${login} blocked for spamming (${userSpam.count} messages)`);
        return true;
      }
    }
    spamTracker.set(login, userSpam);
    return false;
  }

  tryAdd(tags, message) {
    if (this.state !== 'collect') return false;
    if (!message) return false;

    const login = tags['username'];
    const displayName = tags['display-name'] || login;
    if (this.spamBlockedUsers.has(login)) return false;
    if (this.participants.has(login)) return false;
    if (this.checkSpam(login, message)) return { type: 'spam_blocked', login, displayName };

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

    const userId = tags['user-id'] || null;
    const luck = computeLuckFromTags(tags);
    const badges = parseBadges(tags, this.channelId);

    const participant = {
      login,
      userId,
      displayName,
      joinedAt: new Date().toISOString(),
      luck,
      badges,
      multiplierText: getMultiplierText(luck),
      profileImageUrl: null
    };

    this.participants.set(login, participant);
    
    if (userId && sessionRef?.twitch?.access_token) {
      loadUserProfileImage(userId, sessionRef.twitch.access_token)
        .then(profileUrl => {
          if (profileUrl) {
            participant.profileImageUrl = profileUrl;
            this.participants.set(login, participant);
            io.emit('participant:update', participant);
            console.log(`✅ Profile image loaded for participant ${login}`);
          }
        })
        .catch(e => console.error('Failed to load participant profile image:', e));
    }
    
    return participant;
  }

  updateParticipantsLuck() {
    console.log('🔄 Updating all participants with new luck settings');
    
    for (const [login, participant] of this.participants.entries()) {
      const mockTags = {
        'username': participant.login,
        'display-name': participant.displayName,
        'user-id': participant.userId,
        'badges': participant.badges ? participant.badges.map(b => `${b.name}/${b.version}`).join(',') : '',
        'badge-info': ''
      };
      
      const newLuck = computeLuckFromTags(mockTags);
      
      if (newLuck !== participant.luck) {
        participant.luck = newLuck;
        participant.multiplierText = getMultiplierText(newLuck);
        this.participants.set(login, participant);
        
        io.emit('participant:update', participant);
        console.log(`✅ Updated luck for ${login}: ${participant.multiplierText}`);
      }
    }
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

const giveaway = new GiveawayManager();

// ===================== TMI CLIENT SETUP =====================
let tmiClient = null;
let botClient = null;
let sessionRef = null;

// ===================== BOT CLIENT =====================
async function ensureBotClient() {
  if (botClient) return botClient;

  const botUsername = process.env.BOT_USERNAME;
  const botToken = process.env.BOT_OAUTH_TOKEN || (process.env.BOT_ACCESS_TOKEN ? `oauth:${process.env.BOT_ACCESS_TOKEN}` : null);

  if (!botUsername || !botToken) {
    console.warn('⚠️ Bot credentials not configured.');
    return null;
  }

  botClient = new tmi.Client({
    options: { debug: true, skipUpdatingEmoteMode: true, skipMembership: true },
    connection: { reconnect: true, secure: true },
    identity: { username: botUsername, password: botToken },
    channels: []
  });

  botClient.on('connected', () => console.log(`✅ Bot client connected as: ${botUsername}`));
  botClient.on('disconnected', (reason) => { console.log(`🔌 Bot client disconnected: ${reason}`); botClient = null; });

  try {
    await botClient.connect();
    return botClient;
  } catch (error) {
    console.error('❌ Failed to initialize bot client:', error.message);
    botClient = null;
    return null;
  }
}

// ===================== KORRIGIERTE TMI CLIENT =====================
async function ensureTmiClient(session) {
  if (tmiClient) return tmiClient;
  if (!session?.twitch?.access_token || !session?.user?.login) throw new Error('Missing token or login');

  sessionRef = session;

// Lade alle Badge- und Emote-Daten
await loadGlobalBadges(session.twitch.access_token);
if (typeof loadAdditionalBadgeSets === 'function') {
  await loadAdditionalBadgeSets(session.twitch.access_token);
}
await loadGlobalEmotes(session.twitch.access_token);
await loadBTTVEmotes();
await loadFFZEmotes();
  
  if (session.user.id) {
    await loadChannelBadges(session.user.id, session.twitch.access_token);
    await loadChannelEmotes(session.user.id, session.twitch.access_token);
    await loadBTTVEmotes(session.user.id);
    await loadFFZEmotes(session.user.id);
  }

tmiClient = new tmi.Client({
  options: { 
    debug: false,
    skipUpdatingEmotesets: false,  // Wichtig für Badge-Updates
    skipMembership: false          // Wichtig für vollständige User-Infos
  },
  connection: { 
    reconnect: true, 
    secure: true,
    maxReconnectAttempts: 3
  },
  identity: { 
    username: session.user.login, 
    password: 'oauth:' + session.twitch.access_token 
  },
  channels: []
});

// Track kürzlich gesendete Website-Nachrichten
tmiClient.on('message', async (channel, tags, message, self) => {
  // Prüfe ob diese Nachricht eine Duplikat von einer Website-Nachricht ist
  if (self && tags.username === sessionRef?.user?.login) {
    const messageKey = `${tags.username}_${message}`;
    const recentMessage = global.recentWebsiteMessages?.get(messageKey);
    
    if (recentMessage && (Date.now() - recentMessage.timestamp) < 3000) {
      console.log('📨 Skipping duplicate message from website that came back via Twitch');
      return; // Skip diese Nachricht, sie wurde bereits von der Website angezeigt
    }
    
    console.log('📨 Own message from Twitch chat (not a duplicate)');
  }

  // Debug: Zeige ALLE Badge-Daten
  console.log('🔨 Twitch message received - FULL TAGS:', {
    user: tags['display-name'] || tags['username'],
    message: message,
    badges: tags.badges,
    badgesRaw: tags['badges-raw'],
    badgeInfo: tags['badge-info'],
    badgeInfoRaw: tags['badge-info-raw'],
    userId: tags['user-id'],
    emotes: tags.emotes,
    isSelf: self,
    allTags: tags  // Zeige ALLE Tags für Debug
  });

  const userId = tags['user-id'];
  let profileImageUrl = null;
  
  if (userId && sessionRef?.twitch?.access_token) {
    try {
      profileImageUrl = await loadUserProfileImage(userId, sessionRef.twitch.access_token);
    } catch (e) {
      console.error('Failed to load profile image:', e);
    }
  }

  // KORRIGIERT: Erweiterte Emote-Parsing
  const parsedMessage = parseEmotesExtended(message, tags.emotes);
  const result = giveaway.tryAdd(tags, message);

    if (result && result.type === 'spam_blocked') {
      io.emit('participant:spam_blocked', result);
      io.emit('stats:update', giveaway.getStats());
      return;
    }

   // Parse Badges mit verbessertem Channel-ID Handling
  const channelIdToUse = giveaway.channelId || sessionRef?.user?.id || null;
  const badges = parseBadges(tags, channelIdToUse);
  const luck = computeLuckFromTags(tags);

  console.log('📛 Parsed badges for message:', {
    user: tags['display-name'],
    badgeCount: badges.length,
    badges: badges.map(b => `${b.name}/${b.version}`),
    channelId: channelIdToUse
  });

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
  isOwnMessage: false  // Zeige ALLE Nachrichten an, keine Duplikate filtern
};

  io.emit('chat', chatEvent);

    if (result && typeof result === 'object' && result.login) {
      if (profileImageUrl) {
        result.profileImageUrl = profileImageUrl;
        giveaway.participants.set(result.login, result);
      }
      io.emit('participant:add', result);
      io.emit('stats:update', giveaway.getStats());
    }
  });

  await tmiClient.connect();
  console.log('🔗 TMI client connected successfully');
  return tmiClient;
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
    
    console.log(`📊 Loading user info for userId: ${userId}, login: ${login}`);
    
    const userInfo = await getUserInfo(userId, login, req.session.twitch.access_token);
    
    if (!userInfo) {
      console.log(`❌ No user info found for userId: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`✅ User info loaded successfully:`, userInfo);
    res.json(userInfo);
  } catch (e) {
    console.error('❌ User info API error:', e);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ===================== GIVEAWAY API =====================
app.post('/api/giveaway/start', async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Not logged in' });

    const ch = req.session.user.login.toLowerCase();
    const channelId = req.session.user.id;
    const keyword = req.body?.keyword || giveaway.keyword;
    const duration = parseInt(req.body?.duration || 0);
    const subsOnly = Boolean(req.body?.subsOnly);
    const autoJoinHost = Boolean(req.body?.autoJoinHost);

    console.log('🚀 Starting giveaway with autoJoinHost:', autoJoinHost);

    if (keyword) {
      giveaway.keyword = String(keyword).toLowerCase();
    }

    giveaway.start({ channel: ch, channelId, hostLogin: ch, duration, subsOnly, autoJoinHost });

    const client = await ensureTmiClient(req.session);
    if (!client.getChannels().includes('#' + ch)) await client.join(ch);

    io.emit('giveaway:status', { state: giveaway.state, keyword: giveaway.keyword, channel: ch, duration, subsOnly, autoJoinHost });

    if (autoJoinHost) {
      const hostParticipant = giveaway.participants.get(ch);
      if (hostParticipant) {
        io.emit('host:auto_joined', hostParticipant);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Giveaway start failed:', e);
    res.status(500).json({ error: 'start_failed' });
  }
});

app.post('/api/giveaway/pause', (req, res) => {
  if (giveaway.state !== 'collect') return res.status(400).json({ error: 'not_running' });
  giveaway.lock();
  io.emit('giveaway:status', { state: giveaway.state });
  res.json({ ok: true });
});

app.post('/api/giveaway/resume', (req, res) => {
  if (giveaway.state !== 'locked') return res.status(400).json({ error: 'not_paused' });
  giveaway.resume();
  io.emit('giveaway:status', { state: giveaway.state });
  res.json({ ok: true });
});

app.post('/api/giveaway/end', (req, res) => {
  if (giveaway.state === 'idle') return res.status(400).json({ error: 'not_running' });
  giveaway.lock();
  const winner = giveaway.draw();
  if (!winner) {
    giveaway.stop();
    io.emit('giveaway:status', { state: giveaway.state });
    return res.status(400).json({ error: 'no_participants' });
  }
  io.emit('giveaway:winner', winner);
  giveaway.stop();
  io.emit('participants:cleared');
  io.emit('giveaway:status', { state: giveaway.state });
  io.emit('stats:update', giveaway.getStats());
  res.json({ winner });
});

// ===================== GIVEAWAY CONTROL ENDPOINTS =====================
app.get('/api/giveaway/status', (req,res) => res.json({ 
  state: giveaway.state, 
  keyword: giveaway.keyword, 
  channel: giveaway.channel,
  duration: giveaway.duration,
  subsOnly: giveaway.subsOnly,
  autoJoinHost: giveaway.autoJoinHost
}));

app.post('/api/giveaway/stop', (req, res) => {
  giveaway.stop();
  io.emit('giveaway:status', { state: giveaway.state });
  io.emit('participants:cleared');
  io.emit('stats:update', giveaway.getStats());
  res.json({ ok:true });
});

app.delete('/api/giveaway/participants/:login', (req,res) => {
  const login = String(req.params.login||'').toLowerCase();
  console.log(`🗑️ API request to remove participant: ${login}`);
  
  if(giveaway.participants.delete(login)){
    console.log(`✅ Participant ${login} removed from giveaway`);
    io.emit('participant:remove', { login });
    io.emit('stats:update', giveaway.getStats());
    return res.json({ ok:true, message: `Participant ${login} removed` });
  }
  
  console.log(`❌ Participant ${login} not found`);
  res.status(404).json({ error:'not_found', message: `Participant ${login} not found` });
});

app.get('/api/giveaway/participants', (req, res) => {
  res.json({ 
    participants: Array.from(giveaway.participants.values()),
    blocked: giveaway.blockedUsers.size,
    spamBlocked: giveaway.spamBlockedUsers.size
  });
});

// ===================== SETTINGS API =====================
app.get('/api/settings/luck', (req,res) => res.json(luckSettings));
app.put('/api/settings/luck', (req,res) => {
  const { enabled, bits, subs } = req.body || {};
  
  console.log('💾 Updating luck settings:', req.body);
  
  if(typeof enabled === 'boolean') luckSettings.enabled = enabled;
  if(Array.isArray(bits)) {
    const validBits = bits.filter(b => typeof b.min === 'number' && typeof b.mult === 'number');
    luckSettings.bits = validBits.sort((a, b) => a.min - b.min);
  }
  if(Array.isArray(subs)) {
    const validSubs = subs.filter(s => typeof s.min === 'number' && typeof s.mult === 'number');
    luckSettings.subs = validSubs.sort((a, b) => a.min - b.min);
  }
  
  giveaway.updateParticipantsLuck();
  
  io.emit('settings:luck_updated', luckSettings);
  res.json({ ok:true, luckSettings });
});

app.get('/api/settings/general', (req,res) => res.json(generalSettings));
app.put('/api/settings/general', (req,res) => {
  const { autoJoinHost, antispam } = req.body || {};
  
  console.log('⚙️ Updating general settings:', req.body);
  
  if(typeof autoJoinHost === 'boolean') generalSettings.autoJoinHost = autoJoinHost;
  if(typeof antispam === 'boolean') generalSettings.antispam = antispam;
  
  io.emit('settings:general_updated', generalSettings);
  res.json({ ok:true, generalSettings });
});

app.get('/api/settings/keyword', (req,res) => res.json({ 
  keyword: giveaway.keyword,
  duration: giveaway.duration 
}));

app.put('/api/settings/keyword', (req,res) => {
  const kw = (req.body?.keyword || '').toString().trim();
  if(!kw || !kw.startsWith('!')) return res.status(400).json({ error: 'invalid_keyword' });
  giveaway.keyword = kw.toLowerCase();
  io.emit('giveaway:status', { 
    state: giveaway.state, 
    keyword: giveaway.keyword, 
    channel: giveaway.channel 
  });
  res.json({ ok:true, keyword: giveaway.keyword });
});

// ===================== KORRIGIERTE CHAT ENDPOINTS =====================
app.post('/api/chat/send', async (req,res) => {
  try {
    if(!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
    const text = (req.body?.text || '').toString();
    if(!text.trim()) return res.status(400).json({ error: 'empty' });
    
    const currentUser = req.session.user;
    const ch = (giveaway.channel || currentUser.login).toLowerCase();
    const client = await ensureTmiClient(req.session);
    if(!client.getChannels().includes('#' + ch)) await client.join(ch);

    // Hole die echten Badges des Users von Twitch
    let userBadges = '';
    let userBadgeInfo = '';
    
    try {
      // Hole User Channel Info für Badges
      const channelResponse = await axios.get(`${TWITCH_API}/chat/settings`, {
        headers: {
          'Client-Id': process.env.TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${req.session.twitch.access_token}`
        },
        params: {
          broadcaster_id: currentUser.id,
          moderator_id: currentUser.id
        }
      });
      
      // Setze Broadcaster Badge wenn es der Channel Owner ist
      if (ch === currentUser.login.toLowerCase()) {
        userBadges = 'broadcaster/1';
      }
    } catch (e) {
      console.log('Could not fetch user badges, using default');
      if (ch === currentUser.login.toLowerCase()) {
        userBadges = 'broadcaster/1';
      }
    }

    const simulatedTags = {
      'username': currentUser.login,
      'display-name': currentUser.display_name || currentUser.login,
      'user-id': currentUser.id,
      'color': currentUser.color || '#a970ff',
      'badges': userBadges,
      'badge-info': userBadgeInfo,
      'emotes': null
    };
    
    console.log('📤 Sending message as:', simulatedTags['display-name'], 'ID:', simulatedTags['user-id']);
    
// Track diese Nachricht um Duplikate zu verhindern
    const messageKey = `${currentUser.login}_${text}`;
    if (!global.recentWebsiteMessages) {
      global.recentWebsiteMessages = new Map();
    }
    global.recentWebsiteMessages.set(messageKey, {
      timestamp: Date.now(),
      text: text
    });
    
    // Lösche alte Nachrichten nach 3 Sekunden
    setTimeout(() => {
      global.recentWebsiteMessages.delete(messageKey);
    }, 3000);

    const participant = giveaway.tryAdd(simulatedTags, text);
    await client.say(ch, text);

    const badges = parseBadges(simulatedTags, giveaway.channelId);
    const luck = computeLuckFromTags(simulatedTags);

    // KORRIGIERT: Erweiterte Emote-Parsing auch für Website-Nachrichten
    const parsedMessage = parseEmotesExtended(text, null);

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
      isTwitchUser: true
    };

// Markiere diese Nachricht als von der Website gesendet
    chatEvent.isWebsiteMessage = true;
    chatEvent.messageId = `web_${Date.now()}_${Math.random()}`;
    
    io.emit('chat', chatEvent);
    if (participant) {
      if (currentUser.profile_image_url) {
        participant.profileImageUrl = currentUser.profile_image_url;
        giveaway.participants.set(participant.login, participant);
      }
      io.emit('participant:add', participant);
      io.emit('stats:update', giveaway.getStats());
    }

    res.json({ ok:true });
  } catch(e) {
    console.error('❌ Chat send error:', e?.message);
    res.status(500).json({ error:'send_failed' });
  }
});

app.post('/api/chat/connect', async (req,res) => {
  try {
    const client = await ensureTmiClient(req.session);
    const ch = (giveaway.channel || req.session?.user?.login || '').toLowerCase();
    if(ch && !client.getChannels().includes('#' + ch)) {
      await client.join(ch);
    }
    res.json({ ok:true, channel: ch, connected: true });
  } catch(e) {
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

// ===================== SOCKET.IO EVENTS =====================
io.on('connection', (socket) => {
  console.log('🔌 Client connected');
  
  const currentStatus = giveaway.getStatus();
  socket.emit('giveaway:status', { 
    state: giveaway.state, 
    keyword: giveaway.keyword, 
    channel: giveaway.channel,
    duration: giveaway.duration,
    subsOnly: giveaway.subsOnly,
    autoJoinHost: giveaway.autoJoinHost
  });
  
  socket.emit('stats:update', giveaway.getStats());
  
  const participants = Array.from(giveaway.participants.values());
  if (participants.length > 0) {
    console.log(`📤 Sending ${participants.length} participants to new client`);
    participants.forEach(participant => {
      socket.emit('participant:add', participant);
    });
  }
  
  socket.on('settings:updated', (settings) => {
    console.log('🔥 Received settings update from client:', settings);
    
    if (settings.luck) {
      luckSettings = { ...luckSettings, ...settings.luck };
      giveaway.updateParticipantsLuck();
    }
    
    if (settings.general) {
      generalSettings = { ...generalSettings, ...settings.general };
    }
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected');
  });
});

// ===================== SERVER START =====================
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🎬 ZinxyBot server running on http://localhost:${port}`);
  console.log('🎯 Ready for giveaways with enhanced emotes and badges!');
});
