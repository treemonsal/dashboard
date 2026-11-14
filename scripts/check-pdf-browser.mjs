// Synthetic statements only. Run after npm run build; requires playwright or PLAYWRIGHT_MODULE.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let correctMime = false;
let imported;
let failWrites=false;
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
    let body='';for await(const chunk of req)body+=chunk;
    res.setHeader('content-type','application/json');
    if(failWrites && req.method !== 'GET'){res.statusCode=503;return res.end(JSON.stringify({error:'Test: nicht erreichbar'}));}
    if(path==='/api/import/preview'){
      imported=JSON.parse(body); const files=imported.files.map(f=>({name:f.name,bank:f.pdf.bank,fresh:f.pdf.rows.length,duplicates:0,warnings:[],sample:[],needsConfirmation:false}));
      return res.end(JSON.stringify({fresh:files.reduce((n,f)=>n+f.fresh,0),duplicates:0,files}));
    }
    return res.end(JSON.stringify(path==='/api/settings'?{}:path==='/api/timetable'?{lessons:[]}:path.includes('/gym/day/')?{plan:null,session:null}:path.includes('sync-if-stale')?{ran:false}:[]));
  }
  try{
    const file=extname(path)?path:'/index.html';
    const content=await readFile(join('dist/client',file));
    res.setHeader('content-type',extname(file)==='.mjs'?(correctMime?'text/javascript':'application/octet-stream'):(mime[extname(file)]||'application/octet-stream'));
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('content-security-policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'");
    res.end(content);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
function pdf(bank){
  const text=`BT /F1 12 Tf 40 780 Td (${bank}) Tj 0 -30 Td (Kontoauszug CHF) Tj 0 -30 Td (Datum) Tj 80 0 Td (Beschreibung) Tj 220 0 Td (Ausgehend) Tj 70 0 Td (Eingehend) Tj 85 0 Td (Saldo) Tj -455 -20 Td (01.10.2026) Tj 80 0 Td (Migros) Tj 240 0 Td (12.50) Tj 135 0 Td (987.50) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let out='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=out.length;
  out+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
const browser=await chromium.launch({headless:true});
try{
  for(const mode of [false,true]){
    correctMime=mode;
    for(const bank of mode?['Revolut Bank UAB','Yuh Swissquote']:['Revolut Bank UAB']){
      imported=null;
      const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
      const page=await context.newPage();await page.goto(base+'/geld');await page.waitForLoadState('networkidle');
      await page.locator('input[type=file]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:pdf(bank)});
      if(!mode){await page.getByRole('status').waitFor();assert.equal(imported,null);console.log('Old MIME reproduces upload failure');}
      else{await page.getByRole('heading',{name:'Export',exact:true}).waitFor();await page.waitForFunction(()=>document.body.textContent.includes('Buchungen speichern'));assert.equal(imported.files[0].pdf.rows.length,1);assert.equal(imported.files[0].pdf.bank,bank.startsWith('Yuh')?'yuh':'revolut');console.log(bank,'PDF read and previewed');}
      await context.close();
    }
  }
  failWrites=true;
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage();
  await page.goto(base+'/aufgaben');await page.waitForLoadState('networkidle');
  await page.getByRole('textbox',{name:'Neue Aufgabe',exact:true}).fill('Entwurf bleibt');
  await page.getByRole('button',{name:'Hinzufügen',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Nicht gespeichert'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Neue Aufgabe',exact:true}).inputValue(),'Entwurf bleibt');
  await page.goto(base+'/plaene');await page.waitForLoadState('networkidle');
  await page.getByRole('button',{name:'Plan anlegen',exact:true}).click();
  await page.getByRole('textbox',{name:'Name',exact:true}).fill('Plan Entwurf');
  await page.getByRole('button',{name:'Übungen hinzufügen',exact:true}).click();
  await page.getByRole('textbox',{name:'Übung',exact:true}).fill('Kniebeugen');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Nicht gespeichert'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Name',exact:true}).inputValue(),'Plan Entwurf');
  assert.equal(await page.getByRole('textbox',{name:'Übung',exact:true}).inputValue(),'Kniebeugen');
  console.log('Task and training drafts survive failed writes');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
