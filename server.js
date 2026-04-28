const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const { OAuth2Client } = require("google-auth-library");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

function loadDotEnvFile() {
  const candidateFiles = [".env", "server_token.env"];
  const loadedFiles = [];
  candidateFiles.forEach((fileName) => {
    const envPath = path.join(__dirname, fileName);
    if (!fsSync.existsSync(envPath)) return;
    loadedFiles.push(fileName);
    const raw = fsSync.readFileSync(envPath, "utf-8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const sep = trimmed.indexOf("=");
      if (sep < 0) return;
      const key = trimmed.slice(0, sep).trim();
      let value = trimmed.slice(sep + 1).trim();
      // Tolerate accidental duplicated assignment like:
      // MONGODB_URI=MONGODB_URI=mongodb+srv://...
      if (value.startsWith(key + "=")) {
        value = value.slice((key + "=").length).trim();
      }
      if (!key || process.env[key] != null) return;
      process.env[key] = value;
    });
  });
  return loadedFiles;
}

const LOADED_ENV_FILES = loadDotEnvFile();

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = "nordhaven_sid";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
function normalizeMongoUri(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  // Tolerate provider env values like:
  // MONGODB_URI=mongodb+srv://...
  if (raw.startsWith("MONGODB_URI=")) {
    return raw.slice("MONGODB_URI=".length).trim();
  }
  return raw;
}
const MONGODB_URI = normalizeMongoUri(process.env.MONGODB_URI);
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "nordhaven";
const ADMIN_GOOGLE_EMAILS = new Set(
  String(process.env.ADMIN_GOOGLE_EMAILS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
);

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const CHAT_PATH = path.join(DATA_DIR, "chat-messages.json");
const GUILDS_PATH = path.join(DATA_DIR, "guilds.json");
const EDITOR_CONFIG_PATH = path.join(DATA_DIR, "editor-config.json");
const EDITOR_STORAGE_KEYS = [
  "nordhaven-editor-weapons-v1",
  "nordhaven-editor-items-v1",
  "nordhaven-editor-spells-v1",
  "nordhaven-editor-armors-v1",
  "nordhaven-editor-race-icons-v1",
  "nordhaven-editor-races-extra-v1",
  "nordhaven-editor-nav-icons-v1",
  "nordhaven-editor-skills-theme-v1",
  "nordhaven-editor-skills-v1",
  "nordhaven-editor-cursors-v1",
  "nordhaven-editor-sounds-v1",
  "nordhaven-editor-village-art-v1",
  "nordhaven-editor-monsters-v1",
  "nordhaven-editor-quests-v1"
];

const sessions = new Map();
const googleClient = new OAuth2Client();
let db = null;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());
app.use(express.static(ROOT_DIR));

function usersCol() {
  return db.collection("users");
}
function guildsCol() {
  return db.collection("guilds");
}
function chatCol() {
  return db.collection("chatMessages");
}
function editorConfigCol() {
  return db.collection("editorConfig");
}

function sanitizeText(value, maxLen) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLen);
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(USERS_PATH);
  } catch (_) {
    await fs.writeFile(USERS_PATH, "[]", "utf-8");
  }
  try {
    await fs.access(CHAT_PATH);
  } catch (_) {
    await fs.writeFile(CHAT_PATH, "[]", "utf-8");
  }
  try {
    await fs.access(EDITOR_CONFIG_PATH);
  } catch (_) {
    await fs.writeFile(EDITOR_CONFIG_PATH, JSON.stringify({ data: {}, updatedAt: Date.now() }, null, 2), "utf-8");
  }
  try {
    await fs.access(GUILDS_PATH);
  } catch (_) {
    await fs.writeFile(GUILDS_PATH, "[]", "utf-8");
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

async function connectMongo() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI manquant");
  }
  const uriPrefix = String(MONGODB_URI).split("://")[0] || "(none)";
  const hasMongoScheme = MONGODB_URI.startsWith("mongodb://") || MONGODB_URI.startsWith("mongodb+srv://");
  console.log(
    "[startup] env files found:",
    LOADED_ENV_FILES.length ? LOADED_ENV_FILES.join(", ") : "none"
  );
  console.log(
    "[startup] mongo env check:",
    JSON.stringify({
      hasMongoUri: Boolean(MONGODB_URI),
      uriPrefix,
      hasValidScheme: hasMongoScheme,
      dbName: MONGODB_DB_NAME || "(empty)"
    })
  );
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(MONGODB_DB_NAME);
  await usersCol().createIndex({ id: 1 }, { unique: true });
  await usersCol().createIndex({ googleId: 1 }, { unique: true });
  await guildsCol().createIndex({ id: 1 }, { unique: true });
  await guildsCol().createIndex({ nameLower: 1 }, { unique: true });
  await chatCol().createIndex({ id: 1 }, { unique: true });
  await chatCol().createIndex({ createdAt: -1 });
}

