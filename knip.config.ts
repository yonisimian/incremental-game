import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['scripts/**/*.ts'],
    },
    shared: {
      entry: ['src/index.ts'],
    },
  },
}

export default config
