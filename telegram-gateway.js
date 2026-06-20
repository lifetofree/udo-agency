import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { UdoNewsAgent } from './services/news-agent.js';
import ollama from 'ollama';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// โหลดค่ากำหนดตัวแปรสภาพแวดล้อมจากไฟล์ .env
dotenv.config();

// 🛡️ ระบบการตรวจเซ็กความปลอดภัยขั้นต้น
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ Error: ไม่พบ TELEGRAM_BOT_TOKEN ในไฟล์ .env โปรดระบุคีย์บอทให้ถูกต้อง');
  process.exit(1);
}

// เริ่มต้นเปิดระบบประตูกล Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// กำหนดโมเดลสำหรับประมวลผลคำสั่งด่วนและคัดเกลาผลงาน
const DRAFT_MODEL = 'qwen3.5:9b';

// 🔒 ตัวล็อคคิวแบบรวมศูนย์ (Unified Concurrency Lock)
// ป้องกันไม่ให้ AI รันงานซ้อนกันในแรม เพื่อถนอมเครื่อง Mac M3 Pro 36GB
let isAiProcessing = false;

// กำหนดโฟลเดอร์สำหรับเก็บไฟล์ตั้งค่าแบบแยกส่วน (Modular Markdown Configuration)
const CONFIG_DIR = path.join(process.cwd(), 'config');

/**
 * 🦆 ฟังก์ชันประกอบร่าง Prompt (System Prompt Assembler)
 * สแกนอ่านคอนฟิก .md ทั้ง 5 บล็อกย่อยจากโฟลเดอร์ config/ มามัดรวมกันเป็นคลังความรู้ระบบ
 */
function assembleUdoPrompts() {
  // บรรจุครบทั้ง 5 ไฟล์คอนฟิกตามโครงสร้างใหม่
  const requiredFiles = ['persona.md', 'guardrails.md', 'cli.md', 'frameworks.md', 'books.md'];
  let compiledPrompt = '=== UDO SYSTEM CORE CONFIGURATION ===\n\n';
  let filesLoadedCount = 0;

  // ตรวจสอบโฟลเดอร์ config ป้องกันระบบระเบิดล้มเหลว
  if (!fs.existsSync(CONFIG_DIR)) {
    console.warn('⚠️ [UDO Engine] ไม่พบโฟลเดอร์ config/ กำลังใช้ System Prompt สำรอง...');
    return 'คุณคือ "แอดเป็ด" ผู้ช่วยส่วนตัวสไตล์ System > Emotion ตอบเป็นภาษาไทยด้วยความสุภาพตรงประเด็น';
  }

  // วนลูปกวาดอ่านเนื้อหาจากไฟล์ Markdown ทีละตัว
  for (const fileName of requiredFiles) {
    const filePath = path.join(CONFIG_DIR, fileName);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        compiledPrompt += `[MODULE: ${fileName.toUpperCase()}]\n${content}\n\n`;
        filesLoadedCount++;
      }
    } catch (err) {
      console.error(`🔴 เกิดความล้มเหลวในการอ่านไฟล์โมดูล ${fileName}:`, err.message);
    }
  }

  console.log(`🎯 [UDO Engine] โหลดแผนผังข้อมูลสำเร็จจำนวน ${filesLoadedCount} โมดูลหลัก`);
  return compiledPrompt;
}

/**
 * ฟังก์ชันพยาบาลสำหรับช่วยเคลียร์แท็กขั้นตอนการคิด <think>...</think> ของ Qwen 
 * ป้องกันไม่ให้เศษข้อความดีบั๊กรั่วไหลออกไปรบกวนหน้าจอแชตของผู้ใช้
 */
function cleanAiResponse(text) {
  if (!text) return '';
  let cleaned = text;
  
  // สกัดขั้นสูง: หากโมเดลลืมใส่แท็กเปิด <think> แต่แอบใส่แท็กปิด </think> ไว้ข้างหน้า
  if (cleaned.includes('</think>')) {
    cleaned = cleaned.substring(cleaned.indexOf('</think>') + 8);
  }
  
  // ล้างคราบโครงสร้าง <think> ... </think> ปกติที่หลงเหลือ
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
  cleaned = cleaned.trim();

  // 🛡️ Fallback Recovery: หากกรองกล่องคิดทิ้งแล้วเนื้อหาหายจนว่างเปล่า
  if (!cleaned && text) {
    console.warn('⚠️ [UDO Guard] ตรวจพบข้อมูลร่างคอนเทนต์ตกค้างในกล่องความคิด กำลังดึงข้อมูลคืนมา...');
    cleaned = text.replace(/<\/?think>/g, '').trim();
  }

  return cleaned;
}

