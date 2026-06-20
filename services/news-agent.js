import { UdoScraper } from './scraper.js';
import ollama from 'ollama';
import * as cheerio from 'cheerio';

/**
 * UdoNewsAgent - เอเจนต์สรุปข่าวสารและย่อยข้อมูลไอทีด้วย Qwen 3.5 (9B)
 * ออกแบบโครงสร้างแบบทนทานสูง (Fault-Tolerant Clean Architecture)
 * รองรับการดึงข้อมูลทั้ง Atom Feed และ RSS Feed พร้อมระบบดีบั๊กประเมินการตรวจจับ Cloudflare
 */
export class UdoNewsAgent {
  /**
   * @param {Object} config - การตั้งค่าตัวแปรโมเดลและพิกัดข่าวสาร
   */
  constructor(config = {}) {
    this.scraper = new UdoScraper();
    this.aiModel = config.aiModel || 'qwen3.5:9b';
    // ใช้ Atom XML Feed เป็นหลัก
    this.newsUrl = config.newsUrl || 'https://www.blognone.com/atom.xml';
  }

  /**
   * ดึงข่าวไอทีล่าสุดและส่งต่อให้สมองกลย่อยประเด็นสำคัญในคำสั่งเดียว
   * @param {number} limit - จำนวนบทความข่าวสารสูงสุดที่ต้องการสรุป (เริ่มต้นที่ 10)
   * @returns {Promise<string>} - ผลลัพธ์สรุปข่าวสารรูปประโยคแบบ Markdown
   */
  async getLatestNewsSummary(limit = 10) {
    try {
      console.log(`📡 [UDO News] กำลังเริ่มต้นดึงข้อมูลผ่านระบบปิดจาก: ${this.newsUrl}`);
      
      // 1. ดึงข้อมูลดิบจากหน้าเว็บ (ดึงมาเป็นข้อความดิบเพื่อทำการตรวจสอบประเภทก่อนสกัด)
      const rawPayload = await this.scraper.fetchHtml(this.newsUrl);
      
      if (!rawPayload || rawPayload.trim().length === 0) {
        throw new Error('ระบบปลายทางส่งข้อมูลกลับมาเป็นค่าว่างเปล่า');
      }

      // 2. ตรวจสอบว่าโดน Cloudflare บล็อกและแอบส่งหน้าเว็บ HTML ท้าทายกลับมาหรือไม่
      const isHtmlResponse = rawPayload.trim().startsWith('<html') || 
                             rawPayload.trim().startsWith('<!DOCTYPE html') ||
                             rawPayload.includes('cloudflare') ||
                             rawPayload.includes('noscript');

      if (isHtmlResponse) {
        console.error('⚠️ [UDO Warning] ตรวจพบข้อมูลขากลับเป็นหน้าเว็บ HTML ทั่วไป แทนที่จะเป็น XML Feed!');
        console.error('📝 ตัวอย่างเนื้อหาที่ได้รับ (First 300 chars):');
        console.error(`----------------\n${rawPayload.substring(0, 300).trim()}\n----------------`);
        throw new Error('ตรวจพบระบบป้องกันของ Cloudflare หรือการส่งคืนประเภทข้อมูลผิดพลาด (ได้รับ HTML แทน XML)');
      }

      // 3. เริ่มต้นแกะสกัดข้อมูลด้วยระบบตรวจจับอัจฉริยะ (Adaptive Parser)
      // ใช้ xmlMode: true เพื่อจัดการแท็ก self-closing และ namespace ของ Atom/RSS ได้ถูกต้อง
      const $ = cheerio.load(rawPayload, { xmlMode: true });
      const newsList = [];

      // ตรวจสอบโครงสร้าง: ค้นหาว่าใช้โครงสร้างข่าวแบบ Atom (<entry>) หรือ RSS (<item>)
      const isAtom = $('entry').length > 0;
      const isRss = $('item').length > 0;

      if (isAtom) {
        console.log('🤖 [UDO News] ตรวจพบโครงสร้างข่าวสารแบบ Atom Feed');
        $('entry').each((index, element) => {
          const $el = $(element);
          
          // ลิงก์ของ Atom มักจะฝังอยู่ในแอตทริบิวต์ href ของแท็ก <link>
          let link = $el.find('link').attr('href') || $el.find('link').text().trim();
          
          newsList.push({
            title: $el.find('title').text().trim(),
            link: link,
            description: $el.find('summary').text().trim() || $el.find('content').text().trim()
          });
        });
      } else if (isRss) {
        console.log('🤖 [UDO News] ตรวจพบโครงสร้างข่าวสารแบบ RSS Feed');
        $('item').each((index, element) => {
          const $el = $(element);
          
          // ลิงก์ของ RSS มักจะอยู่เป็นค่าข้อความตรงกลางแท็ก <link>
          let link = $el.find('link').text().trim() || $el.find('link').attr('href');
          
          newsList.push({
            title: $el.find('title').text().trim(),
            link: link,
            description: $el.find('description').text().trim()
          });
        });
      } else {
        // หากไม่พบคอนเทนเนอร์ทั้งสองแบบ ให้ทำการพ่นข้อความระบบดีบั๊กเพื่อช่วยเหลือการพัฒนา TDD
        console.error('❌ [UDO Parser Error] ไม่พบแท็ก <entry> หรือ <item> ในโครงสร้างไฟล์ที่ได้รับ');
        console.error('📝 ตัวอย่างไฟล์ที่ได้รับจริง (First 300 chars):');
        console.error(`----------------\n${rawPayload.substring(0, 300).trim()}\n----------------`);
        throw new Error('ไม่สามารถระบุโครงสร้าง XML Feed ได้ (ไม่พบ entry หรือ item)');
      }

      // 4. เลือกรายการข่าวสารจำกัดตามจำนวนที่ระบบต้องการ
      const topNews = newsList.slice(0, limit);
      
      if (topNews.length === 0) {
        throw new Error('ไม่พบข้อมูลข่าวสารพร้อมใช้งานภายใน Feed');
      }

      // 5. แปลงก้อนข่าวสารให้อยู่ในรูปประโยค Context สำหรับส่งให้ AI
      const newsContext = topNews.map((news, index) => {
        const title = news.title || 'ไม่มีหัวข้อข่าว';
        const link = news.link || '#';
        const description = news.description || 'ไม่มีรายละเอียดเพิ่มเติม';
        // แปลง protocol-relative URL (//example.com) → https://example.com
        let cleanLink = link;
        if (cleanLink && cleanLink.startsWith('//')) {
          cleanLink = `https:${cleanLink}`;
        }
        return `[ข่าวที่ ${index + 1}] หัวข้อ: ${title}\nลิงก์อ่านต่อ: ${cleanLink}\nเรื่องย่อ: ${description.substring(0, 150)}...\n---`;
      }).join('\n');

      console.log(`🧠 [UDO News] คัดกรองข่าวสำเร็จจำนวน ${topNews.length} ข่าว กำลังเชื่อมโยงส่งต่อให้โมเดล: ${this.aiModel}`);

      // กำหนดบทบาทควบคุมภาษาและสำนวน "แอดเป็ด"
      const systemPrompt = `คุณคือ "แอดเป็ด" สุดยอด AI Content Creator ประจำระบบ UDO
หน้าที่ของคุณคือรับข่าวสารไอทีล่าสุด แล้วทำ "สรุปประเด็นสำคัญ" ให้เข้าใจง่าย ดึงดูด กระชับ และคลีนที่สุด

กติกาในการสรุปข่าวสาร:
1. เขียนสรุปภาษาไทยที่เป็นกันเอง สนุกสนาน คลีน และจัดเรียงหัวข้อให้อ่านง่าย สบายตา
2. ห้ามทักทายเกริ่นนำ หรือพูดเปิดเรื่องใดๆ ทั้งสิ้น ให้พาดหัวเปิดรายงานตัวเนื้อหาข่าวสารในประโยคแรกทันที
3. สรุปใจความหลักเป็นประเด็นแบบ Bullet points หรือหัวข้อย่อยสั้นๆ 1-2 บรรทัดต่อ 1 ข่าวสาร
4. แนบลิงก์ปลายทางของข่าวแต่ละเรื่องให้คลิกอ่านต่อได้สะดวก
5. ตกแต่งด้วย Emoji ที่สอดคล้องกับข่าวสารเพื่อเพิ่มมิติความน่าสนใจ
6. ปฏิเสธการพิมพ์ขั้นตอนการคิดในใจอย่าง <think>...</think> ออกมายังคำตอบหลักเด็ดขาด ให้พ่นเฉพาะข้อความที่สรุปแล้วเท่านั้น`;

      const prompt = `${systemPrompt}\n\nนี่คือรายชื่อเนื้อความข่าวดิบไอทีล่าสุด โปรดจัดโครงสร้างสรุปย่อย:\n\n${newsContext}`;

      // ส่งคำขอเข้าสู่ระบบ Ollama Engine
      const response = await ollama.generate({
        model: this.aiModel,
        prompt: prompt
      });

      if (!response || !response.response) {
        throw new Error(`โมเดล AI (${this.aiModel}) ตอบกลับค่าว่างเปล่า หรือเกิดข้อขัดข้องในระบบประมวลผลของ Ollama`);
      }

      const aiText = response.response;
      console.log(`✨ [UDO News] ได้รับคำตอบดิบจาก Ollama เรียบร้อยแล้ว (ขนาด: ${aiText.length} ตัวอักษร)`);

      const cleanedResult = this.cleanResponse(aiText);
      if (!cleanedResult || cleanedResult.trim().length === 0) {
        throw new Error('ผลสรุปข่าวจาก AI เป็นค่าว่างเปล่าหลังจากหักล้างประวัติการคิดในใจ (<think>) เรียบร้อยแล้ว');
      }

      return cleanedResult;

    } catch (error) {
      console.error('🔴 [UDO News] เกิดความล้มเหลวระหว่างดำเนินการประมวลผลข่าว:', error.message);
      throw error;
    }
  }

