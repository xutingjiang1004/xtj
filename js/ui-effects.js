/* 空 shim（intentional empty shim，保留兼容，勿删）：
 * 视觉 ripple/particle 等效果实现已移除，避免空闲 CPU 消耗。
 * index.html 的 xtj-module-ui-effects meta 与 js/core.js 模块注册表仍引用本文件，
 * 保留空实现以确保懒加载及 XTJEffects/xtjHeartBurst API 调用不报错。
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
