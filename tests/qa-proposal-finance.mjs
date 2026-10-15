import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const output=process.argv[2];
if(!output)throw new Error('Output directory required');
const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--allow-file-access-from-files']});
const page=await browser.newPage();
const errors=[];
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
page.on('pageerror',error=>errors.push(error.message));
await page.goto(pathToFileURL(resolve(import.meta.dirname,'proposal-finance-v1-demo.html')).href,{waitUntil:'load'});
for(const [name,width,height] of [['desktop',1366,900],['tablet',834,1000],['mobile',390,844]]){
  await page.setViewportSize({width,height});
  await page.screenshot({path:resolve(output,`proposal-finance-${name}.png`),fullPage:true});
  const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
  if(overflow.scrollWidth>overflow.clientWidth)throw new Error(`${name}: overflow ${overflow.scrollWidth}/${overflow.clientWidth}`);
}
await browser.close();
if(errors.length)throw new Error(errors.join('\n'));
console.log('Visual QA passed: desktop, tablet, mobile; no horizontal overflow or console errors.');
