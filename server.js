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

// ===================== BADGE CACHES =====================
let globalBadges = {};
let channelBadges = {};

// ===================== TWITCH API URLs =====================
const TWITCH_AUTH = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API = 'https://api.twitch.tv/helix';

// ===================== SETTINGS - KORRIGIERT =====================
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
          title: version.title,
          description: version.description
        };
      });
    });
    globalBadges = badgeData;
    console.log('✅ Global badges loaded:', Object.keys(globalBadges));
    return badgeData;
  } catch (error) {
    console.error('❌ Failed to load global badges:', error.message);
    return {};
  }
}

async function loadChannelBadges(channelId, accessToken) {
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
          title: version.title,
          description: version.description
        };
      });
    });
    channelBadges[channelId] = badgeData;
    console.log('✅ Channel badges loaded for', channelId, ':', Object.keys(badgeData));
    return badgeData;
  } catch (error) {
    console.error('❌ Failed to load channel badges:', error.message);
    return {};
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
      console.log(`✅ Profile image loaded for ${userId}:`, profileUrl);
      return profileUrl;
    }
    console.log(`⚠️ No profile image found for user ${userId}`);
    return null;
  } catch (error) {
    console.error(`❌ Failed to load profile image for user ${userId}:`, error.message);
    return null;
  }
}

// ===================== BADGE PARSER UND HILFSFUNKTIONEN =====================
function parseBadges(tags, channelId = null) {
  const badges = [];
  let badgeString = tags.badges || tags['badges-raw'] || '';
  
  // Sicherstellen dass badgeString ein String ist
  if (typeof badgeString !== 'string') {
    console.log('⚠️ Badge string is not a string:', typeof badgeString, badgeString);
    badgeString = String(badgeString || '');
  }
  
  if (!badgeString || badgeString.length === 0) {
    console.log('⚠️ Empty badge string for user');
    return badges;
  }
  
  console.log('🏷️ Parsing badges:', badgeString);
  
  try {
    const badgePairs = badgeString.split(',');
    for (const pair of badgePairs) {
      if (!pair || typeof pair !== 'string') continue;
      
      const [name, version] = pair.split('/');
      if (name && version) {
        const cleanName = name.trim();
        const cleanVersion = version.trim();
        
        const badge = {
          name: cleanName,
          version: cleanVersion,
          url: getBadgeUrl(cleanName, cleanVersion, channelId),
          title: getBadgeTitle(cleanName, cleanVersion)
        };
        
        console.log('✅ Parsed badge:', badge);
        badges.push(badge);
      }
    }
  } catch (error) {
    console.error('❌ Error parsing badges:', error.message, 'badgeString:', badgeString);
  }
  
  console.log('🏷️ Final badges array:', badges);
  return badges;
}

function getBadgeUrl(badgeName, badgeVersion, channelId = null) {
  // Erst in Channel Badges schauen, dann in Global Badges
  if (channelId && channelBadges[channelId] && channelBadges[channelId][badgeName] && channelBadges[channelId][badgeName][badgeVersion]) {
    return channelBadges[channelId][badgeName][badgeVersion].url;
  }
  
  if (globalBadges[badgeName] && globalBadges[badgeName][badgeVersion]) {
    return globalBadges[badgeName][badgeVersion].url;
  }
  
  return null;
}

function getBadgeTitle(badgeName, badgeVersion) {
  // Global badges zuerst prüfen
  if (globalBadges[badgeName] && globalBadges[badgeName][badgeVersion]) {
    return globalBadges[badgeName][badgeVersion].title || `${badgeName} ${badgeVersion}`;
  }
  
  // Fallback titles
  const fallbackTitles = {
    'subscriber': 'Subscriber',
    'broadcaster': 'Broadcaster',
    'moderator': 'Moderator',
    'vip': 'VIP',
    'founder': 'Founder',
    'premium': 'Prime Gaming',
    'staff': 'Twitch Staff',
    'admin': 'Twitch Admin',
    'global_mod': 'Global Moderator',
    'bits': `${badgeVersion} Bits`,
    'sub-gifter': 'Sub Gifter'
  };
  
  return fallbackTitles[badgeName] || `${badgeName} ${badgeVersion}`;
}

