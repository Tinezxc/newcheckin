/* CMDI — Front Desk Guest QR Check-in / Check-out
   Existing client QR payload remains the Guest ID (TR-...).
   Reads the Phase 7 check-in board, then calls the existing checked-in/out RPC
   only after an explicit Front Desk confirmation.
*/
(() => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const db = () => window.supabaseClient || null;
    const state = {
        scanner: null,
        cameraRunning: false,
        busy: false,
        action: null,
        guest: null,
        room: null,
        stay: null,
        completed: false
    };

    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);

    function setMessage(message, type = '') {
        const el = $('#scannerMessage');
        el.textContent = message;
        el.className = 'qr-inline-status' + (type ? ` ${type}` : '');
    }

    function showError(title, message) {
        $('#errorTitle').textContent = title;
        $('#errorMessage').textContent = message;
        $('#errorPanel').hidden = false;
    }

    function clearError() { $('#errorPanel').hidden = true; }

    function guestIdFromPayload(decodedText) {
        const raw = String(decodedText ?? '').trim();
        if (!raw) return null;

        const direct = raw.match(/\bTR-[A-Z0-9_-]{2,50}\b/i);
        if (direct) return direct[0].toUpperCase();

        try {
            const parsed = JSON.parse(raw);
            const candidate = parsed?.guest_id ?? parsed?.guestId ?? parsed?.id ?? parsed?.data?.guest_id;
            const match = String(candidate ?? '').trim().match(/^TR-[A-Z0-9_-]{2,50}$/i);
            if (match) return match[0].toUpperCase();
        } catch (_) { /* not JSON */ }

        try {
            const url = new URL(raw);
            for (const key of ['guest_id', 'guestId', 'guest', 'id']) {
                const candidate = url.searchParams.get(key);
                const match = String(candidate ?? '').trim().match(/^TR-[A-Z0-9_-]{2,50}$/i);
                if (match) return match[0].toUpperCase();
            }
            const lastSegment = url.pathname.split('/').filter(Boolean).pop() || '';
            const pathMatch = lastSegment.match(/^TR-[A-Z0-9_-]{2,50}$/i);
            if (pathMatch) return pathMatch[0].toUpperCase();
        } catch (_) { /* not a URL */ }

        return null;
    }

    function dataCell(label, value) {
        const safeValue = value == null || value === '' ? '—' : String(value);
        return `<div class="qr-data-cell"><span>${esc(label)}</span><strong>${esc(safeValue)}</strong></div>`;
    }

    function displayDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    }

    function setBadge(text, className = '') {
        const badge = $('#actionBadge');
        badge.textContent = text;
        badge.className = 'qr-status-badge' + (className ? ` ${className}` : '');
    }

    function resetActions() {
        $('#checkinActionForm').hidden = true;
        $('#checkoutAction').hidden = true;
        $('#blockedActionNote').hidden = true;
        $('#blockedActionNote').textContent = '';
        $('#confirmCheckinBtn').disabled = false;
        $('#confirmCheckinBtn').textContent = 'Confirm check-in';
        $('#confirmCheckoutBtn').disabled = false;
        $('#confirmCheckoutBtn').textContent = 'Confirm check-out';
        state.action = null;
        state.guest = null;
        state.room = null;
        state.stay = null;
        state.completed = false;
    }

    function showBlockedGuest(title, guest, reason) {
        $('#resultTitle').textContent = title;
        setBadge('Action unavailable', 'pending');
        $('#resultContent').innerHTML = [
            dataCell('Client name', guest.full_name),
            dataCell('Guest ID', guest.guest_id),
            dataCell('Registration status', guest.registration_status),
            dataCell('Account status', guest.profile_status),
            dataCell('Requested room', guest.requested_room || guest.assigned_room || guest.room)
        ].join('');
        $('#blockedActionNote').textContent = reason;
        $('#blockedActionNote').hidden = false;
        $('#resultFootnote').textContent = 'No check-in or check-out transaction was saved.';
        $('#resultPanel').hidden = false;
    }

    function showCheckinPreview(guest, room) {
        resetActions();
        state.action = 'check-in';
        state.guest = guest;
        state.room = room;

        $('#resultTitle').textContent = 'Guest ready for check-in';
        setBadge('Check-in required', 'pending');
        $('#resultContent').innerHTML = [
            dataCell('Client name', guest.full_name),
            dataCell('Guest ID', guest.guest_id),
            dataCell('Registration status', guest.registration_status),
            dataCell('Account status', guest.profile_status),
            dataCell('Booking status', guest.booking_status),
            dataCell('Approved room', room.room_number),
            dataCell('Floor', room.floor),
            dataCell('Occupants in booking', guest.group_size || 1),
            dataCell('Room status', room.status)
        ].join('');

        const input = $('#expectedCheckoutAt');
        const now = new Date();
        const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const localValue = new Date(nextDay.getTime() - nextDay.getTimezoneOffset() * 60000)
            .toISOString().slice(0, 16);
        input.value = localValue;
        input.min = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
            .toISOString().slice(0, 16);

        $('#checkinActionForm').hidden = false;
        $('#resultFootnote').textContent = 'Review the guest and approved room. Confirming will create an active stay and mark the room Occupied.';
        $('#resultPanel').hidden = false;
    }

    function showCheckoutPreview(stay) {
        resetActions();
        state.action = 'check-out';
        state.stay = stay;

        $('#resultTitle').textContent = 'Guest currently checked in';
        setBadge('Check-out required', '');
        $('#resultContent').innerHTML = [
            dataCell('Client name', stay.full_name),
            dataCell('Guest ID', stay.guest_id),
            dataCell('Room', stay.room_number),
            dataCell('Floor', stay.floor),
            dataCell('Checked in at', displayDate(stay.checked_in_at)),
            dataCell('Expected check-out', displayDate(stay.expected_checkout_at)),
            dataCell('Occupants in stay', stay.occupants_count || 1)
        ].join('');

        $('#checkoutAction').hidden = false;
        $('#resultFootnote').textContent = 'Confirm only after the guest has completed their stay and returned the room.';
        $('#resultPanel').hidden = false;
    }

    async function lookupGuestId(guestId) {
        if (state.busy) return;
        state.busy = true;
        clearError();
        resetActions();
        $('#resultPanel').hidden = true;
        $('#manualLookupBtn').disabled = true;
        setMessage(`Checking current stay for ${guestId}…`);

        try {
            const client = db();
            if (!client) throw new Error('Supabase client is unavailable. Check js/supabase-client.js.');

            // Phase 7 returns matching arrivals, active stays, and currently eligible rooms.
            const { data, error } = await client.rpc('staff_get_checkin_board', {
                p_search: guestId
            });
            if (error) throw error;
            if (!data || data.ok !== true) throw new Error('The guest status could not be retrieved.');

            const activeStays = Array.isArray(data.active_stays) ? data.active_stays : [];
            const arrivals = Array.isArray(data.arrivals) ? data.arrivals : [];
            const normalize = value => String(value || '').trim().toUpperCase();
            const matches = rows => rows.filter(row => normalize(row.guest_id) === normalize(guestId));
            const activeMatches = matches(activeStays);
            const arrivalMatches = matches(arrivals);

            if (activeMatches.length > 1 || arrivalMatches.length > 1 || (activeMatches.length && arrivalMatches.length)) {
                throw new Error('The Guest ID has conflicting or duplicate stay records. Do not proceed; ask the Manager to review the guest records.');
            }

            if (activeMatches.length === 1) {
                showCheckoutPreview(activeMatches[0]);
                setMessage(`Active stay found for ${guestId}. Review and confirm check-out when appropriate.`, 'success');
                return;
            }

            if (!arrivalMatches.length) {
                throw new Error(`No eligible guest record was found for ${guestId}. Confirm the Guest ID, client registration, and booking status.`);
            }

            const guest = arrivalMatches[0];
            const accountStatus = String(guest.profile_status || 'active').trim().toLowerCase();
            const bookingStatus = String(guest.booking_status || '').trim().toLowerCase();

            if (['inactive', 'suspended'].includes(accountStatus)) {
                showBlockedGuest('Guest cannot be checked in', guest, 'The client account is inactive or suspended. Contact the Manager before proceeding.');
                setMessage('Guest account is not active.', 'error');
                return;
            }

            // Use the established registration QR RPC as the authoritative
            // registration check. It also detects duplicate Guest IDs. This is
            // deliberately done only for check-in; an existing guest must still
            // be able to check out even if their account/registration later changes.
            const { data: registrationData, error: registrationError } = await client.rpc('scan_client_registration_qr', {
                p_guest_id: guestId
            });
            if (registrationError) throw registrationError;
            if (!registrationData || registrationData.ok !== true) {
                const code = registrationData?.code || 'unknown';
                const registrationMessages = {
                    invalid_qr: 'The QR code does not contain a valid CMDI Guest ID.',
                    client_not_found: `No client registration was found for ${guestId}.`,
                    duplicate_guest_id: 'Duplicate Guest IDs were found. Ask the Manager to resolve the duplicate before proceeding.'
                };
                throw new Error(registrationMessages[code] || 'The client registration could not be verified.');
            }
            const verifiedClient = registrationData.client || {};
            if (String(verifiedClient.account_status || accountStatus).trim().toLowerCase() !== 'active') {
                showBlockedGuest('Guest cannot be checked in', guest, 'The client account is not active. Contact the Manager before proceeding.');
                setMessage('Guest account is not active.', 'error');
                return;
            }
            if (verifiedClient.is_registration_verified !== true) {
                showBlockedGuest('Registration needs review', guest, 'The registration record is not verified. Resolve the registration before check-in.');
                setMessage('Registration is not verified.', 'error');
                return;
            }
            guest.registration_status = 'verified';

            if (bookingStatus !== 'approved') {
                showBlockedGuest('No approved booking found', guest, 'The latest room booking is not approved. Front Desk must approve the room request before check-in.');
                setMessage('An approved room booking is required.', 'error');
                return;
            }

            const requestedRoom = String(guest.requested_room || '').trim();
            if (!requestedRoom) {
                showBlockedGuest('Approved room is missing', guest, 'The latest approved booking does not identify a room. Ask the Manager to review the booking before check-in.');
                setMessage('Approved booking has no room number.', 'error');
                return;
            }

            const availableRooms = Array.isArray(data.available_rooms) ? data.available_rooms : [];
            const roomMatches = availableRooms.filter(room => normalize(room.room_number) === normalize(requestedRoom));
            if (roomMatches.length !== 1) {
                showBlockedGuest('Approved room is not available', guest, `Room ${requestedRoom} is not currently listed as eligible for check-in. Do not force the transaction. Check the room status, capacity, reservations, and any reconciliation warning.`);
                setMessage(`Room ${requestedRoom} is not currently available for this check-in.`, 'error');
                return;
            }

            const room = roomMatches[0];
            const groupSize = Math.max(1, Number(guest.group_size) || 1);
            if (room.requires_reconciliation) {
                showBlockedGuest('Room needs reconciliation', guest, `Room ${requestedRoom} has a reconciliation warning. Ask the Manager to resolve the room record before check-in.`);
                setMessage('Room reconciliation is required.', 'error');
                return;
            }

            showCheckinPreview(guest, room);
            setMessage(`Approved booking found for ${guest.full_name || guestId}. Confirm the check-in details.`, 'success');
        } catch (error) {
            console.error('[CMDI QR Scanner] Guest status lookup failed:', error);
            showError('Guest status could not be verified', error.message || 'Unable to retrieve the guest stay.');
            setMessage('Lookup failed. Check the Guest ID or contact the Manager.', 'error');
        } finally {
            state.busy = false;
            $('#manualLookupBtn').disabled = false;
        }
    }

    async function confirmCheckin(event) {
        event.preventDefault();
        if (state.busy || state.completed || state.action !== 'check-in' || !state.guest || !state.room) return;

        const inputValue = $('#expectedCheckoutAt').value;
        const expectedDate = inputValue ? new Date(inputValue) : null;
        if (!expectedDate || Number.isNaN(expectedDate.getTime()) || expectedDate.getTime() <= Date.now()) {
            setMessage('Choose a valid expected check-out date and time in the future.', 'error');
            $('#expectedCheckoutAt').focus();
            return;
        }

        const confirm = window.confirm(
            `Confirm CHECK-IN for ${state.guest.full_name || state.guest.guest_id} to Room ${state.room.room_number}?\n\nExpected check-out: ${expectedDate.toLocaleString()}`
        );
        if (!confirm) return;

        state.busy = true;
        $('#confirmCheckinBtn').disabled = true;
        $('#confirmCheckinBtn').textContent = 'Saving check-in…';
        setMessage('Saving check-in…');
        try {
            const client = db();
            const { data, error } = await client.rpc('staff_check_in_guest', {
                p_guest_id: state.guest.id,
                p_room_id: state.room.id,
                p_expected_checkout_at: expectedDate.toISOString(),
                p_note: 'Checked in through Front Desk Guest QR Scanner'
            });
            if (error) throw error;
            if (!data || data.ok !== true) throw new Error('The database did not confirm the check-in.');

            state.completed = true;
            state.action = null;
            setBadge('Check-in complete', 'success');
            $('#resultTitle').textContent = 'Guest successfully checked in';
            $('#checkinActionForm').hidden = true;
            $('#resultFootnote').textContent = `Check-in saved. Stay reference: ${data.stay_id || 'created'}. Room ${data.room_number || state.room.room_number} is now updated by the system.`;
            setMessage(`Check-in completed for ${state.guest.full_name || state.guest.guest_id}.`, 'success');
        } catch (error) {
            console.error('[CMDI QR Scanner] Check-in failed:', error);
            showError('Check-in was not completed', error.message || 'The check-in could not be saved.');
            setMessage('Check-in failed. No success was reported by the database.', 'error');
            $('#confirmCheckinBtn').disabled = false;
            $('#confirmCheckinBtn').textContent = 'Retry check-in';
        } finally {
            state.busy = false;
        }
    }

    async function confirmCheckout() {
        if (state.busy || state.completed || state.action !== 'check-out' || !state.stay?.stay_id) return;

        const confirm = window.confirm(
            `Confirm CHECK-OUT for ${state.stay.full_name || state.stay.guest_id} from Room ${state.stay.room_number}?\n\nThis will complete the active stay.`
        );
        if (!confirm) return;

        state.busy = true;
        $('#confirmCheckoutBtn').disabled = true;
        $('#confirmCheckoutBtn').textContent = 'Saving check-out…';
        setMessage('Saving check-out…');
        try {
            const client = db();
            const { data, error } = await client.rpc('staff_check_out_guest', {
                p_stay_id: state.stay.stay_id,
                p_note: 'Checked out through Front Desk Guest QR Scanner'
            });
            if (error) throw error;
            if (!data || data.ok !== true) throw new Error('The database did not confirm the check-out.');

            state.completed = true;
            state.action = null;
            setBadge('Check-out complete', 'success');
            $('#resultTitle').textContent = 'Guest successfully checked out';
            $('#checkoutAction').hidden = true;
            $('#resultFootnote').textContent = `Check-out saved. Room ${data.room_number || state.stay.room_number} status: ${data.room_status || 'updated'}.`;
            setMessage(`Check-out completed for ${state.stay.full_name || state.stay.guest_id}.`, 'success');
        } catch (error) {
            console.error('[CMDI QR Scanner] Check-out failed:', error);
            showError('Check-out was not completed', error.message || 'The check-out could not be saved.');
            setMessage('Check-out failed. No success was reported by the database.', 'error');
            $('#confirmCheckoutBtn').disabled = false;
            $('#confirmCheckoutBtn').textContent = 'Retry check-out';
        } finally {
            state.busy = false;
        }
    }

    async function stopCamera({ silent = false } = {}) {
        if (state.scanner && state.cameraRunning) {
            try { await state.scanner.stop(); }
            catch (error) { console.warn('[CMDI QR Scanner] Camera stop:', error); }
        }
        state.cameraRunning = false;
        $('#startCameraBtn').disabled = false;
        $('#stopCameraBtn').disabled = true;
        $('#readerPlaceholder').hidden = false;
        $('#cameraStatus').classList.remove('is-live');
        $('#cameraStatus').innerHTML = '<span></span> Camera stopped';
        if (!silent) setMessage('Camera stopped. Restart it or enter the Guest ID manually.');
    }

    async function handleDecodedPayload(decodedText) {
        if (state.busy || !state.cameraRunning) return;
        await stopCamera({ silent: true });
        const guestId = guestIdFromPayload(decodedText);
        if (!guestId) {
            showError('Unsupported QR format', 'The scanned code does not contain a CMDI Guest ID (TR-…). You can enter the Guest ID manually.');
            setMessage('Scanned code is not a CMDI Guest ID.', 'error');
            return;
        }
        await lookupGuestId(guestId);
    }

    async function startCamera() {
        clearError();
        if (!window.Html5Qrcode) {
            setMessage('QR scanner library did not load. Use image upload or manual Guest ID lookup.', 'error');
            return;
        }
        if (state.cameraRunning) return;

        $('#startCameraBtn').disabled = true;
        setMessage('Requesting camera access…');
        try {
            if (!state.scanner) {
                state.scanner = new Html5Qrcode('qrReader', {
                    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
                    verbose: false
                });
            }

            let cameraId = $('#cameraSelect').value;
            const cameras = await Html5Qrcode.getCameras();
            if (!cameras || cameras.length === 0) throw new Error('No camera was detected. Check browser camera permission or use image upload.');

            const select = $('#cameraSelect');
            if (select.options.length <= 1) {
                cameras.forEach((camera, index) => {
                    const option = document.createElement('option');
                    option.value = camera.id;
                    option.textContent = camera.label || `Camera ${index + 1}`;
                    select.appendChild(option);
                });
            }
            if (!cameraId) {
                const preferred = cameras.find(camera => /back|rear|environment|world/i.test(camera.label || ''));
                cameraId = preferred?.id || cameras[0].id;
                select.value = cameraId;
            }

            state.cameraRunning = true;
            await state.scanner.start(
                cameraId,
                { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
                handleDecodedPayload,
                () => { /* No QR in this frame; keep scanning. */ }
            );
            $('#readerPlaceholder').hidden = true;
            $('#startCameraBtn').disabled = true;
            $('#stopCameraBtn').disabled = false;
            $('#cameraStatus').classList.add('is-live');
            $('#cameraStatus').innerHTML = '<span></span> Camera active';
            setMessage('Point the camera at the client QR code.');
        } catch (error) {
            console.error('[CMDI QR Scanner] Camera start failed:', error);
            state.cameraRunning = false;
            $('#startCameraBtn').disabled = false;
            $('#stopCameraBtn').disabled = true;
            setMessage(error.message || 'Could not start the camera. Use image upload or manual Guest ID lookup.', 'error');
        }
    }

    async function scanImage(file) {
        if (!file) return;
        clearError();
        if (!window.Html5Qrcode) {
            setMessage('QR scanner library did not load. Use manual Guest ID lookup.', 'error');
            return;
        }
        try {
            await stopCamera({ silent: true });
            if (!state.scanner) {
                state.scanner = new Html5Qrcode('qrReader', {
                    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
                    verbose: false
                });
            }
            setMessage('Reading QR from image…');
            const decodedText = await state.scanner.scanFile(file, true);
            await state.scanner.clear();
            state.scanner = null;
            const guestId = guestIdFromPayload(decodedText);
            if (!guestId) throw new Error('This image does not contain a CMDI Guest ID QR code.');
            await lookupGuestId(guestId);
        } catch (error) {
            if (state.scanner && !state.cameraRunning) {
                try { await state.scanner.clear(); } catch (_) { /* already cleared */ }
                state.scanner = null;
            }
            console.error('[CMDI QR Scanner] Image scan failed:', error);
            showError('Could not read this image', error.message || 'Choose a clear photo of the client QR code.');
            setMessage('Try a clearer image or enter the Guest ID manually.', 'error');
        } finally {
            $('#qrImageInput').value = '';
        }
    }

    function bindEvents() {
        const menuButton = $('#menuToggle');
        const sidebar = $('#sidebar');
        const overlay = $('#sidebarOverlay');
        const setMenu = open => {
            sidebar.classList.toggle('open', open);
            overlay.classList.toggle('open', open);
            menuButton.setAttribute('aria-expanded', String(open));
        };
        menuButton.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));
        overlay.addEventListener('click', () => setMenu(false));

        $('#startCameraBtn').addEventListener('click', startCamera);
        $('#stopCameraBtn').addEventListener('click', () => stopCamera());
        $('#qrImageInput').addEventListener('change', event => scanImage(event.target.files?.[0]));
        $('#manualLookupForm').addEventListener('submit', async event => {
            event.preventDefault();
            const guestId = guestIdFromPayload($('#manualGuestId').value);
            if (!guestId) {
                setMessage('Enter a valid Guest ID such as TR-0001.', 'error');
                $('#manualGuestId').focus();
                return;
            }
            await stopCamera({ silent: true });
            await lookupGuestId(guestId);
        });
        $('#checkinActionForm').addEventListener('submit', confirmCheckin);
        $('#confirmCheckoutBtn').addEventListener('click', confirmCheckout);
        $('#scanNextBtn').addEventListener('click', () => {
            $('#resultPanel').hidden = true;
            $('#manualGuestId').value = '';
            resetActions();
            setMessage('Ready for the next guest.');
            startCamera();
        });
        $('#dismissErrorBtn').addEventListener('click', clearError);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') setMenu(false);
        });
        window.addEventListener('beforeunload', () => {
            if (state.scanner && state.cameraRunning) state.scanner.stop().catch(() => {});
        });
    }

    async function init() {
        bindEvents();
        if (window.RBAC?.ready) await window.RBAC.ready;
        if (!window.RBAC?.realRole?.()) {
            setMessage('An active CMDI staff session is required.', 'error');
            return;
        }
        if (window.RBAC.realRole() !== 'front-desk' || !window.RBAC.can('registration.scan')) {
            setMessage('QR Check-in / Check-out is available to Front Desk staff only.', 'error');
            window.RBAC.guardPage('scanner');
            return;
        }
        if (!window.RBAC.init({ active: 'scanner' })) return;
        setMessage('Start the camera, upload a QR image, or enter a Guest ID manually.');
        if (!window.isSecureContext) {
            setMessage('Camera access requires HTTPS. Open the Vercel HTTPS site or use image upload/manual lookup.', 'error');
        }
    }

    init().catch(error => {
        console.error('[CMDI QR Scanner] Initialization failed:', error);
        setMessage(error.message || 'Could not initialize QR Scanner.', 'error');
    });
})();
