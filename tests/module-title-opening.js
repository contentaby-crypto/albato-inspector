const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const dom = new JSDOM(`<!doctype html><body>
<div class="react-flow__node"><div role="button" id="step"><div class="title">6. HTTP Запрос: Отправить запрос <span id="custom">AV-MACRO 12 | Добавить сообщение</span></div><button id="add">Добавить ветку</button></div></div>
<div class="react-flow__node"><div role="button" id="branch"><div class="title">10. Инструмент: <span id="branch-title">Ветвление</span></div><button id="add-branch">Добавить ветку</button></div></div>
<div id="nav">Конструктор Журнал Аналитика</div></body>`, { url: 'https://albato.ru/bundle/constructor/123' });
const { document, MouseEvent, NodeFilter } = dom.window;
Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
Object.defineProperty(dom.window, 'innerWidth', { value: 1000 });
Object.defineProperty(dom.window, 'innerHeight', { value: 800 });
const box = (left = 100, top = 100, width = 300, height = 160) => ({ left, top, width, height, right: left + width, bottom: top + height });
document.querySelectorAll('.react-flow__node, [role="button"]').forEach(el => { el.getBoundingClientRect = () => box(); el.scrollIntoView = () => {}; });
dom.window.Range.prototype.getBoundingClientRect = () => box(160, 130, 130, 18);
const normalizeText = (text, max = 320) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isVisible = () => true;
function load(start, end, deps, names) {
  const a = source.indexOf(`  function ${start}(`);
  const b = source.indexOf(`  function ${end}(`, a);
  assert(a >= 0 && b > a);
  return new Function(...names, `${source.slice(a, b)}\nreturn ${start};`)(...deps);
}
const find = load('findModuleTitleElement', 'elementDescriptor', [document, NodeFilter, normalizeText, isVisible], ['document', 'NodeFilter', 'normalizeText', 'isVisible']);
const activate = load('activateModuleTitle', 'summarizeScenarioStep', [document, dom.window, MouseEvent], ['document', 'window', 'MouseEvent']);
const step = document.getElementById('step');
const branch = document.getElementById('branch');
const target = find(step, { operation: 'Отправить запрос AV-MACRO 12 | Добавить сообщение' });
assert.equal(target.id, 'custom', 'custom label must be targeted instead of outer card');
const branchTarget = find(branch, { operation: 'Ветвление Контакт найден? Добавить ветку' });
assert.equal(branchTarget.id, 'branch-title', 'branch heading must be separate from add-branch');
const genericCard = document.createElement('div');
genericCard.className = 'react-flow__node';
genericCard.innerHTML = '<div role="button" id="generic-step"><div id="generic-title" class="al-typography al-typography_mod_semibold truncate text-textPrimary">Произвольное название клиента</div></div>';
document.body.appendChild(genericCard);
[genericCard, genericCard.firstElementChild, genericCard.querySelector('#generic-title')].forEach(el => { el.getBoundingClientRect = () => box(); el.scrollIntoView = () => {}; });
assert.equal(find(genericCard.firstElementChild, { operation: 'Нестандартная операция без метки' }).id, 'generic-title');
const evidence = load('moduleEvidence', 'findSafeCloseElement', [], []);
const triggerEvidence = evidence({ evidence: { visible_text: '' } }, { evidence: { visible_text: '', controls: [], dialogs: [{ text: 'Настройка полей Авито Новое сообщение' }] }, ui: { dialogs: 1 } }, true,
  { app: 'Авито', operation: 'Новое сообщение AV-MACRO 01 | Новое сообщение Авито Фильтр вкл.' });
assert.equal(triggerEvidence.module_settings_opened, true, 'trigger filter badge is not a condition module');
let clicks = [];
[step, branch, document.getElementById('nav'), document.getElementById('add-branch')].forEach(el => el.addEventListener('click', ev => clicks.push(ev.target.id)));
document.elementFromPoint = () => target;
assert.equal(activate(target, step), true);
assert.deepEqual(clicks, ['custom']);
document.elementFromPoint = () => document.getElementById('nav');
assert.equal(activate(target, step), false, 'never click navigation outside the card');
assert.deepEqual(clicks, ['custom']);
document.elementFromPoint = () => branchTarget;
assert.equal(activate(branchTarget, branch), true);
assert.deepEqual(clicks, ['custom', 'branch-title']);
console.log('module title targeting and click guards passed');
