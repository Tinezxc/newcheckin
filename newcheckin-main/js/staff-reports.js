/* ==========================================================
   CMDI PHASE 6 — LIVE MANAGER REPORTS + AUDIT TRAIL
   Uses manager-only SECURITY DEFINER RPCs. No demo/sample data.
   ========================================================== */
(() => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const db = () => window.supabaseClient || null;

    const state = {
        start: null,
        end: null,
        reports: null,
        auditEntries: [],
        auditTotal: 0,
        auditOffset: 0,
        auditLimit: 50,
        auditSearch: '',
        loading: false,
        auditLoading: false,
        searchTimer: null
    };

    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
    const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const fmtDate = value => {
        if (!value) return '—';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    };
    const fmtDateTime = value => {
        if (!value) return '—';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    };
    const dateLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    function toast(type, title, message) {
        const container = $('#toastContainer');
        if (!container) { console[type === 'error' ? 'error' : 'log'](`${title}: ${message}`); return; }
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const strong = document.createElement('strong');
        strong.textContent = title;
        const span = document.createElement('span');
        span.textContent = message || '';
        el.append(strong, span);
        container.appendChild(el);
        setTimeout(() => el.remove(), 3800);
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value == null ? '—' : String(value);
    }

    function setHtml(id, html) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function setBody(id, rows, columns, emptyMessage = 'No records for this date range.') {
        const body = document.getElementById(id);
        if (!body) return;
        if (!Array.isArray(rows) || rows.length === 0) {
            body.innerHTML = `<tr><td colspan="${columns}" class="phase6-empty-cell">${esc(emptyMessage)}</td></tr>`;
            return;
        }
        body.innerHTML = rows.map(row => `<tr>${row.map(cell => `<td>${cell == null || cell === '' ? '—' : cell}</td>`).join('')}</tr>`).join('');
    }

    function statusLabel(value) {
        return String(value || 'unknown').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function emptyChart(el, message) {
        if (el) el.innerHTML = `<div class="phase6-empty">${esc(message)}</div>`;
    }

    function renderBars(el, rows, labelKey, valueKey) {
        if (!el) return;
        if (!rows?.length) { emptyChart(el, 'No records for this date range.'); return; }
        const max = Math.max(1, ...rows.map(row => num(row[valueKey])));
        el.innerHTML = `<div class="phase6-chart-list">${rows.map(row => {
            const value = num(row[valueKey]);
            const pct = Math.max(0, Math.min(100, value / max * 100));
            return `<div class="phase6-chart-row"><div class="phase6-chart-meta"><span>${esc(statusLabel(row[labelKey]))}</span><strong>${value}</strong></div><div class="phase6-chart-track"><span style="width:${pct}%"></span></div></div>`;
        }).join('')}</div>`;
    }

    function buildRoomStatusRows(rooms) {
        const keys = [
            ['occupied','Occupied'], ['vacant_clean','Vacant clean'], ['vacant_dirty','Vacant dirty'],
            ['cleaning','Cleaning'], ['maintenance','Maintenance'], ['reserved','Reserved'], ['overdue','Overdue']
        ];
        return keys.map(([key,label]) => ({ status: label, total: num(rooms?.[key]) }));
    }

    function renderKpis(data) {
        const rooms = data.rooms || {};
        const profiles = data.profiles || {};
        const booking = data.booking_reviews || {};
        const requests = data.service_requests || {};
        const workflow = data.service_workflow || {};
        const orders = data.room_work_orders || {};

        const occupancy = num(rooms.occupancy_pct);
        setHtml('kpiOcc', `${occupancy}<span class="kpi-suffix">%</span>`);
        setText('kpiOccChange', `${num(rooms.occupied_or_overdue ?? rooms.occupied)} occupied / overdue of ${num(rooms.total)} rooms`);

        setHtml('kpiAlos', `${num(profiles.active_clients)}<span class="kpi-suffix"> clients</span>`);
        setText('kpiAlosChange', `${num(profiles.total_clients)} client accounts in total`);

        setHtml('kpiOverdue', `${num(booking.pending)}<span class="kpi-suffix"> pending</span>`);
        setText('kpiOverdueChange', `${num(booking.total)} booking reviews in selected period`);

        setHtml('kpiResponse', `${num(requests.total)}<span class="kpi-suffix"> requests</span>`);
        setText('kpiResponseChange', 'Created in selected date range');

        const openTasks = num(workflow.pending) + num(workflow.assigned) + num(workflow.in_progress);
        const openRoomOrders = num(orders.in_progress);
        setHtml('kpiSla', `${openTasks + openRoomOrders}<span class="kpi-suffix"> open</span>`);
        setText('kpiSlaChange', `${openTasks} service tasks · ${openRoomOrders} room work orders`);

        setText('kpiOos', num(rooms.unavailable));
        setText('kpiOosChange', `${num(rooms.maintenance)} maintenance · ${num(rooms.cleaning)} cleaning`);
    }

    function renderOverview(data) {
        const rooms = data.rooms || {};
        const byFloor = rooms.by_floor || [];
        const checkinDays = data.checkins?.by_day || [];
        const requestsByType = data.service_requests_by_type || [];
        const roomStatusRows = buildRoomStatusRows(rooms);

        renderBars($('#chartOccupancy'), byFloor.map(row => ({ label: `Floor ${row.floor}`, value: num(row.total) })), 'label', 'value');
        setBody('tableOccupancyBody', byFloor.map(row => [
            `Floor ${esc(row.floor)}`, num(row.total), num(row.occupied), num(row.vacant_clean)
        ]), 4);

        renderBars($('#chartArrivals'), checkinDays.map(row => ({ label: fmtDate(row.date), value: num(row.checkins) })), 'label', 'value');
        setBody('tableArrivalsBody', checkinDays.map(row => [fmtDate(row.date), num(row.checkins)]), 2);

        renderBars($('#chartRequests'), requestsByType.map(row => ({ label: statusLabel(row.type), value: num(row.total) })), 'label', 'value');
        setBody('tableRequestsBody', requestsByType.map(row => [statusLabel(row.type), num(row.total)]), 2);

        renderBars($('#chartMix'), roomStatusRows.map(row => ({ label: row.status, value: row.total })), 'label', 'value');
        setBody('tableMixBody', roomStatusRows.map(row => [esc(row.status), row.total]), 2);
    }

    function renderOccupancy(data) {
        const floors = data.rooms?.by_floor || [];
        setBody('floorStatusBody', floors.map(row => [
            `Floor ${esc(row.floor)}`, num(row.total), num(row.occupied), num(row.vacant_clean),
            num(row.vacant_dirty), num(row.cleaning), num(row.maintenance), num(row.reserved), num(row.overdue)
        ]), 9, 'No room records found.');
        setText('roomSnapshotTotal', num(data.rooms?.total));
        setText('roomSnapshotRate', `${num(data.rooms?.occupancy_pct)}%`);
    }

    function renderCheckins(data) {
        const rows = data.checkins?.by_day || [];
        setBody('checkinDailyBody', rows.map(row => [fmtDate(row.date), num(row.checkins)]), 2);
        setText('checkinTotal', num(data.checkins?.total_checkins));
        const booking = data.booking_reviews || {};
        setBody('bookingStatusBody', [
            ['Pending', num(booking.pending)], ['Approved', num(booking.approved)], ['Rejected', num(booking.rejected)]
        ], 2);
        const groups = data.group_bookings || {};
        setBody('groupBookingStatusBody', [
            ['Inviting', num(groups.inviting)], ['Ready', num(groups.ready)], ['Confirmed', num(groups.confirmed)],
            ['Completed', num(groups.completed)], ['Expired', num(groups.expired)], ['Cancelled', num(groups.cancelled)]
        ], 2);
        setText('departureAvailabilityNote', 'Checkout date/history is not stored in the current schema; departures are not calculated.');
    }

    function renderRequests(data) {
        const byType = data.service_requests_by_type || [];
        setBody('requestTypeBody', byType.map(row => [
            esc(statusLabel(row.type)), num(row.total), num(row.pending), num(row.in_progress), num(row.done), num(row.rejected)
        ]), 6);
        const workload = data.workload_by_staff || [];
        setBody('workloadBody', workload.map(row => [
            esc(row.staff_name), esc(statusLabel(row.staff_role)), num(row.assigned), num(row.in_progress), num(row.completed)
        ]), 5, 'No assigned workflow records for this date range.');
    }

    function renderHousekeeping(data) {
        const rows = data.housekeeping_by_staff || [];
        setBody('housekeepingBody', rows.map(row => [
            esc(row.staff_name), esc(statusLabel(row.work_type)), num(row.started), num(row.completed),
            num(row.in_progress), row.avg_minutes == null ? '—' : `${num(row.avg_minutes)} min`
        ]), 6, 'No housekeeping or maintenance work orders recorded for this date range.');
    }

    function renderGuests(data) {
        const institutions = data.institutions || [];
        setBody('institutionBody', institutions.map(row => [esc(row.institution), num(row.clients)]), 2,
            'No client institution data is available.');
        const registrations = data.registrations || {};
        setBody('registrationStatusBody', [
            ['Pending', num(registrations.pending)], ['Verified', num(registrations.verified)], ['Other statuses', num(registrations.other)]
        ], 2);
        const roles = data.profiles?.by_role_status || [];
        setBody('roleStatusBody', roles.map(row => [esc(statusLabel(row.role)), esc(statusLabel(row.status)), num(row.total)]), 3,
            'No profile accounts found.');
    }

    function renderMeta(data) {
        const meta = data.meta || {};
        setText('rangeLabel', `${fmtDate(meta.start_date)} – ${fmtDate(meta.end_date)}`);
        const stamp = meta.generated_at ? fmtDateTime(meta.generated_at) : fmtDateTime(new Date());
        setText('dataAsOf', `Live data · generated ${stamp}`);
        setText('reportLimitations', 'Average stay, departures, request response time, and SLA are not calculated because the current database does not store checkout timestamps, first-response timestamps, or SLA targets.');
    }

    async function loadReports({ quiet = false } = {}) {
        if (state.loading) return;
        const client = db();
        if (!client) { toast('error','Reports unavailable','Supabase client is not initialized.'); return; }
        state.loading = true;
        if (!quiet) setText('dataAsOf', 'Loading live report data…');
        try {
            const { data, error } = await client.rpc('get_manager_reports', {
                p_start_date: state.start,
                p_end_date: state.end
            });
            if (error) throw error;
            if (!data?.ok) throw new Error(data?.message || 'The reporting function returned no data.');
            state.reports = data;
            renderKpis(data);
            renderOverview(data);
            renderOccupancy(data);
            renderCheckins(data);
            renderRequests(data);
            renderHousekeeping(data);
            renderGuests(data);
            renderMeta(data);
        } catch (error) {
            console.error('[CMDI Manager Reports] Load failed:', error);
            if (!quiet) toast('error','Unable to load reports',error.message || 'Check the Phase 6 SQL migration and Manager access.');
            setText('dataAsOf', 'Live report data could not be loaded.');
        } finally {
            state.loading = false;
        }
    }

    function auditBounds() {
        const startDate = state.start || dateLocal(new Date(Date.now() - 6 * 86400000));
        const endDate = state.end || dateLocal(new Date());
        const start = new Date(`${startDate}T00:00:00`);
        const endExclusive = new Date(`${endDate}T00:00:00`);
        endExclusive.setDate(endExclusive.getDate() + 1);
        return { from: start.toISOString(), to: endExclusive.toISOString() };
    }

    async function loadAudit({ reset = true } = {}) {
        if (state.auditLoading) return;
        state.auditLoading = true;
        if (reset) state.auditOffset = 0;
        const { from, to } = auditBounds();
        try {
            const { data, error } = await db().rpc('get_manager_audit_logs', {
                p_search: state.auditSearch || null,
                p_from: from,
                p_to: to,
                p_limit: state.auditLimit,
                p_offset: state.auditOffset
            });
            if (error) throw error;
            state.auditTotal = num(data?.total);
            const entries = Array.isArray(data?.entries) ? data.entries : [];
            state.auditEntries = reset ? entries : [...state.auditEntries, ...entries];
            renderAudit();
        } catch (error) {
            console.error('[CMDI Audit Trail] Load failed:', error);
            setBody('auditBody', [], 5, 'Audit records could not be loaded.');
            toast('error','Audit Trail unavailable',error.message || 'Check Manager access and the Phase 6 migration.');
        } finally {
            state.auditLoading = false;
        }
    }

    function renderAudit() {
        const rows = state.auditEntries || [];
        setBody('auditBody', rows.map(row => [
            esc(row.actor_name || 'Unknown'),
            `${esc(row.action)}${row.actor_role ? `<span class="phase6-muted">${esc(statusLabel(row.actor_role))}</span>` : ''}`,
            esc([row.target_type, row.target_id].filter(Boolean).join(' · ') || '—'),
            esc(row.reason || '—'),
            fmtDateTime(row.created_at)
        ]), 5, state.auditSearch ? 'No matching audit entries.' : 'No audit records have been recorded yet.');
        setText('auditCount', `${rows.length} of ${state.auditTotal} audit records`);
        const more = $('#auditLoadMore');
        if (more) more.hidden = rows.length >= state.auditTotal;
    }

    function csvCell(value) {
        let text = String(value ?? '');
        if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    }

    function downloadCsv(filename, rows) {
        const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    async function recordExport(format, target) {
        try {
            const { error } = await db().rpc('log_audit', {
                p_action: 'manager_report_exported',
                p_target_type: 'report',
                p_target_id: target,
                p_reason: `Manager exported report as ${format.toUpperCase()}`,
                p_details: { format, start_date: state.start, end_date: state.end }
            });
            if (error) console.warn('[CMDI Reports] Export audit event was not recorded:', error.message);
        } catch (error) {
            console.warn('[CMDI Reports] Export audit event failed:', error);
        }
    }

    async function exportReports() {
        if (!state.reports) { toast('error','Nothing to export','Load report data first.'); return; }
        const d = state.reports;
        const rows = [
            ['CMDI Manager Reports'], ['Start date', state.start], ['End date', state.end], ['Generated at', d.meta?.generated_at || ''], [],
            ['Room inventory'], ['Metric','Count'],
            ...Object.entries({ total:d.rooms?.total, occupied:d.rooms?.occupied, vacant_clean:d.rooms?.vacant_clean, vacant_dirty:d.rooms?.vacant_dirty, cleaning:d.rooms?.cleaning, maintenance:d.rooms?.maintenance, reserved:d.rooms?.reserved, overdue:d.rooms?.overdue, occupancy_pct:d.rooms?.occupancy_pct }),
            [], ['Profiles'], ['Metric','Count'],
            ...Object.entries({total_accounts:d.profiles?.total_accounts,total_clients:d.profiles?.total_clients,active_clients:d.profiles?.active_clients,active_staff:d.profiles?.active_staff}),
            ['Role','Status','Accounts'],
            ...(d.profiles?.by_role_status || []).map(x => [x.role,x.status,x.total]),
            [], ['Booking reviews'], ['Metric','Count'],
            ...Object.entries(d.booking_reviews || {}),
            [], ['Group bookings'], ['Metric','Count'],
            ...Object.entries(d.group_bookings || {}),
            [], ['Registrations'], ['Metric','Count'],
            ...Object.entries(d.registrations || {}),
            [], ['Service requests'], ['Metric','Count'],
            ...Object.entries(d.service_requests || {}),
            [], ['Service request workflow'], ['Metric','Count'],
            ...Object.entries(d.service_workflow || {}),
            [], ['Room work orders'], ['Metric','Count'],
            ...Object.entries(d.room_work_orders || {}),
            [], ['Service requests by type'], ['Type','Total','Pending','In progress','Done','Rejected'],
            ...(d.service_requests_by_type || []).map(x => [x.type,x.total,x.pending,x.in_progress,x.done,x.rejected]),
            [], ['Workload by staff'], ['Staff','Role','Assigned','In progress','Completed'],
            ...(d.workload_by_staff || []).map(x => [x.staff_name,x.staff_role,x.assigned,x.in_progress,x.completed]),
            [], ['Housekeeping / maintenance activity'], ['Staff','Work type','Started','Completed','In progress','Average minutes'],
            ...(d.housekeeping_by_staff || []).map(x => [x.staff_name,x.work_type,x.started,x.completed,x.in_progress,x.avg_minutes]),
            [], ['Check-ins by day'], ['Date','Check-ins'],
            ...(d.checkins?.by_day || []).map(x => [x.date,x.checkins])
        ];
        downloadCsv(`cmdi-manager-reports-${state.start}-to-${state.end}.csv`, rows);
        await recordExport('csv', `manager-reports:${state.start}:${state.end}`);
        await loadAudit({ reset: true });
        toast('success','CSV exported','Live aggregate report data downloaded.');
    }

    function setDateRange(kind) {
        const today = new Date();
        const end = dateLocal(today);
        const startDate = new Date(today);
        let label = 'Last 7 days';
        if (kind === '1') { label = 'Today'; }
        else if (kind === '7') { startDate.setDate(startDate.getDate() - 6); label = 'Last 7 days'; }
        else if (kind === '30') { startDate.setDate(startDate.getDate() - 29); label = 'Last 30 days'; }
        else if (kind === 'month') { startDate.setDate(1); label = 'This month'; }
        else return;
        state.start = dateLocal(startDate);
        state.end = end;
        setText('rangeLabel', label);
        const chipLabel = $('.chip-label', $('#rangeBtn'));
        if (chipLabel) chipLabel.textContent = label;
        loadReports();
        loadAudit();
    }

    function bindUI() {
        // Tabs.
        $$('.tab').forEach(tab => tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            $$('.tab').forEach(item => {
                const active = item === tab;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', String(active));
            });
            $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === target));
            if (target === 'audit' && state.auditEntries.length === 0) loadAudit();
        }));

        // Range dropdown.
        const rangeBtn = $('#rangeBtn');
        const rangeMenu = $('#rangeMenu');
        rangeBtn?.addEventListener('click', event => {
            event.stopPropagation();
            rangeMenu.hidden = !rangeMenu.hidden;
            rangeBtn.setAttribute('aria-expanded', String(!rangeMenu.hidden));
        });
        $$('[data-range]').forEach(button => button.addEventListener('click', () => {
            rangeMenu.hidden = true;
            setDateRange(button.dataset.range);
        }));

        // Export dropdown.
        const exportBtn = $('#exportBtn');
        const exportMenu = $('#exportMenu');
        exportBtn?.addEventListener('click', event => {
            event.stopPropagation();
            exportMenu.hidden = !exportMenu.hidden;
            exportBtn.setAttribute('aria-expanded', String(!exportMenu.hidden));
        });
        $$('[data-export]').forEach(button => button.addEventListener('click', async () => {
            exportMenu.hidden = true;
            if (button.dataset.export === 'csv') await exportReports();
            else if (button.dataset.export === 'print') window.print();
        }));
        document.addEventListener('click', () => {
            if (rangeMenu) rangeMenu.hidden = true;
            if (exportMenu) exportMenu.hidden = true;
        });

        $('#refreshReportsBtn')?.addEventListener('click', () => {
            loadReports();
            loadAudit();
        });

        // Chart/table toggles.
        $$('[data-view="table"]').forEach(button => button.addEventListener('click', () => {
            const key = button.dataset.chart;
            const chart = document.getElementById('chart' + key.charAt(0).toUpperCase() + key.slice(1));
            const table = document.getElementById('table' + key.charAt(0).toUpperCase() + key.slice(1));
            if (!chart || !table) return;
            const showTable = table.hidden;
            table.hidden = !showTable;
            chart.hidden = showTable;
            button.textContent = showTable ? 'View as chart' : 'View as table';
        }));

        // KPI cards navigate to relevant report tabs.
        const kpiTab = { occupancy:'occupancy', alos:'guests', overdue:'checkins', response:'requests', sla:'requests', oos:'occupancy' };
        $$('.kpi-card[data-kpi]').forEach(card => card.addEventListener('click', () => {
            const target = kpiTab[card.dataset.kpi];
            const tab = $(`.tab[data-tab="${target}"]`);
            tab?.click();
        }));

        // Audit search with server-side filtering.
        $('#auditSearch')?.addEventListener('input', event => {
            clearTimeout(state.searchTimer);
            state.searchTimer = setTimeout(() => {
                state.auditSearch = event.target.value.trim();
                loadAudit({ reset: true });
            }, 300);
        });
        $('#auditLoadMore')?.addEventListener('click', () => {
            state.auditOffset += state.auditLimit;
            loadAudit({ reset: false });
        });
        $('#auditExportBtn')?.addEventListener('click', async () => {
            if (!state.auditEntries.length) { toast('info','No audit entries','There are no audit rows to export yet.'); return; }
            const rows = [['Staff','Role','Action','Target type','Target ID','Reason','Time'],
                ...state.auditEntries.map(x => [x.actor_name,x.actor_role,x.action,x.target_type,x.target_id,x.reason,x.created_at])];
            downloadCsv(`cmdi-audit-log-page-${Math.floor(state.auditOffset / state.auditLimit) + 1}.csv`, rows);
            await recordExport('csv', `audit-log-page:${state.auditOffset}`);
            await loadAudit({ reset: true });
            toast('success','Audit page exported',`${state.auditEntries.length} visible audit records downloaded.`);
        });

        // Drawer.
        const overlay = $('#drillOverlay');
        const drawer = $('#drillDrawer');
        const closeDrawer = () => {
            drawer?.classList.remove('open');
            overlay?.classList.remove('open');
            setTimeout(() => { if (drawer) drawer.hidden = true; if (overlay) overlay.hidden = true; }, 220);
            document.body.style.overflow = '';
        };
        $('#drillClose')?.addEventListener('click', closeDrawer);
        overlay?.addEventListener('click', closeDrawer);

        // Mobile sidebar.
        const toggle = $('#menuToggle');
        const sidebar = $('#sidebar');
        const sidebarOverlay = $('#sidebarOverlay');
        const closeSidebar = () => {
            sidebar?.classList.remove('open');
            sidebarOverlay?.classList.remove('open');
            toggle?.setAttribute('aria-expanded','false');
        };
        toggle?.addEventListener('click', () => {
            const open = sidebar.classList.toggle('open');
            sidebarOverlay?.classList.toggle('open', open);
            toggle?.setAttribute('aria-expanded', String(open));
        });
        sidebarOverlay?.addEventListener('click', closeSidebar);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') { closeSidebar(); closeDrawer(); }
        });
    }

    async function init() {
        bindUI();
        if (!window.RBAC) throw new Error('CMDI RBAC is not loaded.');
        if (window.RBAC.ready) await window.RBAC.ready;
        if (!window.RBAC.init({ active: 'reports' })) return;
        const actualRole = String(window.RBAC.realRole() || '').toLowerCase();
        if (actualRole !== 'manager' || !window.RBAC.can('reports.view')) return;
        const roleLabel = actualRole.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        setText('assignedRoleValue', roleLabel);
        setText('staffRoleLabel', roleLabel);
        setText('roleBreadcrumb', roleLabel);
        if (!db()) throw new Error('Supabase client is unavailable.');

        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 6);
        state.start = dateLocal(start);
        state.end = dateLocal(today);
        setText('rangeLabel', 'Last 7 days');
        const chipLabel = $('.chip-label', $('#rangeBtn'));
        if (chipLabel) chipLabel.textContent = 'Last 7 days';
        await loadReports();
        await loadAudit();
        state.refreshTimer = setInterval(() => loadReports({ quiet: true }), 60000);
        window.addEventListener('beforeunload', () => clearInterval(state.refreshTimer), { once: true });
    }

    init().catch(error => {
        console.error('[CMDI Manager Reports] Initialization failed:', error);
        toast('error','Reports could not start',error.message || 'Please reload the page.');
    });
})();
