const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {readFile} = require('node:fs/promises');
const {resolve, extname, sep} = require('node:path');
const {chromium} = require('playwright');

const root = resolve(__dirname, '..');
const accounts = {
  'alice@example.test':'00000000-0000-4000-8000-000000000001',
  'bob@example.test':'00000000-0000-4000-8000-000000000002'
};
const origin = 'https://nutripath-test.supabase.co';
function session(email) {
  const now = Math.floor(Date.now()/1000), id = accounts[email];
  const claims = {sub:id, aud:'authenticated', role:'authenticated', exp:now+3600, iat:now, session_id:id};
  const token = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.test';
  return {access_token:token, refresh_token:'test-refresh-'+email, token_type:'bearer', expires_in:3600, expires_at:now+3600, user:{id, email, aud:'authenticated', role:'authenticated', app_metadata:{provider:'email'}, user_metadata:{}, created_at:new Date().toISOString()}};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function eventually(fn) {
  for(let i=0;i<100;i++){if(await fn())return;await sleep(50);}
  assert.fail('Expected condition was not reached');
}

test('browser: account isolation, migration, two-device sync, conflicts and offline recovery', {timeout:90000}, async () => {
  const server = createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/health-care\//,'/');
      const file = resolve(root, '.'+(pathname==='/'?'/index.html':pathname));
      if (!file.startsWith(root+sep)) {res.writeHead(403).end();return;}
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
      const contents=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain'}); res.end(contents);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url = `http://127.0.0.1:${server.address().port}/health-care/`;
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const rows = new Map(), errors=[];
  async function device(viewport={width:390,height:844}, configured=true) {
    const context = await browser.newContext({viewport,serviceWorkers:'block'});
    const state={online:true,failRead:false};
    if(configured)await context.route('**/config.js', route=>route.fulfill({contentType:'text/javascript',body:`window.NUTRIPATH_CONFIG={supabaseUrl:'${origin}',supabasePublishableKey:'sb_publishable_test'};`}));
    await context.route(origin+'/**', async route=>{
      if(!state.online){await route.abort('internetdisconnected');return;}
      const req=route.request(), u=new URL(req.url()), body=req.postDataJSON();
      const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(u.pathname==='/auth/v1/signup')return json({user:{id:accounts[body.email],email:body.email},session:null});
      if(u.pathname==='/auth/v1/recover')return json({});
      if(u.pathname==='/auth/v1/token')return json(session(body.email || 'alice@example.test'));
      if(u.pathname==='/auth/v1/logout')return json({});
      const token=req.headers().authorization?.split(' ')[1];
      const id=token?.split('.').length===3?JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub:null;
      if(u.pathname==='/auth/v1/user')return json({id,email:Object.keys(accounts).find(k=>accounts[k]===id)});
      if(u.pathname==='/rest/v1/nutripath_accounts'){
        if(state.failRead)return json({message:'unavailable'},503);
        return json(rows.has(id)?[rows.get(id)]:[]);
      }
      if(u.pathname==='/rest/v1/rpc/save_nutripath_state'){
        if(body.p_user_id!==id)return json({code:'42501',message:'wrong account'},403);
        const old=rows.get(id);
        if((old?.revision||0)!==body.p_expected_revision)return json({code:'PT409',message:'conflict'},409);
        const row={user_id:id,data:body.p_data,revision:(old?.revision||0)+1};rows.set(id,row);return json([row]);
      }
      return json({message:'unknown fixture route'},404);
    });
    const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url); await page.locator('#app h1').waitFor();
    return {page,context,state};
  }
  async function login(page,email='alice@example.test') {
    await page.locator('[data-account="login"]').click();
    await page.locator('#accountForm input[name="email"]').fill(email);
    await page.locator('#accountForm input[name="password"]').fill('test-password-123');
    await page.locator('#accountForm button[type="submit"]').click();
    await eventually(async()=> (await page.locator('.account-email').textContent())===email);
    await page.locator('#app h1').waitFor();
  }
  async function addMeal(page) {
    await page.locator('.mobile-nav [data-page="catalog"]').click();
    await page.locator('[data-action="addEntry"]').first().click();
    await page.locator('#entryForm button[type="submit"]').click();
    await page.locator('.mobile-nav [data-page="today"]').click();
  }
  try {
    const a=await device(), b=await device();
    await a.page.locator('[data-account="login"]').click();
    await a.page.locator('[data-account="signup"]').click();
    await a.page.locator('input[name="email"]').fill('alice@example.test');
    await a.page.locator('input[name="password"]').fill('test-password-123');
    await a.page.locator('#accountForm button').click();
    await eventually(async()=> (await a.page.locator('#accountMessage').textContent()).includes('確認メール'));
    assert.equal(rows.size,0);
    await a.page.locator('#accountOverlay [data-account="login"]').click();
    await a.page.locator('[data-account="reset"]').click();
    await a.page.locator('input[name="email"]').fill('alice@example.test');
    await a.page.locator('#accountForm button').click();
    await eventually(async()=> (await a.page.locator('#accountMessage').textContent()).includes('確認メール'));
    await a.page.locator('[data-account="close"]').click();
    // Guest data is preserved locally and never implicitly assigned to a user.
    await addMeal(a.page);
    await login(a.page);
    assert.equal(await a.page.locator('.log-item').count(),0);
    assert.equal(rows.size,0);
    a.page.once('dialog',d=>d.accept());
    await a.page.locator('[data-account="import"]').click();
    await eventually(()=>rows.get(accounts['alice@example.test'])?.data.logs.length===1);
    await login(b.page);
    assert.equal(await b.page.locator('.log-item').count(),1);
    await addMeal(a.page);
    await eventually(()=>rows.get(accounts['alice@example.test'])?.data.logs.length===2);
    await b.page.locator('[data-account="refresh"]').click();
    await eventually(async()=>await b.page.locator('.log-item').count()===2);
    // A pending offline edit survives reload. Another device then advances revision.
    b.state.online=false;
    await addMeal(b.page);
    await sleep(800);
    await b.page.reload(); await b.page.locator('#app h1').waitFor();
    assert.equal(await b.page.locator('.log-item').count(),3);
    await a.page.locator('#themeToggle').click();
    await eventually(()=>rows.get(accounts['alice@example.test'])?.data.theme==='dark');
    b.state.online=true;
    await b.page.locator('[data-account="refresh"]').click();
    await b.page.locator('[data-account="cloud"]').waitFor();
    assert.equal(rows.get(accounts['alice@example.test']).data.logs.length,2);
    b.page.once('dialog',d=>d.accept());
    await b.page.locator('[data-account="replace"]').click();
    await eventually(()=>rows.get(accounts['alice@example.test']).data.logs.length===3);
    await a.page.locator('[data-account="refresh"]').click();
    await eventually(async()=>await a.page.locator('.log-item').count()===3);
    // Logout removes the account cache. A different user never sees its records.
    await b.page.locator('[data-account="logout"]').click();
    await eventually(async()=> (await b.page.locator('.account-email').textContent())==='この端末だけで利用中');
    assert.equal(await b.page.evaluate(id=>localStorage.getItem('nutripath.account.'+id),accounts['alice@example.test']),null);
    await login(b.page,'bob@example.test');
    assert.equal(await b.page.locator('.log-item').count(),0);
    await addMeal(b.page);
    await eventually(()=>rows.get(accounts['bob@example.test'])?.data.logs.length===1);
    assert.equal(rows.get(accounts['alice@example.test']).data.logs.length,3);
    assert.equal(await b.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    b.state.online=false;
    await addMeal(b.page);await sleep(800);
    let confirmations=0;
    b.page.on('dialog',async d=>{confirmations++;await d.accept();});
    await b.page.locator('[data-account="logout"]').click();
    await eventually(async()=> (await b.page.locator('.account-email').textContent())==='この端末だけで利用中');
    assert.equal(confirmations,1);
    assert.equal(rows.get(accounts['bob@example.test']).data.logs.length,1);
    // A failed first read must keep the app blocked rather than write blank data.
    const c=await device(); c.state.failRead=true;
    await c.page.locator('[data-account="login"]').click();
    await c.page.locator('input[name="email"]').fill('alice@example.test');
    await c.page.locator('input[name="password"]').fill('test-password-123');
    await c.page.locator('#accountForm button').click();
    await c.page.getByRole('heading',{name:'データを読み込めませんでした'}).waitFor();
    await c.page.keyboard.press('Escape');
    assert.equal(await c.page.locator('.app-shell').evaluate(n=>n.inert),true);
    assert.equal(rows.get(accounts['alice@example.test']).data.logs.length,3);
    const local=await device({width:1440,height:1000},false);
    await local.page.locator('#themeToggle').click(); await local.page.reload();
    await local.page.locator('body.dark').waitFor();
    assert.equal(await local.page.locator('[data-account="login"]').isDisabled(),true);
    // Test the real service worker, including a subdirectory deployment and offline reload.
    const pwaContext=await browser.newContext({viewport:{width:390,height:844}});
    const pwa=await pwaContext.newPage();pwa.on('pageerror',e=>errors.push(e.message));
    await pwa.goto(url);await pwa.locator('#app h1').waitFor();
    await pwa.evaluate(()=>navigator.serviceWorker.ready);
    await pwa.reload();await pwa.locator('#app h1').waitFor();
    await addMeal(pwa);
    await pwa.screenshot({path:'/tmp/nutripath-account-mobile.png',fullPage:true});
    await pwaContext.setOffline(true);
    await pwa.reload();await pwa.locator('#app h1').waitFor();
    assert.equal(await pwa.locator('.log-item').count(),1);
    await pwaContext.close();
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
