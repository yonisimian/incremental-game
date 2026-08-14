import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  ignoreBinaries: ['playwright'],
  workspaces: {
    shared: {
      entry: ['src/index.ts'],
    },
    client: {
      entry: ['src/dev/main.ts'],
    },
  },
}

export default config
