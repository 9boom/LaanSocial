/* Runs the first-load onboarding flow and applies selected profile details. */

/* ---------- STARTUP ONBOARDING OVERLAY ---------- */
(function(){
  const overlay        = document.getElementById('startupOverlay');
  const track          = document.getElementById('startupTrack');
  const nameField      = document.getElementById('startupNameField');
  const nicknameInput  = document.getElementById('startupNickname');
  const nextBtn        = document.getElementById('startupNextBtn');
  const avatarBtn      = document.getElementById('startupAvatarBtn');
  const avatarImg      = document.getElementById('startupAvatarImg');
  const avatarList     = document.getElementById('startupAvatarList');
  const uniField       = document.getElementById('startupUniField');
  const uniSelect      = document.getElementById('startupUni');
  const termsField     = document.getElementById('startupTermsField');
  const termsCheckbox  = document.getElementById('startupTerms');
  const connectBtn     = document.getElementById('startupConnectBtn');
  const addUniBtn      = document.getElementById('startupAddUniBtn');

  if(!overlay || !track || !nameField || !nicknameInput || !nextBtn || !connectBtn) return;

  const FALLBACK_AVATAR = 'assets/sim_db/users_profile_image/annonymous.png';
  const STORAGE = window.IDBStorage;
  const ACCESS_KEY_PREFIX = 'access_hkey_';
  const MESSAGE_NAME_TAKEN = 'ชื่อผู้ใช้นี้มีคนใช้ไปแล้วหรือ อุปกรณ์คุณไม่ได้ล็อกอินด้วยชื่อนี้มาก่อน';
  const MESSAGE_NO_PERMISSION = 'คุณไม่มีสิทธิ์ใช้งานชื่อนี้';
  const MESSAGE_STORAGE_UNAVAILABLE = 'เบราว์เซอร์นี้ไม่รองรับ IndexedDB จึงไม่สามารถเข้าสู่ระบบได้';
  const MESSAGE_NETWORK = 'ระบบเชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';

  let selectedAvatar = (typeof AVATAR_ASSETS !== 'undefined' && AVATAR_ASSETS.dog) || FALLBACK_AVATAR;
  let reservedNick = '';

  const nameError = document.createElement('p');
  nameError.className = 'startup-error';
  nameError.id = 'startupNameError';
  nameError.setAttribute('aria-live', 'polite');
  nameError.hidden = true;
  nameField.appendChild(nameError);

  const connectError = document.createElement('p');
  connectError.className = 'startup-error startup-error-center';
  connectError.setAttribute('aria-live', 'polite');
  connectError.hidden = true;
  connectBtn.insertAdjacentElement('beforebegin', connectError);

  // always start with the overlay locked until auto-login or manual login succeeds
  document.body.style.overflow = 'hidden';

  function setFieldError(field, errorElement, message){
    if(field) field.classList.toggle('invalid', Boolean(message));
    if(errorElement){
      errorElement.textContent = message || '';
      errorElement.hidden = !message;
    }
  }

  function clearNameError(){
    setFieldError(nameField, nameError, '');
  }

  function clearConnectError(){
    setFieldError(null, connectError, '');
  }

  function setButtonLoading(button, isLoading){
    if(!button) return;
    if(!button.dataset.idleText) button.dataset.idleText = button.textContent;
    button.disabled = isLoading;
    button.classList.toggle('is-loading', isLoading);
    button.textContent = isLoading ? '' : button.dataset.idleText;
    button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  function getApiMessage(error, fallback){
    return error && error.message ? error.message : fallback;
  }

  async function fetchGeneratedAccessKey(){
    const response = await fetch('/api/auth/access-hkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if(!response.ok || data.status === 'error' || !data.access_hkey){
      throw new Error(data.message || 'ไม่สามารถสร้างรหัสเข้าสู่ระบบได้');
    }
    return data.access_hkey;
  }

  async function postLogin(payload){
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if(!response.ok || data.status === 'error'){
      const error = new Error(data.message || MESSAGE_NETWORK);
      error.code = data.code || 'request_failed';
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function canUseStorage(){
    return STORAGE && typeof STORAGE.getItem === 'function' && typeof STORAGE.setItem === 'function';
  }

  async function getStoredAccessKey(userId){
    if(!canUseStorage()) return undefined;
    return STORAGE.getItem(`${ACCESS_KEY_PREFIX}${userId}`);
  }

  async function saveSession(userId, rawAccessKey){
    if(!canUseStorage()) throw new Error(MESSAGE_STORAGE_UNAVAILABLE);
    await STORAGE.setItem(`${ACCESS_KEY_PREFIX}${userId}`, rawAccessKey);
    await STORAGE.setItem('current_loggedin', userId);
  }

  function applyLoggedInUser(user){
    if(!user) return;
    window.LaanCurrentUser = user;

    if(user.user_nick){
      const nickEl = document.querySelector('.profile-nick b');
      if(nickEl) nickEl.textContent = user.user_nick;
      nicknameInput.value = user.user_nick;
    }

    if(user.user_uniname){
      const uniEl = document.querySelector('.profile-uni');
      if(uniEl) uniEl.textContent = user.user_uniname;
      if(uniSelect) uniSelect.value = user.user_uniname;
    }

    if(user.user_profile_url){
      selectedAvatar = user.user_profile_url;
      if(avatarImg) avatarImg.src = user.user_profile_url;
      if(typeof MY_AVATAR !== 'undefined') MY_AVATAR = user.user_profile_url;

      const profileAvatar = document.getElementById('profileAvatarBtn');
      if(profileAvatar) profileAvatar.src = user.user_profile_url;
      document.querySelectorAll('.msg.own img.avatar, .online-member.self img').forEach(img => {
        img.src = user.user_profile_url;
      });
    }

    document.dispatchEvent(new CustomEvent('laan:user-ready', {
      detail: { user }
    }));
  }

  function closeStartupOverlay(){
    overlay.classList.add('fade-out');
    document.body.style.overflow = '';
    overlay.addEventListener('transitionend', () => {
      overlay.style.display = 'none';
    }, { once:true });
  }

  function goToStep1(message){
    track.classList.remove('show-step2');
    setFieldError(nameField, nameError, message || '');
    window.setTimeout(() => nicknameInput.focus(), 120);
  }

  function goToStep2(){
    clearNameError();
    track.classList.add('show-step2');
    overlay.scrollTop = 0;
    window.setTimeout(() => {
      const uniTrigger = document.getElementById('startupUniTrigger');
      (uniTrigger || uniSelect)?.focus();
    }, 560);
  }

  // Stores the active avatar choice and mirrors it into the preview button.
  function setSelectedAvatar(src, option){
    selectedAvatar = src;
    avatarImg.src = selectedAvatar;
    avatarList.querySelectorAll('.startup-avatar-option').forEach(item => {
      item.classList.toggle('active', item === option);
    });
  }

  // Renders profile-image options from the API, falling back to the anonymous asset.
  function renderAvatarOptions(profileImages){
    avatarList.innerHTML = '';
    const images = profileImages.length ? profileImages : [{
      name: 'annonymous',
      src: FALLBACK_AVATAR
    }];

    images.forEach((profileImage, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'startup-avatar-option';
      option.dataset.avatar = profileImage.src;
      option.setAttribute('aria-label', profileImage.name);

      const img = document.createElement('img');
      img.src = profileImage.src;
      img.alt = profileImage.name;

      option.appendChild(img);
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedAvatar(profileImage.src, option);
        avatarList.classList.remove('open');
      });

      avatarList.appendChild(option);
      if(index === 0) setSelectedAvatar(profileImage.src, option);
    });
  }

  // Loads profile image choices for the onboarding avatar picker.
  async function loadProfileImages(){
    try {
      const response = await fetch('/api/profile-images');
      if(!response.ok) throw new Error('Unable to load profile images');
      const profileImages = await response.json();
      renderAvatarOptions(Array.isArray(profileImages) ? profileImages : []);
    } catch (error) {
      console.error(error);
      renderAvatarOptions([]);
    }
  }

  async function tryAutoLogin(){
    if(!canUseStorage()) return false;

    try {
      const currentUserId = await STORAGE.getItem('current_loggedin');
      if(!currentUserId) return false;

      const accessKey = await getStoredAccessKey(currentUserId);
      if(!accessKey) return false;

      const data = await postLogin({
        action: 'verify',
        user_id: currentUserId,
        access_hkey: accessKey
      });

      await STORAGE.setItem('current_loggedin', data.user.user_id);
      applyLoggedInUser(data.user);
      closeStartupOverlay();
      return true;
    } catch (error) {
      console.warn('Auto-login failed:', error);
      return false;
    }
  }

  async function handleNext(){
    const nickname = nicknameInput.value.trim();
    clearConnectError();

    if(!nickname){
      setFieldError(nameField, nameError, 'กรุณากรอกชื่อเล่นหรือนามแฝง');
      nicknameInput.focus();
      return;
    }

    setButtonLoading(nextBtn, true);
    clearNameError();

    try {
      const data = await postLogin({
        action: 'check',
        nick: nickname
      });

      if(data.status === 'not_found'){
        reservedNick = nickname;
        goToStep2();
        return;
      }

      if(data.status === 'found' && data.user_id){
        const accessKey = await getStoredAccessKey(data.user_id);
        if(!accessKey){
          setFieldError(nameField, nameError, MESSAGE_NAME_TAKEN);
          nicknameInput.focus();
          return;
        }

        const verifyData = await postLogin({
          action: 'verify',
          user_id: data.user_id,
          nick: nickname,
          access_hkey: accessKey
        });

        await STORAGE.setItem('current_loggedin', verifyData.user.user_id);
        applyLoggedInUser(verifyData.user);
        closeStartupOverlay();
        return;
      }

      setFieldError(nameField, nameError, MESSAGE_NETWORK);
    } catch (error) {
      const message = error.code === 'invalid_credentials' ? MESSAGE_NO_PERMISSION : getApiMessage(error, MESSAGE_NETWORK);
      setFieldError(nameField, nameError, message);
      nicknameInput.focus();
    } finally {
      setButtonLoading(nextBtn, false);
    }
  }

  async function handleConnect(){
    let valid = true;
    clearConnectError();

    if(!uniSelect.value){
      uniField.classList.add('invalid');
      valid = false;
    } else {
      uniField.classList.remove('invalid');
    }

    if(!termsCheckbox.checked){
      termsField.classList.add('invalid');
      valid = false;
    } else {
      termsField.classList.remove('invalid');
    }

    if(!valid) return;

    if(!canUseStorage()){
      setFieldError(null, connectError, MESSAGE_STORAGE_UNAVAILABLE);
      return;
    }

    setButtonLoading(connectBtn, true);

    try {
      const nickname = reservedNick || nicknameInput.value.trim();
      const accessKey = await fetchGeneratedAccessKey();

      const data = await postLogin({
        action: 'create',
        nick: nickname,
        user_uniname: uniSelect.value,
        user_profile_url: selectedAvatar,
        access_hkey: accessKey
      });

      await saveSession(data.user.user_id, accessKey);
      applyLoggedInUser(data.user);
      closeStartupOverlay();
    } catch (error) {
      if(error.code === 'nick_taken'){
        goToStep1(MESSAGE_NAME_TAKEN);
      } else {
        setFieldError(null, connectError, getApiMessage(error, MESSAGE_NETWORK));
      }
    } finally {
      setButtonLoading(connectBtn, false);
    }
  }

  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    avatarList.classList.toggle('open');
  });

  loadProfileImages();
  tryAutoLogin().then((loggedIn) => {
    if(!loggedIn) nicknameInput.focus();
  });

  document.addEventListener('click', (e) => {
    if(!avatarList.contains(e.target) && e.target !== avatarBtn && !avatarBtn.contains(e.target)){
      avatarList.classList.remove('open');
    }
  });

  nextBtn.addEventListener('click', handleNext);
  nicknameInput.addEventListener('input', () => {
    reservedNick = '';
    clearNameError();
  });
  nicknameInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); nextBtn.click(); }
  });

  connectBtn.addEventListener('click', handleConnect);

  uniSelect.addEventListener('change', () => {
    uniField.classList.remove('invalid');
    clearConnectError();
  });
  termsCheckbox.addEventListener('change', () => {
    termsField.classList.remove('invalid');
    clearConnectError();
  });

  // "+" next to the university select reuses the same add-university modal used elsewhere.
  addUniBtn.addEventListener('click', () => {
    if(typeof openAddUniModal === 'function') openAddUniModal();
  });
})();