// ===================== KORRIGIERTE LUCK BERECHNUNG =====================
function computeLuckFromTags(tags) {
  if (!luckSettings.enabled) return 1.0;

  let baseLuck = 1.0; // Base multiplier bleibt immer 1.0
  let additionalLuck = 0.0; // Zusätzliche Luck die addiert wird
  let badges = tags.badges || tags['badges-raw'] || '';
  let badgeInfo = tags['badge-info'] || '';

  // Sicherstellen dass badges ein String ist
  if (typeof badges !== 'string') {
    console.log('⚠️ Badges is not a string in computeLuckFromTags:', typeof badges, badges);
    badges = String(badges || '');
  }
  
  // Sicherstellen dass badgeInfo ein String ist
  if (typeof badgeInfo !== 'string') {
    console.log('⚠️ BadgeInfo is not a string in computeLuckFromTags:', typeof badgeInfo, badgeInfo);
    badgeInfo = String(badgeInfo || '');
  }

  console.log('🎯 Computing luck for badges:', badges, 'badgeInfo:', badgeInfo);

  // Bit Badges - additive system (Bonus wird zu Base addiert)
  if (badges.includes('bits/')) {
    const bitsMatch = badges.match(/bits\/(\d+)/);
    if (bitsMatch) {
      const bitAmount = parseInt(bitsMatch[1]);
      console.log('💎 Found bit badge:', bitAmount);
      
      // Find highest applicable bit tier and add bonus
      for (const tier of luckSettings.bits.slice().reverse()) {
        if (bitAmount >= tier.min) {
          const bitBonus = tier.mult - 1.0; // Convert multiplier to bonus (e.g., 1.4 -> 0.4)
          additionalLuck += bitBonus;
          console.log('✅ Applied bit luck bonus:', bitBonus, 'for', bitAmount, 'bits');
          break;
        }
      }
    }
  }

  // Subscription Badges - additive system (Bonus wird zu Base addiert)
  if (badges.includes('subscriber/') || badges.includes('founder/')) {
    const subMatch = badgeInfo.match(/subscriber\/(\d+)/);
    if (subMatch) {
      const subMonths = parseInt(subMatch[1]);
      console.log('👑 Found subscription:', subMonths, 'months');
      
      // Find highest applicable sub tier and add bonus
      for (const tier of luckSettings.subs.slice().reverse()) {
        if (subMonths >= tier.min) {
          const subBonus = tier.mult - 1.0; // Convert multiplier to bonus (e.g., 1.5 -> 0.5)
          additionalLuck += subBonus;
          console.log('✅ Applied sub luck bonus:', subBonus, 'for', subMonths, 'months');
          break;
        }
      }
    } else {
      // Default subscriber bonus if no specific months found
      const defaultSubBonus = 0.2; // 1.2x - 1.0 = 0.2
      additionalLuck += defaultSubBonus;
      console.log('✅ Applied default subscriber luck bonus:', defaultSubBonus);
    }
  }

  // Special badges - small additive bonus
  if (badges.includes('broadcaster/') || badges.includes('moderator/') || badges.includes('vip/')) {
    const specialBonus = 0.2; // 1.2x - 1.0 = 0.2
    additionalLuck += specialBonus;
    console.log('✅ Applied special badge luck bonus:', specialBonus);
  }

  // Final luck calculation: Base (1.0) + All additional bonuses
  const totalLuck = baseLuck + additionalLuck;

  // Round to 2 decimal places
  const finalLuck = Math.round(totalLuck * 100) / 100;

  console.log('🎯 Final luck calculated:', finalLuck, '(Base: 1.0 + Additional:', additionalLuck.toFixed(2) + ')');
  return finalLuck;
}

// KORRIGIERTE Multiplier Text Funktion - Zeigt immer X.XXx (auch bei 1.00x)
function getMultiplierText(luck) {
  // Immer den aktuellen Luck-Wert anzeigen, auch bei 1.00x
  return `${luck.toFixed(2)}x`;
}

