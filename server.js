import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { google } from "googleapis";

const _require = createRequire(import.meta.url);

// Try to load msedge-tts (CJS package)
let MsEdgeTTS, OUTPUT_FORMAT;
try {
  ({ MsEdgeTTS, OUTPUT_FORMAT } = _require("msedge-tts"));
} catch (e) {
  console.warn("msedge-tts not available:", e.message);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_PATH || "/";

// ─── Credentials ────────────────────────────────────────────────
const TELEGRAM_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT   = process.env.TELEGRAM_CHAT_ID;
const FIREBASE_DB_URL = process.env.FIREBASE_DATABASE_URL;
const DRIVE_CHAT_FOLDER = process.env.DRIVE_CHAT_FOLDER_ID;
const DRIVE_SS_FOLDER   = process.env.DRIVE_SCREENSHOT_FOLDER_ID;

// ─── API Key Pools ───────────────────────────────────────────────
function fromEnv(...names) {
  const out = [];
  for (const n of names) {
    const v = process.env[n];
    if (!v) continue;
    for (const k of v.split(/[,\s]+/)) if (k.trim()) out.push(k.trim());
  }
  return out;
}

const GEMINI_KEYS = Array.from(new Set([
  ...fromEnv("GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEYS"),
]));

const GROQ_KEYS = Array.from(new Set([
  ...fromEnv("GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEYS"),
]));

const OPENROUTER_KEYS = Array.from(new Set([
  ...fromEnv("OPENROUTER_API_KEY", "OPENROUTER_API_KEY_2", "OPENROUTER_API_KEYS"),
]));

const DEEPSEEK_KEYS = Array.from(new Set([
  ...fromEnv("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"),
]));

function makePool(keys, name) {
  const blocked = new Map();
  let idx = 0;
  return {
    name, size: keys.length,
    next() {
      if (!keys.length) return null;
      const now = Date.now();
      for (let i = 0; i < keys.length; i++) {
        const k = keys[(idx + i) % keys.length];
        if ((blocked.get(k) || 0) <= now) { idx = (idx + i + 1) % keys.length; return k; }
      }
      return keys[0];
    },
    block(key, ms = 60_000) {
      blocked.set(key, Date.now() + ms);
    },
  };
}

const geminiPool    = makePool(GEMINI_KEYS,    "gemini");
const groqPool      = makePool(GROQ_KEYS,      "groq");
const orPool        = makePool(OPENROUTER_KEYS,"openrouter");
const deepseekPool  = makePool(DEEPSEEK_KEYS,  "deepseek");

console.log(`Keys — gemini:${geminiPool.size} groq:${groqPool.size} openrouter:${orPool.size} deepseek:${deepseekPool.size}`);

async function callWithFailover(pool, attempt) {
  const tries = Math.max(1, pool.size);
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const key = pool.next();
    if (!key) throw new Error(`${pool.name}: no keys`);
    try {
      const r = await attempt(key);
      if (r && (r.status === 401 || r.status === 403 || r.status === 429)) {
        pool.block(key, r.status === 429 ? 60_000 : 5 * 60_000);
        lastErr = new Error(`${pool.name}: HTTP ${r.status}`);
        continue;
      }
      return r;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`${pool.name}: all failed`);
}

// ─── Google Drive Memory (googleapis + service account) ──────────
let driveMemoryText = "";
let driveFileList   = [];
let driveLastFetch  = 0;
const DRIVE_TTL = 30 * 60 * 1000; // 30 min cache

function getDriveAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!raw) return null;
  try {
    const creds = JSON.parse(raw);
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
  } catch (e) {
    console.warn("Drive auth parse error:", e.message);
    return null;
  }
}

