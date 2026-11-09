const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {readFile} = require('node:fs/promises');
const {resolve, extname, sep} = require('node:path');
const {chromium} = require('playwright');
const ocr = require('../food_ocr.js');

const root = resolve(__dirname, '..');

test('food label parsing and content-based estimates', () => {
  const r = ocr.parseLabel('栄養成分表示（1個当たり）\nエネルギー：１８６kcal\nたんぱく質 4.5g\n脂質 1.5 g\n炭水化物 38.9g\n食塩相当量 1.2g\n内容量 105g\n税込 172円');
  assert.equal(r.values.kcal, 186); assert.equal(r.values.protein, 4.5); assert.equal(r.values.salt, 1.2); assert.equal(r.values.price, 172);
  const per100 = ocr.parseLabel('100g当たり\n熱量 250kcal\nたんぱく質 10g\n脂質 12g\n糖質 20g\n食物繊維 2g\nナトリウム 400mg\n内容量 80g');
  assert.equal(per100.values.kcal, 200); assert.equal(per100.values.carbs, 17.6); assert.equal(per100.values.salt, 0.8);
  const e = ocr.estimate({name:'鮭おにぎり', ingredients:'ご飯（国産米）、鮭、のり、食塩、調味料（アミノ酸等）', weight:105});
  assert.ok(e.kcal > 130 && e.kcal < 230, 'onigiri estimate is plausible: '+e.kcal);
  assert.match(e.basis, /原材料/);
  assert.equal(ocr.estimate({name:''}), null);
});

