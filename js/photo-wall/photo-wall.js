(function() {
    var photoWallInitialized = false;

    window.initPhotoWall = async function() {
        if (photoWallInitialized) return;
        photoWallInitialized = true;
        await window.renderPhotoWall();
        window.bindPhotoWallScroll();
    };

    function initPhotoWallHash() {
        function checkHash() {
            var hash = window.location.hash;
            if (hash === '#photo-wall' || hash === '#photos') {
                var aiTab = document.querySelector('.dock-tab[data-tab="ai"]');
                if (aiTab) aiTab.click();
            }
        }
        checkHash();
        window.addEventListener('hashchange', checkHash);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPhotoWallHash);
    } else {
        initPhotoWallHash();
    }
})();