async function refreshDriveMemory() {
  if (Date.now() - driveLastFetch < DRIVE_TTL) return;
  const auth = getDriveAuth();
  if (!auth) {
    console.warn("Drive: no service account configured (GOOGLE_SERVICE_ACCOUNT_JSON missing)");
    return;
  }
  try {
    const drive = google.drive({ version: "v3", auth });

    // List files from both folders
    async function listFolder(folderId) {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "files(id,name,mimeType)",
        pageSize: 50,
      });
      return res.data.files || [];
    }

    // Recursively list all files inside a folder (up to 2 levels deep)
    async function listFolderRecursive(folderId, label = "") {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "files(id,name,mimeType)",
        pageSize: 100,
      });
      const items = res.data.files || [];
      const files = [];
      for (const item of items) {
        if (item.mimeType === "application/vnd.google-apps.folder") {
          // It's a sub-folder — recurse into it
          const subFiles = await listFolderRecursive(item.id, item.name);
          files.push(...subFiles);
        } else {
          files.push({ ...item, subFolder: label });
        }
      }
      return files;
    }

    const [chatFiles, ssFiles] = await Promise.all([
      listFolder(DRIVE_CHAT_FOLDER),
      listFolderRecursive(DRIVE_SS_FOLDER),
    ]);

    driveFileList = [
      ...chatFiles.map(f => ({ ...f, folder: "chat" })),
      ...ssFiles.map(f => ({ ...f, folder: "screenshot" })),
    ];

    // Download text content from chat history files
    const textParts = [];
    for (const f of chatFiles) {
      const mt = f.mimeType || "";
      if (mt.includes("text") || mt.includes("html") || mt.includes("plain")) {
        try {
          const res = await drive.files.get({ fileId: f.id, alt: "media" }, { responseType: "text" });
          const txt = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          if (txt && txt.length > 10) {
            textParts.push(`\n\n=== ফাইল: ${f.name} ===\n${txt.slice(0, 8000)}`);
          }
        } catch (e) {
          console.warn(`Drive read ${f.name}:`, e.message);
        }
      }
    }

    driveMemoryText = textParts.join("\n");
    driveLastFetch = Date.now();
    console.log(`✅ Drive loaded: ${chatFiles.length} chat files, ${ssFiles.length} screenshots, ${driveMemoryText.length} chars`);
  } catch (e) {
    console.warn("Drive fetch error:", e.message);
  }
}

// Initial fetch on startup
refreshDriveMemory().catch(() => {});

