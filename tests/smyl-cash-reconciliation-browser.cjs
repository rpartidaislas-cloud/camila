const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(path.resolve(__dirname,'..','..','promodesk-smyl-stage4','node_modules','playwright'));
const fixture=path.resolve(__dirname,'fixtures','smyl-cash-reconciliation-v1-preview.html');
const output=path.resolve(__dirname,'..','artifacts','cash-reconciliation-v1');
const fs=require('node:fs');
fs.mkdirSync(output,{recursive:true});

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
  const results=[];
  for(const viewport of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]){
    const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height}});
    const errors=[];
    page.on('pageerror',(error)=>errors.push(error.message));
    await page.goto(pathToFileURL(fixture).href);
    await page.screenshot({path:path.join(output,`${viewport.name}.png`),fullPage:true});
    const audit=await page.evaluate(()=>{
      const dialog=document.querySelector('.finance-dialog');
      const form=document.querySelector('.finance-close-form');
      const buttons=[...document.querySelectorAll('button')].map((b)=>b.getBoundingClientRect().height);
      return {bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,dialogOverflow:dialog.scrollWidth>dialog.clientWidth,formWidth:Math.round(form.getBoundingClientRect().width),minButton:Math.round(Math.min(...buttons)),methodRows:document.querySelectorAll('.finance-close-method:not(.finance-close-method-head)').length,hasResolution:!!document.querySelector('.finance-close-resolution')};
    });
    results.push({viewport:viewport.name,errors,audit});
    await page.close();
  }
  await browser.close();
  for(const result of results){
    if(result.errors.length||result.audit.bodyOverflow||result.audit.dialogOverflow||result.audit.methodRows!==5||!result.audit.hasResolution)throw new Error(JSON.stringify(results,null,2));
    if(result.viewport==='mobile'&&result.audit.minButton<44)throw new Error(`Control móvil menor a 44 px: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(results,null,2));
})().catch((error)=>{console.error(error);process.exitCode=1;});
