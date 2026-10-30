import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const c = vm.createContext({escapeHtml: s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
vm.runInContext(fn('classGuide'), c);
for (const [cls, signature] of [['fighter','Momentum'],['cleric','Holy Ward'],['bard','two major songs']]) {
  test(`${cls} has compact native disclosure with grounded class-specific guidance`, () => {
    const html = c.classGuide(cls);
    assert.match(html, /<details id="sbClassGuide" class="sbguide">/);
    assert.match(html, /<summary>Class guide/);
    assert.equal((html.match(/<li>/g) || []).length, 3);
    assert.ok(html.includes(signature));
    assert.match(html, /class trainer/);
    assert.match(html, /does not teach it automatically/);
    assert.match(c.classGuide(cls, true), /class="sbguide" open>/);
  });
}
test('unknown class does not show misleading Fighter guidance', () => assert.equal(c.classGuide('unknown'), ''));
test('guide remains within scrolling ability grid and retains disclosure/focus on refresh', () => {
  assert.match(source, /\.sbguide \{ grid-column: 1 \/ -1/);
  assert.match(fn('renderSpellbook'), /classGuide\(abilityClass.clsId, guideOpen\)/);
  assert.match(fn('renderSpellbook'), /const guideFocused = document.activeElement === list.querySelector\('#sbClassGuide > summary'\)/);
  assert.match(fn('renderSpellbook'), /if \(guideFocused\) list.querySelector\('#sbClassGuide > summary'\)\?\.focus\(\)/);
  assert.match(source, /Keys 1–8 · B closes/);
});
test('focused disclosure is treated as a UI control, not gameplay or chat input', () => {
  const summary = {closest: selector => selector.includes('summary') ? {} : null};
  const context = vm.createContext({connectionState:'authenticated',zoneLoading:false,document:{hidden:false,activeElement:summary,querySelector:()=>null},settingsEl:{classList:{contains:()=>false}}});
  vm.runInContext(fn('gameplayInputBlocked'), context);
  assert.equal(context.gameplayInputBlocked({key:'Enter',target:summary}),true);
  assert.equal(context.gameplayInputBlocked({key:' ',target:summary}),true);
});
