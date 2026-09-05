const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { WebSocket, WebSocketServer } = require('ws');
const { differenceInMilliseconds } = require('date-fns');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.warn('Unable to load .env:', error.message);
  }
}

function getEnv(key, defaultValue = '') {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

function getEnvInt(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function getEnvFloat(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function getEnvPath(key, defaultRelativePath) {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    return path.isAbsolute(defaultRelativePath)
      ? defaultRelativePath
      : path.join(__dirname, defaultRelativePath);
  }
  return path.isAbsolute(value.trim())
    ? value.trim()
    : path.join(__dirname, value.trim());
}

function getEnvSet(key, defaultSet) {
  const value = process.env[key];
  if (!value || value.trim() === '') return defaultSet;
  return new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
}

function getEnvIntSet(key, defaultSet) {
  const value = process.env[key];
  if (!value || value.trim() === '') return defaultSet;
  const numbers = value
    .split(',')
    .map((item) => parseInt(item.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  return new Set(numbers);
}

function getEnvArray(key, defaultArray) {
  const value = process.env[key];
  if (!value || value.trim() === '') return defaultArray;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

const app = express();
const server = http.createServer(app);
const PORT = getEnvInt('PORT', 80);
const MONGODB_URI = getEnv('MONGODB_URI', process.env.MONGODB_URI);
const DB_NAME = getEnv('DB_NAME', 'LaanDBDevelopment');
const USERS_COLLECTION = getEnv('USERS_COLLECTION', 'users');
const UNIVERSITIES_COLLECTION = getEnv('UNIVERSITIES_COLLECTION', 'universities');
const SUBROOM_UNI_COLLECTION = getEnv('SUBROOM_UNI_COLLECTION', 'subroom_uni');
const SUBROOM_TEMP_VOTES_COLLECTION = getEnv('SUBROOM_TEMP_VOTES_COLLECTION', 'subroom_temp_votes');
const PUBLIC_CHAT_COLLECTION = getEnv('PUBLIC_CHAT_COLLECTION', 'public_chat');
const IN_CHAT_REPORT_COLLECTION = getEnv('IN_CHAT_REPORT_COLLECTION', 'in_chat_report');
const UNIVERSITIES_REQUEST_COLLECTION = getEnv('UNIVERSITIES_REQUEST_COLLECTION', 'universities_request');
const LOGS_COLLECTION = getEnv('LOGS_COLLECTION', 'LOGS');
const LOG_RETENTION_DAYS = getEnvInt('LOG_RETENTION_DAYS', 90);
const LOG_RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const LOG_QUEUE_BATCH_SIZE = getEnvInt('LOG_QUEUE_BATCH_SIZE', 50);
const LOG_QUEUE_FLUSH_INTERVAL_MS = getEnvInt('LOG_QUEUE_FLUSH_INTERVAL_MS', 3000);
function getEnvPrefix(key, defaultPrefix) {
  const value = process.env[key];
  const prefix = (!value || value.trim() === '') ? defaultPrefix : value.trim();
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function toMountPath(prefix) {
  const clean = prefix.replace(/^\/+|\/+$/g, '');
  return clean ? `/${clean}` : '/';
}

const UNIVERSITY_LOGOS_DIR = getEnvPath('UNIVERSITY_LOGOS_DIR', path.join('public', 'assets', 'sim_db', 'universities_logos'));
const USER_PROFILE_IMAGES_DIR = getEnvPath('USER_PROFILE_IMAGES_DIR', path.join('public', 'assets', 'sim_db', 'users_profile_image'));
const CHAT_ATTACHMENT_DIR = getEnvPath('CHAT_ATTACHMENT_DIR', path.join('public', 'assets', 'sim_db', 'users_chat_attachment'));
const IMAGE_EXTENSIONS = getEnvSet('IMAGE_EXTENSIONS', new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']));
const ATTACHMENT_EXTENSIONS = getEnvSet('ATTACHMENT_EXTENSIONS', new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf']));
const ATTACHMENT_MIME_TYPES = getEnvSet('ATTACHMENT_MIME_TYPES', new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf'
]));
const UNIVERSITY_LOGOS_URL_PREFIX = getEnvPrefix('UNIVERSITY_LOGOS_URL_PREFIX', 'assets/sim_db/universities_logos/');
const PROFILE_IMAGE_URL_PREFIX = getEnvPrefix('PROFILE_IMAGE_URL_PREFIX', 'assets/sim_db/users_profile_image/');
const CHAT_ATTACHMENT_URL_PREFIX = getEnvPrefix('CHAT_ATTACHMENT_URL_PREFIX', 'assets/sim_db/users_chat_attachment/');
const MAX_MESSAGE_LENGTH = getEnvInt('MAX_MESSAGE_LENGTH', 200);
const MAX_SUBROOM_CHAT_MESSAGES = getEnvInt('MAX_SUBROOM_CHAT_MESSAGES', 200);
const MESSAGE_PAGE_SIZE = getEnvInt('MESSAGE_PAGE_SIZE', 10);
const MAX_ATTACHMENT_SIZE_MB = getEnvFloat('MAX_ATTACHMENT_SIZE_MB', 5);
const MAX_ATTACHMENT_SIZE = Math.round(MAX_ATTACHMENT_SIZE_MB * 1024 * 1024);
const BODY_PARSER_LIMIT = getEnv('BODY_PARSER_LIMIT', '256kb');
const PENDING_ATTACHMENT_TTL_MS = getEnvInt('PENDING_ATTACHMENT_TTL_MS', 10 * 60 * 1000);
const PENDING_ATTACHMENT_CLEANUP_INTERVAL_MS = getEnvInt('PENDING_ATTACHMENT_CLEANUP_INTERVAL_MS', 60 * 1000);
const PRESENCE_TTL_MS = getEnvInt('PRESENCE_TTL_MS', 2 * 60 * 1000);
const JOINED_PING_MS = getEnvInt('JOINED_PING_MS', 60 * 1000);
const WS_AUTH_TIMEOUT_MS = getEnvInt('WS_AUTH_TIMEOUT_MS', 10 * 1000);
const API_RATE_LIMIT_WINDOW_MS = getEnvInt('API_RATE_LIMIT_WINDOW_MS', 60 * 1000);
const API_RATE_LIMIT_MAX = getEnvInt('API_RATE_LIMIT_MAX', 60);
const WS_RATE_LIMIT_WINDOW_MS = getEnvInt('WS_RATE_LIMIT_WINDOW_MS', 60 * 1000);
const WS_RATE_LIMIT_MAX = getEnvInt('WS_RATE_LIMIT_MAX', 30);
const RATE_LIMITER_CLEANUP_INTERVAL_MS = getEnvInt('RATE_LIMITER_CLEANUP_INTERVAL_MS', 60 * 1000);
const SUBROOM_TYPES = getEnvArray('SUBROOM_TYPES', ['official', 'community', 'temp']);
const ALLOWED_EXPIRE_DAYS = getEnvIntSet('ALLOWED_EXPIRE_DAYS', new Set([1, 3, 7, 14, 30]));
const SUBROOM_TEMP_VOTE_TOTAL = getEnvInt('SUBROOM_TEMP_VOTE_TOTAL', 15);
const DAY_MS = 24 * 60 * 60 * 1000;
const scryptAsync = promisify(crypto.scrypt);

class MemoryRateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const record = this.hits.get(key);

    if (!record || now >= record.resetTime) {
      const resetTime = now + this.windowMs;
      this.hits.set(key, { count: 1, resetTime });
      return {
        allowed: true,
        remaining: this.max - 1,
        resetTime,
        retryAfter: 0
      };
    }

    if (record.count < this.max) {
      record.count += 1;
      return {
        allowed: true,
        remaining: this.max - record.count,
        resetTime: record.resetTime,
        retryAfter: 0
      };
    }

    const retryAfter = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime,
      retryAfter
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.hits) {
      if (now >= record.resetTime) {
        this.hits.delete(key);
      }
    }
  }
}

const apiLimiter = new MemoryRateLimiter({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  max: API_RATE_LIMIT_MAX
});

const wsLimiter = new MemoryRateLimiter({
  windowMs: WS_RATE_LIMIT_WINDOW_MS,
  max: WS_RATE_LIMIT_MAX
});

let mongoClientPromise = null;
let usersCollectionPromise = null;
let publicChatCollectionPromise = null;
let subroomUniCollectionPromise = null;
let subroomTempVotesCollectionPromise = null;
let inChatReportCollectionPromise = null;
let logsCollectionPromise = null;
const pendingAttachments = new Map();
const sockets = new Set();
const presenceBySubroom = new Map();

function getClientIp(req) {
  const forwarded = req.headers ? (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']) : null;
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

function apiRateLimitMiddleware(req, res, next) {
  if (!req.path.startsWith('/api/') && req.path !== '/login' && req.path !== '/add-subroom') {
    return next();
  }

  const ip = getClientIp(req);
  const accessKey = getAccessKeyFromRequest(req);
  const key = accessKey ? `api:key:${accessKeyLookup(accessKey)}:${ip}` : `api:ip:${ip}`;
  const result = apiLimiter.check(key);

  res.setHeader('RateLimit-Limit', API_RATE_LIMIT_MAX);
  res.setHeader('RateLimit-Remaining', Math.max(0, result.remaining));
  res.setHeader('RateLimit-Reset', Math.ceil(result.resetTime / 1000));

  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfter);
    return sendApiError(res, 429, 'rate_limit_exceeded', 'คุณทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
  }

  next();
}

app.use(express.json({ limit: BODY_PARSER_LIMIT }));
app.use(apiRateLimitMiddleware);

// Security headers — applied to every response
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' wss: ws:",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  next();
});

app.use(toMountPath(UNIVERSITY_LOGOS_URL_PREFIX), express.static(UNIVERSITY_LOGOS_DIR));
app.use(toMountPath(PROFILE_IMAGE_URL_PREFIX), express.static(USER_PROFILE_IMAGES_DIR));
app.use(toMountPath(CHAT_ATTACHMENT_URL_PREFIX), express.static(CHAT_ATTACHMENT_DIR));

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html']
}));

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE,
    files: 1
  }
});

