const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
async function build() {
  if (process.platform !== 'win32') throw new Error('当前便携包构建脚本仅面向 Windows x64');
  const workspace = path.resolve(__dirname, '..');
  const output = path.resolve(workspace, '.local', 'desktop-release', 'AgileCampusPet');
  if (!output.startsWith(workspace + path.sep)) throw new Error('Unexpected output path');
  const electron = path.dirname(require('electron'));
  await fs.mkdir(output, { recursive: true });
  await fs.cp(electron, output, { recursive: true });
  await fs.rename(path.join(output, 'electron.exe'), path.join(output, 'AgileCampusPet.exe'));
  const appRoot = path.join(output, 'resources', 'app');
  await fs.mkdir(appRoot, { recursive: true });
  for (const filename of ['main.cjs', 'preload.cjs', 'lib', 'ui']) await fs.cp(path.join(__dirname, filename), path.join(appRoot, filename), { recursive: true });
  await fs.mkdir(path.join(appRoot, 'ui', 'assets'), { recursive: true });
  await fs.copyFile(path.join(workspace, 'public', 'pets', 'demo', 'qing-bot.png'), path.join(appRoot, 'ui', 'assets', 'demo-qing-bot.png'));
  await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'agilecampus-desktop-pet', productName: 'AgileCampus Pet', version: '0.1.0', main: 'main.cjs' }));
  await fs.writeFile(path.join(output, '使用说明.txt'), '先解压整个文件夹，再运行 AgileCampusPet.exe。\n在家园网页点击“开启桌面陪伴”，再点击“打开桌宠程序”并确认服务地址。\n右键桌宠或系统托盘可以返回家园、隐藏、调整大小和退出。\n请保留 LICENSE、LICENSES.chromium.html 及其他运行时文件。\n');
  const archive = path.join(path.dirname(output), 'AgileCampusPet-Windows-x64.zip');
  execFileSync('tar.exe', ['-a', '-cf', archive, '-C', path.dirname(output), path.basename(output)], { stdio: 'inherit' });
  console.log('Executable:', path.join(output, 'AgileCampusPet.exe'));
  console.log('Archive:', archive);
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
