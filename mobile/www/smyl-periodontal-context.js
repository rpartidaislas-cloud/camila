/* Scoped to one open dental record. The dental revision is the only write boundary. */
(function () {
  'use strict';
  function create(ctx, {model, readable, markDirty, saveDocument, readHistory, getFindings, notify}) {
    let history = Object.freeze([]), historyStatus = 'idle', historyRequest = null;
    const snapshots = new WeakMap();
    const editable = () => readable() && ctx.ready && ctx.canWrite && !ctx.busy;
    const draft = () => ctx.doc.periodontogram;
    const clone = value => value == null ? null : structuredClone(value);
    function freeze(value) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    }
    function snapshot(exam) {
      if (!exam) return null;
      if (!snapshots.has(exam)) snapshots.set(exam, freeze(clone(exam)));
      return snapshots.get(exam);
    }

    function getState() {
      if (!readable()) return {canRead:false, canEdit:false, ready:false, current:null, confirmed:null, history:[]};
      const current = draft(), saved = ctx.savedDoc.periodontogram;
      const previous = history.find(exam => exam.id !== current?.id && (!current || exam.date <= current.date));
      const closed = current?.status === 'closed' && history.find(exam => exam.id === current.id);
      return {
        canRead:true, canEdit:ctx.canWrite, ready:ctx.ready, dirty:!!ctx.dirty && !!ctx.perioDirty, busy:ctx.busy,
        otherChanges:!!ctx.dirty && !!ctx.otherDentalChanges,
        conflict:!!ctx.perioConflict, current:closed || snapshot(current), confirmed:snapshot(saved),
        previous:previous || null, history,
        historyLoading:historyStatus === 'loading', historyError:historyStatus === 'error'
      };
    }

    function replace(exam) {
      if (!model.validPeriodontalExam(exam)) return false;
      ctx.doc.periodontogram = exam;
      ctx.perioDirty = true;
      markDirty();
      return true;
    }
    function onStart(date) {
      if (!editable() || draft()?.status === 'draft') return false;
      return replace(model.createPeriodontalExam(date));
    }
    function onChange(patch) {
      if (!editable() || !patch || draft()?.status !== 'draft') return false;
      const exam = clone(draft());
      if (Object.hasOwn(patch, 'summary')) {
        exam.summary = patch.summary;
        return replace(exam);
      }
      const tooth = String(patch.tooth);
      if (!model.teeth.includes(tooth)) return false;
      const changes = Array.isArray(patch.changes) ? patch.changes : [patch];
      if (!changes.length) return false;
      const sites = exam.teeth[tooth] || {};
      for (const {site, field, value} of changes) {
        if (!model.periodontalSites.includes(site) || !['depth','margin','bleeding'].includes(field)) return false;
        const values = sites[site] || {depth:null, margin:null, bleeding:null};
        values[field] = value;
        if (Object.values(values).every(v => v === null)) delete sites[site];
        else sites[site] = values;
      }
      if (Object.keys(sites).length) exam.teeth[tooth] = sites;
      else delete exam.teeth[tooth];
      return replace(exam);
    }

    async function onSave({close = false} = {}) {
      if (!editable() || draft()?.status !== 'draft') return false;
      const prior = draft(), wasDirty = ctx.dirty, wasPerioDirty = ctx.perioDirty;
      if (close && !replace({...prior, status:'closed'})) return false;
      if (!ctx.dirty) return true;
      const ok = await saveDocument();
      if (!readable()) return false;
      if (!ok && close && draft()?.id === prior.id) {
        ctx.doc.periodontogram = prior;
        ctx.dirty = wasDirty;
        ctx.perioDirty = wasPerioDirty;
      }
      if (ok && close) {
        historyStatus = 'idle';
        historyRequest = null;
        await onHistory();
      }
      return !!ok;
    }

    async function onHistory() {
      if (!readable() || !ctx.ready) return false;
      if (historyStatus === 'ready') return true;
      if (historyRequest) return historyRequest.promise;
      const request = {};
      historyRequest = request;
      historyStatus = 'loading';
      request.promise = (async () => {
        const visits = new Map();
        let cursor = null;
        try {
          do {
            const rows = await readHistory(cursor);
            if (!readable() || historyRequest !== request) return false;
            if (!Array.isArray(rows)) throw new Error('Historial incompleto');
            for (const row of rows) {
              if (row.exam?.status !== 'closed' || !model.validPeriodontalExam(row.exam)) throw new Error('Visita inválida');
              if (!visits.has(row.exam.id)) visits.set(row.exam.id, {...row.exam, clinician:row.professional_name || '', revision:row.revision});
            }
            if (rows.length < 20) break;
            const last = Number(rows.at(-1).revision);
            if (!Number.isSafeInteger(last) || last < 1 || (cursor !== null && last >= cursor)) throw new Error('Página inválida');
            cursor = last;
          } while (true);
          history = freeze([...visits.values()].sort((a,b) => b.date.localeCompare(a.date) || b.revision-a.revision));
          historyStatus = 'ready';
          return true;
        } catch {
          if (historyRequest === request) historyStatus = 'error';
          return false;
        } finally {
          if (historyRequest === request) {
            historyRequest = null;
            if (readable()) notify();
          }
        }
      })();
      return request.promise;
    }
    return {getState, onStart, onChange, onSave, onHistory, getFindings:tooth => readable() ? getFindings(String(tooth)) : []};
  }
  window.SmylPeriodontalContext = {create};
})();