async function migrateJsonToMongoIfNeeded() {
  const usersCount = await usersCol().estimatedDocumentCount();
  const guildsCount = await guildsCol().estimatedDocumentCount();
  const chatCount = await chatCol().estimatedDocumentCount();
  const editorCount = await editorConfigCol().estimatedDocumentCount();
  const shouldMigrate = usersCount === 0 && guildsCount === 0 && chatCount === 0 && editorCount === 0;
  if (!shouldMigrate) return;

  const users = await readJson(USERS_PATH, []);
  const guilds = await readJson(GUILDS_PATH, []);
  const chatMessages = await readJson(CHAT_PATH, []);
  const editorConfig = await readJson(EDITOR_CONFIG_PATH, { data: {}, updatedAt: Date.now() });

  for (const user of Array.isArray(users) ? users : []) {
    if (!user || !user.id) continue;
    const doc = { ...user, id: String(user.id) };
    await usersCol().updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
  }
  for (const guild of Array.isArray(guilds) ? guilds : []) {
    if (!guild || !guild.id) continue;
    const name = sanitizeText(guild.name || "", 32);
    const doc = {
      ...guild,
      id: String(guild.id),
      name,
      nameLower: name.toLowerCase(),
      memberUserIds: Array.isArray(guild.memberUserIds) ? guild.memberUserIds.map((x) => String(x)) : []
    };
    await guildsCol().updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
  }
  for (const msg of Array.isArray(chatMessages) ? chatMessages : []) {
    if (!msg || !msg.id) continue;
    const doc = {
      ...msg,
      id: String(msg.id),
      userId: sanitizeText(msg.userId || "", 64),
      name: sanitizeText(msg.name || "", 40),
      guildName: sanitizeText(msg.guildName || "", 40),
      avatarUrl: sanitizeText(msg.avatarUrl || "", 500),
      text: sanitizeText(msg.text || "", 220),
      createdAt: Number(msg.createdAt) || Date.now()
    };
    await chatCol().updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
  }
  await editorConfigCol().updateOne(
    { id: "main" },
    {
      $set: {
        id: "main",
        data: sanitizeEditorConfigPayload(editorConfig && editorConfig.data),
        updatedAt: Number(editorConfig && editorConfig.updatedAt) || Date.now()
      }
    },
    { upsert: true }
  );
  console.log("Mongo migration imported JSON seed data.");
}

function issueSession(res, userId) {
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, { userId, createdAt: Date.now() });
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  });
}

function destroySession(req, res) {
  const sid = req.cookies[SESSION_COOKIE];
  if (sid) sessions.delete(sid);
  res.clearCookie(SESSION_COOKIE);
}

function getSessionUserId(req) {
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  return session.userId;
}

async function getUserById(id) {
  if (!id) return null;
  return usersCol().findOne({ id: String(id) });
}

async function upsertGoogleUser(googlePayload) {
  const googleId = String(googlePayload.sub || "");
  if (!googleId) throw new Error("Token Google invalide");
  const now = Date.now();
  const existing = await usersCol().findOne({ googleId });
  if (!existing) {
    const user = {
      id: crypto.randomBytes(12).toString("hex"),
      googleId,
      email: sanitizeText(googlePayload.email || "", 120),
      name: sanitizeText(googlePayload.name || "Joueur", 40) || "Joueur",
      avatarUrl: sanitizeText(googlePayload.picture || "", 500),
      createdAt: now,
      updatedAt: now
    };
    await usersCol().insertOne(user);
    return user;
  }
  await usersCol().updateOne(
    { id: existing.id },
    {
      $set: {
        email: sanitizeText(googlePayload.email || existing.email || "", 120),
        name: sanitizeText(googlePayload.name || existing.name || "Joueur", 40) || "Joueur",
        avatarUrl: sanitizeText(googlePayload.picture || existing.avatarUrl || "", 500),
        updatedAt: now
      }
    }
  );
  return usersCol().findOne({ id: existing.id });
}

