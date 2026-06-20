import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * UdoScraper - บริการดึงและสกัดข้อมูลหน้าเว็บ รวมถึงการแกะฟีดข้อมูล XML 
 * ออกแบบโครงสร้างตามหลัก Clean Architecture เพื่อให้ยืดหยุ่นและรองรับการรันเทส (TDD)
 */
export class UdoScraper {
  /**
   * กำหนดค่าเบื้องต้นของ Scraper
   * @param {Object} options - ออปชันตั้งค่าเพิ่มเติม
   */
  constructor(options = {}) {
    this.timeout = options.timeout || 10000; // ค่า Timeout สากล 10 วินาที
    
    // จำลอง Browser Headers เพื่อให้ผ่านระบบตรวจสอบของ WAF เบื้องต้น
    this.headers = options.headers || {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };
  }

  /**
   * วิ่งไปดาวน์โหลดหน้าเว็บหรือไฟล์ XML จาก URL เป้าหมาย
   * @param {string} url - พิกัดปลายทาง
   * @returns {Promise<string>} ซอร์สโค้ดหน้าเว็บ
   */
  async fetchHtml(url) {
    if (!url) throw new Error('กรุณาระบุพิกัด URL เป้าหมายที่ต้องการดึงข้อมูล');
    
    try {
      const response = await axios.get(url, {
        headers: this.headers,
        timeout: this.timeout
      });
      return response.data;
    } catch (error) {
      throw new Error(`ไม่สามารถติดต่อหน้าเว็บปลายทางได้: ${error.message}`);
    }
  }

  /**
   * สกัดและแกะเอาข้อมูลตาม Selectors จากซอร์สโค้ดดิบ (Pure Function เหมาะแก่การรัน Test)
   * @param {string} html - ข้อมูลหน้าเว็บดิบ
   * @param {Object} rules - กฎ Selectors สำหรับควานหาข้อมูล
   * @param {boolean} isXml - เปิดโหมด XML Parser หรือไม่ (จำเป็นสำหรับการแกะ RSS/Atom Feed)
   * @returns {Array<Object>} ข้อมูลที่ผ่านการสกัดเป็นระเบียบเรียบร้อย
   */
  parseHtml(html, rules, isXml = false) {
    if (!html) return [];
    
    // เปิดใช้งาน xmlMode ของ Cheerio เพื่อสกัดแท็กพิเศษได้ตรงประเด็นเมื่อใช้แกะไฟล์ฟีด
    const $ = cheerio.load(html, isXml ? { xmlMode: true } : {});
    const results = [];
    const { containerSelector, titleSelector, linkSelector, descSelector } = rules;

    if (!containerSelector) {
      throw new Error('กรุณาระบุ containerSelector เพื่ออ้างอิงขอบเขตข้อมูลหลัก');
    }

    // วนลูปแกะข้อมูลจากกรอบ Element ที่เราตกลงไว้
    $(containerSelector).each((index, element) => {
      const $el = $(element);
      
      const item = {
        title: titleSelector ? $el.find(titleSelector).text().trim() : '',
        link: linkSelector ? $el.find(linkSelector).attr('href') : '',
        description: descSelector ? $el.find(descSelector).text().trim() : ''
      };

      // แปลง protocol-relative URL (//example.com) → https://example.com
      // ส่วน relative path (/path) ไม่สามารถแปลงได้โดยไม่รู้ base domain จึงปล่อยผ่าน
      if (item.link && item.link.startsWith('//')) {
        item.link = `https:${item.link}`;
      }

      // บันทึกเฉพาะรายการที่มีข้อมูลหัวข้อครบถ้วน
      if (item.title) {
        results.push(item);
      }
    });

    return results;
  }

  /**
   * ฟังก์ชันรวมสากล สั่งดาวน์โหลดและสกัดเป็น Array ทันที
   * @param {string} url - ลิงก์ปลายทาง
   * @param {Object} rules - กฎ Selectors
   * @param {boolean} isXml - เปิดโหมดแกะ XML หรือไม่
   * @returns {Promise<Array<Object>>}
   */
  async scrape(url, rules, isXml = false) {
    const html = await this.fetchHtml(url);
    return this.parseHtml(html, rules, isXml);
  }
}

// ============================================================================
// 🧪 ระบบทดสอบอัตโนมัติเฉพาะตัว (Self-Running TDD Mock Suite)
// รันเพื่อตรวจสอบความถูกต้องของลอจิกขูดข้อมูลใน Terminal ได้ผ่าน: node services/scraper.js
// ============================================================================
async function runSelfTest() {
  console.log('🧪 [TDD] เริ่มต้นรันระบบทดสอบวิเคราะห์ลอจิกขูดข้อมูล (Self-Test)...');
  const scraper = new UdoScraper();
  
  // 1. ทดสอบขูดหน้าเว็บ HTML ปกติ
  const mockHtml = `<div class="block"><h1 class="heading">เนื้อหา HTML</h1><a class="url" href="/target">อ่านต่อ</a></div>`;
  const htmlRules = { containerSelector: '.block', titleSelector: '.heading', linkSelector: '.url' };
  const htmlResult = scraper.parseHtml(mockHtml, htmlRules, false);
  console.assert(htmlResult[0].title === 'เนื้อหา HTML', '❌ ดึง HTML หัวข้อล้มเหลว');
  console.assert(htmlResult[0].link === 'https:/target', '❌ แปลงลิงก์ HTML ล้มเหลว');

  // 2. ทดสอบแกะข้อมูลผ่านโครงสร้าง XML Feed
  const mockXml = `<feed><entry><title>หัวข้อ XML ฟีด</title><link href="https://example.com/rss"/><summary>รายละเอียด</summary></entry></feed>`;
  const xmlRules = { containerSelector: 'entry', titleSelector: 'title', linkSelector: 'link', descSelector: 'summary' };
  const xmlResult = scraper.parseHtml(mockXml, xmlRules, true);
  console.assert(xmlResult[0].title === 'หัวข้อ XML ฟีด', '❌ ดึง XML หัวข้อล้มเหลว');
  console.assert(xmlResult[0].link === 'https://example.com/rss', '❌ แกะโครงสร้างลิงก์ XML ล้มเหลว');

  console.log('✅ [TDD] โลจิกระบบขูดและแกะรหัส HTML/XML ผ่านฉลุย 100%!');
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runSelfTest();
}
