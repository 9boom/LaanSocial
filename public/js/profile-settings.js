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
const changeProfileImageBtn = document.getElementById('changeProfileImageBtn');
const editSocialMediaBtn = document.getElementById('editSocialMediaBtn');
const settingsAvatarPicker = document.getElementById('settingsAvatarPicker');
const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');
const settingsAvatarList = document.getElementById('settingsAvatarList');
const settingsSocialForm = document.getElementById('settingsSocialForm');
const settingsFacebook = document.getElementById('settingsFacebook');
const settingsInstagram = document.getElementById('settingsInstagram');
const settingsProfileError = document.getElementById('settingsProfileError');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const deleteAccountOverlay = document.getElementById('deleteAccountOverlay');
const closeDeleteAccountBtn = document.getElementById('closeDeleteAccountBtn');
const cancelDeleteAccountBtn = document.getElementById('cancelDeleteAccountBtn');
const confirmDeleteAccountBtn = document.getElementById('confirmDeleteAccountBtn');
const deleteAccountError = document.getElementById('deleteAccountError');

function getFallbackProfileAvatar() {
  return (window.LaanAvatars && window.LaanAvatars.getDefaultAvatar()) || '';
}

const SOCIAL_DOMAINS = {
  Facebook: 'facebook.com',
  Instagram: 'instagram.com'
};
let settingsSelectedAvatar = '';
let profileImagesLoaded = false;
let settingsSaving = false;

function currentTheme(){
  return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
}

function currentUser(){
  return window.LaanCurrentUser || {};
}

function currentSocialMedia(){
  const socialMedia = currentUser().social_media || {};
  return {
    facebook: typeof socialMedia.facebook === 'string' ? socialMedia.facebook : '',
    instagram: typeof socialMedia.instagram === 'string' ? socialMedia.instagram : ''
  };
}

function setSettingsError(message){
  if(!settingsProfileError) return;
  settingsProfileError.textContent = message || '';
  settingsProfileError.hidden = !message;
}

function setSaveLoading(isLoading){
  if(!saveSettingsBtn) return;
  settingsSaving = isLoading;
  if(!saveSettingsBtn.dataset.idleText) saveSettingsBtn.dataset.idleText = saveSettingsBtn.textContent;
  saveSettingsBtn.disabled = isLoading || !isSocialFormValid(false);
  saveSettingsBtn.textContent = isLoading ? 'กำลังบันทึก...' : saveSettingsBtn.dataset.idleText;
}

function getCssEscaped(value){
  if(window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value || '').replace(/["\\]/g, '\\$&');
}

function isAllowedSocialHostname(hostname, domain){
  return hostname === domain || hostname === `www.${domain}`;
}

function normalizeExternalUrl(value, label){
  const raw = typeof value === 'string' ? value.trim() : '';
  if(!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(candidate);
    if(url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid protocol');
    if(!isAllowedSocialHostname(url.hostname.toLowerCase(), SOCIAL_DOMAINS[label])) throw new Error('Invalid domain');
    return url.href;
  } catch (error) {
    throw new Error(`ลิงก์ ${label} ต้องเป็น ${SOCIAL_DOMAINS[label]} เท่านั้น`);
  }
}

function validateSocialValue(input, label){
  if(!input) return '';
  const raw = input.value.trim();
  if(!raw){
    input.setCustomValidity('');
    return '';
  }

  try {
    normalizeExternalUrl(raw, label);
    input.setCustomValidity('');
    return '';
  } catch (error) {
    input.setCustomValidity(error.message);
    return error.message;
  }
}

function socialValidationMessage(){
  if(!settingsSocialForm || settingsSocialForm.hidden) return '';
  const facebookMessage = validateSocialValue(settingsFacebook, 'Facebook');
  const instagramMessage = validateSocialValue(settingsInstagram, 'Instagram');
  return facebookMessage || instagramMessage;
}

function isSocialFormValid(showError){
  const message = socialValidationMessage();
  if(showError) setSettingsError(message);
  return !message;
}

function updateSaveAvailability(){
  if(!saveSettingsBtn || settingsSaving) return;
  saveSettingsBtn.disabled = !isSocialFormValid(true);
}

async function patchCurrentUser(url, payload){
  if(!window.PublicChat || typeof window.PublicChat.authHeaders !== 'function'){
    throw new Error('กรุณาเข้าสู่ระบบใหม่');
  }

  const headers = await window.PublicChat.authHeaders();
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));

  if(!response.ok || data.status === 'error'){
    throw new Error(data.message || 'บันทึกการตั้งค่าโปรไฟล์ไม่สำเร็จ');
  }

  return data.user;
}

async function deleteCurrentUser(){
  if(!window.PublicChat || typeof window.PublicChat.authHeaders !== 'function'){
    throw new Error('กรุณาเข้าสู่ระบบใหม่');
  }

  const userId = currentUser().user_id || '';
  if(!userId) throw new Error('ไม่พบข้อมูลบัญชีผู้ใช้');

  const headers = await window.PublicChat.authHeaders();
  const response = await fetch('/api/me', {
    method: 'DELETE',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user_id: userId })
  });
  const data = await response.json().catch(() => ({}));

  if(!response.ok || data.status === 'error'){
    throw new Error(data.message || 'ลบบัญชีไม่สำเร็จ');
  }

  return data;
}

