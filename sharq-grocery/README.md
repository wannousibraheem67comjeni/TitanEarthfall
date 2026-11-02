# بقالة شرق الإمارات (Sharq Grocery)

A 3D Arabic shop game, played from behind your own till. You own a tiny grocery on the UAE east coast that hardly anyone visits. Now and then someone comes along the pavement, pushes the door open, takes things off the shelves into a basket and sets them down on your desk one by one. Then they **say their bill out loud**: «السلام عليكم. اشتريت ربطة خبز، وعلبتين لبن… وهذي 20 درهم. تقبل فاتورتي؟». The receipt prints line by line as they name each item. When they finish speaking, the **accept** button comes up at the bottom. There is no refusing: every customer is honest.

Everything a customer pays goes into the till. The big pink **«ادخار»** button moves everything in the till into savings, as often as you like: 5 dirhams, then 5, then 5. When the savings reach the goal, the shop grows by itself. There are eight stages, from a kiosk to a holding group, and the goal is to become **the richest person ever**.

```bash
npm install
npm run dev          # play at http://localhost:5173
npm test             # economy, speech, pacing and save tests
npm run build:single # one self-contained HTML file in dist-single/
npm run build:pages  # the same file, copied to ../docs/sharq/ for GitHub Pages
```

## Customers

- The shop sits on a street in daylight. There is no clock and no closing time.
- A small shop gets one customer, or two or three, at a time. The bigger it grows, the busier it gets, until dozens are walking the aisles. They come in waves: a quiet spell, an ordinary stretch, a rush.
- From the mini-market on, other cashiers in pink shirts work their own tills beside your desk. Their customers pay there, and the money lands in your till too. Only the people who come to your desk say their bill to you.
- Outside, cars pass and people walk by along the pavement.

## At the desk

| | |
|---|---|
| ✅ Accept | Take the payment: cash (with change), or a card on the machine. Your profit is the shelf price minus the wholesale cost. |
| 🧒 Children | come a dirham short. Taking their coins anyway earns stars. |
| 📒 Credit | Some neighbours ask to go in the debt book. Most come back and pay; a few don't. |
| 💗 Saving | The pink button saves the whole till, any time. Savings never shrink; the bar shows how far the next stage is. |
| ⭐ Stars | Every served customer brings stars, and more stars bring customers sooner. Keeping someone waiting too long costs stars: they give up and leave. |

Keyboard: Enter to accept, Space to save. Drag the picture to look around, and tap the subtitles to skip ahead.

## Prices at every stage

Every product has a shelf price close to what a small UAE grocery charges. The price tags on the shelf edges show them, and so does the 📋 list in the game (see [`src/game/economy.ts`](src/game/economy.ts)).

| Stage | Shop | Savings needed | New goods |
|---|---|---|---|
| 1 | كشك صغير | 140 | water, gum, Arabic bread, crisps, biscuits, laban, juice, milk |
| 2 | بقالة صغيرة | 450 | soft drinks, ice cream, sugar, tuna, tea, eggs |
| 3 | بقالة الحي | 1,600 | pasta, cheese, cooking oil, dates, frozen chicken, 5 kg rice |
| 4 | ميني ماركت | 7,000 | tomatoes, apples, detergent, shampoo, Arabic coffee, phone credit |
| 5 | سوبرماركت | 30,000 | toys, fish, meat, nappies, Sidr honey, perfume |
| 6 | هايبرماركت | 180,000 | chargers, clothes, cookware, headphones, kids' bikes, TVs |
| 7 | سلسلة فروع | 1,300,000 | wholesale cartons and sacks, plus 8,000 a minute from the branches |
| 8 | مجموعة قابضة | — | school, hotel and airline supply contracts, plus 120,000 a minute |

Each stage takes about five to ten minutes of saving, about 45 minutes to the last stage, and the top of the ladder comes a few minutes after that. `tests/pacing.test.ts` checks this.

## How it is made

Everything is generated in code, with no model or image files:

- **Light.** Physically based materials, an image-based environment, and soft shadows from the late-morning sun and from the light over the desk. On desktop, ambient occlusion and a soft bloom are added. Quality steps down automatically on slow devices (`?q=high|medium|low` forces it).
- **Surfaces.** Porcelain tiles with grout, painted walls, a suspended ceiling with LED panels, asphalt, paving, and kerbs.
- **Goods.** About fifty products at real sizes, each with a printed label: water bottles, cans, milk jugs, crisp packets, egg trays, rice sacks, honey jars, TV boxes. The shelves are stocked with thousands of instanced items in lighter versions, and price tags line the shelf edges.
- **People.** Each person is one skinned mesh per material on a jointed skeleton, so dozens can walk the shop at once (the crowd uses a lighter version without facial detail). Sculpted faces: eyes that look at you and blink, brows, lips that move with speech, and beards. They wear the kandura with ghutra and agal, the abaya with shayla, coveralls, shirts, dresses and school uniforms. Open `?people` to see them lined up.
- **Voices.** The browser's Arabic speech synthesis, with word timings driving the subtitles and the receipt printer.

TypeScript, Three.js and Vite. Saves go to `localStorage`.