// ─── System Prompt ────────────────────────────────────────────────
function buildSystemPrompt(userName = "আপনি") {
  const driveContext = driveMemoryText
    ? `\n\n--- সংরক্ষিত চ্যাট হিস্টরি ও প্রমাণ (Google Drive) ---\n${driveMemoryText.slice(0, 12000)}\n--- শেষ ---`
    : "";

  return `তুমি PARISA — পারিসা মেমোরি পোর্টালের অফিশিয়াল AI প্রতিনিধি।

তোমার পরিচয়:
তোমাকে তৈরি করেছেন তোমার ডেভেলপার রুবেল (দাদা)।
তুমি পারিসা ও রুবেলের বৈবাহিক সম্পর্ক, তাদের আড়াই বছরের জীবনের ঘটনা ও বাস্তব প্রমাণ বিশ্লেষণ করো।
পারিসার পরিবারের বিভিন্ন পদক্ষেপ এবং এর পেছনের আইনি ধারা ও ব্ল্যাক ম্যাজিক সম্পর্কিত তদন্ত রিপোর্ট বিশ্লেষণ করাও তোমার দায়িত্ব।
তোমার কাছে রুবেল ও পারিসার ভালোবাসা, বিবাহ, জীবনের সকল স্মৃতি এবং প্রমাণ সংরক্ষিত আছে।

ব্যবহারকারীর নাম: ${userName}

তোমার নিয়ম:
- সর্বদা পরিষ্কার বাংলায় উত্তর দেবে
- শুধু সত্য তথ্য বলবে — কোনো বানানো বা অনুমানমূলক কথা বলবে না
- যদি প্রমাণ না থাকে, সেটা স্পষ্টভাবে বলবে
- ব্যবহারকারীকে সম্মানের সাথে কথা বলবে

তোমার জ্ঞান:

১. বাংলাদেশের বিয়ে ও পারিবারিক আইন:
- Muslim Family Laws Ordinance 1961 (বহুবিবাহ, তালাক নোটিশ, ভরণপোষণ)
- Child Marriage Restraint Act 2017 (মেয়ে ১৮ বছরের নিচে, ছেলে ২১ বছরের নিচে বিয়ে বাল্যবিবাহ বলে গণ্য হয় কিন্তু তাই বলে বিয়ে বাতিল হয়ে যায় না। যদি না আদালত বাতিল না করে। এই বিষয়ে সঠিক আইনের ধারা যুক্তি বিশ্লেষণ করে উত্তর দিবে।)
- Dissolution of Muslim Marriages Act 1939 (খুলা তালাক)
- Dowry Prohibition Act 1980 (যৌতুক নিষিদ্ধ, দায়িত্ব বর পক্ষের)
- সালিশ পরিষদ (Arbitration Council) এর ভূমিকা তালাকে

২. ব্ল্যাক ম্যাজিক ও আধ্যাত্মিক বিশ্লেষণ:
- সিহর (জাদু), নজর (কুদৃষ্টি), হাসাদ (হিংসা), জ্বীনের প্রভাব
- তাবিজ-কবচ, বান মারা, মোহ করা, বিচ্ছেদ করানো জাদুর ধরন
- লক্ষণ: হঠাৎ মনোভাব পরিবর্তন, ভালোবাসায় হঠাৎ ঘৃণা, অস্বাভাবিক আচরণ, সম্পর্ক ছেড়ে দেওয়ার অদ্ভুত আকুলতা
- চ্যাট হিস্টরিতে ব্ল্যাক ম্যাজিকের প্যাটার্ন বিশ্লেষণের পদ্ধতি
- ইসলামিক প্রতিকার: সূরা বাকারার শেষ দুই আয়াত, আয়াতুল কুরসি, রুকইয়া শরীয়া

৩. চ্যাট হিস্টরি বিশ্লেষণ:
- প্রদত্ত চ্যাট ডেটা থেকে প্যাটার্ন খুঁজে বের করা
- কে কখন কী বলেছে তা রেফারেন্স সহ বলা
- ছবি, স্ক্রিনশট দেখে সত্যতা যাচাই করা
${driveContext}`;
}

// ─── AI Providers ─────────────────────────────────────────────────
function geminiToOpenAIMessages(systemPrompt, contents) {
  const msgs = [{ role: "system", content: systemPrompt }];
  for (const c of contents) {
    const text = (c.parts || []).map(p => p.text).filter(Boolean).join("\n");
    if (text) msgs.push({ role: c.role === "model" ? "assistant" : "user", content: text });
  }
  return msgs;
}

async function tryGemini(body) {
  if (!geminiPool.size) return null;
  try {
    const r = await callWithFailover(geminiPool, async (key) =>
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    );
    const data = await r.json();
    return data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join("\n") || null;
  } catch (e) { console.warn("gemini:", e.message); return null; }
}

async function tryGroq(sys, contents) {
  if (!groqPool.size) return null;
  try {
    const messages = geminiToOpenAIMessages(sys, contents);
    const r = await callWithFailover(groqPool, async (key) =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0.85 }),
      })
    );
    const data = await r.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) { console.warn("groq:", e.message); return null; }
}

async function tryDeepseek(sys, contents) {
  if (!deepseekPool.size) return null;
  try {
    const messages = geminiToOpenAIMessages(sys, contents);
    const r = await callWithFailover(deepseekPool, async (key) =>
      fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "deepseek-chat", messages, temperature: 0.85 }),
      })
    );
    const data = await r.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) { console.warn("deepseek:", e.message); return null; }
}

async function tryOpenRouter(sys, contents) {
  if (!orPool.size) return null;
  try {
    const messages = geminiToOpenAIMessages(sys, contents);
    const r = await callWithFailover(orPool, async (key) =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", messages, temperature: 0.85 }),
      })
    );
    const data = await r.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) { console.warn("openrouter:", e.message); return null; }
}

