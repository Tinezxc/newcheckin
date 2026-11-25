/* ==========================================================
   CMDI STAFF — PHASE 4 SERVICE REQUESTS & ROOM WORK ORDERS
   Reads/writes only through OTP-protected SECURITY DEFINER RPCs.
   ========================================================== */
(() => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const client = () => window.supabaseClient || null;
    const REFRESH_MS = 45000;

    const state = {
        role: null,
        staff: null,
        tasks: [],
        rooms: [],
        staffOptions: [],
        summary: {},
        statusFilter: 'all',
        query: '',
        loading: false,
        lastUpdated: null,
        refreshTimer: null
    };

    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);

    const fmtDate = value => {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
        });
    };

    const label = value => ({
        pending: 'Unassigned', assigned: 'Assigned', in_progress: 'In progress',
        completed: 'Completed', cancelled: 'Cancelled',
        'vacant-clean': 'Vacant clean', 'vacant-dirty': 'Vacant dirty',
        cleaning: 'Cleaning', maintenance: 'Maintenance', occupied: 'Occupied',
        reserved: 'Reserved', overdue: 'Overdue', housekeeping: 'Housekeeping',
        maintenance_team: 'Maintenance'
    }[String(value || '').toLowerCase()] || String(value || 'Unknown').replace(/[_-]/g, ' '));

    function toast(type, title, message) {
        if (window.HavenStaff?.toast) window.HavenStaff.toast(type, title, message);
        else console[type === 'error' ? 'error' : 'log'](`${title}: ${message || ''}`);
    }

    function setError(message) {
        $('#taskList').innerHTML = `<div class="phase4-error">${esc(message)}</div>`;
        $('#roomList').innerHTML = `<div class="phase4-error">${esc(message)}</div>`;
        $('#lastUpdated').textContent = 'Unable to refresh';
    }

    function renderSummary() {
        const summary = state.summary || {};
        $('#kpiOpen').textContent = Number(summary.open || 0);
        $('#kpiUnassigned').textContent = Number(summary.unassigned || 0);
        $('#kpiProgress').textContent = Number(summary.in_progress || 0);
        $('#kpiCompleted').textContent = Number(summary.completed || 0);
    }

    function canDispatch() {
        return ['manager', 'front-desk'].includes(state.role)
            && window.RBAC?.can?.('requests.assign') === true;
    }

    function renderTaskControls(task) {
        if (canDispatch() && ['pending', 'assigned'].includes(task.status)
            && !['extend', 'checkout'].includes(String(task.type || '').toLowerCase())) {
            const selectedTeam = task.assigned_role || (task.type === 'housekeeping' || task.type === 'maintenance' ? task.type : '');
            const allowedTeams = task.type === 'housekeeping' ? ['housekeeping']
                : task.type === 'maintenance' ? ['maintenance']
                    : ['housekeeping', 'maintenance'];
            const teamOptions = [
                ...(allowedTeams.length > 1 ? ['<option value="">Select team…</option>'] : []),
                ...allowedTeams.map(team => `<option value="${team}" ${selectedTeam === team ? 'selected' : ''}>${label(team)}</option>`)
            ].join('');
            const users = state.staffOptions.filter(item => item.role === selectedTeam);
            const userOptions = [
                '<option value="">Shared team queue</option>',
                ...users.map(item => `<option value="${esc(item.id)}" ${item.id === task.assigned_to ? 'selected' : ''}>${esc(item.full_name)}</option>`)
            ].join('');

            return `<div class="phase4-control" data-task-control="${esc(task.id)}">
                <div class="phase4-control-row">
                    <select data-team-for="${esc(task.id)}" aria-label="Assign team">${teamOptions}</select>
                </div>
                <select data-person-for="${esc(task.id)}" aria-label="Assign staff member">${userOptions}</select>
                <textarea rows="2" maxlength="1000" data-note-for="${esc(task.id)}" placeholder="Private staff note (optional)">${esc(task.staff_note || '')}</textarea>
                <button class="btn phase4-btn-start" type="button" data-task-action="assign" data-task-id="${esc(task.id)}">${task.status === 'assigned' ? 'Save assignment' : 'Assign task'}</button>
            </div>`;
        }

        const isWorker = ['housekeeping', 'maintenance'].includes(state.role)
            && task.assigned_role === state.role
            && (!task.assigned_to || task.assigned_to === state.staff?.id);

        if (isWorker && ['pending', 'assigned'].includes(task.status)) {
            return `<div class="phase4-control"><p class="phase4-assigned">${task.assigned_to ? 'Assigned to you' : 'Available in your team queue'}</p>
                <button class="btn phase4-btn-start" type="button" data-task-action="start" data-task-id="${esc(task.id)}">Start task</button></div>`;
        }
        if (isWorker && task.status === 'in_progress' && task.assigned_to === state.staff?.id) {
            return `<div class="phase4-control"><p class="phase4-assigned">Started ${esc(fmtDate(task.started_at))}</p>
                <textarea rows="2" maxlength="1000" data-complete-note="${esc(task.id)}" placeholder="Completion note (optional)"></textarea>
                <button class="btn phase4-btn-done" type="button" data-task-action="complete" data-task-id="${esc(task.id)}">Mark completed</button></div>`;
        }

        const assignment = ['extend','checkout'].includes(String(task.type || '').toLowerCase())
            ? 'Handled through Front Desk booking/check-out workflow'
            : (task.assigned_name || (task.assigned_role ? `${label(task.assigned_role)} team queue` : 'Awaiting team assignment'));
        return `<div class="phase4-control"><p class="phase4-assigned">${esc(assignment)}</p>${task.staff_note ? `<p class="phase4-subtle">${esc(task.staff_note)}</p>` : ''}</div>`;
    }

    function renderTasks() {
        const query = state.query.toLowerCase();
        const visible = state.tasks.filter(task => {
            const statusOk = state.statusFilter === 'all' || task.status === state.statusFilter;
            const haystack = `${task.type || ''} ${task.details || ''} ${task.room_number || ''} ${task.guest || ''} ${task.assigned_role || ''} ${task.assigned_name || ''}`.toLowerCase();
            return statusOk && (!query || haystack.includes(query));
        });

        if (!visible.length) {
            $('#taskList').innerHTML = `<div class="phase4-empty">${state.role === 'housekeeping' || state.role === 'maintenance'
                ? 'No requests are currently assigned to your team.'
                : 'No service requests found. New client requests will appear here.'}</div>`;
            $('#taskCount').textContent = '0 tasks shown';
            return;
        }

        $('#taskList').innerHTML = visible.map(task => `
            <article class="phase4-task" data-task-card="${esc(task.id)}">
                <div class="phase4-task-main">
                    <div class="phase4-task-title">${esc(label(task.type))} request · #${esc(task.id)}</div>
                    ${task.details ? `<p class="phase4-task-details">${esc(task.details)}</p>` : ''}
                    <p class="phase4-subtle">Submitted ${esc(fmtDate(task.created_at))}</p>
                </div>
                <div class="phase4-meta"><strong>${task.room_number ? `Room ${esc(task.room_number)}` : 'Room not specified'}</strong><span>${esc(task.guest || 'Guest details restricted')}</span></div>
                <div><span class="phase4-pill ${esc(task.status)}">${esc(label(task.status))}</span></div>
                ${renderTaskControls(task)}
            </article>`).join('');
        $('#taskCount').textContent = `${visible.length} of ${state.tasks.length} visible tasks`;
    }

    function roomAction(room) {
        if (state.role === 'housekeeping') {
            if (room.status === 'vacant-dirty') return `<div class="phase4-room-action">
                <textarea class="phase4-room-note" rows="2" maxlength="500" data-room-note="${esc(room.id)}" placeholder="Cleaning note (optional)"></textarea>
                <button class="btn phase4-btn-start" type="button" data-room-action="start_cleaning" data-room-id="${esc(room.id)}">Start cleaning</button></div>`;
            if (room.status === 'cleaning' && room.active_work_type === 'cleaning') return `<div class="phase4-room-action">
                <textarea class="phase4-room-note" rows="2" maxlength="500" data-room-note="${esc(room.id)}" placeholder="Completion note (optional)"></textarea>
                <button class="btn phase4-btn-done" type="button" data-room-action="complete_cleaning" data-room-id="${esc(room.id)}">Mark room clean</button></div>`;
            if (room.status === 'cleaning') return '<p class="phase4-subtle">Legacy cleaning status — ask the Manager to inspect this room.</p>';
        }
        if (state.role === 'maintenance') {
            if (['vacant-clean', 'vacant-dirty'].includes(room.status)) return `<div class="phase4-room-action">
                <textarea class="phase4-room-note" rows="2" maxlength="500" data-room-note="${esc(room.id)}" placeholder="Repair reason (optional)"></textarea>
                <button class="btn phase4-btn-start" type="button" data-room-action="start_maintenance" data-room-id="${esc(room.id)}">Start maintenance</button></div>`;
            if (room.status === 'maintenance' && room.active_work_type === 'maintenance') return `<div class="phase4-room-action">
                <textarea class="phase4-room-note" rows="2" maxlength="500" data-room-note="${esc(room.id)}" placeholder="Repair completion note (optional)"></textarea>
                <button class="btn phase4-btn-done" type="button" data-room-action="complete_maintenance" data-room-id="${esc(room.id)}">Complete repair</button></div>`;
            if (room.status === 'maintenance') return '<p class="phase4-subtle">Legacy maintenance status — ask the Manager to inspect this room.</p>';
        }
        return `<p class="phase4-subtle">${room.active_work_type ? `${esc(label(room.active_work_type))} work in progress` : 'No room action for this role/status'}</p>`;
    }

    function renderRooms() {
        $('#roomCount').textContent = `${state.rooms.length} rooms`;
        if (!state.rooms.length) {
            $('#roomList').innerHTML = '<div class="phase4-empty">No rooms returned by Supabase.</div>';
            return;
        }
        $('#roomList').innerHTML = state.rooms.map(room => `<article class="phase4-room">
            <div class="phase4-room-top"><div><div class="phase4-room-number">Room ${esc(room.room_number)}</div><div class="phase4-room-meta">Floor ${esc(room.floor)} · Capacity ${esc(room.capacity ?? '—')}</div></div>
            <span class="phase4-pill ${esc(room.status)}">${esc(label(room.status))}</span></div>
            ${room.active_work_type ? `<p class="phase4-subtle">${esc(label(room.active_work_type))} started ${esc(fmtDate(room.work_started_at))}</p>` : ''}
            ${roomAction(room)}</article>`).join('');
    }

    function renderAll() {
        renderSummary();
        renderTasks();
        renderRooms();
        state.lastUpdated = new Date();
        $('#lastUpdated').textContent = `Last updated ${state.lastUpdated.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
        $('#roleBreadcrumb').textContent = label(state.role);
        $('#roomHelp').textContent = state.role === 'housekeeping'
            ? 'Housekeeping can clean vacant-dirty rooms and mark completed rooms vacant-clean. Occupied or pending-booking rooms are blocked.'
            : state.role === 'maintenance'
                ? 'Maintenance can place vacant rooms under repair and restore their previous vacant status after the repair is complete.'
                : 'Manager and Front Desk can dispatch service requests. Room status changes are reserved for the assigned operational teams.';
    }

    async function loadBoard({quiet = false} = {}) {
        if (state.loading) return;
        const db = client();
        if (!db) { setError('Supabase client is unavailable. Check js/supabase-client.js.'); return; }
        state.loading = true;
        if (!quiet) {
            $('#taskList').innerHTML = '<div class="phase4-loading">Loading service requests…</div>';
            $('#roomList').innerHTML = '<div class="phase4-loading">Loading room statuses…</div>';
        }
        try {
            const {data,error} = await db.rpc('get_staff_service_task_board');
            if (error) throw error;
            if (!data || typeof data !== 'object') throw new Error('The service task board returned no data.');
            state.staff = data.staff || {};
            state.role = String(state.staff.role || window.RBAC?.realRole?.() || '').toLowerCase();
            if (!['manager','front-desk','housekeeping','maintenance'].includes(state.role)) throw new Error('Your account does not have an operational staff role.');
            state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
            state.rooms = Array.isArray(data.rooms) ? data.rooms : [];
            state.staffOptions = Array.isArray(data.staff_options) ? data.staff_options : [];
            state.summary = data.summary || {};
            renderAll();
        } catch (error) {
            console.error('[CMDI Phase 4] Work board load failed:',error);
            if (!quiet) setError(error.message || 'Unable to load the work board.');
            toast('error','Work board unavailable',error.message || 'Check your verified Login OTP session and Phase 4 SQL installation.');
        } finally { state.loading = false; }
    }

    async function assignTask(button) {
        const card = button.closest('[data-task-card]');
        const id = Number(button.dataset.taskId);
        const team = card.querySelector(`[data-team-for="${CSS.escape(String(id))}"]`)?.value;
        const person = card.querySelector(`[data-person-for="${CSS.escape(String(id))}"]`)?.value || null;
        const note = card.querySelector(`[data-note-for="${CSS.escape(String(id))}"]`)?.value?.trim() || null;
        if (!team) { toast('error','Choose a team','Select Housekeeping or Maintenance.'); return; }
        const {data,error} = await client().rpc('assign_staff_service_request',{
            p_request_id:id,p_assigned_role:team,p_assigned_to:person,p_staff_note:note
        });
        if (error) throw error;
        if (data?.ok === false) throw new Error(data.message || 'Assignment failed.');
        toast('success','Request assigned',`Request #${id} sent to ${label(team)}.`);
        await loadBoard({quiet:true});
    }

    async function updateTask(button) {
        const id = Number(button.dataset.taskId);
        const action = button.dataset.taskAction;
        const note = button.closest('[data-task-card]')?.querySelector(`[data-complete-note="${CSS.escape(String(id))}"]`)?.value?.trim() || null;
        const {data,error} = await client().rpc('update_staff_service_request',{
            p_request_id:id,p_action:action,p_staff_note:note
        });
        if (error) throw error;
        if (data?.ok === false) throw new Error(data.message || 'Task update failed.');
        toast('success',action === 'start' ? 'Task started' : 'Task completed',`Request #${id} updated.`);
        await loadBoard({quiet:true});
    }

    async function updateRoom(button) {
        const roomId = button.dataset.roomId;
        const action = button.dataset.roomAction;
        const note = button.closest('.phase4-room')?.querySelector(`[data-room-note="${CSS.escape(roomId)}"]`)?.value?.trim() || null;
        const confirm = window.HavenStaff?.confirmDialog;
        if (typeof confirm !== 'function') throw new Error('The staff confirmation dialog did not load. Refresh and try again.');
        const prompts = {
            start_cleaning:['Start cleaning?','The room will be marked as cleaning.'],
            complete_cleaning:['Mark room clean?','The room will be marked vacant-clean.'],
            start_maintenance:['Start maintenance?','The vacant room will be placed under maintenance.'],
            complete_maintenance:['Complete repair?','The room will return to its previous vacant status.']
        };
        const [title,message] = prompts[action] || ['Update room?','This will update the room status.'];
        const answer = await confirm({title,message,confirmText:'Confirm',cancelText:'Cancel'});
        if (!answer?.confirmed) return;
        const {data,error} = await client().rpc('update_staff_room_work_status',{
            p_room_id:roomId,p_action:action,p_note:note
        });
        if (error) throw error;
        if (data?.ok === false) throw new Error(data.message || 'Room status update failed.');
        toast('success','Room updated',`Room ${data.room_number} is now ${label(data.status)}.`);
        await loadBoard({quiet:true});
    }

    function bindEvents() {
        const menuButton = $('#menuToggle');
        const sidebar = $('#sidebar');
        const overlay = $('#sidebarOverlay');
        const setMenu = open => {
            sidebar.classList.toggle('open',open);
            overlay.classList.toggle('open',open);
            menuButton.setAttribute('aria-expanded',String(open));
        };
        menuButton.addEventListener('click',()=>setMenu(!sidebar.classList.contains('open')));
        overlay.addEventListener('click',()=>setMenu(false));
        $('#refreshTasks').addEventListener('click',()=>loadBoard());
        $('#statusFilter').addEventListener('change',event=>{state.statusFilter=event.target.value;renderTasks();});
        $('#taskSearch').addEventListener('input',event=>{state.query=event.target.value;renderTasks();});

        $('#taskList').addEventListener('change',event=>{
            const teamSelect = event.target.closest('[data-team-for]');
            if (!teamSelect) return;
            const card = teamSelect.closest('[data-task-card]');
            const requestId = teamSelect.dataset.teamFor;
            const personSelect = card.querySelector(`[data-person-for="${CSS.escape(requestId)}"]`);
            const users = state.staffOptions.filter(item=>item.role===teamSelect.value);
            personSelect.innerHTML = '<option value="">Shared team queue</option>' + users.map(item=>`<option value="${esc(item.id)}">${esc(item.full_name)}</option>`).join('');
        });

        $('#taskList').addEventListener('click',async event=>{
            const button = event.target.closest('button[data-task-action]');
            if (!button || button.disabled) return;
            button.disabled = true;
            try {
                if (button.dataset.taskAction==='assign') await assignTask(button);
                else await updateTask(button);
            } catch(error) {
                console.error('[CMDI Phase 4] Task action failed:',error);
                toast('error','Task action failed',error.message || 'Refresh and try again.');
                button.disabled = false;
            }
        });

        $('#roomList').addEventListener('click',async event=>{
            const button = event.target.closest('button[data-room-action]');
            if (!button || button.disabled) return;
            button.disabled = true;
            try { await updateRoom(button); }
            catch(error) {
                console.error('[CMDI Phase 4] Room action failed:',error);
                toast('error','Room update failed',error.message || 'Refresh and try again.');
                button.disabled = false;
            }
        });

        document.addEventListener('keydown',event=>{
            if (event.key==='Escape') setMenu(false);
            if (event.key==='/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
                event.preventDefault(); $('#taskSearch').focus();
            }
        });
    }

    async function init() {
        bindEvents();
        if (window.RBAC?.ready) await window.RBAC.ready;
        if (!window.RBAC?.realRole?.()) {
            setError('This page requires an active CMDI staff account with a verified Login OTP session.');
            return;
        }
        if (!window.RBAC.init({active:'requests'})) return;
        await loadBoard();
        state.refreshTimer = setInterval(()=>loadBoard({quiet:true}),REFRESH_MS);
        document.addEventListener('visibilitychange',()=>{
            if (document.visibilityState==='visible' && !state.loading) loadBoard({quiet:true});
        });
        window.addEventListener('beforeunload',()=>clearInterval(state.refreshTimer));
    }

    init().catch(error=>{
        console.error('[CMDI Phase 4] Initialization failed:',error);
        setError(error.message || 'Unable to initialize the service work board.');
    });
})();