test('mobile: categories, estimated marks, photo intake UI and no horizontal overflow', {timeout:90000}, async () => {
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file = resolve(root, '.'+(pathname==='/'?'/index.html':pathname));
      if (!file.startsWith(root+sep)) {res.writeHead(403).end();return;}
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain'}); res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const errors = [];
  try {
    for (const viewport of [{width:360,height:780},{width:390,height:844},{width:412,height:915}]) {
      const context = await browser.newContext({viewport, serviceWorkers:'block', isMobile:true, hasTouch:true});
      await context.route('https://cdn.jsdelivr.net/**', route=>route.abort());
      await context.route('https://world.openfoodfacts.org/**', route=>route.fulfill({contentType:'application/json',body:JSON.stringify({products:[{code:'4909411000000',product_name:'午後の紅茶 ミルクティー',brands:'キリン',quantity:'500 ml',nutriments:{'energy-kcal_100g':37,proteins_100g:0.7,fat_100g:0.6,carbohydrates_100g:7.3,salt_100g:0.1}}]})}));
      await context.route('**/config.js', route=>route.fulfill({contentType:'text/javascript',body:'window.NUTRIPATH_CONFIG={};'}));
      const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url); await page.locator('#app h1').waitFor();
      assert.equal(await page.locator('#themeToggle').count(), 0, 'dark mode toggle removed');
      for (const tab of ['today','recommend','catalog','insights','profile']) {
        await page.locator(`.mobile-nav [data-page="${tab}"]`).click();
        await page.locator('#app h1').waitFor();
        const overflow = await page.evaluate(()=>document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 0, `${tab} overflows horizontally by ${overflow}px at ${viewport.width}px`);
      }
      assert.equal(await page.locator('[data-action="exportCSV"]').count(), 0, 'weekly report has no export');
      // weekly report panels use the full width on phones
      await page.locator('.mobile-nav [data-page="insights"]').click();
      const panelWidth = await page.locator('.insight-grid > .panel').first().evaluate(n=>n.getBoundingClientRect().width);
      assert.ok(panelWidth > viewport.width - 60, 'insight panel fits phone width: '+panelWidth);
      // bottom navigation is tall enough and contains the hamburger menu
      const navHeight = await page.locator('.mobile-nav').evaluate(n=>n.getBoundingClientRect().height);
      assert.ok(navHeight >= 100, 'bottom nav height '+navHeight);
      assert.equal(await page.locator('#mobileMenu').isVisible(), false);
      assert.equal(await page.locator('.top-actions [data-page="profile"]').count(), 0, 'no top-right profile button');
      assert.match(await page.locator('.mobile-nav [data-page="profile"]').textContent(), /体調管理/);
      assert.equal(await page.locator('#sidebar').isVisible(), false, 'no workspace on the left');
      await page.locator('.mobile-nav [data-action="openMenu"]').click();
      await page.locator('#sidebar.open').waitFor();await page.waitForTimeout(300);
      const sheet = await page.locator('#sidebar').evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,width:r.width,bottom:r.bottom}});
      assert.ok(sheet.left===0 && sheet.width===viewport.width, 'menu opens as a bottom sheet '+JSON.stringify(sheet));
      await page.locator('#sidebar [data-page="settings"]').click();
      assert.equal(await page.locator('#sidebar.open').count(), 0);
      assert.match(await page.locator('#app h1').textContent(), /設定/);
      // daily target lines on the nutrition balance
      await page.locator('.mobile-nav [data-page="today"]').click();
      assert.ok(await page.locator('.target-line').count() >= 7);
      assert.ok(await page.locator('.goal-chip.ok').count() >= 4);
      assert.equal(await page.locator('.meal-card', {hasText:'飲み物'}).count(), 1);
      // purchase-place categories: 自炊 and スーパー are separate; ヤオコー exists under スーパー
      await page.locator('.mobile-nav [data-page="catalog"]').click();
      const cats = await page.locator('.cat-row .chip').allTextContents();
      for (const c of ['自炊','スーパー','コンビニ','ファストフード','牛丼・丼もの','定食']) assert.ok(cats.some(t=>t.includes(c)), 'category '+c);
      assert.equal(await page.locator('.cat-row [data-cat="自販機"]').count(), 0, 'vending machines only under drinks');
      // Return key closes the keyboard and keeps the results
      await page.locator('#queryInput').click();
      await page.locator('#queryInput').fill('綾鷹');
      await page.locator('#queryInput').press('Enter');
      assert.notEqual(await page.evaluate(()=>document.activeElement?.id), 'queryInput', 'keyboard closed');
      assert.ok(await page.locator('.food-row').count() >= 1);
      await page.locator('#queryInput').fill('');
      await page.locator('[data-cat="スーパー"]').click();
      await page.locator('.sub-row [data-store="ヤオコー"]').click();
      const names = await page.locator('.food-row .food-sub span:first-child').allTextContents();
      assert.ok(names.length >= 30 && names.slice(0,30).every(n=>n==='ヤオコー'), 'yaoko items first: '+names.slice(0,30).join());
      assert.ok(await page.locator('.food-row .est-mark').count() > 0, 'estimated values are marked 想定');
      await page.locator('[data-cat="自炊"]').click();
      const home = await page.locator('.food-row .food-sub span:first-child').allTextContents();
      assert.ok(home.length > 0 && home.every(n=>n==='自炊'));
      // drinks section: by purchase place incl. vending machines; online search fills the form
      await page.locator('[data-cat="飲み物"]').click();
      await page.locator('.sub-row [data-store="自販機"]').click();
      const vend = await page.locator('.food-row .food-sub').allTextContents();
      assert.ok(vend.length >= 20 && vend.every(n=>n.includes('自販機')), 'vending drinks: '+vend.length);
      assert.ok(await page.locator('.food-row', {hasText:'C.C.レモン'}).locator('.tag:not(.estimated)').count() === 1, 'maker drinks carry official values');
      await page.locator('[data-action="addDrink"]').click();
      await page.locator('#onlineQuery').fill('午後の紅茶');
      await page.locator('[data-action="searchOnline"]').click();
      await page.locator('.online-item').first().click();
      assert.equal(await page.locator('#foodForm [name="kcal"]').inputValue(), '185');
      assert.equal(await page.locator('#foodForm [name="store"]').inputValue(), '自販機');
      await page.locator('#foodForm button[type="submit"]').click();
      await page.locator('#queryInput').fill('キリン 午後の紅茶');
      const kirin = await page.locator('.food-row').allTextContents();
      assert.ok(kirin.length >= 1 && kirin.every(t=>t.includes('午後の紅茶')), 'word-by-word search');
      assert.equal(await page.locator('.food-row', {hasText:'自己登録'}).count(), 1, 'the saved drink is found');
      // the × button clears the search box
      await page.locator('#queryInput').fill('コロッケ');
      await page.locator('.catalog-toolbar .clear-x').click();
      assert.equal(await page.locator('#queryInput').inputValue(), '');
      assert.notEqual(await page.evaluate(()=>document.activeElement?.id), 'queryInput', 'keyboard stays closed after clearing');
      await page.locator('[data-cat="all"]').click();
      await page.locator('#queryInput').fill('鴨');
      assert.ok(await page.locator('.food-row', {hasText:'鴨南蛮そば'}).count() === 1);
      await page.locator('.catalog-toolbar .clear-x').click();
      // supermarket deli: per-piece amounts, default status is "already eaten"
      await page.locator('[data-cat="all"]').click();
      await page.locator('#queryInput').fill('カニクリームコロッケ');
      await page.locator('.food-row', {hasText:'カニクリームコロッケ（1個）'}).locator('[data-action="addEntry"]').click();
      assert.equal(await page.locator('#entryForm [name="status"]').inputValue(), 'eaten');
      assert.match(await page.locator('#entryForm label', {hasText:'数量'}).textContent(), /個/);
      await page.locator('[data-action="qtyStep"][data-dir="1"]').click();
      await page.locator('[data-action="qtyStep"][data-dir="1"]').click();
      assert.equal(await page.locator('#entryForm [name="amount"]').inputValue(), '3');
      await page.locator('#entryForm button[type="submit"]').click();
      await page.locator('#queryInput').fill('');
      // konbini: identical products are listed once; store-specific items stay separate
      await page.locator('[data-cat="コンビニ"]').click();
      const konbiniNames = await page.locator('.food-row .food-name').allTextContents();
      assert.equal(new Set(konbiniNames).size, konbiniNames.length, 'no duplicated konbini products');
      await page.locator('#queryInput').fill('おにぎり 鮭');
      const merged = page.locator('.food-row', {hasText:'セブン‐イレブン・ファミリーマート・ローソンで購入可'}).filter({has: page.locator('.food-name', {hasText: /^おにぎり 鮭$/})});
      assert.equal(await merged.count(), 1, 'one merged onigiri');
      await page.locator('.sub-row [data-store="ローソン"]').click();
      assert.equal(await merged.count(), 1, 'merged onigiri also listed under Lawson');
      await page.locator('#queryInput').fill('チキ');
      const lawson = await page.locator('.food-row .food-name').allTextContents();
      assert.ok(lawson.includes('Lチキ レギュラー') && !lawson.includes('ファミチキ'), lawson.join());
      await page.locator('#queryInput').fill('');
      // recommendations within a category
      await page.locator('[data-cat="コンビニ"]').click();
      await page.locator('.mobile-nav [data-page="recommend"]').click();
      assert.ok(await page.locator('.reco-card').count() >= 3);
      // photo intake: text pasted into the OCR box fills the form; estimate fills 想定 values
      await page.locator('.mobile-nav [data-page="catalog"]').click();
      await page.locator('[data-action="addFood"]').click();
      await page.locator('#foodImageFile').setInputFiles(resolve(root,'icon-192.png'));
      await page.locator('#foodPreview:not(.hide)').waitFor();
      await page.locator('#foodOcrStatus.ocr-error').waitFor();
      await page.locator('.ocr-text summary').click();
      await page.locator('#foodRawText').fill('名称 鮭おにぎり\nエネルギー 186kcal\nたんぱく質 4.5g\n脂質 1.5g\n炭水化物 38.9g\n食塩相当量 1.2g\n172円');
      await page.locator('[data-action="parseFoodText"]').click();
      assert.equal(await page.locator('#foodForm [name="kcal"]').inputValue(), '186');
      assert.equal(await page.locator('#foodForm [name="price"]').inputValue(), '172');
      await page.locator('#foodForm [name="kcal"]').fill('');
      await page.locator('#foodForm [name="name"]').fill('からあげ弁当');
      await page.locator('[data-action="estimateFood"]').click();
      assert.ok(Number(await page.locator('#foodForm [name="kcal"]').inputValue()) > 300);
      assert.equal(await page.locator('#foodForm [name="estimated"]').isChecked(), true);
      const modalOverflow = await page.evaluate(()=>document.documentElement.scrollWidth - innerWidth);
      assert.ok(modalOverflow <= 0, 'modal overflow '+modalOverflow);
      await page.locator('#foodForm button[type="submit"]').click();
      await page.locator('[data-cat="all"]').click();
      await page.locator('#queryInput').fill('からあげ弁当');
      const saved = page.locator('.food-row', {hasText:'自己登録・想定'});
      assert.ok(await saved.count() >= 1);
      if (viewport.width===390) await page.screenshot({path:process.env.SHOT_DIR?process.env.SHOT_DIR+'/catalog-390.png':'/tmp/nutripath-catalog-390.png', fullPage:false});
      await context.close();
    }
    assert.deepEqual(errors, []);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});

