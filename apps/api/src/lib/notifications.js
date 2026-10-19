// In-app notification helper. One place to honor the user's in-app preference.
'use strict';
const { store } = require('./store');

function wantsInApp(userId) {
  const u = store.get('users', userId);
  const prefs = u && u.notificationPrefs;
  return !prefs || prefs.inApp !== false;
}

function notifyUser(userId, type, payload) {
  if (userId == null || !wantsInApp(userId)) return false;
  store.insert('notifications', {
    userId,
    type,
    payload: payload || {},
    read: false,
    at: new Date().toISOString(),
  });
  return true;
}

module.exports = { wantsInApp, notifyUser };
