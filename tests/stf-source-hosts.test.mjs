import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {allowsProxyMappedFetch} from '../server/sandbox.mjs';

async function sourceHosts(script) {
  const source=await fs.readFile(new URL(`../scripts/${script}`,import.meta.url),'utf8');
  const literal=source.match(/const proxyMappedPublicHosts=Object\.freeze\((\[[^\n]+\])\)/)?.[1];
  assert.ok(literal,`${script} must declare an explicit source-host list`);
  return [...literal.matchAll(/'([^']+)'/g)].map(match=>match[1]);
}

test('STF launch and resume use the same exact proxy-mapped HTTPS source hosts',async()=>{
  const [launch,resume]=await Promise.all([sourceHosts('stf-blind-eval.mjs'),sourceHosts('stf-blind-resume.mjs')]);
  assert.deepEqual(resume,launch);
  assert.equal(new Set(launch).size,launch.length);
  const mapped=[{address:'198.19.0.15',family:4}];
  for(const host of launch){
    assert.match(host,/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/);
    assert.equal(allowsProxyMappedFetch(new URL(`https://${host}/`),mapped,launch),true,host);
    assert.equal(allowsProxyMappedFetch(new URL(`http://${host}/`),mapped,launch),false,host);
  }
  for(const host of ['github.com','nos3.org','science.nasa.gov','www2.census.gov','www.usgs.gov'])assert.ok(launch.includes(host),host);
  assert.equal(allowsProxyMappedFetch(new URL('https://private.github.com/'),mapped,launch),false);
  assert.equal(allowsProxyMappedFetch(new URL('https://198.19.0.15/'),mapped,launch),false);
  const [launchSource,resumeSource]=await Promise.all(['stf-blind-eval.mjs','stf-blind-resume.mjs'].map(name=>fs.readFile(new URL(`../scripts/${name}`,import.meta.url),'utf8')));
  assert.match(launchSource,/sourceHosts=Object\.freeze\(\[\.\.\.proxyMappedPublicHosts,'api\.github\.com'\]\)/);
  assert.match(resumeSource,/expandedSourceHosts=Object\.freeze\(\[\.\.\.proxyMappedPublicHosts,'api\.github\.com'\]\)/);
  assert.equal(allowsProxyMappedFetch(new URL('https://api.github.com/repos/nasa/nos3/commits/master'),mapped,[...launch,'api.github.com']),true);
  assert.equal(allowsProxyMappedFetch(new URL('https://api.github.com/repos/nasa/nos3/commits/master'),mapped,launch),false,'legacy boundaries stay pinned');
});
