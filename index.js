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

console.log('NexusBot_777 starting...');

// ── Language detection ────────────────────────────────────────────────────────
// Returns: 'ru' | 'uk' | 'kk' | 'en'
function detectLanguage(text) {
  if (!text || text.trim().length < 2) return null;
  // Kazakh-unique Cyrillic chars (must check before Ukrainian)
  if (/[әғқңөұүһӘҒҚҢӨҰҮҺ]/.test(text)) return 'kk';
  // Ukrainian-unique Cyrillic chars
  if (/[їєґЇЄҐ]/.test(text)) return 'uk';
  // Generic Cyrillic → Russian
  if (/[а-яёА-ЯЁіІ]/.test(text)) return 'ru';
  // Default to English
  return 'en';
}

// ── Translations ──────────────────────────────────────────────────────────────
const T = {
  ru: {
    systemBot:   name => `Ты умный и дружелюбный Telegram-бот NexusBot_777. Пользователя зовут ${name}. СТРОГИЕ ПРАВИЛА ЯЗЫКА: отвечай ИСКЛЮЧИТЕЛЬНО на русском языке. ЗАПРЕЩЕНО использовать любые английские слова, термины, аббревиатуры или фразы — даже технические. Для любого понятия используй русский эквивалент или опиши по-русски. Будь полезным, кратким и позитивным. Используй эмодзи.`,
    systemSearch: name => `Ты помощник NexusBot_777. Пользователя зовут ${name}. СТРОГОЕ ПРАВИЛО: отвечай ИСКЛЮЧИТЕЛЬНО на русском языке, без единого английского слова. Составь краткий ответ на основе результатов поиска. Используй эмодзи.`,
    systemVision: caption => caption ? `Опиши фото на ЧИСТОМ русском языке, без английских слов. Учти подпись: "${caption}"` : 'Подробно опиши что изображено на фото — ТОЛЬКО на русском языке, без каких-либо английских слов.',
    start: name => `🌟 *Привет, ${name}!* Я *NexusBot\\_777* — твой умный ИИ-помощник.\n\n🤖 Я умею:\n• 💬 Отвечать на любые вопросы\n• 🔍 Искать информацию в интернете\n• 🖼️ Анализировать фотографии\n• 🎙️ Распознавать голосовые сообщения\n\n✨ Напиши вопрос, отправь голосовое или фото!`,
    help: `🤖 *NexusBot\\_777 — Помощь*\n\n💬 *ИИ-ответы:* просто напиши что-нибудь\n🔍 *Поиск:* _найди курс доллара_\n🎙️ *Голос:* отправь голосовое — расшифрую и отвечу\n🖼️ *Фото:* отправь фото — опишу что на нём`,
    voiceHeard:  t => `🎙️ *Я услышал:* _${t}_`,
    searching:   q => `🔍 Ищу: _${q}_...`,
    searchHeader: '🔍 *Результаты поиска:*',
    photoHeader:  '🖼️ *Анализ изображения:*',
    noResults:    '😔 Ничего не нашёл. Попробуй сформулировать иначе.',
    voiceNoText:  '😔 Не удалось распознать голос. Попробуй ещё раз или напиши текстом.',
    voiceErr:     '😅 Не удалось обработать голосовое сообщение.',
    photoErr:     '😅 Не удалось проанализировать изображение. Попробуй ещё раз!',
    photoUnavail: '🖼️ Распознавание изображений временно недоступно. Попробуй позже!',
    searchErr:    '😅 Не удалось выполнить поиск. Попробуй ещё раз!',
    aiErr:        '😅 Что-то пошло не так, попробуй ещё раз!',
    aiNoAnswer:   '😅 Не смог придумать ответ, попробуй ещё раз!',
    searchNoAnswer: '😅 Не смог обработать результаты поиска.',
  },
  uk: {
    systemBot:   name => `Ти розумний і дружній Telegram-бот NexusBot_777. Відповідай ТІЛЬКИ українською мовою. Будь корисним, коротким і позитивним. Використовуй емодзі. Користувача звати ${name}. Не згадуй, що ти ШІ.`,
    systemSearch: name => `Ти помічник NexusBot_777. Відповідай ТІЛЬКИ українською мовою. Користувача звати ${name}. Склади короткий ответ на основі результатів пошуку. Використовуй емодзі.`,
    systemVision: caption => caption ? `Опиши фото. Врахуй підпис: "${caption}"` : 'Детально опиши що зображено на фото українською мовою.',
    start: name => `🌟 *Привіт, ${name}!* Я *NexusBot\\_777* — твій розумний ІІ-помічник.\n\n🤖 Я вмію:\n• 💬 Відповідати на будь-які запитання\n• 🔍 Шукати інформацію в інтернеті\n• 🖼️ Аналізувати фотографії\n• 🎙️ Розпізнавати голосові повідомлення\n\n✨ Напиши запитання, надішли голосове або фото!`,
    help: `🤖 *NexusBot\\_777 — Допомога*\n\n💬 *ІІ-відповіді:* просто напиши щось\n🔍 *Пошук:* _знайди курс долара_\n🎙️ *Голос:* надішли голосове — розшифрую і відповім\n🖼️ *Фото:* надішли фото — опишу що на ньому`,
    voiceHeard:  t => `🎙️ *Я почув:* _${t}_`,
    searching:   q => `🔍 Шукаю: _${q}_...`,
    searchHeader: '🔍 *Результати пошуку:*',
    photoHeader:  '🖼️ *Аналіз зображення:*',
    noResults:    '😔 Нічого не знайшов. Спробуй сформулювати інакше.',
    voiceNoText:  '😔 Не вдалося розпізнати голос. Спробуй ще раз або напиши текстом.',
    voiceErr:     '😅 Не вдалося обробити голосове повідомлення.',
    photoErr:     '😅 Не вдалося проаналізувати зображення. Спробуй ще раз!',
    photoUnavail: '🖼️ Розпізнавання зображень тимчасово недоступне. Спробуй пізніше!',
    searchErr:    '😅 Не вдалося виконати пошук. Спробуй ще раз!',
    aiErr:        '😅 Щось пішло не так, спробуй ще раз!',
    aiNoAnswer:   '😅 Не зміг придумати відповідь, спробуй ще раз!',
    searchNoAnswer: '😅 Не зміг обробити результати пошуку.',
  },
  kk: {
    systemBot:   name => `Сен NexusBot_777 деп аталатын ақылды және достық Telegram-бот. Тек қазақ тілінде жауап бер. Пайдалы, қысқа және позитивті бол. Эмодзи қолдан. Пайдаланушының аты ${name}. Жасанды интеллект екеніңді айтпа.`,
    systemSearch: name => `Сен NexusBot_777 көмекшісің. Тек қазақ тілінде жауап бер. Пайдаланушының аты ${name}. Іздеу нәтижелері негізінде қысқаша жауап жаз. Эмодзи қолдан.`,
    systemVision: caption => caption ? `Суретті сипаттап бер. Қолданушының жазбасын ескер: "${caption}"` : 'Суретте не бейнеленгенін қазақ тілінде толық сипатта.',
    start: name => `🌟 *Сәлем, ${name}!* Мен *NexusBot\\_777* — сенің ақылды ЖИ-көмекшің.\n\n🤖 Мен білемін:\n• 💬 Кез келген сұраққа жауап беру\n• 🔍 Интернеттен ақпарат іздеу\n• 🖼️ Суреттерді талдау\n• 🎙️ Дауыстық хабарларды тану\n\n✨ Сұрақ жаз, дауыстық немесе фото жібер!`,
    help: `🤖 *NexusBot\\_777 — Көмек*\n\n💬 *ЖИ-жауаптар:* жай бірдеңе жаз\n🔍 *Іздеу:* _доллар бағамын тап_\n🎙️ *Дауыс:* дауыстық жібер — тануып жауап берем\n🖼️ *Фото:* фото жібер — сипаттап беремін`,
    voiceHeard:  t => `🎙️ *Мен естідім:* _${t}_`,
    searching:   q => `🔍 Іздеуде: _${q}_...`,
    searchHeader: '🔍 *Іздеу нәтижелері:*',
    photoHeader:  '🖼️ *Суретті талдау:*',
    noResults:    '😔 Ештеңе таппадым. Басқаша тұжырымдап көр.',
    voiceNoText:  '😔 Дауысты тану мүмкін болмады. Тағы бір рет көр немесе мәтін жаз.',
    voiceErr:     '😅 Дауыстық хабарды өңдеу мүмкін болмады.',
    photoErr:     '😅 Суретті талдау мүмкін болмады. Тағы бір рет көр!',
    photoUnavail: '🖼️ Суреттерді тану уақытша қолжетімсіз. Кейінірек көр!',
    searchErr:    '😅 Іздеу орындалмады. Тағы бір рет көр!',
    aiErr:        '😅 Бірдеңе дұрыс болмады, тағы бір рет көр!',
    aiNoAnswer:   '😅 Жауап таба алмадым, тағы бір рет көр!',
    searchNoAnswer: '😅 Іздеу нәтижелерін өңдей алмадым.',
  },
  en: {
    systemBot:   name => `You are NexusBot_777, a smart and friendly Telegram bot. Reply ONLY in English. Be helpful, concise, and positive. Use emojis where appropriate. The user's name is ${name}. Don't mention that you are an AI.`,
    systemSearch: name => `You are NexusBot_777 assistant. Reply ONLY in English. The user's name is ${name}. Write a short, helpful answer based on the search results. Use emojis.`,
    systemVision: caption => caption ? `Describe the photo. Also consider the user's caption: "${caption}"` : 'Describe in detail what is shown in this photo in English.',
    start: name => `🌟 *Hello, ${name}!* I'm *NexusBot\\_777* — your smart AI assistant.\n\n🤖 I can:\n• 💬 Answer any questions\n• 🔍 Search the web for information\n• 🖼️ Analyze and describe photos\n• 🎙️ Transcribe voice messages\n\n✨ Send a message, voice note, or photo!`,
    help: `🤖 *NexusBot\\_777 — Help*\n\n💬 *AI answers:* just write anything\n🔍 *Search:* _find bitcoin price_, _search latest news_\n🎙️ *Voice:* send a voice note — I'll transcribe and reply\n🖼️ *Photo:* send a photo — I'll describe it`,
    voiceHeard:  t => `🎙️ *I heard:* _${t}_`,
    searching:   q => `🔍 Searching: _${q}_...`,
    searchHeader: '🔍 *Search results:*',
    photoHeader:  '🖼️ *Image analysis:*',
    noResults:    '😔 Found nothing. Try rephrasing your query.',
    voiceNoText:  '😔 Could not recognize the voice. Try again or send a text message.',
    voiceErr:     '😅 Could not process the voice message.',
    photoErr:     '😅 Could not analyze the image. Please try again!',
    photoUnavail: '🖼️ Image recognition is temporarily unavailable. Try again later!',
    searchErr:    '😅 Search failed. Please try again!',
    aiErr:        '😅 Something went wrong. Please try again!',
    aiNoAnswer:   '😅 Could not come up with an answer. Please try again!',
    searchNoAnswer: '😅 Could not process the search results.',
  },
};

