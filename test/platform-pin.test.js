import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertConsumerPin } from '../shared/dust-wave-platform/packages/test-core/src/consumer-pin.js';

const root = fileURLToPath(new URL('../', import.meta.url));
test('uses the recorded immutable Platform commit and package versions', () => {
  assertConsumerPin({ root,
  "expectedCommit": "30b1cf9c1154b6f38e3da34fc7b2ed3b6d312088",
  "packages": {
    "worker-core": "0.14.0",
    "test-core": "0.2.0"
  },
  "lockfiles": [
    {
      "path": "package-lock.json",
      "packages": {
        "shared/dust-wave-platform/packages/worker-core": "0.14.0"
      }
    }
  ]

  });
});
