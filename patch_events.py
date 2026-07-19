import re

# 1.2 & 1.3 Event throttling & Pointer Event leak fix

# core.js
with open('js/core.js', 'r', encoding='utf-8') as f:
    core = f.read()

# Add throttleRAF to core.js (if not already added)
if 'window.throttleRAF' not in core:
    throttle_code = """
window.throttleRAF = function(fn) {
    var ticking = false, args, ctx;
    return function() {
        args = arguments;
        ctx = this;
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(function() {
                fn.apply(ctx, args);
                ticking = false;
            });
        }
    };
};
"""
    core = re.sub(r'^(.*?;\n)', r'\1' + throttle_code, core, count=1, flags=re.MULTILINE)

# Pointer leak fix in core.js
core = core.replace(
    '''function onDragUp(e) {\n                    if (!drag || e.pointerId !== drag.id) return;''',
    '''function onDragUp(e) {\n                    if (!drag) { cleanupDrag(); return; }\n                    if (e.pointerId !== drag.id) return;'''
)
core = core.replace(
    '''function onDragCancel(e) {\n                    if (!drag || e.pointerId !== drag.id) return;''',
    '''function onDragCancel(e) {\n                    if (!drag) { cleanupDrag(); return; }\n                    if (e.pointerId !== drag.id) return;'''
)

# Apply throttleRAF to pointermove, resize, scroll in core.js
core = core.replace(
    '''document.addEventListener('pointermove', onDragMove, {passive: false});''',
    '''if(!window._throttledDragMove) window._throttledDragMove = window.throttleRAF(onDragMove);\n                    document.addEventListener('pointermove', window._throttledDragMove, {passive: false});'''
)
core = core.replace(
    '''document.removeEventListener('pointermove', onDragMove);''',
    '''document.removeEventListener('pointermove', window._throttledDragMove || onDragMove);'''
)
core = core.replace(
    '''window.addEventListener('resize', function() {\n                if (window.innerWidth <= 768) {''',
    '''window.addEventListener('resize', window.throttleRAF(function() {\n                if (window.innerWidth <= 768) {'''
)
core = core.replace(
    '''window.addEventListener('resize', function() {\n                        adjustIOSHeight();''',
    '''window.addEventListener('resize', window.throttleRAF(function() {\n                        adjustIOSHeight();'''
)

with open('js/core.js', 'w', encoding='utf-8') as f:
    f.write(core)

# ai-agent.js
with open('js/ai-agent.js', 'r', encoding='utf-8') as f:
    ai = f.read()

# Add throttleRAF to ai-agent.js
if 'window.throttleRAF' not in ai:
    ai = throttle_code + "\n" + ai

ai = ai.replace(
    '''window.addEventListener('resize', onResize);''',
    '''window.addEventListener('resize', window.throttleRAF(onResize));'''
)
ai = ai.replace(
    '''vv.addEventListener('resize', onViewportChange);''',
    '''vv.addEventListener('resize', window.throttleRAF(onViewportChange));'''
)
ai = ai.replace(
    '''vv.addEventListener('scroll', onViewportChange);''',
    '''vv.addEventListener('scroll', window.throttleRAF(onViewportChange));'''
)
ai = ai.replace(
    '''window.addEventListener('resize', onViewportChange);''',
    '''window.addEventListener('resize', window.throttleRAF(onViewportChange));'''
)
ai = ai.replace(
    '''window.addEventListener('resize', resize);''',
    '''window.addEventListener('resize', window.throttleRAF(resize));'''
)
ai = ai.replace(
    '''messagesEl.addEventListener('scroll', function() {''',
    '''messagesEl.addEventListener('scroll', window.throttleRAF(function() {'''
)

with open('js/ai-agent.js', 'w', encoding='utf-8') as f:
    f.write(ai)

print("Events patched")
