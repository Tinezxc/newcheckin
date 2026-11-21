document.addEventListener('DOMContentLoaded', async () => {
  const UI = window.CMDIModules;
  if (!UI) return;
  const $ = (id) => document.getElementById(id);
  let ctx;
  let guests = [];
  let filtered = [];

  try {
    ctx = await UI.ready('guests', ['manager', 'front-desk']);
    UI.bindShell();
    await loadGuests();
  } catch (error) {
    UI.toast('error', 'Guests unavailable', error.message);
    return;
  }

  async function loadGuests() {
    $('guestRows').innerHTML = '<tr><td colspan="9" class="loading-state">Loading live guest profiles…</td></tr>';
    $('refreshGuests').disabled = true;
    try {
      const result = await UI.rpc('staff_get_guest_directory', { p_search: null, p_status: null, p_limit: 500, p_offset: 0 });
      guests = Array.isArray(result.rows) ? result.rows : [];
      updateStats();
      applyFilters();
    } catch (error) {
      $('guestRows').innerHTML = `<tr><td colspan="9" class="error-state">${UI.esc(error.message)}</td></tr>`;
      UI.toast('error', 'Could not load guests', error.message);
    } finally {
      $('refreshGuests').disabled = false;
    }
  }

  function updateStats() {
    $('guestTotal').textContent = guests.length;
    $('guestAssigned').textContent = guests.filter(g => g.room_number).length;
    $('guestUnassigned').textContent = guests.filter(g => !g.room_number).length;
    $('guestVerified').textContent = guests.filter(g => String(g.registration_status || '').toLowerCase() === 'verified').length;
  }

  function applyFilters() {
    const q = $('guestSearch').value.trim().toLowerCase();
    const status = $('guestStatusFilter').value;
    const roomState = $('guestRoomFilter').value;
    filtered = guests.filter(g => {
      const text = [g.full_name,g.email,g.guest_id,g.reg_id,g.institution,g.branch,g.phone,g.room_number]
        .some(v => String(v || '').toLowerCase().includes(q));
      const matchStatus = status === 'all' || String(g.profile_status || '').toLowerCase() === status;
      const matchRoom = roomState === 'all' || (roomState === 'assigned' ? !!g.room_number : !g.room_number);
      return text && matchStatus && matchRoom;
    });
    render();
  }

  function render() {
    $('guestResultCount').textContent = `${filtered.length} of ${guests.length} profiles`;
    $('guestPageCount').textContent = `${filtered.length} shown`;
    if (!filtered.length) {
      $('guestRows').innerHTML = `<tr><td colspan="9" class="empty-state"><strong>No guest profiles found</strong>Try another search or wait for a client registration.</td></tr>`;
      return;
    }
    $('guestRows').innerHTML = filtered.map(g => `
      <tr>
        <td><div class="guest-cell"><span class="avatar">${UI.esc(UI.initials(g.full_name))}</span><div><span class="primary-text">${UI.esc(g.full_name || 'Unnamed guest')}</span><span class="secondary-text">${UI.esc(g.email || '')}</span></div></div></td>
        <td>${UI.esc(g.guest_id || '—')}</td>
        <td>${UI.esc(g.reg_id || '—')}</td>
        <td>${UI.esc(g.institution || '—')}<span class="secondary-text">${UI.esc(g.branch || '')}</span></td>
        <td>${UI.esc(g.room_number || '—')}<span class="secondary-text">${g.floor ? `Floor ${UI.esc(g.floor)}` : ''}</span></td>
        <td>${UI.formatDate(g.checked_in_at || g.check_in)}</td>
        <td><span class="status-pill ${UI.statusClass(g.registration_status)}">${UI.esc(g.registration_status || '—')}</span></td>
        <td><span class="status-pill ${UI.statusClass(g.profile_status)}">${UI.esc(g.profile_status || 'unknown')}</span></td>
        <td><button type="button" class="btn btn-secondary btn-small" data-edit-guest="${UI.esc(g.id)}">Edit</button></td>
      </tr>`).join('');
  }

  function openEdit(id) {
    const guest = guests.find(g => String(g.id) === String(id));
    if (!guest) return;
    $('editGuestId').value = guest.id;
    $('editGuestName').value = guest.full_name || '';
    $('editGuestPhone').value = guest.phone || '';
    $('editGuestInstitution').value = guest.institution || '';
    $('editGuestBranch').value = guest.branch || '';
    UI.openModal($('guestEditModal'));
  }

  $('guestRows').addEventListener('click', event => {
    const btn = event.target.closest('[data-edit-guest]');
    if (btn) openEdit(btn.dataset.editGuest);
  });
  $('guestEditForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('saveGuestBtn');
    UI.setBusy(button, true, 'Saving…');
    try {
      await UI.rpc('staff_update_guest_profile', {
        p_guest_id: $('editGuestId').value,
        p_full_name: $('editGuestName').value.trim(),
        p_phone: $('editGuestPhone').value.trim() || null,
        p_institution: $('editGuestInstitution').value.trim() || null,
        p_branch: $('editGuestBranch').value.trim() || null
      });
      UI.closeModal($('guestEditModal'));
      UI.toast('success', 'Guest profile updated', 'The changes were saved to Supabase and added to the audit log.');
      await loadGuests();
    } catch (error) {
      UI.toast('error', 'Guest update failed', error.message);
    } finally {
      UI.setBusy(button, false);
    }
  });

  $('guestSearch').addEventListener('input', applyFilters);
  $('guestStatusFilter').addEventListener('change', applyFilters);
  $('guestRoomFilter').addEventListener('change', applyFilters);
  $('clearGuestFilters').addEventListener('click', () => {
    $('guestSearch').value = '';
    $('guestStatusFilter').value = 'all';
    $('guestRoomFilter').value = 'all';
    applyFilters();
  });
  $('refreshGuests').addEventListener('click', loadGuests);
  $('exportGuests').addEventListener('click', () => {
    UI.exportCsv(`cmdi-guests-${new Date().toISOString().slice(0,10)}.csv`, [
      { label:'Full name', key:'full_name' }, { label:'Email', key:'email' }, { label:'Guest ID', key:'guest_id' },
      { label:'Registration ID', key:'reg_id' }, { label:'Institution', key:'institution' }, { label:'Branch', key:'branch' },
      { label:'Phone', key:'phone' }, { label:'Room', key:'room_number' }, { label:'Profile status', key:'profile_status' },
      { label:'Registration status', key:'registration_status' }, { label:'Check-in date', key:'check_in' }
    ], filtered);
    UI.toast('success', 'CSV exported', `${filtered.length} guest profiles exported.`);
  });
  document.querySelectorAll('[data-close="guestEditModal"]').forEach(el => el.addEventListener('click', () => UI.closeModal($('guestEditModal'))));
});
