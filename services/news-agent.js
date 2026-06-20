import { UdoScraper } from './scraper.js';
import ollama from 'ollama';
import * as cheerio from 'cheerio';

/**
 * UdoNewsAgent - เอเจนต์สรุปข่าวสารด้วย AI โดยระบุแหล่งข่าวเป็นชื่อเว็บหรือ category
 * รองรับ Atom Feed และ RSS Feed พร้อมระบบตรวจจับ Cloudflare
 */
export class UdoNewsAgent {
  // รายชื่อแหล่งข่าวที่รองรับและ Feed URL ปลายทาง
  static SOURCES = {
    blognone:    'https://www.blognone.com/atom.xml',
    techcrunch:  'https://techcrunch.com/feed/',
    theverge:    'https://www.theverge.com/rss/index.xml',
    wired:       'https://www.wired.com/feed/rss',
    arstechnica: 'https://feeds.arstechnica.com/arstechnica/index',
  };

  // mapping จาก category ไปยังชื่อแหล่งข่าว (รองรับทั้งภาษาอังกฤษและไทย)
  static CATEGORIES = {
    tech:          'blognone',
    ไอที:          'blognone',
    startup:       'techcrunch',
    สตาร์ทอัพ:     'techcrunch',
    gadget:        'theverge',
    แกดเจ็ต:       'theverge',
    science:       'wired',
    วิทยาศาสตร์:   'wired',
    ai:            'arstechnica',
  };

  /**
   * แปลงชื่อแหล่งข่าวหรือ category เป็น Feed URL
   * โยน Error ทันทีหากระบุชื่อที่ไม่รู้จัก เพื่อป้องกันเรียกใช้งาน URL ผิดพลาด
   * @param {string} source - ชื่อเว็บหรือ category
   * @returns {string} Feed URL
   */
  static resolveSource(source) {
    if (UdoNewsAgent.SOURCES[source]) {
      return UdoNewsAgent.SOURCES[source];
    }
    const mapped = UdoNewsAgent.CATEGORIES[source];
    if (mapped) {
      return UdoNewsAgent.SOURCES[mapped];
    }
    const validSources = Object.keys(UdoNewsAgent.SOURCES).join(', ');
    const validCategories = Object.keys(UdoNewsAgent.CATEGORIES).join(', ');
    throw new Error(
      `ไม่รู้จักแหล่งข่าว "${source}"\nชื่อเว็บที่ใช้ได้: ${validSources}\nCategory ที่ใช้ได้: ${validCategories}`
    );
  }

  /**
   * @param {Object} config
   * @param {string} [config.source='blognone'] - ชื่อเว็บหรือ category (ไม่รับ URL ตรงๆ)
   * @param {string} [config.aiModel='qwen3.5:9b']
   */
  constructor(config = {}) {
    this.scraper = new UdoScraper();
    this.aiModel = config.aiModel || 'qwen3.5:9b';
    const source = config.source || 'blognone';
    // resolveSource โยน Error ทันทีหากชื่อไม่ถูกต้อง — fail fast ตั้งแต่ต้น
    this.newsUrl = UdoNewsAgent.resolveSource(source);
    this.sourceName = source;
  }

