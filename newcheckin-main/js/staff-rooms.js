document.addEventListener('DOMContentLoaded', async () => {
  const UI = window.CMDIModules;
  if (!UI) return;
  const $ = id => document.getElementById(id);
  let ctx;
  let rooms = [];
  const ROLE_STATUSES = {
    manager: ['occupied','vacant-clean','vacant-dirty','cleaning','maintenance','reserved','overdue'],
    'front-desk': ['vacant-dirty','reserved'],
    housekeeping: ['cleaning','vacant-clean','vacant-dirty'],
    maintenance: ['maintenance','vacant-dirty']
  };

  try {
    ctx = await UI.ready('rooms');
    UI.bindShell();
    await loadRooms();
  } catch (error) {
    UI.toast('error', 'Rooms unavailable', error.message);
    return;
  }

  async function loadRooms() {
    $('roomGrid').innerHTML = '<div class="loading-state">Loading room inventory…</div>';
    $('refreshRooms').disabled = true;
    try {
      const result = await UI.rpc('staff_get_rooms');
      rooms = Array.isArray(result.rooms) ? result.rooms : [];
      updateStats();
      render();
    } catch (error) {
      $('roomGrid').innerHTML = `<div class="error-state"><strong>Could not load rooms</strong>${UI.esc(error.message)}</div>`;
      $('roomRows').innerHTML = `<tr><td colspan="8" class="error-state">${UI.esc(error.message)}</td></tr>`;
      UI.toast('error', 'Room inventory unavailable', error.message);
    } finally {
      $('refreshRooms').disabled = false;
    }
  }

  function updateStats() {
    $('roomTotal').textContent = rooms.length;
    $('roomOccupied').textContent = rooms.filter(r => r.status === 'occupied').length;
    $('roomVacant').textContent = rooms.filter(r => r.status === 'vacant-clean').length;
    $('roomAttention').textContent = rooms.filter(r => ['vacant-dirty','cleaning','maintenance','overdue'].includes(r.status)).length;
    const legacyCount = rooms.filter(r => r.requires_reconciliation === true || Number(r.legacy_assigned_profiles) > 0).length;
    $('roomLegacyReview').textContent = legacyCount;
  }

  function filteredRooms() {
    const q = $('roomSearch').value.trim().toLowerCase();
    const floor = $('roomFloor').value;
    const status = $('roomStatus').value;
    return rooms.filter(r =>
      (!q || [r.room_number,r.type].some(v => String(v || '').toLowerCase().includes(q))) &&
      (floor === 'all' || String(r.floor) === floor) &&
      (status === 'all' || r.status === status)
    );
  }

  function render() {
    const list = filteredRooms();
    $('roomResultCount').textContent = `${list.length} rooms`;
    $('roomTableCount').textContent = `${list.length} records`;
    if (!list.length) {
      $('roomGrid').innerHTML = '<div class="empty-state"><strong>No rooms found</strong>There are no room records matching these filters.</div>';
      $('roomRows').innerHTML = '<tr><td colspan="8" class="empty-state">No matching rooms.</td></tr>';
      return;
    }
    $('roomGrid').innerHTML = list.map(r => {
      const cap = Number(r.capacity) || 0;
      const occ = Number(r.current_occupants) || 0;
      const pct = cap ? Math.min(100, Math.round(occ / cap * 100)) : 0;
      const needsReview = r.requires_reconciliation === true || Number(r.legacy_assigned_profiles) > 0;
      return `<article class="room-card"><div class="room-card-head"><div><div class="room-number">Room ${UI.esc(r.room_number)}</div><div class="room-meta">Floor ${UI.esc(r.floor)} · ${UI.esc(r.type || 'Standard')}</div></div><span class="status-pill ${UI.statusClass(r.status)}">${UI.esc(r.status)}</span></div><div class="room-occupancy"><div class="room-card-footer"><span class="secondary-text">Occupancy</span><strong>${occ} / ${cap}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>${needsReview ? `<div class="notice warning room-legacy-warning">${Number(r.legacy_assigned_profiles) > 0 ? `${Number(r.legacy_assigned_profiles)} legacy profile assignment(s) need reconciliation.` : 'Room status is Occupied but no active stay record exists.'} Verify current occupancy before updating this room.</div>` : ''}<div class="room-card-footer"><span class="secondary-text">${needsReview ? 'Reconciliation required' : `${Number(r.available_capacity)||0} available capacity`}</span><button class="btn btn-secondary btn-small" data-manage-room="${UI.esc(r.id)}" ${Number(r.legacy_assigned_profiles) > 0 ? 'disabled title="Reconcile legacy assigned profiles first"' : ''}>Manage</button></div></article>`;
    }).join('');
    $('roomRows').innerHTML = list.map(r => {
      const needsReview = r.requires_reconciliation === true || Number(r.legacy_assigned_profiles) > 0;
      return `<tr><td><strong>Room ${UI.esc(r.room_number)}</strong>${needsReview ? `<span class="secondary-text">${Number(r.legacy_assigned_profiles) > 0 ? `${Number(r.legacy_assigned_profiles)} legacy assignment(s) need review` : 'Occupied status has no active stay record'}</span>` : ''}</td><td>${UI.esc(r.floor)}</td><td>${UI.esc(r.type || '—')}</td><td>${UI.esc(r.capacity ?? '—')}</td><td>${Number(r.current_occupants)||0}</td><td>${Number(r.legacy_assigned_profiles) > 0 ? 'Blocked' : (needsReview ? 'Verify status' : (Number(r.available_capacity)||0))}</td><td><span class="status-pill ${UI.statusClass(r.status)}">${UI.esc(r.status)}</span></td><td><button class="btn btn-secondary btn-small" data-manage-room="${UI.esc(r.id)}" ${Number(r.legacy_assigned_profiles) > 0 ? 'disabled title="Reconcile legacy assigned profiles first"' : ''}>Update</button></td></tr>`;
    }).join('');
  }

  function openRoom(id) {
    const room = rooms.find(r => String(r.id) === String(id));
    if (!room) return;
    if (Number(room.legacy_assigned_profiles) > 0) {
      UI.toast('warning', 'Legacy room assignment needs review', 'Reconcile existing client room assignments before changing this room.');
      return;
    }
    $('statusRoomId').value = room.id;
    $('statusRoomLabel').textContent = `Room ${room.room_number} · Floor ${room.floor} · Current status: ${room.status}`;
    const statuses = ROLE_STATUSES[ctx.role] || [];
    $('nextRoomStatus').innerHTML = statuses.map(s => `<option value="${s}" ${s===room.status?'selected':''}>${s.replace(/-/g,' ')}</option>`).join('');
    $('roomStatusNote').value = '';
    UI.openModal($('roomStatusModal'));
  }

  document.body.addEventListener('click', event => {
    const btn = event.target.closest('[data-manage-room]');
    if (btn) openRoom(btn.dataset.manageRoom);
  });
  $('roomStatusForm').addEventListener('submit', async event => {
    event.preventDefault();
    const btn = $('saveRoomStatus');
    UI.setBusy(btn, true, 'Updating…');
    try {
      await UI.rpc('staff_update_room_status', {
        p_room_id: $('statusRoomId').value,
        p_status: $('nextRoomStatus').value,
        p_note: $('roomStatusNote').value.trim() || null
      });
      UI.closeModal($('roomStatusModal'));
      UI.toast('success', 'Room status updated', 'The change is saved to Supabase and recorded in the audit log.');
      await loadRooms();
    } catch (error) {
      UI.toast('error', 'Room update failed', error.message);
    } finally {
      UI.setBusy(btn, false);
    }
  });
  $('roomSearch').addEventListener('input', render);
  $('roomFloor').addEventListener('change', render);
  $('roomStatus').addEventListener('change', render);
  $('refreshRooms').addEventListener('click', loadRooms);
  document.querySelectorAll('[data-close="roomStatusModal"]').forEach(el => el.addEventListener('click', () => UI.closeModal($('roomStatusModal'))));
});
