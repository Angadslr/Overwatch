import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const require = createRequire(import.meta.url), yauzl = require('yauzl');

export async function inspectCandidate(path) {
  const archive = await new Promise((resolveZip, reject) => yauzl.open(path, {lazyEntries: true}, (error, zip) => error ? reject(error) : resolveZip(zip)));
  const files = new Map();
  await new Promise((done, reject) => {
    let total = 0;
    const fail = error => {archive.close();reject(error);};
    archive.on('error', fail);archive.on('end', done);
    archive.on('entry', entry => {
      if (files.size >= 16 || files.has(entry.fileName) || entry.uncompressedSize > 20 * 1024 * 1024 || (total += entry.uncompressedSize) > 30 * 1024 * 1024) return fail(new Error('Candidate archive bounds violated'));
      archive.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        const chunks = [];let used = 0;
        stream.on('error', fail);stream.on('data', bytes => {used += bytes.length;if (used > entry.uncompressedSize) {stream.destroy();fail(new Error('Candidate entry size changed'));}else chunks.push(bytes);});
        stream.on('end', () => {files.set(entry.fileName, {bytes: Buffer.concat(chunks), mode: entry.externalFileAttributes >>> 16});archive.readEntry();});
      });
    });
    archive.readEntry();
  });
  return validateCandidateContents(files);
}

export function validateCandidateContents(files) {
  const expected = ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json', 'extension/readme.md', 'extension/THIRD_PARTY_NOTICES.txt', 'extension/assets/supervision.svg', 'extension/dist/extension.cjs', 'extension/dist/cursor-supervision-hook'];
  if (files.size !== expected.length || expected.some(name => !files.has(name))) throw new Error('Unexpected candidate archive contents');
  const manifest = JSON.parse(files.get('extension/package.json').bytes), helper = files.get('extension/dist/cursor-supervision-hook');
  if (manifest.version !== '0.0.4' || manifest.private !== true || manifest.license !== 'UNLICENSED' || manifest.dependencies || manifest.devDependencies || manifest.scripts || !manifest.description.includes('qualification is incomplete')) throw new Error('Candidate manifest is not private and unqualified');
  if ((helper.mode & 0o170000) !== 0o100000 || !(helper.mode & 0o111) || helper.bytes.readUInt32LE(0) !== 0xfeedfacf || helper.bytes.readUInt32LE(4) !== 0x100000c) throw new Error('Packaged helper architecture or mode is incorrect');
  if (!files.get('extension/readme.md').bytes.toString().includes('T22 resource qualification is incomplete')) throw new Error('Candidate documentation hides its qualification status');
  const vsix = files.get('extension.vsixmanifest').bytes.toString();
  if (!vsix.includes('TargetPlatform="darwin-arm64"') || !vsix.includes('Microsoft.VisualStudio.Code.PreRelease')) throw new Error('Candidate target or pre-release marker missing');
  for (const file of files.values()) {
    if ((file.mode & 0o170000) !== 0o100000) throw new Error('Candidate contains a nonregular entry');
    if (['/Users/', '/private/var/folders/', 'FAKE_SECRET', 'BEGIN PRIVATE KEY'].some(marker => file.bytes.includes(Buffer.from(marker)))) throw new Error('Candidate contains forbidden development data');
  }
  return {files: [...files.keys()].sort(), helperExecutable: true, architecture: 'darwin-arm64', bundledDependencies: true, privateCandidate: true};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Expected candidate VSIX path');
  console.log(JSON.stringify(await inspectCandidate(process.argv[2]), null, 2));
}