  /**
   * ฟังก์ชันชำระล้างคำตอบ ปล้นสะดมแท็กขั้นตอนการคิด <think> ออกจากข้อความ
   * @param {string} text - ข้อความจากระบบ AI
   * @returns {string} - ข้อความสรุปเนื้อหาที่สะอาดและจัดรูปใหม่เรียบร้อย
   */
  cleanResponse(text) {
    if (!text) return '';
    
    let cleaned = text;
    
    // 🛡️ ระบบสกัดขั้นสูง: ป้องกันกรณีโมเดลแอบพ่นขั้นตอนคิดลึกออกมาก่อนตั้งแต่ตัวอักษรแรกโดยลืมใส่แท็กเปิด <think>
    if (cleaned.includes('</think>')) {
      cleaned = cleaned.substring(cleaned.indexOf('</think>') + 8);
    }
    
    // ล้างแท็กและขั้นตอนคิดลึก <think>...</think> มาตรฐานที่เหลือออกไปทั้งหมด
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
    
    return cleaned.trim();
  }
}

// ============================================================================
// 🧪 ระบบ Unit Test จำลองประสิทธิภาพหลังบ้าน (TDD Ready Suite)
// สั่งรันเพื่อตรวจสอบลอจิกระดับหน่วยบริการใน Terminal: node services/news-agent.js
// ============================================================================
async function runSelfTest() {
  console.log('🧪 [TDD] เริ่มต้นระบบทดสอบการสรุปและประมวลผลข่าวจริงผ่านระบบจำลอง...');
  const testAgent = new UdoNewsAgent({
    aiModel: 'qwen3.5:9b'
  });

  try {
    const result = await testAgent.getLatestNewsSummary(3); // ทดสอบดึงพรีวิวสั้นๆ 3 ข่าวแรก
    
    // 🛡️ ปรับปรุงระบบ Assert สไตล์ TDD สากล (Strict Check)
    // หากตรวจพบว่าผลลัพธ์ไม่ผ่านเกณฑ์ จะโยน Error หยุดระบบทันที เพื่อส่งสัญญาณล้มเหลวไปบล็อก catch อย่างถูกต้อง
    if (!result || result.trim().length === 0) {
      throw new Error('เทสล้มเหลว: ผลสรุปข่าวเป็นค่าว่างเปล่า (Empty Result)');
    }
    if (result.includes('<think>')) {
      throw new Error('เทสล้มเหลว: ระบบตรวจพบขั้นตอนความคิด (<think>) หลุดรอดมายังผลลัพธ์สุดท้าย');
    }
    
    console.log('✅ [TDD] การทดสอบดึงและสรุปข่าวสารจาก XML Feed จริงผ่านฉลุย 100%!');
    console.log('📊 หน้าตาข้อความที่จะสแตนด์บายส่งต่อไปยัง Gateway:\n');
    console.log(result);
  } catch (error) {
    console.error('❌ [TDD] การทดสอบล้มเหลวพบข้อผิดพลาด:', error.message);
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runSelfTest();
}