// ── Conversation memory (last 10 messages per user) ──────────────────────────
const MAX_HISTORY = 10;
const conversationHistory = new Map();
const userLanguages = new Map(); // userId → 'ru'|'uk'|'kk'|'en'

function getHistory(userId) {
  return conversationHistory.get(userId) ?? [];
}

function addToHistory(userId, role, content) {
  const h = conversationHistory.get(userId) ?? [];
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
  conversationHistory.set(userId, h);
}

function getLang(userId, text) {
  const detected = text ? detectLanguage(text) : null;
  if (detected) userLanguages.set(userId, detected);
  return userLanguages.get(userId) ?? 'ru';
}

// ── Search intent detection ───────────────────────────────────────────────────
const SEARCH_PATTERNS = [
  /^(найди|поищи|погугли|найти|ищи|поиск)\s+/i,
  /^(знайди|пошукай|шукай)\s+/i,
  /^(тап|іздеші|іздеп)\s+/i,
  /^(find|search|look up|google)\s+/i,
  /что (сейчас|сегодня|происходит|нового|случилось)/i,
  /що (зараз|сьогодні|відбувається)/i,
  /последние новости|останні новини|соңғы жаңалықтар|latest news/i,
  /актуальн(ый|ая|ое|ые)/i,
  /курс (доллара|евро|рубля|биткоина|валют)/i,
  /курс (долара|євро)/i,
  /exchange rate|bitcoin price|stock price/i,
  /цена (на|сейчас)|ціна|current price/i,
];

