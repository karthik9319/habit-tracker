(function () {
  'use strict';

  function todayKey() {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }

  async function init() {
    const data = await window.api.loadData();
    const key = todayKey();
    const active = (data.habits || []).filter((h) => !h.archived);
    const undone = active.filter((h) => !(h.checkins && h.checkins[key]));
    const list = document.getElementById('list');

    if (active.length === 0) {
      list.innerHTML = '<p class="empty-msg">No habits yet — open the app to add one.</p>';
      return;
    }

    if (undone.length === 0) {
      list.innerHTML = '<p class="empty-msg">All done for today 🎉</p>';
      return;
    }

    undone.forEach((h) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick-habit-btn';
      btn.textContent = `${h.icon}  ${h.name}`;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = `✓  ${h.name}`;
        await window.api.toggleHabit(h.id);
        setTimeout(() => window.close(), 400);
      });
      list.appendChild(btn);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
  });

  init();
})();
