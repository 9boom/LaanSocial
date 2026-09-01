const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { WebSocket, WebSocketServer } = require('ws');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.warn('Unable to load .env:', error.message);
  }
}

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 80;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'LaanDBDevelopment';
const USERS_COLLECTION = 'users';
const UNIVERSITIES_COLLECTION = 'universities';
const SUBROOM_UNI_COLLECTION = 'subroom_uni';
const PUBLIC_CHAT_COLLECTION = 'public_chat';
const UNIVERSITY_LOGOS_DIR = path.join(__dirname, 'public', 'assets', 'sim_db', 'universities_logos');
const USER_PROFILE_IMAGES_DIR = path.join(__dirname, 'public', 'assets', 'sim_db', 'users_profile_image');
const CHAT_ATTACHMENT_DIR = path.join(__dirname, 'public', 'assets', 'sim_db', 'users_chat_attachment');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
const ATTACHMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf']);
const ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf'
]);
const PROFILE_IMAGE_URL_PREFIX = 'assets/sim_db/users_profile_image/';
const CHAT_ATTACHMENT_URL_PREFIX = 'assets/sim_db/users_chat_attachment/';
const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_PAGE_SIZE = 10;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const PRESENCE_TTL_MS = 2 * 60 * 1000;
const JOINED_PING_MS = 60 * 1000;
const SUBROOM_TYPES = ['official', 'community', 'temp'];
const ALLOWED_EXPIRE_DAYS = new Set([1, 3, 7, 14, 30]);
const scryptAsync = promisify(crypto.scrypt);

let mongoClientPromise = null;
let usersCollectionPromise = null;
let publicChatCollectionPromise = null;
let subroomUniCollectionPromise = null;
const pendingAttachments = new Map();
const sockets = new Set();
const presenceBySubroom = new Map();

app.use(express.json({ limit: '256kb' }));

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

function normalizePlainText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, maxLength);
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
    is_banned: Boolean(user.is_banned),
    readed_subroom: Array.isArray(user.readed_subroom) ? user.readed_subroom : [],
    readed_privateroom: Array.isArray(user.readed_privateroom) ? user.readed_privateroom : [],
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
    error.statusCode = 401;
    error.code = 'missing_access_hkey';
    throw error;
  }

  const users = await getUsersCollection();
  const lookup = accessKeyLookup(normalizedAccessKey);
  let user = await users.findOne({ access_hkey_lookup: lookup });

  if (!user) {
    const legacyCandidates = await users
      .find({ access_hkey_lookup: { $exists: false } })
      .project({ access_hkey: 1, user_id: 1, user_nick: 1, user_uniname: 1, user_profile_url: 1, is_banned: 1, created_at: 1, readed_subroom: 1, readed_privateroom: 1 })
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
    error.code = 'invalid_access_hkey';
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
  if (error.code === 'missing_access_hkey' || error.code === 'invalid_access_hkey') return 'กรุณาเข้าสู่ระบบใหม่';
  if (error.code === 'banned') return 'บัญชีนี้ถูกระงับการใช้งาน';
  if (error.code === 'invalid_subroom') return 'ไม่พบห้องนี้ในระบบ';
  if (error.code === 'invalid_message') return 'ข้อความไม่ถูกต้อง';
  if (error.code === 'invalid_attachment') return 'ไฟล์แนบไม่ถูกต้อง';
  if (error.code === 'attachment_too_large') return 'ไฟล์แนบมีขนาดใหญ่เกินไป';
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
    channel_count: getSubroomOnlineCount(subroom.subroom_id)
  };
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
    .project({ _id: 0, user_id: 1, user_nick: 1, user_uniname: 1, user_profile_url: 1 })
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
    uniroom_id: subroom.uniroom_id,
    subroom_id: subroom.subroom_id,
    last_seen_at: Date.now()
  });
}

async function saveAndBroadcastMessage(ws, contentObj) {
  const user = await resolveUserFromAccessKey(contentObj.access_hkey);
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

  const payload = {
    event: 'message',
    content_obj: publicChatMessage(document, user)
  };
  safeSend(ws, payload);
  broadcastToSubroom(subroom.subroom_id, payload, ws);
}

