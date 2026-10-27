/** Homework with Ali: six maths questions, answered by keyboard or out loud. */
import { job } from '../../game/catalog';
import { lessonPay, makeQuestion, type Question } from '../../game/jobs/tutor';
import { formatMoney, parseNumbers } from '../../lang/arabic';
import { h } from '../dom';
import { Overlay, voiceButton, type MiniEnv } from './Overlay';

const QUESTIONS = 6;

const ALI_RIGHT = ['صح! أنت أشطر من المدرّس.', 'يس! فهمتها.', 'آه صح، كذا أسهل!'];
const ALI_WRONG = ['أمم… متأكد؟ أمي تقول راجع.', 'لا لا، المدرّسة قالت غير جذي.', 'هههه غلط، خلنا نعيدها.'];

export class TutorGame {
  readonly ov: Overlay;
  private n = 0;
  private correct = 0;
  private q!: Question;
  private tries = 0;
  private readonly question = h('div.question');
  private readonly ali = h('div.speech');
  private readonly input = h('input.field', { type: 'text', inputmode: 'numeric', id: 'tutor-answer', placeholder: 'الجواب' }) as HTMLInputElement;
  private readonly feedback = h('div.feedback');
  private readonly actions = h('div.row');

  constructor(
    parent: HTMLElement,
    private readonly env: MiniEnv,
    private readonly onDone: (correct: number) => void,
  ) {
    this.ov = new Overlay(parent, 'واجب علي', 'أم علي: «خله يفهم، مب بس يحل»');
    this.ov.onClose = () => this.onDone(this.correct);
    const form = h('form.row', this.input, h('button.btn', { type: 'submit' }, 'جاوب'), voiceButton(this.env, (t) => this.answer(t), (i) => (this.input.value = i)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.answer(this.input.value);
    });
    this.ov.body.append(this.ali, this.question, form, this.feedback, this.actions);
    this.next();
  }

  private next(): void {
    if (this.n >= QUESTIONS) return this.finish();
    this.q = makeQuestion(this.env.rng, this.n);
    this.tries = 0;
    this.question.textContent = this.q.text;
    this.ali.replaceChildren(h('span.from', 'علي'), this.n === 0 ? 'أوف… يلا، أول سؤال:' : 'اللي بعده:');
    this.env.speak(this.q.text.replace('×', 'ضرب').replace('÷', 'على').replace('−', 'ناقص').replace('+', 'زائد'), 'm', 'ali', 1.55);
    this.ov.stat.textContent = `${this.n + 1}/${QUESTIONS}`;
    this.input.value = '';
    this.feedback.className = 'feedback';
    this.feedback.textContent = 'اكتب الجواب أو قوله بصوتك.';
    this.actions.replaceChildren();
    if (matchMedia('(pointer: fine)').matches) this.input.focus();
  }

  private answer(raw: string): void {
    const nums = parseNumbers(raw);
    if (!nums.length) {
      this.feedback.textContent = 'ما فهمت الرقم.';
      return;
    }
    const n = nums[nums.length - 1];
    if (n === this.q.answer) {
      this.correct += this.tries === 0 ? 1 : 0;
      this.env.sfx.success();
      const line = this.env.rng.pick(ALI_RIGHT);
      this.ali.replaceChildren(h('span.from', 'علي'), line);
      this.env.speak(line, 'm', 'ali', 1.55);
      this.feedback.className = 'feedback good';
      this.feedback.textContent = `صح، الجواب ${this.q.answer}.`;
      this.n++;
      this.actions.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.next() }, this.n >= QUESTIONS ? 'خلصنا' : 'السؤال اللي بعده'));
    } else {
      this.tries++;
      this.env.sfx.fail();
      const line = this.env.rng.pick(ALI_WRONG);
      this.ali.replaceChildren(h('span.from', 'علي'), line);
      this.feedback.className = 'feedback bad';
      if (this.tries >= 2) {
        this.feedback.textContent = `الجواب الصح ${this.q.answer}. فهّمه ليش.`;
        this.n++;
        this.actions.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.next() }, 'كمل'));
      } else this.feedback.textContent = 'غلط، جرّب مرة ثانية.';
    }
  }

  private finish(): void {
    const pay = lessonPay(this.env.store.payFor('tutor', job('tutor').pay), this.correct, QUESTIONS);
    this.env.store.finishJob('tutor');
    this.env.store.gainXp('tutor', 8 + this.correct * 4);
    if (this.correct === QUESTIONS) this.env.store.bump('perfectLessons');
    this.question.textContent = `${this.correct} / ${QUESTIONS}`;
    this.ali.replaceChildren(h('span.from', 'أم علي'), pay > 0 ? `الله يجزاك خير، علي فهم وايد اليوم. هذي ${formatMoney(pay)} لك.` : 'ولا يهمك، بكرة نحاول مرة ثانية.');
    this.env.speak('الله يجزاك خير، علي فهم وايد اليوم.', 'f', 'umali', 1.18);
    if (pay > 0) this.env.pay(pay, 'تدريس علي');
    this.actions.replaceChildren(h('button.btn', { type: 'button', onclick: () => this.ov.close() }, 'العفو'));
  }
}