async function chatWithFallback(body, hasImage) {
  const sys = body.systemInstruction.parts[0].text;
  const contents = body.contents;
  const r1 = await tryGemini(body);
  if (r1) return { reply: r1, provider: "gemini" };
  if (hasImage) return { reply: null, provider: null };
  const r2 = await tryGroq(sys, contents);
  if (r2) return { reply: r2, provider: "groq" };
  const r3 = await tryDeepseek(sys, contents);
  if (r3) return { reply: r3, provider: "deepseek" };
  const r4 = await tryOpenRouter(sys, contents);
  if (r4) return { reply: r4, provider: "openrouter" };
  return { reply: null, provider: null };
}

// ─── Telegram ─────────────────────────────────────────────────────
async function sendTelegram(text, imageBase64 = null) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  const base = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  try {
    if (imageBase64) {
      const b64 = String(imageBase64).split(",").pop();
      const buf = Buffer.from(b64, "base64");
      const form = new FormData();
      form.append("chat_id", TELEGRAM_CHAT);
      form.append("photo", new Blob([buf], { type: "image/jpeg" }), "image.jpg");
      if (text) form.append("caption", String(text).slice(0, 1024));
      await fetch(`${base}/sendPhoto`, { method: "POST", body: form });
    } else {
      await fetch(`${base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: String(text).slice(0, 4096) }),
      });
    }
  } catch (e) { console.warn("telegram:", e.message); }
}

// ─── Firebase Realtime DB ─────────────────────────────────────────
async function logFirebase(data) {
  if (!FIREBASE_DB_URL) return;
  try {
    await fetch(`${FIREBASE_DB_URL}/parisa_logs.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, timestamp: Date.now(), ts: new Date().toISOString() }),
    });
  } catch (e) { console.warn("firebase:", e.message); }
}

// ─── Edge TTS ─────────────────────────────────────────────────────
async function synthesizeEdgeTTS(text, gender = "female") {
  if (!MsEdgeTTS) return null;
  const voiceName = gender === "male" ? "bn-BD-PradeepNeural" : "bn-BD-NabanitaNeural";
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    // toStream() returns { audioStream } not a stream directly
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on("data", (d) => chunks.push(d));
      audioStream.on("close", resolve);
      audioStream.on("error", reject);
    });
    return chunks.length ? Buffer.concat(chunks) : null;
  } catch (e) {
    console.warn("edge-tts:", e.message);
    return null;
  }
}

