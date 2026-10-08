/* =====================================================
   EcoAlert · auth.js — Real Authentication Module
   ===================================================== */

const AUTH_USERS_KEY   = 'ecoalert-users-v1';
const AUTH_SESSION_KEY = 'ecoalert-session-v1';
const SALT = 'EcoAlert@2024#SecureSalt!';

const AuthManager = (() => {

  /* ── Internal: Hash password with SHA-256 ── */
  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + SALT);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ── Internal: Storage helpers ── */
  function getUsers() {
    try { return JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || '[]'); }
    catch { return []; }
  }
  function saveUsers(users) {
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
  }
  function dispatch(user) {
    document.dispatchEvent(new CustomEvent('auth:changed', { detail: user }));
  }

  /* ── Public API ── */
  return {
    /* Get currently logged-in user (or null) */
    getCurrentUser() {
      try { return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null'); }
      catch { return null; }
    },

    /* Set session & fire event */
    setSession(user) {
      if (user) localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(user));
      else       localStorage.removeItem(AUTH_SESSION_KEY);
      dispatch(user);
    },

    /* Register a new user */
    async register(name, email, password) {
      name     = name.trim();
      email    = email.trim().toLowerCase();
      password = password.trim();

      if (!name)          throw new Error('Please enter your full name.');
      if (!email.includes('@')) throw new Error('Please enter a valid email address.');
      if (password.length < 6)  throw new Error('Password must be at least 6 characters.');

      const users = getUsers();
      if (users.find(u => u.email === email)) {
        throw new Error('An account with this email already exists. Sign in instead.');
      }

      const hashed = await hashPassword(password);
      const avatarColors = ['#174032','#2e5c8a','#5c2e8a','#8a2e5c','#8a5c2e','#2e8a5c'];
      const user = {
        id:          'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name,
        email,
        passwordHash: hashed,
        avatar:       name.slice(0, 2).toUpperCase(),
        avatarColor:  avatarColors[Math.floor(Math.random() * avatarColors.length)],
        bio:          '',
        city:         '',
        createdAt:    new Date().toISOString(),
        isGuest:      false,
        savedLocations: [],
        settings:     null   // null = use defaults
      };

      users.push(user);
      saveUsers(users);

      const session = { ...user };
      delete session.passwordHash;
      this.setSession(session);
      return session;
    },

    /* Login with email + password */
    async login(email, password) {
      email    = email.trim().toLowerCase();
      password = password.trim();

      if (!email || !password) throw new Error('Please enter your email and password.');

      const users = getUsers();
      const user  = users.find(u => u.email === email);
      if (!user) throw new Error('No account found with this email. Try signing up.');

      const hashed = await hashPassword(password);
      if (hashed !== user.passwordHash) throw new Error('Incorrect password. Please try again.');

      const session = { ...user };
      delete session.passwordHash;
      this.setSession(session);
      return session;
    },

    /* Guest (no account) */
    loginAsGuest() {
      const guest = {
        id:         'guest_' + Date.now(),
        name:       'Guest',
        email:      '',
        avatar:     '👤',
        avatarColor:'#607068',
        bio:        '',
        city:       '',
        createdAt:  new Date().toISOString(),
        isGuest:    true,
        savedLocations: [],
        settings:   null
      };
      this.setSession(guest);
      return guest;
    },

    /* Logout */
    logout() {
      this.setSession(null);
    },

    /* Update profile fields (name, bio, city, avatarColor) */
    updateProfile(updates) {
      const current = this.getCurrentUser();
      if (!current) return null;

      // Recompute avatar initials if name changed
      if (updates.name && !current.isGuest) {
        updates.avatar = updates.name.slice(0, 2).toUpperCase();
      }

      const updated = { ...current, ...updates };
      this.setSession(updated);

      if (!current.isGuest) {
        const users = getUsers();
        const idx   = users.findIndex(u => u.id === current.id);
        if (idx >= 0) {
          users[idx] = { ...users[idx], ...updates };
          saveUsers(users);
        }
      }
      return updated;
    },

    /* Change password */
    async changePassword(oldPassword, newPassword) {
      const current = this.getCurrentUser();
      if (!current || current.isGuest) throw new Error('Must be logged in to change password.');
      if (newPassword.length < 6) throw new Error('New password must be at least 6 characters.');

      const users = getUsers();
      const user  = users.find(u => u.id === current.id);
      if (!user) throw new Error('User not found.');

      const oldHash = await hashPassword(oldPassword.trim());
      if (oldHash !== user.passwordHash) throw new Error('Current password is incorrect.');

      user.passwordHash = await hashPassword(newPassword.trim());
      saveUsers(users);
    },

    /* Delete account permanently */
    deleteAccount() {
      const current = this.getCurrentUser();
      if (!current || current.isGuest) return;
      const users = getUsers().filter(u => u.id !== current.id);
      saveUsers(users);
      this.logout();
    },

    /* Save user-specific data (locations / settings) */
    saveUserData(data) {
      const current = this.getCurrentUser();
      if (!current || current.isGuest) return;
      const users = getUsers();
      const idx   = users.findIndex(u => u.id === current.id);
      if (idx >= 0) {
        Object.assign(users[idx], data);
        saveUsers(users);
        this.setSession({ ...current, ...data });
      }
    },

    /* Get saved user-specific data */
    getUserData() {
      const current = this.getCurrentUser();
      if (!current) return null;
      if (current.isGuest) return { savedLocations: [], settings: null };
      const users = getUsers();
      return users.find(u => u.id === current.id) || null;
    }
  };
})();
