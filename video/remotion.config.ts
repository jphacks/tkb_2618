import {Config} from '@remotion/cli/config';
import path from 'node:path';
Config.overrideWebpackConfig(config => ({...config, resolve: {...config.resolve, alias: {...config.resolve?.alias, ...Object.fromEntries(['react', 'react-dom', 'react/jsx-runtime'].map(name => [name + '$', path.resolve('node_modules', name)]))}}}));