// ─── Routes ───────────────────────────────────────────────────────
function mount(prefix) {
  prefix = prefix.replace(/\/$/, "");

  app.get(prefix + "/healthz", (_req, res) =>
    res.json({
      ok: true,
      tts: !!MsEdgeTTS,
      driveFiles: driveFileList.length,
      keys: { gemini: geminiPool.size, groq: groqPool.size, openrouter: orPool.size, deepseek: deepseekPool.size },
    })
  );

  // ── Chat ──────────────────────────────────────────────────────────
  app.post(prefix + "/chat", async (req, res) => {
    try {
      const { messages = [], userName = "আপনি", image } = req.body || {};

      // Refresh Drive memory if stale
      refreshDriveMemory().catch(() => {});

      const sys = buildSystemPrompt(userName);
      const contents = [];
      for (const m of messages) {
        if (!m || !m.role || !m.text) continue;
        contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.text) }] });
      }
      if (image && contents.length) {
        const last = contents[contents.length - 1];
        if (last.role === "user") {
          const b64 = String(image).split(",").pop();
          const mime = (String(image).match(/^data:(.*?);base64/) || [])[1] || "image/jpeg";
          last.parts.push({ inlineData: { mimeType: mime, data: b64 } });
        }
      }
      const body = {
        systemInstruction: { role: "system", parts: [{ text: sys }] },
        contents,
        generationConfig: { temperature: 0.85, maxOutputTokens: 2048 },
      };

      const { reply, provider } = await chatWithFallback(body, !!image);
      const finalReply = reply || "দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না।";

      // Log to Firebase + Telegram (async, don't wait)
      const lastUserMsg = messages[messages.length - 1]?.text || "";
      const logData = { userName, userMessage: lastUserMsg, aiReply: finalReply, provider, hasImage: !!image };
      logFirebase(logData).catch(() => {});

      const tgText = `👤 ${userName}: ${lastUserMsg}\n\n🤖 PARISA: ${finalReply}`;
      if (image) {
        sendTelegram(tgText, image).catch(() => {});
      } else {
        sendTelegram(tgText).catch(() => {});
      }

      res.json({ reply: finalReply, provider });
    } catch (e) {
      console.error("chat error", e);
      res.status(500).json({ reply: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  // ── Analyze (file / image) ────────────────────────────────────────
  app.post(prefix + "/analyze", async (req, res) => {
    try {
      const { prompt = "এই ফাইলটা বিশ্লেষণ করে বাংলায় বল।", file, mime, userName = "আপনি" } = req.body || {};
      if (!file) return res.status(400).json({ reply: "ফাইল পাইনি।" });
      const sys = buildSystemPrompt(userName);
      const b64 = String(file).split(",").pop();
      const mt = mime || (String(file).match(/^data:(.*?);base64/) || [])[1] || "image/jpeg";
      const body = {
        systemInstruction: { role: "system", parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: mt, data: b64 } }] }],
      };
      const { reply } = await chatWithFallback(body, true);
      const finalReply = reply || "ফাইলটা বিশ্লেষণ করতে পারলাম না।";

      // Telegram: send image + reply
      sendTelegram(`📎 ফাইল বিশ্লেষণ\n👤 প্রশ্ন: ${prompt}\n\n🤖 PARISA: ${finalReply}`,
        mt.startsWith("image/") ? file : null).catch(() => {});
      logFirebase({ type: "analyze", prompt, aiReply: finalReply, hasFile: true }).catch(() => {});

      res.json({ reply: finalReply });
    } catch (e) {
      console.error("analyze error", e);
      res.status(500).json({ reply: "ফাইল বিশ্লেষণে সমস্যা হয়েছে।" });
    }
  });

  // ── Voice (Microsoft Edge TTS) ────────────────────────────────────
  app.post(prefix + "/voice", async (req, res) => {
    try {
      const { text, gender = "female" } = req.body || {};
      if (!text) return res.status(204).end();
      const audio = await synthesizeEdgeTTS(String(text).slice(0, 2000), gender);
      if (!audio) return res.status(204).end();
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(audio);
    } catch (e) {
      console.error("voice error", e);
      res.status(204).end();
    }
  });

  // ── Drive file list ───────────────────────────────────────────────
  app.get(prefix + "/drive", async (_req, res) => {
    await refreshDriveMemory().catch(() => {});
    res.json({
      chatFiles: driveFileList.filter(f => f.folder === "chat").map(f => f.name),
      screenshots: driveFileList.filter(f => f.folder === "screenshot").map(f => f.name),
      hasMemory: driveMemoryText.length > 0,
      memoryChars: driveMemoryText.length,
    });
  });

  // ── Log (client-side event) ───────────────────────────────────────
  app.post(prefix + "/log", async (req, res) => {
    try {
      const { type, data } = req.body || {};
      logFirebase({ type: type || "event", ...data }).catch(() => {});
      res.json({ ok: true });
    } catch { res.json({ ok: false }); }
  });
}

mount("");
if (BASE && BASE !== "/" && BASE !== "") mount(BASE);

app.use(BASE, express.static(publicDir));
app.use(express.static(publicDir));

app.listen(PORT, "0.0.0.0", () =>
  console.log(`PARISA AI ready — port:${PORT} base:${BASE} tts:${!!MsEdgeTTS}`)
);
