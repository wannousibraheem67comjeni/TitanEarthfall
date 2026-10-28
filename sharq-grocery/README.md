# بقالة شرق الإمارات (Sharq Grocery)

A 3D Arabic shop game, played from behind your own till. You own a tiny grocery on the UAE east coast that hardly anyone visits. Now and then someone comes along the pavement, pushes the door open, takes things off the shelves into a basket and sets them down on your desk one by one. Then they **say their bill out loud**: «السلام عليكم. اشتريت ربطة خبز، وعلبتين لبن… وهذي 20 درهم. تقبل فاتورتي ولا ترفضها؟». The receipt prints line by line as they name each item. When they finish speaking, the **accept** and **refuse** buttons come up at the bottom.

Money gathers in the till. The big pink **«ادخار»** button saves it, and savings earn interest every night. When there is enough, the same button reads **«طوّر البقالة»** and grows the shop. There are eight stages, from a kiosk to a holding group, and the goal is to become **the richest person ever**.

```bash
npm install
npm run dev          # play at http://localhost:5173
npm test             # economy, speech, pacing and save tests
npm run build:single # one self-contained HTML file in dist-single/
npm run build:pages  # the same file, copied to ../docs/sharq/ for GitHub Pages
```

## A day in the shop

- The shop opens at 7 in the morning and closes at 11 at night. One shop minute passes every real second, so a day lasts about 16 minutes.
- Customers come in waves: a breakfast rush, a quiet afternoon, a busy evening. Between them you wait, watching the street through the glass: cars going by, people walking past, the light changing from morning sun to street lamps.
- At closing time you get a summary of the day: customers, sales, profit, and the night's interest on your savings. Then a new morning starts.

## Deciding

| | |
|---|---|
| ✅ Accept | an honest bill. Your profit is the shelf price minus the wholesale cost. Many customers pay by card. |
| ❌ Refuse | the tricks: a **fake banknote** (washed out, no security thread, and it reads «درهن»), a customer who claims a **lower price** than the shelf, an **expired coupon**, or a **discount** that makes you lose. |
| 🧒 Children | come a dirham short. Saying yes earns stars. |
| 📒 Credit | Some customers ask to go in the debt book. They may come back and pay, or not. |
| ⭐ Stars | Good decisions bring more stars, and more stars bring more customers. Refusing an honest bill or keeping someone waiting costs stars. |

Keyboard: Enter to accept, R to refuse, Space to save. Drag the picture to look around, and tap the subtitles to skip ahead.

## Prices at every stage

Every product has a shelf price close to what a small UAE grocery charges, and a wholesale cost. The price tags on the shelf edges show them, and so does the 📋 list in the game (see [`src/game/economy.ts`](src/game/economy.ts)).

| Stage | Shop | Upgrade cost | New goods |
|---|---|---|---|
| 1 | كشك صغير | 25 | water, gum, Arabic bread, crisps, biscuits, laban, juice, milk |
| 2 | بقالة صغيرة | 75 | soft drinks, ice cream, sugar, tuna, tea, eggs |
| 3 | بقالة الحي | 300 | pasta, cheese, cooking oil, dates, frozen chicken, 5 kg rice |
| 4 | ميني ماركت | 550 | tomatoes, apples, detergent, shampoo, Arabic coffee, phone credit |
| 5 | سوبرماركت | 1,500 | toys, fish, meat, nappies, Sidr honey, perfume |
| 6 | هايبرماركت | 5,500 | chargers, clothes, cookware, headphones, kids' bikes, TVs |
| 7 | سلسلة فروع | 100,000 | wholesale cartons and sacks, plus 6,000 an hour from the branches |
| 8 | مجموعة قابضة | — | school, hotel and airline supply contracts, plus 350,000 an hour |

A player who decides well reaches the last stage in about 70 minutes, and the top of the ladder about half an hour later. `tests/pacing.test.ts` checks this.

## How it is made

Everything is generated in code, with no model or image files:

- **Light.** Physically based materials, an image-based environment, soft shadows from the sun and from the light over the desk, a sun that moves across the sky, and street lamps and shop signs at night. On desktop, ambient occlusion and a soft bloom are added. Quality steps down automatically on slow devices (`?q=high|medium|low` forces it).
- **Surfaces.** Porcelain tiles with grout, painted walls, a suspended ceiling with LED panels, asphalt, paving, and kerbs.
- **Goods.** About fifty products at real sizes, each with a printed label: water bottles, cans, milk jugs, crisp packets, egg trays, rice sacks, honey jars, TV boxes. The shelves are stocked with thousands of instanced items, and price tags line the shelf edges.
- **People.** A jointed skeleton with sculpted faces: eyes that look at you and blink, brows, lips that move with speech, and beards. They wear the kandura with ghutra and agal, the abaya with shayla, coveralls, shirts, dresses and school uniforms. Open `?people` to see them lined up.
- **Voices.** The browser's Arabic speech synthesis, with word timings driving the subtitles and the receipt printer.

TypeScript, Three.js and Vite. Saves go to `localStorage`.
