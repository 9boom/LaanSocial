/* Runs the first-load onboarding flow and applies selected profile details. */

/* ---------- STARTUP ONBOARDING OVERLAY ---------- */
(function(){
  const overlay      = document.getElementById('startupOverlay');
  const track         = document.getElementById('startupTrack');
  const nameField     = document.getElementById('startupNameField');
  const nicknameInput = document.getElementById('startupNickname');
  const nextBtn        = document.getElementById('startupNextBtn');
  const avatarBtn      = document.getElementById('startupAvatarBtn');
  const avatarImg      = document.getElementById('startupAvatarImg');
  const avatarList     = document.getElementById('startupAvatarList');
  const uniField      = document.getElementById('startupUniField');
  const uniSelect      = document.getElementById('startupUni');
  const termsField    = document.getElementById('startupTermsField');
  const termsCheckbox  = document.getElementById('startupTerms');
  const connectBtn      = document.getElementById('startupConnectBtn');
  const addUniBtn        = document.getElementById('startupAddUniBtn');

  // always start on step 1, every time the page loads / refreshes
  document.body.style.overflow = 'hidden';
  nicknameInput.focus();
  const FALLBACK_AVATAR = 'assets/sim_db/users_profile_image/annonymous.png';
  let selectedAvatar = AVATAR_ASSETS.dog || FALLBACK_AVATAR;

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

  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    avatarList.classList.toggle('open');
  });

  loadProfileImages();

  document.addEventListener('click', (e) => {
    if(!avatarList.contains(e.target) && e.target !== avatarBtn && !avatarBtn.contains(e.target)){
      avatarList.classList.remove('open');
    }
  });

  nextBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    if(!nickname){
      nameField.classList.add('invalid');
      nicknameInput.focus();
      return;
    }
    nameField.classList.remove('invalid');
    track.classList.add('show-step2');
    overlay.scrollTop = 0;
    window.setTimeout(() => {
      const uniTrigger = document.getElementById('startupUniTrigger');
      (uniTrigger || uniSelect).focus();
    }, 560);
  });

  nicknameInput.addEventListener('input', () => nameField.classList.remove('invalid'));
  nicknameInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); nextBtn.click(); }
  });

  connectBtn.addEventListener('click', () => {
    let valid = true;
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

    // reflect the chosen nickname / university in the header, for a nice touch
    const nickname = nicknameInput.value.trim();
    if(nickname){
      const nickEl = document.querySelector('.profile-nick b');
      if(nickEl) nickEl.textContent = nickname;
    }
    const uniEl = document.querySelector('.profile-uni');
    if(uniEl) uniEl.textContent = uniSelect.value;
    MY_AVATAR = selectedAvatar;
    if(profileAvatarBtn) profileAvatarBtn.src = selectedAvatar;
    document.querySelectorAll('.msg.own img.avatar, .online-member.self img').forEach(img => {
      img.src = selectedAvatar;
    });

    overlay.classList.add('fade-out');
    document.body.style.overflow = '';
    overlay.addEventListener('transitionend', () => {
      overlay.style.display = 'none';
    }, { once:true });
  });

  uniSelect.addEventListener('change', () => uniField.classList.remove('invalid'));
  termsCheckbox.addEventListener('change', () => termsField.classList.remove('invalid'));

  // "+" next to the university select reuses the same "เพิ่มมหาวิทยาลัย" modal
  // used elsewhere in the app (bottom-left of the university rail).
  addUniBtn.addEventListener('click', () => {
    if(typeof openAddUniModal === 'function') openAddUniModal();
  });
})();
