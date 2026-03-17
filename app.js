// app.js — Tracker PWA core logic
import * as DB from './db.js';

// ─── STATE ───────────────────────────────────────────────────
const state = {
  config:       null,
  buttons:      [],
  values:       {},
  textValues:   {},
  lang:         'en',
  tr:           {},
  selectedDate: new Date(),
  showLabels:   true,
  size:         'medium',
  contrast:     'normal',
  warnedDates:  new Set(),
  screen:       'home',  // home | history | report | settings
  historyPeriod: '7',
  historyRangeFrom: null,
  historyRangeTo:   null,
  reportPeriod:  '7',
  reportRangeFrom: null,
  reportRangeTo:   null,
};

// ─── THEME ───────────────────────────────────────────────────
const SIZES = {
  small:  { symbol:22, label:7,  body:11, caption:9,  header:18, counter:18 },
  medium: { symbol:28, label:9,  body:13, caption:11, header:22, counter:22 },
  large:  { symbol:38, label:12, body:15, caption:13, header:26, counter:28 },
};
const COLORS = {
  normal: {
    background:'#F5F0E8', surface:'#FAF7F2', ink:'#1A1A1A',
    inkMedium:'#4A4540', inkLight:'#6B6560', inkFaint:'#9A9590',
    border:'#DDD8CE', accent:'#2D5A27', accentText:'#ffffff',
    destructive:'#8B2020', positive:'#2D5A27',
  },
  high: {
    background:'#F0EBE0', surface:'#FFFFFF', ink:'#000000',
    inkMedium:'#2A2A2A', inkLight:'#3A3A3A', inkFaint:'#555555',
    border:'#888880', accent:'#2D5A27', accentText:'#ffffff',
    destructive:'#8B2020', positive:'#2D5A27',
  },
};
function theme(k)  { return (COLORS[state.contrast] || COLORS.normal)[k]; }
function sz(k)     { return (SIZES[state.size] || SIZES.medium)[k]; }
function css(k)    { return `${sz(k)}px`; }

// ─── TRANSLATIONS ────────────────────────────────────────────
function t(key, params) {
  let s = state.tr[key] || key;
  if (params) Object.entries(params).forEach(([k,v]) => s = s.replaceAll(`{${k}}`, v));
  return s;
}

function dayName(weekday) {
  const days = state.tr['days'] || [];
  return days[(weekday + 6) % 7] || '';
}

function monthName(month) {
  return (state.tr['months'] || [])[month] || '';
}