function normalizeNick(nick) {
  return typeof nick === 'string' ? nick.trim() : '';
}

function validateNick(nick) {
  const value = normalizeNick(nick);
  if (!value) {
    const error = new Error('กรุณากรอกชื่อเล่นหรือนามแฝง');
    error.statusCode = 400;
    error.code = 'invalid_nick';
    throw error;
  }
  if (value.length < 5 || value.length > 25) {
    const error = new Error('ชื่อต้องมีความยาว 5-25 ตัวอักษร');
    error.statusCode = 400;
    error.code = 'invalid_nick_length';
    throw error;
  }
  if (!/^[a-zA-Z0-9\u0E00-\u0E7F ]+$/.test(value)) {
    const error = new Error('ชื่อต้องประกอบด้วยตัวอักษรไทย อังกฤษ หรือตัวเลขเท่านั้น');
    error.statusCode = 400;
    error.code = 'invalid_nick_chars';
    throw error;
  }
  if (/^[\d ]+$/.test(value)) {
    const error = new Error('ชื่อไม่สามารถเป็นตัวเลขล้วนได้');
    error.statusCode = 400;
    error.code = 'invalid_nick_digits_only';
    throw error;
  }
  return value;
}

function normalizePlainText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, maxLength);
}

function normalizeSocialUrl(value) {
  return normalizePlainText(value, 300);
}

function isAllowedSocialHostname(hostname, domain) {
  return hostname === domain || hostname === `www.${domain}`;
}

function normalizeSubmittedSocialUrl(value, domain) {
  const raw = normalizeSocialUrl(value);
  if (!raw) return '';

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!isAllowedSocialHostname(url.hostname.toLowerCase(), domain)) return null;
    return url.href.slice(0, 300);
  } catch (error) {
    return null;
  }
}

function publicSocialMedia(socialMedia) {
  return {
    facebook: normalizeSocialUrl(socialMedia?.facebook),
    instagram: normalizeSocialUrl(socialMedia?.instagram)
  };
}

function normalizeAccessKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function publicUser(user) {
  return {
    user_id: user.user_id,
    user_nick: user.user_nick,
    user_uniname: user.user_uniname,
    user_profile_url: user.user_profile_url,
    social_media: publicSocialMedia(user.social_media),
    is_banned: Boolean(user.is_banned),
    readed_subroom: Array.isArray(user.readed_subroom) ? user.readed_subroom : [],
    readed_privateroom: Array.isArray(user.readed_privateroom) ? user.readed_privateroom : [],
    subroom_voted: Array.isArray(user.subroom_voted) ? user.subroom_voted : [],
    reported_chat: Array.isArray(user.reported_chat) ? user.reported_chat : [],
    reported_profile: Array.isArray(user.reported_profile) ? user.reported_profile : [],
    created_at: user.created_at
  };
}

function accessKeyLookup(accessKey) {
  return crypto.createHash('sha256').update(accessKey).digest('hex');
}

function getAccessKeyFromRequest(req) {
  return normalizeAccessKey(req.get('X-Access-HKey'));
}

function getMongoClient() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured.');
  }

  if (!mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI);
    mongoClientPromise = client.connect().catch((error) => {
      mongoClientPromise = null;
      throw error;
    });
  }

  return mongoClientPromise;
}

async function getDbCollection(collectionName) {
  const client = await getMongoClient();
  return client.db(DB_NAME).collection(collectionName);
}

async function getUsersCollection() {
  if (!usersCollectionPromise) {
    usersCollectionPromise = (async () => {
      const collection = await getDbCollection(USERS_COLLECTION);

      await Promise.all([
        collection.createIndex({ user_nick: 1 }, { unique: true }),
        collection.createIndex({ user_id: 1 }, { unique: true }),
        collection.createIndex({ access_hkey_lookup: 1 })
      ]);

      return collection;
    })().catch((error) => {
      usersCollectionPromise = null;
      throw error;
    });
  }

  return usersCollectionPromise;
}

async function getUniversitiesCollection() {
  return getDbCollection(UNIVERSITIES_COLLECTION);
}

async function getSubroomUniCollection() {
  if (!subroomUniCollectionPromise) {
    subroomUniCollectionPromise = (async () => {
      const collection = await getDbCollection(SUBROOM_UNI_COLLECTION);

      await Promise.all([
        collection.createIndex({ uniroom_id: 1, subroom_type: 1 }),
        collection.createIndex({ subroom_id: 1 }, { unique: true })
      ]);

      return collection;
    })().catch((error) => {
      subroomUniCollectionPromise = null;
      throw error;
    });
  }

  return subroomUniCollectionPromise;
}

async function getSubroomTempVotesCollection() {
  if (!subroomTempVotesCollectionPromise) {
    subroomTempVotesCollectionPromise = (async () => {
      const collection = await getDbCollection(SUBROOM_TEMP_VOTES_COLLECTION);

      await Promise.all([
        collection.createIndex({ subroom_id: 1 }, { unique: true }),
        collection.createIndex({ expire_days: 1 })
      ]);

      return collection;
    })().catch((error) => {
      subroomTempVotesCollectionPromise = null;
      throw error;
    });
  }

  return subroomTempVotesCollectionPromise;
}

async function getPublicChatCollection() {
  if (!publicChatCollectionPromise) {
    publicChatCollectionPromise = (async () => {
      const collection = await getDbCollection(PUBLIC_CHAT_COLLECTION);

      await Promise.all([
        collection.createIndex({ subroom_id: 1, created_at: -1 }),
        collection.createIndex({ chat_id: 1 }, { unique: true })
      ]);

      return collection;
    })().catch((error) => {
      publicChatCollectionPromise = null;
      throw error;
    });
  }

  return publicChatCollectionPromise;
}

async function getInChatReportCollection() {
  if (!inChatReportCollectionPromise) {
    inChatReportCollectionPromise = (async () => {
      const collection = await getDbCollection(IN_CHAT_REPORT_COLLECTION);

      await Promise.all([
        collection.createIndex({ report_id: 1 }, { unique: true }),
        collection.createIndex({ reporter_user_id: 1 }),
        collection.createIndex({ created_at: -1 })
      ]);

      return collection;
    })().catch((error) => {
      inChatReportCollectionPromise = null;
      throw error;
    });
  }

  return inChatReportCollectionPromise;
}

async function getUniversitiesRequestCollection() {
  const collection = await getDbCollection(UNIVERSITIES_REQUEST_COLLECTION);
  await collection.createIndex({ created_at: -1 });
  return collection;
}

async function getLogsCollection() {
  if (!logsCollectionPromise) {
    logsCollectionPromise = (async () => {
      const collection = await getDbCollection(LOGS_COLLECTION);

      await Promise.all([
        collection.createIndex({ timestamp: 1 }),
        collection.createIndex({ user_id: 1 }),
        collection.createIndex({ action: 1 })
      ]);

      return collection;
    })().catch((error) => {
      logsCollectionPromise = null;
      throw error;
    });
  }

  return logsCollectionPromise;
}

function getUserAgent(req) {
  return (req && req.headers ? (req.headers['user-agent'] || '') : '').trim();
}

function parseUserDevice(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return 'Unknown';
  const ua = userAgent.toLowerCase();

  // Tablets
  if (/ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk/i.test(ua)) {
    if (/ipad/i.test(ua)) return 'Tablet (iOS)';
    if (/android/i.test(ua)) return 'Tablet (Android)';
    return 'Tablet';
  }

  // Mobile
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile|wpdesktop|windows phone/i.test(ua)) {
    if (/iphone|ipod/i.test(ua)) return 'Mobile (iOS)';
    if (/android/i.test(ua)) return 'Mobile (Android)';
    if (/windows phone/i.test(ua)) return 'Mobile (Windows)';
    return 'Mobile';
  }

  // Desktop
  if (/windows/i.test(ua)) return 'Desktop (Windows)';
  if (/macintosh|mac os x/i.test(ua)) return 'Desktop (macOS)';
  if (/cros/i.test(ua)) return 'Desktop (Chrome OS)';
  if (/linux/i.test(ua)) return 'Desktop (Linux)';

  // Bots / Crawlers
  if (/bot|crawler|spider|slurp|facebookexternalhit|curl|wget/i.test(ua)) return 'Bot';

  return 'Desktop (Other)';
}

class LogQueue {
  constructor({ batchSize = LOG_QUEUE_BATCH_SIZE, flushIntervalMs = LOG_QUEUE_FLUSH_INTERVAL_MS } = {}) {
    this.buffer = [];
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.timer = null;
    this.isFlushing = false;
    this.lastCleanup = 0;
    this.startTimer();
  }

