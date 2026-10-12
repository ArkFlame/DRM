#!/usr/bin/env node
/** Compiled Java v1/v2 JSON -> Node HTTP -> unified service -> file persistence. */
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createDrmService } from '../web/src/server/service.mjs';

const dir = await mkdtemp(join(tmpdir(), 'arkflame-v04-java-wire-'));
const clientClasses = process.env.DRM_TEST_CLASSPATH || 'client/target/classes:client/target/test-classes';
const service = createDrmService({ dataFile:join(dir,'inst.json'), graphFile:join(dir,'graph.json'),hashKey:'K'.repeat(64) });
await service.ready;
const server = createServer(async (req,res) => {
  try {
    let body='';
    for await (const chunk of req) body += chunk;
    const json = JSON.parse(body);
    const result = req.url === '/api/v1/check' ? await service.reportV1(json,'127.0.0.1') : await service.reportV2(json,'127.0.0.1');
    res.writeHead(result.status,{'Content-Type':'application/json'});
    res.end(JSON.stringify(result.body));
  } catch (error) {
    res.writeHead(500);res.end(JSON.stringify({error:String(error)}));
  }
});
const child = (klass, url) => new Promise((ok,fail) => {
  const proc = spawn('java',['-cp',clientClasses,klass,dir,url],{stdio:['ignore','pipe','pipe']});
  let output='', errors='';
  proc.stdout.on('data', b=>output+=b);
  proc.stderr.on('data', b=>errors+=b);
  proc.on('error',fail);
  proc.on('exit',code=>code===0 ? ok(output.trim()):fail(Error(`${klass} exit ${code}: ${errors}\n${output}`)));
});
try {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const v1 = await child('com.arkflame.drm.InteropClient',base+'/api/v1/check');
  assert.match(v1,/END_TO_END_CLIENT_PASS/);
  assert.equal((await service.query('/api/admin/installations'))[0].productId, 'interop-test');
  assert.match(await child('com.arkflame.drm.NameInteropClient',base+'/api/v1/check'),/NAME_INTEROP_PASS/);
  assert.ok((await service.query('/api/admin/installations')).some(row => row.productId === 'SMP.Lifesteal'));
  const ids = (await child('com.arkflame.drm.V2InteropClient',base+'/api/v2/events')).split(/\s+/);
  assert.equal(ids.length,2);
  const node = await service.query(`/api/admin/v2/node?id=${ids[0]}`);
  const player = await service.query(`/api/admin/v2/player?id=${ids[1]}`);
  assert.equal(node.onlinePlayers,1);
  assert.ok(node.sessions.some(session => session.productId === 'FairPlay'));
  assert.equal(player.name,'IntegrationUser');
  assert.equal(player.online,true);
  console.log('JAVA_TO_UNIFIED_NODE_SERVICE_PASS=6');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await rm(dir,{recursive:true,force:true});
}