function formatHeaderMain(date) {
  const now = new Date();
  const isToday = sameDay(date, now);
  const isYest  = sameDay(date, new Date(now - 86400000));
  const isTomor = sameDay(date, new Date(now.getTime() + 86400000));
  if (isToday) return t('today');
  if (isYest)  return t('yesterday');
  if (isTomor) return t('tomorrow');
  return dayName(date.getDay());
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2,'0');
  const m = String(date.getMonth()+1).padStart(2,'0');
  return `${d}.${m}.${date.getFullYear()}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

function formatDayShort(date) {
  const name = dayName(date.getDay());
  return name.length >= 3 ? name.substring(0,3) : name;
}

function sameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function isRelativeDay(date) {
  const now = new Date();
  return sameDay(date, now)
    || sameDay(date, new Date(now - 86400000))
    || sameDay(date, new Date(now.getTime() + 86400000));
}

// ─── STORAGE (settings) ──────────────────────────────────────
const LS = {
  get: k          => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v)     => localStorage.setItem(k, JSON.stringify(v)),
};

function loadSettings() {
  state.lang       = LS.get('lang')        || state.config?.language || 'en';
  state.showLabels = LS.get('showLabels') !== false;
  state.size       = LS.get('size')        || state.config?.ui?.size       || 'medium';
  state.contrast   = LS.get('contrast')    || state.config?.ui?.contrast   || 'normal';
  applyTranslations();
}

function saveSettings() {
  LS.set('lang',       state.lang);
  LS.set('showLabels', state.showLabels);
  LS.set('size',       state.size);
  LS.set('contrast',   state.contrast);
}

function applyTranslations() {
  state.tr = state.config?.translations?.[state.lang] || {};
}

// ─── INIT ────────────────────────────────────────────────────
async function init() {
  const res    = await fetch('config.json');
  state.config = await res.json();
  state.buttons = state.config.buttons || [];
  loadSettings();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.warn);
  }

  await loadHomeData();
  await render();
}

async function loadHomeData() {
  state.values     = await DB.getValuesForDate(state.selectedDate);
  state.textValues = await DB.getTextValuesForDate(state.selectedDate);
}

// ─── RENDERING ───────────────────────────────────────────────
async function render() {
  const app = document.getElementById('app');
  app.style.background = theme('background');
  app.style.color      = theme('ink');
  app.style.fontFamily = 'monospace';
  app.style.fontSize   = css('body');

  switch (state.screen) {
    case 'home':     app.innerHTML = renderHome();             break;
    case 'history':  app.innerHTML = await renderHistory();    break;
    case 'report':   app.innerHTML = await renderReport();     break;
    case 'settings': app.innerHTML = await renderSettings();   break;
  }
  bindEvents();
}

// ─── HOME SCREEN ─────────────────────────────────────────────
function renderHome() {
  const counters = state.buttons.filter(b => b.type === 'counter');
  const texts    = state.buttons.filter(b => b.type === 'text');
  const showSub  = isRelativeDay(state.selectedDate);

  const langs = (state.config?.languages || []).map(l =>
    `<option value="${l.code}" ${l.code===state.lang?'selected':''}>${l.label}</option>`
  ).join('');

  const gridItems = counters.map(btn => {
    const val = state.values[btn.id] || 0;
    return `
    <div class="counter-btn" style="
      background:${theme('surface')};
      border:1px solid ${theme('border')};
      border-radius:8px;
      padding:10px 6px;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:4px;
    ">
      <span style="font-size:${css('symbol')}">${btn.symbol}</span>
      ${state.showLabels ? `<span style="font-size:${css('label')};color:${theme('inkLight')}">${btn.label?.[state.lang]||''}</span>` : ''}
      <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
        <button data-action="minus" data-id="${btn.id}" style="
          width:28px;height:28px;border-radius:4px;border:1px solid ${theme('border')};
          background:${theme('background')};color:${theme('inkLight')};
          font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
        <span style="font-size:${css('counter')};font-weight:600;min-width:24px;text-align:center;color:${theme('ink')}">${val}</span>
        <button data-action="plus" data-id="${btn.id}" style="
          width:28px;height:28px;border-radius:4px;border:1px solid ${theme('border')};
          background:${theme('background')};color:${theme('inkLight')};
          font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>
      </div>
    </div>`;
  }).join('');

  const textBtns = texts.map(btn => {
    const saved = state.textValues[btn.id] || '';
    return `
    <div class="text-btn" data-id="${btn.id}" style="
      background:${theme('surface')};border:1px solid ${theme('border')};
      border-radius:8px;padding:12px 14px;cursor:pointer;
      display:flex;align-items:center;gap:10px;">
      <span style="font-size:${css('symbol')}">${btn.symbol}</span>
      <div style="flex:1;min-width:0">
        ${state.showLabels ? `<div style="font-size:${css('label')};color:${theme('inkFaint')};margin-bottom:2px">${btn.label?.[state.lang]||''}</div>` : ''}
        <div style="font-size:${css('body')};color:${saved?theme('inkMedium'):theme('inkFaint')};
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${saved || t('text_tap_to_edit')}
        </div>
      </div>
    </div>`;
  }).join('');

  return `
  <div style="display:flex;flex-direction:column;height:100%;max-width:480px;margin:0 auto">
    <!-- TOP BAR -->
    <div style="padding:12px 12px 10px;border-bottom:1px solid ${theme('border')}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:${css('caption')};font-weight:600;color:${theme('inkFaint')};letter-spacing:1.2px">Tracker v2.9.3</span>
        <select id="lang-select" style="
          font-family:monospace;font-size:${css('caption')};
          background:${theme('surface')};color:${theme('ink')};
          border:1px solid ${theme('border')};border-radius:4px;
          padding:2px 6px;cursor:pointer">${langs}</select>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          <div style="font-size:${css('header')};font-weight:600;color:${theme('ink')}">${formatHeaderMain(state.selectedDate)}</div>
          ${showSub ? `<div style="font-size:${css('caption')};color:${theme('inkLight')}">${formatDate(state.selectedDate)}</div>` : ''}
          <div style="margin-top:4px">
            <button id="reset-day-btn" style="
              font-family:monospace;font-size:${sz('caption')-1}px;
              color:${theme('destructive')};
              border:1px solid ${theme('destructive')}44;
              background:transparent;border-radius:4px;
              padding:3px 8px;cursor:pointer">${t('reset_day_btn')}</button>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button data-action="nav-prev" style="${navBtnStyle()}">‹</button>
          <button data-action="nav-next" style="${navBtnStyle()}">›</button>
        </div>
      </div>
    </div>
    <!-- CONTENT -->
    <div style="flex:1;overflow-y:auto;padding:12px">
      <div style="
        display:grid;grid-template-columns:repeat(3,1fr);
        gap:8px;margin-bottom:${texts.length?'12px':'0'}">
        ${gridItems}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${textBtns}
      </div>
    </div>
    <!-- BOTTOM BAR -->
    ${renderBottomBar('home')}
  </div>`;
}

function navBtnStyle() {
  return `width:32px;height:32px;border:1px solid ${theme('inkFaint')};
    border-radius:4px;background:transparent;color:${theme('inkLight')};
    font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;`;
}

function renderBottomBar(active) {
  const tabs = [
    { id:'history',  icon:'◫', key:'nav_history' },
    { id:'report',   icon:'📊', key:'nav_report' },
    { id:'settings', icon:'⚙', key:'nav_settings' },
  ];
  const items = tabs.map(tab => {
    const isActive = tab.id === active;
    const color    = isActive ? theme('accent') : theme('inkFaint');
    return `
    <div data-nav="${tab.id}" style="
      flex:1;display:flex;flex-direction:column;align-items:center;
      gap:3px;padding:8px 0;cursor:pointer">
      <span style="font-size:16px;color:${color}">${tab.icon}</span>
      <span style="font-size:7px;letter-spacing:0.8px;color:${color};
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50px">
        ${t(tab.key)}
      </span>
    </div>`;
  }).join('');
  return `<div style="
    border-top:1px solid ${theme('border')};
    padding:4px 20px 12px;
    display:flex">${items}</div>`;
}

