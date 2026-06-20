import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { UdoNewsAgent } from './services/news-agent.js';
import ollama from 'ollama';
import dotenv from 'dotenv';

// โหลดค่ากำหนดตัวแปรสภาพแวดล้อมจากไฟล์ .env
dotenv.config();

// 🛡️ ระบบการตรวจเซ็กความปลอดภัยขั้นต้น
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ Error: ไม่พบ TELEGRAM_BOT_TOKEN ในไฟล์ .env โปรดระบุคีย์บอทให้ถูกต้อง');
  process.exit(1);
}

// เริ่มต้นเปิดระบบประตูกล Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// กำหนดโมเดลสำหรับใช้ร่างคอนเทนต์ด่วน
const DRAFT_MODEL = 'qwen3.5:9b';

// 🔒 ตัวล็อคคิวแบบรวมศูนย์ (Unified Concurrency Lock)
// ป้องกันไม่ให้ AI รันงานซ้อนกันในแรม (เช่น สั่งสรุปข่าวและสั่งร่างคอนเทนต์พร้อมกัน) เพื่อถนอมเครื่อง Mac 36GB
let isAiProcessing = false;

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
  // ระบบจะกู้คืนเนื้อความดิบกลับมา แล้วสับเฉพาะแท็กหัวท้ายทิ้งดื้อๆ เพื่อให้พี่พรได้รับเนื้อหางานเสมอ
  if (!cleaned && text) {
    console.warn('⚠️ [UDO Guard] ตรวจพบข้อมูลร่างคอนเทนต์ตกค้างในกล่องความคิด กำลังดึงข้อมูลคืนมา...');
    cleaned = text.replace(/<\/?think>/g, '').trim();
  }

  return cleaned;
}

// ข้อความตอบรับเมื่อเปิดรันบอทและทักใช้งานบอท UDO ครั้งแรก
bot.start((ctx) => {
  const sources = Object.keys(UdoNewsAgent.SOURCES).join(', ');
  const categories = Object.keys(UdoNewsAgent.CATEGORIES).join(', ');
  ctx.reply(
    '🦆 สวัสดีครับพี่พร (Phon)! ยินดีต้อนรับสู่ศูนย์บัญชาการ UDO Command Center บน Telegram ครับ\n\n' +
    '📌 คำสั่งสแตนด์บายพร้อมใช้งาน:\n' +
    '1. /news — ดึงข่าวล่าสุด 5 อันดับจาก Blognone (default)\n' +
    '   ระบุแหล่งข่าวอื่น: /news techcrunch หรือ /news startup\n' +
    `   ชื่อเว็บที่รองรับ: ${sources}\n` +
    `   Category: ${categories}\n` +
    '2. /draft <ข้อความ> — ให้ Qwen 3.5 ร่างคอนเทนต์ทันที'
  );
});

