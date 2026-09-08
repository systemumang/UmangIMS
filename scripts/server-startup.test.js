import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

// An unreachable MySQL endpoint reproduces a failure in startup maintenance.
// The real server must still bind its port, serve HTTP, and remain alive.
test('HTTP remains available when startup PO maintenance fails', { timeout: 240000 }, async () => {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'startup_test', DB_USER: 'startup_test', DB_PASSWORD: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const deadline = Date.now() + 210000;
    while (!output.includes('PO number correction failed; server remains available:')) {
      assert.equal(child.exitCode, null, output);
      assert.ok(Date.now() < deadline, `Startup did not finish: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
});
