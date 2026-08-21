#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

// 如果 dist/cli.js 存在，运行编译后的文件；否则如果是在开发中通过 tsx/ts-node 运行
const distCli = path.join(__dirname, '..', 'dist', 'cli.js');

if (fs.existsSync(distCli)) {
  require(distCli);
} else {
  // 如果还未构建，尝试动态引入开发源码
  try {
    require('ts-node/register');
    require('../src/cli.ts');
  } catch (e) {
    console.error('❌ 项目未构建，请先运行: npm run build');
    process.exit(1);
  }
}