  startTimer() {
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.flush().catch((err) => {
          console.error('[LogQueue] Timer flush error:', err.message);
        });
      }, this.flushIntervalMs);
      this.timer.unref();
    }
  }

  enqueue(logRecord) {
    if (!logRecord || typeof logRecord !== 'object') return;
    this.buffer.push(logRecord);

    if (this.buffer.length >= this.batchSize) {
      this.flush().catch((err) => {
        console.error('[LogQueue] Batch size flush error:', err.message);
      });
    }
  }

  async flush() {
    if (this.isFlushing || this.buffer.length === 0) return;
    this.isFlushing = true;

    const itemsToWrite = this.buffer.splice(0, this.buffer.length);

    try {
      const logsCollection = await getLogsCollection();
      await logsCollection.insertMany(itemsToWrite, { ordered: false });

      this.triggerRetentionCleanup(logsCollection);
    } catch (err) {
      console.error('[LogQueue] Failed to write logs to MongoDB:', err.message);
      if (this.buffer.length < 5000) {
        this.buffer.unshift(...itemsToWrite);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  triggerRetentionCleanup(logsCollection) {
    const now = Date.now();
    if (now - this.lastCleanup < 60 * 1000) return;
    this.lastCleanup = now;

    (async () => {
      try {
        const cutoffDate = new Date(Date.now() - LOG_RETENTION_MS);
        const result = await logsCollection.deleteMany({ timestamp: { $lt: cutoffDate } });
        if (result && result.deletedCount > 0) {
          console.log(`[LogQueue] Cleaned up ${result.deletedCount} expired log documents older than 90 days.`);
        }
      } catch (err) {
        console.error('[LogQueue] Retention cleanup error:', err.message);
      }
    })();
  }

  async shutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

const logQueue = new LogQueue();

function logTraffic({ timestamp = new Date(), req, ws, userId, action }) {
  const ipAddress = req ? getClientIp(req) : (ws?.clientIp || '127.0.0.1');
  const userAgent = req ? getUserAgent(req) : (ws?.userAgent || '');
  const userDevice = parseUserDevice(userAgent);

  const record = {
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
    ip_address: ipAddress,
    user_agent: userAgent,
    user_device: userDevice,
    user_id: String(userId || ''),
    action: String(action || '')
  };

  logQueue.enqueue(record);
}

function sanitizeUserForReport(user) {
  if (!user || typeof user !== 'object') return null;
  const clone = { ...user };
  delete clone.access_hkey;
  delete clone.access_hkey_lookup;
  return clone;
}

function generateAccessKey() {
  return crypto.randomUUID();
}

async function hashAccessKey(accessKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptAsync(String(accessKey), salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

async function verifyAccessKey(accessKey, storedValue) {
  if (!accessKey || typeof storedValue !== 'string') return false;

  const [method, salt, hashHex] = storedValue.split(':');
  if (method !== 'scrypt' || !salt || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(String(accessKey), salt, expected.length);
  if (actual.length !== expected.length) return false;

  return crypto.timingSafeEqual(actual, expected);
}

async function resolveUserFromAccessKey(accessKey) {
  const normalizedAccessKey = normalizeAccessKey(accessKey);
  if (!normalizedAccessKey) {
    const error = new Error('Missing access key.');
    error.statusCode = 403;
    error.code = 'permission_denied';
    throw error;
  }

  const users = await getUsersCollection();
  const lookup = accessKeyLookup(normalizedAccessKey);
  let user = await users.findOne({ access_hkey_lookup: lookup });

  if (!user) {
    const legacyCandidates = await users
      .find({ access_hkey_lookup: { $exists: false } })
      .project({ access_hkey: 1, user_id: 1, user_nick: 1, user_uniname: 1, user_profile_url: 1, social_media: 1, is_banned: 1, created_at: 1, readed_subroom: 1, readed_privateroom: 1, subroom_voted: 1, reported_chat: 1, reported_profile: 1 })
      .limit(100)
      .toArray();

    for (const candidate of legacyCandidates) {
      if (await verifyAccessKey(normalizedAccessKey, candidate.access_hkey)) {
        await users.updateOne(
          { user_id: candidate.user_id },
          { $set: { access_hkey_lookup: lookup } }
        );
        user = candidate;
        break;
      }
    }
  }

  if (!user || !(await verifyAccessKey(normalizedAccessKey, user.access_hkey))) {
    const error = new Error('Invalid access key.');
    error.statusCode = 403;
    error.code = 'permission_denied';
    throw error;
  }

  if (user.is_banned) {
    const error = new Error('User is banned.');
    error.statusCode = 403;
    error.code = 'banned';
    throw error;
  }

  return user;
}

async function resolveUserFromUserId(userId) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  if (!normalizedUserId) {
    const error = new Error('Missing user ID.');
    error.statusCode = 403;
    error.code = 'permission_denied';
    throw error;
  }

  const users = await getUsersCollection();
  const user = await users.findOne({ user_id: normalizedUserId });

  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 403;
    error.code = 'permission_denied';
    throw error;
  }

  if (user.is_banned) {
    const error = new Error('User is banned.');
    error.statusCode = 403;
    error.code = 'banned';
    throw error;
  }

  return user;
}

async function requireUser(req, res, next) {
  try {
    req.user = await resolveUserFromAccessKey(getAccessKeyFromRequest(req));
    next();
  } catch (error) {
    sendApiError(res, error.statusCode || 500, error.code || 'server_error', getPublicErrorMessage(error));
  }
}

async function isValidProfileImageUrl(profileUrl) {
  if (typeof profileUrl !== 'string' || !profileUrl.startsWith(PROFILE_IMAGE_URL_PREFIX)) {
    return false;
  }

  const fileName = decodeURIComponent(profileUrl.slice(PROFILE_IMAGE_URL_PREFIX.length));
  if (fileName !== path.basename(fileName) || !IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
    return false;
  }

  try {
    const profilePath = path.join(USER_PROFILE_IMAGES_DIR, fileName);
    const stats = await fs.promises.stat(profilePath);
    return stats.isFile();
  } catch (error) {
    return false;
  }
}

function sendApiError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    status: 'error',
    code,
    message
  });
}

function getPublicErrorMessage(error) {
  if (error.code === 'missing_access_hkey' || error.code === 'invalid_access_hkey' || error.code === 'permission_denied') return 'กรุณาเข้าสู่ระบบใหม่';
  if (error.code === 'banned') return 'บัญชีนี้ถูกระงับการใช้งาน';
  if (error.code === 'invalid_subroom') return 'ไม่พบห้องนี้ในระบบ';
  if (error.code === 'invalid_vote_subroom') return 'โหวตได้เฉพาะห้องชั่วคราวเท่านั้น';
  if (error.code === 'already_voted') return 'คุณโหวตห้องนี้ไปแล้ว';
  if (error.code === 'vote_expired') return 'ห้องนี้หมดเวลาโหวตแล้ว';
  if (error.code === 'vote_closed') return 'ห้องนี้ปิดรับโหวตแล้ว';
  if (error.code === 'invalid_nick') return 'กรุณากรอกชื่อเล่นหรือนามแฝง';
  if (error.code === 'invalid_nick_length') return 'ชื่อต้องมีความยาว 5-25 ตัวอักษร';
  if (error.code === 'invalid_nick_chars') return 'ชื่อต้องประกอบด้วยตัวอักษรไทย อังกฤษ หรือตัวเลขเท่านั้น';
  if (error.code === 'invalid_nick_digits_only') return 'ชื่อไม่สามารถเป็นตัวเลขล้วนได้';
  if (error.code === 'invalid_message') return 'ข้อความไม่ถูกต้อง หรือยาวเกิน 200 ตัวอักษร';
  if (error.code === 'invalid_attachment') return 'ไฟล์แนบไม่ถูกต้อง';
  if (error.code === 'attachment_too_large') return `ไฟล์แนบต้องมีขนาดไม่เกิน ${MAX_ATTACHMENT_SIZE_MB} MB ต่อครั้ง`;
  if (error.code === 'rate_limit_exceeded') return 'คุณทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง';
  return 'ระบบทำงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

function normalizeSubroomName(name) {
  return normalizePlainText(name, 25);
}

function normalizeSubroomDesc(desc) {
  return normalizePlainText(desc, 160);
}

async function getValidSubroom(subroomId) {
  const normalizedSubroomId = normalizePlainText(subroomId, 120);
  if (!normalizedSubroomId) return null;

  const subroomUni = await getSubroomUniCollection();
  return subroomUni.findOne(
    {
      subroom_id: normalizedSubroomId,
      subroom_type: { $in: SUBROOM_TYPES }
    },
    {
      projection: {
        _id: 0,
        uniroom_id: 1,
        subroom_id: 1,
        subroom_name: 1,
        subroom_desc: 1,
        subroom_type: 1,
        expire_days: 1,
        created_at: 1
      }
    }
  );
}

function getSubroomOnlineCount(subroomId) {
  cleanupPresence();
  return presenceBySubroom.get(subroomId)?.size || 0;
}

function publicSubroom(subroom) {
  return {
    uniroom_id: subroom.uniroom_id,
    subroom_id: subroom.subroom_id,
    subroom_name: subroom.subroom_name,
    subroom_desc: subroom.subroom_desc || '',
    subroom_type: subroom.subroom_type,
    expire_days: subroom.expire_days,
    created_at: subroom.created_at,
    vote: subroom.vote || null,
    channel_count: getSubroomOnlineCount(subroom.subroom_id)
  };
}

function getRemainingDays(expireAt, now = new Date()) {
  const expireDate = expireAt instanceof Date ? expireAt : new Date(expireAt);
  if (Number.isNaN(expireDate.getTime())) return 0;

  const remainingMs = differenceInMilliseconds(expireDate, now);
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / DAY_MS);
}

function publicTempVote(voteDocument, user, now = new Date()) {
  const votedRooms = Array.isArray(user?.subroom_voted) ? user.subroom_voted : [];
  return {
    votes_count: Number(voteDocument?.votes_count || 0),
    vote_total: SUBROOM_TEMP_VOTE_TOTAL,
    expires_in_days: getRemainingDays(voteDocument?.expire_days, now),
    has_voted: votedRooms.includes(voteDocument?.subroom_id)
  };
}

function findOneAndUpdateDocument(result) {
  if (!result || typeof result !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(result, 'value')) return result.value;
  return result;
}

async function attachTempVoteData(subrooms, user) {
  const tempIds = subrooms
    .filter(subroom => subroom.subroom_type === 'temp')
    .map(subroom => subroom.subroom_id);

  if (!tempIds.length) return subrooms;

  const votes = await getSubroomTempVotesCollection();
  const voteDocuments = await votes
    .find(
      { subroom_id: { $in: tempIds } },
      { projection: { _id: 0, subroom_id: 1, expire_days: 1, votes_count: 1 } }
    )
    .toArray();
  const votesBySubroom = new Map(voteDocuments.map(vote => [vote.subroom_id, vote]));
  const now = new Date();

  return subrooms.map(subroom => {
    if (subroom.subroom_type !== 'temp') return subroom;
    const voteDocument = votesBySubroom.get(subroom.subroom_id) || {
      subroom_id: subroom.subroom_id,
      expire_days: subroom.expire_days,
      votes_count: 0
    };
    return {
      ...subroom,
      vote: publicTempVote(voteDocument, user, now)
    };
  });
}

function groupedSubrooms(subrooms) {
  return SUBROOM_TYPES.reduce((groups, type) => {
    groups[type] = subrooms
      .filter(subroom => subroom.subroom_type === type)
      .map(publicSubroom);
    return groups;
  }, {});
}

function validateMessageText(message, hasAttachment) {
  const value = normalizePlainText(message, MAX_MESSAGE_LENGTH + 1);
  if ((!value && !hasAttachment) || value.length > MAX_MESSAGE_LENGTH) {
    const error = new Error('Invalid message.');
    error.statusCode = 400;
    error.code = 'invalid_message';
    throw error;
  }
  return value;
}

function validateAttachmentUrl(attachmentUrl, userId, subroomId) {
  const url = normalizePlainText(attachmentUrl, 300);
  if (!url) return { attachmentUrl: '', chatId: '' };
  if (!url.startsWith(CHAT_ATTACHMENT_URL_PREFIX)) {
    const error = new Error('Invalid attachment.');
    error.statusCode = 400;
    error.code = 'invalid_attachment';
    throw error;
  }

  const pending = pendingAttachments.get(url);
  if (!pending || pending.user_id !== userId || pending.subroom_id !== subroomId || pending.used) {
    const error = new Error('Invalid attachment.');
    error.statusCode = 400;
    error.code = 'invalid_attachment';
    throw error;
  }

  return {
    attachmentUrl: url,
    chatId: pending.chat_id,
    pending
  };
}

function buildChatDocument(user, subroomId, message, attachmentUrl, chatId) {
  return {
    chat_id: chatId || `chatnum_${crypto.randomUUID()}`,
    subroom_id: subroomId,
    user_owner_id: user.user_id,
    message,
    attachment_url: attachmentUrl || '',
    created_at: new Date()
  };
}

function publicChatMessage(document, user) {
  return {
    chat_id: document.chat_id,
    subroom_id: document.subroom_id,
    user_owner_id: document.user_owner_id,
    user_nick: user?.user_nick || '',
    user_uniname: user?.user_uniname || '',
    user_profile_url: user?.user_profile_url || '',
    social_media: publicSocialMedia(user?.social_media),
    user_created_at: user?.created_at || '',
    message: document.message,
    attachment_url: document.attachment_url || '',
    created_at: document.created_at
  };
}

function formatMessageForResponse(document, usersById) {
  return publicChatMessage(document, usersById.get(document.user_owner_id));
}

async function getUsersByIds(userIds) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return new Map();

  const users = await getUsersCollection();
  const rows = await users
    .find({ user_id: { $in: ids } })
    .project({ _id: 0, user_id: 1, user_nick: 1, user_uniname: 1, user_profile_url: 1, social_media: 1, created_at: 1 })
    .toArray();

  return new Map(rows.map(user => [user.user_id, user]));
}