// ─── HISTORY SCREEN ──────────────────────────────────────────
async function loadHistoryData() {
  const now = new Date();
  let from, to;
  if (state.historyPeriod === 'range') {
    from = new Date(state.historyRangeFrom); from.setHours(0,0,0,0);
    to   = new Date(state.historyRangeTo);   to.setHours(23,59,59,999);
  } else {
    const days = parseInt(state.historyPeriod);
    from = new Date(now); from.setHours(0,0,0,0); from.setDate(from.getDate()-days);
    to   = new Date(now); to.setHours(23,59,59,999);
  }
  const includeDeleted = state.historyPeriod === 'range';
  return await DB.getLogForRange(from, to, includeDeleted);
}

async function renderHistory() {
  const entries = await loadHistoryData();
  const btns    = Object.fromEntries(state.buttons.map(b => [b.id, b]));

  const periodBtns = ['7','30'].map(p => {
    const sel = state.historyPeriod === p;
    return `<button data-hist-period="${p}" style="${periodBtnStyle(sel)}">${t(`period_${p==='7'?'7':'30'}`)}</button>`;
  }).join('');

  const rows = entries.flatMap(e => {
    const btn     = btns[e.button_id];
    const dt      = new Date(e.timestamp);
    const isDel   = e.deleted === 1;
    const isText  = e.type === 'text';
    const delta   = e.delta != null ? (e.delta > 0 ? `+${e.delta}` : `${e.delta}`) : (isText ? 'T' : 'S');
    const label   = btn ? (btn.label?.[state.lang] || e.button_id) : (e.text_value || e.type);
    const symbol  = btn ? btn.symbol : (e.type==='settings'?'S':'?');
    const dColor  = delta.startsWith('+') ? theme('positive') : delta.startsWith('-') ? theme('destructive') : theme('inkMedium');
    const baseStyle = `font-size:${css('caption')};color:${isDel?theme('inkFaint'):theme('inkMedium')};
      ${isDel?'text-decoration:line-through':''}`;
    const bg = entries.indexOf(e) % 2 === 0 ? theme('surface') : theme('background');

    const mainRow = `
    <tr style="background:${bg}">
      <td style="${baseStyle};padding:6px 4px 6px 0;white-space:nowrap">${formatDayShort(dt)}</td>
      <td style="${baseStyle};padding:6px 4px;white-space:nowrap">${formatDate(dt)}</td>
      <td style="${baseStyle};padding:6px 4px;white-space:nowrap">${formatTime(dt)}</td>
      <td style="padding:6px 4px;font-size:${sz('caption')+2}px">${symbol}</td>
      <td style="${baseStyle};padding:6px 4px;color:${dColor};text-decoration:none;white-space:nowrap">${delta}</td>
      <td style="${baseStyle};padding:6px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px">${label}</td>
    </tr>`;

    const noteRow = (isText && e.text_value) ? `
    <tr style="background:${bg}">
      <td colspan="5"></td>
      <td style="padding:0 4px 6px 0">
        <div style="
          background:${theme('accent')}12;border:1px solid ${theme('accent')}33;
          border-radius:4px;padding:4px 8px;
          font-size:${css('caption')};color:${theme('inkMedium')};font-style:italic">
          ${e.text_value}
        </div>
      </td>
    </tr>` : '';

    return mainRow + noteRow;
  }).join('');

  const rangeLabel = state.historyPeriod === 'range' && state.historyRangeFrom
    ? `${formatDate(new Date(state.historyRangeFrom))}–${formatDate(new Date(state.historyRangeTo))}`
    : '';

  return `
  <div style="display:flex;flex-direction:column;height:100%;max-width:480px;margin:0 auto">
    <div style="padding:18px 12px 12px;border-bottom:1px solid ${theme('border')};display:flex;align-items:center;gap:10px">
      <button data-nav="home" style="background:none;border:none;font-size:22px;color:${theme('inkLight')};cursor:pointer">‹</button>
      <span style="font-size:${sz('header')*0.8}px;font-weight:600;color:${theme('ink')}">${t('history_title')}</span>
      <span style="margin-left:auto;font-size:${css('caption')};color:${theme('inkFaint')}">${rangeLabel} ${entries.length}</span>
    </div>
    <div style="padding:8px 12px;border-bottom:1px solid ${theme('border')};display:flex;gap:6px;align-items:center">
      ${periodBtns}
      <button id="range-btn" style="${periodBtnStyle(state.historyPeriod==='range')}">${t('period_range')}</button>
    </div>
    ${state.historyPeriod==='range' ? `
    <div style="padding:6px 12px;border-bottom:1px solid ${theme('border')};display:flex;gap:8px;align-items:center">
      <label style="font-size:${css('caption')};color:${theme('inkLight')}">${t('range_from')}</label>
      <input type="date" id="range-from" value="${state.historyRangeFrom||''}" style="${dateInputStyle()}">
      <label style="font-size:${css('caption')};color:${theme('inkLight')}">${t('range_to')}</label>
      <input type="date" id="range-to" value="${state.historyRangeTo||''}" style="${dateInputStyle()}">
      <button id="range-apply" style="${periodBtnStyle(false)}">${t('range_apply')}</button>
    </div>` : ''}
    <div style="flex:1;overflow:auto;padding:0 12px">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup>
          <col style="width:10%"><col style="width:18%"><col style="width:12%">
          <col style="width:7%"><col style="width:9%"><col style="width:44%">
        </colgroup>
        <thead>
          <tr style="background:${theme('surface')};border-bottom:1.5px solid ${theme('border')}">
            ${['col_day','col_date','col_time','col_symbol','col_delta','col_label'].map(k =>
              `<th style="padding:7px 4px;font-size:${sz('caption')-1}px;font-weight:600;
                color:${theme('inkFaint')};text-align:left;white-space:nowrap">${t(k)}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6" style="padding:20px;text-align:center;color:${theme('inkFaint')}">${t('no_entries_period')}</td></tr>`}</tbody>
      </table>
    </div>
    ${renderBottomBar('history')}
  </div>`;
}

