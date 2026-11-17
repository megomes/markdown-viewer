/**
 * Signs the release APK with the keystore shared by all of Matheus's Android
 * apps, and numbers it with VERSION_CODE, so that each APK installs over the
 * one before it (the OTA runbook in the vault: "Update OTA de app Android pelo
 * GitHub Releases").
 *
 * The native project is generated (Continuous Native Generation), so this is
 * where the signing lives, not in android/app/build.gradle.
 *
 * Where the keys come from, first match wins:
 * - CI: KEYSTORE_PATH, KEYSTORE_PASSWORD (KEYSTORE_ALIAS optional) and VERSION_CODE.
 * - This computer: android/local.properties with release.keystore and
 *   release.passwordFile (or release.password).
 * Without either, the release build falls back to the debug key, which builds
 * but never installs over a signed release.
 */

const { withAppBuildGradle } = require('expo/config-plugins')

const MARK = '// markdown-viewer: release signing'

const SETUP = `${MARK}
def mvProps = new Properties()
def mvLocal = rootProject.file('local.properties')
if (mvLocal.exists()) mvLocal.withInputStream { mvProps.load(it) }
def mvKeystore = System.getenv('KEYSTORE_PATH') ?: mvProps.getProperty('release.keystore')
def mvPasswordFile = mvProps.getProperty('release.passwordFile')
def mvPassword = System.getenv('KEYSTORE_PASSWORD')?.trim() ?:
    (mvPasswordFile ? new File(mvPasswordFile).text.trim() : mvProps.getProperty('release.password'))
def mvAlias = System.getenv('KEYSTORE_ALIAS') ?: mvProps.getProperty('release.alias') ?: 'dailymotion'
def mvSigned = mvKeystore && mvPassword
`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradle) => {
    let text = gradle.modResults.contents

    const replace = (pattern, replacement) => {
      if (!pattern.test(text)) throw new Error('with-release-signing: não achei ' + pattern)
      text = text.replace(pattern, replacement)
    }

    // The build number on its own, every time: a prebuild over an existing
    // project (`npm run release`, `npm run phone`) writes `versionCode 1` back
    // from app.json while the rest of this plugin's work is still there, and an
    // APK numbered 1 never installs over the one on the phone.
    text = text.replace(
      /versionCode (\d+)/,
      (_, code) => `versionCode((System.getenv('VERSION_CODE') ?: '${code}').toInteger())`,
    )

    if (!text.includes(MARK)) {
      replace(/\nandroid \{/, '\n' + SETUP + '\nandroid {')
      replace(
        /signingConfigs \{\n/,
        `signingConfigs {
        if (mvSigned) {
            release {
                storeFile file(mvKeystore)
                storePassword mvPassword
                keyAlias mvAlias
                keyPassword mvPassword
            }
        }
`,
      )
      replace(
        /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
        '$1signingConfig mvSigned ? signingConfigs.release : signingConfigs.debug',
      )
    }

    gradle.modResults.contents = text
    return gradle
  })
}