async function getGuildNameForUser(userId) {
  if (!userId) return "";
  const user = await getUserById(userId);
  if (!user || !user.guildId) return "";
  const guild = await guildsCol().findOne({ id: String(user.guildId) });
  return guild ? sanitizeText(guild.name, 40) : "";
}

async function appendChatMessage(user, text, characterName) {
  const cleanText = sanitizeText(text, 220);
  if (!cleanText) return null;
  const cleanCharacterName = sanitizeText(characterName, 40);
  const displayName = cleanCharacterName || sanitizeText(user.name, 40) || "Joueur";
  const guildName = await getGuildNameForUser(user.id);
  const payload = {
    id: crypto.randomBytes(10).toString("hex"),
    userId: user.id,
    name: displayName,
    guildName,
    avatarUrl: sanitizeText(user.avatarUrl || "", 500),
    text: cleanText,
    createdAt: Date.now()
  };
  await chatCol().insertOne(payload);
  const total = await chatCol().estimatedDocumentCount();
  if (total > 240) {
    const old = await chatCol().find({}).sort({ createdAt: 1 }).limit(total - 200).project({ id: 1 }).toArray();
    if (old.length) {
      await chatCol().deleteMany({ id: { $in: old.map((x) => x.id) } });
    }
  }
  return payload;
}

async function getChatMessages(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 80, 200));
  const messages = await chatCol().find({}).sort({ createdAt: -1 }).limit(safeLimit).toArray();
  return messages.reverse();
}

function cookieToSid(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(";");
  for (const p of parts) {
    const chunk = p.trim();
    if (chunk.startsWith(SESSION_COOKIE + "=")) return chunk.slice((SESSION_COOKIE + "=").length);
  }
  return null;
}

function publicUser(user) {
  const rating = Math.max(100, Math.floor(Number(user && user.arenaRating) || 1000));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    hasCharacter: !!(user && user.character),
    guildId: user && user.guildId ? user.guildId : null,
    arenaRating: rating
  };
}

function getArenaStats(user) {
  return {
    rating: Math.max(100, Math.floor(Number(user && user.arenaRating) || 1000)),
    wins: Math.max(0, Math.floor(Number(user && user.arenaWins) || 0)),
    losses: Math.max(0, Math.floor(Number(user && user.arenaLosses) || 0))
  };
}

function snapshotPower(snapshot) {
  const s = snapshot && snapshot.stats ? snapshot.stats : {};
  const v = Math.max(0, Number(s.vitalite) || 0);
  const i = Math.max(0, Number(s.intelligence) || 0);
  const e = Math.max(0, Number(s.endurance) || 0);
  const atkMin = Math.max(0, Number(s.attackMin) || 0);
  const atkMax = Math.max(0, Number(s.attackMax) || 0);
  const def = Math.max(0, Number(s.defense) || 0);
  return v * 1.2 + i * 1.1 + e * 1.1 + atkMin * 1.8 + atkMax * 1.5 + def * 1.3;
}