function getSubroomPresence(subroomId) {
  if (!presenceBySubroom.has(subroomId)) {
    presenceBySubroom.set(subroomId, new Map());
  }
  return presenceBySubroom.get(subroomId);
}

function cleanupPresence() {
  const now = Date.now();
  let changed = false;

  for (const [subroomId, members] of presenceBySubroom) {
    for (const [userId, presence] of members) {
      if (now - presence.last_seen_at > PRESENCE_TTL_MS) {
        members.delete(userId);
        changed = true;
      }
    }

    if (!members.size) presenceBySubroom.delete(subroomId);
  }

  if (changed) broadcastAllPresence();
}

function getPresencePayload(subroomId) {
  cleanupPresence();
  const members = Array.from((presenceBySubroom.get(subroomId) || new Map()).values())
    .sort((a, b) => a.user_nick.localeCompare(b.user_nick, 'th'))
    .map(member => ({
      user_id: member.user_id,
      user_nick: member.user_nick,
      user_uniname: member.user_uniname,
      user_profile_url: member.user_profile_url,
      social_media: publicSocialMedia(member.social_media),
      created_at: member.created_at,
      last_seen_at: new Date(member.last_seen_at)
    }));

  return {
    subroom_id: subroomId,
    channel_count: members.length,
    online_users: members
  };
}

function getUniversityOnlineCount(uniroomId) {
  cleanupPresence();
  const userIds = new Set();
  for (const members of presenceBySubroom.values()) {
    for (const presence of members.values()) {
      if (presence.uniroom_id === uniroomId) userIds.add(`${presence.user_id}:${presence.subroom_id}`);
    }
  }
  return userIds.size;
}

function safeSend(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcastToSubroom(subroomId, payload, exceptWs) {
  for (const ws of sockets) {
    if (ws !== exceptWs && ws.subroomId === subroomId) {
      safeSend(ws, payload);
    }
  }
}

function broadcastAllPresence() {
  const seen = new Set();
  for (const ws of sockets) {
    if (!ws.subroomId || seen.has(ws.subroomId)) continue;
    seen.add(ws.subroomId);
    broadcastPresence(ws.subroomId);
  }
}

async function broadcastPresence(subroomId) {
  const subroom = await getValidSubroom(subroomId);
  if (!subroom) return;
  const payload = {
    event: 'presence',
    content_obj: {
      ...getPresencePayload(subroomId),
      uniroom_id: subroom.uniroom_id,
      university_online_count: getUniversityOnlineCount(subroom.uniroom_id)
    }
  };
  broadcastToSubroom(subroomId, payload);
}

function broadcastTyping(event, subroomId, user, sourceWs) {
  broadcastToSubroom(subroomId, {
    event,
    content_obj: {
      subroom_id: subroomId,
      user_id: user.user_id,
      user_nick: user.user_nick,
      user_uniname: user.user_uniname
    }
  }, sourceWs);
}

function trackPresence(ws, user, subroom) {
  const previousSubroom = ws.subroomId;
  if (previousSubroom && previousSubroom !== subroom.subroom_id) {
    presenceBySubroom.get(previousSubroom)?.delete(ws.userId);
    broadcastPresence(previousSubroom);
  }

  ws.userId = user.user_id;
  ws.subroomId = subroom.subroom_id;
  ws.uniroomId = subroom.uniroom_id;
  getSubroomPresence(subroom.subroom_id).set(user.user_id, {
    user_id: user.user_id,
    user_nick: user.user_nick,
    user_uniname: user.user_uniname,
    user_profile_url: user.user_profile_url,
    social_media: user.social_media,
    created_at: user.created_at,
    uniroom_id: subroom.uniroom_id,
    subroom_id: subroom.subroom_id,
    last_seen_at: Date.now()
  });
}

async function handleWsAuth(ws, contentObj) {
  const accessKey = contentObj?.access_hkey;
  const user = await resolveUserFromAccessKey(accessKey);
  ws.authenticated = true;
  ws.userId = user.user_id;
  if (ws.authTimer) {
    clearTimeout(ws.authTimer);
    ws.authTimer = null;
  }

  safeSend(ws, {
    event: 'auth_success',
    content_obj: {
      user_id: user.user_id,
      user_nick: user.user_nick
    }
  });
}

async function deleteAttachmentFile(attachmentUrl) {
  if (!attachmentUrl || typeof attachmentUrl !== 'string') return;
  if (!attachmentUrl.startsWith(CHAT_ATTACHMENT_URL_PREFIX)) return;

  const fileName = attachmentUrl.slice(CHAT_ATTACHMENT_URL_PREFIX.length);
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) return;

  const targetPath = path.join(CHAT_ATTACHMENT_DIR, fileName);
  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedDir = path.resolve(CHAT_ATTACHMENT_DIR);

  if (!resolvedTargetPath.startsWith(resolvedDir + path.sep)) return;

  try {
    await fs.promises.unlink(resolvedTargetPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('Failed to delete pruned attachment file:', resolvedTargetPath, err.message);
    }
  }
}