  /**
   * ดึงข่าวล่าสุด 5 อันดับและสรุปด้วย AI
   * @param {number} [limit=5]
   * @returns {Promise<string>} ข้อความสรุปข่าวแบบ Markdown
   */
  async getLatestNewsSummary(limit = 5) {
    try {
      console.log(`[UDO News] ดึงข้อมูลจาก ${this.sourceName}: ${this.newsUrl}`);

      const rawPayload = await this.scraper.fetchHtml(this.newsUrl);

      if (!rawPayload || rawPayload.trim().length === 0) {
        throw new Error('ระบบปลายทางส่งข้อมูลกลับมาเป็นค่าว่างเปล่า');
      }

      // ตรวจสอบว่าโดน Cloudflare บล็อกและส่งหน้า HTML challenge กลับมาแทน XML
      const isHtmlResponse = rawPayload.trim().startsWith('<html') ||
                             rawPayload.trim().startsWith('<!DOCTYPE html') ||
                             rawPayload.includes('cloudflare') ||
                             rawPayload.includes('noscript');

      if (isHtmlResponse) {
        console.error('[UDO News] ตรวจพบ Cloudflare block หรือข้อมูลไม่ใช่ XML Feed');
        console.error(`ตัวอย่าง 300 ตัวอักษรแรก:\n${rawPayload.substring(0, 300).trim()}`);
        throw new Error('ได้รับ HTML แทน XML Feed — อาจถูก Cloudflare บล็อก');
      }

      // ใช้ xmlMode: true เพื่อจัดการแท็ก self-closing และ namespace ของ Atom/RSS ได้ถูกต้อง
      const $ = cheerio.load(rawPayload, { xmlMode: true });
      const newsList = [];

      const isAtom = $('entry').length > 0;
      const isRss  = $('item').length > 0;

      if (isAtom) {
        console.log(`[UDO News] ตรวจพบ Atom Feed จาก ${this.sourceName}`);
        $('entry').each((_, element) => {
          const $el = $(element);
          newsList.push({
            title:       $el.find('title').text().trim(),
            link:        $el.find('link').attr('href') || $el.find('link').text().trim(),
            description: $el.find('summary').text().trim() || $el.find('content').text().trim(),
          });
        });
      } else if (isRss) {
        console.log(`[UDO News] ตรวจพบ RSS Feed จาก ${this.sourceName}`);
        $('item').each((_, element) => {
          const $el = $(element);
          newsList.push({
            title:       $el.find('title').text().trim(),
            link:        $el.find('link').text().trim() || $el.find('link').attr('href'),
            description: $el.find('description').text().trim(),
          });
        });
      } else {
        console.error(`[UDO News] ไม่พบแท็ก <entry> หรือ <item> ใน Feed จาก ${this.sourceName}`);
        console.error(`ตัวอย่าง 300 ตัวอักษรแรก:\n${rawPayload.substring(0, 300).trim()}`);
        throw new Error('ไม่สามารถระบุโครงสร้าง XML Feed ได้ (ไม่พบ entry หรือ item)');
      }

      const topNews = newsList.slice(0, limit);
      if (topNews.length === 0) {
        throw new Error('ไม่พบข้อมูลข่าวสารพร้อมใช้งานภายใน Feed');
      }

      // แปลงรายการข่าวเป็น context string สำหรับส่งให้ AI
      const newsContext = topNews.map((news, index) => {
        const title       = news.title       || 'ไม่มีหัวข้อข่าว';
        const description = news.description || 'ไม่มีรายละเอียดเพิ่มเติม';
        let   link        = news.link        || '#';
        // แปลง protocol-relative URL (//example.com) → https://example.com
        if (link.startsWith('//')) link = `https:${link}`;
        return `[ข่าวที่ ${index + 1}] หัวข้อ: ${title}\nลิงก์: ${link}\nเรื่องย่อ: ${description.substring(0, 150)}...\n---`;
      }).join('\n');

      console.log(`[UDO News] คัดกรองข่าว ${topNews.length} ข่าว กำลังส่งให้ ${this.aiModel}`);

      const systemPrompt = `คุณคือ "แอดเป็ด" สุดยอด AI Content Creator ประจำระบบ UDO
หน้าที่ของคุณคือรับข่าวสารไอทีล่าสุด แล้วทำ "สรุปประเด็นสำคัญ" ให้เข้าใจง่าย ดึงดูด กระชับ และคลีนที่สุด

กติกาในการสรุปข่าวสาร:
1. เขียนสรุปภาษาไทยที่เป็นกันเอง สนุกสนาน คลีน และจัดเรียงหัวข้อให้อ่านง่าย สบายตา
2. ห้ามทักทายเกริ่นนำ หรือพูดเปิดเรื่องใดๆ ทั้งสิ้น ให้พาดหัวเปิดรายงานตัวเนื้อหาข่าวสารในประโยคแรกทันที
3. สรุปใจความหลักเป็นประเด็นแบบ Bullet points หรือหัวข้อย่อยสั้นๆ 1-2 บรรทัดต่อ 1 ข่าวสาร
4. แนบลิงก์ปลายทางของข่าวแต่ละเรื่องให้คลิกอ่านต่อได้สะดวก
5. ตกแต่งด้วย Emoji ที่สอดคล้องกับข่าวสารเพื่อเพิ่มมิติความน่าสนใจ
6. ปฏิเสธการพิมพ์ขั้นตอนการคิดในใจอย่าง <think>...</think> ออกมายังคำตอบหลักเด็ดขาด ให้พ่นเฉพาะข้อความที่สรุปแล้วเท่านั้น`;

      // think: false — ปิดโหมดคิดลึกของ Qwen3 เพื่อให้โมเดลตอบตรงๆ ไม่ผ่าน <think>
      // หาก Ollama เวอร์ชันเก่าไม่รองรับ parameter นี้จะถูกละเว้นโดยอัตโนมัติ
      const response = await ollama.generate({
        model: this.aiModel,
        prompt: `${systemPrompt}\n\nนี่คือรายชื่อเนื้อความข่าวดิบล่าสุดจาก ${this.sourceName} โปรดจัดโครงสร้างสรุปย่อย:\n\n${newsContext}`,
        think: false,
      });

      // Ollama 0.6+ แยก thinking content ออกจาก visible response
      // หาก response.response ว่าง (โมเดลใส่ทุกอย่างใน <think>) ให้ fallback ไปใช้ response.thinking
      const aiText = response?.response || response?.thinking || '';
      if (!aiText) {
        throw new Error(`โมเดล AI (${this.aiModel}) ตอบกลับค่าว่างเปล่า`);
      }

      console.log(`[UDO News] ได้รับคำตอบจาก Ollama (${aiText.length} ตัวอักษร)`);

      const cleanedResult = this.cleanResponse(aiText);
      if (!cleanedResult) {
        throw new Error('ผลสรุปข่าวจาก AI ว่างเปล่าหลังกรอง <think>');
      }

      return cleanedResult;

    } catch (error) {
      console.error('[UDO News] ประมวลผลข่าวล้มเหลว:', error.message);
      throw error;
    }
  }

