import { getWeekStart, weekDates, todayKey, dateKey } from './date-utils.js';

let toastTimer = null;
export function showToast(message, options) {
  const celebratory = options && options.celebratory;
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);color:#fff;' +
      'padding:10px 16px;border-radius:10px;font-size:13px;z-index:200;opacity:0;transition:opacity 0.2s ease, background 0.15s ease;max-width:320px;text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.background = celebratory ? 'var(--purple-mid)' : '#2C2C2A';
  el.style.fontWeight = celebratory ? '600' : 'normal';
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      el.style.opacity = '0';
    },
    celebratory ? 3600 : 2600
  );
}

export function ringSvg(pct, midColor, fillColor) {
  const r = 26, c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(pct, 1));
  return `<svg width="64" height="64" viewBox="0 0 64 64" style="transform: rotate(-90deg);">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${fillColor}" stroke-width="6"></circle>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${midColor}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" style="transition: stroke-dashoffset 0.35s ease;"></circle>
  </svg>`;
}

export function rampVars(ramp) {
  return {
    fill: `var(--${ramp}-fill)`,
    mid: `var(--${ramp}-mid)`,
    text: `var(--${ramp}-text)`,
  };
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function miniWeekStripHtml(habit, c) {
  const weekStart = getWeekStart(new Date());
  const dates = weekDates(weekStart);
  const todayStr = todayKey();
  let html = '<div class="mini-week-strip">';
  dates.forEach((d) => {
    const key = dateKey(d);
    const done = !!(habit.checkins && habit.checkins[key]);
    const isFuture = key > todayStr;
    const style = done ? `background:${c.mid};border-color:${c.mid};` : isFuture ? 'opacity:0.35;' : '';
    html += `<div class="mini-week-dot" style="${style}"></div>`;
  });
  html += '</div>';
  return html;
}
