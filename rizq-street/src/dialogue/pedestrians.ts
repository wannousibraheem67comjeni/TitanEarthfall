/**
 * Passers-by: generated neighbours who walk the sidewalks, buy from the stall, drop
 * wallets, and chat a little. They share one set of lines.
 */
import type { Rng } from '../core/rng';
import type { Look } from './npcs';

export interface Passerby {
  key: string;
  name: string;
  gender: 'm' | 'f';
  look: Look;
  voice: { pitch: number; rate: number };
}

const MEN = ['سعيد', 'راشد', 'خليفة', 'يوسف', 'عبدالله', 'ماجد', 'فيصل', 'سلطان', 'كريم', 'طارق', 'مروان', 'جاسم', 'أنور', 'رامي'];
const WOMEN = ['فاطمة', 'عائشة', 'شمّا', 'ميثاء', 'هند', 'ريم', 'لطيفة', 'نوال', 'سلمى', 'دانة', 'هيا', 'ليلى'];
const SKINS = ['#e7c3a0', '#d8ae86', '#c99a72', '#a8754f', '#8a5b3c', '#f0d2b4'];

export function makePasserby(rng: Rng, key: string): Passerby {
  const gender: 'm' | 'f' = rng.chance(0.55) ? 'm' : 'f';
  const skin = rng.pick(SKINS);
  let look: Look;
  if (gender === 'm') {
    const style = rng.weighted(['kandura', 'casual', 'overalls'] as const, [5, 4, 1]);
    if (style === 'kandura') {
      look = {
        build: rng.chance(0.2) ? 'old' : 'man',
        outfit: 'kandura',
        skin,
        primary: rng.pick(['#f6f3ec', '#f2efe8', '#e9e2d3', '#d9d2c3', '#c9c3b6']),
        secondary: '#e4ddcf',
        head: 'ghutra',
        headColor: rng.chance(0.3) ? '#c64848' : '#ffffff',
        beard: rng.pick(['full', 'short', 'moustache', 'none'] as const),
        beardColor: rng.pick(['#1b1612', '#2b2420', '#6d6760']),
        height: rng.range(1.68, 1.86),
      };
    } else if (style === 'casual') {
      look = {
        build: 'man',
        outfit: 'casual',
        skin,
        primary: rng.pick(['#2b4c7e', '#3f6b4a', '#8a3b3b', '#555a63', '#c78c2c', '#e8e8e8']),
        secondary: rng.pick(['#2a2a2e', '#3b4a63', '#6b5b45']),
        head: rng.chance(0.3) ? 'cap' : 'hair',
        headColor: rng.pick(['#1a1410', '#2a1d14', '#d8352b', '#1f5fa8']),
        beard: rng.pick(['short', 'none', 'moustache'] as const),
        beardColor: '#1a1410',
        height: rng.range(1.66, 1.88),
        glasses: rng.chance(0.2),
      };
    } else {
      look = {
        build: 'man',
        outfit: 'overalls',
        skin,
        primary: rng.pick(['#1f5fa8', '#d36b1f', '#2f7a4b']),
        secondary: '#2a2a2a',
        head: 'cap',
        headColor: rng.pick(['#f4f4f4', '#f2c230']),
        beard: rng.pick(['short', 'moustache'] as const),
        beardColor: '#1a1410',
        height: rng.range(1.65, 1.82),
      };
    }
  } else {
    const abaya = rng.chance(0.75);
    look = {
      build: 'woman',
      outfit: abaya ? 'abaya' : 'casual',
      skin,
      primary: abaya ? rng.pick(['#1b191d', '#211d24', '#262229', '#2e2a33']) : rng.pick(['#7a5aa6', '#c2453c', '#3f86b8', '#d9a441']),
      secondary: abaya ? rng.pick(['#3b2f45', '#5a3e2b', '#2a2630', '#6b4a3a']) : '#2a2a2e',
      head: 'shayla',
      headColor: abaya ? rng.pick(['#141216', '#1d1b20', '#3a2d42']) : rng.pick(['#e8d9c4', '#7a5aa6', '#2f6f8f']),
      beard: 'none',
      beardColor: '#000',
      height: rng.range(1.55, 1.7),
    };
  }
  const name = gender === 'm' ? rng.pick(MEN) : rng.pick(WOMEN);
  const old = look.build === 'old';
  return { key, name, gender, look, voice: { pitch: gender === 'f' ? rng.range(1.08, 1.25) : old ? rng.range(0.7, 0.82) : rng.range(0.86, 1.04), rate: rng.range(0.95, 1.08) } };
}

export const PASSERBY_LINES = {
  greet: ['هلا والله.', 'أهلين.', 'هلا، شحالك؟', 'مرحبا!'],
  salam: ['وعليكم السلام ورحمة الله.', 'وعليكم السلام، هلا بك.'],
  howAreYou: ['بخير الحمد لله، وانت{|ي}؟', 'تمام، الجو حار بس الحمد لله.'],
  about: ['أنا {pname}، ساكن{p:ة} بالفريج من زمان.', 'اسمي {pname}، رايح{p:ة} أشتري أغراض.'],
  advice: ['شوف{|ي} أبو أحمد بالمطعم، دايماً يبي أحد يوصل الطلبات.', 'سمعت إن المغسلة تبي ناس، روح{|ي} لحمدان.', 'العلب الفاضية بالشارع تنباع بآلة التدوير، درهم لكل علبة.', 'اللي عنده لابتوب يقدر يشتغل أونلاين وهو بالبيت.'],
  thanks: ['العفو.', 'ولو، ما سويت شي.'],
  bye: ['مع السلامة.', 'الله معك.', 'يلا باي.'],
  fallback: ['عفواً؟ ما فهمت عليك.', 'آسف، مستعجل{p:ة} شوي.', 'هاه؟'],
  compliment: ['تسلم{|ين}.', 'كلك ذوق.'],
  insulted: ['الله يهديك.', 'شو هالأسلوب؟'],
  noWork: ['ما عندي شغل لك، بس اسأل{|ي} المحلات، دايماً يبون ناس.'],
  walletOwner: ['محفظتي! الله يجزاك خير، كنت أدورها من الصبح. خذ{|ي} هذي مكافأة، والله ما أنساها لك.', 'يا الله! فيها كل أوراقي. أنت{|ي} أمين{|ة}، هذي هدية بسيطة مني.'],
  story: ['الفريج تغير وايد، بس الناس بعدهم طيبين.'],
};
