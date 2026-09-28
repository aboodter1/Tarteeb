const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') {
  const shimPath = path.resolve(__dirname, 'windows-readlink-shim.js').replace(/\\/g, '/');
  if (!process.env.NODE_OPTIONS || !process.env.NODE_OPTIONS.includes('windows-readlink-shim.js')) {
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require="${shimPath}"`.trim();
  }

  const origReadlinkSync = fs.readlinkSync;
  fs.readlinkSync = function (...args) {
    try {
      return origReadlinkSync.apply(this, args);
    } catch (err) {
      if (err && (err.code === 'EISDIR' || err.code === 'UNKNOWN')) {
        err.code = 'EINVAL';
      }
      throw err;
    }
  };

  const origReadlink = fs.readlink;
  fs.readlink = function (...args) {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      args[args.length - 1] = function (err, linkString) {
        if (err && (err.code === 'EISDIR' || err.code === 'UNKNOWN')) {
          err.code = 'EINVAL';
        }
        cb(err, linkString);
      };
    }
    return origReadlink.apply(this, args);
  };

  if (fs.promises && fs.promises.readlink) {
    const origPromisesReadlink = fs.promises.readlink;
    fs.promises.readlink = async function (...args) {
      try {
        return await origPromisesReadlink.apply(this, args);
      } catch (err) {
        if (err && (err.code === 'EISDIR' || err.code === 'UNKNOWN')) {
          err.code = 'EINVAL';
        }
        throw err;
      }
    };
  }
}
