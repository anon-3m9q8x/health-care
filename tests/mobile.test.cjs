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
      assert.equal(await page.locator('#sidebar').isVisible(), false, 'no workspace on the left');
      await page.locator('.mobile-nav [data-action="openMenu"]').click();
      await page.locator('#sidebar.open').waitFor();await page.waitForTimeout(300);
      const sheet = await page.locator('#sidebar').evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,width:r.width,bottom:r.bottom}});
      assert.ok(sheet.left===0 && sheet.width===viewport.width, 'menu opens as a bottom sheet '+JSON.stringify(sheet));
      await page.locator('#sidebar [data-page="settings"]').click();
      assert.equal(await page.locator('#sidebar.open').count(), 0);
      assert.match(await page.locator('#app h1').textContent(), /目標/);
      // daily target lines on the nutrition balance
      await page.locator('.mobile-nav [data-page="today"]').click();
      assert.equal(await page.locator('.target-line').count(), 7);
      assert.ok(await page.locator('.goal-chip.ok').count() >= 4);
      assert.equal(await page.locator('.meal-card', {hasText:'飲み物'}).count(), 1);
      // purchase-place categories: 自炊 and スーパー are separate; ヤオコー exists under スーパー
      await page.locator('.mobile-nav [data-page="catalog"]').click();
      const cats = await page.locator('.cat-row .chip').allTextContents();
      for (const c of ['自炊','スーパー','コンビニ','ファストフード','牛丼・定食']) assert.ok(cats.some(t=>t.includes(c)), 'category '+c);
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
      assert.equal(await page.locator('.food-row').count(), 1);
      await page.locator('#queryInput').fill('');
      // konbini: identical products are listed once; store-specific items stay separate
      await page.locator('[data-cat="コンビニ"]').click();
      const konbiniNames = await page.locator('.food-row .food-name').allTextContents();
      assert.equal(new Set(konbiniNames).size, konbiniNames.length, 'no duplicated konbini products');
      await page.locator('#queryInput').fill('おにぎり 鮭');
      assert.equal(await page.locator('.food-row').count(), 1, 'one merged onigiri');
      assert.match(await page.locator('.food-row').textContent(), /セブン‐イレブン・ファミリーマート・ローソンで購入可/);
      await page.locator('.sub-row [data-store="ローソン"]').click();
      assert.equal(await page.locator('.food-row').count(), 1);
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
    assert.ok(names.length > 0 && names.every(n=>n.includes('からあげ')), 'filtered: '+names.length);
    // continue typing another word with IME after a space
    for (const t of ['b','べ','べn','べん','べんt','べんと','べんとう','弁当']) await cdp.send('Input.imeSetComposition',{text:t,selectionStart:t.length,selectionEnd:t.length});
    await cdp.send('Input.insertText',{text:'弁当'});
    assert.equal(await page.locator('#queryInput').inputValue(), 'からあげ弁当');
    await context.close();
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});