/**
 * ส่งข้อความยาวโดยแบ่งเป็นก้อนๆ ไม่เกิน 4096 ตัวอักษรต่อข้อความ (Telegram hard limit)
 * พยายามส่งแบบ Markdown ก่อน หากล้มเหลวจะส่งแบบ plain text แทน
 * @param {object} ctx - Telegraf context
 * @param {string} markdownText - ข้อความพร้อม Markdown header
 * @param {string} bodyText - เนื้อหาหลักสำหรับ fallback plain text
 */
async function sendChunked(ctx, markdownText) {
  const LIMIT = 4000; // เผื่อ buffer 96 ตัวอักษรจากขีดจำกัด 4096 ของ Telegram

  // แบ่งข้อความตาม newline เพื่อไม่ให้ตัดกลางบรรทัด
  const chunks = [];
  let current = '';
  for (const line of markdownText.split('\n')) {
    if ((current + '\n' + line).length > LIMIT) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    } catch {
      // หาก Markdown ล้มเหลว ส่งเป็นข้อความธรรมดาแทน
      await ctx.reply(chunk.replace(/[*_`#[\]()]/g, ''));
    }
  }
}

// ข้อความตอบรับเมื่อเปิดรันบอทและทักใช้งานบอท UDO ครั้งแรก
bot.start((ctx) => {
  const sources = Object.keys(UdoNewsAgent.SOURCES).join(', ');
  const categories = Object.keys(UdoNewsAgent.CATEGORIES).join(', ');
  ctx.reply(
    '🦆 สวัสดีครับพี่พร (Phon)! ยินดีต้อนรับสู่ศูนย์บัญชาการ UDO Command Center บน Telegram แบบ Modular Engine ครับ\n\n' +
    '📌 คำสั่งสแตนด์บายพร้อมใช้งาน:\n' +
    '1. /news — ดึงข่าวล่าสุด 5 อันดับจาก Blognone (default)\n' +
    '   ระบุแหล่งข่าวอื่น: /news techcrunch หรือ /news startup\n' +
    `   ชื่อเว็บที่รองรับ: ${sources}\n` +
    `   Category: ${categories}\n\n` +
    '2. /draft หรือ /ร่าง <ข้อความ> — สั่งร่างคอนเทนต์ด้วยสมองกล UDO ดักกรองนิสัยและคำต้องห้ามทันที\n\n' +
    '⚙️ พลังแฮกร่างคำสั่งพิเศษ (Special Commands):\n' +
    '• `/metadata [เรื่อง]` ➡️ เจน HashTag / Slug\n' +
    '• `/slice [เรื่อง]` ➡️ สไลซ์เนื้อหาลง IG/Threads/X\n' +
    '• `/split [เรื่อง]` ➡️ แบ่งเนื้อหาตามโควตาตัวอักษรแพลตฟอร์ม\n' +
    '• `/duckrun [เรื่อง]` ➡️ ส่งคอนเทนต์เข้าเครื่องวิจารณ์ความคลีน\n' +
    '• `/update` ➡️ สรุปประเด็นเอาไปเซฟอัปเดตไฟล์ Master'
  );
});

// ============================================================================
// 📰 1. โหมดดักรับสั่งสรุปข่าวสารไอที 5 อันดับแรก (IT News summary)
// ============================================================================
bot.hears([/^\/news(\s+\S+)?$/, 'สรุปข่าว', 'ดึงข่าว'], async (ctx) => {
  const words = ctx.message.text.trim().split(/\s+/);
  const source = words.length > 1 ? words[words.length - 1].toLowerCase() : 'blognone';

  let newsAgent;
  try {
    newsAgent = new UdoNewsAgent({ aiModel: 'qwen3.5:9b', source });
  } catch (e) {
    return ctx.reply(`⚠️ ${e.message}`);
  }

  if (isAiProcessing) {
    return ctx.reply('⚠️ UDO กำลังประมวลผลงานของพี่พรคิวก่อนหน้านี้อยู่ครับ โปรดรอสักครู่นะครับเพื่อไม่ให้แรม Mac ทำงานหนักเกินไป');
  }

  let loadingMessage;
  try {
    isAiProcessing = true;
    await ctx.sendChatAction('typing');
    loadingMessage = await ctx.reply(`📡 UDO กำลังดึงข่าว 5 อันดับจาก *${source}* และส่งให้ Qwen 3.5 สรุปให้อยู่นะครับพี่พร...`, { parse_mode: 'Markdown' });

    const newsSummary = await newsAgent.getLatestNewsSummary();

    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});

      await sendChunked(ctx, `📰 **[รายงานข่าวสาร 5 อันดับจาก ${source.toUpperCase()} โดย UDO]**\n\n${newsSummary}`);

  } catch (error) {
    console.error('[UDO Gateway] เกิดความผิดพลาดใน News Route:', error.message);
    if (loadingMessage) {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});
    }
    await ctx.reply('⚠️ ขออภัยครับพี่พร เกิดข้อผิดพลาดทางเทคนิคขณะสแกนสรุปข่าว ลองตรวจสอบสถานะ Ollama อีกครั้งนะครับ');
  } finally {
    isAiProcessing = false;
  }
});

// ============================================================================
// ✍️ 2. โหมดแกะสกัดข้อความเพื่อ "ร่างคอนเทนต์" และกลุ่มคำสั่งพิเศษ (Special Commands)
// ============================================================================
bot.on(message('text'), async (ctx) => {
  const userMessage = ctx.message.text.trim();

  // ดักตรวจสอบกลุ่มคำสั่งพิเศษทั้งหมดตามคู่มือ PART 8
  const isCommandMetadata = userMessage.startsWith('/metadata');
  const isCommandSlice = userMessage.startsWith('/slice');
  const isCommandSplit = userMessage.startsWith('/split');
  const isCommandDuckRun = userMessage.startsWith('/duckrun');
  const isCommandUpdate = userMessage.startsWith('/update');
  
  const isSlashDraft = userMessage.toLowerCase().startsWith('/draft') || userMessage.startsWith('/ร่าง');
  const isPrefixDraft = userMessage.toLowerCase().startsWith('draft') || userMessage.startsWith('ร่าง');
  const isDraftRequest = isSlashDraft || isPrefixDraft;

  // รวมศูนย์คัดแยกเพื่อรันเข้าท่อประมวลผล UDO Engine
  const isUdoRequest = isCommandMetadata || isCommandSlice || isCommandSplit || isCommandDuckRun || isCommandUpdate || isDraftRequest;

  if (isUdoRequest) {
    if (isAiProcessing) {
      return ctx.reply('⚠️ ตอนนี้ระบบกำลังสรุปข่าวหรือทำงานอื่นค้างอยู่ครับพี่พร โปรดรอสักครู่ค่อยยิงคำสั่งร่างใหม่นะครับ');
    }

    let actualPrompt = userMessage;
    let taskPrompt = '';

    // สับเศษรหัสคำสั่งออกให้เหลือเฉพาะวัตถุดิบคอนเทนต์ดิบคลีนๆ ส่งไปประมวลผล
    if (isCommandMetadata) {
      taskPrompt = `ปฏิบัติตามคำสั่งพิเศษ /metadata ของระบบ PART 8:\nจงวิเคราะห์เนื้อหาต่อไปนี้ แล้วส่งคืนค่า Hashtag, Slug, Category(website), Law, Filename(cover image), และ Alt Text ตามกฎอย่างเคร่งครัด`;
      actualPrompt = userMessage.replace('/metadata', '').trim();
    } else if (isCommandSlice) {
      taskPrompt = `ปฏิบัติตามคำสั่งพิเศษ /slice ใน PART 8:\nจงทำการ "เฉือน" เนื้อหาดิบต่อไปนี้ให้กลายเป็น Reusable Assets ตาม Format ของ Instagram, Threads และ X ตรวจคำและ White Space ให้เหมาะกับระดับพลังงานต่ำ (G.1-G.2)`;
      actualPrompt = userMessage.replace('/slice', '').trim();
    } else if (isCommandSplit) {
      taskPrompt = `ปฏิบัติตามคำสั่งพิเศษ /split ใน PART 8:\nจงปรับปรุงและแบ่งเนื้อหาต่อไปนี้สำหรับโพสต์ลง Instagram, Threads, X(Twitter) เช็กโควตาตัดคำของ Threads และ X แบ่งเป็นก้อนๆ หลาย Threads ได้ชัดเจน`;
      actualPrompt = userMessage.replace('/split', '').trim();
    } else if (isCommandDuckRun) {
      taskPrompt = `ปฏิบัติตามคำสั่งวิเคราะห์ดุเดือด /duckrun ใน PART 8:\nจงใช้เลนส์ของระบบตรวจสอบและตอบตรงๆ ว่า คอนเทนต์นี้ใช้ "อารมณ์" นำหรือเปล่า? (ขัดกฎ Law 1 ไหม), อธิบายเยอะยืดเยื้อไปไหม? (ขัดกฎ Law 2), และมันสร้าง Asset ระยะยาวหรือแค่ Active ไปวันๆ? (ขัดกฎ Law 3)`;
      actualPrompt = userMessage.replace('/duckrun', '').trim();
    } else if (isCommandUpdate) {
      taskPrompt = `ปฏิบัติตามคำสั่ง /update ใน PART 8:\nจงประมวลข้อความล่าสุดนี้ แล้วสรุปประเด็นสำคัญเป็น Bullet points สั้น คลีน เพื่อให้พี่พรกด Copy ไปแปะทับในไฟล์สรุปอัปเดตข้อมูลได้ทันที`;
      actualPrompt = userMessage.replace('/update', '').trim();
    } else if (isDraftRequest) {
      taskPrompt = `จงสวมบทบาทตามกฎและเงื่อนไขทั้งหมดในข้อกำหนดระบบ เพื่อทำหน้าที่เขียน "โครงร่างคอนเทนต์" จากหัวข้อด้านล่างนี้ออกมาอย่างมีประสิทธิภาพสูงสุด:`;
      if (isSlashDraft) {
        const parts = userMessage.split(/\s+/);
        actualPrompt = parts.slice(1).join(' ').trim();
        if (!actualPrompt) {
          return ctx.reply('🦆 กรุณาใส่รายละเอียดคอนเทนต์ตามหลังคำสั่งด้วยนะครับพี่พร เช่น:\n`/draft แนะนำตัวตนแอดเป็ดสั้นๆ`', { parse_mode: 'Markdown' });
        }
      }
    }

    let loadingMessage;
    try {
      isAiProcessing = true;
      await ctx.sendChatAction('typing');
      loadingMessage = await ctx.reply('🧠 UDO รับคำสั่งด่วน! กำลังสืบค้นข้อมูลจากโฟลเดอร์ config/ เพื่อป้อนให้ Qwen 3.5 ทำงานสักครู่นะครับพี่พร...');

      // 1. วิ่งไปอ่านไฟล์ .md ทั้งหมดใน config/ มารวมร่างกันแบบเรียลไทม์ (Dynamic Context Loading)
      const configContext = assembleUdoPrompts();

      // 2. เย็บก้อน Payload ผสมผสานหน้างาน
      const finalPrompt = `${configContext}\n\n[DIRECTIVE INSTRUCTION]\n${taskPrompt}\n\n[โจทย์ดิบจากพี่พร (Phon)]\n"${actualPrompt}"`;

      // 3. ยิงประมวลผลตรงเข้าเครื่องหลังบ้าน Ollama
      // think: false — ปิดโหมดคิดลึก, num_predict: 900 — จำกัดความยาว output ป้องกัน timeout 90s
      const response = await ollama.generate({
        model: DRAFT_MODEL,
        prompt: finalPrompt,
        think: false,
        options: { num_predict: 900 },
      });

      // fallback ไปใช้ response.thinking หาก Ollama แยก thinking ออกจาก response แล้ว response ว่าง
      const aiRawText = response.response || response.thinking || '';
      const cleanDraft = cleanAiResponse(aiRawText);

      if (!cleanDraft || cleanDraft.length === 0) {
        throw new Error('ผลลัพธ์ร่างคอนเทนต์ที่ได้จาก AI ว่างเปล่า');
      }

      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});

      await sendChunked(ctx, `✍️ **[ปฏิบัติการด่วนดำเนินการสำเร็จโดย UDO]**\n\n${cleanDraft}`);

    } catch (error) {
      console.error('[UDO Gateway] เกิดข้อผิดพลาดใน ท่อสอยคำสั่งระบบ:', error.message);
      if (loadingMessage) {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});
      }
      // .catch(() => {}) ป้องกัน ctx.reply โยน error ออกจาก catch block อีกครั้ง
      await ctx.reply('⚠️ ขออภัยครับพี่พร เกิดข้อขัดแย้งระหว่างการประมวลผลข้อมูลในระบบโฟลเดอร์คอนฟิก').catch(() => {});
    } finally {
      isAiProcessing = false;
    }
  } else {
    // โหมดตอบกลับการพิมพ์ทักเล่นทั่วไป
    ctx.reply('🦆 ได้รับข้อความแล้วครับพี่พร! (สั่งงานพิเศษกดส่ง /news, /metadata, /slice, /split, /duckrun หรือ /draft ตามด้วยเรื่องราวได้เลยค้าบ)');
  }
});

// ดักจับ error จาก middleware ทุกตัวไว้ที่นี่ก่อนที่มันจะหลุดไปทำ polling loop พัง
// หากไม่มี bot.catch() Telegraf จะ re-throw error เข้าไปใน bot.launch() ทำให้บอทล้มเหลว
bot.catch((err, ctx) => {
  console.error('[UDO Gateway] Unhandled middleware error:', err.message);
  ctx.reply('⚠️ เกิดข้อผิดพลาดบางอย่างครับพี่พร โปรดลองใหม่อีกครั้ง').catch(() => {});
});

// สตาร์ทรันระบบ Telegram Bot
bot.launch({ dropPendingUpdates: true });
console.log('🚀 [UDO Gateway] ระบบประตูกลเวอร์ชัน Modular Config เปิดทำการแล้ว...');

// 🛡️ โล่ป้องกันข้อผิดพลาดจากเครือข่ายกระแทกภายนอก (Global Process Guard)
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [UDO Guard] คลี่คลายอาการกระแทกของ Promise สะดุดจากภายนอกเรียบร้อย:', reason);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));