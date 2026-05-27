(function() {
    function restoreMinimalDockStyles() {
        var old = document.getElementById('xtjDockRestoreStyle');
        if (old) old.remove();
        var style = document.getElementById('xtjDockMinimalStyle');
        if (!style) {
            style = document.createElement('style');
            style.id = 'xtjDockMinimalStyle';
            document.head.appendChild(style);
        }
        style.textContent = `
            #dockBar.dock-bar {
                position: fixed !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 3px !important;
                padding: 10px 12px 14px !important;
                padding-left: calc(12px + env(safe-area-inset-left, 0px)) !important;
                padding-right: calc(12px + env(safe-area-inset-right, 0px)) !important;
                padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px)) !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                pointer-events: none !important;
                z-index: 100 !important;
            }
            #dockBar .dock-tab,
            #dockBar .dock-tab.active,
            #dockBar .dock-tab:hover,
            #dockBar .dock-tab:focus,
            #dockBar .dock-tab:focus-visible {
                -webkit-appearance: none !important;
                appearance: none !important;
                background: transparent !important;
                border: none !important;
                outline: none !important;
                box-shadow: none !important;
                -webkit-box-shadow: none !important;
            }
            #dockBar .dock-tab {
                margin: 0 !important;
                width: auto !important;
                min-width: 62px !important;
                max-width: 80px !important;
                height: 54px !important;
                flex: 1 1 0 !important;
                padding: 4px 10px !important;
                border-radius: 0 !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 1px !important;
                color: var(--text-muted) !important;
                font-family: inherit !important;
                font-size: 9px !important;
                line-height: 1 !important;
                cursor: pointer !important;
                pointer-events: auto !important;
                position: relative !important;
                overflow: visible !important;
                -webkit-tap-highlight-color: transparent !important;
                transition: color .28s cubic-bezier(.16,1,.3,1), transform .28s cubic-bezier(.16,1,.3,1) !important;
            }
            #dockBar .dock-tab::before,
            #dockBar .dock-tab::after,
            #dockBar .dock-tab.active::before,
            #dockBar .dock-tab.active::after {
                display: none !important;
                content: none !important;
                opacity: 0 !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            #dockBar .dock-tab.active {
                color: var(--primary) !important;
                transform: translateY(-4px) !important;
            }
            #dockBar .dock-tab:active {
                transform: scale(.94) !important;
            }
            #dockBar .dock-tab.active:active {
                transform: translateY(-4px) scale(.94) !important;
            }
            #dockBar .dock-tab .dt-icon,
            #dockBar .dock-tab .dt-label {
                position: relative !important;
                z-index: 1 !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
            }
            #dockBar .dock-tab .dt-icon {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 24px !important;
                height: 24px !important;
                font-size: 20px !important;
                line-height: 1 !important;
                filter: none !important;
            }
            #dockBar .dock-tab.active .dt-icon {
                filter: drop-shadow(0 4px 8px rgba(5,150,105,.22)) !important;
            }
            #dockBar .dock-tab .dt-icon svg.dt-svg,
            #dockBar .dock-tab .dt-icon svg {
                width: 21px !important;
                height: 21px !important;
                display: block !important;
            }
            #dockBar .dock-tab .dt-label {
                display: block !important;
                height: auto !important;
                overflow: visible !important;
                pointer-events: none !important;
                font-size: 9px !important;
                font-weight: 500 !important;
                letter-spacing: .25px !important;
                color: currentColor !important;
            }
            #dockBar .dock-tab.active .dt-label {
                font-weight: 700 !important;
            }
            #dockBar .dock-tab[data-tab="ai"] .dt-label {
                display: none !important;
            }
            #dockBar .dock-tab .anim-layer,
            #dockBar .dock-tab .anim-layer * {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            #dockBar .dock-tab .anim-layer {
                position: absolute !important;
                left: 50% !important;
                top: 50% !important;
                transform: translate(-50%, -50%) !important;
                pointer-events: none !important;
                z-index: 2 !important;
            }
            body.photo-previewing #dockBar {
                display: none !important;
            }
        `;
    }

    restoreMinimalDockStyles();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreMinimalDockStyles);
    }
})();