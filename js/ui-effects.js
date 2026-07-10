/* deprecated XTJ effects compatibility shim.
 * Visual ripple/particle implementations were removed to avoid idle work.
 */
(function () {
  'use strict';
  window.xtjHeartBurst = window.xtjHeartBurst || function () {};
  window.XTJEffects = window.XTJEffects || {
    ripple: function () {},
    particleBurst: function () {},
    heartBurst: window.xtjHeartBurst
  };
})();
