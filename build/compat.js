// Node 12 compatibility layer (Windows 7 cannot run newer Node). Injected at the top of the server bundle.
(function () {
  var c = require('crypto');
  if (!c.randomUUID) {
    c.randomUUID = function () {
      var b = c.randomBytes(16); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      var h = b.toString('hex');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };
  }
  var probe = true;
  try { Buffer.from('AA', 'base64url'); } catch (e) { probe = false; }
  if (!probe) {
    var toStr = Buffer.prototype.toString;
    Buffer.prototype.toString = function (enc, start, end) {
      if (enc === 'base64url') return toStr.call(this, 'base64', start, end).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      return toStr.apply(this, arguments);
    };
    var from = Buffer.from;
    Buffer.from = function (value, enc) {
      var args = Array.prototype.slice.call(arguments);
      if (enc === 'base64url' && typeof value === 'string') { args[0] = value.replace(/-/g, '+').replace(/_/g, '/'); args[1] = 'base64'; }
      return from.apply(Buffer, args);
    };
  }
})();
