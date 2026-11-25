/* CMDI Phase 7 shared page helpers */
(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);

  function toast(type, title, message = '') {
    let host = document.getElementById('toastContainer');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastContainer';
      host.className = 'cmdi-toast-stack';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const item = document.createElement('div');
    item.className = `cmdi-toast ${type || 'info'}`;
    const strong = document.createElement('strong');
    strong.textContent = title;
    const text = document.createElement('span');
    text.textContent = message;
    item.append(strong, text);
    host.appendChild(item);
    window.setTimeout(() => item.remove(), 4200);
  }

  async function ready(pageKey, allowedRoles = null) {
    if (!window.supabaseClient) throw new Error('Supabase client is not initialized.');
    if (!window.RBAC || !window.RBAC.ready) throw new Error('Staff access verification is unavailable.');
    await window.RBAC.ready;
    const role = window.RBAC.realRole?.() || window.RBAC.getRole?.();
    if (!role) throw new Error('Your staff role could not be verified.');
    if (allowedRoles && !allowedRoles.includes(role)) throw new Error('Your assigned role cannot access this module.');
    if (!window.RBAC.init({ active: pageKey })) throw new Error('Your assigned role is not allowed to open this page.');
    document.body.dataset.role = role;
    return { db: window.supabaseClient, role, userId: window.RBAC.userId?.() || null };
  }

  async function rpc(name, args = {}) {
    const db = window.supabaseClient;
    if (!db) throw new Error('Supabase client is not initialized.');
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(error.message || `RPC ${name} failed.`);
    if (data && data.ok === false) throw new Error(data.message || `RPC ${name} did not complete.`);
    return data;
  }

  function formatDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-PH', withTime
      ? { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function statusClass(value) {
    return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  }

  function initials(value) {
    return String(value || 'Guest').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || 'G';
  }

  function setBusy(button, busy, label = 'Saving…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = label;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
      delete button.dataset.originalText;
    }
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => modal.classList.add('open'));
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    window.setTimeout(() => {
      modal.hidden = true;
      if (!document.querySelector('.cmdi-modal.open')) document.body.classList.remove('modal-open');
    }, 180);
  }

  function exportCsv(filename, columns, rows) {
    const csv = [columns.map(c => c.label), ...rows.map(row => columns.map(c => row[c.key] ?? ''))]
      .map(row => row.map(value => {
        let text = String(value ?? '');
        if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      }).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function bindShell() {
    const toggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const close = () => {
      sidebar?.classList.remove('open');
      overlay?.classList.remove('open');
      toggle?.setAttribute('aria-expanded', 'false');
    };
    toggle?.addEventListener('click', () => {
      const isOpen = sidebar?.classList.toggle('open') || false;
      overlay?.classList.toggle('open', isOpen);
      toggle?.setAttribute('aria-expanded', String(isOpen));
    });
    overlay?.addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        close();
        document.querySelectorAll('.cmdi-modal.open').forEach(closeModal);
      }
    });
  }

  window.CMDIModules = { esc, toast, ready, rpc, formatDate, statusClass, initials, setBusy, openModal, closeModal, exportCsv, bindShell };
})();