function expectedScore(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

function buildPublicProfileFromUser(user) {
  if (!user) return null;
  const character = user.character && typeof user.character === "object" ? user.character : null;
  const snap = user.profileSnapshot && typeof user.profileSnapshot === "object" ? user.profileSnapshot : null;
  const stats = snap && snap.stats && typeof snap.stats === "object" ? snap.stats : {};
  const stuff = snap && snap.stuff && typeof snap.stuff === "object" ? snap.stuff : {};
  return {
    userId: user.id,
    playerName: sanitizeText((character && character.name) || user.name || "Joueur", 40) || "Joueur",
    level: Math.max(1, Math.floor(Number((snap && snap.level) || 1) || 1)),
    iconUrl: sanitizeText((snap && snap.iconUrl) || user.avatarUrl || "", 500),
    raceId: sanitizeText((character && character.raceId) || "", 32),
    classId: sanitizeText((character && character.classId) || "", 24),
    stats: {
      vitalite: Math.max(0, Math.floor(Number(stats.vitalite) || 0)),
      intelligence: Math.max(0, Math.floor(Number(stats.intelligence) || 0)),
      endurance: Math.max(0, Math.floor(Number(stats.endurance) || 0)),
      attackMin: Math.max(0, Math.floor(Number(stats.attackMin) || 0)),
      attackMax: Math.max(0, Math.floor(Number(stats.attackMax) || 0)),
      defense: Math.max(0, Math.floor(Number(stats.defense) || 0))
    },
    stuff: {
      weapon: sanitizeText(stuff.weapon || "", 60),
      armor: sanitizeText(stuff.armor || "", 60),
      necklace: sanitizeText(stuff.necklace || "", 60)
    },
    updatedAt: Number((snap && snap.updatedAt) || user.updatedAt || Date.now()) || Date.now()
  };
}

function sanitizeCharacterPayload(raw) {
  const name = sanitizeText(raw && raw.name, 24);
  const raceId = String(raw && raw.raceId ? raw.raceId : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 32);
  const classId = String(raw && raw.classId ? raw.classId : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 24);
  if (!name || !raceId || !classId) return null;
  return { name, raceId, classId };
}

async function getAuthenticatedUser(req) {
  const userId = getSessionUserId(req);
  if (!userId) return null;
  return getUserById(userId);
}

async function requireAdmin(req, res, next) {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Authentification requise" });
  const email = String(user.email || "").trim().toLowerCase();
  if (!email || !ADMIN_GOOGLE_EMAILS.has(email)) return res.status(403).json({ error: "Acces admin refuse" });
  req.adminUser = user;
  return next();
}

function sanitizeEditorConfigPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  const out = {};
  for (const key of EDITOR_STORAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const value = payload[key];
    if (value == null) continue;
    if (typeof value === "object") out[key] = value;
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

async function readEditorConfig() {
  const raw = await editorConfigCol().findOne({ id: "main" });
  const cleanData = sanitizeEditorConfigPayload(raw && raw.data);
  return {
    data: cleanData,
    updatedAt: Number(raw && raw.updatedAt) || Date.now()
  };
}

app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  res.send("window.__GOOGLE_CLIENT_ID__ = " + JSON.stringify(GOOGLE_CLIENT_ID) + ";");
});

app.post("/api/auth/google", async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: "GOOGLE_CLIENT_ID manquant cote serveur" });
    const idToken = String(req.body && req.body.idToken ? req.body.idToken : "");
    if (!idToken) return res.status(400).json({ error: "idToken manquant" });
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload) return res.status(401).json({ error: "Token Google invalide" });
    const user = await upsertGoogleUser(payload);
    issueSession(res, user.id);
    return res.json({ user: publicUser(user) });
  } catch (_) {
    return res.status(401).json({ error: "Connexion Google refusee" });
  }
});

app.get("/api/me", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.json({ user: null });
  return res.json({ user: publicUser(user) });
});

app.get("/api/character", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Authentification requise" });
  return res.json({ character: user.character || null });
});

app.post("/api/character", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Authentification requise" });
  if (user.character) return res.status(409).json({ error: "Ce compte Google possede deja un personnage" });
  const payload = sanitizeCharacterPayload(req.body);
  if (!payload) return res.status(400).json({ error: "Personnage invalide" });
  const character = { name: payload.name, raceId: payload.raceId, classId: payload.classId, createdAt: Date.now() };
  await usersCol().updateOne({ id: user.id }, { $set: { character, updatedAt: Date.now() } });
  return res.status(201).json({ character });
});

app.delete("/api/character", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Authentification requise" });

  if (user.guildId) {
    const guild = await guildsCol().findOne({ id: user.guildId });
    if (guild) {
      const newMembers = (Array.isArray(guild.memberUserIds) ? guild.memberUserIds : []).filter((x) => x !== user.id);
      if (newMembers.length === 0) {
        await guildsCol().deleteOne({ id: guild.id });
      } else {
        const newChief = guild.chiefUserId === user.id ? newMembers[0] : guild.chiefUserId;
        await guildsCol().updateOne(
          { id: guild.id },
          { $set: { memberUserIds: newMembers, chiefUserId: newChief, updatedAt: Date.now() } }
        );
      }
    }
  }

  await usersCol().updateOne(
    { id: user.id },
    {
      $unset: { character: "", profileSnapshot: "", guildId: "", arenaRating: "", arenaWins: "", arenaLosses: "" },
      $set: { updatedAt: Date.now() }
    }
  );
  return res.json({ ok: true });
});

