import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UdoNewsAgent } from '../services/news-agent.js';

// ============================================================
// resolveSource — static method
// ============================================================
test('resolveSource — คืน URL ที่ถูกต้องเมื่อส่งชื่อเว็บตรงๆ', () => {
  assert.ok(UdoNewsAgent.resolveSource('blognone').includes('blognone.com'));
  assert.ok(UdoNewsAgent.resolveSource('techcrunch').includes('techcrunch.com'));
  assert.ok(UdoNewsAgent.resolveSource('theverge').includes('theverge.com'));
  assert.ok(UdoNewsAgent.resolveSource('wired').includes('wired.com'));
  assert.ok(UdoNewsAgent.resolveSource('arstechnica').includes('arstechnica.com'));
});

test('resolveSource — คืน URL ที่ถูกต้องเมื่อส่ง category ภาษาอังกฤษ', () => {
  assert.ok(UdoNewsAgent.resolveSource('tech').includes('blognone.com'));
  assert.ok(UdoNewsAgent.resolveSource('startup').includes('techcrunch.com'));
  assert.ok(UdoNewsAgent.resolveSource('gadget').includes('theverge.com'));
  assert.ok(UdoNewsAgent.resolveSource('science').includes('wired.com'));
  assert.ok(UdoNewsAgent.resolveSource('ai').includes('arstechnica.com'));
});

test('resolveSource — คืน URL ที่ถูกต้องเมื่อส่ง category ภาษาไทย', () => {
  assert.ok(UdoNewsAgent.resolveSource('ไอที').includes('blognone.com'));
  assert.ok(UdoNewsAgent.resolveSource('สตาร์ทอัพ').includes('techcrunch.com'));
  assert.ok(UdoNewsAgent.resolveSource('แกดเจ็ต').includes('theverge.com'));
  assert.ok(UdoNewsAgent.resolveSource('วิทยาศาสตร์').includes('wired.com'));
});

test('resolveSource — โยน Error เมื่อส่งชื่อที่ไม่รู้จัก', () => {
  assert.throws(() => UdoNewsAgent.resolveSource('unknownsite'), /ไม่รู้จักแหล่งข่าว/);
});

test('resolveSource — โยน Error พร้อมรายชื่อ source ที่ถูกต้อง', () => {
  try {
    UdoNewsAgent.resolveSource('badname');
  } catch (e) {
    assert.ok(e.message.includes('blognone'), 'ควรแสดงชื่อ source ที่ถูกต้องใน error');
  }
});

// ============================================================
// Constructor
// ============================================================
test('constructor — ใช้ blognone เป็นค่า default', () => {
  const agent = new UdoNewsAgent();
  assert.equal(agent.sourceName, 'blognone');
  assert.ok(agent.newsUrl.includes('blognone.com'));
});

test('constructor — รับชื่อเว็บได้ถูกต้อง', () => {
  const agent = new UdoNewsAgent({ source: 'techcrunch' });
  assert.equal(agent.sourceName, 'techcrunch');
  assert.ok(agent.newsUrl.includes('techcrunch.com'));
});

test('constructor — รับ category ได้ถูกต้อง', () => {
  const agent = new UdoNewsAgent({ source: 'startup' });
  assert.ok(agent.newsUrl.includes('techcrunch.com'));
});

test('constructor — โยน Error ทันทีเมื่อส่ง source ไม่ถูกต้อง', () => {
  assert.throws(() => new UdoNewsAgent({ source: 'fakesource' }), /ไม่รู้จักแหล่งข่าว/);
});

// ============================================================
// cleanResponse
// ============================================================
test('cleanResponse — คืนค่าว่างเมื่อรับ input ว่าง', () => {
  const agent = new UdoNewsAgent();
  assert.equal(agent.cleanResponse(''), '');
  assert.equal(agent.cleanResponse(null), '');
  assert.equal(agent.cleanResponse(undefined), '');
});

test('cleanResponse — ลบแท็ก <think>...</think> มาตรฐานออก', () => {
  const agent = new UdoNewsAgent();
  assert.equal(agent.cleanResponse('<think>ฉันกำลังคิดอยู่...</think>นี่คือคำตอบจริง'), 'นี่คือคำตอบจริง');
});

test('cleanResponse — ลบแท็ก <think> ที่คาบหลายบรรทัดออก', () => {
  const agent = new UdoNewsAgent();
  assert.equal(agent.cleanResponse('<think>\nบรรทัดที่ 1\n</think>\nผลลัพธ์'), 'ผลลัพธ์');
});

test('cleanResponse — จัดการกรณีลืมใส่แท็กเปิด <think> แต่มีแท็กปิด </think>', () => {
  const agent = new UdoNewsAgent();
  assert.equal(agent.cleanResponse('ขั้นตอนคิดที่หลุดออกมา</think>เนื้อหาจริง'), 'เนื้อหาจริง');
});

test('cleanResponse — คืนเนื้อหาเดิมเมื่อไม่มีแท็ก <think> เลย', () => {
  const agent = new UdoNewsAgent();
  const input = '📰 ข่าวสารวันนี้น่าสนใจมาก';
  assert.equal(agent.cleanResponse(input), input);
});
