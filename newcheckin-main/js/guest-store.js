/* ==========================================================
   CMDI GUEST DIRECTORY — SUPABASE READ ADAPTER
   Source of truth: public.profiles (RLS enforced by Supabase).
   This module intentionally does not create, delete, check in/out,
   or edit profiles because the supplied schema has no confirmed
   stay-history / checkout fields or safe guest-provisioning workflow.
   ========================================================== */
(() => {
    'use strict';

    const state = { guests: [], loaded: false, loading: false, error: null };
    const listeners = new Set();

    const notify = () => listeners.forEach(fn => {
        try { fn(state.guests.slice(), state); } catch (error) { console.error('[CMDI Guests] Listener failed:', error); }
    });

    function clean(value) {
        return value == null || value === '' ? '' : String(value).trim();
    }

    function roomValue(row) {
        return clean(row.assigned_room) || clean(row.room) || clean(row.unit) || '';
    }

    function getFloor(room) {
        const match = String(room || '').match(/^(\d)/);
        return match ? Number(match[1]) : null;
    }

    function mapProfile(row) {
        const room = roomValue(row);
        return {
            id: String(row.id),
            name: clean(row.full_name) || 'Unnamed guest',
            guestId: clean(row.guest_id),
            regId: clean(row.reg_id),
            institution: clean(row.institution),
            branch: clean(row.branch),
            room: room || '—',
            floor: getFloor(room),
            capacity: row.capacity == null ? '' : Number(row.capacity),
            checkIn: clean(row.check_in),
            status: clean(row.status) || 'unknown',
            registrationStatus: clean(row.registration_status),
            phone: clean(row.phone),
            role: clean(row.role),
            createdAt: clean(row.created_at)
        };
    }

    async function getClient() {
        if (window.supabaseClientReady) return await window.supabaseClientReady;
        if (window.supabaseClient) return window.supabaseClient;
        throw new Error(window.supabaseClientError?.message || 'Supabase client is not ready.');
    }

    async function load() {
        if (state.loading) {
            while (state.loading) await new Promise(resolve => setTimeout(resolve, 50));
            if (state.error) throw state.error;
            return state.guests.slice();
        }

        state.loading = true;
        state.error = null;
        try {
            const client = await getClient();
            if (!window.RBAC || !window.RBAC.ready) throw new Error('Staff access has not been verified.');
            await window.RBAC.ready;
            const role = window.RBAC.getRole?.();
            if (!['front-desk', 'manager'].includes(role)) {
                throw new Error('Only Front Desk and Manager can view guest profiles.');
            }

            // All selected fields are from the user's supplied profiles schema.
            const columns = [
                'id', 'full_name', 'role', 'guest_id', 'reg_id', 'phone',
                'institution', 'branch', 'room', 'capacity', 'check_in',
                'assigned_room', 'unit', 'status', 'registration_status', 'created_at'
            ].join(',');

            const { data, error } = await client
                .from('profiles')
                .select(columns)
                .eq('role', 'client')
                .order('created_at', { ascending: false });

            if (error) throw error;
            state.guests = (Array.isArray(data) ? data : []).map(mapProfile);
            state.loaded = true;
            notify();
            return state.guests.slice();
        } catch (error) {
            state.error = new Error(error?.message || 'Unable to load guest profiles.');
            throw state.error;
        } finally {
            state.loading = false;
        }
    }

    function all() { return state.guests.slice(); }
    function find(id) { return state.guests.find(guest => guest.id === String(id)) || null; }
    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    window.GuestStore = { load, all, find, onChange, getState: () => ({ ...state, guests: all() }) };
})();
