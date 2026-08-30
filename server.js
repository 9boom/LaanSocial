const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { MongoClient } = require('mongodb');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.warn('Unable to load .env:', error.message);
  }
}

const app = express();
const PORT = process.env.PORT || 80;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'LaanDBDevelopment';
const USERS_COLLECTION = 'users';
const UNIVERSITY_LOGOS_DIR = path.join(__dirname, 'public', 'assets', 'sim_db', 'universities_logos');
const USER_PROFILE_IMAGES_DIR = path.join(__dirname, 'public', 'assets', 'sim_db', 'users_profile_image');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
const PROFILE_IMAGE_URL_PREFIX = 'assets/sim_db/users_profile_image/';
const scryptAsync = promisify(crypto.scrypt);
let mongoClientPromise = null;
let usersCollectionPromise = null;

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html']
}));

function normalizeNick(nick) {
  return typeof nick === 'string' ? nick.trim() : '';
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

async function getUsersCollection() {
  if (!usersCollectionPromise) {
    usersCollectionPromise = (async () => {
      const client = await getMongoClient();
      const collection = client.db(DB_NAME).collection(USERS_COLLECTION);

      await Promise.all([
        collection.createIndex({ user_nick: 1 }, { unique: true }),
        collection.createIndex({ user_id: 1 }, { unique: true })
      ]);

      return collection;
    })().catch((error) => {
      usersCollectionPromise = null;
      throw error;
    });
  }

  return usersCollectionPromise;
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

function sendLoginError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    status: 'error',
    code,
    message
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
      if (!nick) return sendLoginError(res, 400, 'invalid_nick', 'กรุณากรอกชื่อเล่นหรือนามแฝง');

      const user = await users.findOne(
        { user_nick: nick },
        { projection: { user_id: 1, is_banned: 1 } }
      );

      if (!user) return res.json({ status: 'not_found' });
      if (user.is_banned) return sendLoginError(res, 403, 'banned', 'บัญชีนี้ถูกระงับการใช้งาน');

      return res.json({
        status: 'found',
        user_id: user.user_id
      });
    }

    if (action === 'verify') {
      const userId = typeof req.body.user_id === 'string' ? req.body.user_id.trim() : '';
      const accessKey = typeof req.body.access_hkey === 'string' ? req.body.access_hkey : '';
      const nick = normalizeNick(req.body.nick);

      if (!userId || !accessKey) {
        return sendLoginError(res, 400, 'invalid_credentials', 'ข้อมูลเข้าสู่ระบบไม่ครบถ้วน');
      }

      const user = await users.findOne({ user_id: userId });
      if (!user || (nick && user.user_nick !== nick)) {
        return sendLoginError(res, 403, 'invalid_credentials', 'คุณไม่มีสิทธิ์ใช้งานชื่อนี้');
      }

      if (user.is_banned) return sendLoginError(res, 403, 'banned', 'บัญชีนี้ถูกระงับการใช้งาน');

      const isMatch = await verifyAccessKey(accessKey, user.access_hkey);
      if (!isMatch) return sendLoginError(res, 403, 'invalid_credentials', 'คุณไม่มีสิทธิ์ใช้งานชื่อนี้');

      return res.json({
        status: 'success',
        user: publicUser(user)
      });
    }

    if (action === 'create') {
      const nick = normalizeNick(req.body.nick);
      const userUniname = typeof req.body.user_uniname === 'string' ? req.body.user_uniname.trim() : '';
      const userProfileUrl = typeof req.body.user_profile_url === 'string' ? req.body.user_profile_url.trim() : '';
      const accessKey = typeof req.body.access_hkey === 'string' ? req.body.access_hkey : '';

      if (!nick) return sendLoginError(res, 400, 'invalid_nick', 'กรุณากรอกชื่อเล่นหรือนามแฝง');
      if (!userUniname) return sendLoginError(res, 400, 'invalid_university', 'กรุณาเลือกมหาวิทยาลัย');
      if (!accessKey) return sendLoginError(res, 400, 'invalid_access_key', 'ไม่สามารถสร้างรหัสเข้าสู่ระบบได้');
      if (!(await isValidProfileImageUrl(userProfileUrl))) {
        return sendLoginError(res, 400, 'invalid_profile_image', 'รูปโปรไฟล์ไม่ถูกต้อง');
      }

      const now = new Date();
      const user = {
        user_id: `usernum_${crypto.randomUUID()}`,
        user_nick: nick,
        user_uniname: userUniname,
        user_profile_url: userProfileUrl,
        access_hkey: await hashAccessKey(accessKey),
        is_banned: false,
        readed_subroom: [],
        readed_privateroom: [],
        created_at: now
      };

      try {
        await users.insertOne(user);
      } catch (error) {
        if (error.code === 11000) {
          return sendLoginError(res, 409, 'nick_taken', 'ชื่อผู้ใช้นี้มีคนใช้ไปแล้วหรือ อุปกรณ์คุณไม่ได้ล็อกอินด้วยชื่อนี้มาก่อน');
        }

        throw error;
      }

      return res.status(201).json({
        status: 'success',
        user: publicUser(user)
      });
    }

    return sendLoginError(res, 400, 'invalid_action', 'คำสั่งเข้าสู่ระบบไม่ถูกต้อง');
  } catch (error) {
    console.error('Login API error:', error);
    return sendLoginError(res, 500, 'server_error', 'ระบบเชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
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
    console.error('Unable to read university logos:', error);
    res.status(500).json({ error: 'Unable to load universities' });
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
    console.error('Unable to read profile images:', error);
    res.status(500).json({ error: 'Unable to load profile images' });
  }
});

app.use((req, res) => {
  res.status(404).send('<h1>404 - Page not found</h1>');
});

app.listen(PORT, () => {
  console.log(`Server is running at http://<all-interfaces>:${PORT}`);
}); 
