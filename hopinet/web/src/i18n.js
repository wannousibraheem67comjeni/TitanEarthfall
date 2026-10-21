// Arabic (default, RTL) and English strings.

const STR = {
  ar: {
    title: 'هوبينت',
    subtitle: 'اقفز. اسبح. حلّق!',
    loading: 'جاري التحميل…',
    tapToStart: 'المس للبدء',
    play: 'العب',
    startStage: 'ابدأ المرحلة',
    gold: 'ذهب', gems: 'جواهر', batteries: 'بطاريات', headstart: 'انطلاقة صاروخية', vault: 'خزنة',
    score: 'النقاط', best: 'الأفضل', distance: 'المسافة', m: 'م', km: 'كم', multiplier: 'المضاعف',
    daily: 'يومي', missions: 'المهام', wheel: 'العجلة', gift: 'هدية', vaults: 'الخزائن', shop: 'المتجر',
    settings: 'الإعدادات', characters: 'الشخصيات', myHome: 'بيتي', map: 'الخريطة', upgrades: 'التطويرات',
    close: 'إغلاق', ok: 'حسناً', yes: 'نعم', no: 'لا',
    free: 'مجاناً', claim: 'استلم', open: 'افتح', buy: 'شراء', select: 'اختر', selected: 'مُختار',
    owned: 'مملوك', unlock: 'افتح', max: 'الأقصى',
    duration: 'المدة', sec: 'ث', h: 'س', min: 'د',
    // power-ups and vehicles
    pu_magnet: 'المغناطيس', pu_shield: 'الخوذة', pu_jet: 'حقيبة الطيران', pu_double: 'مضاعف الذهب', pu_bombmag: 'جاذب القنابل', pu_vehicle: 'المركبات',
    pu_magnet_d: 'يجذب كل الذهب القريب إليك', pu_shield_d: 'تحميك من اصطدام واحد، ويصبح الصوت مكتوماً وأنت ترتديها',
    pu_jet_d: 'حلّق فوق العوائق واجمع ذهب السماء', pu_double_d: 'كل قطعة ذهب تساوي اثنتين',
    pu_bombmag_d: 'يسحب القنابل نحوك ويفجّرها بعيداً عن طريقك', pu_vehicle_d: 'سيارة وقارب وسفينة وطائرة: ركوب أطول',
    veh_car: 'سيارة سباق!', veh_boat: 'قارب سريع!', veh_ship: 'سفينة عملاقة!', veh_plane: 'طائرة! اسحب لأعلى وأسفل',
    vehicleLost: 'تحطّمت المركبة!',
    // run
    paused: 'إيقاف مؤقت', resume: 'متابعة', home: 'الرئيسية', restart: 'إعادة',
    revive: 'أوه!', reviveQ: 'أكمل من حيث توقفت؟', skip: 'تخطي',
    runAgain: 'اركض مرة أخرى', continueRun: 'تابع', showResults: 'عرض النتيجة',
    crashed: 'اصطدمت!', fellDown: 'سقطت من الجسر المكسور!', drowned: 'غرقت!',
    results: 'نتيجة الجولة', newBest: 'رقم قياسي جديد!', goldCollected: 'الذهب المجموع', doubleIt: 'ضاعفه بـ {n}',
    collect: 'استلام', playAgain: 'العب مجدداً',
    tutJump: 'اسحب للأعلى للقفز', tutSlide: 'اسحب للأسفل للانزلاق', tutLane: 'اسحب يميناً ويساراً لتغيير المسار',
    tutGo: 'اجمع الذهب وطارد الكابتن كراب!',
    zoneWater: 'ماء أمامك! اسبح، واسحب للأسفل للغوص',
    villainTaunt: 'هاهاها! الكنز لي!', villainEscape: 'لن تمسكني أبداً!',
    bossIncoming: 'سفينة القراصنة الطائرة!', bossHint: 'اجمع القنابل الزرقاء لإسقاطها!',
    bossDefeated: 'سقط الكابتن كراب!', bossEscaped: 'هرب الكابتن كراب…',
    shieldBroken: 'انكسرت الخوذة!', useHeadstart: 'انطلاقة صاروخية!', stumble: 'انتبه!',
    vaultFound: 'وجدت خزنة!', slotsFull: 'خانات الخزائن ممتلئة',
    // stages
    freeRun: 'جري حر', stageN: 'المرحلة {n}',
    goal_dist: 'اقطع {n} م', goal_coins: 'اجمع {n} ذهب', goal_vehicle: 'اركب {n} مركبات', goal_swim: 'اسبح {n} م', goal_boss: 'اهزم الكابتن كراب',
    goalShort_dist: 'المسافة', goalShort_coins: 'الذهب', goalShort_vehicle: 'المركبات', goalShort_swim: 'السباحة', goalShort_boss: 'اهزم الكابتن كراب!',
    goalDone: 'الهدف مكتمل! اعبر خط النهاية',
    stageDone: 'المرحلة {n} مكتملة!', stageClear: 'أحسنت!', stageFailed: 'لم تكمل المرحلة {n} بعد',
    star1: 'أكملت المرحلة', star2: 'اجمع {n} ذهب', star3: 'بدون إنقاذ',
    replayStage: 'أعد المرحلة', nextStage: 'المرحلة التالية',
    // map
    you: 'أنت', myLocation: 'موقعي', forgetLocation: 'احذف موقعي', locating: 'جاري تحديد موقعك…',
    locationFail: 'تعذّر تحديد موقعك. تأكد من إذن الموقع في الإعدادات.',
    locationHint: 'اضغط «موقعي» لترى أقرب عالم إليك. يُحفظ موقعك على جهازك فقط.',
    nearest: 'أقرب عالم: {w} ({d} كم)',
    // lobby/house
    buildHouse: 'ابنِ البيت', complete: 'مكتمل!',
    houseOf: 'بيت {w}', needMore: 'تحتاج المزيد',
    notEnough: 'رصيد غير كافٍ', getMore: 'احصل على المزيد',
    multiplierInfo: 'كل مرحلة بناء تزيد مضاعف النقاط +1',
    tabBuild: 'البناء', tabLuxury: 'الفخامة', goldBonus: 'ذهب إضافي في كل جولة',
    luxLocked: 'ابنِ {n} مراحل من البيت أولاً لفتح الإضافات الفاخرة',
    worldLocked: 'أكمل بيت {w} أو اهزم كراب فيه لفتح هذا العالم',
    unlockByHouse: 'يُفتح عند إكمال بيت {w}',
    perk_magnet: 'مغناطيس أطول', perk_shield: 'خوذة أطول', perk_jet: 'طيران أطول', perk_double: 'مضاعفة أطول', perk_bombmag: 'جاذب قنابل أقوى', perk_vehicle: 'ركوب أطول', perk_score: 'نقاط أكثر',
    skins: 'الأزياء',
    // vaults
    vaultSlots: 'خانات الخزائن', emptySlot: 'خانة فارغة', openNow: 'افتح الآن',
    startUnlock: 'ابدأ الفتح', freeVaultIn: 'خزنة مجانية بعد {t}',
    odds: 'نسب الحظ', contains: 'يحتوي {n} جوائز',
    // wheel
    spinFree: 'دورة مجانية', spinFor: 'أدر بـ {n}', nextSpin: 'الدورة المجانية بعد {t}', jackpot: 'الجائزة الكبرى!',
    // daily
    dailyTitle: 'المكافآت اليومية', day: 'اليوم {n}', comeBack: 'عد غداً للمكافأة التالية',
    giftIn: 'الهدية بعد {t}',
    // missions
    missionsTitle: 'المهام', missionDone: 'اكتملت المهمة!', inOneRun: 'في جولة واحدة',
    m_gold: 'اجمع {n} قطعة ذهب', m_dist: 'اركض {n} متر', m_jumps: 'اقفز {n} مرة', m_slides: 'انزلق {n} مرة',
    m_pu_magnet: 'التقط المغناطيس {n} مرات', m_pu_jet: 'التقط حقيبة الطيران {n} مرات', m_pu_shield: 'التقط الخوذة {n} مرات',
    m_pu_double: 'التقط مضاعف الذهب {n} مرات', m_pu_bombmag: 'التقط جاذب القنابل {n} مرات',
    m_bosses: 'اهزم الكابتن كراب {n} مرة', m_emps: 'اجمع {n} قنبلة زرقاء',
    m_roofs: 'اركض فوق {n} شاحنة', m_runs: 'العب {n} جولات', m_gemsPicked: 'اجمع {n} جواهر أثناء الركض', m_lanes: 'غيّر المسار {n} مرة',
    m_swim: 'اسبح {n} متراً', m_dives: 'اغطس {n} مرة', m_vehicles: 'اركب {n} مركبات', m_planes: 'قُد الطائرة {n} مرات',
    m_blasts: 'فجّر {n} قنبلة', m_rings: 'مرّ من {n} حلقة في السماء', m_gaps: 'اقفز فوق {n} جسور مكسورة',
    // shop
    tabGems: 'جواهر', tabGold: 'ذهب', tabOffers: 'عروض', tabItems: 'أدوات',
    p_starter_pack: 'حزمة البداية', p_starter_pack_d: '300 جوهرة + 8000 ذهب + 5 بطاريات + 3 انطلاقات',
    p_gold_doubler: 'مضاعف الذهب الدائم', p_gold_doubler_d: 'كل الذهب الذي تجمعه ×2 للأبد',
    p_hopinet_club: 'نادي هوبينت', p_hopinet_club_d: 'اشتراك: 60 جوهرة + 2 بطارية يومياً',
    tag_popular: 'الأكثر شعبية', tag_value: 'قيمة رائعة', tag_best: 'أفضل عرض', tag_starter: 'مرة واحدة', tag_forever: 'للأبد', tag_club: 'اشتراك',
    purchased: 'تم الشراء', active: 'مفعّل', restore: 'استعادة المشتريات', restored: 'تمت استعادة المشتريات',
    purchaseOk: 'تم الشراء بنجاح!', purchaseFail: 'تعذّر إتمام الشراء', purchaseCancel: 'تم إلغاء الشراء',
    purchasePending: 'الدفع قيد المعالجة، ستصلك الجائزة عند التأكيد',
    storeUnavailable: 'متجر Google Play غير متاح حالياً. الشراء يحتاج اتصالاً بالإنترنت، أما اللعب فيعمل بدونه.',
    storeAndroidOnly: 'هذه نسخة ويب: لا يوجد فيها أي شراء. الشراء بأموال حقيقية يتم فقط عبر Google Play في تطبيق أندرويد.',
    productMissing: 'هذا المنتج غير موجود في Google Play Console بعد، لذلك لا يمكن شراؤه.',
    notAvailable: 'غير متاح',
    freeEdition: 'هذه النسخة المجانية بلا مشتريات بأموال حقيقية. كل شيء يُكسب باللعب.',
    st_ok: 'متصل بمتجر Google Play. الأسعار والدفع من Google مباشرة.',
    st_web: 'نسخة ويب بدون Google Play: الشراء غير متاح هنا ولا تُمنح أي مشتريات. الشراء الحقيقي في تطبيق أندرويد فقط.',
    st_connecting: 'جارٍ الاتصال بمتجر Google Play…',
    st_offline: 'لا يوجد اتصال بمتجر Google Play. تأكد من الإنترنت ومن أن اللعبة مثبتة من Google Play.',
    st_none: 'Google Play لا يعرف أي منتج لهذه اللعبة بعد. يجب إنشاء المنتجات في Play Console وتثبيت اللعبة من مسار الاختبار في Google Play.',
    st_missing: 'متصل بـ Google Play، لكن {n} منتج غير موجود في Play Console بعد: {ids}',
    clubClaim: 'جائزة النادي اليومية', clubActive: 'عضو في نادي هوبينت',
    per_day: '/يومياً', per_week: '/أسبوعياً', per_month: '/شهرياً', per_year: '/سنوياً',
    unit_day: 'أيام', unit_week: 'أسابيع', unit_month: 'أشهر', unit_year: 'سنوات',
    noPurchases: 'لا توجد مشتريات على حساب Google هذا لاستعادتها',
    // settings
    sound: 'المؤثرات', music: 'الموسيقى', vibration: 'الاهتزاز', language: 'اللغة', quality: 'الرسوميات',
    qLow: 'منخفضة', qHigh: 'عالية', privacy: 'سياسة الخصوصية', resetProgress: 'إعادة ضبط التقدم',
    resetConfirm: 'سيتم حذف كل التقدم (المشتريات المملوكة تبقى قابلة للاستعادة). متأكد؟', rate: 'قيّم اللعبة', version: 'الإصدار',
    stats: 'الإحصائيات', st_runs: 'الجولات', st_dist: 'إجمالي المسافة', st_gold: 'إجمالي الذهب', st_bosses: 'هزائم كراب', st_best: 'أفضل نقاط', st_bestDist: 'أطول مسافة',
    st_stars: 'النجوم', st_swim: 'السباحة',
    records: 'أفضل الجولات',
    privacyText: 'هوبينت لعبة أوفلاين لا تتصل بأي خادم ولا تجمع أي بيانات شخصية. يُحفظ تقدمك على جهازك فقط. إذا استخدمت زر «موقعي» على الخريطة فإن الموقع يُقرَّب ويُحفظ على جهازك فقط ولا يُرسل لأي جهة. تتم عمليات الشراء (في نسخة Google Play فقط) عبر Google Play وتخضع لسياسة خصوصية Google. لا توجد إعلانات ولا تتبع.',
    reward: 'مكافأة!', newChar: 'شخصية جديدة!', newWorld: 'عالم جديد!',
    confirmBuy: 'تأكيد الشراء', costIs: 'التكلفة: {c}',
  },
  en: {
    title: 'Hopinet',
    subtitle: 'Hop. Swim. Soar.',
    loading: 'Loading…',
    tapToStart: 'Tap to start',
    play: 'PLAY',
    startStage: 'START STAGE',
    gold: 'Gold', gems: 'Gems', batteries: 'Batteries', headstart: 'Rocket Start', vault: 'Vault',
    score: 'Score', best: 'Best', distance: 'Distance', m: 'm', km: 'km', multiplier: 'Multiplier',
    daily: 'Daily', missions: 'Missions', wheel: 'Wheel', gift: 'Gift', vaults: 'Vaults', shop: 'Shop',
    settings: 'Settings', characters: 'Heroes', myHome: 'My Home', map: 'Map', upgrades: 'Upgrades',
    close: 'Close', ok: 'OK', yes: 'Yes', no: 'No',
    free: 'FREE', claim: 'Claim', open: 'Open', buy: 'Buy', select: 'Select', selected: 'Selected',
    owned: 'Owned', unlock: 'Unlock', max: 'MAX',
    duration: 'Duration', sec: 's', h: 'h', min: 'm',
    pu_magnet: 'Magnet', pu_shield: 'Helmet', pu_jet: 'Jet Pack', pu_double: 'Gold Doubler', pu_bombmag: 'Bomb Magnet', pu_vehicle: 'Vehicles',
    pu_magnet_d: 'Pulls in all nearby gold', pu_shield_d: 'Protects you from one crash, and muffles the sound while worn',
    pu_jet_d: 'Fly over obstacles and grab sky gold', pu_double_d: 'Every gold piece counts twice',
    pu_bombmag_d: 'Pulls bombs to you and blows them up out of your way', pu_vehicle_d: 'Car, boat, ship and plane: longer rides',
    veh_car: 'Race car!', veh_boat: 'Speed boat!', veh_ship: 'Giant ship!', veh_plane: 'Plane! Swipe up and down',
    vehicleLost: 'Vehicle wrecked!',
    paused: 'Paused', resume: 'Resume', home: 'Home', restart: 'Restart',
    revive: 'Oops!', reviveQ: 'Keep going from here?', skip: 'Skip',
    runAgain: 'RUN AGAIN', continueRun: 'Continue', showResults: 'Show results',
    crashed: 'Crash!', fellDown: 'You fell off the broken bridge!', drowned: 'You went under!',
    results: 'Run results', newBest: 'New high score!', goldCollected: 'Gold collected', doubleIt: 'Double for {n}',
    collect: 'Collect', playAgain: 'Play again',
    tutJump: 'Swipe up to jump', tutSlide: 'Swipe down to slide', tutLane: 'Swipe left/right to switch lanes',
    tutGo: 'Grab the gold and chase Captain Krab!',
    zoneWater: 'Water ahead! Swim, and swipe down to dive',
    villainTaunt: 'Hahaha! The treasure is mine!', villainEscape: "You'll never catch me!",
    bossIncoming: 'The pirate airship!', bossHint: 'Grab the blue bombs to bring it down!',
    bossDefeated: 'Captain Krab is down!', bossEscaped: 'Captain Krab got away…',
    shieldBroken: 'Helmet broken!', useHeadstart: 'Rocket start!', stumble: 'Careful!',
    vaultFound: 'Vault found!', slotsFull: 'Vault slots are full',
    freeRun: 'Free run', stageN: 'Stage {n}',
    goal_dist: 'Run {n} m', goal_coins: 'Collect {n} gold', goal_vehicle: 'Ride {n} vehicles', goal_swim: 'Swim {n} m', goal_boss: 'Beat Captain Krab',
    goalShort_dist: 'Distance', goalShort_coins: 'Gold', goalShort_vehicle: 'Vehicles', goalShort_swim: 'Swim', goalShort_boss: 'Beat Captain Krab!',
    goalDone: 'Goal reached! Cross the finish line',
    stageDone: 'Stage {n} complete!', stageClear: 'Well done!', stageFailed: 'Stage {n} is not finished yet',
    star1: 'Finish the stage', star2: 'Collect {n} gold', star3: 'No revive used',
    replayStage: 'Replay stage', nextStage: 'Next stage',
    you: 'You', myLocation: 'My location', forgetLocation: 'Forget my location', locating: 'Finding you…',
    locationFail: 'Could not get your location. Check the location permission in settings.',
    locationHint: 'Tap "My location" to see the world nearest to you. Your location stays on this device only.',
    nearest: 'Nearest world: {w} ({d} km)',
    buildHouse: 'Build house', complete: 'Complete!',
    houseOf: '{w} house', needMore: 'Need more',
    notEnough: 'Not enough', getMore: 'Get more',
    multiplierInfo: 'Every built stage adds +1 to your score multiplier',
    tabBuild: 'Build', tabLuxury: 'Luxury', goldBonus: 'extra gold on every run',
    luxLocked: 'Build {n} house stages first to unlock luxury extras',
    worldLocked: 'Complete the {w} house or beat Krab there to unlock this world',
    unlockByHouse: 'Unlocks with the {w} house',
    perk_magnet: 'Longer magnet', perk_shield: 'Longer helmet', perk_jet: 'Longer jet pack', perk_double: 'Longer gold doubler', perk_bombmag: 'Stronger bomb magnet', perk_vehicle: 'Longer rides', perk_score: 'More score',
    skins: 'Outfits',
    vaultSlots: 'Vault slots', emptySlot: 'Empty slot', openNow: 'Open now',
    startUnlock: 'Start unlock', freeVaultIn: 'Free vault in {t}',
    odds: 'Drop rates', contains: 'Contains {n} rewards',
    spinFree: 'Free spin', spinFor: 'Spin for {n}', nextSpin: 'Free spin in {t}', jackpot: 'JACKPOT!',
    dailyTitle: 'Daily rewards', day: 'Day {n}', comeBack: 'Come back tomorrow for the next reward',
    giftIn: 'Gift in {t}',
    missionsTitle: 'Missions', missionDone: 'Mission complete!', inOneRun: 'in one run',
    m_gold: 'Collect {n} gold', m_dist: 'Run {n} m', m_jumps: 'Jump {n} times', m_slides: 'Slide {n} times',
    m_pu_magnet: 'Grab {n} magnets', m_pu_jet: 'Grab {n} jet packs', m_pu_shield: 'Grab {n} helmets',
    m_pu_double: 'Grab {n} gold doublers', m_pu_bombmag: 'Grab {n} bomb magnets',
    m_bosses: 'Beat Captain Krab {n} time(s)', m_emps: 'Collect {n} blue bombs',
    m_roofs: 'Run on top of {n} trucks', m_runs: 'Play {n} runs', m_gemsPicked: 'Pick up {n} gems while running', m_lanes: 'Switch lanes {n} times',
    m_swim: 'Swim {n} m', m_dives: 'Dive {n} times', m_vehicles: 'Ride {n} vehicles', m_planes: 'Fly the plane {n} times',
    m_blasts: 'Blow up {n} bombs', m_rings: 'Fly through {n} sky rings', m_gaps: 'Jump over {n} broken bridges',
    tabGems: 'Gems', tabGold: 'Gold', tabOffers: 'Offers', tabItems: 'Items',
    p_starter_pack: 'Starter Pack', p_starter_pack_d: '300 gems + 8000 gold + 5 batteries + 3 rocket starts',
    p_gold_doubler: 'Forever Gold Doubler', p_gold_doubler_d: 'All gold you collect is doubled forever',
    p_hopinet_club: 'Hopinet Club', p_hopinet_club_d: 'Subscription: 60 gems + 2 batteries every day',
    tag_popular: 'Most popular', tag_value: 'Great value', tag_best: 'Best deal', tag_starter: 'One time', tag_forever: 'Forever', tag_club: 'Subscription',
    purchased: 'Purchased', active: 'Active', restore: 'Restore purchases', restored: 'Purchases restored',
    purchaseOk: 'Purchase successful!', purchaseFail: 'Purchase could not be completed', purchaseCancel: 'Purchase cancelled',
    purchasePending: 'Payment is pending; you will get your reward once it is confirmed',
    storeUnavailable: 'Google Play is not available right now. Buying needs an internet connection; playing does not.',
    storeAndroidOnly: 'This is the web version: nothing can be bought here. Real-money purchases happen only through Google Play in the Android app.',
    productMissing: 'This product does not exist in Google Play Console yet, so it cannot be bought.',
    notAvailable: 'Unavailable',
    freeEdition: 'This free edition has no real-money purchases. Everything is earned by playing.',
    st_ok: 'Connected to Google Play. Prices and payment come straight from Google.',
    st_web: 'Web version without Google Play: buying is not available here and no purchases are granted. Real purchases are in the Android app only.',
    st_connecting: 'Connecting to Google Play…',
    st_offline: 'No connection to Google Play. Check the internet and that the game was installed from Google Play.',
    st_none: 'Google Play does not know any product of this game yet. Create the products in Play Console and install the game from a Google Play testing track.',
    st_missing: 'Connected to Google Play, but {n} product(s) are not in Play Console yet: {ids}',
    clubClaim: 'Club daily reward', clubActive: 'Hopinet Club member',
    per_day: '/day', per_week: '/week', per_month: '/month', per_year: '/year',
    unit_day: 'days', unit_week: 'weeks', unit_month: 'months', unit_year: 'years',
    noPurchases: 'No purchases on this Google account to restore',
    sound: 'Sound FX', music: 'Music', vibration: 'Vibration', language: 'Language', quality: 'Graphics',
    qLow: 'Low', qHigh: 'High', privacy: 'Privacy policy', resetProgress: 'Reset progress',
    resetConfirm: 'All progress will be erased (owned purchases can be restored). Are you sure?', rate: 'Rate the game', version: 'Version',
    stats: 'Statistics', st_runs: 'Runs', st_dist: 'Total distance', st_gold: 'Total gold', st_bosses: 'Krab defeats', st_best: 'Best score', st_bestDist: 'Longest run',
    st_stars: 'Stars', st_swim: 'Swimming',
    records: 'Top runs',
    privacyText: 'Hopinet is an offline game: it connects to no server and collects no personal data. Your progress is stored only on your device. If you tap "My location" on the map, the location is rounded and kept on your device only; it is never sent anywhere. Purchases (Google Play edition only) are processed by Google Play under Google\'s privacy policy. No ads, no tracking.',
    reward: 'Reward!', newChar: 'New hero!', newWorld: 'New world!',
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

// Used by the key-coverage test: all keys of a language.
export function _keys(l) { return Object.keys(STR[l] || {}); }
