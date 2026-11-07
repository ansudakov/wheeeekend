/* Wheee!ekend — аккаунты и облачная синхронизация.

   Здесь нет Firebase SDK: работаем с Firebase по обычным HTTP-запросам
   (Auth REST + Firestore REST). Причины:
     • приложение остаётся лёгким и не тянет ~600 КБ с внешнего CDN;
     • нет зависимости от загрузки сторонних скриптов;
     • офлайн-режим не страдает: без сети мы просто откладываем сохранение.

   Если public/firebase-config.js не заполнен (enabled: false),
   приложение работает как раньше — гостем, только на памяти телефона. */

(function () {
  "use strict";

  const CONFIG = window.WHEEE_FIREBASE || {};

  const STORAGE = {
    session: "wheee_account_v1",
    dirty: "wheee_cloud_dirty_v1",
    lastSync: "wheee_cloud_last_sync_v1"
  };

  const DEFAULTS = {
    authBase: "https://identitytoolkit.googleapis.com/v1",
    tokenBase: "https://securetoken.googleapis.com/v1",
    firestoreBase: "https://firestore.googleapis.com/v1"
  };

  // Понятные тексты вместо кодов Firebase.
  const AUTH_ERRORS = {
    EMAIL_EXISTS: "Этот адрес уже зарегистрирован. Попробуйте войти.",
    EMAIL_NOT_FOUND: "Аккаунт с таким адресом не найден.",
    INVALID_PASSWORD: "Неверный пароль.",
    INVALID_LOGIN_CREDENTIALS: "Неверная почта или пароль.",
    INVALID_EMAIL: "Проверьте адрес почты.",
    MISSING_PASSWORD: "Введите пароль.",
    WEAK_PASSWORD: "Пароль слишком простой: нужно минимум 6 символов.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Слишком много попыток. Подождите пару минут.",
    OPERATION_NOT_ALLOWED: "Вход по почте не включён в настройках Firebase.",
    PASSWORD_LOGIN_DISABLED: "Вход по паролю отключён в настройках Firebase.",
    USER_DISABLED: "Этот аккаунт отключён.",
    INVALID_REFRESH_TOKEN: "Сессия истекла. Войдите заново.",
    TOKEN_EXPIRED: "Сессия истекла. Войдите заново."
  };

  class CloudError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = "CloudError";
      this.code = code;
    }
  }

  const state = {
    session: null,
    user: null,
    syncing: false,
    dirty: false,
    lastSyncAt: null,
    lastError: null,
    listeners: []
  };

  // ==================== КОНФИГУРАЦИЯ ====================

  function isConfigured() {
    return Boolean(CONFIG.enabled && CONFIG.apiKey && CONFIG.projectId);
  }

  function authBase() {
    return (CONFIG.authBase || DEFAULTS.authBase).replace(/\/+$/, "");
  }

  function tokenBase() {
    return (CONFIG.tokenBase || DEFAULTS.tokenBase).replace(/\/+$/, "");
  }

  function firestoreBase() {
    return (CONFIG.firestoreBase || DEFAULTS.firestoreBase).replace(/\/+$/, "");
  }

  function docsUrl(path) {
    return (
      `${firestoreBase()}/projects/${encodeURIComponent(CONFIG.projectId)}` +
      `/databases/(default)/documents/${path}`
    );
  }

  // ==================== СЕССИЯ ====================

  function readSession() {
    try {
      const raw = localStorage.getItem(STORAGE.session);
      const s = raw ? JSON.parse(raw) : null;
      return s && s.uid && s.refreshToken ? s : null;
    } catch (e) {
      return null;
    }
  }

  function writeSession(session) {
    try {
      localStorage.setItem(STORAGE.session, JSON.stringify(session));
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE.session);
    } catch (e) {}
    state.session = null;
    state.user = null;
    setDirty(false);
    notify();
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    try {
      if (state.dirty) localStorage.setItem(STORAGE.dirty, "1");
      else localStorage.removeItem(STORAGE.dirty);
    } catch (e) {}
  }

  function notify() {
    const snapshot = status();
    state.listeners.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (e) {}
    });
  }

  function status() {
    return {
      configured: isConfigured(),
      signedIn: Boolean(state.user),
      user: state.user ? { uid: state.user.uid, email: state.user.email } : null,
      syncing: state.syncing,
      dirty: state.dirty,
      lastSyncAt: state.lastSyncAt,
      lastError: state.lastError
    };
  }

  // ==================== HTTP ====================

  async function httpJson(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = null;
      }
      return { res, data };
    } catch (err) {
      const reason = err && err.name === "AbortError" ? "истекло время ожидания" : "нет связи";
      throw new CloudError("NETWORK", `Сервер аккаунтов недоступен (${reason}). Проверьте интернет.`);
    } finally {
      clearTimeout(timer);
    }
  }

  function authErrorMessage(data) {
    const raw = (data && data.error && data.error.message) || "";
    const code = String(raw).split(" : ")[0].split(":")[0].trim();
    return { code: code || "UNKNOWN", message: AUTH_ERRORS[code] || "Не удалось выполнить вход. Попробуйте ещё раз." };
  }

  async function authCall(endpoint, body) {
    if (!isConfigured()) {
      throw new CloudError("NOT_CONFIGURED", "Аккаунты ещё не подключены.");
    }
    const url = `${authBase()}/accounts:${endpoint}?key=${encodeURIComponent(CONFIG.apiKey)}`;
    const { res, data } = await httpJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = authErrorMessage(data);
      throw new CloudError(err.code, err.message);
    }
    return data;
  }

  function sessionFromAuth(data) {
    return {
      uid: data.localId,
      email: data.email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000
    };
  }

  async function refreshSession() {
    const current = state.session;
    if (!current || !current.refreshToken) {
      throw new CloudError("AUTH_REQUIRED", "Нужно войти в аккаунт.");
    }
    const url = `${tokenBase()}/token?key=${encodeURIComponent(CONFIG.apiKey)}`;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken
    });
    const { res, data } = await httpJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!res.ok) {
      // Токен отозван или аккаунт удалён — сессию нужно сбросить.
      clearSession();
      throw new CloudError("AUTH_EXPIRED", "Сессия истекла. Войдите заново.");
    }
    const next = {
      ...current,
      idToken: data.id_token,
      refreshToken: data.refresh_token || current.refreshToken,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
    };
    state.session = next;
    writeSession(next);
    return next;
  }

  async function ensureToken() {
    const s = state.session;
    if (!s) throw new CloudError("AUTH_REQUIRED", "Нужно войти в аккаунт.");
    if (s.expiresAt - Date.now() > 60_000 && s.idToken) return s;
    return refreshSession();
  }

  // ==================== FIRESTORE ====================

  function firestoreErrorMessage(res, data) {
    if (res.status === 403) {
      return new CloudError("FORBIDDEN", "Нет доступа к данным аккаунта. Проверьте правила Firestore.");
    }
    if (res.status === 401) {
      return new CloudError("AUTH_EXPIRED", "Сессия истекла. Войдите заново.");
    }
    const message = (data && data.error && data.error.message) || `Ошибка ${res.status}`;
    return new CloudError("FIRESTORE", `Не удалось сохранить данные: ${message}`);
  }

  async function fsGet(path, options = {}) {
    const { auth = true } = options;
    let session = null;
    if (auth) session = await ensureToken();

    let { res, data } = await httpJson(docsUrl(path), {
      headers: session ? { Authorization: `Bearer ${session.idToken}` } : {}
    });

    // Токен мог протухнуть между проверкой и запросом — обновляем и повторяем.
    if (res.status === 401 && auth) {
      session = await refreshSession();
      ({ res, data } = await httpJson(docsUrl(path), {
        headers: { Authorization: `Bearer ${session.idToken}` }
      }));
    }

    if (res.status === 404) return null;
    if (!res.ok) throw firestoreErrorMessage(res, data);
    return data;
  }

  async function fsPatch(path, fields, maskKeys) {
    const session = await ensureToken();
    const query = maskKeys
      .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
      .join("&");
    const url = `${docsUrl(path)}?${query}`;

    let { res, data } = await httpJson(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    if (res.status === 401) {
      const fresh = await refreshSession();
      ({ res, data } = await httpJson(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${fresh.idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields })
      }));
    }

    if (!res.ok) throw firestoreErrorMessage(res, data);
    return data;
  }

  function decodeDoc(doc) {
    const fields = (doc && doc.fields) || {};
    const inviteCode = fields.inviteCode && fields.inviteCode.stringValue;
    let memory = null;
    if (fields.payload && fields.payload.stringValue) {
      try {
        memory = JSON.parse(fields.payload.stringValue);
      } catch (e) {
        memory = null;
      }
    }
    return {
      inviteCode: inviteCode || null,
      memory,
      updatedAt: (fields.updatedAt && fields.updatedAt.timestampValue) || null
    };
  }

  // ==================== ПРИГЛАШЕНИЯ ====================

  function normalizeCode(code) {
    return String(code || "").trim().toLowerCase();
  }

  async function getInvite(code) {
    const normalized = normalizeCode(code);
    if (!normalized) return null;
    const doc = await fsGet(`invites/${encodeURIComponent(normalized)}`, { auth: false });
    if (!doc) return null;
    const fields = doc.fields || {};
    return {
      code: normalized,
      usedBy: (fields.usedBy && fields.usedBy.stringValue) || null,
      note: (fields.note && fields.note.stringValue) || ""
    };
  }

  async function claimInvite(code, uid) {
    const normalized = normalizeCode(code);
    const invite = await getInvite(normalized);
    if (!invite) throw new CloudError("INVITE_NOT_FOUND", "Код приглашения не найден.");
    if (invite.usedBy && invite.usedBy !== uid) {
      throw new CloudError("INVITE_USED", "Этот код уже использован.");
    }
    if (invite.usedBy === uid) return true; // повторная попытка — уже наш код
    await fsPatch(
      `invites/${encodeURIComponent(normalized)}`,
      {
        usedBy: { stringValue: uid },
        usedAt: { timestampValue: new Date().toISOString() }
      },
      ["usedBy", "usedAt"]
    );
    return true;
  }

  // ==================== РЕГИСТРАЦИЯ И ВХОД ====================

  async function register({ email, password, inviteCode }) {
    const code = normalizeCode(inviteCode);
    if (!code) throw new CloudError("INVITE_REQUIRED", "Введите код приглашения.");

    // Код проверяем до создания аккаунта, чтобы не плодить пустые учётки.
    const invite = await getInvite(code);
    if (!invite) {
      throw new CloudError("INVITE_NOT_FOUND", "Код приглашения не найден. Проверьте написание.");
    }
    if (invite.usedBy) {
      throw new CloudError("INVITE_USED", "Этот код уже использован.");
    }

    const data = await authCall("signUp", {
      email: String(email || "").trim(),
      password,
      returnSecureToken: true
    });
    const session = sessionFromAuth(data);
    state.session = session;
    state.user = { uid: session.uid, email: session.email };
    writeSession({ ...session, inviteCode: code });

    // Сначала закрепляем приглашение за собой, потом создаём документ памяти:
    // так правила Firestore могут проверить, что пользователь пришёл по коду.
    await claimInvite(code, session.uid);
    await fsPatch(
      `users/${encodeURIComponent(session.uid)}`,
      {
        email: { stringValue: session.email || "" },
        inviteCode: { stringValue: code },
        payload: { stringValue: JSON.stringify({}) },
        updatedAt: { timestampValue: new Date().toISOString() },
        app: { stringValue: "Wheee!ekend" }
      },
      ["email", "inviteCode", "payload", "updatedAt", "app"]
    );

    notify();
    return state.user;
  }

  async function signIn({ email, password }) {
    const data = await authCall("signInWithPassword", {
      email: String(email || "").trim(),
      password,
      returnSecureToken: true
    });
    const session = sessionFromAuth(data);
    state.session = session;
    state.user = { uid: session.uid, email: session.email };
    writeSession(session);
    notify();

    // Если аккаунт создавали на другом устройстве — подтянем код приглашения,
    // чтобы правила доступа продолжили пускать к документу.
    try {
      const doc = await fsGet(`users/${encodeURIComponent(session.uid)}`);
      const decoded = decodeDoc(doc);
      if (decoded.inviteCode) {
        writeSession({ ...session, inviteCode: decoded.inviteCode });
      }
    } catch (e) {
      // Не критично: доступ проверится при первом сохранении.
    }

    return state.user;
  }

  function signOut() {
    clearSession();
  }

  async function resetPassword(email) {
    const address = String(email || "").trim();
    if (!address) throw new CloudError("EMAIL_REQUIRED", "Сначала введите адрес почты.");
    await authCall("sendOAuthPwResetEmail", {
      requestType: "PASSWORD_RESET",
      email: address
    });
    return true;
  }

  // ==================== ПАМЯТЬ ====================

  async function pullMemory() {
    if (!state.session) return null;
    const doc = await fsGet(`users/${encodeURIComponent(state.session.uid)}`);
    if (!doc) return null;
    return decodeDoc(doc).memory;
  }

  async function pushMemory(memory) {
    if (!state.session || !memory) return false;
    state.syncing = true;
    notify();
    try {
      await fsPatch(
        `users/${encodeURIComponent(state.session.uid)}`,
        {
          payload: { stringValue: JSON.stringify(memory) },
          updatedAt: { timestampValue: new Date().toISOString() }
        },
        ["payload", "updatedAt"]
      );
      state.lastSyncAt = Date.now();
      try {
        localStorage.setItem(STORAGE.lastSync, String(state.lastSyncAt));
      } catch (e) {}
      setDirty(false);
      state.lastError = null;
      return true;
    } catch (err) {
      setDirty(true);
      state.lastError = err.code || "ERROR";
      return false;
    } finally {
      state.syncing = false;
      notify();
    }
  }

  // ==================== ПУБЛИЧНЫЙ ИНТЕРФЕЙС ====================

  async function init() {
    const saved = readSession();
    state.lastSyncAt = Number(localStorage.getItem(STORAGE.lastSync) || 0) || null;
    state.dirty = localStorage.getItem(STORAGE.dirty) === "1";
    if (saved) {
      state.session = saved;
      state.user = { uid: saved.uid, email: saved.email };
      notify();
      // Тихо обновляем токен, чтобы первый запрос не ждал.
      if (!saved.expiresAt || saved.expiresAt - Date.now() < 120_000) {
        try {
          await refreshSession();
        } catch (e) {
          // Если обновить не вышло из-за сети — сессия остаётся, повторим позже.
        }
      }
    } else {
      notify();
    }
    return state.user;
  }

  function currentUser() {
    return state.user ? { uid: state.user.uid, email: state.user.email } : null;
  }

  function onChange(cb) {
    if (typeof cb === "function") state.listeners.push(cb);
    return () => {
      state.listeners = state.listeners.filter((fn) => fn !== cb);
    };
  }

  window.WheeeCloud = {
    isConfigured,
    init,
    currentUser,
    status,
    onChange,
    register,
    signIn,
    signOut,
    resetPassword,
    pullMemory,
    pushMemory,
    hasPending: () => state.dirty,
    CloudError
  };
})();
