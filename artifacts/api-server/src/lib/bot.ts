import TelegramBot from "node-telegram-bot-api";
import Groq from "groq-sdk";
import https from "https";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import path from "path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_SCRIPT = path.join(__dirname, "search.py");

const groqApiKey = process.env["GROQ_API_KEY"];
if (!groqApiKey) throw new Error("GROQ_API_KEY environment variable is required.");
const groq = new Groq({ apiKey: groqApiKey });

const token = process.env["TELEGRAM_BOT_TOKEN"];
if (!token) throw new Error("TELEGRAM_BOT_TOKEN environment variable is required.");

const bot = new TelegramBot(token, { polling: true });
logger.info("NexusBot_777_bot запускается...");

// ─── Search intent detection ───────────────────────────────────────────────────
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

function isSearchQuery(text: string): boolean {
  return SEARCH_PATTERNS.some((p) => p.test(text));
}

function extractSearchQuery(text: string): string {
  return text
    .replace(/^(найди|поищи|погугли|найти|search|ищи|поиск)\s+/i, "")
    .trim();
}

// ─── DuckDuckGo search via Python ─────────────────────────────────────────────
async function webSearch(query: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync("python3", [SEARCH_SCRIPT, query], {
    timeout: 20000,
  });

  if (stderr) logger.warn({ stderr }, "Search script stderr");

  const results: { title: string; body: string; href: string }[] = JSON.parse(stdout || "[]");

  if (results.length === 0) return "";

  return results
    .map((r) => `• ${r.title}: ${r.body}`)
    .join("\n");
}

// ─── Summarize search results with Groq ───────────────────────────────────────
async function summarizeSearchResults(query: string, snippets: string, userName: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content:
          `Ты умный помощник NexusBot_777. Отвечай ТОЛЬКО на русском языке. ` +
          `Пользователя зовут ${userName}. ` +
          `Тебе дан запрос пользователя и результаты поиска из интернета. ` +
          `Составь краткий, понятный и полезный ответ на русском языке на основе этих данных. ` +
          `Используй эмодзи. Если результаты содержат актуальные данные — обязательно их упомяни.`,
      },
      {
        role: "user",
        content: `Запрос: "${query}"\n\nРезультаты поиска:\n${snippets}`,
      },
    ],
    max_tokens: 600,
  });
  return completion.choices[0]?.message?.content ?? "😅 Не смог обработать результаты поиска.";
}

// ─── AI text response ─────────────────────────────────────────────────────────
async function getAIResponse(userMessage: string, userName: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content:
          `Ты умный и дружелюбный Telegram-бот NexusBot_777. ` +
          `Отвечай ТОЛЬКО на русском языке. Будь полезным, кратким и позитивным. ` +
          `Используй эмодзи где уместно. Пользователя зовут ${userName}. ` +
          `Не упоминай, что ты языковая модель или ИИ — просто отвечай как умный бот-помощник.`,
      },
      { role: "user", content: userMessage },
    ],
    max_tokens: 512,
  });
  return completion.choices[0]?.message?.content ?? "😅 Не смог придумать ответ, попробуй ещё раз!";
}

// ─── AI vision response ───────────────────────────────────────────────────────
async function getVisionResponse(base64Image: string, caption: string | undefined): Promise<string> {
  const userPrompt = caption
    ? `Опиши что изображено на фото. Также учти подпись пользователя: "${caption}"`
    : "Подробно опиши что изображено на этом фото на русском языке.";

  const completion = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: "text", text: userPrompt },
        ],
      },
    ],
    max_tokens: 1024,
  });
  return completion.choices[0]?.message?.content ?? "😅 Не удалось распознать изображение, попробуй ещё раз!";
}

// ─── Download file as Buffer ───────────────────────────────────────────────────
async function downloadBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function downloadImageAsBase64(url: string): Promise<string> {
  return (await downloadBuffer(url)).toString("base64");
}

// ─── Transcribe voice via Groq Whisper ────────────────────────────────────────
async function transcribeVoice(buffer: Buffer, mimeType = "audio/ogg"): Promise<string> {
  const file = new File([buffer], "voice.ogg", { type: mimeType });
  const transcription = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3",
    response_format: "json",
    language: "ru",
  });
  return transcription.text.trim();
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const name = msg.from?.first_name ?? "друг";
  await bot.sendMessage(
    msg.chat.id,
    `🌟 *Привет, ${escapeMarkdown(name)}!* Я *NexusBot\\_777* — твой умный ИИ-помощник.\n\n` +
    `🤖 Я умею:\n` +
    `• 💬 Отвечать на любые вопросы\n` +
    `• 🔍 Искать информацию в интернете\n` +
    `• 🖼️ Анализировать и описывать фотографии\n` +
    `• 🎙️ Распознавать голосовые сообщения\n\n` +
    `📋 *Команды:*\n` +
    `/start — приветствие\n` +
    `/help — помощь\n\n` +
    `✨ Напиши вопрос, отправь голосовое или фото — я отвечу!`,
    { parse_mode: "Markdown" },
  );
});