test('desktop: Japanese IME input in the search box is not interrupted', {timeout:60000}, async () => {
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file = resolve(root, '.'+(pathname==='/'?'/index.html':pathname));
      if (!file.startsWith(root+sep)) {res.writeHead(403).end();return;}
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain'}); res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:1280,height:900}, serviceWorkers:'block'});
    await context.route('**/config.js', route=>route.fulfill({contentType:'text/javascript',body:'window.NUTRIPATH_CONFIG={};'}));
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#nav [data-page="catalog"]').click();
    const box = page.locator('#queryInput'); await box.click();
    const cdp = await context.newCDPSession(page);
    // type "からあげ" via IME composition steps, then commit
    for (const t of ['k','か','かr','から','からあ','からあg','からあげ']) await cdp.send('Input.imeSetComposition',{text:t,selectionStart:t.length,selectionEnd:t.length});
    await cdp.send('Input.insertText',{text:'からあげ'});
    assert.equal(await page.locator('#queryInput').inputValue(), 'からあげ');
    assert.ok(await page.locator('#queryInput').evaluate(n=>document.activeElement===n), 'focus kept');
    const names = await page.locator('.food-row .food-name').allTextContents();
    assert.ok(names.length > 0 && names.every(n=>/からあげ|カラアゲ/.test(n)), 'filtered (kana-insensitive): '+names.length);
    // continue typing another word with IME after a space
    for (const t of ['b','べ','べn','べん','べんt','べんと','べんとう','弁当']) await cdp.send('Input.imeSetComposition',{text:t,selectionStart:t.length,selectionEnd:t.length});
    await cdp.send('Input.insertText',{text:'弁当'});
    assert.equal(await page.locator('#queryInput').inputValue(), 'からあげ弁当');
    await context.close();
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});

