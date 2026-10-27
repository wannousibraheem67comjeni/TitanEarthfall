/** Start screen: the name, boy or girl, a microphone check, and the controls. */
import { DENOMINATIONS } from '../game/catalog';
import type { Gender } from '../lang/arabic';
import { h } from './dom';
import { controlsHelp } from './Phone';

export interface IntroResult {
  name: string;
  gender: Gender;
  continueSave: boolean;
}

export function showIntro(parent: HTMLElement, saved: { name: string; day: number; money: number } | null, testMic: () => Promise<string>, inClaudeViewer = false): Promise<IntroResult> {
  return new Promise((resolve) => {
    let gender: Gender = 'm';
    const name = h('input.field', { type: 'text', id: 'player-name', maxlength: '16', placeholder: 'اسمك', value: 'سالم', autocomplete: 'off' }) as HTMLInputElement;
    const boy = h('button.on', { type: 'button' }, h('span', '👦🏽'), 'ولد');
    const girl = h('button', { type: 'button' }, h('span', '👧🏽'), 'بنت');
    const pick = (g: Gender) => {
      gender = g;
      boy.classList.toggle('on', g === 'm');
      girl.classList.toggle('on', g === 'f');
      if (name.value === 'سالم' || name.value === 'مريم') name.value = g === 'm' ? 'سالم' : 'مريم';
    };
    boy.onclick = () => pick('m');
    girl.onclick = () => pick('f');
    const micNote = h(
      'div.muted',
      inClaudeViewer ? 'الشخصيات ترد عليك بصوت. عارض claude.ai ممكن يمنع المايك، فاكتب كلامك هنا، وللعب بالصوت كامل شغّل اللعبة من جهازك.' : 'الشخصيات تسمعك! جرّب المايك (يحتاج إذن المتصفح).',
    );
    const micBtn = h(
      'button.btn.secondary',
      {
        type: 'button',
        onclick: async () => {
          micNote.textContent = 'تكلم الحين… قول «السلام عليكم»';
          try {
            const t = await testMic();
            micNote.textContent = t ? `✓ سمعتك: «${t}»` : 'ما سمعت شي، جرّب مرة ثانية.';
          } catch (e) {
            micNote.textContent = String(e);
          }
        },
      },
      '🎤 جرّب المايك',
    );
    const start = h('button.btn', { type: 'submit', style: 'font-size:18px;padding:14px' }, 'ابدأ لعبة جديدة');
    const form = h(
      'form.panel',
      h('h1', 'شارع الرزق'),
      h('p.tag', 'أنت بفريج إماراتي، والهدف تجمع دراهمك بالحلال: ساعد أهلك، اشتغل بالمحلات، اشتغل أونلاين، بيع على بسطتك، ورجّع الأمانات. وتكلم مع أهل الفريج بصوتك أو بالكتابة.'),
      h(
        'div.notes-strip',
        ...DENOMINATIONS.filter((d) => d.paper)
          .reverse()
          .map((d) => h('span.mini-note', { style: { background: d.color } }, String(d.value))),
      ),
      saved
        ? h(
            'button.btn.warm',
            { type: 'button', style: 'font-size:18px;padding:14px', onclick: () => finish(true) },
            `كمّل لعبتك يا ${saved.name} (اليوم ${saved.day}، معك ${saved.money.toLocaleString('en-US')} درهم)`,
          )
        : null,
      h('div.setting', h('label', { for: 'player-name' }, 'شو اسمك؟'), name),
      h('div.gender', boy, girl),
      h('div.row', micBtn, h('div.grow', micNote)),
      start,
      h('details', h('summary', 'طريقة اللعب'), controlsHelp()),
    );
    const wrap = h('div.intro', form);
    const finish = (cont: boolean) => {
      wrap.remove();
      resolve({ name: name.value.trim() || (gender === 'm' ? 'سالم' : 'مريم'), gender, continueSave: cont });
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(false);
    });
    parent.append(wrap);
  });
}