// ─── /help ────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `🤖 *NexusBot\\_777 — Помощь*\n\n` +
    `📋 *Команды:*\n` +
    `/start — приветственное сообщение\n` +
    `/help — эта справка\n\n` +
    `💬 *ИИ-ответы:*\n` +
    `Просто напиши мне что-нибудь и я отвечу!\n\n` +
    `🔍 *Веб-поиск:*\n` +
    `• _найди рецепт пиццы_\n` +
    `• _поищи курс доллара_\n` +
    `• _что сейчас происходит в мире?_\n\n` +
    `🎙️ *Голосовые сообщения:*\n` +
    `Отправь голосовое — я расшифрую и отвечу!\n\n` +
    `🖼️ *Анализ фото:*\n` +
    `Отправь любое фото — опишу что на нём!`,
    { parse_mode: "Markdown" },
  );
});

// ─── Voice handler ────────────────────────────────────────────────────────────
bot.on("voice", async (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from?.first_name ?? msg.from?.username ?? "друг";

  try {
    await bot.sendChatAction(chatId, "typing");

    const fileLink = await bot.getFileLink(msg.voice!.file_id);
    const buffer = await downloadBuffer(fileLink);
    const transcribed = await transcribeVoice(buffer);

    if (!transcribed) {
      await bot.sendMessage(chatId, "😔 Не удалось распознать голос. Попробуй ещё раз или напиши текстом.");
      return;
    }

    logger.info({ chatId, transcribed }, "Voice transcribed");

    // Echo transcription back so user knows what was heard
    await bot.sendMessage(chatId, `🎙️ *Я услышал:* _${escapeMarkdown(transcribed)}_`, { parse_mode: "Markdown" });
    await bot.sendChatAction(chatId, "typing");

    // Process the transcribed text exactly like a regular message
    if (isSearchQuery(transcribed)) {
      const query = extractSearchQuery(transcribed);
      await bot.sendMessage(chatId, `🔍 Ищу: _${escapeMarkdown(query)}_...`, { parse_mode: "Markdown" });
      await bot.sendChatAction(chatId, "typing");
      const snippets = await webSearch(query);
      if (!snippets) {
        await bot.sendMessage(chatId, "😔 Ничего не нашёл по этому запросу.");
        return;
      }
      const summary = await summarizeSearchResults(query, snippets, userName);
      await bot.sendMessage(chatId, `🔍 *Результаты поиска:*\n\n${summary}`, { parse_mode: "Markdown" });
    } else {
      const reply = await getAIResponse(transcribed, userName);
      await bot.sendMessage(chatId, reply);
    }
  } catch (err) {
    logger.error({ err }, "Voice handler error");
    await bot.sendMessage(chatId, "😅 Не удалось обработать голосовое сообщение. Попробуй ещё раз!");
  }
});

// ─── Photo handler ────────────────────────────────────────────────────────────
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const bestPhoto = msg.photo![msg.photo!.length - 1];
    const fileLink = await bot.getFileLink(bestPhoto.file_id);
    const base64 = await downloadImageAsBase64(fileLink);
    const reply = await getVisionResponse(base64, msg.caption);
    await bot.sendMessage(chatId, `🖼️ *Анализ изображения:*\n\n${reply}`, { parse_mode: "Markdown" });
  } catch (err: any) {
    logger.error({ err }, "Vision API error");
    const isModelError = err?.error?.error?.code === "model_decommissioned" || err?.status === 400;
    if (isModelError) {
      await bot.sendMessage(chatId,
        "🖼️ Распознавание изображений временно недоступно.\n\n⏳ Функция скоро вернётся! А пока задай мне любой текстовый вопрос. 😊"
      );
    } else {
      await bot.sendMessage(chatId, "😅 Не удалось проанализировать изображение. Попробуй ещё раз позже!");
    }
  }
});

// ─── Text message handler ─────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const chatId = msg.chat.id;
  const userName = msg.from?.first_name ?? msg.from?.username ?? "друг";

  logger.info({ chatId, text: msg.text }, "Received message");

  await bot.sendChatAction(chatId, "typing");

  // Route to web search if intent detected
  if (isSearchQuery(msg.text)) {
    try {
      const query = extractSearchQuery(msg.text);
      await bot.sendMessage(chatId, `🔍 Ищу: _${escapeMarkdown(query)}_...`, { parse_mode: "Markdown" });
      await bot.sendChatAction(chatId, "typing");

      const snippets = await webSearch(query);

      if (!snippets) {
        await bot.sendMessage(chatId, "😔 Ничего не нашёл по этому запросу. Попробуй сформулировать иначе.");
        return;
      }

      const summary = await summarizeSearchResults(query, snippets, userName);
      await bot.sendMessage(chatId, `🔍 *Результаты поиска:*\n\n${summary}`, { parse_mode: "Markdown" });
    } catch (err) {
      logger.error({ err }, "Search error");
      await bot.sendMessage(chatId, "😅 Не удалось выполнить поиск. Попробуй ещё раз!");
    }
    return;
  }

  // Regular AI response
  try {
    const reply = await getAIResponse(msg.text, userName);
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    logger.error({ err }, "Groq API error");
    await bot.sendMessage(chatId, "😅 Что-то пошло не так, попробуй ещё раз!");
  }
});

bot.on("polling_error", (err) => logger.error({ err }, "Telegram polling error"));
bot.on("error", (err) => logger.error({ err }, "Telegram bot error"));

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export default bot;
