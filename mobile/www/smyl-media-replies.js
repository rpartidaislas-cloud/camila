(function () {
    'use strict';
    const bucket = 'smyl-assistant-media';
    const types = { 'image/jpeg': 'Foto', 'image/png': 'Foto', 'audio/mpeg': 'Audio', 'audio/mp4': 'Audio', 'video/mp4': 'Video' };
    const channels = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };
    const list = value => [...new Set(value.split(/[,\n]/).map(x => x.trim()).filter(Boolean))];
    const filename = path => path.split('/').pop().replace(/^[^~]+~/, '');
    function option(value, title) { return new Option(title, value); }
    function template(first) {
        return { title: first ? 'Ejemplos de carillas' : '', topics: first ? ['carillas', 'carilla'] : [],
            requests: first ? ['foto', 'fotos', 'video', 'videos', 'ejemplo', 'ejemplos', 'cómo se ven', 'cómo quedan', 'antes y después'] : [],
            exclude: first ? ['en mí', 'me quedarían', 'dolor', 'duele', 'no quiero', 'no me envíen'] : [],
            channels: Object.keys(channels), asset: '', text: first ? 'Te comparto un ejemplo de carillas de nuestra clínica. ¿Qué te gustaría conocer del tratamiento?' : '' };
    }
    async function result(promise) {
        const { data, error } = await promise;
        if (error)
            throw new Error(error.message);
        return data;
    }
    function normalizeUpload(file) {
        const aliases = { 'audio/x-m4a': 'audio/mp4', 'image/jpg': 'image/jpeg', 'audio/mp3': 'audio/mpeg' };
        const byExtension = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4' };
        const type = aliases[file.type] || file.type || byExtension[file.name.split('.').pop().toLowerCase()];
        return type && type !== file.type ? new File([file], file.name, { type }) : file;
    }
    function previewElement(mime, url, label) {
        const tag = mime.startsWith('image/') ? 'img' : mime.startsWith('audio/') ? 'audio' : 'video';
        const el = document.createElement(tag);
        if (tag === 'img')
            el.alt = label;
        else {
            el.controls = true;
            el.preload = 'metadata';
            el.setAttribute('aria-label', label);
            if (tag === 'video')
                el.playsInline = true;
        }
        el.src = url;
        return el;
    }
    async function openEditor() {
        if (document.querySelector('.media-rule-dialog'))
            return;
        const db = window.sb, clinic = window.tenantId;
        const dialog = document.createElement('dialog');
        dialog.className = 'media-rule-dialog';
        dialog.setAttribute('aria-labelledby', 'media-rule-title');
        dialog.innerHTML = '<header><div><h2 id="media-rule-title">Respuestas con archivos</h2><p>Prepara el material que tu equipo podrá compartir desde el chat.</p></div><button type="button" data-close aria-label="Cerrar">×</button></header>' +
            '<div class="media-rule-body"><div class="media-rule-select"><label>Regla<select data-rules></select></label><button type="button" data-new>Nueva regla</button></div>' +
            '<fieldset><legend>Cuándo sugerir</legend><label>Nombre de la regla<input data-title maxlength="80"></label><div class="media-rule-grid"><label>Tema del mensaje<input data-topics placeholder="carillas, carilla"></label><label>Qué pide el paciente<input data-requests placeholder="fotos, ejemplos, cómo se ven"></label></div><small>Incluye una palabra o frase de cada campo. Separa las alternativas con comas.</small>' +
            '<details><summary>Excepciones y canales</summary><label>Omitir si menciona<input data-exclude placeholder="dolor, en mí"></label><div data-channels class="media-rule-channels"></div></details></fieldset>' +
            '<fieldset><legend>Respuesta del equipo</legend><label>Mensaje<textarea data-text rows="2" maxlength="1000"></textarea></label><div class="media-rule-select"><label>Archivo de la biblioteca<select data-assets></select></label><label class="media-rule-upload">Subir archivos<input type="file" multiple data-upload accept=".jpg,.jpeg,.png,.mp3,.m4a,.mp4,image/jpeg,image/png,audio/mpeg,audio/mp4,video/mp4"></label></div><small>JPG o PNG hasta 5 MB. Audio MP3 o M4A y video MP4 hasta 16 MB. Usa material autorizado para compartir con pacientes.</small></fieldset>' +
            '<fieldset><legend>Prueba privada</legend><div class="media-rule-test"><label>Pregunta de ejemplo<input data-example maxlength="1000" placeholder="¿Me muestran fotos de carillas?"></label><label>Canal<select data-channel></select></label><button type="button" data-test>Probar respuesta</button></div><div data-preview hidden></div></fieldset></div>' +
            '<footer><span data-status role="status"></span><div><button type="button" data-pause hidden>Pausar sugerencia</button><button type="button" data-save>Guardar borrador</button><button type="button" class="btn btn-primary" data-activate>Activar sugerencia</button></div></footer>';
        document.body.append(dialog);
        dialog.showModal();
        const el = name => dialog.querySelector('[data-' + name + ']');
        let rules = [], files = [], row, dirty = false, busy = false, operational = false;
        const status = msg => { el('status').textContent = msg; };
        function currentClinic() { if (!clinic || window.tenantId !== clinic)
            throw new Error('Vuelve a abrir el editor desde la clínica actual.'); }
        function controls() {
            dialog.querySelectorAll('input,textarea,select,button:not([data-close])').forEach(x => { x.disabled = busy || !operational; });
            if (!row)
                return;
            el('activate').disabled = busy || !operational || dirty || !row.revision || row.tested_revision !== row.revision || row.active_revision === row.revision;
            el('pause').hidden = !row.active_revision;
        }
        function clearPreview() { el('preview').hidden = true; el('preview').replaceChildren(); }
        function note() { return row.active_revision ? (row.active_revision === row.revision ? 'Sugerencia activa.' : 'La versión anterior sigue activa.') : 'Modo sugerencia · pendiente de activar'; }
        async function run(fn) {
            if (busy)
                return;
            busy = true;
            controls();
            try {
                currentClinic();
                await fn();
            }
            catch (err) {
                status(err.message || 'No se pudo completar la acción. Intenta de nuevo.');
            }
            finally {
                busy = false;
                controls();
            }
        }
        function updateFiles(chosen) {
            el('assets').replaceChildren(option('', 'Selecciona un archivo'), ...files.map(f => option(f.path, (types[f.mime] || 'Archivo') + ' · ' + filename(f.path))));
            el('assets').value = chosen || '';
        }
        function show(next) {
            row = next;
            dirty = false;
            const d = row.draft;
            el('rules').replaceChildren(...rules.map(r => option(r.id, r.draft.title + (r.active_revision ? ' · activa' : ''))));
            if (!rules.some(r => r.id === row.id))
                el('rules').add(option(row.id, d.title || 'Nueva regla'));
            el('rules').value = row.id;
            for (const key of ['title', 'text', 'topics', 'requests', 'exclude'])
                el(key).value = Array.isArray(d[key]) ? d[key].join(', ') : d[key];
            el('channels').querySelectorAll('input').forEach(x => { x.checked = d.channels.includes(x.value); });
            updateFiles(d.asset);
            el('channel').value = d.channels[0] || 'whatsapp';
            el('example').value = d.topics.includes('carillas') ? '¿Me muestran fotos de carillas?' : '';
            clearPreview();
            status(note());
            controls();
        }
        function newRule(first) { return { id: crypto.randomUUID(), revision: 0, draft: template(first) }; }
        function mark() { dirty = true; clearPreview(); status(row.active_revision ? 'Cambios pendientes. La versión activa sigue disponible.' : 'Cambios pendientes de probar.'); controls(); }
        function values() {
            return { title: el('title').value.trim(), text: el('text').value.trim(), topics: list(el('topics').value),
                requests: list(el('requests').value), exclude: list(el('exclude').value), asset: el('assets').value,
                channels: [...el('channels').querySelectorAll('input:checked')].map(x => x.value) };
        }
        async function edit(action, extra = {}) {
            currentClinic();
            const data = await result(db.rpc('smyl_edit_media_rule', { p_action: action, p_id: row.id, p_revision: row.revision, ...extra }));
            currentClinic();
            row = data.rule;
            const idx = rules.findIndex(r => r.id === row.id);
            if (idx < 0)
                rules.push(row);
            else
                rules[idx] = row;
            let opt = [...el('rules').options].find(o => o.value === row.id);
            if (opt)
                opt.textContent = row.draft.title + (row.active_revision ? ' · activa' : '');
            return data;
        }
        async function save() { if (!dirty && row.revision)
            return; await edit('save', { p_draft: values() }); dirty = false; }
        async function readLibrary() {
            const entries = [];
            const store = db.storage.from(bucket);
            for (let offset = 0;; offset += 100) {
                const page = await result(store.list(clinic, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }));
                entries.push(...page.filter(x => types[x.metadata?.mimetype]).map(x => ({ path: clinic + '/' + x.name, mime: x.metadata.mimetype })));
                if (page.length < 100)
                    break;
            }
            return entries.sort((a, b) => filename(a.path).localeCompare(filename(b.path), 'es'));
        }
        function discard() { return !dirty || window.confirm('¿Descartar los cambios sin guardar?'); }
        el('close').onclick = () => { if (!busy && discard())
            dialog.close(); };
        dialog.oncancel = e => { if (busy || !discard())
            e.preventDefault(); };
        dialog.onclose = () => dialog.remove();
        for (const [id, title] of Object.entries(channels)) {
            const label = document.createElement('label'), check = document.createElement('input');
            check.type = 'checkbox';
            check.value = id;
            label.append(check, title);
            el('channels').append(label);
            el('channel').add(option(id, title));
        }
        dialog.oninput = e => {
            if (e.target.matches('[data-example],[data-channel]')) {
                clearPreview();
                return;
            }
            if (e.target.matches('[data-title],[data-text],[data-topics],[data-requests],[data-exclude],[data-assets],[type=checkbox]'))
                mark();
        };
        el('rules').onchange = () => { const next = rules.find(r => r.id === el('rules').value); if (next && discard())
            show(next);
        else
            el('rules').value = row.id; };
        el('new').onclick = () => { if (discard()) {
            show(newRule(false));
            el('title').focus();
        } };
        el('upload').onchange = () => run(async () => {
            const input = el('upload'), batch = Array.from(input.files, normalizeUpload);
            input.value = '';
            for (const f of batch) {
                if (!types[f.type] || !f.size || f.size > (f.type.startsWith('image/') ? 5 : 16) * 1048576)
                    throw new Error('Revisa el formato y el tamaño de ' + f.name + '.');
            }
            for (const f of batch) {
                currentClinic();
                status('Subiendo ' + f.name + '…');
                const name = f.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'archivo';
                const path = clinic + '/' + crypto.randomUUID() + '~' + name;
                await result(db.storage.from(bucket).upload(path, f, { contentType: f.type, upsert: false }));
                files.push({ path, mime: f.type });
                updateFiles(path);
                mark();
            }
            status('Archivos guardados. Elige el que acompañará esta respuesta.');
        });
        el('save').onclick = () => run(async () => { await save(); status('Borrador guardado.'); });
        el('test').onclick = () => run(async () => {
            clearPreview();
            const message = el('example').value.trim();
            if (!message)
                throw new Error('Escribe una pregunta de prueba.');
            await save();
            const file = files.find(f => f.path === row.draft.asset);
            if (!file)
                throw new Error('Elige un archivo de la biblioteca.');
            const signed = await result(db.storage.from(bucket).createSignedUrl(file.path, 600));
            const data = await edit('test', { p_message: message, p_channel: el('channel').value });
            const panel = el('preview');
            panel.hidden = false;
            if (!data.matched) {
                panel.textContent = 'Sin sugerencia para esta pregunta y canal.';
                status('Prueba terminada.');
                return;
            }
            const p = document.createElement('p');
            p.textContent = row.draft.text;
            panel.append(p, previewElement(file.mime, signed.signedUrl, filename(file.path)));
            status('Coincide. El equipo revisará el mensaje y el archivo antes de enviarlos.');
        });
        el('activate').onclick = () => run(async () => { await edit('activate'); window.dispatchEvent(new Event('smyl:media-rules-changed')); status('Sugerencia activa en el chat.'); });
        el('pause').onclick = () => run(async () => { await edit('pause'); window.dispatchEvent(new Event('smyl:media-rules-changed')); status('Sugerencia pausada.'); });
        status('Cargando biblioteca…');
        await run(async () => {
            [rules, files] = await Promise.all([result(db.from('smyl_media_rules').select('*').eq('tenant_id', clinic).order('id')), readLibrary()]);
            operational = true;
            show(rules[0] || newRule(true));
        });
    }
    window.SmylMediaReplies = { openEditor, bucket, filename };
})();
