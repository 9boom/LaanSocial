/* Controls the profile menu and settings/theme dialog. */

/* ---------- PROFILE DROPDOWN ---------- */
const profileAvatarBtn = document.getElementById('profileAvatarBtn');
const profileDropdown  = document.getElementById('profileDropdown');
const logoutBtn        = document.getElementById('logoutBtn');

profileAvatarBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  profileDropdown.classList.toggle('open');
});
profileDropdown.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => profileDropdown.classList.remove('open'));

/* Logout Handler */
logoutBtn?.addEventListener('click', async () => {
  if (window.IDBStorage) {
    await window.IDBStorage.removeItem('current_loggedin');
  }
  window.location.reload();
});

/* ---------- SETTINGS MODAL / THEME SWITCH ---------- */
const settingsOverlay  = document.getElementById('settingsOverlay');
const openSettingsBtn  = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn= document.getElementById('cancelSettingsBtn');
const saveSettingsBtn  = document.getElementById('saveSettingsBtn');
const themeSelect      = document.getElementById('themeSelect');

function currentTheme(){
  return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
}
function openSettings(){
  profileDropdown.classList.remove('open');
  themeSelect.value = currentTheme();
  settingsOverlay.classList.add('open');
}
function closeSettings(){
  settingsOverlay.classList.remove('open');
}

openSettingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if(e.target === settingsOverlay) closeSettings();
});

saveSettingsBtn.addEventListener('click', async () => {
  const selectedTheme = themeSelect.value;
  document.body.classList.toggle('theme-dark', selectedTheme === 'dark');
  
  // Save theme preference to IndexedDB
  if (window.IDBStorage) {
    try {
      await window.IDBStorage.setItem('themestate', selectedTheme);
    } catch (err) {
      console.error('Failed to save theme to IndexedDB:', err);
    }
  }
  
  closeSettings();
});