test('today: meal order, time-based meal, swipe to delete, yesterday quick add', {timeout:90000}, async () => {
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file = resolve(root, '.'+(pathname==='/'?'/index.html':pathname));
      if (!file.startsWith(root+sep)) {res.writeHead(403).end();return;}
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain'}); res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const errors=[];
  try {
    // 2026-11-07 12:30 JST -> lunch
    const context = await browser.newContext({viewport:{width:402,height:874}, isMobile:true, hasTouch:true, serviceWorkers:'block', timezoneId:'America/New_York'});
    await context.addInitScript(()=>{const fixed=new Date('2026-11-07T03:30:00Z').getTime();const D=Date;class FD extends D{constructor(...a){super(...(a.length?a:[fixed]))}static now(){return fixed}}window.Date=FD});
    await context.route('**/config.js', route=>route.fulfill({contentType:'text/javascript',body:'window.NUTRIPATH_CONFIG={};'}));
    const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#app h1').waitFor();
    assert.match(await page.locator('#currentDateText').textContent(), /12:30/);
    const order = await page.locator('.meal-card .meal-name').allTextContents();
    assert.deepEqual(order, ['朝食','昼食','夕食','飲み物','間食']);
    assert.equal(await page.locator('.log-acts [data-action="toggleEat"], .log-acts [data-action="remove"]').count(), 0);
    // add from catalog: default meal follows JST time (lunch), amounts are whole numbers
    await page.locator('.mobile-nav [data-page="catalog"]').click();
    await page.locator('#queryInput').fill('幕の内弁当');
    await page.locator('.food-row').first().locator('[data-action="addEntry"]').click();
    assert.equal(await page.locator('#entryForm [name="meal"]').inputValue(), 'lunch');
    assert.equal(await page.locator('#entryForm [name="amount"]').getAttribute('step'), '1');
    await page.locator('#entryForm button[type="submit"]').click();
    await page.locator('.mobile-nav [data-page="today"]').click();
    assert.equal(await page.locator('.log-item').count(), 1);
    // swipe left deletes, undo restores
    await page.locator('.log-item').first().scrollIntoViewIfNeeded();
    const box = await page.locator('.log-item').first().boundingBox();
    await page.mouse.move(box.x+box.width*0.5, box.y+box.height/2); await page.mouse.down();
    for (let i=1;i<=10;i++) await page.mouse.move(box.x+box.width*0.5-i*20, box.y+box.height/2);
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.log-item').count(), 0, 'deleted by swipe');
    await page.locator('#undoBar button').click();
    assert.equal(await page.locator('.log-item').count(), 1, 'undo');
    // next day: yesterday's meal can be added in one tap
    await page.locator('[data-action="next"]').first().click();
    assert.equal(await page.locator('.log-item').count(), 0);
    assert.match(await page.locator('.prev-day').textContent(), /幕の内弁当/);
    assert.match(await page.locator('.prev-short').textContent(), /前日に不足した栄養素[\s\S]*たんぱく質[\s\S]*あと/);
    await page.locator('[data-action="copyYesterday"]').click();
    assert.equal(await page.locator('.log-item').count(), 1);
    assert.match(await page.locator('.log-item').textContent(), /食べた/);
    // swipe right marks it as eaten
    await page.locator('.log-item').first().scrollIntoViewIfNeeded();
    const b2 = await page.locator('.log-item').first().boundingBox();
    await page.mouse.move(b2.x+30, b2.y+b2.height/2); await page.mouse.down();
    for (let i=1;i<=10;i++) await page.mouse.move(b2.x+30+i*20, b2.y+b2.height/2);
    await page.mouse.up();
    assert.match(await page.locator('.log-item').textContent(), /予定/, 'swipe right toggles eaten/planned');
    // external apps panel
    await page.locator('.mobile-nav [data-action="openMenu"]').click();
    await page.locator('#sidebar [data-page="settings"]').click();
    assert.equal(await page.locator('.ext-card').count(), 4);
    // account sync lives only in settings; goals / basic info / health are one swipeable panel
    assert.equal(await page.locator('#accountSlot #accountBar').count(), 1);
    await page.locator('[data-goal-tab="profile"]').click();
    await page.locator('#profileForm [name="age"]').fill('24');
    await page.locator('#profileForm [name="sex"]').selectOption('male');
    await page.locator('#profileForm [name="height"]').fill('172');
    await page.locator('#profileForm [name="weight"]').fill('68');
    await page.locator('#profileForm button[type="submit"]').click();
    await page.locator('[data-goal-tab="health"]').click();
    await page.locator('#profileForm2 [name="systolic"]').fill('138');
    await page.locator('#profileForm2 button[type="submit"]').click();
    await page.locator('.goal-source.auto').waitFor();
    assert.equal(await page.locator('#g_salt').inputValue(), '6', 'blood pressure lowers the salt goal');
    assert.match(await page.locator('.goal-basis').textContent(), /血圧/);
    for (const tab of ['today','recommend','catalog','insights','profile']) {
      await page.locator(`.mobile-nav [data-page="${tab}"]`).click();
      assert.equal(await page.locator('#accountBar').isVisible(), false, 'no account bar on '+tab);
    }
    assert.equal(await page.locator('#profileForm').count(), 0, 'forms moved out of 体調管理');
    await context.close();
    assert.deepEqual(errors, []);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});


test('theme: design switches by Japan time at 6:00, 12:00 and 18:00', {timeout:90000}, async () => {
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file = resolve(root, '.'+(pathname==='/'?'/index.html':pathname));
      if (!file.startsWith(root+sep)) {res.writeHead(403).end();return;}
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain'}); res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const cases = [['05:59','night','こんばんは'],['06:00','morning','おはようございます'],['11:59','morning','おはようございます'],['12:00','day','こんにちは'],['17:59','day','こんにちは'],['18:00','night','こんばんは']];
    for (const [hm,period,greet] of cases) {
      const context = await browser.newContext({viewport:{width:402,height:874}, serviceWorkers:'block', isMobile:true, hasTouch:true, timezoneId:'America/New_York'});
      await context.route(/^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route=>route.abort());
      const page = await context.newPage();
      await page.clock.install({time:new Date(`2026-11-09T${hm}:00+09:00`)});
      await page.goto(url);
      await page.waitForSelector('.period-greeting');
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.period), period, hm);
      assert.equal((await page.textContent('.period-greeting')).trim(), greet, hm);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#scene .scene-'+document.documentElement.dataset.period)).display), 'block');
      const sw = await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1); assert.ok(sw, 'no horizontal overflow '+hm);
      await context.close();
    }
    // live switch while the app stays open: 11:59 → 12:00 changes morning → day
    const context = await browser.newContext({viewport:{width:402,height:874}, serviceWorkers:'block'});
    await context.route(/^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route=>route.abort());
    const page = await context.newPage();
    await page.clock.install({time:new Date('2026-11-09T11:59:20+09:00')});
    await page.goto(url);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.period), 'morning');
    await page.clock.runFor(61000);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.period), 'day');
    assert.equal(await page.getAttribute('meta[name="theme-color"]','content'), '#1d6aa8');
    await context.close();
  } finally { await browser.close(); server.close(); }
});

