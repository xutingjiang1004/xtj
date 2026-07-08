(function () {
  'use strict';

  if (window.__xtjAnimationsLoaded) return;
  window.__xtjAnimationsLoaded = true;

  function hasGSAP() {
    return typeof gsap !== 'undefined';
  }

  function perfMode() {
    var root = document.documentElement;
    if (!root) return 'full';
    if (root.classList.contains('perf-lite')) return 'lite';
    if (root.classList.contains('perf-balanced')) return 'balanced';
    return 'full';
  }

  function isDock(el) {
    return !!(el && el.closest && el.closest('#dockBar,.dock-bar,.dock-tab'));
  }

  function withTransientWillChange(el, value, ttl) {
    if (!el) return function() {};
    var previous = el.style.willChange;
    el.style.willChange = value || 'transform, opacity';
    return function() {
      setTimeout(function() {
        if (el) el.style.willChange = previous || '';
      }, ttl || 480);
    };
  }

  var postToggleIgnoreSelector = [
    '.avatar',
    '.avatar-wrap',
    '.xtj-pro-avatar-ring',
    '.user-name',
    '.post-badge-stack',
    'a',
    'button',
    'input',
    'textarea',
    'select',
    'label',
    '.media',
    '.comments'
  ].join(',');

  var _origOpenModal = window.openModal;
  window.openModal = function (id) {
    var overlay = document.getElementById(id);
    if (!overlay) return;
    if (_origOpenModal) _origOpenModal(id);
    else { overlay.style.display = ''; overlay.classList.add('active'); }
    if (!hasGSAP() || perfMode() === 'lite') return;
    var box = overlay.querySelector('.modal-box');
    if (!box) return;
    var cleanup = withTransientWillChange(box, 'transform, opacity');
    if (perfMode() === 'balanced') {
      gsap.fromTo(box, { y: 16, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.24, ease: 'power2.out', clearProps: 'transform,opacity',
        onComplete: cleanup
      });
      return;
    }
    gsap.fromTo(box, { y: 22, scale: 0.98, opacity: 0 }, {
      y: 0, scale: 1, opacity: 1, duration: 0.36, ease: 'power3.out', clearProps: 'transform,opacity',
      onComplete: cleanup
    });
  };

  var _origCloseModal = window.closeModal;
  window.closeModal = function (id) {
    var overlay = document.getElementById(id);
    if (!overlay || !hasGSAP() || perfMode() === 'lite') {
      if (_origCloseModal) _origCloseModal(id);
      return;
    }
    var box = overlay.querySelector('.modal-box');
    if (!box) {
      if (_origCloseModal) _origCloseModal(id);
      return;
    }
    var cleanup = withTransientWillChange(box, 'transform, opacity');
    gsap.to(box, {
      y: 12,
      opacity: 0,
      duration: perfMode() === 'balanced' ? 0.16 : 0.22,
      ease: 'power2.in',
      onComplete: function () {
        cleanup();
        if (_origCloseModal) _origCloseModal(id);
      }
    });
  };

  var _origToggleLike = window.toggleLike;
  window.toggleLike = async function (btn, postId) {
    if (!window.currentUser) {
      if (window.showToast) window.showToast('请先登录');
      return;
    }
    var wasLiked = btn && btn.classList && btn.classList.contains('liked');
    if (!_origToggleLike) return;
    var result = await _origToggleLike(btn, postId);
    if (!btn || wasLiked || !btn.classList.contains('liked') || !hasGSAP() || perfMode() === 'lite') return result;
    var cleanup = withTransientWillChange(btn, 'transform');
    gsap.fromTo(btn, { scale: 1 }, {
      scale: perfMode() === 'balanced' ? 1.08 : 1.18,
      duration: 0.14,
      ease: 'power2.out',
      yoyo: true,
      repeat: 1,
      clearProps: 'transform',
      onComplete: cleanup
    });
    return result;
  };

  var _origOpenComment = window.openComment;
  window.openComment = function (postId) {
    if (!window.currentUser) {
      if (window.showToast) window.showToast('请先登录');
      return;
    }
    if (_origOpenComment) _origOpenComment(postId);
    if (!hasGSAP() || perfMode() === 'lite') return;
    var overlay = document.getElementById('commentModal');
    if (!overlay) return;
    var box = overlay.querySelector('.modal-box');
    if (!box) return;
    var cleanup = withTransientWillChange(box, 'transform, opacity');
    gsap.fromTo(box, { y: 16, opacity: 0 }, {
      y: 0, opacity: 1, duration: perfMode() === 'balanced' ? 0.22 : 0.32, ease: 'power2.out',
      clearProps: 'transform,opacity', onComplete: cleanup
    });
  };

  document.addEventListener('click', function (e) {
    var target = e.target;
    var post = target.closest('.post');
    if (!post || isDock(target)) return;
    if (target.closest(postToggleIgnoreSelector) || target.closest('.action-btn')) return;
    togglePostExpand(post);
  }, true);

  document.addEventListener('click', function (e) {
    if (e.target.closest('.post')) return;
    var expanded = document.querySelector('.post.xtj-expanded');
    if (!expanded) return;
    collapsePost(expanded);
  }, true);

  function togglePostExpand(post) {
    if (post.classList.contains('xtj-expanded')) collapsePost(post);
    else expandPost(post);
  }

  function expandPost(post) {
    var already = document.querySelector('.post.xtj-expanded');
    if (already && already !== post) collapsePost(already);
    post.classList.add('xtj-expanded');
    if (!hasGSAP() || perfMode() === 'lite') return;
    var cleanup = withTransientWillChange(post, 'transform');
    gsap.to(post, {
      scale: 1.01,
      y: -2,
      duration: perfMode() === 'balanced' ? 0.18 : 0.28,
      ease: 'power2.out',
      clearProps: 'transform',
      onComplete: cleanup
    });
  }

  function collapsePost(post) {
    post.classList.remove('xtj-expanded');
    if (!hasGSAP() || perfMode() === 'lite') return;
    var cleanup = withTransientWillChange(post, 'transform');
    gsap.to(post, {
      scale: 1,
      y: 0,
      duration: perfMode() === 'balanced' ? 0.16 : 0.22,
      ease: 'power2.out',
      clearProps: 'transform',
      onComplete: cleanup
    });
  }
})();
