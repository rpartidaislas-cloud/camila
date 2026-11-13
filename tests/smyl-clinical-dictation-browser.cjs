const path = require('node:path');
const fs = require('node:fs');

function loadPlaywright(){
  const candidates=[
    'playwright',
    path.resolve(__dirname,'..','..','promodesk-smyl-stage4','node_modules','playwright'),
    path.join(process.env.USERPROFILE||'', '.cache','codex-runtimes','codex-primary-runtime','dependencies','node_modules','playwright')
  ];
  for(const candidate of candidates){try{return require(candidate)}catch(_){}}
  throw new Error('Playwright no está disponible.');
}

(async()=>{
  const {chromium}=loadPlaywright();
  const chrome=process.env.SMYL_CHROMIUM||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser=await chromium.launch({headless:true,executablePath:chrome});
  const fixture=`file:///${path.resolve(__dirname,'fixtures','smyl-clinical-dictation-preview.html').replace(/\\/g,'/')}`;
  const output=path.resolve(__dirname,'..','artifacts','clinical-dictation-v1');
  fs.mkdirSync(output,{recursive:true});
  const cases=[
    {name:'desktop',width:1280,height:900},
    {name:'tablet',width:834,height:1000},
    {name:'mobile',width:390,height:844},
    {name:'mobile-320',width:320,height:760}
  ];
  const report=[];
  for(const viewport of cases){
    const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height}});
    await page.goto(fixture);
    await page.click('#dictate');
    await page.screenshot({path:path.join(output,`${viewport.name}-ready.png`),fullPage:true});
    const ready=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
      open:document.querySelector('.dvd-dialog')?.open===true,
      privacy:document.querySelector('.dvd-privacy')?.textContent.trim(),
      reviewHidden:document.querySelector('.dvd-review')?.hidden,
      closeHeight:document.querySelector('.dvd-close')?.getBoundingClientRect().height,
      dialogWidth:document.querySelector('.dvd-dialog')?.getBoundingClientRect().width,
      viewportWidth:document.documentElement.clientWidth
    }));
    await page.click('.dvd-listen');
    await page.waitForSelector('.dvd-review:not([hidden])');
    await page.screenshot({path:path.join(output,`${viewport.name}-review.png`),fullPage:true});
    const review=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
      tooth:document.querySelector('.dvd-review select')?.value,
      surface:document.querySelectorAll('.dvd-review select')[1]?.value,
      finding:document.querySelector('.dvd-review input')?.value,
      primaryCount:document.querySelectorAll('.dvd-primary').length,
      actionHeight:document.querySelector('.dvd-primary')?.getBoundingClientRect().height,
      dialogBottom:document.querySelector('.dvd-dialog')?.getBoundingClientRect().bottom,
      viewportHeight:document.documentElement.clientHeight
    }));
    await page.click('.dvd-primary');
    const applied=await page.evaluate(()=>({dialog:!!document.querySelector('.dvd-dialog'),value:window.__applied,result:document.getElementById('result').textContent}));
    report.push({name:viewport.name,ready,review,applied});
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  const failed=report.some(item=>
    item.ready.overflow||!item.ready.open||!item.ready.privacy||!item.ready.reviewHidden||item.ready.closeHeight<44||item.ready.dialogWidth>item.ready.viewportWidth+1||
    item.review.overflow||item.review.tooth!=='16'||item.review.surface!=='O'||item.review.finding!=='Caries'||item.review.primaryCount!==1||item.review.actionHeight<42||item.review.dialogBottom>item.review.viewportHeight+1||
    item.applied.dialog||item.applied.value?.observation!=='Oclusal: Caries.'||!/pendiente de guardar/.test(item.applied.result)
  );
  if(failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
