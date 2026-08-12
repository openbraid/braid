const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  const resourcesDir = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources'
  )

  // Copy vscode-server
  copyResource(context.packager.projectDir, resourcesDir, 'vscode-server')

  // Copy whisper binary + libs
  copyResource(context.packager.projectDir, resourcesDir, 'whisper')
}

function copyResource(projectDir, resourcesDir, name) {
  const src = path.join(projectDir, 'resources', name)
  const dest = path.join(resourcesDir, name)

  if (!fs.existsSync(src)) {
    console.warn(`[after-pack] ${name} not found at ${src} — skipping`)
    return
  }

  console.log(`[after-pack] Copying ${name} to ${dest}`)
  fs.cpSync(src, dest, { recursive: true })
  console.log(`[after-pack] ${name} done`)
}
