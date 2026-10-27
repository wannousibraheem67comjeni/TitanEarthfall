# شارع الرزق

لعبة ثلاثية الأبعاد بالعربي في فريج إماراتي. الهدف بسيط: تجمع الدراهم الإماراتية الورقية بالشغل الحلال. تساعد أهلك، تشتغل بالمحلات، تشتغل أونلاين، تبيع على بسطتك، وترجّع الأمانات لأهلها. وتكلم أهل الفريج بصوتك (المايك) أو بالكتابة، وهم يردون عليك بصوت عالٍ وبلهجتهم.

*Rizq Street: a 3D Arabic game set in a UAE neighbourhood. You earn paper dirhams through honest work, and you talk to the characters by voice or text. They answer out loud, in their own dialects.*

## التشغيل

```bash
cd rizq-street
npm install
npm run dev          # http://localhost:5173
```

افتحها بمتصفح **كروم أو إيدج** عشان يشتغل المايك. التعرف على الكلام يحتاج إنترنت، والمتصفح بيطلب منك إذن المايك أول مرة.

| الأمر | شو يسوي |
|---|---|
| `npm run dev` | يشغّل اللعبة مع إعادة تحميل تلقائية |
| `npm run build` | يفحص الأنواع ويبني نسخة ثابتة في `dist/` تنرفع على أي استضافة |
| `npm run build:single` | ملف HTML واحد فيه كل شي (`dist-single/index.html`) |
| `npm test` | اختبارات الفهم العربي والاقتصاد والشغل والحوار |
| `npm run typecheck` | فحص TypeScript |

## طرق كسب الفلوس

| الشغل | عند مين | وين | ملاحظات |
|---|---|---|---|
| سقاية الزرع، طلّع الزبالة، مقاضي البيت | أمك | حوش البيت | مرة باليوم، مصروف |
| مساعدة أبوك | أبو سالم | عطور أبو سالم | تسمع الزبون وتخلط له الزيوت (عود، ورد، مسك…) من دفتر أبوك |
| كاشير | رحيم | بقالة النور | تجمع الحساب (بالأزرار أو بصوتك) وترجّع الباقي من الدرج |
| تحضير الكرك | أبو خالد | كرك الفريج | تحضّر الطلب من الوصفات، أو تقول المكونات بصوتك |
| توصيل طلبات | أبو أحمد (سوري) | شاورما الشام | تركض للبيت قبل ما يخلص الوقت، والسرعة تجيب بقشيش |
| غسيل سيارات | حمدان | مغسلة البريق | تمسح البقع بالماوس أو بإصبعك |
| غسيل اللاندكروزر | العم حمد | قدام بيته | مرة باليوم |
| تدريس علي | أم علي | بيت الجيران | أسئلة حساب، والجواب بالكتابة أو بالصوت |
| ترتيب الصالون | أبو علاء (مصري) | صالون الأناقة | تكنس الشعر |
| شغل أونلاين | منصة «شغلني» | اللابتوب بالبيت | إدخال بيانات، تدقيق، إعلانات، ترجمة، تصميم شعارات. الأجر ينزل بالبنك |
| البسطة | أنت | مدخل الحديقة | تشتري بالجملة من البقالة وتبيع بالمفرد، والزبون يفاصل |
| إعادة التدوير | الآلة | جنب موقف الباص | درهم على كل علبة تجمعها من الشارع |
| الأمانة | أي واحد بالشارع | | تلقى محفظة ضايعة، ترجّعها لصاحبها وتاخذ مكافأة وسمعة |
| العيدية | جدك | المجلس | تسلم عليه كل يوم بـ«السلام عليكم» |

الفلوس اللي بالبنك تزيد 1% كل يوم، وتسحبها دراهم ورقية من الصراف. كل ما تشتغل أكثر، مستواك يرتفع وأجرك يزيد. السمعة ترفع البقشيش.

**تشتري بفلوسك:** حذاء رياضي، دراجة، بسطة، ثلاجة متنقلة، جوال، لابتوب، سكوتر، هدية لأمك. **والحلم الكبير محلك الخاص بـ10,000 درهم.**

## الكلام مع الشخصيات

- اقترب من أي شخص واضغط **E** (أو **T** لأقرب شخص)، واكتب أو اضغط 🎤 وتكلم.
- **محادثة صوتية مستمرة:** فعّلها وتكلم عادي، المايك يفتح لحاله بعد كل رد.
- مفتاح **V**: اضغط مطولاً وتكلم.
- لهجة المايك تختارها من الجوال ← الإعدادات (الإمارات، السعودية، الشام، مصر، العراق…).

الفهم يشتغل بطريقتين:

1. **بدون إنترنت:** محرك فهم عربي داخل اللعبة (`src/lang`). يوحّد الإملاء ويفهم لهجات الخليج والشام ومصر والفصحى، والأرقام المكتوبة والمنطوقة («خمسة وعشرين»، «ميتين وخمسين»، «خمسطعش»). كل شخصية لها كلامها ولهجتها.
2. **Claude:** إذا لعبت داخل claude.ai، الشخصيات تتكلم بذكاء Claude من حسابك بدون أي مفتاح. وبرا claude.ai تقدر تحط مفتاح Anthropic API بالإعدادات (يتخزن بمتصفحك بس). في الحالتين محرك اللعبة هو اللي يقرر الفلوس والشغل، وClaude يكتب الكلام. لذلك الشخصية ما تقدر تعطيك فلوس من عندها.

ملاحظة: داخل عارض claude.ai المتصفح يمنع المايك، فهناك تكتب كلامك والشخصيات ترد بصوت. للعب بالصوت كامل شغّل اللعبة على جهازك.

## التحكم

| | |
|---|---|
| W A S D / الأسهم | المشي |
| Shift | الركض |
| Space | القفز |
| E | تفاعل / كلام / شغل |
| T | كلّم أقرب شخص |
| V | اضغط مطولاً وتكلم |
| Tab | الجوال: الأهداف، الشغل، المتجر، المحفظة، الإنجازات، الإعدادات |
| M | الخريطة |
| B | الدراجة أو السكوتر |
| سحب الماوس | تدوير الكاميرا |

وعلى الجوال فيه عصا تحكم وأزرار على الشاشة.

## Architecture

TypeScript, Three.js and Vite, with no image or audio files. Every texture is drawn to a canvas at start-up and every sound is synthesised with WebAudio.

| Folder | What it holds |
|---|---|
| `src/lang/` | Arabic normalisation, number words in Gulf, Levantine, Egyptian and MSA forms, and intent detection |
| `src/dialogue/` | Character definitions and lines, the offline brain, the optional Claude layer (`llm.ts`, `DialogueManager.ts`) |
| `src/game/` | Save state and economy rules (`state.ts`), the catalogue of jobs, items and upgrades, mini-game rules (`jobs/`), achievements, the main loop (`Game.ts`) |
| `src/world/` | Street layout, batched static geometry, procedural characters, sky and day/night cycle, collisions |
| `src/voice/` | Web Speech API recognition and Arabic text-to-speech |
| `src/ui/` | HUD, dialogue panel, phone, intro, touch controls, and the work screens (`minigames/`) |

The offline brain always decides what happens in game terms (a sale, a gift, a job starting). When Claude is available it only writes the words, plus a few validated actions: offer a job, point the way, end the chat. A model therefore can never invent money.