function isSearchQuery(text) {
  return SEARCH_PATTERNS.some(p => p.test(text));
}

function extractSearchQuery(text) {
  return text
    .replace(/^(найди|поищи|погугли|найти|ищи|поиск)\s+/i, '')
    .replace(/^(знайди|пошукай|шукай)\s+/i, '')
    .replace(/^(тап|іздеші|іздеп)\s+/i, '')
    .replace(/^(find|search|look up|google)\s+/i, '')
    .trim();
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
async function getAIResponse(message, userName, userHistory, lang) {
  const t = T[lang];
  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: t.systemBot(userName) },
      ...userHistory,
      { role: 'user', content: message },
    ],
    max_tokens: 512,
  });
  return res.choices[0]?.message?.content ?? t.aiNoAnswer;
}

async function summarizeSearch(query, snippets, userName, lang) {
  const t = T[lang];
  const res = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: t.systemSearch(userName) },
      { role: 'user', content: `Query: "${query}"\n\nSearch results:\n${snippets}` },
    ],
    max_tokens: 600,
  });
  return res.choices[0]?.message?.content ?? t.searchNoAnswer;
}

async function getVisionResponse(base64Image, caption, lang) {
  const t = T[lang];
  const res = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: 'text', text: t.systemVision(caption) },
        ],
      },
    ],
    max_tokens: 1024,
  });
  return res.choices[0]?.message?.content ?? t.photoErr;
}

