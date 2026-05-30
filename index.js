import TelegramBot from 'node-telegram-bot-api';
import Groq from 'groq-sdk';
import https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_SCRIPT = path.join(__dirname, 'search.py');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY environment variable is required');
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');

const groq = new Groq({ apiKey: GROQ_API_KEY });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('NexusBot_777 запускается...');

// ── Conversation memory (last 10 messages per user) ──────────────────────────
const MAX_HISTORY = 10;
const conversationHistory = new Map();

function getHistory(userId) {
  return conversationHistory.get(userId) ?? [];
}

function addToHistory(userId, role, content) {
  const h = conversationHistory.get(userId) ?? [];
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
  conversationHistory.set(userId, h);
}

// ── Search intent detection ───────────────────────────────────────────────────
const SEARCH_PATTERNS = [
  /^(найди|поищи|погугли|найти|search|ищи|поиск)\s+/i,
  /что (сейчас|сегодня|происходит|нового|случилось|творится)/i,
  /последние новости/i,
  /актуальн(ый|ая|ое|ые)/i,
  /курс (доллара|евро|рубля|биткоина|валют)/i,
  /цена (на|сейчас)/i,
  /кто такой .+\?$/i,
  /что за .+\?$/i,
];

function isSearchQuery(text) {
  return SEARCH_PATTERNS.some(p => p.test(text));
}

function extractSearchQuery(text) {
  return text.replace(/^(найди|поищи|погугли|найти|search|ищи|поиск)\s+/i, '').trim();
}

function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// ── DuckDuckGo search via Python ──────────────────────────────────────────────
async function webSearch(query) {
  try {
    const { stdout, stderr } = await execFileAsync('python3', [SEARCH_SCRIPT, query], { timeout: 20000 });
    if (stderr) console.warn('Search stderr:', stderr);
    const results = JSON.parse(stdout || '[]');
    return results.map(r => `• ${r.title}: ${r.body}`).join('\n');
  } catch (err) {
    console.error('webSearch error:', err.message);
    return '';
  }
}

// ── Download helpers ──────────────────────────────────────────────────────────
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadBase64(url) {
  return (await downloadBuffer(url)).toString('base64');
}

// ── Groq AI functions ─────────────────────────────────────────────────────────
async function getAIResponse(message, userName, userHistory) {
  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content:
          `Ты умный и дружелюбный Telegram-бот NexusBot_777. ` +
          `Отвечай ТОЛЬКО на русском языке. Будь полезным, кратким и позитивным. ` +
          `Используй эмодзи где уместно. Пользователя зовут ${userName}. ` +
          `Не упоминай, что ты языковая модель или ИИ — просто отвечай как умный бот-помощник.`,
      },
      ...userHistory,
      { role: 'user', content: message },
    ],
    max_tokens: 512,
  });
  return res.choices[0]?.message?.content ?? '😅 Не смог придумать ответ, попробуй ещё раз!';
}

async function summarizeSearch(query, snippets, userName) {
  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      {
        role: 'system',
        content:
          `Ты умный помощник NexusBot_777. Отвечай ТОЛЬКО на русском языке. ` +
          `Пользователя зовут ${userName}. ` +
          `Составь краткий понятный ответ на основе результатов поиска. Используй эмодзи.`,
      },
      { role: 'user', content: `Запрос: "${query}"\n\nРезультаты поиска:\n${snippets}` },
    ],
    max_tokens: 600,
  });
  return res.choices[0]?.message?.content ?? '😅 Не смог обработать результаты поиска.';
}

async function getVisionResponse(base64Image, caption) {
  const prompt = caption
    ? `Опиши что изображено на фото. Учти подпись: "${caption}"`
    : 'Подробно опиши что изображено на этом фото на русском языке.';
  const res = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: 'text', text: prompt },
        ],
      },
    ],
    max_tokens: 1024,
  });
  return res.choices[0]?.message?.content ?? '😅 Не удалось распознать изображение!';
}

async function transcribeVoice(buffer) {
  const file = new File([buffer], 'voice.ogg', { type: 'audio/ogg' });
  const res = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3',
    response_format: 'json',
    language: 'ru',
  });
  return res.text.trim();
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async msg => {
  const name = msg.from?.first_name ?? 'друг';
  await bot.sendMessage(msg.chat.id,
    `🌟 *Привет, ${escapeMarkdown(name)}!* Я *NexusBot\\_777* — твой умный ИИ-помощник.\n\n` +
    `🤖 Я умею:\n` +
    `• 💬 Отвечать на любые вопросы\n` +
    `• 🔍 Искать информацию в интернете\n` +
    `• 🖼️ Анализировать и описывать фотографии\n` +
    `• 🎙️ Распознавать голосовые сообщения\n\n` +
    `✨ Напиши вопрос, отправь голосовое или фото — я отвечу!`,
    { parse_mode: 'Markdown' });
});

