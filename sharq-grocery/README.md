# بقالة شرق الإمارات (Sharq Grocery)

A small 3D Arabic shop game. You own a tiny grocery on the UAE east coast that hardly anyone visits. Customers walk in, take goods off the shelves and put them on your counter. Their bill appears at once, and you **accept** or **refuse** it. The money gathers in the till. The big pink **«ادخار»** button moves it into savings, which earn interest every minute. When there is enough, the same button reads **«طوّر البقالة»** and grows the shop. There are eight stages, from a kiosk to a holding group, and the goal is to become **the richest person ever**.

```bash
npm install
npm run dev          # play at http://localhost:5173
npm test             # economy, pacing and save tests
npm run build:single # one self-contained HTML file in dist-single/
npm run build:pages  # the same file, copied to ../docs/sharq/ for GitHub Pages
```

## How to play

| | |
|---|---|
| ✅ Accept | an honest bill. Your profit is the price minus what the goods cost you. |
| ❌ Refuse | the tricks: a **fake banknote** (faded, no security thread, and it reads «درهن»), a customer who claims a **lower price** than the list, an **expired coupon**, or a **discount** that makes you lose. |
| 🧒 Children | come with a dirham too few. Saying yes earns stars. |
| 📒 Credit | Some customers ask to pay later. They may come back and pay, or not. |
| 💗 Pink button | saves the till (Space key). When the savings cover the next stage, it upgrades the shop. |
| ⭐ Stars | Good decisions bring more stars, and more stars bring more customers. Refusing an honest bill or keeping a customer waiting costs stars. |

Keyboard: Enter to accept, R to refuse, Space to save.

## Prices at every stage

Every product has a shelf price and a wholesale cost, and each stage adds new goods (see [`src/game/economy.ts`](src/game/economy.ts), or the 📋 button in the game):

| Stage | Shop | Upgrade cost | New goods |
|---|---|---|---|
| 1 | كشك صغير | 40 | water, gum, bread, crisps, biscuits, laban, juice, milk |
| 2 | بقالة صغيرة | 180 | soft drinks, ice cream, sugar, tuna, tea, eggs |
| 3 | بقالة الحي | 750 | pasta, cheese, cooking oil, dates, frozen chicken, 5 kg rice |
| 4 | ميني ماركت | 2,400 | tomatoes, apples, detergent, shampoo, Arabic coffee, phone credit |
| 5 | سوبرماركت | 6,000 | toys, fish, meat, nappies, Sidr honey, perfume |
| 6 | هايبرماركت | 24,000 | chargers, clothes, cookware, headphones, kids' bikes, TVs |
| 7 | سلسلة فروع | 160,000 | wholesale cartons and sacks, plus 5,000 a minute from the branches |
| 8 | مجموعة قابضة | — | school, hotel and airline supply contracts, plus 150,000 a minute |

A player who decides well reaches the top in about 50 minutes. `tests/pacing.test.ts` checks this.

## Stack

TypeScript, Three.js (procedural shop and characters, with no model files), Vite, and the browser's speech synthesis for the customers' voices. Saves go to `localStorage`.