// ============================================================================
// 📰 1. โหมดดักรับสั่งสรุปข่าวสารไอที 5 อันดับแรก (IT News summary)
// ============================================================================
bot.hears([/^\/news(\s+\S+)?$/, 'สรุปข่าว', 'ดึงข่าว'], async (ctx) => {
  // แยกชื่อแหล่งข่าวจากคำสั่ง — คำสุดท้ายหลัง keyword คือ source (ถ้าไม่มีใช้ค่า default blognone)
  const words = ctx.message.text.trim().split(/\s+/);
  const source = words.length > 1 ? words[words.length - 1].toLowerCase() : 'blognone';

  // ตรวจสอบชื่อแหล่งข่าวก่อนล็อคคิว เพื่อตอบ error ได้ทันทีโดยไม่กินแรม
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

    try {
      await ctx.reply(`📰 **[รายงานข่าวสาร 5 อันดับจาก ${source.toUpperCase()} โดย UDO]**\n\n${newsSummary}`, { parse_mode: 'Markdown' });
    } catch (parseError) {
      const plainSummary = newsSummary.replace(/[*_`#]/g, '');
      await ctx.reply(`📰 [รายงานข่าวสาร 5 อันดับจาก ${source.toUpperCase()} โดย UDO]\n\n${plainSummary}`);
    }

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
// ✍️ 2. โหมดแกะสกัดข้อความเพื่อ "ร่างคอนเทนต์" (Dynamic Content Drafting)
// ============================================================================
bot.on(message('text'), async (ctx) => {
  const userMessage = ctx.message.text.trim();

  // ตรวจเช็กว่าประโยคของพี่พรขึ้นต้นด้วย /draft, /ร่าง, draft, หรือ ร่าง
  const isSlashDraft = userMessage.toLowerCase().startsWith('/draft') || userMessage.startsWith('/ร่าง');
  const isPrefixDraft = userMessage.toLowerCase().startsWith('draft') || userMessage.startsWith('ร่าง');
  const isDraftRequest = isSlashDraft || isPrefixDraft;

  if (isDraftRequest) {
    // ป้องกันการแรมนัดหยุดงานซ้ำซ้อน
    if (isAiProcessing) {
      return ctx.reply('⚠️ ตอนนี้ระบบกำลังสรุปข่าวหรือทำงานอื่นค้างอยู่ครับพี่พร โปรดรอสักครู่ค่อยยิงคำสั่งร่างใหม่นะครับ');
    }

    // แยกเอาเนื้อหาข้อความจริงๆ ออกมาพิมพ์ส่งให้ AI (ตัดคำสั่งสแลชออกหากพี่พรพิมพ์แบบคำสั่ง)
    let actualPrompt = userMessage;
    if (isSlashDraft) {
      const parts = userMessage.split(/\s+/);
      actualPrompt = parts.slice(1).join(' ').trim();
      
      // ป้องกันกรณีพิมพ์แค่ตัวคำสั่ง /draft โล่งๆ ไม่มีรายละเอียดตามหลัง
      if (!actualPrompt) {
        return ctx.reply('🦆 กรุณาใส่รายละเอียดคอนเทนต์ตามหลังคำสั่งด้วยนะครับพี่พร เช่น:\n`/draft แนะนำตัวตนแอดเป็ดสั้นๆ`', { parse_mode: 'Markdown' });
      }
    }

    let loadingMessage;
    try {
      // ตั้งตัวล็อคสถานะประมวลผล
      isAiProcessing = true;

      // 1. ส่งสถานะ typing ให้พี่พรเห็นการเคลื่อนไหวหน้าจอ
      await ctx.sendChatAction('typing');
      loadingMessage = await ctx.reply('🧠 UDO รับคำสั่งด่วน! กำลังส่งข้อมูลให้ Qwen 3.5 ร่างคอนเทนต์แอดเป็ดให้สักครู่นะครับพี่พร...');

      // 2. จัดเตรียม System Prompt คุมกรอบนิสัยและโครงสร้างผลงานของแอดเป็ด (Conventions Control)
      const systemPrompt = `คุณคือ "แอดเป็ด" สุดยอด AI Content Creator ผู้เชี่ยวชาญการร่างเนื้อหาคอนเทนต์ให้ออกมาเฉียบคม สนุกสนาน คลีน และได้สาระ
กติกาการร่างคอนเทนต์:
1. เขียนเนื้อหาให้สั้น กระชับ คลีน จัดแบ่งหัวข้อและ bullet points ให้อ่านง่าย สบายตา
2. ใช้สำนวนภาษาไทยที่เป็นกันเอง มีสาระ น่าติดตาม และแฝงความตลกเล็กน้อย
3. ใส่ Emoji สวยงามประกอบเรื่องราวให้น่าดึงดูดสายตา
4. ตอบเฉพาะเนื้อหาโครงร่างคอนเทนต์หลักตรงๆ ห้ามทักทายพูดเกริ่นนำใดๆ ทั้งสิ้นเด็ดขาด
5. ปฏิเสธการพ่นขั้นตอนการคิดในใจอย่าง <think>...</think> ออกมายังผลลัพธ์สุดท้าย ให้พ่นเฉพาะงานร่างที่สะอาดแล้วเท่านั้น`;

      const prompt = `${systemPrompt}\n\nโจทย์ระบุในการร่างคอนเทนต์จากพี่พร (Phon):\n"${actualPrompt}"`;

      // 3. ส่งคำขอดักคุยกับระบบประมวลผลหลักของ Ollama
      const response = await ollama.generate({
        model: DRAFT_MODEL,
        prompt: prompt
      });

      const aiRawText = response.response || '';
      const cleanDraft = cleanAiResponse(aiRawText);

      if (!cleanDraft || cleanDraft.length === 0) {
        throw new Error('ผลลัพธ์ร่างคอนเทนต์ที่ได้จาก AI ว่างเปล่า');
      }

      // 4. ลบป้ายรอโหลดและพ่นร่างงานคุณภาพสูงส่งกลับหาพี่พรทันที
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});

      try {
        await ctx.reply(`✍️ **[โครงร่างคอนเทนต์โดย UDO สำหรับพี่พร]**\n\n${cleanDraft}`, { parse_mode: 'Markdown' });
      } catch (parseErr) {
        console.warn('⚠️ เกิดสัญลักษณ์ Markdown ไม่รองรับ สลับมาส่งแบบข้อความทั่วไป...');
        const plainDraft = cleanDraft.replace(/[*_`#]/g, '');
        await ctx.reply(`✍️ [โครงร่างคอนเทนต์โดย UDO สำหรับพี่พร]\n\n${plainDraft}`);
      }

    } catch (error) {
      console.error('[UDO Gateway] เกิดข้อผิดพลาดใน Draft Route:', error.message);
      if (loadingMessage) {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id).catch(() => {});
      }
      await ctx.reply('⚠️ ขออภัยครับพี่พร เกิดข้อขัดแย้งขณะที่ระบบพยายามร่างคอนเทนต์ให้พี่ โปรดตรวจเช็ก Ollama ของพี่อีกครั้งนะครับ');
    } finally {
      // ปลุกสิทธิ์ล็อกแรมกลับมาคืนสว่าง
      isAiProcessing = false;
    }
  } else {
    // หากพิมพ์คุยเล่นนอกเหนือจากสองโหมดคำสั่งหลัก
    ctx.reply('🦆 ได้รับข้อความแล้วครับพี่พร! (หากต้องการสรุปข่าว พิมพ์ว่า "สรุปข่าว" หรือส่ง /news / ส่วนต้องการร่างงาน ส่งคำสั่งเป็น /draft หรือ /ร่าง ตามด้วยข้อความได้เลยครับ)');
  }
});

// สตาร์ทรันระบบ Telegram Bot พร้อมตั้งค่า dropPendingUpdates เพื่อล้างข้อความประวัติค้างสะสมขณะออฟไลน์ทิ้งทันที
bot.launch({ dropPendingUpdates: true })
  .then(() => console.log(`🚀 [UDO Gateway] ระบบประตูกลแบรนด์ UDO พร้อมโมดูลสรุปข่าว/ร่างคอนเทนต์ เปิดทำการสำเร็จแล้ว...`))
  .catch((err) => console.error('💥 ไม่สามารถติดตั้งระบบรันคลัง Bot บัญชาการได้:', err));

// 🛡️ โล่ป้องกันข้อผิดพลาดจากเครือข่ายกระแทกภายนอก (Global Process Guard)
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [UDO Guard] คลี่คลายอาการกระแทกของ Promise สะดุดจากภายนอกเรียบร้อย:', reason);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
