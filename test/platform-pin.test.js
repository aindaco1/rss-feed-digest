import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertConsumerPin } from '../shared/dust-wave-platform/packages/test-core/src/consumer-pin.js';

const root = fileURLToPath(new URL('../', import.meta.url));
test('uses the recorded immutable Platform commit and package versions', () => {
  assertConsumerPin({ root,
  "expectedCommit": "60d439b887f1244f82ff232c849d74152b28c776",
  "packages": {
    "worker-core": "0.15.0",
    "test-core": "0.3.0"
  },
  "lockfiles": [
    {
      "path": "package-lock.json",
      "packages": {
        "shared/dust-wave-platform/packages/worker-core": "0.15.0",
        "shared/dust-wave-platform/packages/test-core": "0.3.0"
      }
    }
  ]

  });
});
