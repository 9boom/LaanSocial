/* Controls the profile menu and settings/theme dialog. */

/* ---------- PROFILE DROPDOWN ---------- */
const profileAvatarBtn = document.getElementById('profileAvatarBtn');
const profileDropdown  = document.getElementById('profileDropdown');

profileAvatarBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  profileDropdown.classList.toggle('open');
});
profileDropdown.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => profileDropdown.classList.remove('open'));

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

saveSettingsBtn.addEventListener('click', () => {
  document.body.classList.toggle('theme-dark', themeSelect.value === 'dark');
  closeSettings();
});