async function pruneOldSubroomMessages(subroomId) {
  if (!subroomId) return;

  try {
    const publicChat = await getPublicChatCollection();
    const excessMessages = await publicChat
      .find({ subroom_id: subroomId }, { projection: { _id: 1, attachment_url: 1 } })
      .sort({ created_at: -1 })
      .skip(MAX_SUBROOM_CHAT_MESSAGES)
      .toArray();

    if (!excessMessages || excessMessages.length === 0) {
      return;
    }

    const excessIds = excessMessages.map(msg => msg._id);

    await Promise.allSettled(
      excessMessages
        .filter(msg => Boolean(msg.attachment_url))
        .map(msg => deleteAttachmentFile(msg.attachment_url))
    );

    await publicChat.deleteMany({ _id: { $in: excessIds } });
  } catch (error) {
    console.error('Error pruning old subroom messages for subroom:', subroomId, error.message);
  }
}

async function saveAndBroadcastMessage(ws, contentObj) {
  if (!ws.authenticated || !ws.userId) {
    const error = new Error('Unauthorized.');
    error.statusCode = 403;
    error.code = 'permission_denied';
    throw error;
  }

  const user = await resolveUserFromUserId(ws.userId);
  const subroom = await getValidSubroom(contentObj.subroom_id);
  if (!subroom) {
    const error = new Error('Invalid subroom.');
    error.statusCode = 400;
    error.code = 'invalid_subroom';
    throw error;
  }

  const hasAttachment = Boolean(normalizePlainText(contentObj.attachment_url, 300));
  const message = validateMessageText(contentObj.message, hasAttachment);
  const attachment = validateAttachmentUrl(contentObj.attachment_url, user.user_id, subroom.subroom_id);
  const document = buildChatDocument(user, subroom.subroom_id, message, attachment.attachmentUrl, attachment.chatId);
  const publicChat = await getPublicChatCollection();
  await publicChat.insertOne(document);
  if (attachment.attachmentUrl) {
    attachment.pending.used = true;
    pendingAttachments.set(attachment.attachmentUrl, attachment.pending);
  }

  logTraffic({
    timestamp: document.created_at,
    ws,
    userId: user.user_id,
    action: 'chating'
  });

  const payload = {
    event: 'message',
    content_obj: publicChatMessage(document, user)
  };
  safeSend(ws, payload);
  broadcastToSubroom(subroom.subroom_id, payload, ws);

  pruneOldSubroomMessages(subroom.subroom_id).catch(err => {
    console.error('Background message pruning error:', err.message);
  });
}

async function handleJoinedPing(ws, contentObj) {
  if (!ws.authenticated || !ws.userId) {
    const error = new Error('Unauthorized.');
    error.statusCode = 403;
    error.code = 'permission_denied';
    throw error;
  }

  const user = await resolveUserFromUserId(ws.userId);
  const subroom = await getValidSubroom(contentObj.subroom_id);
  if (!subroom) {
    const error = new Error('Invalid subroom.');
    error.statusCode = 400;
    error.code = 'invalid_subroom';
    throw error;
  }

  trackPresence(ws, user, subroom);
  await broadcastPresence(subroom.subroom_id);
}

async function handleTypingEvent(ws, event, contentObj) {
  if (!ws.authenticated || !ws.userId) {
    const error = new Error('Unauthorized.');
    error.statusCode = 403;
    error.code = 'permission_denied';
    throw error;
  }

  const user = await resolveUserFromUserId(ws.userId);
  const subroom = await getValidSubroom(contentObj.subroom_id);
  if (!subroom) {
    const error = new Error('Invalid subroom.');
    error.statusCode = 400;
    error.code = 'invalid_subroom';
    throw error;
  }
  broadcastTyping(event, subroom.subroom_id, user, ws);
}

function handleWsError(ws, error) {
  safeSend(ws, {
    event: 'error',
    content_obj: {
      code: error.code || 'server_error',
      message: getPublicErrorMessage(error)
    }
  });
}

async function handleWsMessage(ws, raw) {
  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch (error) {
    const invalidJson = new Error('Invalid JSON.');
    invalidJson.statusCode = 400;
    invalidJson.code = 'invalid_json';
    throw invalidJson;
  }

  const event = typeof payload.event === 'string' ? payload.event : '';
  const contentObj = payload.content_obj && typeof payload.content_obj === 'object' ? payload.content_obj : {};

  const ip = ws.clientIp || '127.0.0.1';
  const wsKey = ws.userId ? `ws:user:${ws.userId}:${ip}` : `ws:ip:${ip}`;
  const rateLimitResult = wsLimiter.check(wsKey);
  if (!rateLimitResult.allowed) {
    safeSend(ws, {
      event: 'error',
      content_obj: {
        code: 'rate_limit_exceeded',
        message: 'คุณส่งข้อความหรือทำรายการถี่เกินไป กรุณารอสักครู่'
      }
    });
    return;
  }

  if (event === 'auth') return handleWsAuth(ws, contentObj);

  if (!ws.authenticated) {
    const error = new Error('Unauthorized.');
    error.statusCode = 403;
    error.code = 'permission_denied';
    throw error;
  }

  if (event === 'message') return saveAndBroadcastMessage(ws, contentObj);
  if (event === 'joined_ping') return handleJoinedPing(ws, contentObj);
  if (event === 'start_typing' || event === 'stop_typing') return handleTypingEvent(ws, event, contentObj);

  const invalidEvent = new Error('Invalid event.');
  invalidEvent.statusCode = 400;
  invalidEvent.code = 'invalid_event';
  throw invalidEvent;
}

function removeSocketPresence(ws) {
  if (!ws.subroomId || !ws.userId) return;
  const members = presenceBySubroom.get(ws.subroomId);
  if (members) {
    members.delete(ws.userId);
    if (!members.size) presenceBySubroom.delete(ws.subroomId);
  }
  broadcastPresence(ws.subroomId);
}

function ensureAttachmentDirectory() {
  return fs.promises.mkdir(CHAT_ATTACHMENT_DIR, { recursive: true });
}

function getSafeAttachmentExtension(file) {
  const originalExt = path.extname(file.originalname || '').toLowerCase();
  const ext = originalExt === '.jpeg' ? '.jpg' : originalExt;

  if (!ATTACHMENT_EXTENSIONS.has(ext) || !ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
    const error = new Error('Invalid attachment.');
    error.statusCode = 400;
    error.code = 'invalid_attachment';
    throw error;
  }

  return ext;
}

function createUploadMiddleware(req, res, next) {
  attachmentUpload.single('attachment')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return sendApiError(res, 413, 'attachment_too_large', getPublicErrorMessage({ code: 'attachment_too_large' }));
    }
    return sendApiError(res, 400, 'invalid_attachment', getPublicErrorMessage({ code: 'invalid_attachment' }));
  });
}

app.get('/api/info', requireUser, (req, res) => {
  res.json({
    status: 'success',
    message: 'Connected'
  });
});

app.all('/api/auth/access-hkey', (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendApiError(res, 405, 'method_not_allowed', 'Method Not Allowed');
  }
  return res.json({
    status: 'success',
    access_hkey: generateAccessKey()
  });
});

