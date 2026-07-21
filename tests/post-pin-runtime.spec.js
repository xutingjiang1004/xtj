const { test, expect } = require('@playwright/test');

test.describe('Post Pinning Edge Cases', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/post/pin', async route => {
            const data = JSON.parse(route.request().postData());
            await route.fulfill({ status: 200, json: { ok: true, data: { id: data.post_id, is_pinned: data.is_pinned } } });
        });
    });

    test('detail page unpin relies on server state or original button text', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.togglePostPin === 'function');
        
        await page.evaluate(() => { 
            window.feedAllPosts = []; 
            window.currentUser = 'u';
            window.ensureProtectedOperationAuth = async () => ({ ok: true, token: 't', user_name: 'u' });
            window.loadFeed = async () => {};
            window.refreshPostDetailIfActive = async () => {};
            window.xtjProtectedFetch = window.fetch;
        });
        
        await page.evaluate(() => {
            const btn = document.createElement('button');
            btn.id = 'testUnpinBtn';
            btn.textContent = '取消置顶';
            document.body.appendChild(btn);
            btn.onclick = () => window.togglePostPin('11111111-1111-4111-8111-111111111111', btn);
        });

        let pinApiCalled = false;
        let isPinnedPayload = null;
        await page.route('**/api/post/pin', async route => {
            pinApiCalled = true;
            isPinnedPayload = JSON.parse(route.request().postData()).is_pinned;
            await route.fulfill({ status: 200, json: { ok: true, data: { id: '11111111-1111-4111-8111-111111111111', is_pinned: false } } });
        });

        await page.click('#testUnpinBtn');
        await page.waitForFunction(() => document.getElementById('testUnpinBtn').textContent === '置顶', { timeout: 2000 });

        expect(pinApiCalled).toBe(true);
        expect(isPinnedPayload).toBe(false); 
    });

    test('frontend failure correctly falls back to authoritative server state', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.togglePostPin === 'function');
        
        await page.evaluate(() => {
            window.feedAllPosts = [{ id: '22222222-2222-4111-8111-222222222222', user_name: 'u', is_pinned: false }];
            window.currentUser = 'u';
            window.ensureProtectedOperationAuth = async () => ({ ok: true, token: 't', user_name: 'u' });
            window.xtjProtectedFetch = window.fetch;
            
            window.loadFeedCalled = false;
            window.loadFeed = async () => { window.loadFeedCalled = true; };
            window.refreshPostDetailIfActive = async () => {};
            
            const btn = document.createElement('button');
            btn.id = 'testPinBtn2';
            btn.textContent = '置顶';
            document.body.appendChild(btn);
            btn.onclick = () => window.togglePostPin('22222222-2222-4111-8111-222222222222', btn);
            window.syncPinnedPostIntoFeedState = () => { throw new Error('Sabotage'); };
        });

        await page.click('#testPinBtn2');
        await page.waitForFunction(() => document.getElementById('testPinBtn2').textContent === '取消置顶', { timeout: 2000 });
        
        const loadFeedCalled = await page.evaluate(() => window.loadFeedCalled);
        expect(loadFeedCalled).toBe(true);
    });

    test('global lock prevents cross-post concurrent pinning', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.togglePostPin === 'function');
        
        await page.evaluate(() => {
            window.feedAllPosts = [
                { id: '11111111-1111-4111-8111-111111111111', user_name: 'u', is_pinned: false },
                { id: '22222222-2222-4111-8111-222222222222', user_name: 'u', is_pinned: false }
            ];
            window.currentUser = 'u';
            window.ensureProtectedOperationAuth = async () => ({ ok: true, token: 't', user_name: 'u' });
            window.xtjProtectedFetch = window.fetch;
            window.loadFeed = async () => {};
            window.refreshPostDetailIfActive = async () => {};
            window.syncPinnedPostIntoFeedState = () => true;
            window.rebuildFeedFromCurrentState = async () => {};
            
            const btnA = document.createElement('button');
            btnA.id = 'btnA'; btnA.textContent = '置顶';
            document.body.appendChild(btnA);
            btnA.onclick = () => window.togglePostPin('11111111-1111-4111-8111-111111111111', btnA);
            
            const btnB = document.createElement('button');
            btnB.id = 'btnB'; btnB.textContent = '置顶';
            document.body.appendChild(btnB);
            btnB.onclick = () => window.togglePostPin('22222222-2222-4111-8111-222222222222', btnB);
        });

        let apiCalls = 0;
        await page.route('**/api/post/pin', async route => {
            apiCalls++;
            await new Promise(r => setTimeout(r, 100));
            await route.fulfill({ status: 200, json: { ok: true, data: { id: '11111111-1111-4111-8111-111111111111', is_pinned: true } } });
        });

        await page.evaluate(() => {
            document.getElementById('btnA').click();
            document.getElementById('btnB').click();
        });

        await page.waitForFunction(() => window.isPinningPost === false, { timeout: 2000 });
        expect(apiCalls).toBe(1);
    });
});
