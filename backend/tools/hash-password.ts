// Makes the value for BANKAPP_PASSWORD_HASH: `pnpm hash-password` (from the repository root).
// Reads the password from standard input without echoing it, so it stays out of shell history.
import { createInterface } from 'node:readline';
import { hashPassword } from '../src/auth/password-hash.ts';

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
const mutable = rl as unknown as { _writeToOutput: (text: string) => void };
const write = mutable._writeToOutput.bind(rl);
let prompting = true;
mutable._writeToOutput = (text) => {
  if (prompting && text.startsWith('Password')) write(text);
};

rl.question('Password: ', (password) => {
  prompting = false;
  rl.close();
  process.stderr.write('\n');
  if (password === '') {
    console.error('The password must not be empty.');
    process.exit(1);
  }
  console.log(hashPassword(password));
});
