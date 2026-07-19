import re

with open('js/core.js', 'r', encoding='utf-8') as f:
    core = f.read()

# Fix getPostLikeButtons
core = core.replace(
    '''var fallbackBtn = postEl.querySelector('.actions .action-btn');\n                    if (fallbackBtn) buttons.push(fallbackBtn);''',
    '''var likeBtn = postEl.querySelector('.actions .like-btn') || postEl.querySelector('.actions .action-btn');\n                    if (likeBtn) buttons.push(likeBtn);'''
)

# Fix toggleLike finding btn
core = core.replace(
    '''var likeBtn = postEl.querySelector('.actions .action-btn');''',
    '''var likeBtn = postEl.querySelector('.actions .like-btn') || postEl.querySelector('.actions .action-btn');'''
)

# Fix createHeartParticles
new_particles = r'''                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width/2;
                const cy = rect.top + rect.height/2;
                
                // create pulse ring
                const ring = document.createElement('div');
                ring.className = 'pulse-ring';
                ring.style.left = cx + 'px';
                ring.style.top = cy + 'px';
                document.body.appendChild(ring);
                setTimeout(() => ring.remove(), 600);

                const emojis = ["❤","✨","💖","⭐","💗"];
                for(let i=0; i<8; i++){
                    const el = document.createElement('div');
                    el.className = 'heart-particle';
                    el.textContent = emojis[Math.floor(Math.random()*emojis.length)];
                    el.style.left = cx + 'px';
                    el.style.top = cy + 'px';
                    const ang = (Math.random()*Math.PI*2);
                    const dst = 30 + Math.random()*40;
                    el.style.setProperty('--heart-x', Math.cos(ang)*dst + 'px');
                    el.style.setProperty('--heart-y', Math.sin(ang)*dst + 'px');
                    document.body.appendChild(el);
                    setTimeout(()=>el.remove(), 800);
                }'''

core = re.sub(
    r'                var rect = btn\.getBoundingClientRect\(\);.*?\(function\(node\).*?\}\)\(el\);\n                \}',
    new_particles,
    core,
    flags=re.DOTALL
)

# Fix HTML generation for like-btn
core = core.replace(
    '''<button class="action-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + safeJsStr(p.id) + '\')">' + (isLiked ? '已赞' : '点赞') + '</button>''',
    '''<button class="action-btn like-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + safeJsStr(p.id) + '\')">' + (isLiked ? '已赞' : '点赞') + '</button>'''
)
core = core.replace(
    '''<button class="action-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + idJs + '\')">' + (isLiked ? '已赞' : '点赞') + '</button>''',
    '''<button class="action-btn like-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + idJs + '\')">' + (isLiked ? '已赞' : '点赞') + '</button>'''
)

with open('js/core.js', 'w', encoding='utf-8') as f:
    f.write(core)

# Now fix style.css
with open('css/style.css', 'r', encoding='utf-8') as f:
    css = f.read()

new_css = r'''        .action-btn.liked {
            background: linear-gradient(135deg, rgba(255, 59, 96, 0.15), rgba(255, 105, 135, 0.15));
            color: var(--like-color);
            border-color: rgba(255, 59, 96, 0.4);
            box-shadow: 0 4px 12px rgba(255, 59, 96, 0.12);
        }
        .action-btn.liked:hover {
            background: linear-gradient(135deg, rgba(255, 59, 96, 0.2), rgba(255, 105, 135, 0.2));
            box-shadow: 0 4px 16px rgba(255, 59, 96, 0.2);
        }

        .heart-particle {
            position: fixed;
            width: 20px;
            height: 20px;
            margin: -10px 0 0 -10px;
            display: grid;
            place-items: center;
            color: #ff496f;
            font-size: 18px;
            line-height: 1;
            pointer-events: none;
            animation: heartFly 800ms cubic-bezier(.18,.89,.32,1.2) var(--heart-delay, 0ms) forwards;
            z-index: 9999;
            text-shadow: 0 2px 8px rgba(255, 59, 96, 0.4);
            filter: drop-shadow(0 0 4px rgba(255,59,96,0.3));
        }
        @keyframes heartFly {
            0%   { transform: translate3d(0, 0, 0) scale(.3) rotate(0); opacity: 0; }
            15%  { opacity: 1; transform: translate3d(calc(var(--heart-x) * 0.2), calc(var(--heart-y) * 0.2), 0) scale(1.2) }
            50%  { opacity: .9; transform: translate3d(calc(var(--heart-x) * 0.6), calc(var(--heart-y) * 0.6), 0) scale(1) }
            100% { transform: translate3d(var(--heart-x), var(--heart-y), 0) scale(.8); opacity: 0; }
        }
        
        .pulse-ring {
            position: fixed;
            width: 40px;
            height: 40px;
            margin: -20px 0 0 -20px;
            border-radius: 50%;
            border: 2px solid #ff496f;
            pointer-events: none;
            animation: pulseRingAnim 600ms cubic-bezier(0.165, 0.84, 0.44, 1) forwards;
            z-index: 9998;
        }
        @keyframes pulseRingAnim {
            0% { transform: scale(0.5); opacity: 0.8; border-width: 4px; }
            100% { transform: scale(2.5); opacity: 0; border-width: 0px; }
        }
        
        .like-feedback-add {
            animation: likePop 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes likePop {
            0% { transform: scale(1); }
            50% { transform: scale(1.15); }
            100% { transform: scale(1); }
        }'''

css = re.sub(r'        \.action-btn\.liked \{.*?@keyframes heartFly \{.*?\}', new_css, css, flags=re.DOTALL)

with open('css/style.css', 'w', encoding='utf-8') as f:
    f.write(css)
