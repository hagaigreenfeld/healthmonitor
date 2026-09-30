// Client-side PDF report. Each block (header, summary, chart, rows…) is rendered
// as HTML (so Hebrew/RTL and Chart.js canvases just work), rasterised with
// html2canvas and laid out on A4 pages with jsPDF without splitting a block.
const LIBS = {
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
};
const loaded = {};
function loadScript(src) {
  return loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('load failed: ' + src));
    document.head.appendChild(s);
  });
}

const DAY_MS = 86400000;
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toDate = ts => (ts?.toDate ? ts.toDate() : new Date(ts));
const fmtDate = d => d.toLocaleDateString('he-IL');
const fmtDateTime = d => `${fmtDate(d)} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

const STYLE = `
  .rp { width:794px; padding:18px 28px; background:#fff; color:#2d1b69; direction:rtl; text-align:right;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Arial Hebrew',Arial,sans-serif; }
  .rp h1 { font-size:28px; margin:0 0 4px; color:#7c3aed; }
  .rp h2 { font-size:20px; margin:0 0 10px; color:#7c3aed; border-bottom:2px solid #e9d5ff; padding-bottom:6px; }
  .rp h3 { font-size:17px; margin:0 0 8px; }
  .rp .muted { color:#6b7280; font-size:13px; }
  .rp .tiles { display:flex; gap:10px; flex-wrap:wrap; }
  .rp .tile { flex:1; min-width:120px; background:#faf5ff; border-radius:12px; padding:10px; text-align:center; }
  .rp .tile b { display:block; font-size:22px; color:#7c3aed; }
  .rp .tile span { font-size:12px; color:#6b7280; }
  .rp .row { display:flex; gap:10px; padding:8px 0; border-bottom:1px solid #f3e8ff; font-size:13px; align-items:flex-start; }
  .rp .row .when { width:120px; flex:none; color:#6b7280; }
  .rp .row .what { flex:1; }
  .rp .chip { display:inline-block; background:#f3e8ff; border-radius:8px; padding:1px 7px; margin:2px 0 0 4px; font-size:12px; }
  .rp .sev { width:30px; flex:none; text-align:center; font-weight:800; color:#7c3aed; }
  .rp img.chart { width:100%; display:block; }
  .rp .charts { display:flex; gap:10px; }
  .rp .charts > div { flex:1; }
  .rp .visit { white-space:pre-wrap; font-size:13px; margin-top:4px; }
`;

function typeStats(entries, type) {
  const tracksSeverity = type.trackSeverity !== false;
  const sev = tracksSeverity ? entries.filter(e => e.severity != null).map(e => e.severity) : [];
  const dur = entries.filter(e => e.durationHours != null).map(e => e.durationHours);
  const byDay = Array(7).fill(0);
  entries.forEach(e => { byDay[toDate(e.startAt).getDay()]++; });
  const top = byDay.some(Boolean) ? WEEKDAYS[byDay.indexOf(Math.max(...byDay))] : null;
  return {
    count: entries.length,
    avgSeverity: avg(sev), maxSeverity: sev.length ? Math.max(...sev) : null,
    avgDuration: avg(dur), topDay: top, byDay, tracksSeverity,
    last: entries.length ? toDate(entries[0].startAt) : null
  };
}

const tile = (val, lbl) => `<div class="tile"><b>${esc(val)}</b><span>${esc(lbl)}</span></div>`;

function chartImage(config, w = 700, h = 260) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const chart = new window.Chart(canvas.getContext('2d'), {
    ...config,
    options: { responsive: false, animation: false, plugins: { legend: { display: false } }, ...config.options }
  });
  const url = canvas.toDataURL('image/png');
  chart.destroy();
  return url;
}

function weeklyCounts(entries, fromMs, toMs) {
  const weeks = new Map();
  const start = new Date(fromMs); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay());
  for (let t = start.getTime(); t <= toMs; t += 7 * DAY_MS) weeks.set(t, 0);
  entries.forEach(e => {
    const d = toDate(e.startAt); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay());
    if (weeks.has(d.getTime())) weeks.set(d.getTime(), weeks.get(d.getTime()) + 1);
  });
  return [...weeks.entries()].slice(-26);
}

function entryRow(e, type) {
  const d = toDate(e.startAt);
  const status = e.status === 'open' ? '🟠 פתוח' : e.status === 'instant' ? '⚡ חד פעמי'
    : e.durationHours != null ? `⏱ ${e.durationHours.toFixed(1)} שעות` : '✅ סגור';
  const fields = (type?.fields || [])
    .filter(f => e.customFieldValues?.[f.id] !== undefined && String(e.customFieldValues[f.id]).trim() !== '')
    .map(f => `<span class="chip">${esc(f.label)}: ${esc(e.customFieldValues[f.id])}${f.unit ? ' ' + esc(f.unit) : ''}</span>`).join('');
  const note = e.comments?.[0]?.text;
  return `<div class="row">
    <div class="when">${fmtDateTime(d)}</div>
    <div class="what"><b>${type?.emoji || '📌'} ${esc(type?.name || '')}</b> · ${status}<br>${fields}${note ? `<div class="muted">${esc(note)}</div>` : ''}</div>
    <div class="sev">${e.severity ?? ''}</div>
  </div>`;
}

// options: { days: number|null, typeIds: string[], summary, charts, history, visits, todos }
export async function generateReport({ ownerName, issueTypes, entries, visits = [], todos = [], options }) {
  await Promise.all([loadScript(LIBS.jspdf), loadScript(LIBS.html2canvas)]);
  const { jsPDF } = window.jspdf;

  const now = Date.now();
  const fromMs = options.days ? now - options.days * DAY_MS : Math.min(now, ...entries.map(e => toDate(e.startAt).getTime()));
  const types = issueTypes.filter(t => options.typeIds.includes(t.id));
  const inRange = entries.filter(e => options.typeIds.includes(e.issueTypeId) && toDate(e.startAt).getTime() >= fromMs);
  const rangeLabel = options.days ? `${options.days} ימים אחרונים` : 'כל התקופה';

  const blocks = [];
  blocks.push(`<h1>🩺 דוח מעקב בריאות</h1>
    <div class="muted">${ownerName ? `עבור: <b>${esc(ownerName)}</b> · ` : ''}${rangeLabel} · הופק ב-${fmtDate(new Date())}</div>
    <div class="muted">סוגים: ${types.map(t => `${t.emoji || ''} ${esc(t.name)}`).join(', ') || '–'}</div>`);

  const perType = types.map(t => {
    const list = inRange.filter(e => e.issueTypeId === t.id);
    return { type: t, list, st: typeStats(list, t) };
  });

  if (options.summary) {
    const allSev = inRange.filter(e => e.severity != null).map(e => e.severity);
    blocks.push(`<h2>📌 סיכום</h2><div class="tiles">
      ${tile(inRange.length, 'אירועים')}
      ${tile(allSev.length ? avg(allSev).toFixed(1) : '–', 'עוצמה ממוצעת')}
      ${tile(inRange.filter(e => e.status === 'open').length, 'פתוחים כעת')}
      ${tile(inRange.length ? (inRange.length / Math.max(1, (now - fromMs) / (7 * DAY_MS))).toFixed(1) : '–', 'אירועים בשבוע')}
    </div>`);
    perType.forEach(({ type, st }) => {
      blocks.push(`<h3>${type.emoji || '📌'} ${esc(type.name)}</h3><div class="tiles">
        ${tile(st.count, 'אירועים')}
        ${st.tracksSeverity ? tile(st.avgSeverity != null ? st.avgSeverity.toFixed(1) : '–', 'עוצמה ממוצעת') : ''}
        ${st.tracksSeverity ? tile(st.maxSeverity ?? '–', 'עוצמה מקסימלית') : ''}
        ${st.avgDuration != null ? tile(st.avgDuration.toFixed(1) + ' ש׳', 'משך ממוצע') : ''}
        ${tile(st.topDay || '–', 'היום השכיח')}
        ${tile(st.last ? fmtDate(st.last) : '–', 'אחרון')}
      </div>`);
    });
  }

  if (options.charts) {
    await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js').catch(() => {});
    if (window.Chart) {
      perType.filter(p => p.list.length).forEach(({ type, list, st }) => {
        const color = type.color || '#a855f7';
        const weekly = weeklyCounts(list, fromMs, now);
        const weeklyImg = chartImage({
          type: 'bar',
          data: {
            labels: weekly.map(([t]) => new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })),
            datasets: [{ data: weekly.map(([, n]) => n), backgroundColor: color }]
          },
          options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        }, 400, 240);
        const dayImg = chartImage({
          type: 'bar',
          data: { labels: WEEKDAYS, datasets: [{ data: st.byDay, backgroundColor: color }] },
          options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        }, 400, 240);
        let html = `<h2>${type.emoji || '📌'} ${esc(type.name)}: גרפים</h2>
          <div class="charts">
            <div><div class="muted">אירועים לפי שבוע</div><img class="chart" src="${weeklyImg}"></div>
            <div><div class="muted">אירועים לפי יום בשבוע</div><img class="chart" src="${dayImg}"></div>
          </div>`;
        const withSev = [...list].filter(e => e.severity != null).reverse();
        if (st.tracksSeverity && withSev.length > 1) {
          const sevImg = chartImage({
            type: 'line',
            data: {
              labels: withSev.map(e => toDate(e.startAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })),
              datasets: [{ data: withSev.map(e => e.severity), borderColor: color, backgroundColor: color, tension: 0.25, pointRadius: 3 }]
            },
            options: { scales: { y: { min: 0, max: 10 } } }
          }, 820, 240);
          html += `<div class="muted" style="margin-top:10px">עוצמה לאורך זמן</div><img class="chart" src="${sevImg}">`;
        }
        blocks.push(html);
      });
    }
  }

  if (options.history) {
    blocks.push(`<h2>📋 היסטוריית אירועים (${inRange.length})</h2>`);
    const typeById = Object.fromEntries(issueTypes.map(t => [t.id, t]));
    const CHUNK = 6;
    if (!inRange.length) blocks.push(`<div class="muted">אין אירועים בתקופה שנבחרה.</div>`);
    for (let i = 0; i < inRange.length; i += CHUNK) {
      blocks.push(inRange.slice(i, i + CHUNK).map(e => entryRow(e, typeById[e.issueTypeId])).join(''));
    }
  }

  if (options.visits && visits.length) {
    blocks.push(`<h2>🏥 ביקורי רופא והוראות</h2>`);
    visits.filter(v => !options.days || new Date(v.date).getTime() >= fromMs).forEach(v => {
      blocks.push(`<div class="row"><div class="when">${fmtDate(new Date(v.date))}</div>
        <div class="what"><b>👨‍⚕️ ${esc(v.doctorName)}</b>${v.summary ? `<div class="visit">${esc(v.summary)}</div>` : ''}</div></div>`);
    });
  }

  if (options.todos && todos.length) {
    blocks.push(`<h2>✅ משימות</h2>` + todos.map(t =>
      `<div class="row"><div class="what">${t.done ? '☑' : '☐'} ${esc(t.text)}</div></div>`).join(''));
  }

  // Render blocks off-screen, then paginate.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;';
  host.innerHTML = `<style>${STYLE}</style>` + blocks.map(b => `<div class="rp">${b}</div>`).join('');
  document.body.appendChild(host);
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, H = 297, M = 6, innerW = W - 2 * M;
    let y = M;
    for (const el of host.querySelectorAll('.rp')) {
      const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false });
      const h = (canvas.height / canvas.width) * innerW;
      if (y + h > H - M && y > M) { pdf.addPage(); y = M; }
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', M, y, innerW, Math.min(h, H - 2 * M));
      y += h;
    }
    return pdf.output('blob');
  } finally {
    host.remove();
  }
}

// ── Sharing helpers ───────────────────────────────────────────
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function canShareFile(blob, filename) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  return !!(navigator.canShare && navigator.canShare({ files: [file] }));
}

// Native share sheet (WhatsApp, Mail, Drive…) with the PDF attached. Mobile browsers.
export function shareFile(blob, filename, title, text) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  return navigator.share({ files: [file], title, text });
}

// Desktop fallbacks: links can't carry an attachment, so the caller downloads the PDF first.
export const whatsappUrl = text => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const mailtoUrl = (subject, body) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
