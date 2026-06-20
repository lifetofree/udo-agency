import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UdoScraper } from '../services/scraper.js';

const scraper = new UdoScraper();

test('parseHtml — แกะหัวข้อและลิงก์จาก HTML ธรรมดาได้ถูกต้อง', () => {
  const html = `<div class="block"><h1 class="heading">ข่าวใหม่</h1><a class="url" href="//example.com/article">อ่านต่อ</a></div>`;
  const rules = { containerSelector: '.block', titleSelector: '.heading', linkSelector: '.url' };
  const result = scraper.parseHtml(html, rules);

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'ข่าวใหม่');
  assert.equal(result[0].link, 'https://example.com/article');
});

test('parseHtml — คง relative path ไว้เมื่อไม่รู้ base domain', () => {
  const html = `<div class="block"><h1 class="heading">บทความ</h1><a class="url" href="/relative/path">อ่านต่อ</a></div>`;
  const rules = { containerSelector: '.block', titleSelector: '.heading', linkSelector: '.url' };
  const result = scraper.parseHtml(html, rules);
  assert.equal(result[0].link, '/relative/path');
});

test('parseHtml — แกะข้อมูลจาก XML Atom Feed ได้ถูกต้อง', () => {
  const xml = `<feed><entry><title>หัวข้อ Atom</title><link href="https://example.com/atom"/><summary>เรื่องย่อ</summary></entry></feed>`;
  const rules = { containerSelector: 'entry', titleSelector: 'title', linkSelector: 'link', descSelector: 'summary' };
  const result = scraper.parseHtml(xml, rules, true);

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'หัวข้อ Atom');
  assert.equal(result[0].link, 'https://example.com/atom');
  assert.equal(result[0].description, 'เรื่องย่อ');
});

test('parseHtml — คืนค่า array ว่างเมื่อส่ง html ว่างเปล่า', () => {
  const result = scraper.parseHtml('', { containerSelector: '.block' });
  assert.deepEqual(result, []);
});

test('parseHtml — ไม่บันทึก item ที่ไม่มี title', () => {
  const html = `<div class="block"><a class="url" href="/no-title">ลิงก์โดดเดี่ยว</a></div>`;
  const rules = { containerSelector: '.block', titleSelector: '.heading', linkSelector: '.url' };
  const result = scraper.parseHtml(html, rules);
  assert.equal(result.length, 0);
});

test('parseHtml — โยน Error เมื่อไม่ส่ง containerSelector', () => {
  assert.throws(() => scraper.parseHtml('<div/>', {}), /containerSelector/);
});

test('fetchHtml — โยน Error เมื่อไม่ส่ง URL', async () => {
  await assert.rejects(() => scraper.fetchHtml(''), /URL/);
});
