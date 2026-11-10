const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const dom = new JSDOM(`<!doctype html><body>
  <div class="react-flow__node" data-id="webhook-filter"><div class="bg-bgConditionNode">Фильтр</div></div>
  <div class="react-flow__node" data-id="branch-a"><div class="bg-bgConditionNode">Фильтр</div></div>
  <div class="react-flow__node" data-id="branch-b"><div class="bg-bgConditionNode">Фильтр</div></div>
  <div class="react-flow__node" data-id="branch-live"><button><span>Контакт найден</span><span>Фильтр вкл.</span></button></div>
  <div class="react-flow__node" data-id="branch-missing"><button><span>Контакт не найден</span><span>Фильтр вкл.</span></button></div>
  <div role="menu"><button role="menuitem">Переименовать</button><button role="menuitem">Обработчик ошибок</button></div>
  <div role="dialog">Обработчик ошибок<label><input type="radio" name="handling" checked> Продолжить</label><label><input type="radio" name="handling"> Остановить</label></div>
</body>`);
const { document } = dom.window;
Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
const normalizeText = (value, max = 260) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isVisible = element => Boolean(element);
const redact = value => normalizeText(value, 200);
function load(name, next) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`  ${next}(`, start);
  assert(start >= 0 && end > start, `${name} source boundaries`);
  return new Function('document', 'isVisible', 'normalizeText', 'redact', 'elementLabel',
    `${source.slice(start, end)}\nreturn ${name};`)(document, isVisible, normalizeText, redact, () => '');
}
const targets = load('constructorFilterTargets', 'async function scanConstructorFilters')();
assert.deepEqual(targets.map(item => item.node_id), ['webhook-filter', 'branch-a', 'branch-b', 'branch-live', 'branch-missing']);
assert.deepEqual(targets.slice(3).map(item => item.branch_name), ['Контакт найден', 'Контакт не найден']);
assert.equal(targets[3].filter_enabled, true);
const branchTitleTarget = load('branchTitleTarget', 'async function scanConstructorFilters');
assert.equal(branchTitleTarget(targets[3]).textContent, 'Контакт найден');
const branchStep = document.createElement('button');
branchStep.textContent = 'Подсказка5. Инструмент: ВетвлениеAV-CALL 04 | Звонок уже обработан?Добавить ветку';
assert.equal(load('stepElementData', 'function findStepElement')(branchStep).number, 5);
const menuItem = load('exactErrorHandlerMenuItem', 'function verifiedSelectedHandler')();
assert.equal(menuItem.textContent, 'Обработчик ошибок');
const selected = load('verifiedSelectedHandler', 'async function scanModuleErrorHandler')({ text: 'Обработчик ошибок' });
assert.equal(selected, 'Продолжить');
document.querySelector('input[checked]').removeAttribute('checked');
document.querySelector('input').checked = false;
assert.equal(load('verifiedSelectedHandler', 'async function scanModuleErrorHandler')({ text: 'Обработчик ошибок' }), null);
async function checkSafeMenuTraversal() {
  const node = document.createElement('div');
  node.className = 'react-flow__node';
  node.setAttribute('data-id', 'module-1');
  const step = document.createElement('button');
  step.textContent = '1. Webhook: Получить событие';
  node.appendChild(step);
  document.body.appendChild(node);
  step.getBoundingClientRect = () => ({ left: 100, right: 400, top: 100, bottom: 260, width: 300, height: 160 });
  const start = source.indexOf('  async function scanModuleErrorHandler(');
  const end = source.indexOf('  async function captureModuleSettings(', start);
  assert(start >= 0 && end > start);
  const clicks = [];
  const factory = new Function('document', 'collectDialogs', 'findStepElement', 'isVisible', 'normalizeText', 'redact',
    'pageFingerprint', 'activateElement', 'waitForUiChange', 'exactErrorHandlerMenuItem', 'capture', 'verifiedSelectedHandler', 'errorHandlerChoiceDiagnostics', 'closeAllSafePanels',
    `${source.slice(start, end)}\nreturn scanModuleErrorHandler;`);
  const scan = factory(document, () => [], () => step, isVisible, normalizeText, redact,
    () => 'before', element => clicks.push(element), async () => true,
    () => menuItem, () => ({ evidence: { dialogs: [{ text: 'Обработчик ошибок. Выберите действие при возникновении ошибок:' }], controls: [], visible_text: '' } }),
    () => 'Продолжить', () => [], async () => {});
  const absent = await scan({ number: 1, raw: step.textContent });
  assert.equal(absent.status, 'not_confirmed');
  assert.equal(clicks.length, 0, 'must not guess a menu button');
  const menu = document.createElement('button');
  menu.className = 'al-kebab-menu__button wl-kebab-menu-button';
  menu.getBoundingClientRect = () => ({ left: 350, right: 370, top: 110, bottom: 130, width: 20, height: 20 });
  node.appendChild(menu);
  const confirmed = await scan({ number: 1, raw: step.textContent });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.selected, 'Продолжить');
  assert.deepEqual(clicks, [menu, menuItem]);
}
const customPanel = document.createElement('div');
customPanel.className = 'al-modal__content';
customPanel.innerHTML = '<h2>Обработчик ошибок</h2><div class="choice choice-active"><span>Остановить связку при ошибке</span></div><div class="choice"><span>Игнорировать ошибки на этом шаге, продолжить работу связки.</span></div><div class="choice"><span>При ошибке перейти к выбранному шагу</span></div>';
document.body.appendChild(customPanel);
const diagnostic = load('errorHandlerChoiceDiagnostics', 'async function scanModuleErrorHandler')();
assert.equal(diagnostic.length, 3);
assert(diagnostic[0].ancestors.some(ancestor => ancestor.class_name.includes('choice-active')));
checkSafeMenuTraversal().then(() => console.log('constructor filter and error-handler fixture checks passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