app.post("/api/profile/snapshot", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const stats = body.stats && typeof body.stats === "object" ? body.stats : {};
  const stuff = body.stuff && typeof body.stuff === "object" ? body.stuff : {};
  const profileSnapshot = {
    level: Math.max(1, Math.floor(Number(body.level) || 1)),
    iconUrl: sanitizeText(body.iconUrl || "", 500),
    stats: {
      vitalite: Math.max(0, Math.floor(Number(stats.vitalite) || 0)),
      intelligence: Math.max(0, Math.floor(Number(stats.intelligence) || 0)),
      endurance: Math.max(0, Math.floor(Number(stats.endurance) || 0)),
      attackMin: Math.max(0, Math.floor(Number(stats.attackMin) || 0)),
      attackMax: Math.max(0, Math.floor(Number(stats.attackMax) || 0)),
      defense: Math.max(0, Math.floor(Number(stats.defense) || 0))
    },
    stuff: {
      weapon: sanitizeText(stuff.weapon || "", 60),
      armor: sanitizeText(stuff.armor || "", 60),
      necklace: sanitizeText(stuff.necklace || "", 60)
    },
    updatedAt: Date.now()
  };
  await usersCol().updateOne({ id: user.id }, { $set: { profileSnapshot, updatedAt: Date.now() } });
  return res.json({ ok: true });
});

app.get("/api/profile/:userId", async (req, res) => {
  const userId = sanitizeText(req.params && req.params.userId, 48);
  if (!userId) return res.status(400).json({ error: "Utilisateur invalide" });
  const user = await getUserById(userId);
  if (!user) return res.status(404).json({ error: "Profil introuvable" });
  return res.json({ profile: buildPublicProfileFromUser(user) });
});

app.get("/api/guild/me", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Authentification requise" });
  if (!user.guildId) return res.json({ guild: null, role: null });
  const guild = await guildsCol().findOne({ id: user.guildId });
  if (!guild) return res.json({ guild: null, role: null });
  const members = [];
  for (const uid of Array.isArray(guild.memberUserIds) ? guild.memberUserIds : []) {
    const u = await usersCol().findOne({ id: uid }, { projection: { id: 1, name: 1, character: 1 } });
    members.push({
      userId: uid,
      name: sanitizeText((u && u.character && u.character.name) || (u && u.name) || "Joueur", 40),
      role: guild.chiefUserId === uid ? "chief" : "member"
    });
  }
  const role = guild.chiefUserId === user.id ? "chief" : "member";
  return res.json({ guild: { id: guild.id, name: guild.name, members }, role });
});

app.post("/api/guild/create", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Authentification requise" });
  const name = sanitizeText(req.body && req.body.name, 32);
  if (!name || name.length < 3) return res.status(400).json({ error: "Nom de guilde invalide" });
  if (user.guildId) return res.status(409).json({ error: "Tu es deja dans une guilde" });
  const nameLower = name.toLowerCase();
  const exists = await guildsCol().findOne({ nameLower });
  if (exists) return res.status(409).json({ error: "Ce nom de guilde existe deja" });

  const now = Date.now();
  const guild = {
    id: crypto.randomBytes(10).toString("hex"),
    name,
    nameLower,
    chiefUserId: user.id,
    memberUserIds: [user.id],
    createdAt: now,
    updatedAt: now
  };
  await guildsCol().insertOne(guild);
  await usersCol().updateOne({ id: user.id }, { $set: { guildId: guild.id, updatedAt: now } });
  return res.status(201).json({ guild: { id: guild.id, name: guild.name }, role: "chief" });
});

app.post("/api/guild/join", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Authentification requise" });
  const name = sanitizeText(req.body && req.body.name, 32);
  if (!name || name.length < 3) return res.status(400).json({ error: "Nom de guilde invalide" });
  if (user.guildId) return res.status(409).json({ error: "Tu es deja dans une guilde" });
  const guild = await guildsCol().findOne({ nameLower: name.toLowerCase() });
  if (!guild) return res.status(404).json({ error: "Guilde introuvable" });
  await guildsCol().updateOne({ id: guild.id }, { $addToSet: { memberUserIds: user.id }, $set: { updatedAt: Date.now() } });
  await usersCol().updateOne({ id: user.id }, { $set: { guildId: guild.id, updatedAt: Date.now() } });
  return res.json({ guild: { id: guild.id, name: guild.name }, role: guild.chiefUserId === user.id ? "chief" : "member" });
});

app.post("/api/logout", (req, res) => {
  destroySession(req, res);
  return res.json({ ok: true });
});

