import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCandidateContents} from '../../scripts/verify-candidate.mjs';

function contents() {
  const helper = Buffer.alloc(8);helper.writeUInt32LE(0xfeedfacf, 0);helper.writeUInt32LE(0x100000c, 4);
  const files = new Map(['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json', 'extension/readme.md', 'extension/THIRD_PARTY_NOTICES.txt', 'extension/assets/supervision.svg', 'extension/dist/extension.cjs', 'extension/dist/cursor-supervision-hook'].map(name => [name, {bytes: Buffer.alloc(0), mode: 0o100644}]));
  files.set('extension/dist/cursor-supervision-hook', {bytes: helper, mode: 0o100755});
  files.get('extension/package.json').bytes = Buffer.from(JSON.stringify({version: '0.0.4', private: true, license: 'UNLICENSED', description: 'Resource qualification is incomplete'}));
  files.get('extension/readme.md').bytes = Buffer.from('T22 resource qualification is incomplete');
  files.get('extension.vsixmanifest').bytes = Buffer.from('TargetPlatform="darwin-arm64" Microsoft.VisualStudio.Code.PreRelease');
  return files;
}

test('candidate inspection refuses unexpected files, missing qualification disclosure and development data', () => {
  assert.equal(validateCandidateContents(contents()).privateCandidate, true);
  for (const mutate of [files => files.set('extension/.env', {bytes: Buffer.from('secret'), mode: 0o100600}), files => files.delete('extension/THIRD_PARTY_NOTICES.txt'), files => {files.get('extension/readme.md').bytes = Buffer.from('Production ready');}, files => {files.get('extension/dist/extension.cjs').bytes = Buffer.from('/Users/private-path');}]) {
    const files = contents();mutate(files);assert.throws(() => validateCandidateContents(files));
  }
});

test('candidate inspection refuses a nonexecutable, wrong-architecture or symlinked helper', () => {
  for (const mutate of [helper => {helper.mode = 0o100644;}, helper => {helper.mode = 0o120777;}, helper => {helper.bytes.writeUInt32LE(0x1000007, 4);}]) {
    const files = contents();mutate(files.get('extension/dist/cursor-supervision-hook'));assert.throws(() => validateCandidateContents(files));
  }
});
