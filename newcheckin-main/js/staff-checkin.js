document.addEventListener('DOMContentLoaded', async () => {
  const UI = window.CMDIModules;
  if (!UI) return;
  const $ = id => document.getElementById(id);
  let ctx;
  let arrivals = [];
  let stays = [];
  let historyRows = [];
  let historyTotal = 0;
  let historyOffset = 0;
  const historyLimit = 100;
  let availableRooms = [];
  let currentGuest = null;
  let currentStay = null;
  let activeTab = 'arrivals';
  let historySearchTimer = null;
  let historyRequestSequence = 0;

  try {
    ctx = await UI.ready('checkin', ['manager','front-desk']);
    UI.bindShell();
    setDefaultCheckout();
    await loadBoard();
  } catch (error) {
    UI.toast('error', 'Check-in desk unavailable', error.message);
    return;
  }

  function setDefaultCheckout() {
    const d = new Date(Date.now() + 7 * 86400000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $('expectedCheckout').value = d.toISOString().slice(0,16);
  }

  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('[data-panel-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.panelTab === tab));
    $('arrivalsPanel').classList.toggle('active', tab === 'arrivals');
    $('activePanel').classList.toggle('active', tab === 'active');
    $('historyPanel').classList.toggle('active', tab === 'history');
  }

  async function loadBoard() {
    $('arrivalsRows').innerHTML = '<tr><td colspan="7" class="loading-state">Loading eligible client profiles…</td></tr>';
    $('activeRows').innerHTML = '<tr><td colspan="7" class="loading-state">Loading active stays…</td></tr>';
    $('refreshCheckin').disabled = true;
    try {
      const data = await UI.rpc('staff_get_checkin_board', { p_search: null });
      arrivals = Array.isArray(data.arrivals) ? data.arrivals : [];
      stays = Array.isArray(data.active_stays) ? data.active_stays : [];
      availableRooms = Array.isArray(data.available_rooms) ? data.available_rooms : [];
      render();
      await loadHistory();
    } catch (error) {
      $('arrivalsRows').innerHTML = `<tr><td colspan="7" class="error-state">${UI.esc(error.message)}</td></tr>`;
      $('activeRows').innerHTML = `<tr><td colspan="7" class="error-state">${UI.esc(error.message)}</td></tr>`;
      UI.toast('error', 'Could not load check-in board', error.message);
    } finally {
      $('refreshCheckin').disabled = false;
    }
  }

  async function loadHistory({ reset = true } = {}) {
    const requestSequence = ++historyRequestSequence;
    if (reset) historyOffset = 0;
    $('historyRows').innerHTML = '<tr><td colspan="7" class="loading-state">Loading completed stays…</td></tr>';
    try {
      const data = await UI.rpc('staff_get_stay_history', {
        p_search: $('checkinSearch').value.trim() || null,
        p_limit: historyLimit,
        p_offset: historyOffset
      });
      if (requestSequence !== historyRequestSequence) return;
      const pageRows = Array.isArray(data.rows) ? data.rows : [];
      historyRows = reset ? pageRows : [...historyRows, ...pageRows];
      historyTotal = Number(data.total) || 0;
      historyOffset = historyRows.length;
      renderHistory();
    } catch (error) {
      if (requestSequence !== historyRequestSequence) return;
      if (reset) historyRows = [];
      historyTotal = 0;
      $('historyRows').innerHTML = `<tr><td colspan="7" class="error-state">${UI.esc(error.message)}</td></tr>`;
      $('historyResult').textContent = 'Unavailable';
      UI.toast('error', 'Could not load stay history', error.message);
    }
  }

  function durationLabel(hours) {
    if (hours == null || !Number.isFinite(Number(hours))) return '—';
    const total = Math.max(0, Math.round(Number(hours)));
    const days = Math.floor(total / 24);
    const remaining = total % 24;
    return days ? `${days}d ${remaining}h` : `${remaining}h`;
  }

  function renderHistory() {
    const q = $('checkinSearch').value.trim().toLowerCase();
    const rows = historyRows.filter(row => !q ||
      [row.full_name,row.guest_id,row.reg_id,row.room_number].some(value => String(value || '').toLowerCase().includes(q)));
    $('historyResult').textContent = `${rows.length} shown · ${historyTotal} total completed / cancelled stays`;
    $('historyPageInfo').textContent = `${historyRows.length} of ${historyTotal} records loaded`;
    $('historyLoadMore').hidden = historyRows.length >= historyTotal;
    if (!rows.length) {
      $('historyRows').innerHTML = '<tr><td colspan="7" class="empty-state"><strong>No stay history found</strong>Completed and cancelled stays appear here after checkout.</td></tr>';
      return;
    }
    $('historyRows').innerHTML = rows.map(row => `<tr><td><div class="guest-cell"><span class="avatar">${UI.esc(UI.initials(row.full_name))}</span><div><span class="primary-text">${UI.esc(row.full_name || 'Guest')}</span><span class="secondary-text">${UI.esc(row.guest_id || row.reg_id || '')}</span></div></div></td><td>Room ${UI.esc(row.room_number)}<span class="secondary-text">Floor ${UI.esc(row.floor)}</span></td><td>${UI.esc(row.occupants_count || 1)}</td><td>${UI.formatDate(row.checked_in_at,true)}</td><td>${UI.formatDate(row.checked_out_at,true)}</td><td>${durationLabel(row.stay_hours)}</td><td><span class="status-pill ${UI.statusClass(row.status)}">${UI.esc(row.status)}</span></td></tr>`).join('');
  }

  function searchFilter(row, isStay = false) {
    const q = $('checkinSearch').value.trim().toLowerCase();
    if (!q) return true;
    return [row.full_name,row.guest_id,row.reg_id,row.room_number,row.requested_room].some(v => String(v || '').toLowerCase().includes(q));
  }

  function render() {
    const arrivalList = arrivals.filter(row => searchFilter(row));
    const stayList = stays.filter(row => searchFilter(row,true));
    $('arrivalCount').textContent = arrivals.length;
    $('activeStayCount').textContent = stays.length;
    $('overdueCount').textContent = stays.filter(s => s.overdue).length;
    $('availableRoomCount').textContent = availableRooms.length;
    $('arrivalsResult').textContent = `${arrivalList.length} clients`;
    $('activeResult').textContent = `${stayList.length} active stays`;

    if (!arrivalList.length) {
      $('arrivalsRows').innerHTML = '<tr><td colspan="7" class="empty-state"><strong>No clients awaiting check-in</strong>Verified profiles without an active stay will appear here.</td></tr>';
    } else {
      $('arrivalsRows').innerHTML = arrivalList.map(g => {
        const canStart = (!g.registration_status || String(g.registration_status).toLowerCase() === 'verified') && (!g.booking_status || String(g.booking_status).toLowerCase() === 'approved') && !g.legacy_room_assignment;
        const blockReason = g.legacy_room_assignment ? 'Legacy room assignment needs reconciliation' : 'Registration or booking must be verified/approved';
        const roomLabel = g.requested_room || g.pending_room || g.assigned_room || g.room || 'Walk-in / none';
        return `<tr><td><div class="guest-cell"><span class="avatar">${UI.esc(UI.initials(g.full_name))}</span><div><span class="primary-text">${UI.esc(g.full_name || 'Guest')}</span><span class="secondary-text">${UI.esc(g.email || '')}</span></div></div></td><td>${UI.esc(g.guest_id || '—')}</td><td>${UI.esc(g.reg_id || '—')}</td><td>${UI.esc(roomLabel)}</td><td><span class="status-pill ${UI.statusClass(g.registration_status)}">${UI.esc(g.registration_status || 'Not specified')}</span></td><td><span class="status-pill ${UI.statusClass(g.booking_status)}">${UI.esc(g.booking_status || 'Walk-in')}</span>${g.legacy_room_assignment ? '<span class="secondary-text">Legacy assignment · review required</span>' : ''}</td><td><button class="btn btn-primary btn-small" data-checkin-guest="${UI.esc(g.id)}" ${canStart ? '' : `disabled title="${UI.esc(blockReason)}"`}>Check in</button></td></tr>`;
      }).join('');
    }

    if (!stayList.length) {
      $('activeRows').innerHTML = '<tr><td colspan="7" class="empty-state"><strong>No active stays</strong>Guests checked in through this module will appear here.</td></tr>';
    } else {
      $('activeRows').innerHTML = stayList.map(s => `<tr><td><div class="guest-cell"><span class="avatar">${UI.esc(UI.initials(s.full_name))}</span><div><span class="primary-text">${UI.esc(s.full_name || 'Guest')}</span><span class="secondary-text">${UI.esc(s.guest_id || '')}</span></div></div></td><td><strong>${UI.esc(s.room_number)}</strong><span class="secondary-text">Floor ${UI.esc(s.floor)}</span></td><td>${UI.esc(s.occupants_count || 1)}</td><td>${UI.formatDate(s.checked_in_at,true)}</td><td>${UI.formatDate(s.expected_checkout_at,true)}</td><td><span class="status-pill ${s.overdue ? 'overdue' : 'active'}">${s.overdue ? 'Overdue' : 'In-house'}</span></td><td><button class="btn btn-danger btn-small" data-checkout-stay="${UI.esc(s.stay_id)}">Check out</button></td></tr>`).join('');
    }
  }

  function openCheckin(id) {
    currentGuest = arrivals.find(g => String(g.id) === String(id));
    if (!currentGuest) return;
    $('checkinGuestId').value = currentGuest.id;
    $('checkinGuestName').textContent = currentGuest.full_name || 'Guest';
    $('checkinGuestMeta').textContent = `${currentGuest.guest_id || 'No Guest ID'} · ${currentGuest.institution || 'Institution not set'} · ${currentGuest.group_size > 1 ? `Group of ${currentGuest.group_size} · ` : ''}${currentGuest.requested_room ? `Requested Room ${currentGuest.requested_room}` : 'Walk-in / no approved room on file'}`;
    const requiredOccupants = Math.max(1, Number(currentGuest.group_size) || 1);
    const approvedBooking = String(currentGuest.booking_status || '').toLowerCase() === 'approved';
    const requestedRoom = String(currentGuest.requested_room || '').toLowerCase();
    const options = availableRooms.filter(room => {
      const roomNumber = String(room.room_number).toLowerCase();
      const roomIsReservedForThisBooking = String(room.status).toLowerCase() !== 'reserved' || (approvedBooking && requestedRoom && roomNumber === requestedRoom);
      const roomMatchesApprovedRequest = !approvedBooking || !requestedRoom || roomNumber === requestedRoom;
      return Number(room.available_capacity) >= requiredOccupants && roomIsReservedForThisBooking && roomMatchesApprovedRequest;
    });
    $('checkinRoom').innerHTML = options.map(r => `<option value="${UI.esc(r.id)}" ${String(r.room_number).toLowerCase() === requestedRoom ? 'selected' : ''}>Room ${UI.esc(r.room_number)} · Floor ${UI.esc(r.floor)} · ${r.available_capacity} space(s) · ${UI.esc(r.status)}</option>`).join('');
    if (!options.length) $('checkinRoom').innerHTML = `<option value="">No room has ${requiredOccupants} available space(s)${approvedBooking ? ' matching the approved request' : ''}</option>`;
    $('completeCheckin').disabled = options.length === 0;
    setDefaultCheckout();
    $('checkinNote').value = '';
    UI.openModal($('checkinModal'));
  }

  function openCheckout(id) {
    currentStay = stays.find(s => String(s.stay_id) === String(id));
    if (!currentStay) return;
    $('checkoutStayId').value = currentStay.stay_id;
    $('checkoutGuestName').textContent = currentStay.full_name || 'Guest';
    $('checkoutGuestMeta').textContent = `Room ${currentStay.room_number} · checked in ${UI.formatDate(currentStay.checked_in_at,true)}`;
    $('checkoutNote').value = '';
    UI.openModal($('checkoutModal'));
  }

  $('arrivalsRows').addEventListener('click', event => {
    const btn = event.target.closest('[data-checkin-guest]');
    if (btn) openCheckin(btn.dataset.checkinGuest);
  });
  $('activeRows').addEventListener('click', event => {
    const btn = event.target.closest('[data-checkout-stay]');
    if (btn) openCheckout(btn.dataset.checkoutStay);
  });

  $('checkinForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentGuest) return;
    const btn = $('completeCheckin');
    UI.setBusy(btn,true,'Checking in…');
    try {
      const expected = new Date($('expectedCheckout').value);
      if (Number.isNaN(expected.getTime())) throw new Error('Choose a valid expected check-out date and time.');
      await UI.rpc('staff_check_in_guest', {
        p_guest_id: currentGuest.id,
        p_room_id: $('checkinRoom').value,
        p_expected_checkout_at: expected.toISOString(),
        p_note: $('checkinNote').value.trim() || null
      });
      UI.closeModal($('checkinModal'));
      UI.toast('success','Guest checked in',`${currentGuest.full_name} has been checked in. The room occupancy and stay history were updated.`);
      currentGuest = null;
      await loadBoard();
    } catch (error) {
      UI.toast('error','Check-in failed',error.message);
    } finally { UI.setBusy(btn,false); }
  });

  $('checkoutForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentStay) return;
    const btn = $('completeCheckout');
    UI.setBusy(btn,true,'Checking out…');
    try {
      await UI.rpc('staff_check_out_guest', {
        p_stay_id: currentStay.stay_id,
        p_note: $('checkoutNote').value.trim() || null
      });
      UI.closeModal($('checkoutModal'));
      UI.toast('success','Guest checked out',`${currentStay.full_name} has been checked out. Stay history was preserved.`);
      currentStay = null;
      await loadBoard();
    } catch (error) {
      UI.toast('error','Check-out failed',error.message);
    } finally { UI.setBusy(btn,false); }
  });

  document.querySelectorAll('[data-panel-tab]').forEach(btn => btn.addEventListener('click',() => setTab(btn.dataset.panelTab)));
  $('checkinSearch').addEventListener('input',() => {
    render();
    renderHistory();
    window.clearTimeout(historySearchTimer);
    historySearchTimer = window.setTimeout(() => loadHistory({ reset:true }), 300);
  });
  $('checkinSearch').addEventListener('change',() => {
    window.clearTimeout(historySearchTimer);
    loadHistory({ reset:true });
  });
  $('historyLoadMore').addEventListener('click',() => loadHistory({ reset:false }));
  $('clearCheckinSearch').addEventListener('click',() => { $('checkinSearch').value=''; render(); loadHistory({ reset:true }); });
  $('refreshCheckin').addEventListener('click',loadBoard);
  document.querySelectorAll('[data-close="checkinModal"]').forEach(el => el.addEventListener('click',() => UI.closeModal($('checkinModal'))));
  document.querySelectorAll('[data-close="checkoutModal"]').forEach(el => el.addEventListener('click',() => UI.closeModal($('checkoutModal'))));
});
