import path from 'node:path';
import { Config } from '@remotion/cli/config';

// The scene lives in ../components/water and imports 'react'; point every React import
// at this workspace's copy so the studio never loads two Reacts.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...config.resolve?.alias,
      react: path.resolve('node_modules/react'),
      'react-dom': path.resolve('node_modules/react-dom'),
    },
  },
}));
