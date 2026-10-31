import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('================================================================');
console.log(' Starting Brightloop Subscription Management System');
console.log('================================================================');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

// Start backend
const backend = spawn(npmCmd, ['run', 'dev'], {
  cwd: path.join(__dirname, 'backend'),
  stdio: 'inherit',
  shell: true
});

// Start frontend
const frontend = spawn(npmCmd, ['run', 'dev'], {
  cwd: path.join(__dirname, 'frontend'),
  stdio: 'inherit',
  shell: true
});

process.on('SIGINT', () => {
  backend.kill();
  frontend.kill();
  process.exit();
});