app.get("/api/chat/messages", async (req, res) => {
  const messages = await getChatMessages(req.query.limit);
  return res.json({ messages });
});

app.get("/api/arena/leaderboard", async (_req, res) => {
  const users = await usersCol().find({ character: { $exists: true, $ne: null } }).toArray();
  const rows = users
    .map((u) => {
      const arena = getArenaStats(u);
      return {
        userId: u.id,
        name: sanitizeText((u.character && u.character.name) || u.name || "Joueur", 40),
        rating: arena.rating,
        wins: arena.wins,
        losses: arena.losses
      };
    })
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 25);
  return res.json({ players: rows });
});

app.post("/api/arena/fight", async (req, res) => {
  const me = await getAuthenticatedUser(req);
  if (!me) return res.status(401).json({ error: "Authentification requise" });
  if (!me.character) return res.status(400).json({ error: "Personnage requis" });
  const targetUserId = sanitizeText(req.body && req.body.targetUserId, 64);
  if (!targetUserId) return res.status(400).json({ error: "Cible invalide" });
  if (targetUserId === me.id) return res.status(400).json({ error: "Impossible de se battre contre soi-meme" });

  const target = await getUserById(targetUserId);
  if (!target) return res.status(404).json({ error: "Joueur introuvable" });
  if (!target.character) return res.status(400).json({ error: "La cible n'a pas de personnage" });
  const meArena = getArenaStats(me);
  const tArena = getArenaStats(target);
  const mePow = snapshotPower(me.profileSnapshot);
  const tPow = snapshotPower(target.profileSnapshot);
  const meScoreBase = meArena.rating + mePow * 3;
  const tScoreBase = tArena.rating + tPow * 3;
  const expectedMe = expectedScore(meScoreBase, tScoreBase);
  const meWins = Math.random() < expectedMe;
  const K = 24;
  const meNew = Math.round(meArena.rating + K * ((meWins ? 1 : 0) - expectedMe));
  const tNew = Math.round(tArena.rating + K * ((meWins ? 0 : 1) - (1 - expectedMe)));
  const meAfter = Math.max(100, meNew);
  const targetAfter = Math.max(100, tNew);

  await usersCol().updateOne(
    { id: me.id },
    {
      $set: { arenaRating: meAfter, updatedAt: Date.now() },
      $inc: { arenaWins: meWins ? 1 : 0, arenaLosses: meWins ? 0 : 1 }
    }
  );
  await usersCol().updateOne(
    { id: target.id },
    {
      $set: { arenaRating: targetAfter, updatedAt: Date.now() },
      $inc: { arenaWins: meWins ? 0 : 1, arenaLosses: meWins ? 1 : 0 }
    }
  );

  return res.json({
    result: meWins ? "win" : "loss",
    me: {
      name: sanitizeText((me.character && me.character.name) || me.name || "Toi", 40),
      ratingBefore: meArena.rating,
      ratingAfter: meAfter
    },
    enemy: {
      name: sanitizeText((target.character && target.character.name) || target.name || "Adversaire", 40),
      ratingBefore: tArena.rating,
      ratingAfter: targetAfter
    }
  });
});

app.get("/api/editor-config", async (_req, res) => {
  try {
    const config = await readEditorConfig();
    return res.json(config);
  } catch (_) {
    return res.status(500).json({ error: "Impossible de lire la configuration editeur" });
  }
});

app.post("/api/editor-config", async (req, res) => {
  try {
    const previous = await readEditorConfig();
    const incoming = sanitizeEditorConfigPayload(req.body && req.body.data);
    const merged = {
      data: { ...previous.data, ...incoming },
      updatedAt: Date.now()
    };
    await editorConfigCol().updateOne({ id: "main" }, { $set: { id: "main", ...merged } }, { upsert: true });
    return res.json({ ok: true, updatedAt: merged.updatedAt });
  } catch (_) {
    return res.status(500).json({ error: "Impossible d'enregistrer la configuration editeur" });
  }
});

app.get("/api/admin/me", async (req, res) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.json({ admin: false });
  const email = String(user.email || "").trim().toLowerCase();
  return res.json({ admin: ADMIN_GOOGLE_EMAILS.has(email), user: publicUser(user) });
});

