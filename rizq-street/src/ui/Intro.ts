/**
 * Start screen: the player's name and boy or girl, then one start button that asks
 * the browser for the real microphone (its own permission prompt) and unlocks sound,
 * so the street can greet the player by name and hear the answer.
 */
import { DENOMINATIONS } from '../game/catalog';
import type { Gender } from '../lang/arabic';
import type { MicPermission } from '../voice/mic';
import { h } from './dom';
import { controlsHelp } from './Phone';

export interface IntroResult {
  name: string;
  gender: Gender;
  continueSave: boolean;
  mic: MicPermission;
}

/** Where the game runs with the full microphone (GitHub Pages of this repository). */
export const GAME_URL = 'https://wannousibraheem67comjeni.github.io/TitanEarthfall/';

export function showIntro(parent: HTMLElement, saved: { name: string; gender: Gender; day: number; money: number } | null, requestMic: () => Promise<MicPermission>, unlock: () => void, inClaudeViewer = false): Promise<IntroResult> {
  return new Promise((resolve) => {
    let gender: Gender = saved?.gender ?? 'm';
    const name = h('input.field', { type: 'text', id: 'player-name', maxlength: '16', placeholder: 'اكتب اسمك هنا', autocomplete: 'off', value: '' }) as HTMLInputElement;
    const boy = h('button', { type: 'button' }, h('span', '👦🏽'), 'ولد');
    const girl = h('button', { type: 'button' }, h('span', '👧🏽'), 'بنت');
    const pick = (g: Gender) => {
      gender = g;
      boy.classList.toggle('on', g === 'm');
      girl.classList.toggle('on', g === 'f');
    };
    pick(gender);
    boy.onclick = () => pick('m');
    girl.onclick = () => pick('f');
    const status = h('div.mic-status');
    const start = h('button.btn.start', { type: 'submit' }, h('span', inClaudeViewer ? '▶' : '🎤'), 'ابدأ اللعب') as HTMLButtonElement;
    const note = h('div.muted', inClaudeViewer ? 'تكتب طلباتك وكلامك بالمربع، أو تضغط مايك الكيبورد 🎤 بجوالك. وأهل الفريج يردون عليك بصوت.' : 'لما تضغط «ابدأ» المتصفح بيطلب منك إذن المايك. اسمح له عشان أهل الفريج يسمعونك.');
    let busy = false;

    const go = async (cont: boolean) => {
      if (busy) return;
      const typed = name.value.trim();
      if (!cont && !typed) {
        name.focus();
        name.classList.add('shake');
        setTimeout(() => name.classList.remove('shake'), 500);
        status.textContent = 'اكتب اسمك أول، عشان نرحب فيك باسمك 🙂';
        return;
      }
      busy = true;
      // Inside the tap: sound and speech may play from now on.
      unlock();
      if (inClaudeViewer) {
        // claude.ai never grants the microphone: start right away and type instead.
        wrap.remove();
        resolve({ name: cont && saved ? saved.name : typed, gender: cont && saved ? saved.gender : gender, continueSave: cont, mic: 'denied' });
        return;
      }
      start.disabled = true;
      status.className = 'mic-status wait';
      status.textContent = 'اسمح للمايك من نافذة المتصفح اللي طلعت 👆';
      const skip = h('button.btn.ghost', { type: 'button' }, 'كمّل بدون مايك');
      let skipped = false;
      const t = setTimeout(() => status.append(' ', skip), 7000);
      const mic = await Promise.race([
        requestMic(),
        new Promise<MicPermission>((r) => (skip.onclick = () => ((skipped = true), r('prompt')))),
      ]);
      clearTimeout(t);
      status.className = `mic-status ${mic === 'granted' ? 'ok' : 'bad'}`;
      status.textContent =
        mic === 'granted'
          ? '✓ المايك شغال! يلا نبدأ…'
          : skipped
            ? 'نكمل بدون مايك الحين.'
            : mic === 'nomic'
              ? 'ما لقيت مايك بجهازك. نكمل بالكتابة.'
              : inClaudeViewer
                ? `صفحة claude.ai منعت المايك. نكمل بالكتابة، وللصوت افتح: ${GAME_URL}`
                : mic === 'unsupported'
                  ? 'متصفحك ما يدعم المايك. نكمل بالكتابة.'
                  : 'المتصفح ما سمح بالمايك. تقدر تسمح له بعدين من رمز القفل 🔒 جنب العنوان.';
      setTimeout(
        () => {
          wrap.remove();
          resolve({ name: cont && saved ? saved.name : typed, gender: cont && saved ? saved.gender : gender, continueSave: cont, mic });
        },
        mic === 'granted' ? 700 : 2200,
      );
    };

    const form = h(
      'form.panel',
      h('h1', 'شارع الرزق'),
      h('p.tag', 'فريج إماراتي تجمع فيه دراهمك بالحلال: ساعد أهلك بالبيت، اشتغل بالمحلات والشركات، اشتغل أونلاين، وتاجر. وتكلم مع أهل الفريج بصوتك، وهم يردون عليك بصوت.'),
      h(
        'div.notes-strip',
        ...DENOMINATIONS.filter((d) => d.paper)
          .reverse()
          .map((d) => h('span.mini-note', { style: { background: d.color } }, String(d.value))),
      ),
      saved ? h('button.btn.warm', { type: 'button', style: 'font-size:18px;padding:14px', onclick: () => void go(true) }, `كمّل لعبتك يا ${saved.name} (اليوم ${saved.day}، معك ${saved.money.toLocaleString('en-US')} درهم)`) : null,
      h('div.setting', h('label', { for: 'player-name' }, saved ? 'أو ابدأ لعبة جديدة باسمك:' : 'شو اسمك؟'), name),
      h('div.gender', boy, girl),
      start,
      status,
      note,
      h('details', h('summary', 'طريقة اللعب'), controlsHelp()),
    );
    const wrap = h('div.intro', form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void go(false);
    });
    parent.append(wrap);
    if (!saved && matchMedia('(pointer: fine)').matches) setTimeout(() => name.focus(), 300);
  });
}