async function handleJoinedPing(ws, contentObj) {
  const user = await resolveUserFromAccessKey(contentObj.access_hkey);
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
  const user = await resolveUserFromAccessKey(contentObj.access_hkey);
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

app.get('/api/info', (req, res) => {
  res.json({
    status: 'success',
    message: 'Connected'
  });
});

app.post('/login', async (req, res) => {
  const action = typeof req.body.action === 'string' ? req.body.action : '';

  try {
    const users = await getUsersCollection();

    if (action === 'check') {
      const nick = normalizeNick(req.body.nick);
      if (!nick) return sendApiError(res, 400, 'invalid_nick', 'กรุณากรอกชื่อเล่นหรือนามแฝง');

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

      return res.json({
        status: 'success',
        user: publicUser(user)
      });
    }

    if (action === 'create') {
      const nick = normalizeNick(req.body.nick);
      const userUniname = typeof req.body.user_uniname === 'string' ? req.body.user_uniname.trim() : '';
      const userProfileUrl = typeof req.body.user_profile_url === 'string' ? req.body.user_profile_url.trim() : '';
      const accessKey = normalizeAccessKey(req.body.access_hkey);

      if (!nick) return sendApiError(res, 400, 'invalid_nick', 'กรุณากรอกชื่อเล่นหรือนามแฝง');
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
        access_hkey: await hashAccessKey(accessKey),
        access_hkey_lookup: accessKeyLookup(accessKey),
        is_banned: false,
        readed_subroom: [],
        readed_privateroom: [],
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

app.get('/api/user/:user_id/profile', async (req, res) => {
  const userId = typeof req.params.user_id === 'string' ? req.params.user_id.trim() : '';

  if (!userId) {
    return sendApiError(res, 400, 'invalid_user_id', 'ไม่ระบุรหัสผู้ใช้');
  }

  try {
    const users = await getUsersCollection();
    const user = await users.findOne(
      { user_id: userId },
      { projection: { user_id: 1, user_nick: 1, user_uniname: 1, user_profile_url: 1, created_at: 1, is_banned: 1 } }
    );

    if (!user) {
      return sendApiError(res, 404, 'user_not_found', 'ไม่พบข้อมูลผู้ใช้');
    }

    return res.json({
      status: 'success',
      user: {
        user_id: user.user_id,
        user_nick: user.user_nick,
        user_uniname: user.user_uniname,
        user_profile_url: user.user_profile_url,
        created_at: user.created_at,
        is_banned: Boolean(user.is_banned)
      }
    });
  } catch (error) {
    console.error('User profile API error:', error.message);
    return sendApiError(res, 500, 'server_error', 'ระบบเชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
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
          image: `assets/sim_db/universities_logos/${encodeURIComponent(file.name)}`
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

    return res.json({
      status: 'success',
      university: {
        ...university,
        online_count: getUniversityOnlineCount(university.uniroom_id)
      },
      subrooms: groupedSubrooms(subrooms)
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
    await subroomUni.insertOne(subroom);

    return res.status(201).json({
      status: 'success',
      subroom: publicSubroom(subroom)
    });
  } catch (error) {
    console.error('Add subroom API error:', error.code || error.message);
    return sendApiError(res, 500, 'server_error', 'ระบบเชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
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
      subroom: publicSubroom(subroom),
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
  res.status(404).send('<h1>404 - Page not found</h1>');
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  sockets.add(ws);

  ws.on('message', async (raw) => {
    try {
      await handleWsMessage(ws, raw);
    } catch (error) {
      handleWsError(ws, error);
    }
  });

  ws.on('close', () => {
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
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [attachmentUrl, attachment] of pendingAttachments) {
    if (attachment.used || attachment.created_at < cutoff) {
      pendingAttachments.delete(attachmentUrl);
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Server is running at http://<all-interfaces>:${PORT}`);
});
