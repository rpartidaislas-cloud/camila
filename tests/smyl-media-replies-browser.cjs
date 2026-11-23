const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fixture = name => pathToFileURL(path.join(__dirname, 'fixtures', name)).href;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW2kAAAAASUVORK5CYII=', 'base64');
async function editor(browser, width) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(fixture('smyl-connections-security-v33-preview.html'));
    await page.addStyleTag({ path: path.join(root, 'smyl-media-replies.css') });
    await page.addScriptTag({ path: path.join(root, 'smyl-media-replies.js') });
    await page.evaluate(() => {
        window.tenantId = '11111111-1111-4111-8111-111111111111';
        const files = new Map(), rules = new Map();
        window.sb = {
            from: () => ({ select: () => ({ eq: () => ({ order: () => ({ data: [...rules.values()] }) }) }) }),
            storage: { from: () => ({
                    list: () => ({ data: [...files.keys()].map(k => ({ name: k.split('/')[1], metadata: { mimetype: files.get(k).type } })) }),
                    upload: (k, f) => { files.set(k, f); return {}; },
                    createSignedUrl: k => ({ data: { signedUrl: URL.createObjectURL(files.get(k)) } })
                }) },
            rpc: (name, p) => {
                const row = rules.get(p.p_id) || { id: p.p_id, revision: 0, active_revision: null, tested_revision: null };
                const match = /fotos/i.test(p.p_message);
                if (p.p_action === 'save') {
                    row.revision++;
                    row.draft = p.p_draft;
                    row.tested_revision = null;
                }
                if (p.p_action === 'test' && match)
                    row.tested_revision = row.revision;
                if (p.p_action === 'activate')
                    row.active_revision = row.revision;
                if (p.p_action === 'pause')
                    row.active_revision = null;
                rules.set(row.id, row);
                return { data: { rule: structuredClone(row), matched: match } };
            }
        };
    });
    await page.locator('button[data-train-go="4"]').first().click();
    await page.locator('[data-media-training]').click();
    const dialog = page.locator('.media-rule-dialog');
    await dialog.locator('[data-upload]').setInputFiles({ name: 'ejemplo.png', mimeType: 'image/png', buffer: image });
    await page.waitForFunction(() => document.querySelector('[data-assets]').value.endsWith('ejemplo.png'));
    assert(await dialog.locator('[data-activate]').isDisabled());
    await dialog.locator('[data-test]').click();
    await dialog.locator('[data-preview] img').waitFor();
    assert(await dialog.locator('[data-activate]').isEnabled());
    assert(await dialog.evaluate(d => d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth));
    await dialog.locator('[data-activate]').click();
    await dialog.locator('[data-pause]').waitFor();
    await dialog.locator('[data-close]').click();
    await page.locator('[data-media-training]').click();
    assert.equal(await page.locator('[data-title]').inputValue(), 'Ejemplos de carillas');
    await page.locator('[data-pause]').click();
    await page.waitForFunction(() => document.querySelector('[data-pause]').hidden);
    for (const [name, mime, tag] of [['voz.m4a', 'audio/mp4', 'audio'], ['carillas.mp4', 'video/mp4', 'video']]) {
        await page.locator('[data-upload]').setInputFiles({ name, mimeType: mime, buffer: Buffer.from('fixture') });
        await page.waitForFunction(n => document.querySelector('[data-assets]').value.endsWith(n), name);
        if (tag === 'audio') {
            assert.equal(await page.locator('[data-channels] input:checked').count(), 3);
        }
        await page.locator('[data-test]').click();
        await page.locator('[data-preview] ' + tag).waitFor();
    }
    await page.close();
}
async function inbox(browser, mime, wireKind) {
    const page = await browser.newPage();
    await page.goto(fixture('smyl-inbox-stage7-preview.html') + '?focus&mobile-layout');
    await page.waitForSelector('html[data-preview-ready]');
    await page.addScriptTag({ path: path.join(root, 'smyl-media-replies.js') });
    await page.evaluate(mime => {
        window.sent = [];
        window.tenantId = 'demo';
        window.sb.rpc = async (name) => ({ data: name === 'smyl_suggest_media_reply' ? [{ id: 'a', title: 'Carillas', reply_text: 'Ejemplo del equipo.', asset: 'demo/item~ejemplo.mp4' }] : [] });
        window.sb.storage = { from: () => ({ download: async () => ({ data: new Blob(['test'], { type: mime }) }) }) };
        const fetchDemo = window.fetch;
        window.fetch = (input, init) => {
            const multipart = init?.body instanceof FormData;
            const body = !multipart && typeof init?.body === 'string' ? JSON.parse(init.body) : {};
            if (multipart || body.action === 'send') {
                sent.push(multipart ? [init.body.get('kind'), init.body.get('conversation_id')] : [body.content, body.conversation_id]);
                return Promise.resolve(new Response(JSON.stringify({ message: { id: 'sent' + sent.length, role: 'assistant', author_type: 'team', created_at: new Date().toISOString(), content: body.content || 'Video', status: 'sent' } }), { status: 200 }));
            }
            return fetchDemo(input, init);
        };
        window.dispatchEvent(new Event('smyl:media-rules-changed'));
    }, mime);
    await page.locator('[data-media-offer] button').click();
    assert.equal(await page.locator('#smyl-inbox-message').inputValue(), 'Ejemplo del equipo.');
    assert.equal(await page.evaluate(() => sent.length), 0);
    await page.locator('[data-compose-send]').click();
    await page.waitForFunction(() => sent.length === 2);
    assert.deepEqual(await page.evaluate(() => sent), [['Ejemplo del equipo.', 'c-preview'], [wireKind, 'c-preview']]);
    await page.close();
}
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        for (const w of [1280, 820, 390])
            await editor(browser, w);
        for (const [mime, kind] of [['image/png', 'image'], ['audio/mpeg', 'audio_clip'], ['video/mp4', 'video']])
            await inbox(browser, mime, kind);
        console.log('OK · editor 1280/820/390 y envío sugerido en chat simulado');
    }
    finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