function normalizeText(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseEmotes(text, emotes) {
  if (!emotes || !text) return text;
  
  // Sicherstellen dass emotes ein String ist
  if (typeof emotes !== 'string') {
    console.log('⚠️ Emotes is not a string:', typeof emotes, emotes);
    if (emotes === null || emotes === undefined) {
      return text; // Keine Emotes zu parsen
    }
    emotes = String(emotes);
  }
  
  if (emotes.length === 0) {
    return text;
  }
  
  console.log('😀 Parsing emotes:', emotes, 'for text:', text);
  
  try {
    const emoteParts = [];
    let lastIndex = 0;
    
    // Parse emote data: "emoteid:start-end,start-end/emoteid2:start-end"
    const emoteGroups = emotes.split('/');
    const emoteReplacements = [];
    
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
    
    // Sort by start position
    emoteReplacements.sort((a, b) => a.start - b.start);
    
    // Build final text with emote images
    let result = '';
    let currentIndex = 0;
    
    for (const emote of emoteReplacements) {
      // Add text before emote
      result += text.substring(currentIndex, emote.start);
      
      // Add emote image
      result += `<img src="https://static-cdn.jtvnw.net/emoticons/v2/${emote.emoteId}/default/dark/1.0" alt="${emote.text}" class="chat-emote" title="${emote.text}">`;
      
      currentIndex = emote.end;
    }
    
    // Add remaining text
    result += text.substring(currentIndex);
    
    console.log('✅ Parsed emotes successfully');
    return result;
    
  } catch (error) {
    console.error('❌ Error parsing emotes:', error.message, 'emotes:', emotes, 'text:', text);
    return text; // Fallback to original text
  }
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
    
    // Get user creation date
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
    
    // Get follow information (if the channel is available)
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
    
    // Host Profilbild laden wenn möglich
    let hostProfileUrl = null;
    if (sessionRef?.twitch?.access_token && this.channelId) {
      loadUserProfileImage(this.channelId, sessionRef.twitch.access_token)
        .then(url => {
          if (url) {
            const hostParticipant = this.participants.get(this.hostLogin);
            if (hostParticipant) {
              hostParticipant.profileImageUrl = url;
              this.participants.set(this.hostLogin, hostParticipant);
              // Update über Socket senden
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
      luck: 1.0, // Host gets base luck
      badges: [{ name: 'broadcaster', version: '1', url: getBadgeUrl('broadcaster', '1'), title: 'Broadcaster' }],
      multiplierText: '1.00x', // KORRIGIERT: Host zeigt "1.00x" statt "No Multiplier"
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
      
      // Sicherstellen dass badges ein String ist
      if (typeof badges !== 'string') {
        console.log('⚠️ Badges is not a string in tryAdd:', typeof badges, badges);
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
      multiplierText: getMultiplierText(luck), // KORRIGIERT: Verwendet neue Funktion
      profileImageUrl: null // Wird später gesetzt
    };

    this.participants.set(login, participant);
    
    // Profilbild asynchron laden und updaten
    if (userId && sessionRef?.twitch?.access_token) {
      loadUserProfileImage(userId, sessionRef.twitch.access_token)
        .then(profileUrl => {
          if (profileUrl) {
            participant.profileImageUrl = profileUrl;
            this.participants.set(login, participant);
            // Update über Socket senden
            io.emit('participant:update', participant);
            console.log(`✅ Profile image loaded for participant ${login}:`, profileUrl);
          }
        })
        .catch(e => console.error('Failed to load participant profile image:', e));
    }
    
    return participant;
  }

  // Funktion zum Updaten aller Participants mit neuen Luck Settings
  updateParticipantsLuck() {
    console.log('🔄 Updating all participants with new luck settings');
    
    for (const [login, participant] of this.participants.entries()) {
      // Simuliere tags für Luck-Berechnung
      const mockTags = {
        'username': participant.login,
        'display-name': participant.displayName,
        'user-id': participant.userId,
        'badges': participant.badges ? participant.badges.map(b => `${b.name}/${b.version}`).join(',') : '',
        'badge-info': '' // TODO: Könnte verbessert werden wenn badge-info gespeichert wird
      };
      
      // Neue Luck berechnen
      const newLuck = computeLuckFromTags(mockTags);
      
      if (newLuck !== participant.luck) {
        participant.luck = newLuck;
        participant.multiplierText = getMultiplierText(newLuck); // KORRIGIERT: Verwendet neue Funktion
        this.participants.set(login, participant);
        
        // Update an Client senden
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

// ===================== TMI CLIENT =====================
async function ensureTmiClient(session) {
  if (tmiClient) return tmiClient;
  if (!session?.twitch?.access_token || !session?.user?.login) throw new Error('Missing token or login');

  sessionRef = session;

  await loadGlobalBadges(session.twitch.access_token);
  if (session.user.id) {
    await loadChannelBadges(session.user.id, session.twitch.access_token);
  }

  tmiClient = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: { username: session.user.login, password: 'oauth:' + session.twitch.access_token },
    channels: []
  });

  tmiClient.on('message', async (channel, tags, message, self) => {
    if (self) return;

    console.log('📨 Twitch message received:', {
      user: tags['display-name'] || tags['username'],
      message: message,
      badges: tags.badges,
      userId: tags['user-id'],
      emotes: tags.emotes,
      emoteType: typeof tags.emotes
    });

    const userId = tags['user-id'];
    let profileImageUrl = null;
    
    // Immer versuchen Profilbild zu laden
    if (userId && sessionRef?.twitch?.access_token) {
      try {
        profileImageUrl = await loadUserProfileImage(userId, sessionRef.twitch.access_token);
        console.log(`🖼️ Profile image for ${tags['username']}:`, profileImageUrl);
      } catch (e) {
        console.error('Failed to load profile image:', e);
      }
    }

    const parsedMessage = parseEmotes(message, tags.emotes);
    const result = giveaway.tryAdd(tags, message);

    if (result && result.type === 'spam_blocked') {
      io.emit('participant:spam_blocked', result);
      io.emit('stats:update', giveaway.getStats());
      return;
    }

    const badges = parseBadges(tags, giveaway.channelId);
    const luck = computeLuckFromTags(tags);

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
      isTwitchUser: true
    };

    io.emit('chat', chatEvent);

    if (result && typeof result === 'object' && result.login) {
      // Profilbild auch für Participant setzen
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

// ===================== SETTINGS API - KORRIGIERT =====================
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
  
  // Update alle existing participants mit neuen Settings
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

// ===================== CHAT ENDPOINTS =====================
app.post('/api/chat/send', async (req,res) => {
  try {
    if(!req.session?.user) return res.status(401).json({ error: 'Not logged in' });
    const text = (req.body?.text || '').toString();
    if(!text.trim()) return res.status(400).json({ error: 'empty' });
    const ch = (giveaway.channel || req.session.user.login).toLowerCase();
    const client = await ensureTmiClient(req.session);
    if(!client.getChannels().includes('#' + ch)) await client.join(ch);

    const simulatedTags = {
      'username': req.session.user.login,
      'display-name': req.session.user.display_name || req.session.user.login,
      'user-id': req.session.user.id,
      'color': req.session.user.color || '#a970ff',
      'badges': 'broadcaster/1',
      'badge-info': ''
    };
    const participant = giveaway.tryAdd(simulatedTags, text);
    await client.say(ch, text);

    const badges = parseBadges(simulatedTags);
    const luck = computeLuckFromTags(simulatedTags);

    const chatEvent = {
      channel: ch,
      user: simulatedTags['display-name'],
      userId: simulatedTags['user-id'],
      text: text,
      message: text,
      color: simulatedTags.color,
      badges: badges,
      luck: luck,
      multiplierText: getMultiplierText(luck),
      timestamp: new Date().toISOString(),
      isParticipant: !!participant,
      isSimulated: true
    };

    io.emit('chat', chatEvent);
    if (participant) {
      io.emit('participant:add', participant);
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
  
  // Sende aktuellen Giveaway Status
  const currentStatus = giveaway.getStatus();
  socket.emit('giveaway:status', { 
    state: giveaway.state, 
    keyword: giveaway.keyword, 
    channel: giveaway.channel,
    duration: giveaway.duration,
    subsOnly: giveaway.subsOnly,
    autoJoinHost: giveaway.autoJoinHost
  });
  
  // Sende aktuelle Stats
  socket.emit('stats:update', giveaway.getStats());
  
  // Sende alle aktuellen Participants
  const participants = Array.from(giveaway.participants.values());
  if (participants.length > 0) {
    console.log(`📤 Sending ${participants.length} participants to new client`);
    participants.forEach(participant => {
      socket.emit('participant:add', participant);
    });
  }
  
  // Listen for settings updates from client
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
  console.log('🎯 Ready for giveaways!');
});