app.post('/login', async (req, res) => {
  const action = typeof req.body.action === 'string' ? req.body.action : '';

  try {
    const users = await getUsersCollection();

    if (action === 'check') {
      let nick;
      try {
        nick = validateNick(req.body.nick);
      } catch (err) {
        return sendApiError(res, err.statusCode || 400, err.code || 'invalid_nick', getPublicErrorMessage(err));
      }

      const user = await users.findOne(
        { user_nick: nick },
        { projection: { user_id: 1, is_banned: 1 } }
      );

      if (!user) return res.json({ status: 'not_found' });
      if (user.is_banned) return sendApiError(res, 403, 'banned', 'บัญชีนี้ถูกระงับการใช้งาน');

      return res.json({
        status: 'found',
        user_id: user.user_id
      });
    }

    if (action === 'verify') {
      const userId = typeof req.body.user_id === 'string' ? req.body.user_id.trim() : '';
      const accessKey = normalizeAccessKey(req.body.access_hkey);
      const nick = normalizeNick(req.body.nick);

      if (!userId || !accessKey) {
        return sendApiError(res, 400, 'invalid_credentials', 'ข้อมูลเข้าสู่ระบบไม่ครบถ้วน');
      }

      const user = await users.findOne({ user_id: userId });
      if (!user || (nick && user.user_nick !== nick)) {
        return sendApiError(res, 403, 'invalid_credentials', 'คุณไม่มีสิทธิ์ใช้งานชื่อนี้');
      }

      if (user.is_banned) return sendApiError(res, 403, 'banned', 'บัญชีนี้ถูกระงับการใช้งาน');

      const isMatch = await verifyAccessKey(accessKey, user.access_hkey);
      if (!isMatch) return sendApiError(res, 403, 'invalid_credentials', 'คุณไม่มีสิทธิ์ใช้งานชื่อนี้');

      await users.updateOne(
        { user_id: user.user_id },
        { $set: { access_hkey_lookup: accessKeyLookup(accessKey) } }
      );

      logTraffic({
        timestamp: new Date(),
        req,
        userId: user.user_id,
        action: 'loggedin'
      });

      return res.json({
        status: 'success',
        user: publicUser(user)
      });
    }

    if (action === 'create') {
      let nick;
      try {
        nick = validateNick(req.body.nick);
      } catch (err) {
        return sendApiError(res, err.statusCode || 400, err.code || 'invalid_nick', getPublicErrorMessage(err));
      }
      const userUniname = typeof req.body.user_uniname === 'string' ? req.body.user_uniname.trim() : '';
      const userProfileUrl = typeof req.body.user_profile_url === 'string' ? req.body.user_profile_url.trim() : '';
      const accessKey = normalizeAccessKey(req.body.access_hkey);

      if (!userUniname) return sendApiError(res, 400, 'invalid_university', 'กรุณาเลือกมหาวิทยาลัย');
      if (!accessKey) return sendApiError(res, 400, 'invalid_access_key', 'ไม่สามารถสร้างรหัสเข้าสู่ระบบได้');
      if (!(await isValidProfileImageUrl(userProfileUrl))) {
        return sendApiError(res, 400, 'invalid_profile_image', 'รูปโปรไฟล์ไม่ถูกต้อง');
      }

      const now = new Date();
      const user = {
        user_id: `usernum_${crypto.randomUUID()}`,
        user_nick: nick,
        user_uniname: userUniname,
        user_profile_url: userProfileUrl,
        social_media: {
          facebook: '',
          instagram: ''
        },
        access_hkey: await hashAccessKey(accessKey),
        access_hkey_lookup: accessKeyLookup(accessKey),
        is_banned: false,
        readed_subroom: [],
        readed_privateroom: [],
        subroom_voted: [],
        reported_chat: [],
        reported_profile: [],
        created_at: now
      };

      try {
        await users.insertOne(user);
      } catch (error) {
        if (error.code === 11000) {
          return sendApiError(res, 409, 'nick_taken', 'ชื่อผู้ใช้นี้มีคนใช้ไปแล้วหรือ อุปกรณ์คุณไม่ได้ล็อกอินด้วยชื่อนี้มาก่อน');
        }

        throw error;
      }

      logTraffic({
        timestamp: now,
        req,
        userId: user.user_id,
        action: 'bind'
      });

      return res.status(201).json({
        status: 'success',
        user: publicUser(user)
      });
    }

    return sendApiError(res, 400, 'invalid_action', 'คำสั่งเข้าสู่ระบบไม่ถูกต้อง');
  } catch (error) {
    console.error('Login API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'ระบบเชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
});

app.patch('/api/me/profile-image', requireUser, async (req, res) => {
  const userProfileUrl = typeof req.body.user_profile_url === 'string' ? req.body.user_profile_url.trim() : '';

  try {
    if (!(await isValidProfileImageUrl(userProfileUrl))) {
      return sendApiError(res, 400, 'invalid_profile_image', 'รูปโปรไฟล์ไม่ถูกต้อง');
    }

    const users = await getUsersCollection();
    await users.updateOne(
      { user_id: req.user.user_id },
      { $set: { user_profile_url: userProfileUrl } }
    );

    const updatedUser = {
      ...req.user,
      user_profile_url: userProfileUrl
    };

    return res.json({
      status: 'success',
      user: publicUser(updatedUser)
    });
  } catch (error) {
    console.error('Update profile image API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'บันทึกรูปโปรไฟล์ไม่สำเร็จ');
  }
});

app.patch('/api/me/social-media', requireUser, async (req, res) => {
  const socialMedia = {
    facebook: normalizeSubmittedSocialUrl(req.body.facebook, 'facebook.com'),
    instagram: normalizeSubmittedSocialUrl(req.body.instagram, 'instagram.com')
  };

  try {
    if (socialMedia.facebook === null || socialMedia.instagram === null) {
      return sendApiError(res, 400, 'invalid_social_media', 'ลิงก์โซเชียลมีเดียไม่ถูกต้อง');
    }

    const users = await getUsersCollection();
    await users.updateOne(
      { user_id: req.user.user_id },
      { $set: { social_media: socialMedia } }
    );

    const updatedUser = {
      ...req.user,
      social_media: socialMedia
    };

    return res.json({
      status: 'success',
      user: publicUser(updatedUser)
    });
  } catch (error) {
    console.error('Update social media API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'บันทึกช่องทางโซเชียลมีเดียไม่สำเร็จ');
  }
});

app.delete('/api/me', requireUser, async (req, res) => {
  const userId = typeof req.body.user_id === 'string' ? req.body.user_id.trim() : '';

  if (!userId || userId !== req.user.user_id) {
    return sendApiError(res, 403, 'invalid_user_id', 'ไม่สามารถลบบัญชีนี้ได้');
  }

  try {
    const users = await getUsersCollection();
    const result = await users.deleteOne({ user_id: userId });

    if (!result.deletedCount) {
      return sendApiError(res, 404, 'user_not_found', 'ไม่พบบัญชีนี้ในระบบ');
    }

    logTraffic({
      timestamp: new Date(),
      req,
      userId,
      action: 'delete_acc'
    });

    return res.json({
      status: 'success',
      user_id: userId
    });
  } catch (error) {
    console.error('Delete account API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'ลบบัญชีไม่สำเร็จ');
  }
});

app.get('/api/universities', async (req, res) => {
  try {
    const files = await fs.promises.readdir(UNIVERSITY_LOGOS_DIR, { withFileTypes: true });
    const universities = files
      .filter(file => file.isFile() && IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase()))
      .map(file => {
        const ext = path.extname(file.name);
        const baseName = path.basename(file.name, ext);
        const orderMatch = baseName.match(/^(\d+)\./);
        const cleanName = baseName.replace(/^\d+\./, '');
        const shortNameMatch = cleanName.match(/_(.+)$/);
        const name = cleanName.replace(/_.+$/, '');
        const shortName = shortNameMatch ? shortNameMatch[1] : '';

        return {
          id: baseName,
          order: orderMatch ? Number(orderMatch[1]) : Number.MAX_SAFE_INTEGER,
          name,
          shortName,
          displayName: shortName ? `${name} [${shortName}]` : name,
          image: `${UNIVERSITY_LOGOS_URL_PREFIX}${encodeURIComponent(file.name)}`
        };
      })
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'th'))
      .map(({ order, ...university }) => university);

    res.json(universities);
  } catch (error) {
    console.error('Unable to read university logos:', error.message);
    res.status(500).json({ error: 'Unable to load universities' });
  }
});

app.get('/api/subrooms', requireUser, async (req, res) => {
  const uniroomName = normalizePlainText(req.query.uniroom_name, 160);

  if (!uniroomName) {
    return sendApiError(res, 400, 'invalid_university', 'กรุณาระบุชื่อมหาวิทยาลัย');
  }

  try {
    const universities = await getUniversitiesCollection();
    const university = await universities.findOne(
      { uniroom_name: uniroomName },
      { projection: { _id: 0, uniroom_id: 1, uniroom_name: 1 } }
    );

    if (!university) {
      return sendApiError(res, 404, 'university_not_found', 'ไม่พบมหาวิทยาลัยนี้ในระบบ');
    }

    const subroomUni = await getSubroomUniCollection();
    const subrooms = await subroomUni
      .find(
        {
          uniroom_id: university.uniroom_id,
          subroom_type: { $in: SUBROOM_TYPES }
        },
        {
          projection: {
            _id: 0,
            uniroom_id: 1,
            subroom_id: 1,
            subroom_name: 1,
            subroom_desc: 1,
            subroom_type: 1,
            expire_days: 1,
            created_at: 1
          }
        }
      )
      .sort({ created_at: 1, subroom_name: 1 })
      .toArray();
    const subroomsWithVotes = await attachTempVoteData(subrooms, req.user);

    return res.json({
      status: 'success',
      university: {
        ...university,
        online_count: getUniversityOnlineCount(university.uniroom_id)
      },
      subrooms: groupedSubrooms(subroomsWithVotes)
    });
  } catch (error) {
    console.error('Subroom list API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'ระบบเชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
});

app.post('/add-subroom', requireUser, async (req, res) => {
  const uniroomName = normalizePlainText(req.body.uniroom_name, 160);
  const subroomName = normalizeSubroomName(req.body.subroom_name);
  const subroomDesc = normalizeSubroomDesc(req.body.subroom_desc);
  const expireDays = Number(req.body.expire_days);

  if (!uniroomName) {
    return sendApiError(res, 400, 'invalid_university', 'กรุณาระบุชื่อมหาวิทยาลัย');
  }

  if (!subroomName) {
    return sendApiError(res, 400, 'invalid_subroom_name', 'กรุณากรอกชื่อห้อง');
  }

  if (!Number.isInteger(expireDays) || !ALLOWED_EXPIRE_DAYS.has(expireDays)) {
    return sendApiError(res, 400, 'invalid_expire_days', 'อายุห้องไม่ถูกต้อง');
  }

  try {
    const universities = await getUniversitiesCollection();
    const university = await universities.findOne(
      { uniroom_name: uniroomName },
      { projection: { _id: 0, uniroom_id: 1, uniroom_name: 1 } }
    );

    if (!university) {
      return sendApiError(res, 404, 'university_not_found', 'ไม่พบมหาวิทยาลัยนี้ในระบบ');
    }

    const createdAt = new Date();
    const expireAt = new Date(createdAt.getTime() + expireDays * 24 * 60 * 60 * 1000);
    const subroom = {
      uniroom_id: university.uniroom_id,
      subroom_id: `subroomnum_${crypto.randomUUID()}`,
      subroom_name: subroomName,
      subroom_desc: subroomDesc,
      subroom_type: 'temp',
      expire_days: expireAt,
      created_at: createdAt
    };

    const subroomUni = await getSubroomUniCollection();
    const subroomTempVotes = await getSubroomTempVotesCollection();
    await subroomUni.insertOne(subroom);

    try {
      await subroomTempVotes.insertOne({
        subroom_id: subroom.subroom_id,
        expire_days: expireAt,
        votes_count: 0
      });
    } catch (error) {
      await subroomUni.deleteOne({ subroom_id: subroom.subroom_id }).catch(() => {});
      throw error;
    }

    logTraffic({
      timestamp: createdAt,
      req,
      userId: req.user.user_id,
      action: 'add_subroom'
    });

    return res.status(201).json({
      status: 'success',
      subroom: publicSubroom({
        ...subroom,
        vote: publicTempVote({
          subroom_id: subroom.subroom_id,
          expire_days: expireAt,
          votes_count: 0
        }, req.user)
      })
    });
  } catch (error) {
    console.error('Add subroom API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'ระบบเชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
});

app.post('/api/subrooms/:subroomId/recommend', requireUser, async (req, res) => {
  const subroomId = normalizePlainText(req.params.subroomId, 120);

  if (!subroomId) {
    return sendApiError(res, 400, 'invalid_subroom', getPublicErrorMessage({ code: 'invalid_subroom' }));
  }

  try {
    const subroomUni = await getSubroomUniCollection();
    const subroom = await subroomUni.findOne(
      {
        subroom_id: subroomId,
        subroom_type: { $in: SUBROOM_TYPES }
      },
      {
        projection: {
          _id: 0,
          uniroom_id: 1,
          subroom_id: 1,
          subroom_name: 1,
          subroom_desc: 1,
          subroom_type: 1,
          expire_days: 1,
          created_at: 1
        }
      }
    );

    if (!subroom) {
      return sendApiError(res, 404, 'invalid_subroom', getPublicErrorMessage({ code: 'invalid_subroom' }));
    }

    if (subroom.subroom_type !== 'temp') {
      return sendApiError(res, 400, 'invalid_vote_subroom', getPublicErrorMessage({ code: 'invalid_vote_subroom' }));
    }

    if (getRemainingDays(subroom.expire_days) <= 0) {
      return sendApiError(res, 400, 'vote_expired', getPublicErrorMessage({ code: 'vote_expired' }));
    }

    const votes = await getSubroomTempVotesCollection();
    await votes.updateOne(
      { subroom_id: subroom.subroom_id },
      {
        $setOnInsert: {
          subroom_id: subroom.subroom_id,
          expire_days: subroom.expire_days,
          votes_count: 0
        }
      },
      { upsert: true }
    );

    const users = await getUsersCollection();
    const userVoteUpdate = await users.updateOne(
      {
        user_id: req.user.user_id,
        subroom_voted: { $ne: subroom.subroom_id }
      },
      {
        $addToSet: { subroom_voted: subroom.subroom_id }
      }
    );

    if (!userVoteUpdate.modifiedCount) {
      return sendApiError(res, 409, 'already_voted', getPublicErrorMessage({ code: 'already_voted' }));
    }

    const updatedVote = await votes.findOneAndUpdate(
      {
        subroom_id: subroom.subroom_id,
        votes_count: { $lt: SUBROOM_TEMP_VOTE_TOTAL }
      },
      {
        $inc: { votes_count: 1 }
      },
      {
        returnDocument: 'after',
        projection: { _id: 0, subroom_id: 1, expire_days: 1, votes_count: 1 }
      }
    );

    const updatedVoteDocument = findOneAndUpdateDocument(updatedVote);

    if (!updatedVoteDocument) {
      await users.updateOne(
        { user_id: req.user.user_id },
        { $pull: { subroom_voted: subroom.subroom_id } }
      );
      return sendApiError(res, 409, 'vote_closed', getPublicErrorMessage({ code: 'vote_closed' }));
    }

    const updatedUser = {
      ...req.user,
      subroom_voted: Array.from(new Set([
        ...(Array.isArray(req.user.subroom_voted) ? req.user.subroom_voted : []),
        subroom.subroom_id
      ]))
    };
    let promoted = false;

    if (Number(updatedVoteDocument.votes_count) === SUBROOM_TEMP_VOTE_TOTAL) {
      const promoteResult = await subroomUni.updateOne(
        {
          subroom_id: subroom.subroom_id,
          subroom_type: 'temp'
        },
        {
          $set: { subroom_type: 'community' }
        }
      );
      promoted = Boolean(promoteResult.modifiedCount);
      if (promoted) {
        await votes.deleteOne({ subroom_id: subroom.subroom_id });
      }
    }

    return res.json({
      status: 'success',
      promoted,
      subroom: publicSubroom({
        ...subroom,
        subroom_type: promoted ? 'community' : subroom.subroom_type,
        vote: promoted ? null : publicTempVote(updatedVoteDocument, updatedUser)
      }),
      vote: promoted ? null : publicTempVote(updatedVoteDocument, updatedUser)
    });
  } catch (error) {
    console.error('Recommend subroom API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'โหวตห้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
});

app.post('/api/cleanup-expire-room', async (req, res) => {
  try {
    const now = new Date();
    const subroomUni = await getSubroomUniCollection();
    const expiredSubrooms = await subroomUni
      .find(
        {
          subroom_type: 'temp',
          expire_days: { $lte: now }
        },
        {
          projection: {
            _id: 0,
            subroom_id: 1,
            subroom_name: 1,
            uniroom_id: 1,
            expire_days: 1
          }
        }
      )
      .toArray();

    if (!expiredSubrooms.length) {
      return res.json({
        status: 'success',
        message: 'No expired subrooms found',
        deleted_count: 0,
        deleted_subrooms: [],
        timestamp: now.toISOString()
      });
    }

    const expiredIds = expiredSubrooms.map(room => room.subroom_id);

    const subroomTempVotes = await getSubroomTempVotesCollection();
    const publicChat = await getPublicChatCollection();
    const users = await getUsersCollection();

    await Promise.all([
      subroomUni.deleteMany({ subroom_id: { $in: expiredIds } }),
      subroomTempVotes.deleteMany({ subroom_id: { $in: expiredIds } }),
      publicChat.deleteMany({ subroom_id: { $in: expiredIds } }),
      users.updateMany(
        {
          $or: [
            { readed_subroom: { $in: expiredIds } },
            { subroom_voted: { $in: expiredIds } }
          ]
        },
        {
          $pull: {
            readed_subroom: { $in: expiredIds },
            subroom_voted: { $in: expiredIds }
          }
        }
      )
    ]);

    for (const id of expiredIds) {
      presenceBySubroom.delete(id);
    }

    return res.json({
      status: 'success',
      message: 'Cleanup completed successfully',
      deleted_count: expiredSubrooms.length,
      deleted_subrooms: expiredSubrooms,
      timestamp: now.toISOString()
    });
  } catch (error) {
    console.error('Cleanup expire room API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'การลบห้องที่หมดอายุเกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
  }
});

app.post('/api/public-chat/messages', requireUser, async (req, res) => {
  const subroomId = normalizePlainText(req.body.subroom_id, 120);
  const before = req.body.before ? new Date(req.body.before) : null;
  const limit = Math.min(Math.max(Number(req.body.limit) || MESSAGE_PAGE_SIZE, 1), MESSAGE_PAGE_SIZE);

  try {
    const subroom = await getValidSubroom(subroomId);
    if (!subroom) {
      return sendApiError(res, 404, 'invalid_subroom', getPublicErrorMessage({ code: 'invalid_subroom' }));
    }

    const [subroomWithVote] = await attachTempVoteData([subroom], req.user);

    const query = { subroom_id: subroom.subroom_id };
    if (before && !Number.isNaN(before.getTime())) {
      query.created_at = { $lt: before };
    }

    const publicChat = await getPublicChatCollection();
    const messages = await publicChat
      .find(query, {
        projection: {
          _id: 0,
          chat_id: 1,
          subroom_id: 1,
          user_owner_id: 1,
          message: 1,
          attachment_url: 1,
          created_at: 1
        }
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    const usersById = await getUsersByIds(messages.map(message => message.user_owner_id));
    const orderedMessages = messages
      .reverse()
      .map(message => formatMessageForResponse(message, usersById));

    return res.json({
      status: 'success',
      subroom: publicSubroom(subroomWithVote),
      messages: orderedMessages,
      has_more: messages.length === limit
    });
  } catch (error) {
    console.error('Load public chat messages error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'โหลดข้อความไม่สำเร็จ');
  }
});

app.post('/api/public-chat/attachments', requireUser, createUploadMiddleware, async (req, res) => {
  const subroomId = normalizePlainText(req.body.subroom_id, 120);

  try {
    const subroom = await getValidSubroom(subroomId);
    if (!subroom) {
      return sendApiError(res, 404, 'invalid_subroom', getPublicErrorMessage({ code: 'invalid_subroom' }));
    }

    if (!req.file || !req.file.buffer || !req.file.size) {
      return sendApiError(res, 400, 'invalid_attachment', getPublicErrorMessage({ code: 'invalid_attachment' }));
    }

    if (req.file.size > MAX_ATTACHMENT_SIZE) {
      return sendApiError(res, 413, 'attachment_too_large', getPublicErrorMessage({ code: 'attachment_too_large' }));
    }

    const ext = getSafeAttachmentExtension(req.file);
    const chatId = `chatnum_${crypto.randomUUID()}`;
    const fileName = `attach_${chatId}${ext}`;
    const targetPath = path.join(CHAT_ATTACHMENT_DIR, fileName);
    const resolvedTargetPath = path.resolve(targetPath);
    const resolvedDir = path.resolve(CHAT_ATTACHMENT_DIR);

    if (!resolvedTargetPath.startsWith(resolvedDir + path.sep)) {
      return sendApiError(res, 400, 'invalid_attachment', getPublicErrorMessage({ code: 'invalid_attachment' }));
    }

    await ensureAttachmentDirectory();
    await fs.promises.writeFile(resolvedTargetPath, req.file.buffer, { flag: 'wx' });

    const attachmentUrl = `${CHAT_ATTACHMENT_URL_PREFIX}${fileName}`;
    pendingAttachments.set(attachmentUrl, {
      chat_id: chatId,
      user_id: req.user.user_id,
      subroom_id: subroom.subroom_id,
      attachment_url: attachmentUrl,
      created_at: Date.now(),
      used: false
    });

    return res.status(201).json({
      status: 'success',
      chat_id: chatId,
      attachment_url: attachmentUrl
    });
  } catch (error) {
    console.error('Upload public chat attachment error:', error.code || error.message);
    return sendApiError(res, error.statusCode || 500, error.code || 'server_error', getPublicErrorMessage(error));
  }
});

app.post('/api/universities/request', async (req, res) => {
  const universityName      = normalizePlainText(req.body.university_name, 200);
  const universityShortName = normalizePlainText(req.body.university_short_name, 50);
  const province            = normalizePlainText(req.body.province, 100);
  const websiteUrl          = normalizePlainText(req.body.website_url, 500);

  if (!universityName) {
    return sendApiError(res, 400, 'missing_university_name', 'กรุณากรอกชื่อมหาวิทยาลัย');
  }

  try {
    const collection = await getUniversitiesRequestCollection();
    await collection.insertOne({
      university_name: universityName,
      university_short_name: universityShortName,
      province,
      website_url: websiteUrl,
      created_at: new Date()
    });
    return res.status(201).json({ status: 'success' });
  } catch (error) {
    console.error('Universities request API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
});

app.post('/api/reports', requireUser, async (req, res) => {
  const targetType = normalizePlainText(req.body.target_type, 20);
  const rawReasonType = normalizePlainText(req.body.reason_type, 100);
  const otherReason = normalizePlainText(req.body.other_reason, 200);

  if (targetType !== 'chat' && targetType !== 'profile') {
    return sendApiError(res, 400, 'invalid_target_type', 'ประเภทการรายงานไม่ถูกต้อง');
  }

  if (!rawReasonType) {
    return sendApiError(res, 400, 'missing_reason', 'กรุณาระบุเหตุผลการรายงาน');
  }

  let resolvedReasonType = rawReasonType;
  if (rawReasonType === 'อื่นๆ') {
    resolvedReasonType = otherReason ? `อื่นๆ: ${otherReason}` : 'อื่นๆ';
  }

  try {
    const reportsCollection = await getInChatReportCollection();
    const usersCollection = await getUsersCollection();

    const userReportedChat = Array.isArray(req.user.reported_chat) ? req.user.reported_chat : [];
    const userReportedProfile = Array.isArray(req.user.reported_profile) ? req.user.reported_profile : [];

    if (targetType === 'chat') {
      const chatId = normalizePlainText(req.body.chat_id, 100);
      if (!chatId) {
        return sendApiError(res, 400, 'missing_chat_id', 'กรุณาระบุข้อความที่ต้องการรายงาน');
      }

      if (userReportedChat.includes(chatId)) {
        return sendApiError(res, 409, 'already_reported', 'คุณได้รายงานข้อความนี้ไปแล้ว');
      }

      const publicChat = await getPublicChatCollection();
      const chatDoc = await publicChat.findOne({ chat_id: chatId });
      if (!chatDoc) {
        return sendApiError(res, 404, 'chat_not_found', 'ไม่พบข้อความที่ต้องการรายงาน');
      }

      if (chatDoc.user_owner_id === req.user.user_id) {
        return sendApiError(res, 400, 'cannot_report_self', 'ไม่สามารถรายงานข้อความของตนเองได้');
      }

      const targetUser = await usersCollection.findOne({ user_id: chatDoc.user_owner_id });
      if (!targetUser) {
        return sendApiError(res, 404, 'user_not_found', 'ไม่พบผู้ใช้ที่ต้องการรายงาน');
      }

      const reportId = `rep_${crypto.randomUUID()}`;
      const reportDoc = {
        report_id: reportId,
        reporter_user_id: req.user.user_id,
        target_type: 'chat',
        chat_id: chatDoc.chat_id,
        subroom_id: chatDoc.subroom_id || null,
        user_information: sanitizeUserForReport(targetUser),
        report_reasoning: {
          type: resolvedReasonType,
          message: chatDoc.message || ''
        },
        created_at: new Date()
      };

      await reportsCollection.insertOne(reportDoc);
      await usersCollection.updateOne(
        { user_id: req.user.user_id },
        { $addToSet: { reported_chat: chatDoc.chat_id } }
      );

      const updatedReportedChat = Array.from(new Set([...userReportedChat, chatDoc.chat_id]));

      return res.status(201).json({
        status: 'success',
        report_id: reportId,
        reported_chat: updatedReportedChat,
        reported_profile: userReportedProfile
      });
    }

    // targetType === 'profile'
    const targetUserId = normalizePlainText(req.body.target_user_id, 100);
    if (!targetUserId) {
      return sendApiError(res, 400, 'missing_target_user_id', 'กรุณาระบุผู้ใช้ที่ต้องการรายงาน');
    }

    if (targetUserId === req.user.user_id) {
      return sendApiError(res, 400, 'cannot_report_self', 'ไม่สามารถรายงานตนเองได้');
    }

    if (userReportedProfile.includes(targetUserId)) {
      return sendApiError(res, 409, 'already_reported', 'คุณได้รายงานผู้ใช้นี้ไปแล้ว');
    }

    const targetUser = await usersCollection.findOne({ user_id: targetUserId });
    if (!targetUser) {
      return sendApiError(res, 404, 'user_not_found', 'ไม่พบผู้ใช้ที่ต้องการรายงาน');
    }

    const reportId = `rep_${crypto.randomUUID()}`;
    const reportDoc = {
      report_id: reportId,
      reporter_user_id: req.user.user_id,
      target_type: 'profile',
      chat_id: null,
      subroom_id: null,
      user_information: sanitizeUserForReport(targetUser),
      report_reasoning: {
        type: resolvedReasonType
      },
      created_at: new Date()
    };

    await reportsCollection.insertOne(reportDoc);
    await usersCollection.updateOne(
      { user_id: req.user.user_id },
      { $addToSet: { reported_profile: targetUserId } }
    );

    const updatedReportedProfile = Array.from(new Set([...userReportedProfile, targetUserId]));

    return res.status(201).json({
      status: 'success',
      report_id: reportId,
      reported_chat: userReportedChat,
      reported_profile: updatedReportedProfile
    });
  } catch (error) {
    console.error('Report API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'ส่งรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
});

app.get('/api/profile-images', async (req, res) => {
  try {
    const files = await fs.promises.readdir(USER_PROFILE_IMAGES_DIR, { withFileTypes: true });
    const profileImages = files
      .filter(file => file.isFile() && IMAGE_EXTENSIONS.has(path.extname(file.name).toLowerCase()))
      .map(file => {
        const ext = path.extname(file.name);
        const baseName = path.basename(file.name, ext);
        const displayName = baseName.replace(/[-_]+/g, ' ').trim();

        return {
          id: baseName,
          fileName: file.name,
          name: displayName || baseName,
          src: `assets/sim_db/users_profile_image/${encodeURIComponent(file.name)}`
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));

    res.json(profileImages);
  } catch (error) {
    console.error('Unable to read profile images:', error.message);
    res.status(500).json({ error: 'Unable to load profile images' });
  }
});

app.use((req, res) => {
  res.status(404)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send('<h1>404 - Page not found</h1>');
});


const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  sockets.add(ws);
  ws.clientIp = req ? getClientIp(req) : '127.0.0.1';
  ws.userAgent = req?.headers ? (req.headers['user-agent'] || '') : '';
  ws.authenticated = false;
  ws.authTimer = setTimeout(() => {
    if (!ws.authenticated) {
      const error = new Error('Authentication timeout.');
      error.code = 'permission_denied';
      handleWsError(ws, error);
      ws.close(4001, 'Authentication timeout');
    }
  }, WS_AUTH_TIMEOUT_MS);

  ws.on('message', async (raw) => {
    try {
      await handleWsMessage(ws, raw);
    } catch (error) {
      handleWsError(ws, error);
      if (error.code === 'permission_denied' || error.code === 'banned' || error.code === 'invalid_access_hkey') {
        ws.close(4001, error.message || 'Authentication failed');
      }
    }
  });

  ws.on('close', () => {
    if (ws.authTimer) {
      clearTimeout(ws.authTimer);
      ws.authTimer = null;
    }
    sockets.delete(ws);
    removeSocketPresence(ws);
  });
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws/public-chat') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

setInterval(cleanupPresence, JOINED_PING_MS).unref();
setInterval(() => {
  apiLimiter.cleanup();
  wsLimiter.cleanup();
}, RATE_LIMITER_CLEANUP_INTERVAL_MS).unref();
setInterval(() => {
  const cutoff = Date.now() - PENDING_ATTACHMENT_TTL_MS;
  for (const [attachmentUrl, attachment] of pendingAttachments) {
    if (attachment.used || attachment.created_at < cutoff) {
      pendingAttachments.delete(attachmentUrl);
    }
  }
}, PENDING_ATTACHMENT_CLEANUP_INTERVAL_MS).unref();

server.listen(PORT, () => {
  console.log(`Server is running at http://<all-interfaces>:${PORT}`);
});

const gracefulShutdown = async (signal) => {
  console.log(`Received ${signal}, flushing logs and closing server...`);
  try {
    await logQueue.shutdown();
  } catch (err) {
    console.error('Error during logQueue shutdown:', err.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