test('mobile catalog: teishoku chains grouped by lineage, re-tap to close stores, one register button', {timeout:90000}, async () => {
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file = resolve(root, '.'+(pathname==='/'?'/index.html':pathname));
      if (!file.startsWith(root+sep)) {res.writeHead(403).end();return;}
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain'}); res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    await context.route('**/config.js', route=>route.fulfill({contentType:'text/javascript',body:'window.NUTRIPATH_CONFIG={};'}));
    const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.mobile-nav [data-page="catalog"]').click();
    // photo and manual registration are one button
    assert.equal(await page.locator('#app [data-action="addFoodPhoto"]').count(), 0);
    assert.equal(await page.locator('#app .hello [data-action="addFood"]').count(), 1);
    // 牛丼 and 定食 are separate lineages; all 18 teishoku chains are listed under headings
    await page.locator('[data-cat="牛丼・丼もの"]').click();
    const gyu = await page.locator('.sub-row [data-store]').evaluateAll(n=>n.map(x=>x.dataset.store));
    assert.deepEqual(gyu, ['all','松屋','すき家']);
    await page.locator('[data-cat="ファストフード"]').click();
    const ff = await page.locator('.sub-row [data-store]').evaluateAll(n=>n.map(x=>x.dataset.store));
    for (const s of ['マクドナルド','モスバーガー','ケンタッキーフライドチキン','サブウェイ','バーガーキング']) assert.ok(ff.includes(s), 'fast food '+s);
    await page.locator('[data-cat="定食"]').click();
    const chains = await page.locator('.sub-row [data-store]:not([data-store="all"])').evaluateAll(n=>n.map(x=>x.dataset.store));
    assert.equal(chains.length, 19, chains.join());
    assert.deepEqual(await page.locator('.group-label').allTextContents(), ['定食チェーン','海鮮','牛たん','お茶漬け','弁当']);
    // tapping the selected place again hides / shows its stores
    await page.locator('[data-cat="定食"]').click();
    assert.equal(await page.locator('.sub-row').count(), 0, 'store list closed');
    await page.locator('[data-cat="定食"]').click();
    assert.equal(await page.locator('.sub-row').count(), 1, 'store list reopened');
    // choosing one of many stores closes the list and shows it on the button
    await page.locator('.sub-row [data-store="やよい軒"]').click();
    assert.equal(await page.locator('.sub-row').count(), 0);
    assert.match(await page.locator('.cat-chip.active').textContent(), /やよい軒/);
    const stores = await page.locator('.food-row .food-sub span:first-child').allTextContents();
    assert.ok(stores.length > 0 && stores.every(s=>s==='やよい軒'));
    // kana-insensitive search with store reading; empty store results widen to all places
    await page.locator('#queryInput').fill('ねぎし');
    assert.ok(await page.locator('.widened-note').count() === 1);
    assert.ok((await page.locator('.food-row .food-sub span:first-child').allTextContents()).every(s=>s==='牛たんねぎし'));
    await page.locator('#queryInput').fill('');
    // rows open on tap to show details
    const row = page.locator('.food-row').first();
    await row.locator('.food-main').click();
    assert.equal(await row.getAttribute('class').then(c=>c.includes('open')), true);
    assert.ok(await row.locator('.food-note').isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth - innerWidth) <= 0);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});

