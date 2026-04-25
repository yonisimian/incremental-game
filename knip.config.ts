import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['scripts/**/*.ts'],
      ignoreDependencies: ['@game/shared'],
    },
    shared: {
      entry: ['src/index.ts'],
    },
    server: {
      entry: ['src/main.ts'],
    },
    client: {
      entry: ['src/main.ts'],
    },
  },
}

export default config
