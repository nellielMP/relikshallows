const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const { OAuth2Client } = require("google-auth-library");
const { Server } = require("socket.io");

function loadDotEnvFile() {
  const candidateFiles = [".env", "server_token.env"];

  candidateFiles.forEach((fileName) => {
    const envPath = path.join(__dirname, fileName);
    if (!fsSync.existsSync(envPath)) return;

    const raw = fsSync.readFileSync(envPath, "utf-8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const sep = trimmed.indexOf("=");
      if (sep < 0) return;
      const key = trimmed.slice(0, sep).trim();
      const value = trimmed.slice(sep + 1).trim();
      if (!key || process.env[key] != null) return;
      process.env[key] = value;
    });
  });
}

loadDotEnvFile();

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = "nordhaven_sid";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const CHAT_PATH = path.join(DATA_DIR, "chat-messages.json");
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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static(ROOT_DIR));

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
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
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
  const users = await readJson(USERS_PATH, []);
  return users.find((u) => u.id === id) || null;
}

async function upsertGoogleUser(googlePayload) {
  const users = await readJson(USERS_PATH, []);
  const googleId = String(googlePayload.sub || "");
  if (!googleId) throw new Error("Token Google invalide");

  const now = Date.now();
  let user = users.find((u) => u.googleId === googleId);
  if (!user) {
    user = {
      id: crypto.randomBytes(12).toString("hex"),
      googleId,
      email: sanitizeText(googlePayload.email || "", 120),
      name: sanitizeText(googlePayload.name || "Joueur", 40) || "Joueur",
      avatarUrl: sanitizeText(googlePayload.picture || "", 500),
      createdAt: now,
      updatedAt: now
    };
    users.push(user);
  } else {
    user.email = sanitizeText(googlePayload.email || user.email || "", 120);
    user.name = sanitizeText(googlePayload.name || user.name || "Joueur", 40) || "Joueur";
    user.avatarUrl = sanitizeText(googlePayload.picture || user.avatarUrl || "", 500);
    user.updatedAt = now;
  }

  await writeJson(USERS_PATH, users);
  return user;
}

async function appendChatMessage(user, text) {
  const cleanText = sanitizeText(text, 220);
  if (!cleanText) return null;

  const messages = await readJson(CHAT_PATH, []);
  const payload = {
    id: crypto.randomBytes(10).toString("hex"),
    userId: user.id,
    name: sanitizeText(user.name, 40) || "Joueur",
    text: cleanText,
    createdAt: Date.now()
  };
  messages.push(payload);
  const trimmed = messages.slice(-200);
  await writeJson(CHAT_PATH, trimmed);
  return payload;
}

async function getChatMessages(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 80, 200));
  const messages = await readJson(CHAT_PATH, []);
  return messages.slice(-safeLimit);
}

function cookieToSid(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(";");
  for (const p of parts) {
    const chunk = p.trim();
    if (chunk.startsWith(SESSION_COOKIE + "=")) {
      return chunk.slice((SESSION_COOKIE + "=").length);
    }
  }
  return null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl
  };
}

function sanitizeEditorConfigPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  const out = {};
  for (const key of EDITOR_STORAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const value = payload[key];
    if (value == null) continue;
    if (typeof value === "object") {
      out[key] = value;
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

async function readEditorConfig() {
  const raw = await readJson(EDITOR_CONFIG_PATH, { data: {}, updatedAt: Date.now() });
  const cleanData = sanitizeEditorConfigPayload(raw && raw.data);
  return {
    data: cleanData,
    updatedAt: Number(raw && raw.updatedAt) || Date.now()
  };
}

app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  const payload = "window.__GOOGLE_CLIENT_ID__ = " + JSON.stringify(GOOGLE_CLIENT_ID) + ";";
  res.send(payload);
});

app.post("/api/auth/google", async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: "GOOGLE_CLIENT_ID manquant cote serveur" });
    }
    const idToken = String(req.body && req.body.idToken ? req.body.idToken : "");
    if (!idToken) {
      return res.status(400).json({ error: "idToken manquant" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({ error: "Token Google invalide" });
    }

    const user = await upsertGoogleUser(payload);
    issueSession(res, user.id);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return res.status(401).json({ error: "Connexion Google refusee" });
  }
});

app.get("/api/me", async (req, res) => {
  const userId = getSessionUserId(req);
  if (!userId) return res.json({ user: null });
  const user = await getUserById(userId);
  if (!user) return res.json({ user: null });
  return res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  destroySession(req, res);
  return res.json({ ok: true });
});

app.get("/api/chat/messages", async (req, res) => {
  const messages = await getChatMessages(req.query.limit);
  return res.json({ messages });
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
    await writeJson(EDITOR_CONFIG_PATH, merged);
    return res.json({ ok: true, updatedAt: merged.updatedAt });
  } catch (_) {
    return res.status(500).json({ error: "Impossible d'enregistrer la configuration editeur" });
  }
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
    const user = await getUserById(session.userId);
    socket.data.user = user || null;
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
      const msg = await appendChatMessage(user, payload && payload.text);
      if (!msg) return;
      io.emit("chat:message", msg);
    } catch (_) {
      // Ignore transient errors
    }
  });
});

ensureDataFiles()
  .then(() => {
    server.listen(PORT, () => {
      console.log("Nordhaven server running on http://localhost:" + PORT);
    });
  })
  .catch((error) => {
    console.error("Server startup failed:", error);
    process.exit(1);
  });