function dateInputStyle() {
  return `font-family:monospace;font-size:${css('caption')};
    background:${theme('surface')};color:${theme('ink')};
    border:1px solid ${theme('border')};border-radius:4px;padding:4px 6px;`;
}

function periodBtnStyle(selected) {
  return `font-family:monospace;font-size:${css('caption')};
    background:${selected?theme('accent'):theme('surface')};
    color:${selected?theme('accentText'):theme('inkLight')};
    border:1px solid ${selected?theme('accent'):theme('border')};
    border-radius:4px;padding:5px 10px;cursor:pointer;`;
}

// ─── REPORT SCREEN ───────────────────────────────────────────
async function renderReport() {
  const now = new Date();
  let from, to;
  if (state.reportPeriod === 'range') {
    from = new Date(state.reportRangeFrom); from.setHours(0,0,0,0);
    to   = new Date(state.reportRangeTo);   to.setHours(23,59,59,999);
  } else {
    const days = parseInt(state.reportPeriod);
    from = new Date(now); from.setDate(from.getDate()-days); from.setHours(0,0,0,0);
    to   = new Date(now); to.setHours(23,59,59,999);
  }

  const cumulative = await DB.getCumulativeValues(from, to);
  const counters   = state.buttons.filter(b => b.type === 'counter');

  const periodBtns = ['7','30'].map(p => {
    const sel = state.reportPeriod === p;
    return `<button data-rep-period="${p}" style="${periodBtnStyle(sel)}">${t(`period_${p==='7'?'7':'30'}`)}</button>`;
  }).join('');

  const rangeLabel = state.reportPeriod === 'range' && state.reportRangeFrom
    ? `${formatDate(new Date(state.reportRangeFrom))} – ${formatDate(new Date(state.reportRangeTo))}`
    : '';

  const items = counters.map(btn => {
    const total = cumulative[btn.id] || 0;
    return `
    <div style="
      background:${theme('surface')};
      border:1px solid ${total>0?theme('accent'):theme('border')};
      border-radius:8px;padding:16px;margin-bottom:10px;
      display:flex;align-items:center;gap:16px">
      <span style="font-size:${css('symbol')}">${btn.symbol}</span>
      <span style="flex:1;font-size:${css('body')};color:${theme('ink')}">${btn.label?.[state.lang]||''}</span>
      <span style="font-size:${css('header')};font-weight:600;color:${total>0?theme('accent'):theme('inkFaint')}">${total}</span>
    </div>`;
  }).join('');

  return `
  <div style="display:flex;flex-direction:column;height:100%;max-width:480px;margin:0 auto">
    <div style="padding:18px 20px 12px;border-bottom:1px solid ${theme('border')};display:flex;align-items:center;gap:16px">
      <button data-nav="home" style="background:none;border:none;font-size:22px;color:${theme('inkLight')};cursor:pointer">‹</button>
      <span style="font-size:${sz('header')*0.8}px;font-weight:600;color:${theme('ink')}">${t('report_title')}</span>
      <span style="margin-left:auto;font-size:${css('caption')};color:${theme('inkLight')}">${rangeLabel}</span>
    </div>
    <div style="padding:10px 20px;border-bottom:1px solid ${theme('border')};display:flex;gap:8px">
      ${periodBtns}
      <button id="rep-range-btn" style="${periodBtnStyle(state.reportPeriod==='range')}">${t('period_range')}</button>
    </div>
    ${state.reportPeriod==='range' ? `
    <div style="padding:6px 20px;border-bottom:1px solid ${theme('border')};display:flex;gap:8px;align-items:center">
      <label style="font-size:${css('caption')};color:${theme('inkLight')}">${t('range_from')}</label>
      <input type="date" id="rep-range-from" value="${state.reportRangeFrom||''}" style="${dateInputStyle()}">
      <label style="font-size:${css('caption')};color:${theme('inkLight')}">${t('range_to')}</label>
      <input type="date" id="rep-range-to" value="${state.reportRangeTo||''}" style="${dateInputStyle()}">
      <button id="rep-range-apply" style="${periodBtnStyle(false)}">${t('range_apply')}</button>
    </div>` : ''}
    <div style="flex:1;overflow-y:auto;padding:20px">
      ${items || `<p style="text-align:center;color:${theme('inkFaint')}">${t('no_entries_period')}</p>`}
    </div>
    ${renderBottomBar('report')}
  </div>`;
}

