import assert from 'node:assert/strict';
import {test} from 'node:test';
import {consentGiven, needsConsent, refusal, subjectsOf} from '../consent.mjs';

test('install commands require consent that names the package', () => {
  const command = 'pnpm add example-tool';
  const found = needsConsent(command);
  assert.ok(found.some(item => item.kind === 'install'));
  assert.equal(consentGiven('install example-tool', '', command), true);
  assert.equal(consentGiven('install a package', '', command), false);
  assert.equal(consentGiven('install pnpm', '', command), false);
  assert.equal(consentGiven('yes', 'Should I install example-tool?', command), true);
  assert.equal(consentGiven('yes', 'Should I install another-tool?', command), false);
});

test('install requests explain that an unnamed package will not run', () => {
  const found = needsConsent('npm install example-tool');
  assert.match(refusal(found, 'npm install example-tool'), /CONSENT_REQUIRED: not run/);
  assert.ok(subjectsOf('npm install example-tool').includes('example-tool'));
});

test('ordinary output that mentions an install is not classified as an install', () => {
  assert.deepEqual(needsConsent('echo npm install example-tool'), []);
  assert.ok(needsConsent('echo checking; npm install example-tool').some(item => item.kind === 'install'));
  assert.ok(needsConsent('echo checking && npm install example-tool').some(item => item.kind === 'install'));
});
