/* CMDI Front Desk — Client room transfer approvals */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const db = () => window.supabaseClient || null;
  const state = { requests: [], loading: false };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  };

  function message(text, type='info') {
    const el = $('#transferMessage');
    el.hidden = !text;
    el.textContent = text || '';
    el.className = `transfer-message ${type}`;
  }

  function render() {
    const list = $('#transferRequestList');
    const rows = state.requests;
    $('#transferQueueCount').textContent = `${rows.length} pending`;
    if (!rows.length) {
      list.innerHTML = '<div class="transfer-empty"><strong>No pending room transfer requests</strong><p>New requests from checked-in trainees will appear here.</p></div>';
      return;
    }
    list.innerHTML = rows.map(item => `
      <article class="transfer-request-card" data-transfer-card="${esc(item.id)}">
        <div class="transfer-request-main">
          <div class="transfer-client"><span class="transfer-client-avatar">${esc(String(item.client_name || 'T').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase())}</span><div><strong>${esc(item.client_name)}</strong><small>${esc(item.guest_id || 'CMDI Client')} · ${esc(item.gender || 'Gender not set')}</small></div></div>
          <div class="transfer-route"><div><small>FROM</small><strong>Room ${esc(item.from_room)}</strong></div><span aria-hidden="true">→</span><div><small>REQUESTED ROOM</small><strong>Room ${esc(item.to_room)}</strong></div></div>
          <div class="transfer-request-meta"><span>Submitted ${esc(fmt(item.requested_at))}</span><span class="transfer-stay-pill">${item.has_active_stay ? 'Active individual stay' : 'Active stay not found'}</span></div>
          ${item.reason ? `<p class="transfer-reason"><strong>Client reason:</strong> ${esc(item.reason)}</p>` : '<p class="transfer-reason muted">No reason supplied.</p>'}
        </div>
        <div class="transfer-actions"><button type="button" class="transfer-approve" data-transfer-decision="approve" data-transfer-id="${esc(item.id)}">Approve transfer</button><button type="button" class="transfer-reject" data-transfer-decision="reject" data-transfer-id="${esc(item.id)}">Reject</button></div>
      </article>`).join('');
  }

  async function load({quiet=false}={}) {
    if (state.loading) return;
    const client = db();
    if (!client) { message('Supabase client is unavailable. Check js/supabase-client.js.', 'error'); return; }
    state.loading = true;
    if (!quiet) $('#transferRequestList').innerHTML = '<div class="transfer-empty">Loading room transfer requests…</div>';
    $('#refreshTransfers').disabled = true;
    try {
      const {data,error} = await client.rpc('get_staff_room_transfer_queue');
      if (error) throw error;
      if (!data || data.ok !== true) throw new Error('The transfer queue returned no data.');
      state.requests = Array.isArray(data.requests) ? data.requests : [];
      render();
      if (!quiet) message('Room transfer queue refreshed.', 'success');
    } catch (error) {
      console.error('[CMDI Room Transfers] Queue load failed:', error);
      message(error.message || 'Could not load room transfer requests.', 'error');
      if (!quiet) $('#transferRequestList').innerHTML = `<div class="transfer-empty error">${esc(error.message || 'Could not load requests.')}</div>`;
    } finally {
      state.loading = false;
      $('#refreshTransfers').disabled = false;
    }
  }

  async function decide(requestId, decision) {
    const item = state.requests.find(row => String(row.id) === String(requestId));
    if (!item) return;
    let staffNote = '';
    if (decision === 'approve') {
      if (!window.confirm(`Approve ${item.client_name}'s transfer from Room ${item.from_room} to Room ${item.to_room}? The system will recheck availability and move the active stay only if it still qualifies.`)) return;
    } else {
      staffNote = window.prompt('Enter a reason for rejecting this transfer (at least 5 characters):', '') || '';
      if (staffNote.trim().length < 5) { message('A rejection reason of at least 5 characters is required.', 'error'); return; }
    }

    const card = document.querySelector(`[data-transfer-card="${CSS.escape(requestId)}"]`);
    card?.classList.add('is-processing');
    card?.querySelectorAll('button').forEach(button => button.disabled = true);
    try {
      const {data,error} = await db().rpc('review_client_room_transfer', {
        p_request_id: requestId,
        p_decision: decision,
        p_staff_note: staffNote.trim() || null
      });
      if (error) throw error;
      if (!data || data.ok !== true) throw new Error('The database did not confirm the transfer decision.');
      message(decision === 'approve'
        ? `Transfer approved. The trainee was moved from Room ${data.from_room} to Room ${data.to_room}.`
        : 'Transfer request rejected. The trainee remains in the original room.', 'success');
      await load({quiet:true});
    } catch (error) {
      console.error('[CMDI Room Transfers] Decision failed:', error);
      message(error.message || 'Could not save the transfer decision. Refresh and try again.', 'error');
      card?.classList.remove('is-processing');
      card?.querySelectorAll('button').forEach(button => button.disabled = false);
    }
  }

  function bindMenu() {
    const menu = $('#menuToggle');
    const sidebar = $('#sidebar');
    const overlay = $('#sidebarOverlay');
    if (!menu || !sidebar || !overlay) return;
    const setOpen = value => {
      sidebar.classList.toggle('open', value);
      overlay.classList.toggle('open', value);
      menu.setAttribute('aria-expanded', String(value));
    };
    menu.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
    overlay.addEventListener('click', () => setOpen(false));
  }

  async function init() {
    bindMenu();
    if (window.RBAC?.ready) await window.RBAC.ready;
    if (!window.RBAC?.realRole?.() || window.RBAC.realRole() !== 'front-desk' || !window.RBAC.can('room-transfers.review')) {
      window.RBAC?.guardPage?.('transfers');
      return;
    }
    if (!window.RBAC.init({active:'transfers'})) return;
    $('#roleBreadcrumb').textContent = 'Front desk';
    $('#refreshTransfers').addEventListener('click', () => load());
    $('#transferRequestList').addEventListener('click', event => {
      const button = event.target.closest('[data-transfer-decision]');
      if (!button) return;
      decide(button.dataset.transferId, button.dataset.transferDecision);
    });
    await load();
    window.setInterval(() => load({quiet:true}), 45000);
  }

  init().catch(error => {
    console.error('[CMDI Room Transfers] Initialization failed:', error);
    message(error.message || 'Could not initialize room transfer review.', 'error');
  });
})();