// ── /help ─────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async msg => {
  await bot.sendMessage(msg.chat.id,
    `🤖 *NexusBot\\_777 — Помощь*\n\n` +
    `💬 *ИИ-ответы:* просто напиши что-нибудь\n` +
    `🔍 *Поиск:* _найди курс доллара_, _поищи новости_\n` +
    `🎙️ *Голос:* отправь голосовое — расшифрую и отвечу\n` +
    `🖼️ *Фото:* отправь фото — опишу что на нём`,
    { parse_mode: 'Markdown' });
});

// ── Voice handler ─────────────────────────────────────────────────────────────
bot.on('voice', async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from?.first_name ?? msg.from?.username ?? 'друг';
  try {
    await bot.sendChatAction(chatId, 'typing');
    const link = await bot.getFileLink(msg.voice.file_id);
    const buf = await downloadBuffer(link);
    const transcribed = await transcribeVoice(buf);
    if (!transcribed) {
      await bot.sendMessage(chatId, '😔 Не удалось распознать голос. Попробуй ещё раз или напиши текстом.');
      return;
    }
    await bot.sendMessage(chatId, `🎙️ *Я услышал:* _${escapeMarkdown(transcribed)}_`, { parse_mode: 'Markdown' });
    await bot.sendChatAction(chatId, 'typing');
    if (isSearchQuery(transcribed)) {
      const query = extractSearchQuery(transcribed);
      const snippets = await webSearch(query);
      if (!snippets) { await bot.sendMessage(chatId, '😔 Ничего не нашёл.'); return; }
      const summary = await summarizeSearch(query, snippets, userName);
      await bot.sendMessage(chatId, `🔍 *Результаты поиска:*\n\n${summary}`, { parse_mode: 'Markdown' });
      addToHistory(userId, 'user', transcribed);
      addToHistory(userId, 'assistant', summary);
    } else {
      const reply = await getAIResponse(transcribed, userName, getHistory(userId));
      addToHistory(userId, 'user', transcribed);
      addToHistory(userId, 'assistant', reply);
      await bot.sendMessage(chatId, reply);
    }
  } catch (err) {
    console.error('Voice error:', err);
    await bot.sendMessage(chatId, '😅 Не удалось обработать голосовое сообщение.');
  }
});

// ── Photo handler ─────────────────────────────────────────────────────────────
bot.on('photo', async msg => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, 'typing');
    const photo = msg.photo[msg.photo.length - 1];
    const link = await bot.getFileLink(photo.file_id);
    const base64 = await downloadBase64(link);
    const reply = await getVisionResponse(base64, msg.caption);
    await bot.sendMessage(chatId, `🖼️ *Анализ изображения:*\n\n${reply}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Photo error:', err);
    const isDecommissioned = err?.error?.error?.code === 'model_decommissioned' || err?.status === 400;
    await bot.sendMessage(chatId, isDecommissioned
      ? '🖼️ Распознавание изображений временно недоступно. Попробуй позже!'
      : '😅 Не удалось проанализировать изображение. Попробуй ещё раз!');
  }
});

// ── Text message handler ──────────────────────────────────────────────────────
bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from?.first_name ?? msg.from?.username ?? 'друг';
  await bot.sendChatAction(chatId, 'typing');
  if (isSearchQuery(msg.text)) {
    try {
      const query = extractSearchQuery(msg.text);
      await bot.sendMessage(chatId, `🔍 Ищу: _${escapeMarkdown(query)}_...`, { parse_mode: 'Markdown' });
      await bot.sendChatAction(chatId, 'typing');
      const snippets = await webSearch(query);
      if (!snippets) {
        await bot.sendMessage(chatId, '😔 Ничего не нашёл. Попробуй сформулировать иначе.');
        return;
      }
      const summary = await summarizeSearch(query, snippets, userName);
      await bot.sendMessage(chatId, `🔍 *Результаты поиска:*\n\n${summary}`, { parse_mode: 'Markdown' });
      addToHistory(userId, 'user', msg.text);
      addToHistory(userId, 'assistant', summary);
    } catch (err) {
      console.error('Search error:', err);
      await bot.sendMessage(chatId, '😅 Не удалось выполнить поиск. Попробуй ещё раз!');
    }
    return;
  }
  try {
    const reply = await getAIResponse(msg.text, userName, getHistory(userId));
    addToHistory(userId, 'user', msg.text);
    addToHistory(userId, 'assistant', reply);
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error('AI error:', err);
    await bot.sendMessage(chatId, '😅 Что-то пошло не так, попробуй ещё раз!');
  }
});

bot.on('polling_error', err => console.error('Polling error:', err.message));
bot.on('error', err => console.error('Bot error:', err.message));

// ── Express health server ─────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.listen(PORT, () => console.log(`Health server listening on port ${PORT}`));
