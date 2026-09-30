import { mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
for (const name of ['index.html', 'login.html']) {
  await copyFile(new URL(name, root), new URL('public/' + name, root));
}
console.log('Built public/index.html and public/login.html');
