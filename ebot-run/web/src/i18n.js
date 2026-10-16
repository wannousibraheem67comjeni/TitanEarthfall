// Arabic (default, RTL) and English strings.

const STR = {
  ar: {
    title: 'إيبوت: مطاردة الذهب',
    subtitle: 'طارد غليتش واستعد ذهبك!',
    loading: 'جاري التحميل…',
    tapToStart: 'المس للبدء',
    play: 'العب',
    gold: 'ذهب', gems: 'جواهر', batteries: 'بطاريات', headstart: 'انطلاقة صاروخية', vault: 'خزنة',
    score: 'النقاط', best: 'الأفضل', distance: 'المسافة', m: 'م', multiplier: 'المضاعف',
    daily: 'يومي', missions: 'المهام', wheel: 'العجلة', gift: 'هدية', vaults: 'الخزائن', shop: 'المتجر',
    settings: 'الإعدادات', characters: 'الشخصيات', build: 'البناء', worlds: 'العوالم', upgrades: 'التطويرات',
    profile: 'الملف', close: 'إغلاق', back: 'رجوع', ok: 'حسناً', yes: 'نعم', no: 'لا', cancel: 'إلغاء',
    free: 'مجاناً', claim: 'استلم', claimed: 'تم الاستلام', open: 'افتح', buy: 'شراء', select: 'اختر', selected: 'مُختار',
    locked: 'مقفل', owned: 'مملوك', equip: 'ارتدِ', equipped: 'مُرتدى', unlock: 'افتح', max: 'الأقصى',
    level: 'المستوى', duration: 'المدة', sec: 'ث', h: 'س', min: 'د',
    pu_magnet: 'مغناطيس', pu_shield: 'خوذة الدرع', pu_jet: 'الطائرة النفاثة', pu_double: 'ذهب مضاعف',
    pu_magnet_d: 'يجذب كل سبائك الذهب القريبة', pu_shield_d: 'يحميك من اصطدام واحد',
    pu_jet_d: 'حلّق فوق العوائق واجمع ذهب السماء', pu_double_d: 'كل سبيكة تساوي اثنتين',
    // run
    paused: 'إيقاف مؤقت', resume: 'متابعة', home: 'الرئيسية', restart: 'إعادة',
    revive: 'إنقاذ!', reviveQ: 'هل تريد المتابعة؟', reviveWith: 'استخدم {n}', skip: 'تخطي',
    results: 'نتيجة الجولة', newBest: 'رقم قياسي جديد!', goldCollected: 'الذهب المجموع', doubleIt: 'ضاعفه بـ {n}',
    collect: 'استلام', playAgain: 'العب مجدداً',
    tutJump: 'اسحب للأعلى للقفز', tutSlide: 'اسحب للأسفل للانزلاق', tutLane: 'اسحب يميناً ويساراً لتغيير المسار',
    tutGo: 'اجمع الذهب وطارد غليتش!',
    thiefTaunt: 'هيهيهي! الذهب لي!', thiefEscape: 'لن تمسكني يا إيبوت!',
    bossIncoming: 'شاحنة غليتش قادمة!', bossHint: 'اركل القنابل الزرقاء نحو الشاحنة!',
    bossDefeated: 'هزمت غليتش!', bossEscaped: 'هرب غليتش…',
    shieldBroken: 'انكسر الدرع!', useHeadstart: 'انطلاقة صاروخية!', stumble: 'انتبه!',
    // lobby/house
    buildHouse: 'ابنِ البيت', stage: 'المرحلة', built: 'مبني', next: 'التالي', complete: 'مكتمل!',
    houseOf: 'بيت {w}', houseDone: 'اكتمل البيت! تم فتح {c} و{w}', needMore: 'تحتاج المزيد',
    notEnough: 'رصيد غير كافٍ', getMore: 'احصل على المزيد',
    multiplierInfo: 'كل مرحلة بناء تزيد مضاعف النقاط +1',
    worldLocked: 'أكمل بيت {w} لفتح هذا العالم', currentWorld: 'العالم الحالي', go: 'انطلق',
    unlockByHouse: 'يُفتح عند إكمال بيت {w}', unlockByGems: 'افتح بـ {n} جوهرة',
    perk: 'الميزة', perk_magnet: 'مغناطيس أطول', perk_shield: 'درع أطول', perk_jet: 'طيران أطول', perk_double: 'مضاعفة أطول', perk_score: 'نقاط أكثر',
    skins: 'الأزياء',
    // vaults
    vaultSlots: 'خانات الخزائن', emptySlot: 'خانة فارغة', unlocking: 'جاري الفتح', openNow: 'افتح الآن',
    startUnlock: 'ابدأ الفتح', freeVaultIn: 'خزنة مجانية بعد {t}', freeVaultReady: 'خزنة مجانية جاهزة!',
    buyVault: 'اشترِ', odds: 'نسب الحظ', slotsFull: 'خانات الخزائن ممتلئة', vaultFound: 'وجدت خزنة!',
    contains: 'يحتوي {n} جوائز',
    // wheel
    spin: 'أدر', spinFree: 'دورة مجانية', spinFor: 'أدر بـ {n}', nextSpin: 'الدورة المجانية بعد {t}', jackpot: 'الجائزة الكبرى!',
    // daily
    dailyTitle: 'المكافآت اليومية', day: 'اليوم {n}', comeBack: 'عد غداً للمكافأة التالية',
    giftReady: 'هدية مجانية! +{n} ذهب', giftIn: 'الهدية بعد {t}',
    // missions
    missionsTitle: 'المهام', missionDone: 'اكتملت المهمة!', inOneRun: 'في جولة واحدة',
    m_gold: 'اجمع {n} سبيكة ذهب', m_dist: 'اركض {n} متر', m_jumps: 'اقفز {n} مرة', m_slides: 'انزلق {n} مرة',
    m_pu_magnet: 'استخدم المغناطيس {n} مرات', m_pu_jet: 'استخدم الطائرة {n} مرات', m_pu_shield: 'استخدم الدرع {n} مرات',
    m_pu_double: 'استخدم المضاعف {n} مرات', m_bosses: 'اهزم شاحنة غليتش {n} مرة', m_emps: 'اركل {n} قنبلة زرقاء',
    m_roofs: 'اركض فوق {n} شاحنة', m_runs: 'العب {n} جولات', m_gemsPicked: 'اجمع {n} جواهر أثناء الركض', m_lanes: 'غيّر المسار {n} مرة',
    // shop
    tabGems: 'جواهر', tabGold: 'ذهب', tabOffers: 'عروض', tabItems: 'أدوات',
    p_starter_pack: 'حزمة البداية', p_starter_pack_d: '300 جوهرة + 8000 ذهب + 5 بطاريات + 3 انطلاقات',
    p_gold_doubler: 'مضاعف الذهب الدائم', p_gold_doubler_d: 'كل الذهب الذي تجمعه ×2 للأبد',
    p_ebot_club: 'نادي إيبوت', p_ebot_club_d: 'اشتراك شهري: 60 جوهرة + 2 بطارية يومياً',
    tag_popular: 'الأكثر شعبية', tag_value: 'قيمة رائعة', tag_best: 'أفضل عرض', tag_starter: 'مرة واحدة', tag_forever: 'للأبد', tag_club: 'اشتراك',
    purchased: 'تم الشراء', active: 'مفعّل', restore: 'استعادة المشتريات', restored: 'تمت استعادة المشتريات',
    purchaseOk: 'تم الشراء بنجاح!', purchaseFail: 'تعذّر إتمام الشراء', purchaseCancel: 'تم إلغاء الشراء',
    purchasePending: 'الدفع قيد المعالجة، ستصلك الجائزة عند التأكيد',
    storeUnavailable: 'متجر Google Play غير متاح حالياً',
    demoStore: 'نسخة الويب: المشتريات تجريبية بدون دفع حقيقي. الشراء الحقيقي عبر Google Play في تطبيق أندرويد.',
    demoConfirm: 'شراء تجريبي (بدون دفع) لـ {p}؟',
    clubClaim: 'جائزة النادي اليومية', clubActive: 'عضو في نادي إيبوت',
    perMonth: '/شهرياً',
    // settings
    sound: 'المؤثرات', music: 'الموسيقى', vibration: 'الاهتزاز', language: 'اللغة', quality: 'الرسوميات',
    qLow: 'منخفضة', qHigh: 'عالية', on: 'تشغيل', off: 'إيقاف', privacy: 'سياسة الخصوصية', resetProgress: 'إعادة ضبط التقدم',
    resetConfirm: 'سيتم حذف كل التقدم (المشتريات المملوكة تبقى قابلة للاستعادة). متأكد؟', rate: 'قيّم اللعبة', version: 'الإصدار',
    stats: 'الإحصائيات', st_runs: 'الجولات', st_dist: 'إجمالي المسافة', st_gold: 'إجمالي الذهب', st_bosses: 'هزائم غليتش', st_best: 'أفضل نقاط', st_bestDist: 'أطول مسافة',
    records: 'أفضل الجولات',
    privacyText: 'إيبوت: مطاردة الذهب لا تجمع أي بيانات شخصية. يُحفظ تقدمك على جهازك فقط. تتم عمليات الشراء عبر Google Play وتخضع لسياسة خصوصية Google. لا توجد إعلانات ولا تتبع.',
    reward: 'مكافأة!', youGot: 'حصلت على', newChar: 'شخصية جديدة!', newWorld: 'عالم جديد!',
    confirmBuy: 'تأكيد الشراء', costIs: 'التكلفة: {c}',
  },
  en: {
    title: 'EBOT: Gold Chase',
    subtitle: 'Chase Glitch and win your gold back!',
    loading: 'Loading…',
    tapToStart: 'Tap to start',
    play: 'PLAY',
    gold: 'Gold', gems: 'Gems', batteries: 'Batteries', headstart: 'Rocket Start', vault: 'Vault',
    score: 'Score', best: 'Best', distance: 'Distance', m: 'm', multiplier: 'Multiplier',
    daily: 'Daily', missions: 'Missions', wheel: 'Wheel', gift: 'Gift', vaults: 'Vaults', shop: 'Shop',
    settings: 'Settings', characters: 'Characters', build: 'Build', worlds: 'Worlds', upgrades: 'Upgrades',
    profile: 'Profile', close: 'Close', back: 'Back', ok: 'OK', yes: 'Yes', no: 'No', cancel: 'Cancel',
    free: 'FREE', claim: 'Claim', claimed: 'Claimed', open: 'Open', buy: 'Buy', select: 'Select', selected: 'Selected',
    locked: 'Locked', owned: 'Owned', equip: 'Equip', equipped: 'Equipped', unlock: 'Unlock', max: 'MAX',
    level: 'Level', duration: 'Duration', sec: 's', h: 'h', min: 'm',
    pu_magnet: 'Magnet', pu_shield: 'Shield Helmet', pu_jet: 'Jet Plane', pu_double: 'Double Gold',
    pu_magnet_d: 'Pulls in all nearby gold bars', pu_shield_d: 'Protects you from one crash',
    pu_jet_d: 'Fly over obstacles and grab sky gold', pu_double_d: 'Every gold bar counts twice',
    paused: 'Paused', resume: 'Resume', home: 'Home', restart: 'Restart',
    revive: 'Revive!', reviveQ: 'Keep running?', reviveWith: 'Use {n}', skip: 'Skip',
    results: 'Run results', newBest: 'New high score!', goldCollected: 'Gold collected', doubleIt: 'Double for {n}',
    collect: 'Collect', playAgain: 'Play again',
    tutJump: 'Swipe up to jump', tutSlide: 'Swipe down to slide', tutLane: 'Swipe left/right to switch lanes',
    tutGo: 'Grab the gold and chase Glitch!',
    thiefTaunt: 'Hehehe! The gold is mine!', thiefEscape: "You'll never catch me, Ebot!",
    bossIncoming: "Glitch's van is coming!", bossHint: 'Kick the blue bombs back at the van!',
    bossDefeated: 'Glitch defeated!', bossEscaped: 'Glitch got away…',
    shieldBroken: 'Shield broken!', useHeadstart: 'Rocket start!', stumble: 'Careful!',
    buildHouse: 'Build house', stage: 'Stage', built: 'Built', next: 'Next', complete: 'Complete!',
    houseOf: '{w} house', houseDone: 'House complete! Unlocked {c} and {w}', needMore: 'Need more',
    notEnough: 'Not enough', getMore: 'Get more',
    multiplierInfo: 'Every built stage adds +1 to your score multiplier',
    worldLocked: 'Complete the {w} house to unlock', currentWorld: 'Current world', go: 'Go',
    unlockByHouse: 'Unlocks with the {w} house', unlockByGems: 'Unlock for {n} gems',
    perk: 'Perk', perk_magnet: 'Longer magnet', perk_shield: 'Longer shield', perk_jet: 'Longer jet', perk_double: 'Longer double gold', perk_score: 'More score',
    skins: 'Outfits',
    vaultSlots: 'Vault slots', emptySlot: 'Empty slot', unlocking: 'Unlocking', openNow: 'Open now',
    startUnlock: 'Start unlock', freeVaultIn: 'Free vault in {t}', freeVaultReady: 'Free vault ready!',
    buyVault: 'Buy', odds: 'Drop rates', slotsFull: 'Vault slots are full', vaultFound: 'Vault found!',
    contains: 'Contains {n} rewards',
    spin: 'SPIN', spinFree: 'Free spin', spinFor: 'Spin for {n}', nextSpin: 'Free spin in {t}', jackpot: 'JACKPOT!',
    dailyTitle: 'Daily rewards', day: 'Day {n}', comeBack: 'Come back tomorrow for the next reward',
    giftReady: 'Free gift! +{n} gold', giftIn: 'Gift in {t}',
    missionsTitle: 'Missions', missionDone: 'Mission complete!', inOneRun: 'in one run',
    m_gold: 'Collect {n} gold bars', m_dist: 'Run {n} m', m_jumps: 'Jump {n} times', m_slides: 'Slide {n} times',
    m_pu_magnet: 'Use {n} magnets', m_pu_jet: 'Use {n} jet planes', m_pu_shield: 'Use {n} shields',
    m_pu_double: 'Use {n} gold doublers', m_bosses: "Defeat Glitch's van {n} time(s)", m_emps: 'Kick {n} blue bombs',
    m_roofs: 'Run on top of {n} trucks', m_runs: 'Play {n} runs', m_gemsPicked: 'Pick up {n} gems while running', m_lanes: 'Switch lanes {n} times',
    tabGems: 'Gems', tabGold: 'Gold', tabOffers: 'Offers', tabItems: 'Items',
    p_starter_pack: 'Starter Pack', p_starter_pack_d: '300 gems + 8000 gold + 5 batteries + 3 rocket starts',
    p_gold_doubler: 'Forever Gold Doubler', p_gold_doubler_d: 'All gold you collect is doubled forever',
    p_ebot_club: 'Ebot Club', p_ebot_club_d: 'Monthly: 60 gems + 2 batteries every day',
    tag_popular: 'Most popular', tag_value: 'Great value', tag_best: 'Best deal', tag_starter: 'One time', tag_forever: 'Forever', tag_club: 'Subscription',
    purchased: 'Purchased', active: 'Active', restore: 'Restore purchases', restored: 'Purchases restored',
    purchaseOk: 'Purchase successful!', purchaseFail: 'Purchase could not be completed', purchaseCancel: 'Purchase cancelled',
    purchasePending: 'Payment is pending; you will get your reward once it is confirmed',
    storeUnavailable: 'Google Play store is not available right now',
    demoStore: 'Web version: purchases are a demo with no real payment. Real purchases use Google Play in the Android app.',
    demoConfirm: 'Demo purchase (no payment) of {p}?',
    clubClaim: 'Club daily reward', clubActive: 'Ebot Club member',
    perMonth: '/month',
    sound: 'Sound FX', music: 'Music', vibration: 'Vibration', language: 'Language', quality: 'Graphics',
    qLow: 'Low', qHigh: 'High', on: 'On', off: 'Off', privacy: 'Privacy policy', resetProgress: 'Reset progress',
    resetConfirm: 'All progress will be erased (owned purchases can be restored). Are you sure?', rate: 'Rate the game', version: 'Version',
    stats: 'Statistics', st_runs: 'Runs', st_dist: 'Total distance', st_gold: 'Total gold', st_bosses: 'Glitch defeats', st_best: 'Best score', st_bestDist: 'Longest run',
    records: 'Top runs',
    privacyText: 'EBOT: Gold Chase does not collect personal data. Your progress is stored only on your device. Purchases are processed by Google Play under Google\'s privacy policy. No ads, no tracking.',
    reward: 'Reward!', youGot: 'You got', newChar: 'New character!', newWorld: 'New world!',
    confirmBuy: 'Confirm purchase', costIs: 'Cost: {c}',
  },
};

let lang = 'ar';

export function setLang(l) {
  lang = STR[l] ? l : 'ar';
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
export function getLang() { return lang; }

export function t(key, params) {
  let s = (STR[lang] && STR[lang][key]) ?? STR.en[key] ?? key;
  if (params) for (const k in params) s = s.split('{' + k + '}').join(params[k]);
  return s;
}

// Picks the right language from a {ar, en} object.
export function L(obj) { return obj ? (obj[lang] ?? obj.en ?? '') : ''; }

export function fmt(n) {
  n = Math.floor(n);
  return n.toLocaleString('en-US');
}

export function fmtShort(n) {
  n = Math.floor(n);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('en-US');
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}${t('h')} ${m}${t('min')}`;
  if (m > 0) return `${m}${t('min')} ${sec}${t('sec')}`;
  return `${sec}${t('sec')}`;
}
