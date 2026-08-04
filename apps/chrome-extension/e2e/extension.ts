import { createHash } from 'node:crypto'

// Used only by the unpacked Windows E2E copy. It gives the temporary test
// extension a stable id even when Chrome has suspended its service worker.
export const e2eExtensionKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzGzAYObGUMlXDG9Xy/P+Xo4NQn+HY3VLaAU2al5XE3/fTyifxM7D2TjGjEsdXjpue0Qci4dBXttZwMuZ97v4FKr4/AgtkUzjeHWD7UhVzI/4HSdhj7YfCPLHgF6Cmm+c1xSWf6d9IFWdsoO4hvAdZXunWJfq4n6HjtZcjeQfW5DcyoE6Fg/mcCYqQZpFfjr6gnpJrqS51rjg8CiNOwHU0ZeWD6p4drCQHM2s30maaLADY8ScXSMjFFOY2WF5GXk9+IWzp3Rfah1TEocd4xAvAtsWrbQ0EpqCv+ghB5Vcq+8h3ktHBq5YHNpv+ifrrjxg/2XfhMjIRU1pjbV9pL6DhQIDAQAB'

export const e2eExtensionId = createHash('sha256')
  .update(Buffer.from(e2eExtensionKey, 'base64'))
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, nibble =>
    String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(nibble, 16)),
  )
