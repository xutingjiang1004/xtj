(function () {
  'use strict';

  if (window.__xtjAnimationsLoaded) return;
  window.__xtjAnimationsLoaded = true;

  function hasGSAP() {
    return typeof gsap !== 'undefined';
  }

  function isDock(el) {
    return !!(el && el.closest && el.closest('#dockBar,.dock-bar,.dock-tab'));
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

  /* =================================================
     1. 弹窗 - 磨砂冲击入场 (挂钩 openModal)
     ================================================= */
  var _origOpenModal = window.openModal;
  window.openModal = function (id) {
    var overlay = document.getElementById(id);
    if (!overlay) return;
    if (hasGSAP()) {
      var box = overlay.querySelector('.modal-box');
      var prev = box ? box.__xtjMTl : null;
      if (prev) { prev.kill(); }
      gsap.set(overlay, { backdropFilter: 'blur(0px)', backgroundColor: 'rgba(0,0,0,0)' });
      if (box) gsap.set(box, { y: 28, scale: 0.95, opacity: 0, filter: 'blur(6px)' });
    }
    if (_origOpenModal) _origOpenModal(id);
    else { overlay.style.display = ''; overlay.classList.add('active'); }
    if (!hasGSAP()) return;
    var box2 = overlay.querySelector('.modal-box');
    if (!box2) return;
    var tl = gsap.timeline();
    tl.to(overlay, { backdropFilter: 'blur(10px)', backgroundColor: 'rgba(0,0,0,0.35)', duration: 0.32, ease: 'power2.out' }, 0);
    tl.to(box2, { y: 0, scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.48, ease: 'power3.out', clearProps: 'filter' }, 0.04);
    box2.__xtjMTl = tl;
  };

  /* =================================================
     2. 弹窗 - 磨砂冲击退场 (挂钩 closeModal)
     ================================================= */
  var _origCloseModal = window.closeModal;
  window.closeModal = function (id) {
    var overlay = document.getElementById(id);
    if (!overlay) { if (_origCloseModal) _origCloseModal(id); return; }
    if (!hasGSAP()) { if (_origCloseModal) _origCloseModal(id); return; }
    var box = overlay.querySelector('.modal-box');
    var prev = box ? box.__xtjMTl : null;
    if (prev) { prev.kill(); box.__xtjMTl = null; }
    gsap.to(box, { y: 20, scale: 0.96, opacity: 0, filter: 'blur(4px)', duration: 0.24, ease: 'power2.in' });
    gsap.to(overlay, {
      backdropFilter: 'blur(0px)', backgroundColor: 'rgba(0,0,0,0)',
      duration: 0.18, ease: 'power2.in',
      delay: 0.04,
      onComplete: function () {
        if (_origCloseModal) _origCloseModal(id);
        if (box) { box.style.transform = ''; box.style.opacity = ''; box.style.filter = ''; }
        overlay.style.backdropFilter = ''; overlay.style.backgroundColor = '';
      }
    });
  };

  /* =================================================
     3. 点赞 - GSAP 弹性缩放 + 粒子爆发
     ================================================= */
  var _origToggleLike = window.toggleLike;
  var _origHeartParticles = window.createHeartParticles;

  window.createHeartParticles = function () {};

  window.toggleLike = async function (btn, postId) {
    if (!window.currentUser) { if (window.showToast) window.showToast('请先登录'); return; }
    var wasLiked = btn.classList.contains('liked');
    var result = await _origToggleLike(btn, postId);
    var isLikedNow = btn.classList.contains('liked');
    if (wasLiked || !isLikedNow || !hasGSAP()) return result;
    var tl = gsap.timeline();
    tl.to(btn, { scale: 1.35, duration: 0.1, ease: 'power2.out' });
    tl.to(btn, { scale: 1, duration: 0.4, ease: 'elastic.out(1, 0.35)' });
    spawnLikeBurst(btn);
    return result;
  };

  function spawnLikeBurst(btn) {
    var rect = btn.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var emojis = ['❤️', '💜', '💙', '💚', '💛', '🧡'];
    var i = 10;
    while (i--) {
      (function (idx) {
        var el = document.createElement('div');
        el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        el.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;font-size:18px;pointer-events:none;z-index:99999;line-height:1;';
        document.body.appendChild(el);
        var angle = Math.PI * 2 * idx / 10 + (Math.random() - 0.5) * 0.6;
        var dist = 40 + Math.random() * 70;
        var ox = Math.cos(angle) * dist;
        var oy = Math.sin(angle) * dist - 20 - Math.random() * 20;
        gsap.to(el, {
          x: ox, y: oy, opacity: 0, scale: 0.3,
          duration: 0.7 + Math.random() * 0.3,
          ease: 'power2.out',
          delay: Math.random() * 0.08,
          onComplete: function () { el.remove(); }
        });
      })(i);
    }
  }

  /* =================================================
     4. 评论弹窗 - 磨砂入场 (挂钩 openComment)
     ================================================= */
  var _origOpenComment = window.openComment;
  window.openComment = function (postId) {
    if (!window.currentUser) { if (window.showToast) window.showToast('请先登录'); return; }
    _origOpenComment(postId);
    if (!hasGSAP()) return;
    var overlay = document.getElementById('commentModal');
    if (!overlay) return;
    var box = overlay.querySelector('.modal-box');
    if (!box) return;
    gsap.set(overlay, { backdropFilter: 'blur(0px)', backgroundColor: 'rgba(0,0,0,0)' });
    gsap.set(box, { y: 28, scale: 0.95, opacity: 0, filter: 'blur(6px)' });
    gsap.to(overlay, { backdropFilter: 'blur(10px)', backgroundColor: 'rgba(0,0,0,0.35)', duration: 0.32, ease: 'power2.out' });
    gsap.to(box, { y: 0, scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.48, ease: 'power3.out', delay: 0.04, clearProps: 'filter' });
  };

  /* =================================================
     5. 帖子卡片点击展开/收起
     ================================================= */
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
    if (post.classList.contains('xtj-expanded')) {
      collapsePost(post);
    } else {
      expandPost(post);
    }
  }

  function expandPost(post) {
    var already = document.querySelector('.post.xtj-expanded');
    if (already && already !== post) collapsePost(already);
    post.classList.add('xtj-expanded');
    if (!hasGSAP()) return;
    gsap.to(post, {
      scale: 1.01, y: -2,
      boxShadow: '0 20px 48px rgba(0,0,0,0.12)',
      duration: 0.35, ease: 'power2.out'
    });
    var comments = post.querySelector('.comments');
    if (comments) {
      var items = comments.querySelectorAll('.comment-item');
      if (items.length) {
        gsap.set(items, { opacity: 0, y: 8, scale: 0.97 });
        gsap.to(items, {
          opacity: 1, y: 0, scale: 1,
          duration: 0.28, stagger: 0.04, ease: 'power2.out',
          delay: 0.1
        });
      }
    }
  }

  function collapsePost(post) {
    post.classList.remove('xtj-expanded');
    if (!hasGSAP()) return;
    gsap.to(post, {
      scale: 1, y: 0,
      duration: 0.25, ease: 'power2.out',
      clearProps: 'boxShadow'
    });
  }

})();
