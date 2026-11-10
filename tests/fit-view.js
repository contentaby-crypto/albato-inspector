const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const dom = new JSDOM('<div class="react-flow__node"><div role="button" id="step"><div id="title">6. Отправить запрос</div></div></div><button class="react-flow__controls-fitview">Fit View</button>');
const { document } = dom.window;
const step = document.getElementById('step');
const title = document.getElementById('title');
const fit = document.querySelector('button.react-flow__controls-fitview');
let shifted = false;
const box = x => ({ left: x, right: x + 150, top: 200, bottom: 230, width: 150, height: 30 });
step.parentElement.getBoundingClientRect = () => box(shifted ? 400 : -510);
title.getBoundingClientRect = () => box(shifted ? 430 : -437);
const start = source.indexOf('  async function revealModuleTitle(');
const end = source.indexOf('  function moduleTitleProbe(', start);
assert(start >= 0 && end > start);
let clicks = 0;
const reveal = new Function('document', 'window', 'findModuleTitleElement', 'isVisible', 'activateElement', 'delay', 'findStepElement',
  `${source.slice(start, end)}\nreturn revealModuleTitle;`)(document, { innerWidth: 1920, innerHeight: 1040 },
  () => title, () => true, element => { assert.equal(element, fit); clicks += 1; shifted = true; },
  async () => {}, () => step);
(async () => {
  const result = await reveal(step, { number: 6, raw: '6. Отправить запрос' });
  assert.equal(result.fit_view_attempted, true);
  assert.equal(result.target, title);
  assert.equal(clicks, 1);
  await reveal(step, { number: 6, raw: '6. Отправить запрос' });
  assert.equal(clicks, 1, 'fit view is unnecessary once visible');
  console.log('offscreen fit-view fixture passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