  /**
   * ลบแท็ก <think>...</think> ออกจากคำตอบ AI เพื่อป้องกัน chain-of-thought รั่วไหลสู่ผู้ใช้
   * @param {string} text
   * @returns {string}
   */
  cleanResponse(text) {
    if (!text) return '';
    let cleaned = text;
    // กรณีโมเดลลืมแท็กเปิด <think> แต่ใส่แท็กปิด </think> ไว้
    if (cleaned.includes('</think>')) {
      cleaned = cleaned.substring(cleaned.indexOf('</think>') + 8);
    }
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
    return cleaned.trim();
  }
}

// ============================================================================
// 🧪 Self-Test Suite
// รันตรงในเทอร์มินัล: node services/news-agent.js
// ============================================================================
async function runSelfTest() {
  console.log('🧪 [TDD] ทดสอบ UdoNewsAgent...');

  // ทดสอบ resolveSource ด้วยชื่อเว็บตรงๆ
  const url = UdoNewsAgent.resolveSource('blognone');
  console.assert(url.includes('blognone.com'), '❌ resolveSource blognone ล้มเหลว');
  console.log('✅ resolveSource ด้วยชื่อเว็บผ่าน');

  // ทดสอบ resolveSource ด้วย category
  const techUrl = UdoNewsAgent.resolveSource('tech');
  console.assert(techUrl.includes('blognone.com'), '❌ resolveSource category tech ล้มเหลว');
  console.log('✅ resolveSource ด้วย category ผ่าน');

  // ทดสอบ resolveSource ชื่อไม่ถูกต้องต้องโยน Error
  try {
    UdoNewsAgent.resolveSource('unknownsource');
    console.error('❌ ควรโยน Error แต่ไม่โยน');
  } catch (e) {
    console.log('✅ resolveSource ชื่อไม่ถูกต้องโยน Error ถูกต้อง');
  }

  // ทดสอบดึงข่าวจริงจาก blognone (ต้องมีอินเทอร์เน็ตและ Ollama)
  console.log('\n🧪 ทดสอบดึงข่าวจริงจาก blognone (top 3)...');
  const agent = new UdoNewsAgent({ source: 'blognone', aiModel: 'qwen3.5:9b' });
  try {
    const result = await agent.getLatestNewsSummary(3);
    if (!result || result.trim().length === 0) throw new Error('ผลสรุปว่างเปล่า');
    if (result.includes('<think>')) throw new Error('<think> หลุดมาในผลลัพธ์');
    console.log('✅ ดึงและสรุปข่าวจริงผ่าน!\n');
    console.log(result);
  } catch (e) {
    console.error('❌ ทดสอบดึงข่าวจริงล้มเหลว:', e.message);
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runSelfTest();
}
