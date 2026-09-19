import { spawn } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['dev:server','dev:client'].map(task => spawn(npm, ['run', task], { stdio: 'inherit', shell: process.platform === 'win32' }));
let closing = false;
function shutdown(code = 0) { if (closing) return; closing = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
for (const child of children) { child.on('error', () => shutdown(1)); child.on('exit', code => shutdown(code ?? 0)); }
process.on('SIGINT', () => shutdown()); process.on('SIGTERM', () => shutdown());
