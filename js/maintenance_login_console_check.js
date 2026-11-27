// CMDI Maintenance account live diagnostic — READ ONLY.
// Run only after the owner signs in and completes the normal Login OTP flow.
// Never paste passwords, API keys, access tokens or refresh tokens into chat.
(async () => {
  const db = window.supabaseClient;
  if (!db) throw new Error('window.supabaseClient is not available on this page.');

  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError) throw userError;
  const user = userData?.user;
  if (!user) throw new Error('No signed-in Supabase user. Sign in first.');

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id,email,full_name,role,status,guest_id,access_expires_at')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  const { data: isStaff, error: staffError } = await db.rpc('is_staff');
  const { data: board, error: boardError } = await db.rpc('get_staff_service_task_board');

  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const rooms = Array.isArray(board?.rooms) ? board.rooms : [];

  console.log('[CMDI Maintenance] AUTH USER:', {
    id: user.id,
    email: user.email
  });
  console.log('[CMDI Maintenance] PROFILE:', profile);
  console.log('[CMDI Maintenance] is_staff():', {
    data: isStaff,
    error: staffError?.message || null
  });
  console.log('[CMDI Maintenance] TASK BOARD:', {
    staff: board?.staff || null,
    error: boardError?.message || null,
    task_count: tasks.length,
    room_count: rooms.length,
    task_summary: tasks.reduce((acc, task) => {
      const key = `${task.assigned_role || 'unassigned'}:${task.status || 'unknown'}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  });

  // Do not print client names/details. Maintenance should only receive its
  // own team queue, and only its own assigned work can be completed.
  console.table(tasks.map(task => ({
    request_id: task.id,
    type: task.type,
    status: task.status,
    assigned_role: task.assigned_role,
    assigned_to_me: task.assigned_to === user.id,
    unclaimed_team_task: !task.assigned_to && task.assigned_role === 'maintenance'
  })));

  return {
    account_email_matches: String(user.email || '').toLowerCase() === 'lancertion1@gmail.com',
    profile_role_is_maintenance: profile?.role === 'maintenance',
    profile_is_active: profile?.status === 'active',
    is_staff_true: isStaff === true,
    board_loaded: !boardError && !!board,
    board_role_is_maintenance: board?.staff?.role === 'maintenance'
  };
})();
