(function() {
    function initPhotoWallTab() {
        var pwTab = document.getElementById('tabPhotoWall');
        if (!pwTab) return;
        pwTab.addEventListener('click', async function() {
            if (!photoPreviewActive || (Date.now() - (photoPreviewClosedAt || 0) > 500)) {
                await window.renderPhotoWall();
            }
            window.bindPhotoWallScroll();
        });
    }

    function initPhotoWallHash() {
        function checkHash() {
            var hash = window.location.hash;
            if (hash === '#photo-wall' || hash === '#photos') {
                var pwTab = document.getElementById('tabPhotoWall');
                if (pwTab) pwTab.click();
            }
        }
        checkHash();
        window.addEventListener('hashchange', checkHash);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            initPhotoWallTab();
            initPhotoWallHash();
        });
    } else {
        initPhotoWallTab();
        initPhotoWallHash();
    }
})();
