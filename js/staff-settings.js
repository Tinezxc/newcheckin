document.addEventListener('DOMContentLoaded', async () => {
  const UI = window.CMDIModules;
  if (!UI) return;
  const $ = id => document.getElementById(id);
  let ctx;
  let accounts = [];
  let currentUserId = null;

  try {
    ctx = await UI.ready('settings',['manager']);
    UI.bindShell();
    const { data, error } = await ctx.db.auth.getUser();
    if (error) throw error;
    currentUserId = data.user?.id || null;
    await loadAccounts();
  } catch (error) {
    UI.toast('error','Staff Settings unavailable',error.message);
    return;
  }

  async function loadAccounts() {
    $('staffRows').innerHTML = '<tr><td colspan="7" class="loading-state">Loading staff accounts…</td></tr>';
    $('refreshStaff').disabled = true;
    try {
      const data = await UI.rpc('staff_get_accounts');
      accounts = Array.isArray(data.accounts) ? data.accounts : [];
      updateStats();
      render();
    } catch (error) {
      $('staffRows').innerHTML = `<tr><td colspan="7" class="error-state">${UI.esc(error.message)}</td></tr>`;
      UI.toast('error','Could not load staff accounts',error.message);
    } finally { $('refreshStaff').disabled = false; }
  }

  function updateStats() {
    $('staffTotal').textContent = accounts.length;
    $('staffActive').textContent = accounts.filter(a => a.status === 'active').length;
    $('staffManagers').textContent = accounts.filter(a => a.role === 'manager').length;
    $('staffSuspended').textContent = accounts.filter(a => a.status === 'suspended').length;
  }

  function render() {
    const q = $('staffSearch').value.trim().toLowerCase();
    const roleFilter = $('staffRoleFilter').value;
    const statusFilter = $('staffStatusFilter').value;
    const rows = accounts.filter(a => {
      const matchText = [a.full_name,a.email,a.role,a.status].some(v => String(v||'').toLowerCase().includes(q));
      return matchText && (roleFilter==='all' || a.role===roleFilter) && (statusFilter==='all' || a.status===statusFilter);
    });
    $('staffResultCount').textContent = `${rows.length} of ${accounts.length} staff accounts`;
    $('staffFooter').textContent = `${accounts.length} staff profiles`;
    if (!rows.length) {
      $('staffRows').innerHTML = '<tr><td colspan="7" class="empty-state"><strong>No staff accounts found</strong>Invite a staff member or change the filters.</td></tr>';
      return;
    }
    $('staffRows').innerHTML = rows.map(a => {
      const isSelf = a.id === currentUserId;
      return `<tr data-account-row="${UI.esc(a.id)}"><td><div class="guest-cell"><span class="avatar">${UI.esc(UI.initials(a.full_name))}</span><div><span class="primary-text">${UI.esc(a.full_name || 'Staff')}</span>${isSelf?'<span class="secondary-text">Your account</span>':''}</div></div></td><td>${UI.esc(a.email || '—')}</td><td><select class="field" data-role-for="${UI.esc(a.id)}" ${isSelf?'disabled title="You cannot change your own assigned role"':''}>${[
        ['manager','Manager'],['front-desk','Front Desk'],['housekeeping','Housekeeping'],['maintenance','Maintenance']
      ].map(([value,label])=>`<option value="${value}" ${a.role===value?'selected':''}>${label}</option>`).join('')}</select></td><td><select class="field" data-status-for="${UI.esc(a.id)}" ${isSelf?'disabled title="You cannot suspend your own account"':''}><option value="active" ${a.status==='active'?'selected':''}>Active</option><option value="suspended" ${a.status==='suspended'?'selected':''}>Suspended</option></select></td><td>${UI.formatDate(a.last_sign_in_at,true)}</td><td>${UI.formatDate(a.created_at)}</td><td><button class="btn btn-primary btn-small" data-save-staff="${UI.esc(a.id)}" ${isSelf?'disabled':''}>Save</button></td></tr>`;
    }).join('');
  }

  $('staffRows').addEventListener('click',async event => {
    const btn = event.target.closest('[data-save-staff]');
    if (!btn) return;
    const id = btn.dataset.saveStaff;
    const role = document.querySelector(`[data-role-for="${CSS.escape(id)}"]`)?.value;
    const status = document.querySelector(`[data-status-for="${CSS.escape(id)}"]`)?.value;
    UI.setBusy(btn,true,'Saving…');
    try {
      await UI.rpc('staff_update_account',{p_user_id:id,p_role:role,p_status:status});
      UI.toast('success','Staff account updated','Role and account status saved to Supabase. The affected user must sign in again to refresh their verified role.');
      await loadAccounts();
    } catch(error) { UI.toast('error','Account update failed',error.message); }
    finally { UI.setBusy(btn,false); }
  });

  function openInvite() { $('newStaffName').value=''; $('newStaffEmail').value=''; $('newStaffRole').value='front-desk'; UI.openModal($('staffInviteModal')); }
  $('addStaff').addEventListener('click',openInvite);
  $('staffInviteForm').addEventListener('submit',async event => {
    event.preventDefault();
    const btn=$('sendStaffInvite');
    const fullName=$('newStaffName').value.trim();
    const email=$('newStaffEmail').value.trim().toLowerCase();
    const role=$('newStaffRole').value;
    UI.setBusy(btn,true,'Sending invitation…');
    try {
      const { data, error } = await ctx.db.functions.invoke('staff-provision',{body:{full_name:fullName,email,role}});
      if(error) throw new Error(error.message || 'Staff invitation function failed.');
      if(data?.error) throw new Error(data.error);
      UI.closeModal($('staffInviteModal'));
      UI.toast('success','Invitation sent',`An invitation was created for ${email}.`);
      await loadAccounts();
    } catch(error) {
<<<<<<< HEAD
      // Supabase FunctionsHttpError contains the Edge Function's JSON response
      // in error.context. Read it so the Manager sees the actual server reason
      // instead of only the generic non-2xx message.
      let detail = error?.message || 'The staff invitation request failed.';
      let status = null;
      const response = error?.context;

      if (response && typeof response.clone === 'function') {
        status = response.status || null;
        try {
          const body = await response.clone().json();
          if (body && typeof body === 'object') {
            detail = String(body.error || body.message || JSON.stringify(body));
          }
        } catch (_) {
          try {
            const text = await response.clone().text();
            if (text) detail = text;
          } catch (_) { /* keep the SDK message */ }
        }
      }

      const message = `${status ? `HTTP ${status}: ` : ''}${detail}`;
      console.error('[CMDI Staff Settings] staff-provision failed:', {
        status,
        message: detail,
        errorName: error?.name || 'UnknownError'
      });
      UI.toast('error','Could not invite staff',message);
=======
      UI.toast('error','Could not invite staff',`${error.message}. Confirm that the staff-provision Edge Function is deployed and its secrets are set.`);
>>>>>>> 4b37ebf4172cb3faf9aeee4c3fb66af9e7f38305
    } finally { UI.setBusy(btn,false); }
  });

  $('staffSearch').addEventListener('input',render);
  $('staffRoleFilter').addEventListener('change',render);
  $('staffStatusFilter').addEventListener('change',render);
  $('refreshStaff').addEventListener('click',loadAccounts);
  document.querySelectorAll('[data-close="staffInviteModal"]').forEach(el=>el.addEventListener('click',()=>UI.closeModal($('staffInviteModal'))));
});
