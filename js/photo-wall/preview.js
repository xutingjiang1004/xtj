!function() {
    var e = !1, t = null, o = {
        scale: 1,
        tx: 0,
        ty: 0
    }, n = [], i = -1, a = 0, r = 0, s = null, l = 0, c = !1, d = !1, p = 0, u = !1, f = !1, m = new Map, v = null, y = null, h = null, w = 1 / 0, g = 0, b = 0, x = 0, I = null, B = {
        isActive: !1,
        dy: 0,
        scale: 1,
        opacity: 1
    }, P = null, E = !1, L = Object.create(null);
    function T(e) {
        return "close" === e ? '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></span>' : "info" === e ? '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 12v4"></path><path d="M12 8h.01"></path></svg></span>' : "share" === e ? '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.6 13.5 6.8 4"></path><path d="m15.4 6.5-6.8 4"></path></svg></span>' : "rotate" === e ? '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(-1.5,0)"><path d="M20 11a8 8 0 1 0 2.35 5.65"></path><path d="M20 4v7h-7"></path></g></svg></span>' : "delete" === e ? '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="m19 6-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></span>' : "";
    }
    function M() {
        (a = window.innerWidth, r = window.innerHeight, s = document.getElementById("ppSlideTrack")) && (s.querySelectorAll(".pp-slide-slot").forEach(function(e) {
            e.style.width = a + "px", e.style.height = r + "px";
        }), s.style.width = 3 * a + "px", s.style.height = r + "px");
    }
    function k(e) {
        for (var t = n, o = -1; o <= 1; o++) {
            var i = e + o;
            i >= 0 && i < t.length && t[i].imageUrl && U(t[i].imageUrl);
        }
    }
    function z(e) {
        var t = n;
        if (s) {
            var o = document.getElementById("ppPrevImg"), i = document.getElementById("ppNextImg");
            e > 0 && t[e - 1] ? D(o, t[e - 1].imageUrl) : D(o, null), e < t.length - 1 && t[e + 1] ? D(i, t[e + 1].imageUrl) : D(i, null);
        }
    }
    var C = {}, _ = {}, H = {}, S = 3;
    function U(e) {
        if (!e) return Promise.resolve();
        if (C[e]) return Promise.resolve();
        if (_[e]) return _[e];
        var t = new Promise(function(t) {
            var o = new Image;
            function n() {
                o.complete ? (C[e] = o, delete _[e], delete H[e], t()) : o.onload = o.onerror = function() {
                    C[e] = o, delete _[e], delete H[e], t();
                };
            }
            o.src = e, "decode" in o ? o.decode().then(function() {
                C[e] = o, delete _[e], delete H[e], t();
            }).catch(function() {
                n();
            }) : n();
        });
        return _[e] = t, t;
    }
    function D(e, t) {
        if (e) {
            if (!t) return e._ppCleanup && e._ppCleanup(), e.style.transition = "none", e.removeAttribute("src"),
            e.style.opacity = "0", void (e._ppUrl = null);
            if (e._ppUrl === t) {
                if (e.complete && e.naturalWidth > 0) return e.style.transition = "none", void (e.style.opacity = "1");
                if (e._ppListenerUrl === t && e._ppCleanup) return;
            } else e._ppCleanup && e._ppCleanup();
            e._ppUrl = t;
            var o = C[t];
            if (o && o.naturalWidth > 0) return e._ppCleanup && e._ppCleanup(), e.style.transition = "none", e.src = t, void (e.style.opacity = "1");
            e.style.transition = "none", e.removeAttribute("src"), e.style.opacity = "0";
            var n = !1, i = 0, a = (e._ppLoadGen || 0) + 1, r = null;
            e._ppLoadGen = a;
            function cleanup() {
                r && (clearTimeout(r), r = null), e.removeEventListener("load", handleLoad), e.removeEventListener("error", handleError), e.onload = null, e.onerror = null, e._ppListenerUrl === t && (e._ppListenerUrl = null), e._ppCleanup === cleanup && (e._ppCleanup = null);
            }
            function handleLoad() {
                n || e._ppLoadGen !== a || e._ppUrl !== t || (n = !0, cleanup(), C[t] || (C[t] = e), delete H[t], requestAnimationFrame(function() {
                    e._ppLoadGen === a && e._ppUrl === t && (e.style.transition = "opacity 0.2s ease-in-out", e.offsetHeight, e.style.opacity = "1");
                }));
            }
            function handleError() {
                n || e._ppLoadGen !== a || e._ppUrl !== t || (cleanup(), (i = (H[t] || 0) + 1) <= S ? (H[t] = i, r = setTimeout(function() {
                    e._ppUrl === t && e._ppLoadGen === a && (n = !1, e._ppCleanup = cleanup, e.addEventListener("load", handleLoad), e.addEventListener("error", handleError), e._ppListenerUrl = t, e.src = t + (-1 === t.indexOf("?") ? "?t=" : "&t=") + Date.now());
                }, 500 * i)) : (n = !0, e._ppUrl = null, delete H[t], function(e) {
                    if (!e) return;
                    e.style.transition = "opacity 0.3s ease", e.style.opacity = "1", e.classList.add("pp-placeholder");
                }(e)));
            }
            e._ppCleanup = cleanup, e.addEventListener("load", handleLoad), e.addEventListener("error", handleError), e._ppListenerUrl = t, e.src = t, e.complete && e.naturalWidth > 0 && handleLoad();
        }
    }
    function O(e) {
        if (M(), s) {
            var t = n, o = document.getElementById("ppPrevImg"), i = document.getElementById("photoPreviewImage"), r = document.getElementById("ppNextImg");
            k(e), t[e] && D(i, t[e].imageUrl), e > 0 && t[e - 1] ? D(o, t[e - 1].imageUrl) : D(o, null),
            e < t.length - 1 && t[e + 1] ? D(r, t[e + 1].imageUrl) : D(r, null), l = 0, c = !1,
            s.classList.remove("snapping"), s.style.transition = "", s.style.transform = "translate3d(" + -a + "px, 0, 0)",
            t[e] && window.updateAmbientBackground(t[e].imageUrl);
        }
    }
    function R(e, t) {
        if (s) {
            c = !0, s.classList.add("snapping");
            s.style.transition = "transform 320ms cubic-bezier(0.33, 1, 0.68, 1)";
            var o = !1, n = function() {
                o || (o = !0, s.removeEventListener("transitionend", n), s.classList.remove("snapping"),
                c = !1, t && t());
            };
            s.addEventListener("transitionend", n), setTimeout(n, 440), s.style.transform = "translate3d(" + e + "px, 0, 0)";
        } else t && t();
    }
    function A(e) {
        if (s) {
            c = !0;
            var t = Math.abs(l - e), o = Math.min(Math.max(.5 * t, 150), 400);
            s.classList.add("snapping"), s.style.transition = "transform " + o + "ms cubic-bezier(0.33, 1, 0.68, 1)";
            var r = function() {
                s.removeEventListener("transitionend", r), s.classList.remove("snapping"), c = !1,
                Y(10);
                var e = i, t = n, o = document.getElementById("ppPrevImg"), a = (document.getElementById("photoPreviewImage"),
                document.getElementById("ppNextImg"));
                e > 0 && t[e - 1] ? D(o, t[e - 1].imageUrl) : D(o, null), e < t.length - 1 && t[e + 1] ? D(a, t[e + 1].imageUrl) : D(a, null),
                setTimeout(function() {
                    k(e);
                }, 500);
            };
            s.addEventListener("transitionend", r);
            var d = -a + e;
            s.style.transform = "translate3d(" + d + "px, 0, 0)";
        }
    }
    function N(e) {
        i = e, q(), t = n[e], j(e), F(e), M(), s.style.transition = "none", s.style.transform = "translate3d(" + -a + "px, 0, 0)",
        l = 0, c = !1, s.classList.remove("snapping"), O(e), n[e] && window.updateAmbientBackground(n[e].imageUrl),
        setTimeout(function() {
            f = !1;
        }, 300);
    }
    function W(e) {
        if (!f) {
            var t = i + e;
            if (t < 0 || t >= n.length) Math.abs(l) > 2 && A(0); else {
                f = !0, M();
                var o = 1 === e ? -2 * a : 0;
                k(t), z(t), R(o, function() {
                    N(t);
                });
            }
        }
    }
    function j(e) {
        var o = n;
        if (o[e]) {
            var i = o[e];
            t = i, window.photoPreviewCurrent = i;
            var a = document.getElementById("photoPreviewUser"), r = document.getElementById("photoPreviewTime"), s = document.getElementById("photoPreviewViewsCount");
            if (a && (a.textContent = i.username || "未知用户"), r) {
                var l = new Date(i.timestamp);
                r.textContent = l.toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                });
            }
            s && (s.textContent = i.views || "0");
            var c = document.getElementById("ppDeleteBtn");
            if (c) {
                var d = "xxz" === window.currentUser, p = window.currentUser === i.username;
                d || p ? (c.style.display = "flex", c.title = "删除") : c.style.display = "none";
            }
        }
    }
    function F(e) {
        var t = n, o = document.getElementById("ppDots");
        if (!o || t.length <= 1) o && (o.style.display = "none"); else {
            o.style.display = "flex";
            for (var i = "", a = 0; a < t.length; a++) i += '<span class="pp-dot' + (a === e ? " active" : "") + '" data-index="' + a + '"></span>';
            o.innerHTML = i;
        }
    }
    function q() {
        o = {
            scale: 1,
            tx: 0,
            ty: 0
        }, v = null, b = 0, document.querySelectorAll(".pp-slide-img").forEach(function(e) {
            e.style.transform = "", e.style.borderRadius = "";
        });
    }
    function X(e, t) {
        var n = document.getElementById("photoPreviewImage");
        if (n) if (o.scale > 1.01) q(), n.classList.remove("zoomed"); else {
            var i = n.getBoundingClientRect();
            if (o.scale = 2, void 0 !== e && void 0 !== t) {
                var a = (e - i.left) / i.width, r = (t - i.top) / i.height, s = i.left + i.width * a, l = i.top + i.height * r;
                o.tx = -1 * (window.innerWidth / 2 - s), o.ty = -1 * (window.innerHeight / 2 - l);
            } else {
                var c = i.left + i.width / 2, d = i.top + i.height / 2;
                o.tx = -1 * (window.innerWidth / 2 - c), o.ty = -1 * (window.innerHeight / 2 - d);
            }
            var p = "translate3d(" + o.tx + "px," + o.ty + "px,0) scale(" + o.scale + ")";
            n.style.transform = p, n.classList.add("zoomed");
        }
    }
    function Y(e) {
        if (navigator.vibrate) try {
            navigator.vibrate(e);
        } catch (e) {}
    }
    function V() {
        if (e) {
            if (window.__xtjPhotoPreviewHotfixInstalled) return e = !1, window.closePhotoPreview && window.closePhotoPreview();
            e = !1;
            var t = document.getElementById("photoPreviewOverlay");
            if (t) {
                t._cleanupPreview && t._cleanupPreview(), t._cleanupOpenListeners && t._cleanupOpenListeners(), q();
                var o = document.getElementById("photoPreviewImage"), n = t._openOrigin, i = t._openOriginImg, a = null;
                o && o._ppCleanup && o._ppCleanup();
                if (o && (a = o.getBoundingClientRect()), n && a && i && a.width > 0 && a.height > 0 && n.width > 0 && n.height > 0) {
                    i.style.transition = "none", i.style.opacity = "0";
                    var r = n.left - a.left, s = n.top - a.top, l = n.width / a.width, c = n.height / a.height, d = Math.min(l, c);
                    o.style.transition = "none", o.style.transform = "translate(0, 0) scale(1)", o.style.transformOrigin = "top left",
                    o.style.borderRadius = "0px", o.offsetHeight, t.style.transition = "opacity 0.15s cubic-bezier(0.25, 1, 0.4, 1)",
                    o.style.transition = "transform 0.2s cubic-bezier(0.25, 1, 0.4, 1), border-radius 0.2s cubic-bezier(0.25, 1, 0.4, 1)",
                    o.style.transform = "translate(" + r + "px, " + s + "px) scale(" + d + ")", o.style.borderRadius = 14 / d + "px",
                    t.style.opacity = "0", setTimeout(function() {
                        i && (i.style.transition = "", i.style.opacity = ""), o && (o.style.transition = "",
                        o.style.transform = "", o.style.transformOrigin = "", o.style.borderRadius = ""),
                        t.style.transition = "", t.style.opacity = "", t.classList.remove("active"), document.body.classList.remove("photo-previewing");
                    }, 220);
                } else t.style.transition = "opacity 0.15s cubic-bezier(0.55, 0, 1, 0.45)", t.style.opacity = "0",
                setTimeout(function() {
                    t.style.opacity = "", t.style.transition = "", t.classList.remove("active"), o && (o.style.transition = "",
                    o.style.transform = "", o.style.transformOrigin = "", o.style.borderRadius = ""),
                    i && (i.style.transition = "", i.style.opacity = ""), document.body.classList.remove("photo-previewing");
                }, 150);
            } else document.body.classList.remove("photo-previewing");
        }
    }
    function Z(e) {
        return e || 0 === e ? e >= 1048576 ? (e / 1048576).toFixed(2) + " MB" : e >= 1024 ? (e / 1024).toFixed(1) + " KB" : e + " B" : "--";
    }
    function K(e, t) {
        return '<div class="pp-info-row"><span class="pp-info-label">' + e + '</span><span class="pp-info-value">' + t + "</span></div>";
    }
    function G(e, t) {
        var o = null == e || "" === e ? t || "--" : e;
        return window.escapeHtml ? window.escapeHtml(String(o)) : String(o);
    }
    function J(e) {
        if (!e) return "";
        var t = e.timestamp ? new Date(e.timestamp).toLocaleString("zh-CN") : "--", o = "";
        o += K("作者", G(e.username, "--")), o += K("时间", G(t, "--")), o += K("浏览", G(null != e.views ? e.views : 0, "0"));
        var n = "";
        n += K("大小", G(Z(e.fileSize), "--")), e.originalSize && Number(e.originalSize) > 0 && Number(e.originalSize) !== Number(e.fileSize || 0) && (n += K("原始大小", G(Z(e.originalSize), "--")));
        var i = "";
        e.exif && ((e.exif.make || e.exif.model) && (i += K("设备", G(e.exif.model || e.exif.make, "--"))),
        e.exif.fNumber && (i += K("光圈", G("f/" + e.exif.fNumber, "--"))), e.exif.exposureTime && (i += K("快门", G(e.exif.exposureTime, "--"))),
        e.exif.iso && (i += K("ISO", G(e.exif.iso, "--"))), e.exif.focalLength && (i += K("焦距", G(e.exif.focalLength + "mm", "--"))));
        var a = '<div class="pp-info-section"><div class="pp-info-section-title">照片信息</div>' + o + '</div><div class="pp-info-divider"></div><div class="pp-info-section"><div class="pp-info-section-title">文件信息</div>' + n + "</div>";
        return i && (a += '<div class="pp-info-divider"></div><div class="pp-info-section"><div class="pp-info-section-title">EXIF 数据</div>' + i + "</div>"),
        a;
    }
    function Q() {
        var e = t;
        if (e) {
            var o = document.getElementById("ppInfoModal");
            if (o && ("flex" === o.style.display || o.classList.contains("active") || o.classList.contains("closing"))) window.closePhotoInfo(); else {
                if (!o) {
                    var n = document.createElement("div");
                    n.className = "pp-info-modal", n.id = "ppInfoModal", n.innerHTML = '<div class="pp-info-modal-content"><div class="pp-info-modal-header"><span class="pp-info-modal-title">照片详情</span><button class="pp-info-modal-close" onclick="window.closePhotoInfo()">&times;</button></div><div class="pp-info-modal-body" id="ppInfoModalBody"></div></div>',
                    document.body.appendChild(n), o = n;
                }
                o._bgListener || (o._bgListener = !0, o.addEventListener("click", function(e) {
                    e.target === o && window.closePhotoInfo();
                }));
                var i = "--";
                if (e.fileSize) {
                    var a = e.fileSize;
                    i = a >= 1048576 ? (a / 1048576).toFixed(2) + " MB" : a >= 1024 ? (a / 1024).toFixed(1) + " KB" : a + " B";
                }
                var r = "--";
                e.timestamp && (r = new Date(e.timestamp).toLocaleString("zh-CN"));
                var s = "";
                s += x("作者", I(e.username, "--")), s += x("时间", I(r, "--")), s += x("浏览", I(e.views || 0, "0"));
                var l = "";
                l += x("大小", I(i, "--"));
                var c = "";
                e.exif && ((e.exif.make || e.exif.model) && (c += x("设备", I(e.exif.model || e.exif.make, "--"))),
                e.exif.fNumber && (c += x("光圈", I("f/" + e.exif.fNumber, "--"))), e.exif.exposureTime && (c += x("快门", I(e.exif.exposureTime, "--"))),
                e.exif.iso && (c += x("ISO", I(e.exif.iso, "--"))), e.exif.focalLength && (c += x("焦距", I(e.exif.focalLength + "mm", "--"))));
                var d = '<div class="pp-info-section"><div class="pp-info-section-title">照片信息</div>' + s + '</div><div class="pp-info-divider"></div><div class="pp-info-section"><div class="pp-info-section-title">文件信息</div>' + l + "</div>";
                c && (d += '<div class="pp-info-divider"></div><div class="pp-info-section"><div class="pp-info-section-title">EXIF 数据</div>' + c + "</div>");
                var p = document.getElementById("ppInfoModalBody");
                p && (p.innerHTML = d), o._closeTimeout && (clearTimeout(o._closeTimeout), o._closeTimeout = null);
                var u = o.querySelector(".pp-info-modal-content"), f = document.getElementById("ppInfoBtn"), m = null;
                if (f && (m = f.getBoundingClientRect()), o.classList.remove("closing"), o.classList.add("active"),
                o.style.display = "flex", o.style.opacity = "1", u.style.transition = "none", u.style.transform = "",
                u.style.opacity = "1", u.offsetHeight, m) {
                    var v = u.getBoundingClientRect(), y = m.left - v.left, h = m.top - v.top, w = m.width / v.width, g = m.height / v.height, b = Math.min(w, g);
                    u.style.transform = "translate(" + y + "px, " + h + "px) scale(" + b + ")", u.style.transformOrigin = "top left",
                    u.style.opacity = "0", o._ppInfoOrigin = {
                        dx: y,
                        dy: h,
                        scale: b,
                        btnWidth: m.width,
                        btnHeight: m.height
                    };
                }
                u.offsetHeight, o.style.transition = "opacity 0.25s ease-out", o.style.opacity = "0",
                o.offsetHeight, o.style.opacity = "1", m ? (u.style.transition = "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out",
                u.style.transform = "translate(0, 0) scale(1)", u.style.opacity = "1") : (u.style.transition = "none",
                u.style.transform = "scale(0.9)", u.style.opacity = "0", u.offsetHeight, u.style.transition = "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out",
                u.style.transform = "scale(1)", u.style.opacity = "1");
            }
        }
        function x(e, t) {
            return '<div class="pp-info-row"><span class="pp-info-label">' + e + '</span><span class="pp-info-value">' + t + "</span></div>";
        }
        function I(e, t) {
            return window.escapeHtml(String(null == e || "" === e ? t || "--" : e));
        }
    }
    function $() {
        try {
            var e = document.getElementById("ppDownloadOverlay");
            e && (e.style.display = "none");
            var t = document.getElementById("ppDownloadProgressBar");
            t && (t.style.width = "0%");
        } catch (e) {
            console.error("Error hiding download overlay:", e);
        }
    }
    function ee(e, t) {
        try {
            var o = document.getElementById("ppDownloadProgressBar");
            o && (o.style.width = Math.max(0, Math.min(100, e)) + "%");
            var n = document.getElementById("ppDownloadText");
            n && t && (n.textContent = t);
        } catch (e) {
            console.error("Error updating download progress:", e);
        }
    }
    function te() {
        try {
            var e = document.getElementById("ppDownloadConfirmModal");
            e && (e.classList.remove("show"), setTimeout(function() {
                try {
                    e && e.style && (e.style.display = "none");
                } catch (e) {
                    console.error("Error in hide timeout:", e);
                }
            }, 300));
        } catch (e) {
            console.error("Error hiding download confirm modal:", e);
        }
    }
    window.ppPrevPhoto = function() {
        W(-1);
    }, window.ppNextPhoto = function() {
        W(1);
    }, window.openPhotoPreview = function(b, L) {
        if (!e) if (L || (n = window.pwCurrentSortedPhotos ? window.pwCurrentSortedPhotos.slice() : window.photoWallData ? window.photoWallData.slice() : []),
        n && 0 !== n.length) {
            b < 0 && (b = 0), b >= n.length && (b = n.length - 1);
            var _ = document.getElementById("photoPreviewOverlay");
            if (!_) {
                var H = document.createElement("div");
                H.className = "photo-preview-overlay", H.id = "photoPreviewOverlay", H.innerHTML = '<div class="pp-ambient-bg" id="ppAmbientBg"></div><div class="pp-dots" id="ppDots"></div><button class="photo-preview-close" onclick="closePhotoPreview()" aria-label="关闭预览">' + T("close") + '</button><button class="pp-nav-arrow pp-nav-prev" id="ppPrevBtn" onclick="window.ppPrevPhoto()" aria-label="上一张"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="pp-nav-arrow pp-nav-next" id="ppNextBtn" onclick="window.ppNextPhoto()" aria-label="下一张"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="photo-preview-image-wrapper" id="ppImageWrapper"><div id="ppSlideTrack" class="pp-slide-track"><div class="pp-slide-slot pp-prev-slot"><img id="ppPrevImg" class="pp-slide-img" alt="prev"/></div><div class="pp-slide-slot pp-cur-slot"><img id="photoPreviewImage" class="pp-slide-img" alt="current"/></div><div class="pp-slide-slot pp-next-slot"><img id="ppNextImg" class="pp-slide-img" alt="next"/></div></div></div><button class="pp-zoom-btn pp-zoom-out" id="ppZoomOutBtn" title="缩小" onclick="window.zoomOut()"><span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"></path></svg></span></button><button class="pp-zoom-btn pp-zoom-in" id="ppZoomInBtn" title="放大" onclick="window.zoomIn()"><span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg></span></button><button class="pp-info-btn" id="ppInfoBtn" title="照片信息" onclick="showPhotoInfo()">' + T("info") + '</button><button class="pp-share-btn" id="ppShareBtn" title="分享" onclick="window.shareCurrentPhoto()">' + T("share") + '</button><button class="pp-rotate-btn" id="ppRotateBtn" title="旋转 90 度" onclick="window.ppRotatePhoto()">' + T("rotate") + '</button><button id="ppDeleteBtn" class="pp-delete-btn" onclick="window.deletePhotoFromPreview()">' + T("delete") + '</button><div class="photo-preview-info"><span class="pp-user" id="photoPreviewUser"></span><span class="pp-time" id="photoPreviewTime"></span><span class="pp-views" id="photoPreviewViews"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12s-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.6"/></svg><span id="photoPreviewViewsCount">0</span></span></div><div class="pp-download-overlay" id="ppDownloadOverlay" style="display:none;"><div class="pp-download-content"><div class="pp-download-spinner"></div><div class="pp-download-text" id="ppDownloadText">正在下载...</div><div class="pp-download-progress"><div class="pp-download-progress-bar" id="ppDownloadProgressBar"></div></div></div></div>',
                document.body.appendChild(H), _ = H;
            }
            d || (!function(d) {
                var b, L;
                d.querySelector(".photo-preview-image-wrapper");
                function T() {
                    P && (clearTimeout(P), P = null), I && (clearTimeout(I), I = null), h && (cancelAnimationFrame(h),
                    h = null), m.clear(), v = null, y = null, B.isActive = !1;
                }
                d._cleanupPreview = T, d.addEventListener("pointerdown", function(e) {
                    var n = e.target, i = n.closest(".photo-preview-close, .pp-nav-arrow, .pp-zoom-btn, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn"), a = n.closest(".pp-info-modal-content, .pp-download-confirm-content"), r = n.closest(".pp-info-modal, .pp-download-confirm-overlay"), l = E;
                    if (I && (clearTimeout(I), I = null), P && (clearTimeout(P), P = null), i || l) e.stopPropagation(); else if (a) e.stopPropagation(); else {
                        r && e.stopPropagation(), Date.now(), b = e.clientX, L = e.clientY, x = 0;
                        var d = e.pointerId, p = {
                            x: e.clientX,
                            y: e.clientY
                        };
                        if (m.set(d, p), 1 === m.size && (P = setTimeout(function() {
                            !function() {
                                try {
                                    if (E) return;
                                    if (!t || !t.imageUrl) return void window.showToast("没有可下载的照片");
                                    !function() {
                                        try {
                                            var e = document.getElementById("photoPreviewOverlay");
                                            if (!e) return;
                                            var t = document.getElementById("ppDownloadConfirmModal");
                                            if (t) return t.style.display = "flex", t.offsetHeight, void t.classList.add("show");
                                            var o = document.createElement("div");
                                            o.id = "ppDownloadConfirmModal", o.className = "pp-download-confirm-overlay", o.innerHTML = '<div class="pp-download-confirm-content"><div class="pp-download-confirm-title">是否要下载该图片？</div><div class="pp-download-confirm-buttons"><button class="pp-download-confirm-btn pp-cancel-btn" onclick="window.ppCancelDownload()">取消</button><button class="pp-download-confirm-btn pp-confirm-btn" onclick="window.ppConfirmDownload()">确认</button></div></div>',
                                            e.appendChild(o), o.offsetHeight, o.classList.add("show");
                                        } catch (e) {
                                            console.error("Error showing download confirm modal:", e);
                                        }
                                    }();
                                } catch (e) {
                                    console.error("Error in download current photo:", e), window.showToast("操作失败，请重试");
                                }
                            }();
                        }, 500)), 2 === m.size) {
                            var u = Array.from(m.values()), f = u[1].x - u[0].x, h = u[1].y - u[0].y, T = Math.sqrt(f * f + h * h), M = window.innerWidth / 2, k = window.innerHeight / 2, z = (u[0].x + u[1].x) / 2, C = (u[0].y + u[1].y) / 2, _ = o.scale || 1;
                            v = {
                                dist: T,
                                scale: _,
                                ax: (z - M) / _ - o.tx,
                                ay: (C - k) / _ - o.ty
                            }, w = T, g = T, y = {
                                x: z,
                                y: C,
                                zx: o.tx,
                                zy: o.ty,
                                pointers: 2
                            };
                        } else c && (c = !1, s.style.transition = "none"), o.scale > 1.01 ? y = {
                            x: e.clientX,
                            y: e.clientY,
                            zx: o.tx,
                            zy: o.ty,
                            pointers: 1
                        } : (B.isActive = !0, B.dy = 0, B.scale = 1, B.opacity = 1);
                    }
                }), d.addEventListener("pointermove", function(e) {
                    if (0 !== m.size) {
                        var t = e.clientX - b, p = e.clientY - L;
                        (x = Math.abs(t) + Math.abs(p)) > 15 && P && (clearTimeout(P), P = null);
                        var u = e.pointerId;
                        if (m.set(u, {
                            x: e.clientX,
                            y: e.clientY
                        }), 2 === m.size) {
                            var f = Array.from(m.values()), I = f[1].x - f[0].x, E = f[1].y - f[0].y, T = Math.sqrt(I * I + E * E);
                            w = Math.min(w, T), g = Math.max(g, T);
                            var M = window.innerWidth / 2, k = window.innerHeight / 2, z = (f[0].x + f[1].x) / 2, C = (f[0].y + f[1].y) / 2;
                            0;
                            var _ = T / v.dist, H = Math.max(1, Math.min(8, v.scale * _));
                            if (o.scale = H, o.tx = z - M - v.ax * H, o.ty = C - k - v.ay * H, O = document.getElementById("photoPreviewImage")) {
                                var S = "translate3d(" + o.tx + "px," + o.ty + "px,0) scale(" + o.scale + ")";
                                O.style.transform = S, O.classList.add("zoomed");
                            }
                        } else if (1 === m.size && y && 1 === y.pointers) {
                            var U = e.clientX - y.x, D = e.clientY - y.y;
                            if (o.tx = y.zx + U, o.ty = y.zy + D, O = document.getElementById("photoPreviewImage")) {
                                S = "translate3d(" + o.tx + "px," + o.ty + "px,0) scale(" + o.scale + ")";
                                O.style.transform = S;
                            }
                        } else if (o.scale <= 1.01 && B.isActive && p > 0) {
                            B.dy = p;
                            var O, R = Math.max(.7, 1 - p / (2 * r));
                            B.scale = R, B.opacity = Math.max(0, 1 - p / r), (O = document.getElementById("photoPreviewImage")) && (d.style.opacity = B.opacity,
                            O.style.transform = "translate(0, " + p + "px) scale(" + B.scale + ")");
                        } else {
                            if (c) return;
                            if (l = t, !(o.scale > 1.01)) {
                                var A = -a + l, N = 1;
                                0 === i && t > 0 && (N = 1 + t / a * 2), i === n.length - 1 && t < 0 && (N = 1 - t / a * 2),
                                A = t / N - a, h && cancelAnimationFrame(h), h = requestAnimationFrame(function() {
                                    s.style.transform = "translate3d(" + A + "px, 0, 0)", h = null;
                                });
                            }
                        }
                    }
                }), d.addEventListener("pointerup", function(e) {
                    P && (clearTimeout(P), P = null);
                    var t = e.target, r = t.closest(".photo-preview-close, .pp-nav-arrow, .pp-zoom-btn, .pp-info-btn, .pp-share-btn, .pp-rotate-btn, .pp-delete-btn"), s = t.closest(".pp-info-modal-content, .pp-download-confirm-content"), h = t.closest(".pp-info-modal, .pp-download-confirm-overlay");
                    if (r || E) return e.stopPropagation(), m.clear(), y = null, void (B.isActive = !1);
                    if (s) return e.stopPropagation(), m.clear(), y = null, void (B.isActive = !1);
                    if (h) {
                        e.stopPropagation(), m.clear(), y = null, B.isActive = !1;
                        var b = document.getElementById("ppInfoModal");
                        b && "none" !== b.style.display && window.closePhotoInfo();
                        var L = document.getElementById("ppDownloadConfirmModal");
                        L && "none" !== L.style.display && te();
                    } else {
                        var T = e.pointerId;
                        if (m.delete(T), 0 === m.size) {
                            var M = Date.now(), C = x > 15;
                            if (B.isActive && o.scale <= 1.01 && B.dy > 0) {
                                var _ = 150;
                                if (B.dy > _) return B.isActive = !1, void V();
                                var H = document.getElementById("photoPreviewImage");
                                H && (d.style.transition = "opacity 0.3s cubic-bezier(0.25, 1, 0.4, 1)", H.style.transition = "transform 0.3s cubic-bezier(0.25, 1, 0.4, 1)",
                                d.style.opacity = 1, H.style.transform = ""), B.isActive = !1;
                            }
                            if (v) {
                                if (g - w < 10) o = {
                                    scale: 1,
                                    tx: 0,
                                    ty: 0
                                }, document.querySelectorAll(".pp-slide-img").forEach(function(e) {
                                    e.style.transform = "";
                                });
                                v = null;
                            }
                            var S = o.scale > 1.01;
                            if (!S && !c) {
                                var U = l, D = Math.abs(U) > a / 4;
                                if (D) {
                                    var O = U > 0 ? -1 : 1;
                                    -1 === O && i > 0 ? (f = !0, k(i - 1), z(i - 1), R(0, function() {
                                        N(i - 1);
                                    })) : 1 === O && i < n.length - 1 ? (f = !0, k(i + 1), z(i + 1), R(-2 * a, function() {
                                        N(i + 1);
                                    })) : A(0);
                                }
                                l = 0, D || (C = !1);
                            }
                            if (!C) if (S) M - p < 300 && !u && (I && (clearTimeout(I), I = null), X(e.clientX, e.clientY),
                            u = !0, setTimeout(function() {
                                u = !1;
                            }, 300)), p = M; else if (M - p < 300 && !u && o.scale <= 1.01 && (I && (clearTimeout(I),
                            I = null), X(e.clientX, e.clientY), u = !0, setTimeout(function() {
                                u = !1;
                            }, 300)), p = M, !u && o.scale <= 1.01 && !f) {
                                var W = document.getElementById("ppInfoModal");
                                if (W && "none" !== W.style.display && W.classList.contains("active")) return window.closePhotoInfo(),
                                void (y = null);
                                I && clearTimeout(I), I = setTimeout(function() {
                                    I = null, V();
                                }, 350);
                            }
                            y = null;
                        }
                    }
                }), d.addEventListener("pointercancel", function(e) {
                    if (P && (clearTimeout(P), P = null), m.clear(), v = null, y = null, B.isActive) {
                        var t = document.getElementById("photoPreviewImage");
                        t && (d.style.transition = "opacity 0.3s cubic-bezier(0.25, 1, 0.4, 1)", t.style.transition = "transform 0.3s cubic-bezier(0.25, 1, 0.4, 1)",
                        d.style.opacity = 1, t.style.transform = ""), B.isActive = !1;
                    }
                    o.scale <= 1.01 && A(0);
                }), window.addEventListener("resize", function() {
                    e && (M(), O(i), q());
                });
            }(_), d = !0), q(), e = !0, t = n[b] || null, window.photoPreviewCurrent = t, i = b;
            var S = n[b];
            S && S.imageUrl && U(S.imageUrl), M(), s && (s.style.transition = "none", s.style.transform = "translate3d(" + -a + "px, 0, 0)");
            var D = null, W = null, Y = document.getElementById("photoGrid");
            if (Y && S && null != S.id) {
                var Z = Y.querySelector('.photo-wall-item[data-photo-id="' + String(S.id).replace(/"/g, '\\"') + '"]'), K = Z ? Z.querySelector("img") : null;
                if (K && K.complete) {
                    var G = K.getBoundingClientRect();
                    G && G.width > 0 && G.height > 0 && (D = G, W = K);
                }
            }
            _._openOrigin = D, _._openOriginImg = W, W && (W.style.transition = "none", W.style.opacity = "0"),
            _.classList.add("active"), document.body.classList.add("photo-previewing"), _.style.opacity = "1",
            M(), s && (s.style.transition = "none", s.style.transform = "translate3d(" + -a + "px, 0, 0)");
            var J = document.getElementById("photoPreviewImage"), Q = !1, $ = null, ee = (_._openLoadGen || 0) + 1;
            function cleanupOpenListeners() {
                $ && (clearTimeout($), $ = null), J && (J.removeEventListener("load", handleOpenLoad), J.removeEventListener("error", handleOpenError)), _ && _._cleanupOpenListeners === cleanupOpenListeners && (_._cleanupOpenListeners = null);
            }
            function handleOpenLoad() {
                _._openLoadGen === ee && (cleanupOpenListeners(), J.offsetHeight, J.style.opacity = "1", re());
            }
            function handleOpenError() {
                _._openLoadGen === ee && (cleanupOpenListeners(), J.style.opacity = "1", re());
            }
            _._openLoadGen = ee, _._cleanupOpenListeners && _._cleanupOpenListeners(), _._cleanupOpenListeners = cleanupOpenListeners;
            J && (J._ppCleanup && J._ppCleanup(), J._ppLoadGen = (J._ppLoadGen || 0) + 1, J._ppUrl = null, J._ppListenerUrl = null, J.classList.remove("pp-placeholder"));
            if (J && S && S.imageUrl) {
                var oe = C[S.imageUrl];
                if (J.style.transition = "none", J.style.opacity = "0", J.src = S.imageUrl, oe || J.complete) {
                    if (J.offsetHeight, D) {
                        var ne = J.getBoundingClientRect();
                        if (ne && ne.width > 0) {
                            var ie = D.left - ne.left, ae = D.top - ne.top, se = D.width / ne.width, te = D.height / ne.height, le = Math.min(se, te);
                            J.style.transform = "translate(" + ie + "px, " + ae + "px) scale(" + le + ")", J.style.transformOrigin = "top left",
                            J.style.borderRadius = 14 / le + "px", J.style.opacity = "1";
                        }
                    }
                    J.offsetHeight, D && J.getBoundingClientRect().width > 0 ? (_.style.transition = "opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
                    J.style.transition = "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    J.style.transform = "translate(0, 0) scale(1)", J.style.borderRadius = "0px", $ = setTimeout(re, 220)) : (J.style.opacity = "1",
                    $ = setTimeout(re, 150));
                } else {
                    J.addEventListener("load", handleOpenLoad), J.addEventListener("error", handleOpenError), $ = setTimeout(function() {
                        _._openLoadGen === ee && (cleanupOpenListeners(), re());
                    }, 8e3);
                }
            } else re();
        } else window.showToast("暂无照片");
        function re() {
            Q || (Q = !0, _ && _._cleanupOpenListeners && _._cleanupOpenListeners(), J && (J.style.transition = "", J.style.transform = "", J.style.transformOrigin = "",
            J.style.borderRadius = ""), _.style.transition = "", O(b), j(b), F(b), W && (W.style.transition = "",
            W.style.opacity = ""));
        }
    }, window.closePhotoPreview = V, Q = function() {
        var e = t;
        if (e) {
            var o = document.getElementById("ppInfoModal");
            if (o && ("flex" === o.style.display || o.classList.contains("active") || o.classList.contains("closing"))) window.closePhotoInfo(); else {
                if (!o) {
                    var n = document.createElement("div");
                    n.className = "pp-info-modal", n.id = "ppInfoModal", n.innerHTML = '<div class="pp-info-modal-content"><div class="pp-info-modal-header"><span class="pp-info-modal-title">照片详情</span><button class="pp-info-modal-close" onclick="window.closePhotoInfo()">&times;</button></div><div class="pp-info-modal-body" id="ppInfoModalBody"></div></div>',
                    document.body.appendChild(n), o = n;
                }
                o._bgListener || (o._bgListener = !0, o.addEventListener("click", function(e) {
                    e.target === o && window.closePhotoInfo();
                }));
                var i = document.getElementById("ppInfoModalBody");
                i && (i.innerHTML = J(e)), o._closeTimeout && (clearTimeout(o._closeTimeout), o._closeTimeout = null);
                var a = o.querySelector(".pp-info-modal-content"), r = document.getElementById("ppInfoBtn"), s = r ? r.getBoundingClientRect() : null;
                if (o.classList.remove("closing"), o.classList.add("active"), o.style.display = "flex",
                o.style.opacity = "1", a.style.transition = "none", a.style.transform = "", a.style.opacity = "1",
                a.offsetHeight, s) {
                    var l = a.getBoundingClientRect(), c = s.left - l.left, d = s.top - l.top, p = s.width / l.width, u = s.height / l.height, f = Math.min(p, u);
                    a.style.transform = "translate(" + c + "px, " + d + "px) scale(" + f + ")", a.style.transformOrigin = "top left",
                    a.style.opacity = "0", o._ppInfoOrigin = {
                        dx: c,
                        dy: d,
                        scale: f,
                        btnWidth: s.width,
                        btnHeight: s.height
                    };
                }
                a.offsetHeight, o.style.transition = "opacity 0.25s ease-out", o.style.opacity = "0",
                o.offsetHeight, o.style.opacity = "1", s ? (a.style.transition = "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out",
                a.style.transform = "translate(0, 0) scale(1)", a.style.opacity = "1") : (a.style.transition = "none",
                a.style.transform = "scale(0.9)", a.style.opacity = "0", a.offsetHeight, a.style.transition = "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out",
                a.style.transform = "scale(1)", a.style.opacity = "1"), !e.fileSize && e.imageUrl && async function(e) {
                    if (!e || e.fileSize || !e.imageUrl) return e ? e.fileSize : null;
                    if (L[e.imageUrl]) return e.fileSize = L[e.imageUrl], e.fileSize;
                    try {
                        var t = await fetch(e.imageUrl, {
                            cache: "force-cache"
                        });
                        if (!t || !t.ok) return null;
                        var o = await t.blob();
                        return o && o.size ? (L[e.imageUrl] = o.size, e.fileSize = o.size, o.size) : null;
                    } catch (e) {
                        return null;
                    }
                }(e).then(function(o) {
                    if (o && t === e) {
                        var n = document.getElementById("ppInfoModal"), i = document.getElementById("ppInfoModalBody");
                        n && i && n.classList.contains("active") && (i.innerHTML = J(e));
                    }
                });
            }
        }
    }, window.showPhotoInfo = Q, window.closePhotoInfo = function() {
        var e = document.getElementById("ppInfoModal");
        if (e && !e.classList.contains("closing")) {
            var t = e.querySelector(".pp-info-modal-content");
            e.classList.remove("active"), e.classList.add("closing");
            var o = e._ppInfoOrigin;
            if (o && t) {
                var n = t.getBoundingClientRect(), i = document.getElementById("ppInfoBtn"), a = i ? i.getBoundingClientRect() : null, r = 0, s = 0, l = .3;
                a ? (r = a.left - n.left, s = a.top - n.top, l = Math.min(a.width / n.width, a.height / n.height)) : (r = o.dx,
                s = o.dy, l = o.scale || .3), t.style.transition = "none", t.style.transform = "translate(0, 0) scale(1)",
                t.style.opacity = "1", t.offsetHeight, t.style.transition = "transform 0.3s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.2s ease-in",
                t.style.transform = "translate(" + r + "px, " + s + "px) scale(" + l + ")", t.style.opacity = "0",
                e.style.transition = "opacity 0.25s ease-in", e.style.opacity = "0", e._closeTimeout && clearTimeout(e._closeTimeout),
                e._closeTimeout = setTimeout(function() {
                    t.style.transition = "none", t.style.transform = "", t.style.opacity = "", t.style.transformOrigin = "",
                    e.style.display = "none", e.style.opacity = "", e.style.transition = "", e.classList.remove("closing"),
                    e._closeTimeout = null;
                }, 320);
            } else t && (t.style.transition = "none", t.style.transform = "scale(1)", t.style.opacity = "1",
            t.offsetHeight, t.style.transition = "transform 0.3s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.2s ease-in",
            t.style.transform = "scale(0.9)", t.style.opacity = "0"), e.style.transition = "opacity 0.25s ease-in",
            e.style.opacity = "0", e._closeTimeout = setTimeout(function() {
                e.style.display = "none", e.style.opacity = "", e.style.transition = "", e.classList.remove("closing"),
                t && (t.style.transition = "none", t.style.transform = "", t.style.opacity = "",
                t.style.transformOrigin = ""), e._closeTimeout = null;
            }, 320);
        }
    }, window.shareCurrentPhoto = function() {
        if (window.__xtjPhotoPreviewHotfixInstalled) return window.shareCurrentPhoto && window.shareCurrentPhoto();
        var e = t;
        if (e && e.imageUrl) {
            if ("vibrate" in navigator && "function" == typeof navigator.vibrate) try {
                navigator.vibrate(10);
            } catch (e) {}
            var o = document.getElementById("ppShareBtn");
            if (o) {
                if (o._copying) return;
                o._copying = !0, o._origHTML = o.innerHTML, o.textContent = "✓", o.classList.add("copied");
            }
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) return void navigator.clipboard.writeText(e.imageUrl).then(r).catch(s);
            } catch (e) {}
            try {
                var n = document.createElement("textarea");
                n.value = e.imageUrl, document.body.appendChild(n), n.select();
                var i = document.execCommand("copy");
                if (document.body.removeChild(n), i) return void r();
            } catch (e) {}
            s();
        } else window.showToast("暂无可分享的图片");
        function a() {
            o && (o.innerHTML = o._origHTML || "🔗", o.classList.remove("copied"), o.style.transform = "",
            o._copying = !1);
        }
        function r() {
            window.showToast("图片链接已复制"), setTimeout(a, 1500);
        }
        function s() {
            window.showToast("复制失败，请重试"), setTimeout(a, 1500);
        }
    }, window.deleteCurrentPhoto = function() {
        window.deletePhotoFromPreview();
    }, window.deletePhotoFromPreview = function() {
        if (e) {
            if (window.__xtjPhotoPreviewHotfixInstalled) return window.deletePhotoFromPreview && window.deletePhotoFromPreview();
            Y(10);
            var t = document.getElementById("ppDeleteBtn"), o = t ? t.getBoundingClientRect() : null;
            if (o) {
                var a = o.left + o.width / 2, r = o.top + o.height / 2;
                window._confirmOrigin = {
                    btnCx: a,
                    btnCy: r,
                    btnWidth: o.width,
                    btnHeight: o.height
                };
            }
            window.showConfirm("删除照片", "删除后无法恢复，确定删除吗？", "确定删除", async function() {
                var e = n;
                if (!(i < 0 || i >= e.length)) {
                    var t = e[i];
                    if (t) {
                        var o = document.getElementById("ppDeleteBtn"), a = document.getElementById("ppConfirmOkBtn");
                        o && (o.disabled = !0), a && (a.disabled = !0), window.showToast("正在删除...");
                        var r = {
                            ok: !0
                        };
                        window.deletePhotoWallPhoto && (r = await window.deletePhotoWallPhoto(t, {
                            render: !1
                        })), r && r.ok ? (n = e.filter(function(e) {
                            return e && String(e.id) !== String(t.id);
                        }), V(), window.renderPhotoWallWithoutReload ? window.renderPhotoWallWithoutReload() : window.renderPhotoWall && window.renderPhotoWall(),
                        window.showToast("照片已从照片墙删除")) : (o && (o.disabled = !1), a && (a.disabled = !1));
                    }
                }
            });
        }
    }, window.ppRotatePhoto = function() {
        b = (b + 90) % 360, document.querySelectorAll(".pp-slide-img").forEach(function(e) {
            e && e.style && (e.style.transform = "rotate(" + b + "deg)");
        }), window.showToast && window.showToast("已旋转 " + b + "°");
    }, window.ppCancelDownload = function() {
        try {
            te();
        } catch (e) {
            console.error("Error in cancel download:", e);
        }
    }, window.ppConfirmDownload = function() {
        try {
            te(), async function() {
                try {
                    if (E) return;
                    var e = t;
                    if (!e || !e.imageUrl) return void window.showToast("没有可下载的照片");
                    if (E = !0, function() {
                        try {
                            var e = document.getElementById("ppDownloadOverlay");
                            e && (e.style.display = "flex");
                        } catch (e) {
                            console.error("Error showing download overlay:", e);
                        }
                    }(), ee(10, "正在下载..."), "vibrate" in navigator && "function" == typeof navigator.vibrate) try {
                        navigator.vibrate(10);
                    } catch (e) {}
                    var o = setInterval(function() {
                        var e = document.getElementById("ppDownloadProgressBar");
                        if (e) {
                            var t = parseInt(e.style.width) || 10;
                            t < 85 && ee(t + 2);
                        } else clearInterval(o);
                    }, 150), n = await fetch(e.imageUrl);
                    if (clearInterval(o), !n.ok) throw new Error("HTTP error " + n.status);
                    ee(90, "正在保存..."), function(e, t) {
                        try {
                            var o = window.URL.createObjectURL(e), n = document.createElement("a");
                            n.href = o;
                            var i = "photo_" + Date.now() + ".jpg";
                            if (t) {
                                var a = t.split("/"), r = a[a.length - 1].split("?")[0];
                                r && r.length > 0 && (i = r);
                            }
                            n.download = i, document.body.appendChild(n), n.click(), setTimeout(function() {
                                try {
                                    document.body.removeChild(n), window.URL.revokeObjectURL(o);
                                } catch (e) {}
                            }, 200), ee(100, "下载成功!"), setTimeout(function() {
                                $(), E = !1, window.showToast("下载成功");
                            }, 800);
                        } catch (e) {
                            console.error("Blob download error:", e), $(), E = !1, window.showToast("下载失败，请重试");
                        }
                    }(await n.blob(), e.imageUrl);
                } catch (t) {
                    console.error("Download error:", t), $(), E = !1;
                    try {
                        var i = document.createElement("a");
                        i.href = e.imageUrl, i.target = "_blank", i.rel = "noopener noreferrer", i.download = "photo_" + Date.now() + ".jpg",
                        document.body.appendChild(i), i.click(), setTimeout(function() {
                            try {
                                document.body.removeChild(i);
                            } catch (e) {}
                        }, 100), window.showToast("已在新窗口打开下载");
                    } catch (e) {
                        window.showToast("下载失败，请重试");
                    }
                }
            }();
        } catch (e) {
            console.error("Error in confirm download:", e);
        }
    };
}();