// ─── SETTINGS SCREEN ─────────────────────────────────────────
async function renderSettings() {
  const stats  = await DB.getDbStats();
  const langs  = (state.config?.languages || []).map(l =>
    `<option value="${l.code}" ${l.code===state.lang?'selected':''}>${l.label}</option>`
  ).join('');

  const sizeOpts = ['small','medium','large'].map(v => ({v, l:t(`settings_size_${v}`)}));
  const contOpts = ['normal','high'].map(v => ({v, l:t(`settings_contrast_${v}`)}));

  return `
  <div style="display:flex;flex-direction:column;height:100%;max-width:480px;margin:0 auto">
    <div style="padding:18px 20px 12px;border-bottom:1px solid ${theme('border')};display:flex;align-items:center;gap:16px">
      <button data-nav="home" style="background:none;border:none;font-size:22px;color:${theme('inkLight')};cursor:pointer">‹</button>
      <span style="font-size:${sz('header')*0.8}px;font-weight:600;color:${theme('ink')}">${t('settings_title')}</span>
    </div>
    <div style="flex:1;overflow-y:auto;padding:20px">

      ${sectionLabel(t('settings_display'))}
      ${settingsRow(t('settings_show_labels'),
        `<label style="display:flex;align-items:center;cursor:pointer">
          <input type="checkbox" id="toggle-labels" ${state.showLabels?'checked':''} style="display:none">
          <div id="toggle-labels-track" style="${toggleStyle(state.showLabels)}"></div>
        </label>`)}
      <div style="height:12px"></div>

      ${sectionLabel(t('settings_size'))}
      ${segmented(sizeOpts, state.size, 'size')}
      <div style="height:12px"></div>

      ${sectionLabel(t('settings_contrast'))}
      ${segmented(contOpts, state.contrast, 'contrast')}
      <div style="height:28px"></div>

      ${sectionLabel(t('settings_language'))}
      <div style="background:${theme('surface')};border:1px solid ${theme('border')};border-radius:6px;padding:4px 14px">
        <select id="lang-select-settings" style="
          width:100%;font-family:monospace;font-size:${css('body')};
          background:transparent;color:${theme('ink')};border:none;
          padding:8px 0;cursor:pointer">${langs}</select>
      </div>
      <div style="height:28px"></div>

      ${sectionLabel(t('settings_export'))}
      ${actionBtn(t('settings_export_json'), 'export-json')}
      <div style="height:6px"></div>
      ${actionBtn(t('settings_export_csv'), 'export-csv')}
      <div style="height:28px"></div>

      ${sectionLabel(t('settings_import'))}
      ${actionBtn(t('settings_import_json'), 'import-json')}
      <div style="height:6px"></div>
      ${actionBtn(t('settings_import_csv'), 'import-csv')}
      <div style="height:28px"></div>

      ${sectionLabel(t('settings_db'))}
      <div style="background:${theme('surface')};border:1px solid ${theme('border')};border-radius:6px;padding:14px">
        ${statRow(t('db_total_log'),   stats.total_log)}
        ${statRow(t('db_active_log'),  stats.active_log)}
        ${statRow(t('db_daily_values'),stats.total_daily)}
      </div>
      <div style="height:28px"></div>

      ${sectionLabel(t('settings_reset'))}
      ${actionBtn(t('settings_reset_btn'), 'reset-default', true)}
      <div style="height:20px"></div>
    </div>
    ${renderBottomBar('settings')}
  </div>`;
}