function applyUpdatedUser(user){
  if(!user) return;
  window.LaanCurrentUser = user;

  if(user.user_profile_url){
    profileAvatarBtn.src = user.user_profile_url;
    document.querySelectorAll('.msg.own img.avatar, .online-member.self img').forEach(img => {
      img.src = user.user_profile_url;
    });
  }

  const userId = user.user_id || '';
  if(userId){
    document.querySelectorAll(`.user-profile-trigger[data-profile-id="${getCssEscaped(userId)}"]`).forEach(el => {
      if(user.user_profile_url) el.dataset.profileAvatar = user.user_profile_url;
      el.dataset.profileFacebook = user.social_media?.facebook || '';
      el.dataset.profileInstagram = user.social_media?.instagram || '';
      if(el.matches('img')) el.src = user.user_profile_url || el.src;
    });
  }

  if(window.PublicChat && typeof window.PublicChat.updateCurrentUserSnapshot === 'function'){
    window.PublicChat.updateCurrentUserSnapshot(user);
  } else if(window.PublicChat && typeof window.PublicChat.setCurrentUser === 'function'){
    window.PublicChat.setCurrentUser(user);
  }

  document.dispatchEvent(new CustomEvent('laan:user-ready', {
    detail: { user }
  }));
}

function setSelectedSettingsAvatar(src, option){
  settingsSelectedAvatar = src || getFallbackProfileAvatar();
  if(settingsAvatarPreview) settingsAvatarPreview.src = settingsSelectedAvatar;
  settingsAvatarList?.querySelectorAll('.settings-avatar-option').forEach(item => {
    item.classList.toggle('active', item === option || item.dataset.avatar === settingsSelectedAvatar);
  });
}

function renderSettingsAvatarOptions(profileImages){
  if(!settingsAvatarList) return;
  settingsAvatarList.innerHTML = '';
  const fallback = getFallbackProfileAvatar();
  const images = (Array.isArray(profileImages) && profileImages.length) ? profileImages : (fallback ? [{
    name: 'annonymous',
    src: fallback
  }] : []);
  const activeAvatar = currentUser().user_profile_url || settingsSelectedAvatar || fallback;

  images.forEach((profileImage) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'settings-avatar-option';
    option.dataset.avatar = profileImage.src;
    option.setAttribute('aria-label', profileImage.name);

    const img = document.createElement('img');
    img.src = profileImage.src;
    img.alt = profileImage.name;

    option.appendChild(img);
    option.addEventListener('click', () => {
      setSelectedSettingsAvatar(profileImage.src, option);
      setSettingsError('');
    });

    settingsAvatarList.appendChild(option);
  });

  setSelectedSettingsAvatar(activeAvatar);
}

async function loadSettingsProfileImages(){
  if(profileImagesLoaded) return;

  try {
    const profileImages = window.LaanAvatars
      ? await window.LaanAvatars.fetchImages()
      : await (await fetch('/api/profile-images')).json();
    renderSettingsAvatarOptions(Array.isArray(profileImages) ? profileImages : []);
    profileImagesLoaded = true;
  } catch (error) {
    console.error(error);
    renderSettingsAvatarOptions([]);
    profileImagesLoaded = true;
  }
}

function syncSettingsProfileFields(){
  settingsSelectedAvatar = currentUser().user_profile_url || getFallbackProfileAvatar();
  if(settingsAvatarPreview) settingsAvatarPreview.src = settingsSelectedAvatar;
  setSelectedSettingsAvatar(settingsSelectedAvatar);

  const socialMedia = currentSocialMedia();
  if(settingsFacebook) settingsFacebook.value = socialMedia.facebook;
  if(settingsInstagram) settingsInstagram.value = socialMedia.instagram;
  setSettingsError('');
}

function openSettings(){
  profileDropdown.classList.remove('open');
  themeSelect.value = currentTheme();
  syncSettingsProfileFields();
  settingsOverlay.classList.add('open');
  updateSaveAvailability();
}
function closeSettings(){
  settingsOverlay.classList.remove('open');
  setSettingsError('');
  if(saveSettingsBtn) saveSettingsBtn.disabled = false;
}

