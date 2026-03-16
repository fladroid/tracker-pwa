// db.js — IndexedDB wrapper, zamjena za sqflite

const DB_NAME    = 'tracker_v2';
const DB_VERSION = 1;

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('daily_values')) {
        const dv = db.createObjectStore('daily_values', { keyPath: 'id', autoIncrement: true });
        dv.createIndex('btn_date', ['button_id', 'date'], { unique: true });
      }
      if (!db.objectStoreNames.contains('log')) {
        const lg = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
        lg.createIndex('timestamp', 'timestamp');
        lg.createIndex('deleted', 'deleted');
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function tx(storeName, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t  = db.transaction(storeName, mode);
    const st = t.objectStore(storeName);
    const req = fn(st);
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror    = e => reject(e.target.error);
  }));
}

function getAll(storeName, indexName, query) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t   = db.transaction(storeName, 'readonly');
    const st  = t.objectStore(storeName);
    const src = indexName ? st.index(indexName) : st;
    const req = query !== undefined ? src.getAll(query) : src.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

export function dateKey(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const d = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

// ─── DAILY VALUES ────────────────────────────────────────────

export async function getValue(buttonId, date) {
  const key    = dateKey(date);
  const all    = await getAll('daily_values', 'btn_date', IDBKeyRange.only([buttonId, key]));
  return all.length ? all[0].value : 0;
}

export async function getValuesForDate(date) {
  const key  = dateKey(date);
  const all  = await getAll('daily_values');
  const res  = {};
  all.filter(r => r.date === key).forEach(r => res[r.button_id] = r.value);
  return res;
}

export async function changeValue(buttonId, date, delta) {
  const db      = await openDb();
  const key     = dateKey(date);
  const current = await getValue(buttonId, date);
  const newVal  = Math.max(0, Math.min(999, current + delta));

  return new Promise((resolve, reject) => {
    const t  = db.transaction('daily_values', 'readwrite');
    const st = t.objectStore('daily_values');
    const idx = st.index('btn_date');
    const q   = idx.getAll(IDBKeyRange.only([buttonId, key]));
    q.onsuccess = () => {
      const existing = q.result[0];
      if (existing) {
        existing.value = newVal;
        st.put(existing);
      } else {
        st.add({ button_id: buttonId, date: key, value: newVal });
      }
    };
    t.oncomplete = () => resolve(newVal);
    t.onerror    = e => reject(e.target.error);
  });
}

export async function getCumulativeValues(from, to) {
  const fromKey = dateKey(from);
  const toKey   = dateKey(to);
  const all     = await getAll('daily_values');
  const res     = {};
  all.filter(r => r.date >= fromKey && r.date <= toKey).forEach(r => {
    res[r.button_id] = (res[r.button_id] || 0) + r.value;
  });
  return res;
}

// ─── LOG ─────────────────────────────────────────────────────

export async function addLog({ type, buttonId = null, delta = null, textValue = null, timestamp }) {
  const db  = await openDb();
  const ts  = timestamp instanceof Date
    ? timestamp.toISOString()
    : (timestamp || new Date().toISOString());
  const entry = { timestamp: ts, type, button_id: buttonId, delta, text_value: textValue, deleted: 0 };
  return new Promise((resolve, reject) => {
    const t  = db.transaction('log', 'readwrite');
    const st = t.objectStore('log');
    const r  = st.add(entry);
    t.oncomplete = () => resolve({ ...entry, id: r.result });
    t.onerror    = e => reject(e.target.error);
  });
}

export async function getLogForRange(from, to, includeDeleted = false) {
  const all = await getAll('log');
  const fromTs = from.toISOString();
  const toTs   = to.toISOString();
  return all
    .filter(r => r.timestamp >= fromTs && r.timestamp <= toTs)
    .filter(r => includeDeleted || r.deleted === 0)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function getAllLog(includeDeleted = false) {
  const all = await getAll('log');
  return includeDeleted ? all : all.filter(r => r.deleted === 0);
}

export async function getTextValue(buttonId, date) {
  const key = dateKey(date);
  const all = await getAll('log');
  const matches = all
    .filter(r => r.button_id === buttonId && r.type === 'text'
              && r.timestamp.startsWith(key) && r.deleted === 0)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return matches.length ? matches[0].text_value : null;
}

export async function getTextValuesForDate(date) {
  const key = dateKey(date);
  const all = await getAll('log');
  const res = {};
  const grouped = {};
  all.filter(r => r.type === 'text' && r.timestamp.startsWith(key) && r.deleted === 0)
     .forEach(r => {
       if (!grouped[r.button_id] || r.timestamp > grouped[r.button_id].timestamp)
         grouped[r.button_id] = r;
     });
  Object.entries(grouped).forEach(([k, v]) => res[k] = v.text_value);
  return res;
}

export async function saveTextValue(buttonId, date, text, timestamp) {
  const db  = await openDb();
  const key = dateKey(date);
  // soft-delete stare text unose za taj dan
  const all = await getAll('log');
  const toDelete = all.filter(r =>
    r.button_id === buttonId && r.type === 'text' && r.timestamp.startsWith(key));
  if (toDelete.length) {
    await new Promise((resolve, reject) => {
      const t  = db.transaction('log', 'readwrite');
      const st = t.objectStore('log');
      toDelete.forEach(r => { r.deleted = 1; st.put(r); });
      t.oncomplete = resolve;
      t.onerror    = e => reject(e.target.error);
    });
  }
  const ts = timestamp instanceof Date ? timestamp : date;
  await addLog({ type: 'text', buttonId, textValue: text, timestamp: ts });
}

export async function resetDayToZero({ date, counterIds, textIds, currentValues }) {
  const db  = await openDb();
  const key = dateKey(date);
  const now = new Date();
  const ts  = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
    now.getHours(), now.getMinutes(), now.getSeconds());

  const allDv  = await getAll('daily_values');
  const allLog = await getAll('log');

  await new Promise((resolve, reject) => {
    const t   = db.transaction(['daily_values', 'log'], 'readwrite');
    const dvS = t.objectStore('daily_values');
    const lgS = t.objectStore('log');

    for (const id of counterIds) {
      const current = currentValues[id] || 0;
      if (current <= 0) continue;
      const existing = allDv.find(r => r.button_id === id && r.date === key);
      if (existing) { existing.value = 0; dvS.put(existing); }
      lgS.add({ timestamp: ts.toISOString(), type: 'counter',
        button_id: id, delta: -current, text_value: null, deleted: 0 });
    }

    for (const id of textIds) {
      allLog.filter(r => r.button_id === id && r.type === 'text' && r.timestamp.startsWith(key))
        .forEach(r => { r.deleted = 1; lgS.put(r); });
      lgS.add({ timestamp: ts.toISOString(), type: 'text',
        button_id: id, delta: null, text_value: '', deleted: 0 });
    }

    t.oncomplete = resolve;
    t.onerror    = e => reject(e.target.error);
  });
}

export async function getDbStats() {
  const log    = await getAll('log');
  const daily  = await getAll('daily_values');
  const active = log.filter(r => r.deleted === 0).length;
  return {
    total_log:    log.length,
    active_log:   active,
    deleted_log:  log.length - active,
    total_daily:  daily.length,
  };
}