function sectionLabel(text) {
  return `<div style="font-size:10px;letter-spacing:1.2px;color:${theme('inkFaint')};margin-bottom:10px">${text.toUpperCase()}</div>`;
}

function settingsRow(label, trailing) {
  return `<div style="
    background:${theme('surface')};border:1px solid ${theme('border')};border-radius:6px;
    padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:${css('body')};color:${theme('ink')}">${label}</span>
    ${trailing}
  </div>`;
}

function toggleStyle(on) {
  return `width:40px;height:22px;border-radius:11px;
    background:${on?theme('accent'):'#ccc'};position:relative;transition:background 0.2s;
    display:inline-block;
    &::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;
    background:white;top:2px;left:${on?'20px':'2px'};transition:left 0.2s}`;
}

function segmented(opts, selected, type) {
  return `<div style="display:flex;gap:4px">
    ${opts.map(o => `
      <button data-seg="${type}" data-val="${o.v}" style="
        flex:1;font-family:monospace;font-size:${css('caption')};
        background:${selected===o.v?theme('accent'):theme('surface')};
        color:${selected===o.v?theme('accentText'):theme('inkLight')};
        border:1px solid ${selected===o.v?theme('accent'):theme('border')};
        border-radius:6px;padding:10px 4px;cursor:pointer">${o.l}</button>`).join('')}
  </div>`;
}

function actionBtn(label, id, destructive=false) {
  return `<button id="${id}" style="
    width:100%;font-family:monospace;font-size:${css('body')};
    background:${theme('surface')};
    color:${destructive?theme('destructive'):theme('ink')};
    border:1px solid ${destructive?theme('destructive'):theme('border')};
    border-radius:6px;padding:12px 14px;cursor:pointer;text-align:left">${label}</button>`;
}

function statRow(label, value) {
  return `<div style="display:flex;justify-content:space-between;padding:3px 0">
    <span style="font-size:${css('caption')};color:${theme('inkLight')}">${label}</span>
    <span style="font-size:${css('caption')};font-weight:600;color:${theme('ink')}">${value}</span>
  </div>`;
}

// ─── DIALOG / MODAL ──────────────────────────────────────────
function showDialog({ title, body, cancel, ok, destructive=false }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px`;
    overlay.innerHTML = `
      <div style="
        background:${theme('surface')};border-radius:12px;padding:24px;
        max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.2)">
        <div style="font-size:${css('body')};font-weight:600;color:${theme('ink')};margin-bottom:12px">${title}</div>
        <div style="font-size:${css('caption')};color:${theme('inkLight')};margin-bottom:20px">${body}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          ${cancel ? `<button id="dlg-cancel" style="
            font-family:monospace;font-size:${css('caption')};
            background:${theme('surface')};color:${theme('inkLight')};
            border:1px solid ${theme('border')};border-radius:6px;
            padding:8px 16px;cursor:pointer">${cancel}</button>` : ''}
          <button id="dlg-ok" style="
            font-family:monospace;font-size:${css('caption')};
            background:${destructive?theme('destructive'):theme('accent')};
            color:white;border:none;border-radius:6px;
            padding:8px 16px;cursor:pointer">${ok}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#dlg-ok')?.addEventListener('click', () => cleanup(true));
    overlay.querySelector('#dlg-cancel')?.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', e => { if (e.target===overlay) cleanup(false); });
  });
}