function setDeleteAccountError(message){
  if(!deleteAccountError) return;
  deleteAccountError.textContent = message || '';
  deleteAccountError.hidden = !message;
}

function setDeleteLoading(isLoading){
  if(!confirmDeleteAccountBtn) return;
  if(!confirmDeleteAccountBtn.dataset.idleText) confirmDeleteAccountBtn.dataset.idleText = confirmDeleteAccountBtn.textContent;
  confirmDeleteAccountBtn.disabled = isLoading;
  confirmDeleteAccountBtn.textContent = isLoading ? 'กำลังลบ...' : confirmDeleteAccountBtn.dataset.idleText;
}

function openDeleteAccountModal(){
  setDeleteAccountError('');
  deleteAccountOverlay?.classList.add('open');
}

function closeDeleteAccountModal(){
  deleteAccountOverlay?.classList.remove('open');
  setDeleteAccountError('');
  setDeleteLoading(false);
}

openSettingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if(e.target === settingsOverlay) closeSettings();
});

deleteAccountBtn?.addEventListener('click', openDeleteAccountModal);
closeDeleteAccountBtn?.addEventListener('click', closeDeleteAccountModal);
cancelDeleteAccountBtn?.addEventListener('click', closeDeleteAccountModal);
deleteAccountOverlay?.addEventListener('click', (e) => {
  if(e.target === deleteAccountOverlay) closeDeleteAccountModal();
});

confirmDeleteAccountBtn?.addEventListener('click', async () => {
  setDeleteAccountError('');
  setDeleteLoading(true);

  try {
    await deleteCurrentUser();
    window.location.reload();
  } catch (error) {
    console.error('Failed to delete account:', error);
    setDeleteAccountError(error.message || 'ลบบัญชีไม่สำเร็จ');
    setDeleteLoading(false);
  }
});

changeProfileImageBtn?.addEventListener('click', async () => {
  if(!settingsAvatarPicker) return;
  settingsAvatarPicker.hidden = !settingsAvatarPicker.hidden;
  changeProfileImageBtn.classList.toggle('is-open', !settingsAvatarPicker.hidden);
  changeProfileImageBtn.setAttribute('aria-expanded', String(!settingsAvatarPicker.hidden));
  if(!settingsAvatarPicker.hidden) await loadSettingsProfileImages();
});

editSocialMediaBtn?.addEventListener('click', () => {
  if(!settingsSocialForm) return;
  settingsSocialForm.hidden = !settingsSocialForm.hidden;
  editSocialMediaBtn.classList.toggle('is-open', !settingsSocialForm.hidden);
  editSocialMediaBtn.setAttribute('aria-expanded', String(!settingsSocialForm.hidden));
  updateSaveAvailability();
});

settingsFacebook?.addEventListener('input', () => {
  updateSaveAvailability();
});

settingsInstagram?.addEventListener('input', () => {
  updateSaveAvailability();
});

saveSettingsBtn.addEventListener('click', async () => {
  const selectedTheme = themeSelect.value;
  setSettingsError('');
  if(!isSocialFormValid(true)) return;
  setSaveLoading(true);

  try {
    document.body.classList.toggle('theme-dark', selectedTheme === 'dark');

    // Save theme preference to IndexedDB
    if (window.IDBStorage) {
      try {
        await window.IDBStorage.setItem('themestate', selectedTheme);
      } catch (err) {
        console.error('Failed to save theme to IndexedDB:', err);
      }
    }

    let updatedUser = null;
    const user = currentUser();

    if(settingsAvatarPicker && !settingsAvatarPicker.hidden && settingsSelectedAvatar && settingsSelectedAvatar !== user.user_profile_url){
      updatedUser = await patchCurrentUser('/api/me/profile-image', {
        user_profile_url: settingsSelectedAvatar
      });
      applyUpdatedUser(updatedUser);
    }

    if(settingsSocialForm && !settingsSocialForm.hidden){
      const socialMedia = {
        facebook: normalizeExternalUrl(settingsFacebook?.value, 'Facebook'),
        instagram: normalizeExternalUrl(settingsInstagram?.value, 'Instagram')
      };
      const currentSocial = currentSocialMedia();

      if(socialMedia.facebook !== currentSocial.facebook || socialMedia.instagram !== currentSocial.instagram){
        updatedUser = await patchCurrentUser('/api/me/social-media', socialMedia);
        applyUpdatedUser(updatedUser);
      }
    }

    closeSettings();
  } catch (err) {
    console.error('Failed to save settings:', err);
    setSettingsError(err.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
  } finally {
    setSaveLoading(false);
  }
});
