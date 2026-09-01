/* Shared mock data and session state used by chat and onboarding modules. */

/* ---------- INITIALIZE THEME FROM INDEXEDDB ---------- */
(async function initializeTheme() {
  if (window.IDBStorage) {
    try {
      const savedTheme = await window.IDBStorage.getItem('themestate', 'light');
      document.body.classList.toggle('theme-dark', savedTheme === 'dark');
    } catch (err) {
      console.error('Failed to load theme from IndexedDB:', err);
      // Fallback to light theme on error
      document.body.classList.remove('theme-dark');
    }
  }
})();

/* ---------- PRIVATE CHAT (mockup) ---------- */
const AVATAR_ASSETS = {
  dog:'assets/sim_db/users_profile_image/dog.png',
  cat:'assets/sim_db/users_profile_image/cat.png',
  fox:'assets/sim_db/users_profile_image/fox.png',
  panda:'assets/sim_db/users_profile_image/panda.png',
  rabbit:'assets/sim_db/users_profile_image/rabbit.png'
};
const MY_TAG   = '[จฬ]';
const MY_NAME  = 'มะม่วงเบา';
let MY_AVATAR = AVATAR_ASSETS.dog;
const contacts = {
  helloworld: {
    tag:'[สจล]', name:'hello world !',
    avatar:AVATAR_ASSETS.panda,
    joinDate:'1 กรกฎาคม 2569', profileId:'1000',
    online:true, unread:0, blocked:false, notifOn:false,
    messages:[
      {mine:false, time:'11:02', text:'สวัสดีครับ ผมขอสอบถามอะไรหน่อยได้ไหมครับ'},
      {mine:true,  time:'11:14', text:'อะไรเหรอครับ'}
    ]
  },
  mickey: {
    tag:'[จฬ]', name:'ชอบมิกกี้เมาส์',
    avatar:AVATAR_ASSETS.cat,
    joinDate:'15 มิถุนายน 2569', profileId:'1001',
    online:true, unread:4, blocked:false, notifOn:false,
    messages:[]
  },
  tungtung: {
    tag:'[มศว]', name:'ทุงทุง ซาฮัวรา',
    avatar:AVATAR_ASSETS.fox,
    joinDate:'2 กรกฎาคม 2569', profileId:'1002',
    online:true, unread:0, blocked:false, notifOn:false,
    messages:[]
  },
  sawadee: {
    tag:'[จฬ]', name:'สวัสดีคนไทย',
    avatar:AVATAR_ASSETS.rabbit,
    joinDate:'20 มิถุนายน 2569', profileId:'1003',
    online:false, unread:0, blocked:false, notifOn:false,
    messages:[]
  },
  hametc: {
    tag:'[จฬ]', name:'หาเพื่อนคุย',
    avatar:AVATAR_ASSETS.rabbit,
    joinDate:'22 มิถุนายน 2569', profileId:'1004',
    online:false, unread:0, blocked:false, notifOn:false,
    messages:[]
  },
  david: {
    tag:'[จฬ]', name:'David คร้าบ',
    avatar:AVATAR_ASSETS.panda,
    joinDate:'28 มิถุนายน 2569', profileId:'1005',
    online:false, unread:0, blocked:false, notifOn:false,
    messages:[]
  }
};