function showToast(msg, duration=2500) {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:${theme('ink')};color:${theme('surface')};
    font-family:monospace;font-size:${css('caption')};
    padding:8px 16px;border-radius:6px;z-index:2000;
    box-shadow:0 4px 12px rgba(0,0,0,0.3)`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ─── TEXT INPUT DIALOG ────────────────────────────────────────
function showTextDialog(btn, existingText) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.5);
      display:flex;align-items:flex-end;justify-content:center;z-index:1000`;
    overlay.innerHTML = `
      <div style="
        background:${theme('surface')};border-radius:16px 16px 0 0;
        padding:20px;width:100%;max-width:480px;
        box-shadow:0 -4px 24px rgba(0,0,0,0.2)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <span style="font-size:${css('symbol')}">${btn.symbol}</span>
          <span style="font-size:${css('body')};color:${theme('inkLight')}">${btn.label?.[state.lang]||''}</span>
        </div>
        <textarea id="text-input" rows="4" style="
          width:100%;font-family:monospace;font-size:${css('body')};
          background:${theme('background')};color:${theme('ink')};
          border:1px solid ${theme('border')};border-radius:8px;
          padding:10px;resize:none;box-sizing:border-box"
          placeholder="${t('text_hint')}">${existingText||''}</textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button id="text-cancel" style="
            font-family:monospace;font-size:${css('caption')};
            background:${theme('surface')};color:${theme('inkLight')};
            border:1px solid ${theme('border')};border-radius:6px;
            padding:8px 16px;cursor:pointer">${t('reset_confirm_cancel')}</button>
          <button id="text-save" style="
            font-family:monospace;font-size:${css('caption')};
            background:${theme('accent')};color:white;
            border:none;border-radius:6px;
            padding:8px 16px;cursor:pointer">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#text-input').focus();
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#text-save').addEventListener('click', () => {
      cleanup(overlay.querySelector('#text-input').value);
    });
    overlay.querySelector('#text-cancel').addEventListener('click', () => cleanup(null));
  });
}

// ─── DATE WARNING ─────────────────────────────────────────────
async function checkDateWarning(date) {
  if (sameDay(date, new Date())) return true;
  const key = DB.dateKey(date);
  if (state.warnedDates.has(key)) return true;
  const isPast = date < new Date();
  const ok = await showDialog({
    title:  t(isPast ? 'past_warning_title' : 'future_warning_title'),
    body:   t(isPast ? 'past_warning_body'  : 'future_warning_body'),
    cancel: t('warning_cancel'),
    ok:     t('warning_ok'),
  });
  if (ok) { state.warnedDates.add(key); return true; }
  return false;
}

// ─── EXPORT / IMPORT ─────────────────────────────────────────
async function exportJson() {
  const log   = await DB.getAllLog(false);
  const daily = (await DB.getValuesForDate(new Date()));
  const data  = { exported: new Date().toISOString(), log };
  const blob  = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  downloadBlob(blob, `tracker-export-${DB.dateKey(new Date())}.json`);
}

async function exportCsv() {
  const log  = await DB.getAllLog(false);
  const rows = [['timestamp','type','button_id','delta','text_value']];
  log.forEach(e => rows.push([e.timestamp, e.type, e.button_id||'', e.delta??'', e.text_value||'']));
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv], {type:'text/csv'}), `tracker-export-${DB.dateKey(new Date())}.csv`);
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJson() {
  const file = await pickFile('.json');
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const entries = data.log || data;
    let imported = 0, skipped = 0;
    const db = await DB.openDb ? null : null; // direct via addLog
    for (const e of (Array.isArray(entries) ? entries : [])) {
      if (!e.timestamp || !e.type) { skipped++; continue; }
      try {
        await DB.addLog({ type:e.type, buttonId:e.button_id, delta:e.delta,
          textValue:e.text_value, timestamp:e.timestamp });
        imported++;
      } catch { skipped++; }
    }
    showToast(t('import_success', { imported, skipped }));
  } catch(err) {
    showToast(t('import_error', { error: err.message }));
  }
}

async function importCsv() {
  const file = await pickFile('.csv');
  if (!file) return;
  try {
    const text   = await file.text();
    const lines  = text.trim().split('\n').slice(1);
    let imported = 0, skipped = 0;
    for (const line of lines) {
      const cols = line.split(',').map(c => c.replace(/^"|"$/g,'').replace(/""/g,'"'));
      const [timestamp, type, button_id, delta, text_value] = cols;
      if (!timestamp || !type) { skipped++; continue; }
      try {
        await DB.addLog({ type, buttonId:button_id||null,
          delta: delta?parseInt(delta):null, textValue:text_value||null, timestamp });
        imported++;
      } catch { skipped++; }
    }
    showToast(t('import_success', { imported, skipped }));
  } catch(err) {
    showToast(t('import_error', { error: err.message }));
  }
}

function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// ─── EVENT BINDING ───────────────────────────────────────────
function bindEvents() {
  // Navigation
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', async () => {
      const target = el.dataset.nav;
      if (target === 'home') {
        state.selectedDate = new Date();
        await loadHomeData();
      }
      state.screen = target;
      await render();
    });
  });

  // Counter buttons
  document.querySelectorAll('[data-action="plus"],[data-action="minus"]').forEach(el => {
    el.addEventListener('click', async () => {
      const allowed = await checkDateWarning(state.selectedDate);
      if (!allowed) return;
      const id    = el.dataset.id;
      const delta = el.dataset.action === 'plus' ? 1 : -1;
      const btn   = state.buttons.find(b => b.id === id);
      if (!btn) return;
      const newVal = await DB.changeValue(id, state.selectedDate, delta);
      await DB.addLog({ type:'counter', buttonId:id, delta, timestamp:state.selectedDate });
      state.values[id] = newVal;
      await render();
    });
  });

  // Text buttons
  document.querySelectorAll('.text-btn').forEach(el => {
    el.addEventListener('click', async () => {
      const allowed = await checkDateWarning(state.selectedDate);
      if (!allowed) return;
      const id  = el.dataset.id;
      const btn = state.buttons.find(b => b.id === id);
      if (!btn) return;
      const result = await showTextDialog(btn, state.textValues[id]);
      if (result === null) return;
      await DB.saveTextValue(id, state.selectedDate, result, state.selectedDate);
      state.textValues[id] = result;
      await render();
    });
  });

  // Date navigation
  document.querySelector('[data-action="nav-prev"]')?.addEventListener('click', () => {
    state.selectedDate = new Date(state.selectedDate.getTime() - 86400000);
    state.screen = 'home';
    loadHomeData().then(async () => await render());
  });
  document.querySelector('[data-action="nav-next"]')?.addEventListener('click', () => {
    state.selectedDate = new Date(state.selectedDate.getTime() + 86400000);
    state.screen = 'home';
    loadHomeData().then(async () => await render());
  });

  // Reset day
  document.getElementById('reset-day-btn')?.addEventListener('click', async () => {
    const hasValues = Object.values(state.values).some(v=>v>0) ||
      Object.values(state.textValues).some(v=>v);
    if (!hasValues) return;
    const ok = await showDialog({
      title: t('reset_day_title'), body: t('reset_day_body'),
      cancel: t('warning_cancel'), ok: t('reset_day_ok'), destructive: true });
    if (!ok) return;
    const counterIds = state.buttons.filter(b=>b.type==='counter').map(b=>b.id);
    const textIds    = state.buttons.filter(b=>b.type==='text').map(b=>b.id);
    await DB.resetDayToZero({ date:state.selectedDate, counterIds, textIds, currentValues:state.values });
    counterIds.forEach(id => state.values[id] = 0);
    textIds.forEach(id => state.textValues[id] = '');
    await render();
  });

  // Lang select (home)
  document.getElementById('lang-select')?.addEventListener('change', async e => {
    state.lang = e.target.value;
    LS.set('lang', state.lang);
    applyTranslations();
    await render();
  });

  // History period
  document.querySelectorAll('[data-hist-period]').forEach(el => {
    el.addEventListener('click', async () => {
      state.historyPeriod = el.dataset.histPeriod;
      await render();
    });
  });
  document.getElementById('range-btn')?.addEventListener('click', async () => {
    state.historyPeriod = 'range';
    if (!state.historyRangeFrom) {
      const from = new Date(); from.setDate(from.getDate()-7);
      state.historyRangeFrom = DB.dateKey(from);
      state.historyRangeTo   = DB.dateKey(new Date());
    }
    await render();
  });
  document.getElementById('range-apply')?.addEventListener('click', async () => {
    state.historyRangeFrom = document.getElementById('range-from')?.value;
    state.historyRangeTo   = document.getElementById('range-to')?.value;
    await render();
  });

  // Report period
  document.querySelectorAll('[data-rep-period]').forEach(el => {
    el.addEventListener('click', async () => {
      state.reportPeriod = el.dataset.repPeriod;
      await render();
    });
  });
  document.getElementById('rep-range-btn')?.addEventListener('click', async () => {
    state.reportPeriod = 'range';
    if (!state.reportRangeFrom) {
      const from = new Date(); from.setDate(from.getDate()-7);
      state.reportRangeFrom = DB.dateKey(from);
      state.reportRangeTo   = DB.dateKey(new Date());
    }
    await render();
  });
  document.getElementById('rep-range-apply')?.addEventListener('click', async () => {
    state.reportRangeFrom = document.getElementById('rep-range-from')?.value;
    state.reportRangeTo   = document.getElementById('rep-range-to')?.value;
    await render();
  });

  // Settings
  document.getElementById('toggle-labels')?.addEventListener('change', async e => {
    state.showLabels = e.target.checked;
    saveSettings();
    await render();
  });
  document.querySelectorAll('[data-seg]').forEach(el => {
    el.addEventListener('click', async () => {
      const type = el.dataset.seg;
      const val  = el.dataset.val;
      if (type === 'size')     { state.size = val; }
      if (type === 'contrast') { state.contrast = val; }
      saveSettings();
      await render();
    });
  });
  document.getElementById('lang-select-settings')?.addEventListener('change', async e => {
    state.lang = e.target.value;
    LS.set('lang', state.lang);
    applyTranslations();
    await render();
  });
  document.getElementById('export-json')?.addEventListener('click', exportJson);
  document.getElementById('export-csv')?.addEventListener('click',  exportCsv);
  document.getElementById('import-json')?.addEventListener('click', importJson);
  document.getElementById('import-csv')?.addEventListener('click',  importCsv);
  document.getElementById('reset-default')?.addEventListener('click', async () => {
    const ok = await showDialog({
      title: t('reset_confirm_title'), body: t('reset_confirm_body'),
      cancel: t('reset_confirm_cancel'), ok: t('reset_confirm_ok'), destructive: true });
    if (!ok) return;
    localStorage.clear();
    loadSettings();
    await render();
  });
}

// ─── START ───────────────────────────────────────────────────
init();
