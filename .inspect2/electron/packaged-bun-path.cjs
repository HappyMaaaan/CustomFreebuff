const fs = require('node:fs')
const path = require('node:path')

function packagedBunPath(
  resourcesPath,
  platform = process.platform,
  exists = fs.existsSync,
) {
  const exe = platform === 'win32' ? '.exe' : ''
  const bunDir = path.join(resourcesPath, 'bun')
  const baseline = path.join(bunDir, `bun-baseline${exe}`)
  return exists(baseline) ? baseline : path.join(bunDir, `bun${exe}`)
}

module.exports = { packagedBunPath }
