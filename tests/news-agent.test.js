import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UdoNewsAgent } from '../services/news-agent.js';

const agent = new UdoNewsAgent({ aiModel: 'qwen3.5:9b' });

test('cleanResponse — คืนค่าว่างเมื่อรับ input ว่าง', () => {
  assert.equal(agent.cleanResponse(''), '');
  assert.equal(agent.cleanResponse(null), '');
  assert.equal(agent.cleanResponse(undefined), '');
});

test('cleanResponse — ลบแท็ก <think>...</think> มาตรฐานออก', () => {
  const input = '<think>ฉันกำลังคิดอยู่...</think>นี่คือคำตอบจริง';
  assert.equal(agent.cleanResponse(input), 'นี่คือคำตอบจริง');
});

test('cleanResponse — ลบแท็ก <think> ที่คาบหลายบรรทัดออก', () => {
  const input = '<think>\nบรรทัดที่ 1\nบรรทัดที่ 2\n</think>\nผลลัพธ์';
  assert.equal(agent.cleanResponse(input), 'ผลลัพธ์');
});

test('cleanResponse — จัดการกรณีลืมใส่แท็กเปิด <think> แต่มีแท็กปิด </think>', () => {
  const input = 'ขั้นตอนคิดที่หลุดออกมา</think>เนื้อหาจริง';
  assert.equal(agent.cleanResponse(input), 'เนื้อหาจริง');
});

test('cleanResponse — คืนเนื้อหาเดิมเมื่อไม่มีแท็ก <think> เลย', () => {
  const input = '📰 ข่าวสารวันนี้น่าสนใจมาก';
  assert.equal(agent.cleanResponse(input), input);
});

test('UdoNewsAgent — สร้าง instance ด้วยค่า default ได้', () => {
  const defaultAgent = new UdoNewsAgent();
  assert.equal(defaultAgent.aiModel, 'qwen3.5:9b');
  assert.ok(defaultAgent.newsUrl.includes('blognone.com'));
});