async function transcribeVoice(buffer) {
  const file = new File([buffer], 'voice.ogg', { type: 'audio/ogg' });
  const res = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3',
    response_format: 'json',
  });
  return res.text.trim();
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async msg => {
  const userId = msg.from.id;
  const lang = getLang(userId, null);
  const t = T[lang];
  const name = msg.from?.first_name ?? 'friend';
  await bot.sendMessage(msg.chat.id, t.start(escapeMarkdown(name)), { parse_mode: 'Markdown' });
});

// ── /help ─────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async msg => {
  const userId = msg.from.id;
  const lang = getLang(userId, null);
  await bot.sendMessage(msg.chat.id, T[lang].help, { parse_mode: 'Markdown' });
});

// ── Voice handler ─────────────────────────────────────────────────────────────
bot.on('voice', async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from?.first_name ?? msg.from?.username ?? 'friend';
  try {
    await bot.sendChatAction(chatId, 'typing');
    const link = await bot.getFileLink(msg.voice.file_id);
    const buf = await downloadBuffer(link);
    const transcribed = await transcribeVoice(buf);
    if (!transcribed) {
      const lang = getLang(userId, null);
      await bot.sendMessage(chatId, T[lang].voiceNoText);
      return;
    }
    const lang = getLang(userId, transcribed);
    const t = T[lang];
    await bot.sendMessage(chatId, t.voiceHeard(escapeMarkdown(transcribed)), { parse_mode: 'Markdown' });
    await bot.sendChatAction(chatId, 'typing');
    if (isSearchQuery(transcribed)) {
      const query = extractSearchQuery(transcribed);
      const snippets = await webSearch(query);
      if (!snippets) { await bot.sendMessage(chatId, t.noResults); return; }
      const summary = await summarizeSearch(query, snippets, userName, lang);
      await bot.sendMessage(chatId, `${t.searchHeader}\n\n${summary}`, { parse_mode: 'Markdown' });
      addToHistory(userId, 'user', transcribed);
      addToHistory(userId, 'assistant', summary);
    } else {
      const reply = await getAIResponse(transcribed, userName, getHistory(userId), lang);
      addToHistory(userId, 'user', transcribed);
      addToHistory(userId, 'assistant', reply);
      await bot.sendMessage(chatId, reply);
    }
  } catch (err) {
    console.error('Voice error:', err);
    const lang = getLang(userId, null);
    await bot.sendMessage(chatId, T[lang].voiceErr);
  }
});

// ── Photo handler ─────────────────────────────────────────────────────────────
bot.on('photo', async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const lang = getLang(userId, msg.caption ?? null);
  const t = T[lang];
  try {
    await bot.sendChatAction(chatId, 'typing');
    const photo = msg.photo[msg.photo.length - 1];
    const link = await bot.getFileLink(photo.file_id);
    const base64 = await downloadBase64(link);
    const reply = await getVisionResponse(base64, msg.caption, lang);
    await bot.sendMessage(chatId, `${t.photoHeader}\n\n${reply}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Photo error:', err);
    const isDecommissioned = err?.error?.error?.code === 'model_decommissioned' || err?.status === 400;
    await bot.sendMessage(chatId, isDecommissioned ? t.photoUnavail : t.photoErr);
  }
});

// ── Text message handler ──────────────────────────────────────────────────────
bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from?.first_name ?? msg.from?.username ?? 'friend';
  const lang = getLang(userId, msg.text);
  const t = T[lang];
  await bot.sendChatAction(chatId, 'typing');
  if (isSearchQuery(msg.text)) {
    try {
      const query = extractSearchQuery(msg.text);
      await bot.sendMessage(chatId, t.searching(escapeMarkdown(query)), { parse_mode: 'Markdown' });
      await bot.sendChatAction(chatId, 'typing');
      const snippets = await webSearch(query);
      if (!snippets) { await bot.sendMessage(chatId, t.noResults); return; }
      const summary = await summarizeSearch(query, snippets, userName, lang);
      await bot.sendMessage(chatId, `${t.searchHeader}\n\n${summary}`, { parse_mode: 'Markdown' });
      addToHistory(userId, 'user', msg.text);
      addToHistory(userId, 'assistant', summary);
    } catch (err) {
      console.error('Search error:', err);
      await bot.sendMessage(chatId, t.searchErr);
    }
    return;
  }
  try {
    const reply = await getAIResponse(msg.text, userName, getHistory(userId), lang);
    addToHistory(userId, 'user', msg.text);
    addToHistory(userId, 'assistant', reply);
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error('AI error:', err);
    await bot.sendMessage(chatId, t.aiErr);
  }
});

bot.on('polling_error', err => console.error('Polling error:', err.message));
bot.on('error', err => console.error('Bot error:', err.message));

// ── Express health server ─────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.listen(PORT, () => console.log(`Health server listening on port ${PORT}`));
