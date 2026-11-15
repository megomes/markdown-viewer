/**
 * The native libsodium, standing in for `libsodium-wrappers-sumo` on the phone
 * (see metro.config.js). Same functions, same names, same `ready` promise, so
 * `@markdown-viewer/crypto` runs unchanged: a key wrapped on the desktop opens
 * here, and a chunk sealed here opens there.
 */

import * as sodium from 'react-native-libsodium'

export default sodium