app.get("/api/admin/characters", requireAdmin, async (_req, res) => {
  const users = await usersCol().find({ character: { $exists: true, $ne: null } }).sort({ updatedAt: -1 }).limit(500).toArray();
  const characters = users.map((u) => ({
    userId: u.id,
    playerName: sanitizeText((u.character && u.character.name) || u.name || "Joueur", 40),
    raceId: sanitizeText((u.character && u.character.raceId) || "", 32),
    classId: sanitizeText((u.character && u.character.classId) || "", 24),
    guildId: u.guildId || null,
    updatedAt: Number(u.updatedAt) || 0
  }));
  return res.json({ characters });
});

app.delete("/api/admin/characters/:userId", requireAdmin, async (req, res) => {
  const userId = sanitizeText(req.params && req.params.userId, 64);
  if (!userId) return res.status(400).json({ error: "Utilisateur invalide" });
  const user = await getUserById(userId);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

  if (user.guildId) {
    const guild = await guildsCol().findOne({ id: user.guildId });
    if (guild) {
      const newMembers = (Array.isArray(guild.memberUserIds) ? guild.memberUserIds : []).filter((x) => x !== userId);
      if (newMembers.length === 0) {
        await guildsCol().deleteOne({ id: guild.id });
      } else {
        const newChief = guild.chiefUserId === userId ? newMembers[0] : guild.chiefUserId;
        await guildsCol().updateOne(
          { id: guild.id },
          { $set: { memberUserIds: newMembers, chiefUserId: newChief, updatedAt: Date.now() } }
        );
      }
    }
  }

  await usersCol().updateOne(
    { id: userId },
    {
      $unset: { character: "", profileSnapshot: "", guildId: "", arenaRating: "", arenaWins: "", arenaLosses: "" },
      $set: { updatedAt: Date.now() }
    }
  );
  return res.json({ ok: true });
});

app.get("/api/admin/guilds", requireAdmin, async (_req, res) => {
  const guilds = await guildsCol().find({}).sort({ updatedAt: -1 }).limit(500).toArray();
  return res.json({
    guilds: guilds.map((g) => ({
      id: g.id,
      name: g.name,
      chiefUserId: g.chiefUserId || null,
      memberCount: Array.isArray(g.memberUserIds) ? g.memberUserIds.length : 0,
      updatedAt: Number(g.updatedAt) || 0
    }))
  });
});

app.delete("/api/admin/guilds/:guildId", requireAdmin, async (req, res) => {
  const guildId = sanitizeText(req.params && req.params.guildId, 64);
  if (!guildId) return res.status(400).json({ error: "Guilde invalide" });
  const guild = await guildsCol().findOne({ id: guildId });
  if (!guild) return res.status(404).json({ error: "Guilde introuvable" });
  await guildsCol().deleteOne({ id: guildId });
  await usersCol().updateMany({ guildId }, { $unset: { guildId: "" }, $set: { updatedAt: Date.now() } });
  return res.json({ ok: true });
});

app.get("/api/admin/chat/messages", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 500));
  const messages = await chatCol().find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  return res.json({ messages });
});

app.delete("/api/admin/chat/messages/:messageId", requireAdmin, async (req, res) => {
  const messageId = sanitizeText(req.params && req.params.messageId, 64);
  if (!messageId) return res.status(400).json({ error: "Message invalide" });
  const result = await chatCol().deleteOne({ id: messageId });
  if (!result.deletedCount) return res.status(404).json({ error: "Message introuvable" });
  return res.json({ ok: true });
});

io.use(async (socket, next) => {
  try {
    const sid = cookieToSid(socket.handshake.headers.cookie || "");
    if (!sid) {
      socket.data.user = null;
      return next();
    }
    const session = sessions.get(sid);
    if (!session) {
      socket.data.user = null;
      return next();
    }
    socket.data.user = (await getUserById(session.userId)) || null;
    return next();
  } catch (error) {
    return next(error);
  }
});

io.on("connection", (socket) => {
  socket.on("chat:send", async (payload) => {
    try {
      const user = socket.data.user;
      if (!user) return;
      const msg = await appendChatMessage(user, payload && payload.text, payload && payload.characterName);
      if (!msg) return;
      io.emit("chat:message", msg);
    } catch (_) {}
  });
});

async function boot() {
  await ensureDataFiles();
  await connectMongo();
  await migrateJsonToMongoIfNeeded();
  server.listen(PORT, () => {
    console.log("Nordhaven server running on http://localhost:" + PORT);
  });
}

boot().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
