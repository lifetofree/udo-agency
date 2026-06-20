import ollama from 'ollama';

/**
 * UdoAgentService - บริการประสานงานทีม AI สองตัวในเครื่องเดียว
 * ตัวแรก (Qwen) วางแผนสถาปัตยกรรมระบบ ตัวที่สอง (Creative) ร่างกลยุทธ์การตลาด
 * ออกแบบให้ฉีดโมเดลได้อิสระผ่าน constructor เพื่อรองรับการเทส (Dependency Injection)
 */
export class UdoAgentService {
  /**
   * @param {Object} config - การตั้งค่าโมเดลทั้งสอง
   * @param {string} config.coreModel - โมเดลสำหรับวิเคราะห์สถาปัตยกรรม (เช่น qwen3.5:9b)
   * @param {string} config.creativeModel - โมเดลสำหรับร่างคอนเทนต์/การตลาด (เช่น gemma2:9b)
   */
  constructor(config = {}) {
    this.coreModel = config.coreModel || 'qwen3.5:9b';
    this.creativeModel = config.creativeModel || 'gemma2:9b';
  }

  /**
   * รันกระบวนการคิดแบบสองขั้น: สถาปัตยกรรม → การตลาด
   * @param {string} userGoal - โจทย์ธุรกิจจากผู้ใช้
   * @returns {Promise<{architecture: string, marketing: string}>}
   */
  async run(userGoal) {
    if (!userGoal || !userGoal.trim()) {
      throw new Error('กรุณาระบุโจทย์ธุรกิจที่ต้องการให้ UDO ช่วยคิด');
    }

    console.log(`[UDO Agent] รับโจทย์: "${userGoal}"`);

    // ขั้นที่ 1: ส่งโจทย์ให้ Core Model วางแผนระบบและสถาปัตยกรรม
    console.log(`[UDO Agent] กำลังส่งให้ ${this.coreModel} วิเคราะห์สถาปัตยกรรม...`);
    let architectureResult;
    try {
      const architectResponse = await ollama.generate({
        model: this.coreModel,
        prompt: `You are an elite Business Architect & AI Software Engineer. Based on this goal: "${userGoal}", provide a highly technical, automated system architecture and clean database/code outline. Keep it concise, system-driven, and resource-efficient.`,
        think: false,
        options: { temperature: 0.2 }
      });
      architectureResult = architectResponse.response || architectResponse.thinking || '';
      console.log(`[UDO Agent] ได้รับผลสถาปัตยกรรมจาก ${this.coreModel} แล้ว`);
    } catch (err) {
      throw new Error(`[UDO Agent] ${this.coreModel} ตอบกลับล้มเหลว: ${err.message}`);
    }

    // ขั้นที่ 2: ส่งแผนสถาปัตยกรรมต่อให้ Creative Model ร่างกลยุทธ์การตลาด
    console.log(`[UDO Agent] กำลังส่งต่อให้ ${this.creativeModel} ร่างกลยุทธ์การตลาด...`);
    let marketingResult;
    try {
      const marketingResponse = await ollama.generate({
        model: this.creativeModel,
        prompt: `You are a Solopreneur Marketing Expert. Based on this technical infrastructure: "${architectureResult}", craft an authentic marketing angle, content strategy, and a high-converting hook. Ensure the tone is supportively witty and direct.`,
        think: false,
        options: { temperature: 0.5 }
      });
      marketingResult = marketingResponse.response || marketingResponse.thinking || '';
      console.log(`[UDO Agent] ได้รับผลกลยุทธ์การตลาดจาก ${this.creativeModel} แล้ว`);
    } catch (err) {
      throw new Error(`[UDO Agent] ${this.creativeModel} ตอบกลับล้มเหลว: ${err.message}`);
    }

    return { architecture: architectureResult, marketing: marketingResult };
  }
}

// ============================================================================
// 🧪 Self-Test Suite
// รันตรงในเทอร์มินัล: node services/agent.js
// ============================================================================
async function runSelfTest() {
  console.log('🧪 [TDD] เริ่มต้นทดสอบ UdoAgentService...');

  // ทดสอบ: โยน Error เมื่อโจทย์ว่างเปล่า
  const agentNoOp = new UdoAgentService();
  try {
    await agentNoOp.run('');
    console.error('❌ ทดสอบ empty goal ล้มเหลว: ควรโยน Error แต่ไม่โยน');
  } catch (e) {
    if (e.message.includes('กรุณาระบุโจทย์')) {
      console.log('✅ ทดสอบ empty goal ผ่าน: โยน Error ถูกต้อง');
    } else {
      console.error('❌ ทดสอบ empty goal ล้มเหลว: ข้อความ Error ไม่ตรง -', e.message);
    }
  }

  // ทดสอบ: รันจริงกับ Ollama (ต้องติดตั้งโมเดลไว้ในเครื่องก่อน)
  console.log('\n🧪 ทดสอบการรันจริงกับ Ollama (ต้องมี qwen3.5:9b และ gemma2:9b)...');
  const agent = new UdoAgentService();
  try {
    const result = await agent.run('สร้างระบบดึงข้อมูลราคาหุ้นไทยอัตโนมัติ');
    if (!result.architecture || !result.marketing) {
      throw new Error('ผลลัพธ์ขาดฟิลด์ architecture หรือ marketing');
    }
    console.log('✅ ทดสอบการรันจริงผ่าน!');
    console.log('\n--- Architecture ---\n', result.architecture.substring(0, 200), '...');
    console.log('\n--- Marketing ---\n', result.marketing.substring(0, 200), '...');
  } catch (e) {
    console.error('❌ ทดสอบการรันจริงล้มเหลว:', e.message);
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runSelfTest();
}
