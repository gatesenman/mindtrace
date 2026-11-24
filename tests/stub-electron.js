/** Test-only: the shared node_modules electron binary is missing, and we must not reinstall into another workspace. */
const Module = require('module');
if (!Module.__mindtraceElectronStub) {
  Module.__mindtraceElectronStub = true;
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      const os = require('os');
      const path = require('path');
      const tmp = path.join(os.tmpdir(), 'mindtrace-test');
      return {
        app: {
          isReady: () => false,
          getPath: () => tmp,
          getName: () => 'mindtrace',
          getVersion: () => '2.5.0',
          on() {},
          once() {},
          whenReady: () => Promise.resolve()
        }
      };
    }
    return orig.apply(this, arguments);
  };
}
