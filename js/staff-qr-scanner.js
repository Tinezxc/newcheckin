/* CMDI — Client Registration QR Scanner
   Camera/file/manual QR decode -> protected read-only registration lookup.
*/
(() => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const db = () => window.supabaseClient || null;
    const state = { scanner: null, cameraRunning: false, busy: false, currentGuestId: null };

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

        // Existing client QR is generated from profiles.guest_id via openQR(guest_id, full_name).
        const direct = raw.match(/\bTR-[A-Z0-9_-]{2,50}\b/i);
        if (direct) return direct[0].toUpperCase();

        // Also accept a small JSON payload such as {"guest_id":"TR-0001"}.
        try {
            const parsed = JSON.parse(raw);
            const candidate = parsed?.guest_id ?? parsed?.guestId ?? parsed?.id ?? parsed?.data?.guest_id;
            const match = String(candidate ?? '').trim().match(/^TR-[A-Z0-9_-]{2,50}$/i);
            if (match) return match[0].toUpperCase();
        } catch (_) { /* not JSON */ }

        // Also accept URLs that carry the Guest ID as a query parameter or final path segment.
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

    function registrationLabel(client) {
        if (client.account_status !== 'active') return { text: 'Account inactive', className: 'inactive' };
        if (client.is_registration_verified) return { text: 'Registration verified', className: '' };
        return { text: 'Needs review', className: 'pending' };
    }

    function dataCell(label, value) {
        const safeValue = value == null || value === '' ? '—' : String(value);
        return `<div class="qr-data-cell"><span>${esc(label)}</span><strong>${esc(safeValue)}</strong></div>`;
    }

    function renderClient(client) {
        const status = registrationLabel(client);
        $('#registrationBadge').textContent = status.text;
        $('#registrationBadge').className = 'qr-status-badge' + (status.className ? ` ${status.className}` : '');

        const checkIn = client.check_in
            ? new Date(`${client.check_in}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
            : '—';

        $('#resultContent').innerHTML = [
            dataCell('Client name', client.full_name),
            dataCell('Guest ID', client.guest_id),
            dataCell('Registration reference', client.registration_reference),
            dataCell('Registration ID', client.registration_id),
            dataCell('Registration status', client.registration_status),
            dataCell('Account status', client.account_status),
            dataCell('Check-in date', checkIn),
            dataCell('Room', client.room)
        ].join('');

        $('#resultFootnote').textContent = client.is_registration_verified
            ? 'Registration is verified. This scanner does not perform check-in or change room assignments.'
            : 'The client record was found, but registration is not marked verified. Review the registration record before proceeding.';
        $('#resultPanel').hidden = false;
        $('#errorPanel').hidden = true;
        state.currentGuestId = client.guest_id;
    }

    async function lookupGuestId(guestId) {
        if (state.busy) return;
        state.busy = true;
        clearError();
        $('#resultPanel').hidden = true;
        setMessage(`Looking up ${guestId}…`);
        $('#manualLookupBtn').disabled = true;

        try {
            const client = db();
            if (!client) throw new Error('Supabase client is unavailable. Check js/supabase-client.js.');

            const { data, error } = await client.rpc('scan_client_registration_qr', {
                p_guest_id: guestId
            });
            if (error) throw error;

            if (!data || data.ok !== true) {
                const messages = {
                    invalid_qr: 'The QR code does not contain a valid CMDI Guest ID.',
                    client_not_found: `No client registration was found for ${guestId}.`,
                    duplicate_guest_id: `More than one client record uses ${guestId}. Ask the Manager to resolve the duplicate before proceeding.`
                };
                const code = data?.code || 'unknown';
                throw new Error(messages[code] || 'The registration QR could not be verified.');
            }

            renderClient(data.client || {});
            setMessage(`Client ${data.client?.guest_id || guestId} found.`, 'success');
        } catch (error) {
            console.error('[CMDI QR Scanner] Lookup failed:', error);
            showError('QR could not be verified', error.message || 'Unable to retrieve the client registration.');
            setMessage('Lookup failed. Check the QR code or enter the Guest ID manually.', 'error');
        } finally {
            state.busy = false;
            $('#manualLookupBtn').disabled = false;
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
        if (!silent) setMessage('Camera stopped. You can restart it or use manual Guest ID lookup.');
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
            if (!cameras || cameras.length === 0) throw new Error('No camera was detected. Check your browser camera permission or use image upload.');

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
                async decodedText => {
                    if (state.busy || !state.cameraRunning) return;
                    await stopCamera({ silent: true });
                    const guestId = guestIdFromPayload(decodedText);
                    if (!guestId) {
                        showError('Unsupported QR format', 'The scanned code does not contain a CMDI Guest ID (TR-…). You can enter the Guest ID manually.');
                        setMessage('Scanned code is not a CMDI Guest ID.', 'error');
                        return;
                    }
                    await lookupGuestId(guestId);
                },
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
        $('#scanNextBtn').addEventListener('click', () => {
            $('#resultPanel').hidden = true;
            $('#manualGuestId').value = '';
            state.currentGuestId = null;
            setMessage('Ready for the next client.');
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
            setMessage('QR Scanner is available to Front Desk staff only.', 'error');
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
