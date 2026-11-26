(() => {
  'use strict';
  const db = window.supabaseClient;
  const page = document.body.dataset.clientPage || 'dashboard';
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const safeValue = value => value == null || String(value).trim() === '' ? '—' : String(value);
  const floorForRoom = (room) => {
    const value = String(room || '').trim();
    if (/^2(?:0[1-9]|1[01])$/.test(value)) return 2;
    if (/^3(?:0[1-9]|1[01])$/.test(value)) return 3;
    return null;
  };
  const capacityForRoom = (room) => floorForRoom(room) === 2 ? 5 : floorForRoom(room) === 3 ? 3 : null;
  const firstName = value => String(value || 'Guest').trim().split(/\s+/)[0] || 'Guest';
  const initials = value => String(value || 'Guest').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0].toUpperCase()).join('') || 'G';
  function setText(id, value) { const el = $(id); if (el) el.textContent = safeValue(value); }
  function statusClass(value) {
    const key = String(value || '').toLowerCase();
    if (['verified','active','approved','confirmed','completed'].includes(key)) return 'success';
    if (['pending','inviting','ready'].includes(key)) return 'warning';
    if (['rejected','cancelled','suspended','inactive','expired'].includes(key)) return 'danger';
    return '';
  }
  function statusLabel(value) { return String(value || 'Not set').replace(/[_-]+/g,' ').replace(/\b\w/g, m => m.toUpperCase()); }
  function showMessage(message, type='error') {
    const el = $('portalMessage');
    if (!el) return;
    el.hidden = false; el.className = `portal-alert${type === 'error' ? ' error' : ''}`; el.textContent = message;
  }

  const GUEST_ID_PATTERN = /^TR-[A-Z0-9_-]{2,50}$/i;

  function closeGuestQr() {
    const modal = $('guestQrModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('guest-qr-printing');
    $('showGuestQrBtn')?.focus();
  }

  function openGuestQr(guestId, fullName) {
    const id = String(guestId || '').trim().toUpperCase();
    const modal = $('guestQrModal');
    const codeBox = $('guestQrCode');
    const errorBox = $('guestQrError');
    if (!GUEST_ID_PATTERN.test(id)) {
      showMessage('Your CMDI Guest ID is missing or invalid. Please contact Front Desk.');
      return;
    }
    if (!window.QRCode) {
      showMessage('The QR generator did not load. Refresh the page or contact Front Desk.');
      return;
    }
    if (!modal || !codeBox) {
      showMessage('The QR display is unavailable on this page. Please refresh or contact Front Desk.');
      return;
    }

    codeBox.replaceChildren();
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
    $('guestQrId').textContent = id;
    $('guestQrName').textContent = String(fullName || 'CMDI Client');

    try {
      // The QR payload is deliberately limited to the Guest ID. The existing
      // Front Desk scanner parses plain TR-… Guest IDs directly.
      new window.QRCode(codeBox, {
        text: id,
        width: 240,
        height: 240,
        colorDark: '#1b3a2e',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.H
      });
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      $('closeGuestQrBtn')?.focus();
    } catch (error) {
      console.error('[CMDI Client QR] Generation failed:', error);
      if (errorBox) {
        errorBox.textContent = 'Could not generate your QR code. Please refresh and try again.';
        errorBox.hidden = false;
      }
    }
  }

  function setupClientQr(profile) {
    const action = $('portalQrAction');
    const button = $('showGuestQrBtn');
    const help = $('guestQrAvailability');
    if (!action || !button || !help || page !== 'profile') return;

    action.hidden = false;
    button.hidden = true;
    const guestId = String(profile.guest_id || '').trim().toUpperCase();
    const registrationStatus = String(profile.registration_status || '').trim().toLowerCase();
    const accountStatus = String(profile.status || 'active').trim().toLowerCase();

    if (['inactive', 'suspended'].includes(accountStatus)) {
      help.textContent = 'Your QR code is unavailable while your client account is inactive. Please contact CMDI Front Desk.';
      return;
    }
    if (registrationStatus !== 'verified') {
      help.textContent = 'Your QR code will be available after your registration is verified.';
      return;
    }
    if (!GUEST_ID_PATTERN.test(guestId)) {
      help.textContent = 'Your Guest ID has not been assigned yet. Please contact CMDI Front Desk.';
      return;
    }

    button.hidden = false;
    help.textContent = 'Show this QR code to Front Desk. It contains your Guest ID only.';
    button.addEventListener('click', () => openGuestQr(guestId, profile.full_name));
  }

  function bindGuestQrModal() {
    $('closeGuestQrBtn')?.addEventListener('click', closeGuestQr);
    $('guestQrModal')?.addEventListener('click', event => {
      if (event.target === $('guestQrModal')) closeGuestQr();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeGuestQr();
    });
    $('downloadGuestQrBtn')?.addEventListener('click', () => {
      const canvas = $('guestQrCode')?.querySelector('canvas');
      const image = $('guestQrCode')?.querySelector('img');
      const dataUrl = canvas?.toDataURL('image/png') || image?.src;
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        const errorBox = $('guestQrError');
        if (errorBox) {
          errorBox.textContent = 'The QR image is not ready yet. Close and reopen the QR code, then try again.';
          errorBox.hidden = false;
        }
        return;
      }
      const guestId = $('guestQrId')?.textContent || 'CMDI-Guest';
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `CMDI-${guestId}-QR.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    $('printGuestQrBtn')?.addEventListener('click', () => {
      document.body.classList.add('guest-qr-printing');
      window.print();
    });
    window.addEventListener('afterprint', () => document.body.classList.remove('guest-qr-printing'));
  }

  // Dashboard-only shared-room information and client room-transfer workflow.
  let currentRoomShare = null;

  function setTransferMessage(message, type = '') {
    const el = $('roomTransferStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'room-transfer-status' + (type ? ` ${type}` : '');
    el.hidden = !message;
  }

  function renderRoommates(share) {
    const section = $('roommatesSection');
    const list = $('roommatesList');
    const count = $('roommatesCount');
    if (!section || !list) return;

    if (!share?.room) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    const people = Array.isArray(share.roommates) ? share.roommates : [];
    if (count) count.textContent = `${Number(share.room?.occupants || people.length)} / ${Number(share.room?.capacity || 0)} assigned`;
    list.replaceChildren();

    if (!people.length) {
      const empty = document.createElement('p');
      empty.className = 'portal-empty';
      empty.textContent = 'No other room members are recorded yet.';
      list.appendChild(empty);
      return;
    }

    people.forEach(person => {
      const row = document.createElement('div');
      row.className = 'roommate-row';
      const avatar = document.createElement('span');
      avatar.className = 'roommate-avatar';
      avatar.textContent = initials(person.name);
      const nameWrap = document.createElement('span');
      nameWrap.className = 'roommate-name-wrap';
      const name = document.createElement('strong');
      name.textContent = person.name || 'CMDI Trainee';
      const sub = document.createElement('small');
      sub.textContent = person.is_you ? 'You' : 'Roommate';
      nameWrap.append(name, sub);
      row.append(avatar, nameWrap);
      if (person.is_you) {
        const you = document.createElement('span');
        you.className = 'roommate-you';
        you.textContent = 'YOU';
        row.appendChild(you);
      }
      list.appendChild(row);
    });
  }

  function renderRoomTransfer(share) {
    const section = $('roomTransferSection');
    const form = $('roomTransferForm');
    const select = $('transferTargetRoom');
    const pendingWrap = $('roomTransferPending');
    if (!section || !form || !select || !pendingWrap) return;

    section.hidden = !share?.room;
    if (!share?.room) return;

    const latest = share.latest_transfer || null;
    const isPending = latest?.status === 'pending';
    pendingWrap.hidden = !isPending;
    form.hidden = isPending || share.can_transfer !== true;

    if (isPending) {
      $('roomTransferPendingText').textContent = `Your request to move from Room ${latest.from_room} to Room ${latest.to_room} is waiting for Front Desk review.`;
      $('cancelTransferRequest').dataset.requestId = latest.id;
      setTransferMessage('Your current room assignment stays unchanged while the request is pending.', 'info');
      return;
    }

    if (latest?.status === 'approved') {
      setTransferMessage(`Your previous transfer to Room ${latest.to_room} was approved. Your current room is Room ${share.room.room_number}.`, 'success');
    } else if (latest?.status === 'rejected') {
      const note = latest.staff_note ? ` Front Desk note: ${latest.staff_note}` : '';
      setTransferMessage(`Your previous request to Room ${latest.to_room} was not approved.${note}`, 'error');
    } else if (latest?.status === 'cancelled') {
      setTransferMessage('Your previous room transfer request was cancelled.', 'info');
    } else {
      setTransferMessage('', '');
    }

    if (share.can_transfer !== true) {
      const message = share.transfer_block_reason || 'Room transfers are not currently available for this stay.';
      select.replaceChildren(new Option(message, ''));
      setTransferMessage(message, 'info');
      return;
    }

    const options = Array.isArray(share.transfer_options) ? share.transfer_options : [];
    select.replaceChildren();
    select.add(new Option('Choose a destination room…', ''));
    options.forEach(room => {
      const label = `Room ${room.room_number} · Floor ${room.floor} · ${room.available_beds} bed(s) available`;
      select.add(new Option(label, room.room_number));
    });
    $('submitTransferRequest').disabled = options.length === 0;
    if (!options.length) {
      select.replaceChildren(new Option('No compatible rooms currently available', ''));
      setTransferMessage('No other compatible room currently has an available bed.', 'info');
    }
  }

  async function loadRoomShare() {
    const section = $('roommatesSection');
    if (page !== 'dashboard' || !section) return;
    section.hidden = false;
    const list = $('roommatesList');
    if (list) list.textContent = 'Loading room members…';
    const { data, error } = await db.rpc('get_client_room_share');
    if (error) throw error;
    if (!data || data.ok !== true) throw new Error('Could not load your room information.');
    currentRoomShare = data;
    renderRoommates(data);
    renderRoomTransfer(data);

    if (data.room) {
      setText('roomSummaryNumber', data.room.room_number);
      setText('roomSummaryFloor', `Floor ${data.room.floor}`);
      setText('roomSummaryCapacity', `${data.room.occupants} of ${data.room.capacity} assigned`);
    }
  }

  async function submitRoomTransfer() {
    const button = $('submitTransferRequest');
    const target = $('transferTargetRoom')?.value || '';
    const reason = $('transferReason')?.value?.trim() || null;
    if (!target) { setTransferMessage('Choose a destination room first.', 'error'); return; }
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
      const { data, error } = await db.rpc('request_client_room_transfer', {
        p_target_room: target,
        p_reason: reason
      });
      if (error) throw error;
      if (!data?.ok) throw new Error('The transfer request was not confirmed by the database.');
      $('transferReason').value = '';
      setTransferMessage(`Your request to move from Room ${data.from_room} to Room ${data.to_room} was submitted. Your room will change only after Front Desk approval.`, 'success');
      await loadRoomShare();
    } catch (error) {
      console.error('[CMDI room transfer] Submit failed:', error);
      setTransferMessage(error.message || 'Could not submit the room transfer request.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Request Room Transfer';
    }
  }

  async function cancelRoomTransfer() {
    const button = $('cancelTransferRequest');
    const requestId = button?.dataset.requestId;
    if (!requestId) return;
    if (!window.confirm('Cancel your pending room transfer request? Your current room assignment will remain unchanged.')) return;
    button.disabled = true;
    try {
      const { error } = await db.rpc('cancel_client_room_transfer', { p_request_id: requestId });
      if (error) throw error;
      setTransferMessage('Your room transfer request has been cancelled.', 'info');
      await loadRoomShare();
    } catch (error) {
      console.error('[CMDI room transfer] Cancel failed:', error);
      setTransferMessage(error.message || 'Could not cancel the transfer request.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  // Backwards-compatible hook for the earlier profile.js version, which calls
  // window.openQR(guest_id, full_name).
  window.openQR = openGuestQr;
  function updatePage(profile,user) {
    const name = profile.full_name || user.email || 'Guest';
    const assignedRoom = profile.assigned_room || profile.room || null;
    const pendingRoom = profile.pending_room || null;
    const reg = String(profile.registration_status || 'pending').toLowerCase();
    const accountStatus = String(profile.status || 'active').toLowerCase();
    const room = assignedRoom || pendingRoom;
    const floor = floorForRoom(room);
    const maxCapacity = capacityForRoom(room);
    const roomState = assignedRoom ? 'Room assigned' : pendingRoom ? 'Request submitted' : 'No room selected';
    const isSuspended = ['suspended','inactive'].includes(accountStatus);

    document.querySelectorAll('[data-client-name]').forEach(el => el.textContent = name);
    document.querySelectorAll('[data-client-first-name]').forEach(el => el.textContent = firstName(name));
    document.querySelectorAll('[data-client-email]').forEach(el => el.textContent = user.email || '—');
    document.querySelectorAll('[data-client-initials]').forEach(el => el.textContent = initials(name));
    document.querySelectorAll('[data-client-guest-id]').forEach(el => el.textContent = safeValue(profile.guest_id));
    document.querySelectorAll('[data-client-registration-id]').forEach(el => el.textContent = safeValue(profile.reg_id));

    const registrationPill = $('registrationStatus');
    if (registrationPill) { registrationPill.textContent = statusLabel(reg); registrationPill.className = `portal-status ${statusClass(reg)}`; }
    const accountPill = $('accountStatus');
    if (accountPill) { accountPill.textContent = statusLabel(accountStatus); accountPill.className = `portal-status ${statusClass(accountStatus)}`; }
    const roomPill = $('roomStatus');
    if (roomPill) { roomPill.textContent = roomState; roomPill.className = `portal-status ${assignedRoom ? 'success' : pendingRoom ? 'warning' : ''}`; }

    setText('registrationIdValue', profile.reg_id);
    setText('guestIdValue', profile.guest_id);
    setText('institutionValue', profile.institution);
    setText('branchValue', profile.branch);
    setText('unitValue', profile.unit);
    setText('phoneValue', profile.phone);
    setText('addressValue', profile.address);
    setText('genderValue', profile.gender);
    setText('emailValue', user.email);
    setText('requestedCheckinValue', profile.check_in);
    setText('clientRoleValue', profile.role);

    if (assignedRoom) {
      setText('roomNumberValue', assignedRoom);
      setText('roomFloorValue', floor ? `Floor ${floor}` : 'Pending floor confirmation');
      setText('roomCapacityValue', maxCapacity ? `${maxCapacity} maximum occupants` : 'Ask Front Desk to confirm room capacity');
      setText('roomSummaryNumber', assignedRoom);
      setText('roomSummaryFloor', floor ? `Floor ${floor}` : 'Room assignment');
      setText('roomSummaryCapacity', maxCapacity ? `Maximum ${maxCapacity} occupants` : 'Capacity confirmation required');
      $('roomSummary')?.classList.remove('hidden');
      $('noRoomSummary')?.classList.add('hidden');
    } else if (pendingRoom) {
      setText('roomNumberValue', `Room ${pendingRoom} · Pending approval`);
      setText('roomFloorValue', floor ? `Floor ${floor}` : 'Pending confirmation');
      setText('roomCapacityValue', maxCapacity ? `${maxCapacity} maximum occupants` : 'Pending confirmation');
      setText('roomSummaryNumber', pendingRoom);
      setText('roomSummaryFloor', floor ? `Floor ${floor}` : 'Awaiting review');
      setText('roomSummaryCapacity', 'Waiting for Front Desk approval');
      $('roomSummary')?.classList.remove('hidden');
      $('noRoomSummary')?.classList.add('hidden');
    } else {
      $('roomSummary')?.classList.add('hidden');
      $('noRoomSummary')?.classList.remove('hidden');
      setText('roomNumberValue','No room selected');
      setText('roomFloorValue','—');
      setText('roomCapacityValue','—');
    }

    const hasRoomRequest = Boolean(assignedRoom || pendingRoom);
    document.querySelectorAll('[data-choose-room]').forEach(el => {
      el.hidden = hasRoomRequest || isSuspended || reg !== 'verified';
    });
    document.querySelectorAll('[data-room-request-message]').forEach(el => {
      el.hidden = !pendingRoom;
      if (pendingRoom) el.textContent = `Your request for Room ${pendingRoom} is waiting for Front Desk review. Please contact the front desk if you need to change this request.`;
    });
    document.querySelectorAll('[data-assigned-room-message]').forEach(el => {
      el.hidden = !assignedRoom;
      if (assignedRoom) el.textContent = `Room ${assignedRoom} is recorded on your profile as your assigned room. Actual check-in/check-out timestamps are maintained by Front Desk.`;
    });
    if (page === 'profile') setupClientQr(profile);
    if (isSuspended) showMessage('Your client account is currently inactive. Please contact CMDI Front Desk for assistance.');
    else if (reg !== 'verified') showMessage('Your registration has not been verified yet. Room selection will be available after verification.', 'info');
    const loaded = $('portalLoading'); if (loaded) loaded.hidden = true;
    const content = $('portalContent'); if (content) content.hidden = false;
  }

  async function boot() {
    if (!db) throw new Error('Supabase client is not initialized. Check js/supabase-client.js.');
    const { data: sessionData, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData?.session?.user;
    if (!user?.id) { window.location.replace('index.html'); return; }

    const { data: profile, error } = await db.from('profiles')
      .select('id,full_name,role,status,guest_id,reg_id,phone,institution,branch,unit,address,gender,room,pending_room,assigned_room,registration_status,check_in,created_at')
      .eq('id', user.id).single();
    if (error) throw error;
    if (!profile) throw new Error('Your CMDI client profile could not be found.');
    if (String(profile.role || '').toLowerCase() !== 'client') {
      const role = String(profile.role || '').toLowerCase();
      if (['front-desk','housekeeping','maintenance','manager'].includes(role)) window.location.replace('staff-dashboard.html');
      else if (['admin','super-admin','support-admin'].includes(role)) window.location.replace('admin-dashboard.html');
      else throw new Error('This page is for CMDI client accounts.');
      return;
    }
    updatePage(profile,user);
    if (page === 'dashboard') {
      $('submitTransferRequest')?.addEventListener('click', submitRoomTransfer);
      $('cancelTransferRequest')?.addEventListener('click', cancelRoomTransfer);
      try {
        await loadRoomShare();
      } catch (shareError) {
        console.error('[CMDI client room share]', shareError);
        const section = $('roommatesSection');
        const list = $('roommatesList');
        if (section) section.hidden = false;
        if (list) list.textContent = 'Roommate information is temporarily unavailable. Refresh or contact Front Desk.';
        setTransferMessage(shareError.message || 'Could not load room transfer information.', 'error');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindGuestQrModal();
    $('portalLoading')?.classList.add('portal-loading');
    $('signOutBtn')?.addEventListener('click', async () => {
      const button = $('signOutBtn'); if (button) { button.disabled = true; button.textContent = 'Signing out…'; }
      const { error } = await db.auth.signOut();
      if (error) { showMessage(error.message); if (button) { button.disabled=false; button.textContent='Sign out'; } return; }
      window.location.replace('index.html');
    });
    boot().catch(error => {
      console.error('[CMDI client portal]',error);
      const loading=$('portalLoading'); if(loading) loading.hidden=true;
      const content=$('portalContent'); if(content) content.hidden=true;
      showMessage(error.message || 'Could not load your CMDI account. Please refresh or contact Front Desk.');
    });
  });
})();
