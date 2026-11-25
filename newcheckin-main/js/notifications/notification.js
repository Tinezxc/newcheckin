/* CMDI notifications: own-user rows only; RLS enforces ownership. */
(() => {
  'use strict';
  const allowed = new Set(['staff-dashboard.html','staff-guests.html','staff-rooms.html','staff-checkin.html','staff-requests.html','staff-reports.html','staff-settings.html','staff-qr-scanner.html']);
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const button = $('notifBtn'), menu = $('notifMenu'), list = menu?.querySelector('.notif-menu-list');
  const badge = button?.querySelector('.icon-badge'), markAll = menu?.querySelector('.link-muted');
  if (!button || !menu || !list) return;
  let db, userId, channel, timer, rows = [], loading = false, queued = false, initialized = false;
  function safeHref(value) { const href = String(value || '').trim(); return allowed.has(href) ? href : null; }
  function ago(value) {
    const ms = Date.now() - new Date(value).getTime(); if (!Number.isFinite(ms)) return '';
    const m = Math.max(0, Math.floor(ms / 60000)); if (m < 1) return 'Just now'; if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`; return `${Math.floor(h / 24)} d ago`;
  }
  function render() {
    const unread = rows.filter(r => !r.is_read).length;
    if (badge) { badge.textContent = unread > 9 ? '9+' : String(unread); badge.hidden = unread === 0; }
    button.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications, none unread');
    if (markAll) markAll.disabled = unread === 0;
    if (!rows.length) { list.innerHTML = '<li class="notif-empty">No notifications yet</li>'; return; }
    list.innerHTML = rows.map(r => {
      const href = safeHref(r.href);
      return `<li class="${r.is_read ? '' : 'unread'}" data-notification-id="${esc(r.id)}" ${href ? `data-href="${href}"` : ''} tabindex="0" role="${href ? 'link' : 'button'}"><div class="notif-content"><p><strong>${esc(r.title || 'Notification')}</strong></p><p>${esc(r.message || '')}</p><span>${esc(ago(r.created_at))}</span></div></li>`;
    }).join('');
  }
  async function load(quiet = false) {
    if (!db || !userId) return;
    if (loading) { queued = true; return; }
    loading = true;
    try {
      const { data, error } = await db.from('notifications').select('id,user_id,title,message,is_read,created_at,event_type,href').eq('user_id', userId).order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      rows = Array.isArray(data) ? data : []; render();
    } catch (error) {
      console.error('[CMDI notifications]', error);
      if (!quiet) list.innerHTML = '<li class="notif-empty">Notifications could not be loaded.</li>';
    } finally {
      loading = false;
      if (queued) { queued = false; queueMicrotask(() => load(true)); }
    }
  }
  async function markRead(id) {
    const { error } = await db.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', userId).eq('is_read', false);
    if (error) { console.error('[CMDI mark notification read]', error); return false; }
    rows = rows.map(row => String(row.id) === String(id) ? { ...row, is_read: true } : row); render(); return true;
  }
  async function activate(row) {
    const id = row?.dataset.notificationId; if (!id) return;
    const href = safeHref(row.dataset.href);
    if (await markRead(id) && href) window.location.assign(href);
  }
  async function init() {
    if (initialized || !window.supabaseClient || !window.RBAC?.ready) return;
    await window.RBAC.ready;
    const role = window.RBAC.realRole?.();
    if (!['manager', 'front-desk', 'housekeeping', 'maintenance'].includes(role)) return;
    db = window.supabaseClient;
    const { data, error } = await db.auth.getUser(); if (error) throw error;
    userId = data.user?.id; if (!userId) return;
    initialized = true;
    channel = db.channel(`cmdi-notifications-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => load(true)).subscribe();
    await load();
    button.addEventListener('click', event => { event.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) load(true); });
    markAll?.addEventListener('click', async event => {
      event.stopPropagation(); markAll.disabled = true;
      const { error: updateError } = await db.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
      if (updateError) { console.error('[CMDI mark all read]', updateError); markAll.disabled = false; return; }
      rows = rows.map(row => ({ ...row, is_read: true })); render();
    });
    list.addEventListener('click', event => { const row = event.target.closest('[data-notification-id]'); if (row) activate(row); });
    list.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { const row = event.target.closest('[data-notification-id]'); if (row) { event.preventDefault(); activate(row); } } });
    document.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('.topbar-icon-wrap')) menu.hidden = true; });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') menu.hidden = true; });
    timer = window.setInterval(() => load(true), 60000);
    window.addEventListener('beforeunload', () => { if (timer) clearInterval(timer); if (channel) db.removeChannel(channel); }, { once: true });
  }
  window.addEventListener('load', () => init().catch(error => console.error('[CMDI notifications init]', error)), { once: true });
})();
