/* ==========================================================
   CMDI STAFF NOTIFICATIONS — PHASE 5
   - Reads only the signed-in user's notification rows.
   - DB triggers create role-targeted notifications.
   - Supports unread badge, mark read, mark all read, safe related-page links,
     Supabase Realtime, and a 60-second fallback refresh.
   ========================================================== */
(() => {
    'use strict';

    const db = window.supabaseClient;
    const button = document.getElementById('notifBtn');
    const menu = document.getElementById('notifMenu');
    const list = menu?.querySelector('.notif-menu-list');
    const badge = button?.querySelector('.icon-badge');
    const markAllButton = menu?.querySelector('.notif-menu-header .link-muted');

    if (!db || !button || !menu || !list) return;

    const state = {
        userId: null,
        channel: null,
        notifications: [],
        loading: false,
        pollTimer: null,
        initialized: false
    };

    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);

    const ALLOWED_LINKS = new Set([
        'staff-dashboard.html',
        'staff-requests.html',
        'staff-checkin.html',
        'staff-reports.html'
    ]);

    function safeHref(value) {
        const href = String(value || '').trim();
        return ALLOWED_LINKS.has(href) ? href : null;
    }

    function relativeTime(value) {
        const timestamp = new Date(value).getTime();
        if (!Number.isFinite(timestamp)) return '';
        const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} hr ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days} d ago`;
        return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function render() {
        const unread = state.notifications.filter(item => !item.is_read).length;
        if (badge) {
            badge.textContent = unread > 9 ? '9+' : String(unread);
            badge.hidden = unread === 0;
        }
        button.setAttribute('aria-label', unread
            ? `Notifications, ${unread} unread`
            : 'Notifications, none unread');
        if (markAllButton) markAllButton.disabled = unread === 0;

        if (!state.notifications.length) {
            list.innerHTML = '<li class="notif-empty" style="justify-content:center;padding:28px 16px;color:var(--text-3);">No notifications yet</li>';
            return;
        }

        list.innerHTML = state.notifications.map(item => {
            const href = safeHref(item.href);
            const title = esc(item.title || 'Notification');
            const message = esc(item.message || '');
            const time = esc(relativeTime(item.created_at));
            const eventType = esc(String(item.event_type || '').replace(/[._]/g, ' '));
            return `
                <li class="${item.is_read ? '' : 'unread'}"
                    data-notification-id="${esc(item.id)}"
                    ${href ? `data-href="${href}"` : ''}
                    tabindex="0"
                    role="${href ? 'link' : 'button'}"
                    aria-label="${title}. ${message}${href ? '. Open related page' : '. Mark as read'}">
                    <span class="notif-dot ${item.is_read ? 'empty' : ''}"></span>
                    <div class="notif-content">
                        <p>${title}</p>
                        <p>${message}</p>
                        <span>${time}${eventType ? ` · ${eventType}` : ''}</span>
                    </div>
                </li>`;
        }).join('');
    }

    async function loadNotifications({ quiet = false } = {}) {
        if (!state.userId || state.loading) return;
        state.loading = true;
        try {
            const { data, error } = await db
                .from('notifications')
                .select('id,user_id,title,message,is_read,created_at,event_type,entity_type,entity_id,href')
                .eq('user_id', state.userId)
                .order('created_at', { ascending: false })
                .limit(30);
            if (error) throw error;
            state.notifications = Array.isArray(data) ? data : [];
            render();
        } catch (error) {
            console.error('[CMDI Notifications] Could not load notifications:', error);
            if (!quiet) {
                list.innerHTML = '<li class="notif-empty" style="justify-content:center;padding:28px 16px;color:var(--text-3);">Notifications could not be loaded</li>';
            }
        } finally {
            state.loading = false;
        }
    }

    async function markRead(id) {
        if (!state.userId || !id) return false;
        const { error } = await db
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id)
            .eq('user_id', state.userId)
            .eq('is_read', false);
        if (error) {
            console.error('[CMDI Notifications] Could not mark notification as read:', error);
            return false;
        }
        const item = state.notifications.find(row => String(row.id) === String(id));
        if (item) item.is_read = true;
        render();
        return true;
    }

    async function markAllRead() {
        if (!state.userId) return;
        if (markAllButton) markAllButton.disabled = true;
        const { error } = await db
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', state.userId)
            .eq('is_read', false);
        if (error) {
            console.error('[CMDI Notifications] Could not mark all as read:', error);
            if (markAllButton) markAllButton.disabled = false;
            return;
        }
        state.notifications = state.notifications.map(item => ({ ...item, is_read: true }));
        render();
    }

    async function handleNotificationActivation(row) {
        const id = row?.dataset.notificationId;
        if (!id) return;
        const href = safeHref(row.dataset.href);
        const marked = await markRead(id);
        if (href && marked) window.location.assign(href);
    }

    async function init() {
        if (state.initialized) return;
        if (window.RBAC?.ready) await window.RBAC.ready;
        if (window.RBAC?.realRole && !window.RBAC.realRole()) return;

        const { data: sessionData, error: sessionError } = await db.auth.getSession();
        if (sessionError) throw sessionError;
        const user = sessionData?.session?.user;
        if (!user?.id) return;

        state.userId = user.id;
        state.initialized = true;
        await loadNotifications();

        state.channel = db.channel(`cmdi-staff-notifications-${state.userId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${state.userId}`
            }, () => loadNotifications({ quiet: true }))
            .subscribe(status => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn('[CMDI Notifications] Realtime unavailable; fallback refresh remains active.');
                }
            });

        button.addEventListener('click', event => {
            event.stopPropagation();
            menu.hidden = !menu.hidden;
            if (!menu.hidden) loadNotifications({ quiet: true });
        });

        markAllButton?.addEventListener('click', event => {
            event.stopPropagation();
            markAllRead();
        });

        list.addEventListener('click', event => {
            const row = event.target.closest('[data-notification-id]');
            if (row) handleNotificationActivation(row);
        });

        list.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const row = event.target.closest('[data-notification-id]');
            if (!row) return;
            event.preventDefault();
            handleNotificationActivation(row);
        });

        document.addEventListener('click', event => {
            if (!menu.hidden && !event.target.closest('.topbar-icon-wrap')) menu.hidden = true;
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') menu.hidden = true;
        });

        state.pollTimer = window.setInterval(() => loadNotifications({ quiet: true }), 60000);
        window.addEventListener('beforeunload', () => {
            if (state.pollTimer) clearInterval(state.pollTimer);
            if (state.channel) db.removeChannel(state.channel);
        }, { once: true });
    }

    init().catch(error => console.error('[CMDI Notifications] Initialization failed:', error));
})();
