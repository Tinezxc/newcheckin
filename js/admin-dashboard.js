document.addEventListener('DOMContentLoaded', () => {
  const db = window.supabaseClient;
  const $ = (selector) => document.querySelector(selector);
  const STAFF_ROLES = new Set(['front-desk', 'housekeeping', 'maintenance', 'manager']);
  const ADMIN_ROLES = new Set(['super-admin', 'support-admin']);
  const ROLE_LABELS = {
    client: 'Client', 'front-desk': 'Front Desk', housekeeping: 'Housekeeping',
    maintenance: 'Maintenance', manager: 'Manager', 'support-admin': 'Support Admin',
    'super-admin': 'Super Admin'
  };

  const menu = $('#menuToggle');
  const sidebar = $('#sidebar');
  const scrim = $('#scrim');
  const closeMenu = () => { sidebar?.classList.remove('open'); scrim?.classList.remove('open'); menu?.setAttribute('aria-expanded', 'false'); };
  menu?.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    scrim.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
  });
  scrim?.addEventListener('click', closeMenu);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function initials(name) {
    return String(name || 'Admin').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || 'AD';
  }
  function setNotice(message, type = '') {
    const el = $('#pageNotice');
    if (!el) return;
    el.textContent = message || '';
    el.className = `notice ${type}`.trim();
    el.hidden = !message;
  }
  function showGate(message, retry = false) {
    $('#loadingPanel').hidden = true;
    $('#dashboardContent').hidden = true;
    setNotice(message, 'error');
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'refresh-btn'; button.textContent = 'Try again';
      button.addEventListener('click', () => window.location.reload());
      $('#pageNotice').append(' ', button);
    }
  }
  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function roleLabel(role) { return ROLE_LABELS[String(role || '').toLowerCase()] || String(role || 'Unknown'); }
  function accountStatus(status) {
    const safe = String(status || 'unknown').toLowerCase();
    const label = safe.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const cls = ['active','suspended','locked','invited'].includes(safe) ? safe : '';
    return `<span class="status-pill ${cls}">${escapeHtml(label)}</span>`;
  }

  async function load() {
    if (!db) { showGate('Supabase is not initialized. Check the existing js/supabase-client.js file.', true); return; }
    $('#loadingPanel').hidden = false;
    $('#dashboardContent').hidden = true;
    setNotice('');

    const { data: sessionData, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    const session = sessionData?.session;
    if (!session?.user?.id) { window.location.replace('index.html'); return; }

    const { data: profile, error: profileError } = await db.from('profiles')
      .select('full_name, role, status, access_expires_at')
      .eq('id', session.user.id).single();
    if (profileError || !profile) throw new Error(profileError?.message || 'Your CMDI profile could not be found.');

    const role = String(profile.role || '').toLowerCase();
    const expired = profile.access_expires_at && new Date(profile.access_expires_at) < new Date();
    if (!ADMIN_ROLES.has(role) || profile.status === 'suspended' || expired) {
      if (STAFF_ROLES.has(role)) { window.location.replace('staff-dashboard.html'); return; }
      if (role === 'client') { window.location.replace('client-dashboard.html'); return; }
      showGate('Administrator access is required. This page is for Super Admin and Support Admin accounts.');
      return;
    }

    const name = profile.full_name || session.user.email || 'Administrator';
    const mark = initials(name);
    $('#welcomeName').textContent = name;
    $('#sidebarName').textContent = name;
    $('#sidebarRole').textContent = roleLabel(role);
    $('#sidebarAvatar').textContent = mark;
    $('#mobileAvatar').textContent = mark;

    const { data: users, error: usersError } = await db.rpc('admin_list_users');
    if (usersError) throw new Error(`Could not load accounts: ${usersError.message}`);
    const rows = Array.isArray(users) ? users : [];
    renderStats(rows);
    renderAccounts(rows);
    await renderRoleHistory();

    $('#loadingPanel').hidden = true;
    $('#dashboardContent').hidden = false;
  }

  function renderStats(rows) {
    const normalized = rows.map(r => ({...r, role: String(r.role || '').toLowerCase(), status: String(r.status || 'unknown').toLowerCase()}));
    const count = predicate => normalized.filter(predicate).length;
    $('#totalAccounts').textContent = String(rows.length);
    $('#clientAccounts').textContent = String(count(r => r.role === 'client'));
    $('#staffAccounts').textContent = String(count(r => STAFF_ROLES.has(r.role)));
    $('#adminAccounts').textContent = String(count(r => ADMIN_ROLES.has(r.role)));
    $('#activeAccounts').textContent = String(count(r => r.status === 'active'));
    $('#otherAccounts').textContent = String(count(r => r.status !== 'active'));
  }

  function renderAccounts(rows) {
    const body = $('#accountsBody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="table-message">No account records were returned.</td></tr>';
      return;
    }
    const sorted = [...rows].sort((a, b) => {
      const av = new Date(a.created_at || a.last_sign_in_at || 0).getTime();
      const bv = new Date(b.created_at || b.last_sign_in_at || 0).getTime();
      return bv - av;
    }).slice(0, 7);
    body.innerHTML = sorted.map(r => {
      const name = r.full_name || r.email || 'Unnamed account';
      return `<tr>
        <td><div class="account-name">${escapeHtml(name)}</div><div class="account-email">${escapeHtml(r.email || '')}</div></td>
        <td><span class="role-pill">${escapeHtml(roleLabel(r.role))}</span></td>
        <td>${accountStatus(r.status)}</td>
        <td>${escapeHtml(formatDate(r.last_sign_in_at))}</td>
      </tr>`;
    }).join('');
  }

  async function renderRoleHistory() {
    const list = $('#roleHistoryList');
    const { data, error } = await db.from('role_history').select('*').order('created_at', { ascending: false }).limit(5);
    if (error) {
      list.innerHTML = '<li class="table-message">Role history is not available for this account. Check its table permissions.</li>';
      return;
    }
    if (!data?.length) {
      list.innerHTML = '<li class="table-message">No role changes recorded yet.</li>';
      return;
    }
    list.innerHTML = data.map(row => {
      const actor = row.changed_by_name || 'Administrator';
      const target = row.target_name || 'User account';
      const oldRole = roleLabel(row.old_role || 'Unknown');
      const newRole = roleLabel(row.new_role || 'Unknown');
      return `<li><div class="activity-main"><strong>${escapeHtml(actor)}</strong> changed <strong>${escapeHtml(target)}</strong> from ${escapeHtml(oldRole)} to ${escapeHtml(newRole)}.</div><div class="activity-meta">${escapeHtml(formatDate(row.created_at))}</div>${row.reason ? `<div class="activity-reason">Reason: ${escapeHtml(row.reason)}</div>` : ''}</li>`;
    }).join('');
  }

  $('#refreshBtn')?.addEventListener('click', async () => {
    const btn = $('#refreshBtn');
    btn.disabled = true; btn.textContent = 'Refreshing…';
    try { await load(); }
    catch (error) { console.error('[CMDI Admin]', error); showGate(error.message || 'Could not load Admin data.', true); }
    finally { btn.disabled = false; btn.textContent = '↻ Refresh data'; }
  });
  $('#signOutBtn')?.addEventListener('click', async () => {
    const btn = $('#signOutBtn'); btn.disabled = true; btn.textContent = 'Signing out…';
    try {
      const { error } = await db.auth.signOut();
      if (error) throw error;
      window.location.replace('index.html');
    } catch (error) {
      setNotice(error.message || 'Could not sign out.', 'error');
      btn.disabled = false; btn.textContent = '↪ Sign out';
    }
  });

  load().catch(error => {
    console.error('[CMDI Admin Dashboard]', error);
    showGate(error.message || 'Could not load Admin dashboard.', true);
  });
});
