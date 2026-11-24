document.addEventListener('DOMContentLoaded', () => {

    const form = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const idInput = document.getElementById('registration-id');
    const pwInput = document.getElementById('password');
    const alertBox = document.getElementById('loginAlert');
    const card = document.getElementById('loginCard');

    const DASHBOARDS = {
        client: 'client-dashboard.html',
        staff: 'staff-dashboard.html',
        admin: 'admin-dashboard.html'
    };

    // Exact staff roles stored in profiles.role (see staff-roles.sql)
    const STAFF_ROLES = ['front-desk', 'housekeeping', 'maintenance', 'manager'];
    const ROLE_CACHE_KEY = 'haven_role_cache';     // lets staff pages open without a one-time reload
    const MAX_TRIES = 5;
    const LOCK_SECONDS = 30;
    let failedTries = 0;
    let lockedUntil = 0;

    /* ==========================================
       HELPERS: lock-out, friendly errors, routing
       ========================================== */
    function isLocked() { return Date.now() < lockedUntil; }

    function registerFailure() {
        failedTries += 1;
        if (failedTries >= MAX_TRIES) {
            lockedUntil = Date.now() + LOCK_SECONDS * 1000;
            failedTries = 0;
        }
    }

    function friendlyAuthError(err) {
        const msg = String((err && err.message) || '').toLowerCase();
        const code = String((err && err.code) || '').toLowerCase();
        if (code === 'invalid_credentials' || msg.includes('invalid login')) {
            return 'Incorrect email or password.';
        }
        if (code === 'email_not_confirmed' || msg.includes('email not confirmed') || msg.includes('not confirmed')) {
            return 'Please verify your email first. Open the 6-digit code sent during registration.';
        }
        if (msg.includes('banned') || msg.includes('suspended')) {
            return 'This account has been suspended. Please contact an administrator.';
        }
        if (msg.includes('rate') || msg.includes('too many')) {
            return 'Too many attempts. Please wait a minute and try again.';
        }
        if (msg.includes('network') || msg.includes('fetch')) {
            return 'Could not reach the server. Check your connection and try again.';
        }
        return 'Could not sign in' + (err && err.message ? ' (' + err.message + ')' : '') + '. Please try again.';
    }

    // Only allow returning to one of our own staff pages (e.g. ?next=staff-rooms.html)
    function safeNextPage() {
        const next = new URLSearchParams(window.location.search).get('next') || '';
        return /^staff-[a-z]+\.html$/.test(next) ? next : null;
    }

    function cacheRole(userId, role) {
        try { localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ uid: userId, role: role })); } catch (e) { /* ignore */ }
    }

    function getDestination(role) {
        const r = String(role || 'client').toLowerCase().trim();
        if (STAFF_ROLES.includes(r)) return safeNextPage() || DASHBOARDS.staff;
        if (r === 'admin' || r === 'super-admin' || r === 'support-admin') return DASHBOARDS.admin;
        return DASHBOARDS.client;
    }

    /* ==========================================
       VALIDATION
       ========================================== */
    const rules = {
        'registration-id': {
            pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            messages: { required: 'Email address is required.', pattern: 'Please enter a valid email address.' }
        },
        'password': {
            messages: { required: 'Password is required.' }
        }
    };

    function showError(fieldId, message) {
        const group = document.getElementById(fieldId)?.closest('.form-group');
        const err = document.querySelector(`[data-error-for="${fieldId}"]`);
        if (group) group.classList.add('error');
        if (err) err.textContent = message || '';
    }
    function clearError(fieldId) {
        const group = document.getElementById(fieldId)?.closest('.form-group');
        const err = document.querySelector(`[data-error-for="${fieldId}"]`);
        if (group) group.classList.remove('error');
        if (err) err.textContent = '';
    }
    function hideAlert() { if (alertBox) { alertBox.hidden = true; alertBox.textContent = ''; } }
    function showAlert(message) { if (alertBox) { alertBox.textContent = message; alertBox.hidden = false; } }

    function validateField(fieldId) {
        const rule = rules[fieldId];
        const input = document.getElementById(fieldId);
        if (!rule || !input) return true;
        const value = fieldId === 'password' ? input.value : input.value.trim();
        if (!value) { showError(fieldId, rule.messages.required); return false; }
        if (rule.pattern && !rule.pattern.test(value)) { showError(fieldId, rule.messages.pattern); return false; }
        clearError(fieldId);
        return true;
    }

    function validateForm() {
        let firstInvalid = null;
        Object.keys(rules).forEach((fieldId) => {
            if (!validateField(fieldId) && !firstInvalid) firstInvalid = document.getElementById(fieldId);
        });
        if (firstInvalid) firstInvalid.focus();
        return !firstInvalid;
    }

    Object.keys(rules).forEach((fieldId) => {
        const input = document.getElementById(fieldId);
        if (!input) return;
        input.addEventListener('blur', () => validateField(fieldId));
        input.addEventListener('input', () => {
            hideAlert();
            const group = input.closest('.form-group');
            if (group && group.classList.contains('error')) validateField(fieldId);
        });
    });

    document.querySelectorAll('.toggle-pw').forEach((btn) => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.classList.toggle('is-visible', show);
        });
    });

    function shake() {
        if (!card) return;
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 400);
    }

    /* ==========================================
       SIGN IN LOGIC: EMAIL + PASSWORD ONLY
       Registration email OTP is handled separately by verify-otp.js.
       A normal login does not send or require another OTP.
       ========================================== */
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        if (isLocked()) {
            const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
            showAlert('Too many attempts. Please wait ' + secs + ' seconds and try again.');
            shake();
            return;
        }
        if (!validateForm()) { shake(); return; }
        if (!window.supabaseClient) {
            showAlert('The authentication service is not ready. Refresh the page and try again.');
            return;
        }

        const label = loginBtn?.querySelector('.btn-label');
        const spinner = loginBtn?.querySelector('.btn-spinner');
        const setLoading = (on) => {
            if (loginBtn) loginBtn.disabled = on;
            if (label) label.hidden = on;
            if (spinner) spinner.hidden = !on;
        };

        setLoading(true);
        try {
            const email = idInput.value.trim().toLowerCase();
            const password = pwInput.value;
            const supabase = window.supabaseClient;

            // Supabase rejects unconfirmed email accounts here. Once the client has
            // completed the registration OTP, future logins use password only.
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (authError) {
                registerFailure();
                console.error('Password sign-in error:', authError);
                showAlert(friendlyAuthError(authError));
                shake();
                return;
            }

            const user = authData?.user;
            if (!user?.id) {
                await supabase.auth.signOut();
                showAlert('Sign-in completed, but the account session could not be confirmed. Please try again.');
                return;
            }

            // Read the account's actual role and status after authentication.
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('role,status')
                .eq('id', user.id)
                .maybeSingle();

            if (profileError || !profile) {
                console.error('Login profile lookup error:', profileError);
                await supabase.auth.signOut();
                showAlert('We could not load your CMDI account. Please contact CMDI staff.');
                return;
            }

            const accountStatus = String(profile.status || 'active').toLowerCase().trim();
            if (['inactive', 'suspended'].includes(accountStatus)) {
                await supabase.auth.signOut();
                showAlert('This account is currently inactive or suspended. Please contact CMDI staff.');
                return;
            }

            const role = String(profile.role || 'client').toLowerCase().trim();
            cacheRole(user.id, role);
            failedTries = 0;

            // Remove any abandoned login OTP challenge left by an older version.
            sessionStorage.removeItem('haven_login_challenge');
            sessionStorage.removeItem('haven_login_email_masked');
            sessionStorage.removeItem('haven_login_next');

            // Keep the existing role-based routing and safe staff-page redirect.
            window.location.replace(getDestination(role));
        } catch (err) {
            console.error('Password sign-in error:', err);
            showAlert(friendlyAuthError(err));
            shake();
        } finally {
            setLoading(false);
        }
    });

    /* ==========================================
       FORGOT PASSWORD LOGIC
       ========================================== */
    window.handleSubmit = async function(event) {
        event.preventDefault();
        const resetBtn = event.target.querySelector('button[type="submit"]');
        const originalBtnText = resetBtn.textContent;
        const emailInput = document.getElementById('reset-email');
        const email = emailInput.value.trim();

        if (!email) { alert("Please enter your email address."); return; }

        resetBtn.disabled = true;
        resetBtn.textContent = "Sending...";

        try {
            const { data, error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/update-password.html`
            });

            if (error) throw error;
            alert("Password reset link sent! Check your email.");
            document.getElementById('forgotModal').classList.remove('active');
            emailInput.value = '';
        } catch (err) {
            console.error('Reset error:', err);
            alert(err.message || 'Error sending reset email.');
        } finally {
            resetBtn.disabled = false;
            resetBtn.textContent = originalBtnText;
        }
    };

    /* ==========================================
       SHAKE ANIMATION
       ========================================== */
    if (!document.getElementById('loginShakeCSS')) {
        const style = document.createElement('style');
        style.id = 'loginShakeCSS';
        style.textContent = `
            @keyframes haven-shake {
                0%, 100% { transform: translateX(0); }
                20% { transform: translateX(-6px); }
                40% { transform: translateX(6px); }
                60% { transform: translateX(-4px); }
                80% { transform: translateX(4px); }
            }
            .login-card.shake { animation: haven-shake 0.4s ease; }
        `;
        document.head.appendChild(style);
    }
});