test('body: scale photo text is read, saved to the trend and reflected in 基本情報', {timeout:90000}, async () => {
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file = resolve(root, '.'+(pathname==='/'?'/index.html':pathname));
      if (!file.startsWith(root+sep)) {res.writeHead(403).end();return;}
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain'}); res.end(await readFile(file));
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const errors=[];
  try {
    const context = await browser.newContext({viewport:{width:402,height:874}, isMobile:true, hasTouch:true, serviceWorkers:'block'});
    await context.route(/^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route=>route.abort());
    await context.route('**/config.js', route=>route.fulfill({contentType:'text/javascript',body:'window.NUTRIPATH_CONFIG={};'}));
    const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date('2026-11-09T19:00:00+09:00')});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.mobile-nav [data-page="profile"]').click();
    // photo reading sits below the weight trend
    const order = await page.evaluate(()=>{const c=document.querySelector('.weight-chart, .trend-empty'),b=document.querySelector('.body-photo');return !!(c.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)});
    assert.ok(order, 'photo reader below the trend');
    const add = async (date, text) => {
      await page.locator('.body-photo summary').click();
      await page.locator('#bodyRawText').fill(text);
      await page.locator('[data-action="parseBodyText"]').click();
      await page.locator('#body_date').fill(date);
      await page.locator('#bodyReviewForm button[type="submit"]').click();
    };
    await add('2026-11-07', '92.6 kg\nBMI 体脂肪 皮下脂肪\n27.9 23.6% 19.0%\n筋肉量 基礎代謝量\n67.9kg 2040kcal');
    await page.locator('.body-photo summary').click();
    await page.locator('#bodyRawText').fill('91 30 4 0.60 kg\nBMI 体 脂 肪 皮 下 脂 肪\n②⑦.⑥ ②①.③ 。 ⑱.④ 。\n体 内 年 齢 除 脂 肪 体 重 内 臓 脂 肪\n②④ ⑦①⑧③ c ⑩\n体 水 分 量 骨 格 筋 骨 量\n56.7 + 50.7 。 3.59\nタ ン パ ク 質 基 礎 代 謝 量 筋 肉 量\n⑰.⑨。 2054 ica 68.16 c');
    await page.locator('[data-action="parseBodyText"]').click();
    for (const [k,v] of Object.entries({weight:'91.3',bodyFat:'21.3',bmi:'27.6',muscle:'68.16',skeletal:'50.7',visceral:'10',bmr:'2054',leanMass:'71.83',bone:'3.59',bodyAge:'24'}))
      assert.equal(await page.locator('#body_'+k).inputValue(), v, k);
    assert.equal(await page.locator('#body_date').inputValue(), '2026-11-09');
    await page.locator('#bodyReviewForm button[type="submit"]').click();
    // trend shows the change, other metrics can be selected
    assert.match(await page.locator('.trend-summary').textContent(), /91\.3kg[\s\S]*-1\.3kg/);
    await page.locator('[data-action="trendKey"][data-key="bodyFat"]').click();
    assert.match(await page.locator('.trend-summary').textContent(), /21\.3%[\s\S]*-2\.3%/);
    assert.equal(await page.locator('.history-row').count(), 2);
    // 基本情報 got weight, body fat and the measurement date
    await page.locator('[data-action="goSettingsTab"][data-tab="profile"]').first().click();
    const form = page.locator('#profileForm2, #profileForm').first();
    assert.equal(await form.locator('[name="weight"]').inputValue(), '91.3');
    assert.equal(await form.locator('[name="bodyFat"]').inputValue(), '21.3');
    assert.equal(await form.locator('[name="measuredAt"]').inputValue(), '2026-11-09');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
});
